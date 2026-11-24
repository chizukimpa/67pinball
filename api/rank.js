const { put, head, list, del } = require('@vercel/blob');

/*
 * Ranking do 67 Pinball.
 *
 * Primario: Upstash Redis (REST, sem SDK): 1 comando por leitura, 2 por gravacao,
 * zero operacoes de Blob.
 * Fallback: Vercel Blob (quando as variaveis do Redis nao existem): caminho fixo
 * por jogador, 1 operacao avancada por gravacao e lista em cache na leitura.
 */

const STORE = process.env.BLOB_STORE_ID;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const REDIS_KEY = '67rank:players';
const REDIS_MIGRADO = '67rank:migrated';

const PREFIX = 'players/';
const PRICES = [670, 1700, 3400, 6700, 10000, 16700, 67000, 100000, 2000000];
const CACHE_LISTA_MS = 30000;

function limparNome(n) {
  return String(n || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 12).trim();
}

function zeros() {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0];
}

function normalizarChips(v) {
  const out = zeros();
  if (Array.isArray(v)) {
    for (let i = 0; i < 9; i++) out[i] = v[i] ? 1 : 0;
  }
  return out;
}

function normalizar(j) {
  return {
    aura: Math.max(0, Math.floor(Number(j && j.aura) || 0)),
    chips: normalizarChips(j && j.chips),
    ts: Number(j && j.ts) || 0
  };
}

/* ---------- Redis (Upstash REST) ---------- */

async function cmd(args) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + REDIS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error('redis http ' + res.status);
  const json = await res.json();
  if (json && json.error) throw new Error('redis: ' + json.error);
  return json ? json.result : null;
}

function paresParaMapa(arr) {
  const out = {};
  const lista = arr || [];
  for (let i = 0; i + 1 < lista.length; i += 2) {
    try {
      const j = JSON.parse(lista[i + 1]);
      if (j && j.name) out[j.name] = normalizar(j);
    } catch (e) {}
  }
  return out;
}

/* ---------- Blob (fallback e migracao) ---------- */

let cacheLista = null;

function caminho(nome) {
  return PREFIX + encodeURIComponent(nome) + '.json';
}

async function lerJsonUrl(url) {
  try {
    const r = await fetch(url + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function blobLerTodos() {
  if (cacheLista && Date.now() - cacheLista.em < CACHE_LISTA_MS) return cacheLista.dados;

  const { blobs } = await list({ prefix: PREFIX, storeId: STORE, limit: 1000 });
  const lidos = (await Promise.all((blobs || []).map(function (b) {
    return lerJsonUrl(b.url);
  }))).filter(Boolean);

  const players = {};
  for (const j of lidos) {
    if (!j || !j.name) continue;
    const atual = players[j.name];
    if (!atual || (j.ts || 0) > (atual.ts || 0)) {
      players[j.name] = normalizar(j);
    }
  }

  cacheLista = { em: Date.now(), dados: players };
  return players;
}

async function blobLerUm(nome) {
  try {
    const meta = await head(caminho(nome), { storeId: STORE });
    const j = await lerJsonUrl(meta.url);
    if (!j || j.name !== nome) return null;
    return normalizar(j);
  } catch (e) {
    return null;
  }
}

async function blobSalvar(nome, dados) {
  await put(caminho(nome), JSON.stringify({ name: nome, aura: dados.aura, chips: dados.chips, ts: dados.ts }), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    storeId: STORE
  });
  cacheLista = null;
}

async function blobRemover(nome) {
  try {
    await del(caminho(nome), { storeId: STORE });
  } catch (e) {}
  cacheLista = null;
}

/* ---------- Migracao unica: Blob antigo -> Redis ---------- */

let migracao = null;

function migrarSePreciso() {
  if (!USE_REDIS) return Promise.resolve();
  if (migracao) return migracao;

  migracao = (async function () {
    const ja = await cmd(['GET', REDIS_MIGRADO]);
    if (ja) return;

    let antigos = {};
    try {
      antigos = await blobLerTodos();
    } catch (e) {
      console.warn('rank: falha lendo blob antigo na migracao:', String(e && e.message ? e.message : e));
    }

    const nomes = Object.keys(antigos);
    for (const nome of nomes) {
      // HSETNX: nunca sobrescreve um placar que ja chegou no Redis
      await cmd(['HSETNX', REDIS_KEY, nome, JSON.stringify({ name: nome, aura: antigos[nome].aura, chips: antigos[nome].chips, ts: antigos[nome].ts })]);
    }
    await cmd(['SET', REDIS_MIGRADO, '1']);
    console.log('rank: migracao concluida, ' + nomes.length + ' jogadores');
  })().catch(function (e) {
    migracao = null;
    throw e;
  });

  return migracao;
}

/* ---------- Fachada de armazenamento ---------- */

async function carregarTodos() {
  if (!USE_REDIS) return blobLerTodos();
  await migrarSePreciso();
  return paresParaMapa(await cmd(['HGETALL', REDIS_KEY]));
}

async function carregarUm(nome) {
  if (!USE_REDIS) return blobLerUm(nome);
  await migrarSePreciso();
  const raw = await cmd(['HGET', REDIS_KEY, nome]);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return j ? normalizar(j) : null;
  } catch (e) {
    return null;
  }
}

async function salvar(nome, dados) {
  const json = JSON.stringify({ name: nome, aura: dados.aura, chips: dados.chips, ts: dados.ts });
  if (USE_REDIS) {
    await cmd(['HSET', REDIS_KEY, nome, json]);
    return;
  }
  await blobSalvar(nome, dados);
}

async function remover(nome) {
  if (USE_REDIS) {
    await cmd(['HDEL', REDIS_KEY, nome]);
    return;
  }
  await blobRemover(nome);
}

/* ---------- Regras do jogo ---------- */

async function lerUm(nome) {
  const p = await carregarUm(nome);
  if (!p) return { aura: 0, chips: zeros(), ts: 0, exists: false };
  return { aura: p.aura, chips: p.chips.slice(), ts: p.ts, exists: true };
}

async function gravar(nome, aura, chips) {
  const dados = {
    name: nome,
    aura: Math.max(0, Math.floor(aura)),
    chips: normalizarChips(chips),
    ts: Date.now()
  };
  await salvar(nome, dados);
  return dados;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      res.status(200).json({ players: await carregarTodos() });
      return;
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      body = body || {};

      const nome = limparNome(body.name);
      if (!nome) {
        res.status(400).json({ error: 'nome' });
        return;
      }

      const atual = await lerUm(nome);
      let aura = atual.aura;
      let chips = atual.chips.slice();
      let bought = false;

      // definir aura/fichas "na mao" so pelo admin (evita cliente antigo sobrescrever)
      const admin = (body.key === '67rank');
      if (admin && Array.isArray(body.chips)) {
        chips = normalizarChips(body.chips);
      }
      if (admin && body.aura !== undefined && body.aura !== null && !isNaN(Number(body.aura))) {
        aura = Math.max(0, Math.floor(Number(body.aura)));
      }
      // cliente antigo (manda o total): nunca deixa baixar, so sobe; fichas somam
      if (!admin && body.aura !== undefined && body.aura !== null && !isNaN(Number(body.aura))) {
        const v = Math.max(0, Math.floor(Number(body.aura)));
        if (v > aura) aura = v;
      }
      if (!admin && Array.isArray(body.chips)) {
        for (let i = 0; i < 9; i++) if (body.chips[i]) chips[i] = 1;
      }
      if (body.addAura !== undefined && !isNaN(Number(body.addAura))) {
        aura = Math.max(0, aura + Math.floor(Number(body.addAura)));
      }

      const comprando = (body.buy !== undefined);
      if (comprando) {
        const i = Math.floor(Number(body.buy)) - 1;
        if (i >= 0 && i < 9 && !chips[i] && aura >= PRICES[i]) {
          aura -= PRICES[i];
          chips[i] = 1;
          bought = true;
        }
      }

      // compra recusada: devolve o estado atual sem criar uma versao nova
      if (comprando && !bought && !admin && body.addAura === undefined) {
        const player = atual.exists
          ? { name: nome, aura: aura, chips: chips, ts: atual.ts }
          : null;
        res.status(200).json({ ok: true, bought: false, player: player });
        return;
      }

      const salvo = await gravar(nome, aura, chips);
      res.status(200).json({ ok: true, bought: bought, player: salvo });
      return;
    }

    if (req.method === 'DELETE') {
      const q = req.query || {};
      if (q.key !== '67rank') {
        res.status(403).json({ error: 'chave' });
        return;
      }
      const nome = limparNome(q.name);
      if (!nome) {
        res.status(400).json({ error: 'nome' });
        return;
      }
      await remover(nome);
      res.status(200).json({ ok: true, removido: nome });
      return;
    }

    res.status(405).json({ error: 'metodo' });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};

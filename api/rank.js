const { put, list, del } = require('@vercel/blob');

const STORE = process.env.BLOB_STORE_ID;
const PREFIX = 'players/';
const PRICES = [670, 1700, 3400, 6700, 10000, 16700, 67000, 100000, 2000000];
const MAX_VERSOES = 5;

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

async function lerJson(blob) {
  try {
    const r = await fetch(blob.url + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function versoes(nome) {
  const { blobs } = await list({
    prefix: PREFIX + encodeURIComponent(nome),
    storeId: STORE,
    limit: 1000
  });
  return blobs || [];
}

async function lerUm(nome) {
  const blobs = await versoes(nome);
  const lidos = (await Promise.all(blobs.map(lerJson))).filter(function (j) {
    return j && j.name === nome;
  });
  if (!lidos.length) return { aura: 0, chips: zeros(), ts: 0, exists: false };

  lidos.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  const j = lidos[0];
  return {
    aura: Math.max(0, Math.floor(j.aura || 0)),
    chips: normalizarChips(j.chips),
    ts: j.ts || 0,
    exists: true
  };
}

async function lerTodos() {
  const { blobs } = await list({ prefix: PREFIX, storeId: STORE, limit: 1000 });
  const lidos = (await Promise.all((blobs || []).map(lerJson))).filter(Boolean);
  const players = {};

  for (const j of lidos) {
    if (!j || !j.name) continue;
    const atual = players[j.name];
    if (!atual || (j.ts || 0) > (atual.ts || 0)) {
      players[j.name] = {
        aura: Math.max(0, Math.floor(j.aura || 0)),
        chips: normalizarChips(j.chips),
        ts: j.ts || 0
      };
    }
  }
  return players;
}

async function limparVersoes(nome, novoPath) {
  try {
    const blobs = await versoes(nome);
    const ordenados = blobs.slice().sort(function (a, b) {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
    const manter = new Set([novoPath]);
    for (const b of ordenados) {
      if (manter.size >= MAX_VERSOES) break;
      manter.add(b.pathname);
    }
    const apagar = ordenados.filter(function (b) { return !manter.has(b.pathname); });
    if (apagar.length) {
      await Promise.all(apagar.map(function (b) {
        return del(b.url, { storeId: STORE }).catch(function () {});
      }));
    }
  } catch (e) {}
}

async function gravar(nome, aura, chips) {
  const dados = {
    name: nome,
    aura: Math.max(0, Math.floor(aura)),
    chips: normalizarChips(chips),
    ts: Date.now()
  };

  // arquivo novo a cada gravacao: evita o cache de 60s do blob sobrescrito
  const pathname = PREFIX + encodeURIComponent(nome) + '-' + Date.now() + '-' +
    Math.random().toString(36).slice(2, 7) + '.json';

  const blob = await put(pathname, JSON.stringify(dados), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    storeId: STORE
  });

  await limparVersoes(nome, blob.pathname);
  return dados;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      res.status(200).json({ players: await lerTodos() });
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
      const blobs = await versoes(nome);
      await Promise.all(blobs.map(function (b) {
        return del(b.url, { storeId: STORE });
      }));
      res.status(200).json({ ok: true, removido: nome });
      return;
    }

    res.status(405).json({ error: 'metodo' });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};

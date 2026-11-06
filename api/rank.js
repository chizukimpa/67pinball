const { put, list, del } = require('@vercel/blob');

const STORE = process.env.BLOB_STORE_ID;
const PREFIX = 'players/';
const PRICES = [670, 1700, 3400, 6700, 10000, 16700, 67000, 100000, 2000000];

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

async function lerUm(nome) {
  const { blobs } = await list({ prefix: PREFIX + encodeURIComponent(nome) + '.json', storeId: STORE });
  if (!blobs || !blobs.length) return { aura: 0, chips: zeros() };
  try {
    const r = await fetch(blobs[0].url + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return { aura: 0, chips: zeros() };
    const j = await r.json();
    return { aura: Math.max(0, Math.floor(j.aura || 0)), chips: normalizarChips(j.chips) };
  } catch (e) {
    return { aura: 0, chips: zeros() };
  }
}

async function lerTodos() {
  const { blobs } = await list({ prefix: PREFIX, storeId: STORE, limit: 1000 });
  const players = {};
  await Promise.all((blobs || []).map(async function (b) {
    try {
      const r = await fetch(b.url + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.name) players[j.name] = { aura: j.aura || 0, chips: normalizarChips(j.chips), ts: j.ts || 0 };
    } catch (e) {}
  }));
  return players;
}

async function gravar(nome, aura, chips) {
  const dados = { name: nome, aura: Math.max(0, Math.floor(aura)), chips: normalizarChips(chips), ts: Date.now() };
  await put(PREFIX + encodeURIComponent(nome) + '.json', JSON.stringify(dados), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    cacheControlMaxAge: 60,
    storeId: STORE
  });
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
      if (body.buy !== undefined) {
        const i = Math.floor(Number(body.buy)) - 1;
        if (i >= 0 && i < 9 && !chips[i] && aura >= PRICES[i]) {
          aura -= PRICES[i];
          chips[i] = 1;
        }
      }

      const salvo = await gravar(nome, aura, chips);
      res.status(200).json({ ok: true, player: salvo });
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
      await del(PREFIX + encodeURIComponent(nome) + '.json', { storeId: STORE });
      res.status(200).json({ ok: true, removido: nome });
      return;
    }

    res.status(405).json({ error: 'metodo' });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
};

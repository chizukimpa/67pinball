const { put, list, del } = require('@vercel/blob');

const STORE = process.env.BLOB_STORE_ID;
const PREFIX = 'players/';

function limparNome(n) {
  return String(n || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 12).trim();
}

async function ler() {
  const { blobs } = await list({ prefix: PREFIX, storeId: STORE, limit: 1000 });
  const players = {};
  await Promise.all(blobs.map(async function (b) {
    try {
      const r = await fetch(b.url + '?v=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      if (j && j.name) players[j.name] = { aura: j.aura || 0, chips: j.chips || [], ts: j.ts || 0 };
    } catch (e) {}
  }));
  return players;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      res.status(200).json({ players: await ler() });
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

      const dados = {
        name: nome,
        aura: Math.max(0, Math.floor(Number(body.aura) || 0)),
        chips: (Array.isArray(body.chips) ? body.chips : []).slice(0, 8).map(function (v) { return v ? 1 : 0; }),
        ts: Date.now()
      };

      await put(PREFIX + encodeURIComponent(nome) + '.json', JSON.stringify(dados), {
        access: 'public',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
        cacheControlMaxAge: 60,
        storeId: STORE
      });

      res.status(200).json({ ok: true, player: dados });
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

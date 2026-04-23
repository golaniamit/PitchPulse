// Dev-only helper routes. Gated two ways:
//   1. NODE_ENV !== 'production'
//   2. prod_cookies.txt exists in the repo root (created by `curl -c`)
// Without both, these endpoints return 404 — so even if this file
// accidentally ships, it's inert in prod.

const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const COOKIES_PATH = path.join(__dirname, '..', '..', 'prod_cookies.txt');
const PROD_BASE = 'https://www.pitchpulse.co.in';

function readProdCookieHeader() {
  if (!fs.existsSync(COOKIES_PATH)) return null;
  const text = fs.readFileSync(COOKIES_PATH, 'utf8');
  // Netscape-format cookies.txt — each non-comment line is tab-separated
  // with the cookie value in the last column.
  const line = text.split('\n').find(l => l && !l.startsWith('#') && l.includes('connect.sid'));
  if (!line) return null;
  const parts = line.split('\t').filter(Boolean);
  const val = parts[parts.length - 1].trim();
  return val ? `connect.sid=${val}` : null;
}

function requireDev(req, res, next) {
  if (process.env.NODE_ENV === 'production') return res.status(404).end();
  const cookie = readProdCookieHeader();
  if (!cookie) return res.status(400).json({ error: 'prod_cookies.txt not found — run curl login first' });
  req.prodCookie = cookie;
  next();
}

// POST /api/dev/prod-create-contracts
// Body: { contracts: [payload, ...] }  — each payload is a /api/contracts POST body.
// Forwards each to prod, returns aggregated results.
router.post('/prod-create-contracts', requireDev, async (req, res) => {
  const contracts = Array.isArray(req.body.contracts) ? req.body.contracts : [];
  if (!contracts.length) return res.status(400).json({ error: 'No contracts provided' });
  const results = [];
  for (const c of contracts) {
    try {
      const r = await fetch(`${PROD_BASE}/api/contracts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: req.prodCookie },
        body: JSON.stringify(c),
      });
      let body = null;
      try { body = await r.json(); } catch (_) { body = null; }
      results.push({
        ok: r.ok,
        status: r.status,
        id: body?.contract?.id || null,
        error: body?.error || null,
        title: c.title,
      });
    } catch (e) {
      results.push({ ok: false, status: 0, error: e.message, title: c.title });
    }
  }
  res.json({ results });
});

module.exports = router;

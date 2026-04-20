const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');

const router = express.Router();

// Tiny endpoint — 10 rows. Cached on the client.
router.get('/', requireAuth, (req, res) => {
  const teams = db.prepare(`
    SELECT id, short_code, name, primary_colour, logo_path
    FROM teams
    ORDER BY short_code
  `).all();
  res.json({ teams });
});

module.exports = router;

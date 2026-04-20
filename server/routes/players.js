const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');
const { stripTags } = require('../sanitize');

const router = express.Router();

function slugify(name) {
  return String(name).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// GET /api/players?team_id=&q=
//   team_id: filter to one team's squad (from the picker)
//   q:       case-insensitive substring on name (search box)
router.get('/', requireAuth, (req, res) => {
  const { team_id, q } = req.query;
  const where = ['p.is_active = 1'];
  const params = [];
  if (team_id) { where.push('p.team_id = ?'); params.push(parseInt(team_id)); }
  if (q && q.trim()) { where.push('LOWER(p.name) LIKE ?'); params.push('%' + q.toLowerCase() + '%'); }

  const rows = db.prepare(`
    SELECT p.id, p.name, p.slug, p.team_id, p.role, p.headshot_path,
           t.short_code as team_short, t.primary_colour as team_colour, t.logo_path as team_logo
    FROM players p
    LEFT JOIN teams t ON t.id = p.team_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.name
    LIMIT 200
  `).all(...params);
  res.json({ players: rows });
});

// POST /api/players  (admin only) — used by the "+ Add player" tile in the
// create-contract form. Headshot upload isn't wired yet; admins can attach
// a path here directly (e.g. /players/foo.jpg) once the file is in place.
router.post('/', requireAdmin, (req, res) => {
  const { name, team_id, role, headshot_path } = req.body;
  const cleanName = stripTags(name || '').trim().slice(0, 100);
  if (!cleanName) return res.status(400).json({ error: 'Name required' });
  if (!team_id) return res.status(400).json({ error: 'team_id required' });

  const teamExists = db.prepare('SELECT 1 FROM teams WHERE id = ?').get(team_id);
  if (!teamExists) return res.status(400).json({ error: 'Unknown team_id' });

  const validRoles = ['batter', 'bowler', 'all-rounder', 'wk', null, undefined];
  const cleanRole = validRoles.includes(role) ? (role || null) : null;
  const cleanHead = headshot_path && typeof headshot_path === 'string'
    ? stripTags(headshot_path).slice(0, 200)
    : null;

  // Slugs need to be unique. If the same name already exists, suffix with team
  // short to disambiguate (rare but happens with common names).
  let slug = slugify(cleanName);
  const collision = db.prepare('SELECT 1 FROM players WHERE slug = ?').get(slug);
  if (collision) {
    const tShort = db.prepare('SELECT short_code FROM teams WHERE id = ?').get(team_id)?.short_code || 't' + team_id;
    slug = `${slug}-${tShort.toLowerCase()}`;
  }

  const result = db.prepare(`
    INSERT INTO players (name, slug, team_id, role, headshot_path, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(cleanName, slug, team_id, cleanRole, cleanHead);

  const player = db.prepare(`
    SELECT p.*, t.short_code as team_short, t.primary_colour as team_colour, t.logo_path as team_logo
    FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json({ player });
});

module.exports = router;

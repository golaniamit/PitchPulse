const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

const VALID_CATEGORIES = ['general', 'feature', 'contract', 'bug'];

// POST /api/feedback — any logged-in user submits feedback
router.post('/', requireAuth, (req, res) => {
  const { category, message } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message is required' });
  if (!VALID_CATEGORIES.includes(category)) return res.status(400).json({ error: 'Invalid category' });

  db.prepare(
    `INSERT INTO feedback (user_id, username, category, message) VALUES (?, ?, ?, ?)`
  ).run(req.session.userId, req.session.username, category, message.trim());

  res.json({ ok: true });
});

// GET /api/feedback — admin only: list all feedback newest first
router.get('/', requireAdmin, (req, res) => {
  const rows = db.prepare(
    `SELECT id, username, category, message, created_at FROM feedback ORDER BY created_at DESC`
  ).all();
  res.json(rows);
});

// DELETE /api/feedback/:id — admin can dismiss/delete a feedback entry
router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare(`DELETE FROM feedback WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;

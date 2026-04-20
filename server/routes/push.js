const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware');
const { pushToUser } = require('../engine/push');

const router = express.Router();

// Public VAPID key for the browser to subscribe with.
router.get('/public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

// Register / upsert a push subscription for the logged-in user.
router.post('/subscribe', requireAuth, (req, res) => {
  const { endpoint, keys } = req.body || {};
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return res.status(400).json({ error: 'Subscription missing endpoint or keys' });
  }
  // Upsert by endpoint so the same browser doesn't double-register after relogin.
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id
  `).run(req.session.userId, endpoint, keys.p256dh, keys.auth);
  res.json({ ok: true });
});

// Unsubscribe — removes a single browser install's subscription.
router.post('/unsubscribe', requireAuth, (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?')
    .run(endpoint, req.session.userId);
  res.json({ ok: true });
});

// Whether *this* user currently has any push subscription registered.
// Used by the UI to show "Enabled" vs "Enable notifications".
router.get('/status', requireAuth, (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as n FROM push_subscriptions WHERE user_id = ?').get(req.session.userId);
  res.json({ subscribed: row.n > 0 });
});

// Test endpoint — lets the user send themselves a ping to verify it works.
router.post('/test', requireAuth, async (req, res) => {
  await pushToUser(req.session.userId, {
    title: 'PitchPulse notifications are on 🎉',
    body: "You'll get a ping when your bets resolve.",
    url: '/portfolio',
  });
  res.json({ ok: true });
});

module.exports = router;

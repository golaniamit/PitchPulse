const db = require('./db');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.session.userId);
  if (!user || !user.is_admin) return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Sliding-window in-memory rate limiter keyed by userId (or IP as fallback).
// Returns middleware that allows `max` hits per `windowMs`.
// Small private app → an in-process Map is enough; on restart the window
// resets, which is fine.
function rateLimit({ windowMs, max, name = 'requests' }) {
  const hits = new Map(); // key -> array of timestamps (ms)
  return (req, res, next) => {
    const key = req.session?.userId ? `u:${req.session.userId}` : `ip:${req.ip}`;
    const now = Date.now();
    const arr = hits.get(key) || [];
    // Drop timestamps outside the window
    const cutoff = now - windowMs;
    const recent = arr.filter(t => t > cutoff);
    if (recent.length >= max) {
      const retryIn = Math.ceil((recent[0] + windowMs - now) / 1000);
      res.setHeader('Retry-After', retryIn);
      return res.status(429).json({ error: `Too many ${name} — slow down (retry in ${retryIn}s)` });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

module.exports = { requireAuth, requireAdmin, rateLimit };

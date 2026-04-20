const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../email');

const router = express.Router();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Register
router.post('/register', async (req, res) => {
  const { username, password, display_name, email } = req.body;

  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'A valid email address is required' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'Username must be 2–20 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  // Check email not already used
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (existingEmail) return res.status(409).json({ error: 'An account with this email already exists' });

  try {
    const hash = await bcrypt.hash(password, 10);
    const name = display_name?.trim() || null;
    const token = generateToken();
    const expires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    const stmt = db.prepare(
      `INSERT INTO users (username, password_hash, display_name, email, balance, is_verified, verify_token, verify_token_expires)
       VALUES (?, ?, ?, ?, 10000, 0, ?, ?)`
    );
    const result = stmt.run(username, hash, name, email.toLowerCase().trim(), token, expires);

    // Send verification email (non-blocking on failure — return error to client)
    await sendVerificationEmail({
      to: email.trim(),
      username,
      displayName: name,
      token,
    });

    res.json({ ok: true, requiresVerification: true, email: email.trim() });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(409).json({ error: 'Username already taken' });
    console.error('Register error:', err.message);
    res.status(500).json({ error: err.message.includes('Email send') ? 'Could not send verification email — check your address and try again' : 'Server error' });
  }
});

// Verify email
router.get('/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token missing' });

  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Invalid or already used verification link' });
  if (Date.now() > user.verify_token_expires) return res.status(400).json({ error: 'Verification link has expired — please register again' });

  db.prepare('UPDATE users SET is_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?').run(user.id);

  res.json({ ok: true, username: user.username });
});

// Resend verification email
router.post('/resend-verification', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(404).json({ error: 'No account found with that email' });
  if (user.is_verified) return res.status(400).json({ error: 'Account is already verified' });

  const token = generateToken();
  const expires = Date.now() + 24 * 60 * 60 * 1000;
  db.prepare('UPDATE users SET verify_token = ?, verify_token_expires = ? WHERE id = ?').run(token, expires, user.id);

  await sendVerificationEmail({ to: user.email, username: user.username, displayName: user.display_name, token });
  res.json({ ok: true });
});

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_bot = 0').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  if (!user.is_verified) {
    return res.status(403).json({
      error: 'Please verify your email before logging in',
      requiresVerification: true,
      email: user.email,
    });
  }

  req.session.userId = user.id;
  req.session.username = user.username;

  // Capture a balance snapshot once per day so we can show P&L today on the leaderboard.
  const today = new Date().toISOString().slice(0, 10);
  if (user.snapshot_date !== today) {
    db.prepare('UPDATE users SET balance_at_day_start = ?, snapshot_date = ? WHERE id = ?')
      .run(user.balance, today, user.id);
  }

  res.json({ user: { id: user.id, username: user.username, display_name: user.display_name, balance: user.balance, is_admin: user.is_admin, tour_seen: user.tour_seen, avatar_emoji: user.avatar_emoji } });
});

// Forgot password — send reset email
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  // Always respond ok — don't reveal whether email exists
  if (!user || user.is_bot) return res.json({ ok: true });

  const token = generateToken();
  const expires = Date.now() + 60 * 60 * 1000; // 1 hour
  db.prepare('UPDATE users SET reset_token = ?, reset_token_expires = ? WHERE id = ?').run(token, expires, user.id);

  try {
    await sendPasswordResetEmail({ to: user.email, username: user.username, token });
  } catch (err) {
    console.error('Reset email error:', err.message);
  }

  res.json({ ok: true });
});

// Reset password — consume token, set new password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password required' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Invalid or already used reset link' });
  if (Date.now() > user.reset_token_expires) return res.status(400).json({ error: 'Reset link has expired — please request a new one' });

  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?').run(hash, user.id);

  res.json({ ok: true });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// Me (current session)
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const user = db.prepare('SELECT id, username, display_name, balance, is_admin, tour_seen, avatar_emoji FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

// ---- Account settings ----
// Curated emoji pool users can pick from. Matches the migration seed list.
const AVATAR_POOL = ['🏏','🏆','🎯','🔥','⚡','🦁','🐘','🦅','🐯','🌟','💎','🚀','🦄','🐉','🦈','🦉','🐺','🐬','🦊','🐨'];

// Update display name and/or avatar
router.patch('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { display_name, avatar_emoji } = req.body || {};
  const updates = [];
  const params = [];
  if (typeof display_name === 'string') {
    const name = display_name.trim().slice(0, 40);
    updates.push('display_name = ?'); params.push(name || null);
  }
  if (typeof avatar_emoji === 'string' && avatar_emoji) {
    if (!AVATAR_POOL.includes(avatar_emoji)) return res.status(400).json({ error: 'Pick an emoji from the provided set' });
    updates.push('avatar_emoji = ?'); params.push(avatar_emoji);
  }
  if (updates.length === 0) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.session.userId);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const user = db.prepare('SELECT id, username, display_name, balance, is_admin, tour_seen, avatar_emoji FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user });
});

// Expose the emoji pool so the client can render a picker without duplicating the list
router.get('/avatar-pool', (req, res) => {
  res.json({ pool: AVATAR_POOL });
});

// Change password — requires current password
router.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { current, next } = req.body || {};
  if (!current || !next) return res.status(400).json({ error: 'Current and new password required' });
  if (next.length < 4) return res.status(400).json({ error: 'New password must be at least 4 characters' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  const ok = await bcrypt.compare(current, user.password_hash);
  if (!ok) return res.status(403).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(next, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  res.json({ ok: true });
});

// Delete account — requires typing the username as a safety guard.
// Keeps bot/admin accounts safe by rejecting if the caller is a bot.
router.delete('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { confirm_username } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  if (user.is_bot) return res.status(403).json({ error: 'Cannot delete a bot account' });
  if (confirm_username !== user.username) return res.status(400).json({ error: 'Type your username exactly to confirm deletion' });

  // Cascade delete: orders, positions, trades-referenced orders first.
  // Trades rows reference orders (buyer/seller_order_id) but not users directly —
  // leaving historical trades intact keeps global contract price history correct.
  const id = req.session.userId;
  db.prepare('DELETE FROM positions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM orders    WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM feedback  WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users     WHERE id = ?').run(id);

  req.session.destroy(() => res.json({ ok: true }));
});

// Mark tour as completed for the current user
router.post('/tour-complete', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  db.prepare('UPDATE users SET tour_seen = 1 WHERE id = ?').run(req.session.userId);
  res.json({ ok: true });
});

module.exports = router;

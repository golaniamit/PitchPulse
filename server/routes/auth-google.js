// Google sign-in routes. Kept separate from auth.js so the main email/password
// file stays readable. Uses passport-google-oauth20 ONLY for the OAuth dance —
// we do NOT use passport's session serialization. After Google confirms the
// user, we set req.session.userId ourselves so this slots into the existing
// express-session flow used everywhere else.

const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const db = require('../db');

const router = express.Router();

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// APP_URL is the public origin (set in .env). In dev it falls back to
// localhost:3001 so the callback matches what the dev server serves.
const APP_URL       = process.env.APP_URL || 'http://localhost:3001';
const CALLBACK_URL  = `${APP_URL}/api/auth/google/callback`;
// Where to send the user after the OAuth dance finishes. In dev the Vite
// client runs on :5173 and proxies /api through to the server, so we redirect
// to the client origin.
const CLIENT_ORIGIN = process.env.NODE_ENV === 'production'
  ? APP_URL
  : 'http://localhost:5173';

const GOOGLE_CONFIGURED = Boolean(CLIENT_ID && CLIENT_SECRET);

if (GOOGLE_CONFIGURED) {
  passport.use(new GoogleStrategy(
    {
      clientID: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      callbackURL: CALLBACK_URL,
    },
    // This function runs after Google confirms the user. Its job is to turn
    // Google's profile info into a row in our users table — either by finding
    // an existing match or by creating a brand-new account.
    (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const email = (profile.emails?.[0]?.value || '').toLowerCase().trim();
        const displayName = profile.displayName || null;

        // 1) Already linked? Log them straight in.
        let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
        if (user) return done(null, user);

        // 2) Existing email/password account with the same email? Link the
        //    Google ID to it so the user can use either method going forward.
        if (email) {
          const byEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
          if (byEmail) {
            db.prepare(`
              UPDATE users
                 SET google_id = ?, google_email = ?, is_verified = 1
               WHERE id = ?
            `).run(googleId, email, byEmail.id);
            user = db.prepare('SELECT * FROM users WHERE id = ?').get(byEmail.id);
            return done(null, user);
          }
        }

        // 3) Brand-new signup. Create the account with a placeholder username
        //    (they'll pick a real one on first login via the needs_username
        //    flag) and an empty password_hash. The login route rejects empty
        //    password_hash, so password login is impossible for these users
        //    until they set one via Settings → change password.
        const placeholderUsername = `google_${googleId.slice(0, 10)}_${crypto.randomBytes(3).toString('hex')}`;
        const result = db.prepare(`
          INSERT INTO users (
            username, password_hash, display_name, email, google_id, google_email,
            balance, is_verified, needs_username
          ) VALUES (?, '', ?, ?, ?, ?, 10000, 1, 1)
        `).run(placeholderUsername, displayName, email || null, googleId, email || null);

        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  ));
}

// Step 1 — user clicks "Continue with Google" on the login page. We bounce
// them over to Google's consent screen. If the server isn't configured with
// Google credentials yet, return a clear error instead of a cryptic crash.
router.get('/google', (req, res, next) => {
  if (!GOOGLE_CONFIGURED) {
    return res.status(503).send(
      'Google sign-in is not configured on this server. ' +
      'Ask the admin to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
    );
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false,        // we manage sessions ourselves via express-session
    prompt: 'select_account', // always show account chooser — nicer UX on shared devices
  })(req, res, next);
});

// Step 2 — Google redirects back to this URL with a short-lived code. Passport
// exchanges the code for the user's profile, our strategy callback above
// upserts the user row, and then we set our own session cookie and redirect
// the user back to the frontend.
router.get('/google/callback', (req, res, next) => {
  if (!GOOGLE_CONFIGURED) return res.redirect(`${CLIENT_ORIGIN}/?google=unconfigured`);

  passport.authenticate('google', { session: false }, (err, user) => {
    if (err || !user) {
      console.error('Google OAuth callback error:', err?.message || 'no user');
      return res.redirect(`${CLIENT_ORIGIN}/?google=failed`);
    }

    // Set the session cookie the same way /login does.
    req.session.userId = user.id;
    req.session.username = user.username;

    // Daily balance snapshot — mirrors the /login flow so leaderboard "today"
    // numbers stay accurate.
    const today = new Date().toISOString().slice(0, 10);
    if (user.snapshot_date !== today) {
      db.prepare('UPDATE users SET balance_at_day_start = ?, snapshot_date = ? WHERE id = ?')
        .run(user.balance, today, user.id);
    }

    // If this is a brand-new account the user still needs to pick a username.
    // The frontend reads user.needs_username from /api/auth/me and routes
    // accordingly, so all we do here is land them on the home page.
    return res.redirect(CLIENT_ORIGIN + '/');
  })(req, res, next);
});

module.exports = router;

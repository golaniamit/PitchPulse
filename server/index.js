require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const path = require('path');

const db = require('./db');
const ws = require('./websocket');
const { startBots } = require('./engine/bots');
const { startResolver } = require('./engine/cricbuzz-resolver');

const authRoutes = require('./routes/auth');
const authGoogleRoutes = require('./routes/auth-google');
const contractRoutes = require('./routes/contracts');
const orderRoutes = require('./routes/orders');
const userRoutes = require('./routes/users');
const adminRoutes = require('./routes/admin');
const feedbackRoutes = require('./routes/feedback');
const pushRoutes = require('./routes/push');
const teamRoutes = require('./routes/teams');
const playerRoutes = require('./routes/players');
const devHelperRoutes = require('./routes/dev-helpers');

const app = express();
const server = http.createServer(app);

// Middleware
const allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.APP_URL].filter(Boolean)
  : ['http://localhost:5173'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json());
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
});
app.use(sessionMiddleware);

// Passport is only used for the Google OAuth dance. We do not rely on its
// session serialization — express-session still owns the logged-in state.
app.use(passport.initialize());

// Routes. Both routers share the /api/auth prefix but expose disjoint paths
// (google.* vs login/register/me/...) so order between them doesn't matter.
app.use('/api/auth', authGoogleRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/matches', require('./routes/matches'));
app.use('/api/players', playerRoutes);
app.use('/api/groups', require('./routes/groups'));
app.use('/api/dev', devHelperRoutes);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Auto-create admin on first boot if no users exist
async function ensureAdmin() {
  const count = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_bot = 0').get();
  if (count.c === 0) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, balance, is_admin, is_verified) VALUES (?, ?, ?, 1, 1)')
      .run('admin', hash, 10000);
    console.log('✅ Admin account created: admin / admin123 — change password after first login');
  }
}
ensureAdmin().catch(console.error);

// WebSocket
ws.init(server, sessionMiddleware);

// Start bots — actual activity is controlled by the bots_intensity admin setting.
startBots();
startResolver();

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`IPL Market server running on http://localhost:${PORT}`);
});

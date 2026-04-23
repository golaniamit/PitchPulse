// Group-context helpers — centralises every place the balance / membership /
// visibility logic differs between "public marketplace" and "inside a friends
// group". Keeps the rest of the server free of `if (groupId) ...` branches.
//
// Pattern:
//   - Read `req.groupId` (int | null) set by resolveContext middleware.
//   - readBalance / adjustBalance operate on the correct column (users.balance
//     or group_members.balance) based on groupId.
//   - requireGroupMember + requireGroupAdmin enforce access.

const db = require('../db');

// Parse the client-supplied group context from query string or header and
// verify membership. Attaches req.groupId (int | null) for downstream handlers.
// - ?group=<id> or x-group-id header
// - ?group=0 or absent = public
// - If user is not a member of the requested group → 403.
function resolveContext(req, res, next) {
  const raw = req.query.group ?? req.headers['x-group-id'];
  if (raw == null || raw === '' || raw === '0') {
    req.groupId = null;
    return next();
  }
  const gid = parseInt(raw, 10);
  if (!Number.isInteger(gid) || gid <= 0) {
    req.groupId = null;
    return next();
  }
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  const member = db.prepare(
    'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(gid, req.session.userId);
  if (!member) {
    return res.status(403).json({ error: 'Not a member of this group' });
  }
  req.groupId = gid;
  req.groupRole = member.role;
  next();
}

// Must be inside a group. 400 if context is public.
function requireGroup(req, res, next) {
  if (!req.groupId) return res.status(400).json({ error: 'Group context required' });
  next();
}

// Must be the admin of the currently-selected group. Group admin ≠ public admin
// (users.is_admin) — each group has its own admin independent of global role.
function requireGroupAdmin(req, res, next) {
  if (!req.groupId) return res.status(400).json({ error: 'Group context required' });
  if (req.groupRole !== 'admin') return res.status(403).json({ error: 'Group admin access required' });
  next();
}

// Read the current user's balance in the given context. For public (groupId =
// null), reads users.balance; for a group, reads group_members.balance.
function readBalance(userId, groupId) {
  if (!groupId) {
    const r = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId);
    return r ? r.balance : 0;
  }
  const r = db.prepare(
    'SELECT balance FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId);
  return r ? r.balance : 0;
}

// Atomic balance adjustment. `delta` can be negative (locking an order's cost)
// or positive (refund / payout). Returns the new balance, or null if the
// user isn't a member of the target group.
//
// Previously this threw when the group_members row was missing. That broke
// settlement paths for contracts where a member had left between placing
// their position and resolution. Instead we now log + skip — the coins the
// departing member had locked are considered forfeited (consistent with our
// leave/kick contract), and the caller's loop moves on to the next user.
// The leave/kick handlers in routes/groups.js proactively cancel orders and
// delete positions on exit so this path shouldn't typically fire, but it's
// there as a safety net.
function adjustBalance(userId, groupId, delta) {
  if (!groupId) {
    db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(delta, userId);
    return db.prepare('SELECT balance FROM users WHERE id = ?').get(userId)?.balance ?? 0;
  }
  const r = db.prepare(
    'UPDATE group_members SET balance = balance + ? WHERE group_id = ? AND user_id = ?'
  ).run(delta, groupId, userId);
  if (r.changes === 0) {
    console.warn(`[context] adjustBalance: user ${userId} not a member of group ${groupId} — skipping (forfeit ${delta})`);
    return null;
  }
  return db.prepare(
    'SELECT balance FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId).balance;
}

// Given a contract id, return its group context (null for public). Hot path for
// order placement, cancellation, settlement — called a LOT so kept to one SELECT.
function groupIdForContract(contractId) {
  const r = db.prepare('SELECT group_id FROM contracts WHERE id = ?').get(contractId);
  return r?.group_id ?? null;
}

// Is the given user a member of the given group?
function isMember(userId, groupId) {
  if (!groupId) return true; // public marketplace = everyone
  const r = db.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(groupId, userId);
  return !!r;
}

// Generate a random invite code for a group. Short enough to share verbally,
// long enough to be unguessable. Format: adjective-animal-NNNN.
// Collision check is cheap because `invite_code` has a UNIQUE index.
const ADJ = ['happy','sunny','brave','clever','quick','rowdy','sleepy','wild','witty','jolly','fierce','calm','proud','sneaky','mighty'];
const ANI = ['tiger','panda','eagle','lion','wolf','otter','shark','hawk','falcon','cobra','bison','jaguar','dragon','moose','owl'];
function generateInviteCode() {
  for (let i = 0; i < 20; i++) {
    const a = ADJ[Math.floor(Math.random() * ADJ.length)];
    const n = ANI[Math.floor(Math.random() * ANI.length)];
    const d = Math.floor(1000 + Math.random() * 9000);
    const code = `${a}-${n}-${d}`;
    const exists = db.prepare('SELECT 1 FROM groups WHERE invite_code = ?').get(code);
    if (!exists) return code;
  }
  // Fallback — shouldn't happen with 15*15*9000 = 2M combinations
  return `grp-${Date.now().toString(36)}`;
}

module.exports = {
  resolveContext,
  requireGroup,
  requireGroupAdmin,
  readBalance,
  adjustBalance,
  groupIdForContract,
  isMember,
  generateInviteCode,
};

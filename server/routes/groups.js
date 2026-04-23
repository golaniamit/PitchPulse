// Friends-groups API. Every endpoint that reads / writes inside a specific
// group passes through resolveContext → requireGroup[Admin] so we never
// leak across groups.

const express = require('express');
const db = require('../db');
const { requireAuth, rateLimit } = require('../middleware');
const { stripTags } = require('../sanitize');
const { broadcast } = require('../websocket');
const {
  resolveContext, requireGroup, requireGroupAdmin,
  generateInviteCode, adjustBalance,
} = require('../lib/context');

// When a member leaves or is kicked from a group, their open orders and
// positions need to be wiped — otherwise (a) orders sit open on contracts
// waiting to be matched against a user whose wallet no longer exists,
// crashing settle/trade paths, and (b) positions payout on resolution
// tries to credit a deleted group_members row and throws.
//
// The forfeit rule is by design: leaving or being kicked means you lose
// your group-scoped coins entirely — both the free balance AND anything
// locked in orders or held in positions. Consistent with how we treat
// balance forfeit in the UI confirm.
function wipeMemberActivityInGroup(groupId, userId) {
  // Cancel (not refund) all open/partial orders by this user on any
  // contract in the group. Refunding would credit a row we're about to
  // delete — cleaner to mark cancelled and let the locked coins stay
  // forfeited along with the wallet.
  const affected = db.prepare(`
    SELECT DISTINCT o.contract_id
    FROM orders o JOIN contracts c ON c.id = o.contract_id
    WHERE o.user_id = ? AND c.group_id = ? AND o.status IN ('open','partial')
  `).all(userId, groupId);
  db.prepare(`
    UPDATE orders SET status = 'cancelled'
    WHERE user_id = ?
      AND status IN ('open','partial')
      AND contract_id IN (SELECT id FROM contracts WHERE group_id = ?)
  `).run(userId, groupId);
  // Delete positions — the payout would go to a non-existent wallet.
  db.prepare(`
    DELETE FROM positions
    WHERE user_id = ?
      AND contract_id IN (SELECT id FROM contracts WHERE group_id = ?)
  `).run(userId, groupId);
  return affected.map(r => r.contract_id);
}

const router = express.Router();

// Upper bound on group size. 50 keeps groups "friends-sized" — past that, a
// private market starts to behave like a mini public marketplace.
const MAX_GROUP_MEMBERS = 50;

// Rate limits — block trivial abuse without being in the way of real use.
const createLimiter = rateLimit({ windowMs: 60_000, max: 3,  name: 'group-create' });
const joinLimiter   = rateLimit({ windowMs: 60_000, max: 10, name: 'group-join'   });

// POST /api/groups — create a new group. Creator is auto-added as admin and
// gets the group's starting_coins as their opening balance.
router.post('/', requireAuth, createLimiter, (req, res) => {
  const name = stripTags(String(req.body?.name || '')).trim().slice(0, 60);
  let starting = parseInt(req.body?.starting_coins, 10);
  if (!name) return res.status(400).json({ error: 'Group name required' });
  if (!Number.isInteger(starting) || starting < 100 || starting > 10_000_000) {
    return res.status(400).json({ error: 'Starting coins must be between 100 and 10,000,000' });
  }

  const code = generateInviteCode();
  const tx = db.transaction(() => {
    const ins = db.prepare(`
      INSERT INTO groups (name, creator_id, invite_code, starting_coins)
      VALUES (?, ?, ?, ?)
    `).run(name, req.session.userId, code, starting);
    const groupId = ins.lastInsertRowid;
    // Creator joins as admin with full starting balance and notifications ON
    // by default — they'll expect to see what's happening in their own group.
    db.prepare(`
      INSERT INTO group_members (group_id, user_id, role, balance, notify_enabled)
      VALUES (?, ?, 'admin', ?, 1)
    `).run(groupId, req.session.userId, starting);
    return groupId;
  });
  const groupId = tx();
  const group = getGroupDetail(groupId, req.session.userId);
  res.status(201).json({ group });
});

// GET /api/groups/mine — list all groups the current user belongs to, plus
// their per-group balance. Used by the switcher chip dropdown.
router.get('/mine', requireAuth, (req, res) => {
  const rows = db.prepare(`
    SELECT g.id, g.name, g.invite_code, g.starting_coins, g.created_at,
           gm.role, gm.balance, gm.balance_at_day_start, gm.snapshot_date,
           gm.notify_enabled,
           (SELECT COUNT(*) FROM group_members x WHERE x.group_id = g.id) as member_count,
           (SELECT COUNT(*) FROM contracts c WHERE c.group_id = g.id) as contract_count
    FROM groups g
    JOIN group_members gm ON gm.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY g.created_at DESC
  `).all(req.session.userId);
  res.json({ groups: rows });
});

// GET /api/groups/peek/:code — public (auth-gated but no-membership) preview of
// a group from its invite link. Returns JUST enough to render the join page.
// Does NOT require being a member; does NOT leak sensitive data.
router.get('/peek/:code', requireAuth, (req, res) => {
  const code = String(req.params.code || '').toLowerCase();
  const g = db.prepare(`
    SELECT g.id, g.name, g.starting_coins,
           u.username as creator_username, u.display_name as creator_display_name,
           (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) as member_count,
           (SELECT COUNT(*) FROM contracts c WHERE c.group_id = g.id) as contract_count
    FROM groups g
    LEFT JOIN users u ON u.id = g.creator_id
    WHERE g.invite_code = ?
  `).get(code);
  if (!g) return res.status(404).json({ error: 'Group not found' });

  const alreadyMember = !!db.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(g.id, req.session.userId);

  // Small member-avatar preview — initials + emoji only, no balance leak.
  const members = db.prepare(`
    SELECT u.username, u.display_name, u.avatar_emoji
    FROM group_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.joined_at ASC
    LIMIT 6
  `).all(g.id);

  res.json({ group: { ...g, already_member: alreadyMember, members_preview: members } });
});

// POST /api/groups/join — join via invite code. Adds the user as a member and
// credits them the group's starting_coins. Idempotent: if already a member,
// no-ops and returns the group.
router.post('/join', requireAuth, joinLimiter, (req, res) => {
  const code = String(req.body?.invite_code || '').toLowerCase();
  if (!code) return res.status(400).json({ error: 'invite_code required' });
  const group = db.prepare('SELECT * FROM groups WHERE invite_code = ?').get(code);
  if (!group) return res.status(404).json({ error: 'Invalid invite code' });

  const existing = db.prepare(
    'SELECT id FROM group_members WHERE group_id = ? AND user_id = ?'
  ).get(group.id, req.session.userId);
  if (!existing) {
    // Enforce member cap — friend groups top out at MAX_GROUP_MEMBERS.
    const count = db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id = ?').get(group.id).c;
    if (count >= MAX_GROUP_MEMBERS) {
      return res.status(400).json({ error: `Group is full (${MAX_GROUP_MEMBERS} max). Ask the admin to remove someone first.` });
    }
    // notify_enabled defaults to 0 (OFF); members opt in from the client if
    // they want push/toast.
    const wantsNotify = !!req.body?.notify_enabled;
    db.prepare(`
      INSERT INTO group_members (group_id, user_id, role, balance, notify_enabled)
      VALUES (?, ?, 'member', ?, ?)
    `).run(group.id, req.session.userId, group.starting_coins, wantsNotify ? 1 : 0);
  }
  res.json({ group: getGroupDetail(group.id, req.session.userId) });
});

// GET /api/groups/:id — detail for a group the user belongs to. Includes
// member list with balances + P&L. Admin-only extras (invite link, delete)
// are gated by role on the client.
router.get('/:id', requireAuth, resolveContext, requireGroup, (req, res) => {
  if (req.groupId !== parseInt(req.params.id, 10)) {
    return res.status(400).json({ error: 'Group id mismatch' });
  }
  res.json({ group: getGroupDetail(req.groupId, req.session.userId) });
});

// GET /api/groups/:id/leaderboard — ranked members. Same shape as the public
// leaderboard so the existing Leaderboard.jsx page can reuse its UI.
router.get('/:id/leaderboard', requireAuth, resolveContext, requireGroup, (req, res) => {
  const period = req.query.period === 'today' ? 'today' : 'all';
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_emoji,
           gm.balance,
           gm.role,
           (gm.balance - (SELECT starting_coins FROM groups WHERE id = gm.group_id)) as pnl_all,
           CASE WHEN gm.snapshot_date = ? THEN gm.balance - COALESCE(gm.balance_at_day_start, gm.balance) ELSE 0 END as pnl_today,
           (SELECT COUNT(*) FROM trades t
              JOIN orders o ON (t.buyer_order_id = o.id OR t.seller_order_id = o.id)
              JOIN contracts c ON c.id = o.contract_id
             WHERE o.user_id = u.id AND c.group_id = gm.group_id) as trade_count
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(today, req.groupId);
  const key = period === 'today' ? 'pnl_today' : 'balance';
  rows.sort((a, b) => b[key] - a[key]);
  res.json({ leaderboard: rows, period });
});

// POST /api/groups/:id/leave — leave a group. The admin cannot leave (must
// delete the group or transfer admin first). Remaining group balance,
// anything locked in open orders, and any held positions are ALL forfeited —
// per-group coins don't follow the user out.
router.post('/:id/leave', requireAuth, resolveContext, requireGroup, (req, res) => {
  if (req.groupRole === 'admin') {
    return res.status(400).json({ error: "Group admin can't leave — delete the group instead" });
  }
  const tx = db.transaction(() => {
    const affectedContracts = wipeMemberActivityInGroup(req.groupId, req.session.userId);
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
      .run(req.groupId, req.session.userId);
    return affectedContracts;
  });
  const affected = tx();
  // Nudge the order books on any contracts this user had orders on so
  // other members' UIs update.
  const { getOrderBook } = require('../engine/orderBook');
  for (const cid of affected) {
    const book = getOrderBook(cid);
    broadcast({ type: 'orderbook_update', contractId: cid, bids: book.bids, asks: book.asks, groupId: req.groupId });
  }
  res.json({ ok: true });
});

// DELETE /api/groups/:id — admin only. Removes members + all group contracts
// (cascade). This is destructive; UI confirms twice.
router.delete('/:id', requireAuth, resolveContext, requireGroupAdmin, (req, res) => {
  const gid = req.groupId;
  const tx = db.transaction(() => {
    // Wipe contract artifacts that cascade on contract_id
    const contracts = db.prepare('SELECT id FROM contracts WHERE group_id = ?').all(gid).map(r => r.id);
    for (const cid of contracts) {
      db.prepare('DELETE FROM positions WHERE contract_id = ?').run(cid);
      db.prepare('DELETE FROM orders WHERE contract_id = ?').run(cid);
      db.prepare('DELETE FROM trades WHERE contract_id = ?').run(cid);
      db.prepare('DELETE FROM price_history WHERE contract_id = ?').run(cid);
    }
    db.prepare('DELETE FROM contracts WHERE group_id = ?').run(gid);
    db.prepare('DELETE FROM group_members WHERE group_id = ?').run(gid);
    db.prepare('DELETE FROM groups WHERE id = ?').run(gid);
  });
  tx();
  res.json({ ok: true });
});

// POST /api/groups/:id/regenerate-code — admin only. Rotates the invite link
// if it leaked or the admin just wants a fresh one.
router.post('/:id/regenerate-code', requireAuth, resolveContext, requireGroupAdmin, (req, res) => {
  const newCode = generateInviteCode();
  db.prepare('UPDATE groups SET invite_code = ? WHERE id = ?').run(newCode, req.groupId);
  res.json({ invite_code: newCode });
});

// PATCH /api/groups/:id — rename the group. Admin only; other fields are
// deliberately not editable (changing starting_coins mid-season would break
// fairness, and creator_id is decided at creation + managed via /transfer-admin).
router.patch('/:id', requireAuth, resolveContext, requireGroupAdmin, (req, res) => {
  const name = stripTags(String(req.body?.name || '')).trim().slice(0, 60);
  if (!name) return res.status(400).json({ error: 'Group name required' });
  db.prepare('UPDATE groups SET name = ? WHERE id = ?').run(name, req.groupId);
  res.json({ group: getGroupDetail(req.groupId, req.session.userId) });
});

// DELETE /api/groups/:id/members/:userId — admin kicks a member. Admin can't
// kick themselves (use transfer-admin first, then leave). Kicked member
// forfeits their group balance, any locked-in orders, and any held
// positions — same wipe behaviour as voluntary leave.
router.delete('/:id/members/:userId', requireAuth, resolveContext, requireGroupAdmin, (req, res) => {
  const targetId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Bad userId' });
  if (targetId === req.session.userId) {
    return res.status(400).json({ error: "You can't kick yourself — transfer admin or delete the group instead" });
  }
  const m = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.groupId, targetId);
  if (!m) return res.status(404).json({ error: 'Not a member' });
  if (m.role === 'admin') return res.status(400).json({ error: 'Cannot kick another admin' });

  const tx = db.transaction(() => {
    const affectedContracts = wipeMemberActivityInGroup(req.groupId, targetId);
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(req.groupId, targetId);
    return affectedContracts;
  });
  const affected = tx();
  const { getOrderBook } = require('../engine/orderBook');
  for (const cid of affected) {
    const book = getOrderBook(cid);
    broadcast({ type: 'orderbook_update', contractId: cid, bids: book.bids, asks: book.asks, groupId: req.groupId });
  }
  res.json({ ok: true });
});

// POST /api/groups/:id/members/:userId/transfer-admin — hand over admin role.
// The current admin demotes to 'member'; the target is promoted to 'admin'.
// One admin at a time for v1 simplicity.
router.post('/:id/members/:userId/transfer-admin', requireAuth, resolveContext, requireGroupAdmin, (req, res) => {
  const targetId = parseInt(req.params.userId, 10);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'Bad userId' });
  if (targetId === req.session.userId) {
    return res.status(400).json({ error: "You're already the admin" });
  }
  const target = db.prepare('SELECT id FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.groupId, targetId);
  if (!target) return res.status(404).json({ error: 'Target is not a member' });
  const tx = db.transaction(() => {
    db.prepare("UPDATE group_members SET role = 'member' WHERE group_id = ? AND user_id = ?")
      .run(req.groupId, req.session.userId);
    db.prepare("UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id = ?")
      .run(req.groupId, targetId);
    // Also transfer creator_id so the UI's "admin" badge on the dropdown
    // reflects the right person going forward.
    db.prepare('UPDATE groups SET creator_id = ? WHERE id = ?').run(targetId, req.groupId);
  });
  tx();
  res.json({ group: getGroupDetail(req.groupId, req.session.userId) });
});

// POST /api/groups/:id/notify — toggle notification opt-in for the current
// member. Sets group_members.notify_enabled. Not admin-only — every member
// controls their own.
router.post('/:id/notify', requireAuth, resolveContext, requireGroup, (req, res) => {
  const enabled = !!req.body?.enabled;
  db.prepare('UPDATE group_members SET notify_enabled = ? WHERE group_id = ? AND user_id = ?')
    .run(enabled ? 1 : 0, req.groupId, req.session.userId);
  res.json({ ok: true, notify_enabled: enabled });
});

// POST /api/groups/:id/reset-season — admin resets the group for a fresh
// round. Resolves all active contracts as cancelled (refunds are a no-op
// since balances are reset), wipes pending orders, archives positions, and
// credits every member back to the group's starting_coins. Resolved contract
// history is preserved with the previous round_number stamped so members can
// audit old seasons. This is destructive; UI confirms twice.
router.post('/:id/reset-season', requireAuth, resolveContext, requireGroupAdmin, (req, res) => {
  const gid = req.groupId;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(gid);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  const newRound = (group.current_round || 1) + 1;

  const tx = db.transaction(() => {
    // Cancel any still-active contracts so members can't keep trading them
    // across the reset boundary.
    const actives = db.prepare("SELECT id FROM contracts WHERE group_id = ? AND status = 'active'").all(gid);
    for (const c of actives) {
      db.prepare("UPDATE contracts SET status = 'cancelled' WHERE id = ?").run(c.id);
      db.prepare("UPDATE orders SET status = 'cancelled' WHERE contract_id = ? AND status IN ('open', 'partial')").run(c.id);
      db.prepare('DELETE FROM positions WHERE contract_id = ?').run(c.id);
    }
    // Wipe any stragglers (draft contracts, positions not attached to
    // cancelled contracts above) — we want a clean slate.
    const allGroupContracts = db.prepare('SELECT id FROM contracts WHERE group_id = ?').all(gid).map(x => x.id);
    for (const cid of allGroupContracts) {
      db.prepare('DELETE FROM positions WHERE contract_id = ?').run(cid);
    }
    // Everyone's balance resets to the group's starting_coins.
    db.prepare(`
      UPDATE group_members
         SET balance = ?, balance_at_day_start = NULL, snapshot_date = NULL
       WHERE group_id = ?
    `).run(group.starting_coins, gid);
    // Bump the round counter + stamp all existing contracts with the round
    // they belonged to (so the leaderboard / history can filter by round
    // later if we want a "Season 1 archive" view).
    db.prepare('UPDATE contracts SET round_number = ? WHERE group_id = ? AND round_number IS NULL').run(group.current_round || 1, gid);
    db.prepare('UPDATE groups SET current_round = ? WHERE id = ?').run(newRound, gid);
  });
  tx();
  // Let all members' clients know to refresh.
  broadcast({ type: 'group_reset', groupId: gid, round: newRound });
  res.json({ ok: true, round: newRound });
});

// GET /api/groups/:id/activity — derived activity feed. Pulls events from
// existing tables (group_members.joined_at, contracts.created_at +
// resolved_at, trades) and returns them chronologically. No new events table
// — makes the feed feel live without burning a write on every trade.
router.get('/:id/activity', requireAuth, resolveContext, requireGroup, (req, res) => {
  const gid = req.groupId;
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);

  // Pull each event type, tag with a uniform shape, then merge + sort.
  const joins = db.prepare(`
    SELECT 'join' as kind, u.id as user_id, u.username, u.display_name, u.avatar_emoji,
           gm.joined_at as ts, NULL as contract_id, NULL as contract_title,
           NULL as resolution, NULL as qty, NULL as price, NULL as side, NULL as pnl
    FROM group_members gm JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
  `).all(gid);

  // Activity is a members-facing timeline — only surface contracts that have
  // actually been published (or subsequently resolved). Drafts and cancelled
  // contracts are admin-facing housekeeping and would just clutter the feed.
  const contractsCreated = db.prepare(`
    SELECT 'contract_created' as kind, c.created_by as user_id,
           u.username, u.display_name, u.avatar_emoji,
           c.created_at as ts, c.id as contract_id, c.title as contract_title,
           NULL as resolution, NULL as qty, NULL as price, NULL as side, NULL as pnl
    FROM contracts c LEFT JOIN users u ON u.id = c.created_by
    WHERE c.group_id = ? AND c.status IN ('active', 'resolved')
  `).all(gid);

  const resolutions = db.prepare(`
    SELECT 'resolution' as kind, NULL as user_id,
           NULL as username, NULL as display_name, NULL as avatar_emoji,
           c.resolved_at as ts, c.id as contract_id, c.title as contract_title,
           c.resolution, NULL as qty, NULL as price, NULL as side, NULL as pnl
    FROM contracts c
    WHERE c.group_id = ? AND c.status = 'resolved' AND c.resolved_at IS NOT NULL
  `).all(gid);

  // Trades: join the buyer/seller orders to attribute one event per side.
  // Limit at source to keep payload sane on busy groups.
  const trades = db.prepare(`
    SELECT t.id as t_id,
           t.executed_at as ts, t.price, t.quantity as qty, t.contract_id,
           c.title as contract_title,
           ob.user_id as buyer_id, ub.username as buyer_username,
           ub.display_name as buyer_display, ub.avatar_emoji as buyer_emoji,
           os.user_id as seller_id, us.username as seller_username,
           us.display_name as seller_display, us.avatar_emoji as seller_emoji
    FROM trades t
    JOIN contracts c ON c.id = t.contract_id AND c.group_id = ?
    JOIN orders ob ON ob.id = t.buyer_order_id
    JOIN users ub ON ub.id = ob.user_id
    JOIN orders os ON os.id = t.seller_order_id
    JOIN users us ON us.id = os.user_id
    ORDER BY t.executed_at DESC
    LIMIT 50
  `).all(gid);
  const tradeEvents = [];
  for (const t of trades) {
    // One event per side — YES buyer + NO buyer.
    tradeEvents.push({
      kind: 'trade', user_id: t.buyer_id, username: t.buyer_username,
      display_name: t.buyer_display, avatar_emoji: t.buyer_emoji,
      ts: t.ts, contract_id: t.contract_id, contract_title: t.contract_title,
      side: 'YES', price: t.price, qty: t.qty,
    });
    tradeEvents.push({
      kind: 'trade', user_id: t.seller_id, username: t.seller_username,
      display_name: t.seller_display, avatar_emoji: t.seller_emoji,
      ts: t.ts, contract_id: t.contract_id, contract_title: t.contract_title,
      side: 'NO', price: 100 - t.price, qty: t.qty,
    });
  }

  const all = [...joins, ...contractsCreated, ...resolutions, ...tradeEvents]
    .filter(e => e.ts)
    .sort((a, b) => (new Date(b.ts + 'Z').getTime()) - (new Date(a.ts + 'Z').getTime()))
    .slice(0, limit);
  res.json({ activity: all });
});

// GET /api/groups/:id/live-score — group-scoped live score. Looks at the
// group's active contracts, picks the most-referenced match_id, and returns
// that match's current score so the Navbar ticker can show the match the
// group is actually trading on (instead of whatever the public admin set).
// Falls back to { available: false } if nothing matches.
router.get('/:id/live-score', requireAuth, resolveContext, requireGroup, async (req, res) => {
  const rows = db.prepare(`
    SELECT match_id, COUNT(*) as c FROM contracts
    WHERE group_id = ? AND status = 'active' AND match_id IS NOT NULL AND match_id != ''
    GROUP BY match_id ORDER BY c DESC LIMIT 1
  `).all(req.groupId);
  if (rows.length === 0) return res.json({ available: false });
  const matchId = rows[0].match_id;

  try {
    const { fetchMatch } = require('../engine/cricbuzz');
    const m = await fetchMatch(matchId);
    const score = (m.innings || []).map(inn => ({
      inning: inn.batTeamName || `Inn${inn.inningsId}`,
      r: inn.score, w: inn.wickets,
      o: typeof inn.overs === 'number' ? inn.overs.toFixed(1) : inn.overs,
    }));
    const matchName = (m.teams || []).map(t => t.shortName || t.name).filter(Boolean).join(' vs ');
    const matchEnded = /complete|finish/i.test(m.state || m.status || '');
    res.json({
      available: true,
      matchId, matchName,
      status: m.status,
      state: m.state,
      matchEnded,
      score,
    });
  } catch (e) {
    res.json({ available: false, error: e.message });
  }
});

// POST /api/groups/:id/bulk-contracts — template bundle. Generates fully-
// formed, auto-resolvable contracts (team_id + condition_json + subject_kind
// all filled in) by fetching the match's real teams from Cricbuzz and
// plugging them into pre-defined recipes. The result is identical to what
// the admin would get by clicking through the step-by-step builder.
router.post('/:id/bulk-contracts', requireAuth, resolveContext, requireGroupAdmin, async (req, res) => {
  const { template, match_id } = req.body || {};
  if (!TEMPLATES[template]) return res.status(400).json({ error: 'Unknown template' });
  if (!match_id) return res.status(400).json({ error: 'match_id required' });

  // Resolve the two teams for this match by short-code → DB id lookup.
  // Without this the drafts would be un-editable (team_id null) and the
  // resolver wouldn't know which team to evaluate.
  //
  // Bias logic:
  //   - Before 1st innings ends → scoring contracts favour the team that
  //     bats first (they're "setting the target"). Pre-toss we fall back
  //     to an even split.
  //   - Once 1st innings has ended, the chaser's runs/wickets are the live
  //     question. Shift the bias to the 2nd-batting team so scoring
  //     contracts track the chase.
  //
  // battingFirst/battingSecond are tracked independently of teamA/teamB so
  // `innings_score` recipes can pin the correct (team, innings-number)
  // pair regardless of which side the bias points at.
  let teamA = null, teamB = null, biasTeamShort = null;
  let battingFirst = null, battingSecond = null;
  try {
    const { fetchMatch } = require('../engine/cricbuzz');
    const m = await fetchMatch(String(match_id));
    const shorts = (m.teams || []).map(t => t.shortName).filter(Boolean);
    if (shorts.length !== 2) {
      return res.status(400).json({ error: 'Could not read both teams for this match from Cricbuzz' });
    }
    const rows = db.prepare(
      `SELECT id, short_code FROM teams WHERE short_code IN (${shorts.map(() => '?').join(',')})`
    ).all(...shorts);
    teamA = rows.find(r => r.short_code === shorts[0]);
    teamB = rows.find(r => r.short_code === shorts[1]);
    if (!teamA || !teamB) {
      return res.status(400).json({ error: `Unknown teams: ${shorts.join(' vs ')}. Check your teams seed.` });
    }

    // Small helper — map a Cricbuzz team identifier (short code or full
    // name) to our team short_code, using the already-fetched rows + a
    // name-based fallback for the full-name case.
    function resolveShort(whichever) {
      if (!whichever) return null;
      const hit = rows.find(r => r.short_code === whichever || r.short_code.toLowerCase() === String(whichever).toLowerCase());
      if (hit) return hit.short_code;
      const byName = db.prepare('SELECT short_code FROM teams WHERE name = ?').get(whichever);
      return byName?.short_code || null;
    }

    const inns = Array.isArray(m.innings) ? m.innings : [];
    const curInn = m.current?.inningsId;
    const firstInningsDone =
      inns.length >= 2 ||
      curInn === 2 ||
      /2nd innings|innings break|chase|need \d+/i.test(String(m.status || ''));

    // Step 1: determine batting order (independent of where the bias points).
    let firstShort = null;
    if (inns[0]?.batTeamName) {
      firstShort = resolveShort(inns[0].batTeamName);
    } else if (m.toss?.tossWinnerName && m.toss?.decision) {
      const winnerShort = resolveShort(m.toss.tossWinnerName) ||
        (m.toss.tossWinnerName.includes(teamA.short_code) ? teamA.short_code : null) ||
        (m.toss.tossWinnerName.includes(teamB.short_code) ? teamB.short_code : null);
      if (winnerShort) {
        if (/bat/i.test(m.toss.decision)) firstShort = winnerShort;
        else if (/bowl|field/i.test(m.toss.decision)) firstShort = winnerShort === teamA.short_code ? teamB.short_code : teamA.short_code;
      }
    }
    if (firstShort) {
      battingFirst  = rows.find(r => r.short_code === firstShort);
      battingSecond = rows.find(r => r.short_code !== firstShort);
    }

    // Step 2: decide who the template should bias toward. If we know the
    // order AND the 1st innings is done → bias = chaser (battingSecond).
    // Else if we know the order → bias = batting-first. Else no bias.
    if (firstInningsDone && battingSecond) {
      biasTeamShort = battingSecond.short_code;
    } else if (battingFirst) {
      biasTeamShort = battingFirst.short_code;
    }
  } catch (e) {
    return res.status(502).json({ error: `Failed to load match teams: ${e.message}` });
  }

  // Reshuffle so teamA = the side the bias points at (chaser when 1st innings
  // is done, batting-first otherwise). Recipes that default to teamA for
  // scoring contracts then align with where the live question is.
  if (biasTeamShort && teamB.short_code === biasTeamShort) {
    const swap = teamA; teamA = teamB; teamB = swap;
  }

  // Recipes receive:
  //   teamA       — "bias" slot (gets scoring contracts by default)
  //   teamB       — other team
  //   battingFirst / battingSecond — authoritative batting order (null if
  //     unknown pre-toss). Used by innings_score recipes to pin the right
  //     innings number regardless of bias direction.
  const rows = TEMPLATES[template]({
    match_id, teamA, teamB,
    battingFirst: battingFirst || teamA,    // fallback when unknown
    battingSecond: battingSecond || teamB,
  });
  const group = db.prepare('SELECT current_round FROM groups WHERE id = ?').get(req.groupId);

  const insert = db.prepare(`
    INSERT INTO contracts (title, type, condition_json, match_id, over_number, resolve_mode,
                           status, phase, subject_kind, team_id, opponent_team_id, player_id,
                           innings_number, season_code, created_by, group_id, round_number)
    VALUES (@title, @type, @condition_json, @match_id, @over_number, @resolve_mode,
            'draft', @phase, @subject_kind, @team_id, @opponent_team_id, @player_id,
            @innings_number, NULL, @created_by, @group_id, @round)
  `);
  const created = [];
  const tx = db.transaction(() => {
    for (const r of rows) {
      const out = insert.run({
        title:            r.title,
        type:             r.type,
        condition_json:   r.condition_json ? JSON.stringify(r.condition_json) : null,
        match_id:         r.match_id || null,
        over_number:      r.over_number ?? null,
        resolve_mode:     r.resolve_mode || 'auto',
        phase:            r.phase || null,
        subject_kind:     r.subject_kind || 'match_generic',
        team_id:          r.team_id ?? null,
        opponent_team_id: r.opponent_team_id ?? null,
        player_id:        r.player_id ?? null,
        innings_number:   r.innings_number ?? null,
        created_by:       req.session.userId,
        group_id:         req.groupId,
        round:            group?.current_round || 1,
      });
      created.push({ id: out.lastInsertRowid, title: r.title });
    }
  });
  tx();
  res.status(201).json({ created: created.length, contract_ids: created.map(c => c.id) });
});

// Template recipes — each returns an array of fully-formed contract payloads
// ready to be dropped into the contracts table. Produced as DRAFTS with
// resolve_mode='auto' so the admin reviews them in the list, hits Publish,
// and the resolver picks them up on the next poll.
//
// A (teamA) and B (teamB) are the two teams in the selected match. The
// Contract Builder would derive these from the admin's clicks — here we
// derive them from Cricbuzz's match payload so the builder-shape stays
// identical. Every contract sets:
//   team_id (+ opponent_team_id for match_winner)
//   condition_json matching the type's expected schema
//   phase + subject_kind so the Edit dialog re-opens correctly
//   over_number / innings_number where the type requires them
// Output is what a user would produce clicking through the builder — just
// faster.
// Small factory helpers so each recipe reads as a compact list of "for X
// team, create this kind of contract". Centralises the condition_json + title
// shape so templates stay scan-able.
function mkTossWinner(match_id, team) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} win the toss today?`,
    type: 'toss_winner', phase: 'toss', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'toss_winner', team: team.short_code },
    match_id, resolve_mode: 'auto',
  };
}
function mkMatchWinner(match_id, team, opp) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} beat ${teamFullFromShort(opp.short_code)} today?`,
    type: 'match_winner', phase: 'match', subject_kind: 'matchup',
    team_id: team.id, opponent_team_id: opp.id,
    condition_json: { type: 'match_winner', team: team.short_code, opponent: opp.short_code },
    match_id, resolve_mode: 'auto',
  };
}
function mkInningsScore(match_id, team, inningsNum, threshold) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} score ${threshold} or more runs?`,
    type: 'innings_score', phase: 'match', subject_kind: 'team',
    team_id: team.id, innings_number: inningsNum,
    condition_json: { type: 'innings_score', team: team.short_code, innings: inningsNum, operator: '>=', threshold },
    match_id, resolve_mode: 'auto',
  };
}
function mkRunsPowerplay(match_id, team, threshold) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} score ${threshold}+ runs in the powerplay (ov 1-6)?`,
    type: 'runs_powerplay', phase: 'powerplay', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'runs_powerplay', team: team.short_code, operator: '>=', threshold },
    match_id, resolve_mode: 'auto',
  };
}
function mkWicketsPowerplay(match_id, team, minWickets) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} lose ${minWickets}+ wickets in the powerplay (ov 1-6)?`,
    type: 'wickets_powerplay', phase: 'powerplay', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'wickets_powerplay', team: team.short_code, min_wickets: minWickets },
    match_id, resolve_mode: 'auto',
  };
}
function mkBoundariesPowerplay(match_id, team, boundaryType, boundaryCount) {
  const label = boundaryType === 'six' ? `${boundaryCount}+ ${boundaryCount === 1 ? 'six' : 'sixes'}` : `${boundaryCount}+ fours`;
  return {
    title: `Will ${teamFullFromShort(team.short_code)} hit ${label} in the powerplay (ov 1-6)?`,
    type: 'boundaries_powerplay', phase: 'powerplay', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'boundaries_powerplay', team: team.short_code, boundary_type: boundaryType, boundary_count: boundaryCount },
    match_id, resolve_mode: 'auto',
  };
}
function mkRunsDeath(match_id, team, threshold) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} score ${threshold}+ runs in the death overs (ov 16-20)?`,
    type: 'runs_death', phase: 'death', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'runs_death', team: team.short_code, operator: '>=', threshold },
    match_id, resolve_mode: 'auto',
  };
}
function mkWicketsDeath(match_id, team, minWickets) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} lose ${minWickets}+ wickets in the death overs (ov 16-20)?`,
    type: 'wickets_death', phase: 'death', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'wickets_death', team: team.short_code, min_wickets: minWickets },
    match_id, resolve_mode: 'auto',
  };
}
function mkBoundariesDeath(match_id, team, boundaryType, boundaryCount) {
  const label = boundaryType === 'six' ? `${boundaryCount}+ ${boundaryCount === 1 ? 'six' : 'sixes'}` : `${boundaryCount}+ fours`;
  return {
    title: `Will ${teamFullFromShort(team.short_code)} hit ${label} in the death overs (ov 16-20)?`,
    type: 'boundaries_death', phase: 'death', subject_kind: 'team',
    team_id: team.id,
    condition_json: { type: 'boundaries_death', team: team.short_code, boundary_type: boundaryType, boundary_count: boundaryCount },
    match_id, resolve_mode: 'auto',
  };
}
function mkRunsOver(match_id, team, overNumber, threshold) {
  return {
    title: `Will ${teamFullFromShort(team.short_code)} score ${threshold}+ runs in over ${overNumber}?`,
    type: 'runs_over', phase: 'over', subject_kind: 'team',
    team_id: team.id, over_number: overNumber,
    condition_json: { type: 'runs_over', team: team.short_code, over: overNumber, operator: '>=', threshold },
    match_id, resolve_mode: 'auto',
  };
}
function mkBoundaryOver(match_id, team, overNumber, boundaryType, boundaryCount) {
  const label = boundaryType === 'six' ? `a six` : `${boundaryCount}+ fours`;
  return {
    title: `Will ${teamFullFromShort(team.short_code)} hit ${label} in over ${overNumber}?`,
    type: 'boundary_over', phase: 'over', subject_kind: 'team',
    team_id: team.id, over_number: overNumber,
    condition_json: { type: 'boundary_over', team: team.short_code, over: overNumber, boundary_type: boundaryType, boundary_count: boundaryCount },
    match_id, resolve_mode: 'auto',
  };
}

// Rules of thumb inside recipes:
//   - teamA = batting first (if known). Scoring-angle contracts (runs,
//     totals, boundaries in powerplay) favour the batting-first side since
//     their question is "how well will they set the target?". Chasing-side
//     batting score is dictated by the target, so it's a less interesting
//     market.
//   - Wickets contracts split across both teams — losing wickets is
//     symmetrically interesting either way.
//   - Match-level questions (toss, match winner) are team-agnostic; we pick
//     one team as the subject and the opponent as the alternative.
const TEMPLATES = {
  // 8 contracts: 5 A / 3 B split. teamA = "bias" side (batting-first before
  // 1st-innings-end, chasing after). innings_score uses battingFirst/Second
  // directly so innings numbers are always correct.
  standard_match: ({ match_id, teamA, teamB, battingFirst, battingSecond }) => ([
    mkTossWinner(match_id, teamA),                                // toss question, subj A
    mkMatchWinner(match_id, teamA, teamB),                        // match winner A
    mkInningsScore(match_id, battingFirst, 1, 170),               // 1st innings total
    mkInningsScore(match_id, battingSecond, 2, 170),              // chase total
    mkRunsPowerplay(match_id, teamA, 45),                         // A PP runs (bias side)
    mkWicketsPowerplay(match_id, teamB, 2),                       // B PP wickets
    mkBoundariesDeath(match_id, teamA, 'six', 2),                 // A death sixes
    mkRunsOver(match_id, teamB, 1, 10),                           // B over-1 (mirror)
  ]),

  // 5 contracts: 3 A / 2 B — PP focus but mixed.
  powerplay_focus: ({ match_id, teamA, teamB }) => ([
    mkRunsPowerplay(match_id, teamA, 45),
    mkRunsPowerplay(match_id, teamB, 45),
    mkWicketsPowerplay(match_id, teamA, 2),
    mkBoundariesPowerplay(match_id, teamB, 'four', 5),
    mkBoundaryOver(match_id, teamA, 1, 'six', 1),
  ]),

  // 4 contracts: 2 A / 2 B — death is symmetric enough.
  death_fireworks: ({ match_id, teamA, teamB }) => ([
    mkBoundariesDeath(match_id, teamA, 'six', 3),
    mkRunsDeath(match_id, teamA, 55),
    mkWicketsDeath(match_id, teamB, 2),
    mkRunsOver(match_id, teamB, 20, 12),
  ]),

  // Head-to-head: 6 contracts — 3 per team in mirrored pairs. innings_score
  // uses authoritative batting order.
  both_teams: ({ match_id, teamA, teamB, battingFirst, battingSecond }) => ([
    mkTossWinner(match_id, teamA),
    mkMatchWinner(match_id, teamA, teamB),
    mkInningsScore(match_id, battingFirst, 1, 170),
    mkInningsScore(match_id, battingSecond, 2, 170),
    mkRunsPowerplay(match_id, teamA, 45),
    mkRunsPowerplay(match_id, teamB, 45),
  ]),
};

// Cached team-name lookup by short_code — avoids N queries when building
// titles. Team data barely changes, so a warm read on first call is fine.
let _teamNameCache = null;
function teamFullFromShort(shortCode) {
  if (!_teamNameCache) {
    _teamNameCache = new Map(
      db.prepare('SELECT short_code, name FROM teams').all().map(t => [t.short_code, t.name])
    );
  }
  return _teamNameCache.get(shortCode) || shortCode;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGroupDetail(groupId, currentUserId) {
  const g = db.prepare(`
    SELECT g.id, g.name, g.invite_code, g.starting_coins, g.created_at, g.creator_id
    FROM groups g WHERE g.id = ?
  `).get(groupId);
  if (!g) return null;

  const members = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.avatar_emoji,
           gm.role, gm.balance, gm.joined_at, gm.notify_enabled,
           (gm.balance - ?) as pnl
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY gm.joined_at ASC
  `).all(g.starting_coins, groupId);

  const me = members.find(m => m.id === currentUserId) || null;
  const contract_count = db.prepare('SELECT COUNT(*) as c FROM contracts WHERE group_id = ?').get(groupId).c;
  const resolved_count = db.prepare("SELECT COUNT(*) as c FROM contracts WHERE group_id = ? AND status = 'resolved'").get(groupId).c;
  return { ...g, members, me, member_count: members.length, contract_count, resolved_count };
}

module.exports = router;

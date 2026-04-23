const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAdmin, requireAuth } = require('../middleware');
const { getCachedMatchData, getCachedFetchedAt, setPollInterval, getPollInterval, getHealth } = require('../engine/cricbuzz-resolver');
const { listLiveMatches } = require('../engine/cricbuzz');
const { getIntSetting, setSetting } = require('../settings');
const db = require('../db');
const ws = require('../websocket');
const router = express.Router();

const ENV_PATH = path.resolve(__dirname, '../../.env');

// Writes a key=value pair into the .env file (updates existing or appends)
function writeEnv(key, value) {
  try {
    let contents = fs.readFileSync(ENV_PATH, 'utf8');
    const line = `${key}=${value}`;
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(contents)) {
      contents = contents.replace(regex, line);
    } else {
      contents = contents.trimEnd() + '\n' + line + '\n';
    }
    fs.writeFileSync(ENV_PATH, contents, 'utf8');
  } catch (e) {
    console.warn('[admin] Could not write .env:', e.message);
  }
}

// Fetch current/upcoming cricket matches from CricAPI
router.get('/matches', requireAdmin, async (req, res) => {
  const apiKey = process.env.CRIC_API_KEY;
  if (!apiKey || apiKey === 'your_cricapi_key_here') {
    return res.status(400).json({ error: 'CRIC_API_KEY not set in .env' });
  }

  try {
    const r = await fetch(`https://api.cricapi.com/v1/currentMatches?apikey=${apiKey}&offset=0`);
    const json = await r.json();
    if (json.status !== 'success') {
      return res.status(502).json({ error: `CricAPI error: ${json.reason || json.status}` });
    }
    // Return simplified list
    const matches = (json.data || []).map(m => ({
      id: m.id,
      name: m.name,
      status: m.status,
      teams: m.teams,
      venue: m.venue,
      date: m.date,
      matchType: m.matchType,
    }));
    res.json({ matches, credits_left: json.info?.credits_left });
  } catch (e) {
    res.status(502).json({ error: `Failed to reach CricAPI: ${e.message}` });
  }
});

// Contract-suggestion helper for the builder. Takes a match_id + contract type
// (plus over/by_over/etc. params as query strings) and returns a recommended
// threshold alongside a one-line explanation the UI renders as a hint. Uses the
// same Cricbuzz data the resolver does — current innings totals, recent overs,
// live batsman stats — projected forward by run-rate for by-over types.
router.get('/contract-suggestion', requireAdmin, async (req, res) => {
  const { match_id, type, team, over, by_over, batsman } = req.query;
  if (!match_id) return res.status(400).json({ error: 'match_id required' });
  if (!type)     return res.status(400).json({ error: 'type required' });

  try {
    const { fetchMatch, fetchOverByOver, findInningsForTeam, oversAsFraction, parseOverSummary } = require('../engine/cricbuzz');
    const match = await fetchMatch(match_id);
    const innings = team ? findInningsForTeam(match, team) : match.innings[match.innings.length - 1];

    // Helper — project the score the batting team would have by a given over,
    // using their current run rate as the extrapolation baseline.
    function projectScoreBy(overNum) {
      if (!innings) return null;
      const playedFrac = oversAsFraction(innings.overs);
      if (playedFrac >= overNum) return innings.score; // already past target
      const rr = playedFrac > 0 ? innings.score / playedFrac : 8;
      return Math.round(innings.score + rr * (overNum - playedFrac));
    }

    // Average runs scored per over over the recent window (last 3 if we have them).
    async function recentOverRunRate() {
      try {
        const obo = await fetchOverByOver(match_id);
        const lastFew = (obo.overs || [])
          .filter(o => innings && o.inningsId === innings.inningsId)
          .sort((a, b) => b.overs - a.overs)
          .slice(0, 3);
        if (lastFew.length === 0) return null;
        return lastFew.reduce((a, o) => a + (o.runs || 0), 0) / lastFew.length;
      } catch { return null; }
    }

    // Dispatch per contract type.
    const t = String(type);

    if (t === 'runs_over') {
      const avg = await recentOverRunRate();
      if (avg == null) return res.json({ threshold: 8, note: 'No recent overs — default 8' });
      const rounded = Math.max(1, Math.round(avg));
      return res.json({
        threshold: rounded,
        note: `Recent overs avg ${avg.toFixed(1)} runs — ~50/50 at ${rounded}`,
      });
    }

    if (t === 'team_total') {
      const tgt = parseInt(by_over);
      if (!tgt) return res.json({ threshold: null, note: 'Pick an over first' });
      const proj = projectScoreBy(tgt);
      if (proj == null) return res.json({ threshold: null, note: 'No innings data yet' });
      const playedFrac = innings ? oversAsFraction(innings.overs) : 0;
      return res.json({
        threshold: proj,
        note: `${innings?.batTeamName} at ${innings?.score}/${innings?.wickets} in ${playedFrac.toFixed(1)} ov — projected ~${proj} by over ${tgt}`,
      });
    }

    if (t === 'innings_score') {
      if (!innings) return res.json({ threshold: null, note: 'Innings not started' });
      const proj = projectScoreBy(match.format === 'T20' ? 20 : 50);
      return res.json({
        threshold: proj,
        note: `${innings.batTeamName} at ${innings.score}/${innings.wickets} — projected final ~${proj}`,
      });
    }

    if (t === 'runs_powerplay' || t === 'runs_death') {
      const range = t === 'runs_powerplay' ? { start: 1, end: 6 } : { start: 16, end: 20 };
      try {
        const obo = await fetchOverByOver(match_id);
        const inRange = (obo.overs || []).filter(o =>
          innings && o.inningsId === innings.inningsId &&
          Math.round(o.overs) >= range.start && Math.round(o.overs) <= range.end
        );
        const runs = inRange.reduce((a, o) => a + (o.runs || 0), 0);
        const coveredCount = inRange.length;
        const windowSize = range.end - range.start + 1;
        if (coveredCount === windowSize) return res.json({ threshold: runs, note: `Already scored: ${runs}` });
        const avgPerOver = coveredCount > 0 ? runs / coveredCount : (await recentOverRunRate()) || 8;
        const projected = Math.round(runs + avgPerOver * (windowSize - coveredCount));
        return res.json({
          threshold: projected,
          note: coveredCount > 0
            ? `So far ${runs} in ${coveredCount} of ${windowSize} overs — projected ~${projected}`
            : `Not started yet — projected ~${projected} based on current rate`,
        });
      } catch { return res.json({ threshold: null, note: 'Data unavailable' }); }
    }

    if (t === 'wicket_over' || t === 'team_wickets_by_over' || t === 'wickets_powerplay' || t === 'wickets_death' || t === 'boundary_over' || t === 'boundaries_powerplay' || t === 'boundaries_death') {
      return res.json({ threshold: 1, note: 'Default 1 — lower counts are more common than higher in T20' });
    }

    if (t === 'batsman_milestone') {
      const ovTarget = parseInt(over) || (match.format === 'T20' ? 20 : 50);
      const c = match.current;
      let currentRuns = null, name = null;
      for (const b of [c?.batsmanStriker, c?.batsmanNonStriker]) {
        if (b?.name && String(batsman || '').toLowerCase() && b.name.toLowerCase().includes(String(batsman || '').toLowerCase())) {
          currentRuns = b.runs; name = b.name;
        }
      }
      if (currentRuns == null) return res.json({ threshold: 30, note: 'Batsman not currently on strike — default 30' });
      const playedFrac = innings ? oversAsFraction(innings.overs) : ovTarget;
      const runsLeft = Math.max(0, ovTarget - playedFrac);
      const proj = Math.round(currentRuns + runsLeft * 8); // ~8 rpo individual projection
      return res.json({ threshold: proj, note: `${name} on ${currentRuns} — projected ~${proj} by over ${ovTarget}` });
    }

    return res.json({ threshold: null, note: 'No suggestion available for this type' });
  } catch (e) {
    console.error('[contract-suggestion] failed:', e.message);
    return res.json({ threshold: null, note: `Data unavailable (${e.message})` });
  }
});

// Resolver-health endpoint powering the small status dot in the admin UI. The
// frontend translates `lastPollFinishedAt` age into green / amber / red.
router.get('/resolver-health', requireAdmin, (req, res) => {
  res.json(getHealth());
});

// Cricbuzz match list — powers the per-contract match picker in the contract
// builder. Returns live / upcoming / recently-completed matches. Any logged-in
// user can call this because (a) group admins also need to pick matches when
// creating group contracts, and (b) the data here is already public on
// Cricbuzz.com — no sensitive info.
router.get('/cricbuzz-matches', requireAuth, async (req, res) => {
  try {
    const seriesFilter = req.query.series || null;
    const matches = await listLiveMatches({ seriesFilter });
    res.json({ matches });
  } catch (e) {
    console.error('[admin] cricbuzz-matches failed:', e.message);
    res.status(502).json({ error: `Failed to fetch Cricbuzz: ${e.message}` });
  }
});

// Set active match ID — persists to .env so it survives server restarts
router.post('/set-match', requireAdmin, (req, res) => {
  const { matchId, matchName, teams } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });
  const teamsStr = Array.isArray(teams) ? teams.join('|') : '';

  process.env.CRIC_MATCH_ID    = matchId;
  process.env.CRIC_MATCH_NAME  = matchName || matchId;
  process.env.CRIC_MATCH_TEAMS = teamsStr;

  // Write to .env so the values survive a server restart
  writeEnv('CRIC_MATCH_ID',    matchId);
  writeEnv('CRIC_MATCH_NAME',  matchName || matchId);
  writeEnv('CRIC_MATCH_TEAMS', teamsStr);

  console.log(`[admin] Match set: ${matchName} (${matchId})`);
  res.json({ ok: true, matchId, matchName, teams });
});

// Get current active match info
router.get('/active-match', requireAdmin, (req, res) => {
  const matchId = process.env.CRIC_MATCH_ID;
  const matchName = process.env.CRIC_MATCH_NAME;
  const apiKey = process.env.CRIC_API_KEY;
  const teamsRaw = process.env.CRIC_MATCH_TEAMS || '';
  const teams = teamsRaw ? teamsRaw.split('|').filter(Boolean) : [];
  res.json({
    matchId: (!matchId || matchId === 'the_match_id_for_todays_game') ? null : matchId,
    matchName: matchName || null,
    apiKeySet: !!(apiKey && apiKey !== 'your_cricapi_key_here'),
    apiEnabled: process.env.ENABLE_CRIC_API === 'true',
    pollMinutes: getPollInterval(),
    teams,
  });
});

// Toggle CricAPI on/off without touching .env manually
router.post('/toggle-api', requireAdmin, (req, res) => {
  const current = process.env.ENABLE_CRIC_API === 'true';
  const next = !current;
  process.env.ENABLE_CRIC_API = next ? 'true' : 'false';
  writeEnv('ENABLE_CRIC_API', next ? 'true' : 'false');
  console.log(`[admin] CricAPI ${next ? 'ENABLED' : 'DISABLED'}`);
  res.json({ enabled: next });
});

// Set poll interval in minutes (live — no restart needed)
router.post('/set-poll-interval', requireAdmin, (req, res) => {
  const minutes = parseInt(req.body.minutes);
  if (!minutes || minutes < 1) return res.status(400).json({ error: 'minutes must be >= 1' });
  setPollInterval(minutes);
  writeEnv('CRIC_POLL_MINUTES', String(minutes));
  res.json({ ok: true, pollMinutes: minutes });
});

// Fetch live score — served from resolver's cache (no extra API credit used)
router.get('/live-score', (req, res) => {
  const matchId = process.env.CRIC_MATCH_ID;
  if (!matchId || matchId === 'the_match_id_for_todays_game') {
    return res.json({ available: false, reason: 'no_match_selected' });
  }

  const d = getCachedMatchData();
  const fetchedAt = getCachedFetchedAt();

  if (!d) return res.json({ available: false, reason: 'no_data_yet' });

  res.json({
    available: true,
    matchName: d.name,
    status: d.status,
    score: d.score || [],
    currentOver: d.currentOver || null,
    teams: d.teams || [],
    matchStarted: d.matchStarted,
    matchEnded: d.matchEnded,
    cachedAgo: fetchedAt ? Math.round((Date.now() - fetchedAt) / 1000) : null,
  });
});

// Debug: shows raw CricAPI cache + how each active auto contract evaluates
router.get('/debug-resolver', requireAdmin, async (req, res) => {
  const apiKey  = process.env.CRIC_API_KEY;
  const matchId = process.env.CRIC_MATCH_ID;

  // Fresh fetch so we don't need a recent poll
  let matchData = null, scorecard = null;
  try {
    const r1 = await fetch(`https://api.cricapi.com/v1/match_info?apikey=${apiKey}&id=${matchId}`);
    const j1 = await r1.json();
    matchData = j1.status === 'success' ? j1.data : null;

    const r2 = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchId}`);
    const j2 = await r2.json();
    scorecard = j2.status === 'success' ? j2.data : null;
  } catch(e) { /* ignore */ }

  const contracts = db.prepare(
    "SELECT * FROM contracts WHERE status = 'active' AND resolve_mode = 'auto' AND type != 'manual'"
  ).all();

  const contractDiag = contracts.map(c => {
    let condition = null;
    try { condition = JSON.parse(c.condition_json); } catch {}
    return { id: c.id, title: c.title, condition };
  });

  res.json({
    matchData_score: matchData?.score || null,
    matchData_currentOver: matchData?.currentOver || null,
    scorecard_innings: (scorecard?.scorecard || []).map(inn => ({
      batting: inn.batting,
      batsmen: (inn.batsmen || []).map(b => ({ name: b.bat, runs: b.r })),
      overs: inn.overs || [],
    })),
    active_auto_contracts: contractDiag,
  });
});

// Bot intensity dial (0 = off, 1 = low, 2 = moderate, 3 = high)
router.get('/bots', requireAdmin, (req, res) => {
  const intensity = getIntSetting('bots_intensity', 0);
  const botIds = db.prepare("SELECT id FROM users WHERE is_bot = 1").all().map(r => r.id);
  let ordersLastHour = 0;
  if (botIds.length > 0) {
    const placeholders = botIds.map(() => '?').join(',');
    ordersLastHour = db.prepare(
      `SELECT COUNT(*) as c FROM orders WHERE user_id IN (${placeholders}) AND created_at > datetime('now', '-1 hour')`
    ).get(...botIds).c;
  }
  const activeContracts = db.prepare("SELECT COUNT(*) as c FROM contracts WHERE status = 'active'").get().c;
  const totalBalance = db.prepare("SELECT COALESCE(SUM(balance),0) as s FROM users WHERE is_bot = 1").get().s;
  const botCount = botIds.length;
  res.json({ intensity, stats: { ordersLastHour, activeContracts, totalBalance, botCount } });
});

router.post('/bots/intensity', requireAdmin, (req, res) => {
  const level = parseInt(req.body.level);
  if (!Number.isFinite(level) || level < 0 || level > 3) {
    return res.status(400).json({ error: 'level must be 0, 1, 2, or 3' });
  }
  setSetting('bots_intensity', level);
  console.log(`[admin] Bots intensity set to ${level}`);
  res.json({ ok: true, intensity: level });
});

// Player stats — total registered (non-bot) users and currently connected users.
// "Active" = unique userIds across open WebSocket connections.
router.get('/user-stats', requireAdmin, (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users WHERE is_bot = 0').get().c;
  const activeIds = ws.getActiveUserIds();
  let activeUsers = 0;
  let activeUsernames = [];
  if (activeIds.length > 0) {
    const placeholders = activeIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT id, username, display_name FROM users WHERE is_bot = 0 AND id IN (${placeholders})`
    ).all(...activeIds);
    activeUsers = rows.length;
    activeUsernames = rows.map(r => r.display_name || r.username);
  }
  res.json({ totalUsers, activeUsers, activeUsernames });
});

// Force-verify a user by username (admin only — useful for testing)
router.post('/verify-user', requireAdmin, (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username required' });
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET is_verified = 1, verify_token = NULL, verify_token_expires = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true, username });
});

module.exports = router;

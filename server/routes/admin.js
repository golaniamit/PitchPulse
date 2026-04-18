const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAdmin } = require('../middleware');
const { getCachedMatchData, getCachedFetchedAt, setPollInterval, getPollInterval } = require('../engine/resolver');
const db = require('../db');
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

module.exports = router;

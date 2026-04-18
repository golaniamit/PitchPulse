const db = require('../db');
const { settleContract } = require('../routes/contracts');
const { setResolutionHint } = require('./bots');

let pollInterval = null;

// Shared in-memory cache so live-score endpoint doesn't need its own API call
const cache = {
  matchData: null,
  scorecard: null,
  fetchedAt: null,
};

function getCachedMatchData() { return cache.matchData; }
function getCachedFetchedAt() { return cache.fetchedAt; }

// ── CricAPI fetchers ──────────────────────────────────────────────────────────

async function fetchMatchData(matchId, apiKey) {
  try {
    const r = await fetch(`https://api.cricapi.com/v1/match_info?apikey=${apiKey}&id=${matchId}`);
    const json = await r.json();
    if (json.status !== 'success') {
      console.log(`[resolver] CricAPI error (match_info): ${json.reason || json.status}`);
      return null;
    }
    return json.data;
  } catch (e) {
    console.error('[resolver] fetch error (match_info):', e.message);
    return null;
  }
}

async function fetchScorecard(matchId, apiKey) {
  try {
    const r = await fetch(`https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchId}`);
    const json = await r.json();
    if (json.status !== 'success') {
      console.log(`[resolver] CricAPI error (scorecard): ${json.reason || json.status}`);
      return null;
    }
    return json.data;
  } catch (e) {
    console.error('[resolver] fetch error (scorecard):', e.message);
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// Returns the score entry for a team (match_info score array)
// CricAPI score entries: { r, w, o, inning: "Gujarat Titans,Kolkata Knight Riders Inning 1" }
function getScoreForTeam(matchData, teamName) {
  const scoreArr = matchData.score || [];
  return scoreArr.find(s =>
    s.inning?.toLowerCase().includes(teamName.toLowerCase())
  ) || null;
}

// Index of a team's innings in the score array (used to match scorecard position)
function getInningIndex(matchData, teamName) {
  const scoreArr = matchData.score || [];
  return scoreArr.findIndex(s =>
    s.inning?.toLowerCase().includes(teamName.toLowerCase())
  );
}

// Current over in the match (from the last active inning's score entry)
function getCurrentOver(matchData) {
  const scoreArr = matchData.score || [];
  if (scoreArr.length) {
    const last = scoreArr[scoreArr.length - 1];
    return parseFloat(last.o || 0);
  }
  return parseFloat(matchData.currentOver || 0);
}

// From scorecard, get innings by matching position with score array
// CricAPI actual structure: scorecard[n].batting = array of batsman objects (NOT a team name string)
// We match by index: score array position === scorecard array position
function getScorecardInning(matchData, scorecard, teamName) {
  if (!scorecard?.scorecard) return null;
  const idx = getInningIndex(matchData, teamName);
  if (idx === -1) return null;
  return scorecard.scorecard[idx] || null;
}

// Runs scored in a specific over from scorecard
// CricAPI overs (when available): { over: 1, runs: 8, wickets: 0, extras: 1 }
function getRunsInOver(matchData, scorecard, teamName, overNumber) {
  const inning = getScorecardInning(matchData, scorecard, teamName);
  if (!inning?.overs?.length) return null; // overs data not available from API
  const overEntry = inning.overs.find(o => {
    const num = Math.round(parseFloat(o.over ?? o.overNumber ?? -1));
    return num === overNumber;
  });
  if (!overEntry) return null;
  return parseInt(overEntry.runs ?? overEntry.r ?? 0);
}

// Wickets that fell in a specific over from scorecard
function getWicketsInOver(matchData, scorecard, teamName, overNumber) {
  const inning = getScorecardInning(matchData, scorecard, teamName);
  if (!inning?.overs?.length) return null;
  const overEntry = inning.overs.find(o => {
    const num = Math.round(parseFloat(o.over ?? o.overNumber ?? -1));
    return num === overNumber;
  });
  if (!overEntry) return null;
  return parseInt(overEntry.wickets ?? overEntry.w ?? 0);
}

// Batsman runs from scorecard
// CricAPI actual structure: batting[n].batsman.name and batting[n].r
function getBatsmanRuns(scorecard, batsmanName) {
  if (!scorecard?.scorecard) return null;
  for (const inning of scorecard.scorecard) {
    // batting is an array of batsman objects
    const player = (inning.batting || []).find(b =>
      b.batsman?.name?.toLowerCase().includes(batsmanName.toLowerCase())
    );
    if (player != null) return parseInt(player.r ?? 0);
  }
  return null;
}

// ── Comparison helper ─────────────────────────────────────────────────────────

function compare(value, operator, threshold) {
  switch (operator) {
    case '>=': return value >= threshold;
    case '>':  return value > threshold;
    case '<=': return value <= threshold;
    case '<':  return value < threshold;
    case '=':  return value === threshold;
    default:   return null;
  }
}

// ── Condition evaluators ──────────────────────────────────────────────────────
// Returns: true (YES), false (NO), or null (not yet determinable)

function evaluateCondition(condition, matchData, scorecard) {
  if (!matchData) return null;
  const { type } = condition;
  const currentOver = getCurrentOver(matchData);

  // ── runs_over: did team score >= N runs in over X? ──────────────────────────
  if (type === 'runs_over') {
    const { team, over, operator, threshold } = condition;
    if (currentOver < over) return null; // over hasn't been bowled yet

    const runs = getRunsInOver(matchData, scorecard, team, over);
    if (runs === null) {
      console.log(`[resolver] runs_over: per-over data not available from CricAPI for this match — use Force Resolve`);
      return null;
    }
    const result = compare(runs, operator, threshold);
    console.log(`[resolver] runs_over: ${team} over ${over} scored ${runs} runs → ${result ? 'YES' : 'NO'}`);
    return result;
  }

  // ── wicket_over: did team lose >= N wickets in over X? ─────────────────────
  if (type === 'wicket_over') {
    const { batting_team, over, min_wickets } = condition;
    if (currentOver < over) return null; // over hasn't finished

    const wickets = getWicketsInOver(matchData, scorecard, batting_team, over);
    if (wickets === null) {
      console.log(`[resolver] wicket_over: per-over data not available from CricAPI for this match — use Force Resolve`);
      return null;
    }
    const result = wickets >= min_wickets;
    console.log(`[resolver] wicket_over: ${batting_team} over ${over} had ${wickets} wickets → ${result ? 'YES' : 'NO'}`);
    return result;
  }

  // ── team_total: did team reach N runs by over X? ────────────────────────────
  if (type === 'team_total') {
    const { team, by_over, operator, threshold } = condition;
    if (currentOver < by_over) return null; // over hasn't arrived

    const scoreEntry = getScoreForTeam(matchData, team);
    if (!scoreEntry) {
      console.log(`[resolver] team_total: no score entry found for team "${team}"`);
      return null;
    }
    const runs = parseInt(scoreEntry.r || 0);
    const result = compare(runs, operator, threshold);
    console.log(`[resolver] team_total: ${team} has ${runs} runs by over ${by_over} → ${result ? 'YES' : 'NO'}`);
    return result;
  }

  // ── batsman_milestone: did batsman score N+ runs by over X? ────────────────
  if (type === 'batsman_milestone') {
    const { batsman, milestone, by_over } = condition;
    const runs = getBatsmanRuns(scorecard, batsman);

    if (runs === null) {
      console.log(`[resolver] batsman_milestone: "${batsman}" not found in scorecard`);
      return null;
    }
    if (runs >= milestone) {
      console.log(`[resolver] batsman_milestone: ${batsman} has ${runs} runs ≥ ${milestone} → YES`);
      return true;
    }
    if (currentOver >= by_over) {
      console.log(`[resolver] batsman_milestone: ${batsman} has ${runs} runs < ${milestone} and over ${by_over} passed → NO`);
      return false;
    }
    return null; // still batting, milestone not yet reached
  }

  // ── boundary_over: not resolvable via CricAPI free tier ────────────────────
  if (type === 'boundary_over') {
    console.log(`[resolver] boundary_over: ball-by-ball data not available on free tier — use manual resolve`);
    return null;
  }

  return null; // manual contracts ignored
}

// ── Main poll loop ─────────────────────────────────────────────────────────────

async function pollAndResolve() {
  const apiKey  = process.env.CRIC_API_KEY;
  const matchId = process.env.CRIC_MATCH_ID;

  if (process.env.ENABLE_CRIC_API !== 'true') return;
  if (!apiKey  || apiKey  === 'your_cricapi_key_here')          return;
  if (!matchId || matchId === 'the_match_id_for_todays_game')   return;

  console.log('[resolver] Polling CricAPI...');

  const matchData = await fetchMatchData(matchId, apiKey);
  if (!matchData) return;

  cache.matchData  = matchData;
  cache.fetchedAt  = Date.now();

  const contracts = db.prepare(
    "SELECT * FROM contracts WHERE status = 'active' AND resolve_mode = 'auto' AND type != 'manual'"
  ).all();

  if (contracts.length === 0) {
    console.log('[resolver] No active auto-resolve contracts.');
    return;
  }

  // Fetch scorecard once — needed for runs_over, wicket_over, batsman_milestone
  const scorecard = await fetchScorecard(matchId, apiKey);
  if (scorecard) cache.scorecard = scorecard;

  console.log(`[resolver] Evaluating ${contracts.length} contract(s)...`);

  for (const contract of contracts) {
    let condition;
    try { condition = JSON.parse(contract.condition_json); } catch { continue; }

    const result = evaluateCondition(condition, matchData, scorecard);
    if (result === null) {
      console.log(`[resolver] Contract ${contract.id} "${contract.title}" → not yet determinable`);
      continue;
    }

    const resolution = result ? 'YES' : 'NO';
    console.log(`[resolver] Contract ${contract.id} "${contract.title}" → ${resolution} (settling in 60-90s)`);

    // Tip off the informed bot before settlement
    setResolutionHint(contract.id, resolution);

    const contractId = contract.id;
    setTimeout(() => {
      const current = db.prepare('SELECT status FROM contracts WHERE id = ?').get(contractId);
      if (current?.status === 'active') {
        settleContract(contractId, resolution);
        console.log(`[resolver] Settled contract ${contractId} as ${resolution}`);
      }
    }, randomBetween(60000, 90000));
  }
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function startResolver() {
  if (pollInterval) return;
  const minutes = parseInt(process.env.CRIC_POLL_MINUTES || '2');
  pollInterval = setInterval(pollAndResolve, minutes * 60 * 1000);
  console.log(`[resolver] Auto-resolver started (${minutes}min poll, API disabled until ENABLE_CRIC_API=true)`);
}

function stopResolver() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

// Change poll frequency live without restarting the server
function setPollInterval(minutes) {
  const ms = Math.max(1, parseInt(minutes)) * 60 * 1000;
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollAndResolve, ms);
  process.env.CRIC_POLL_MINUTES = String(Math.max(1, parseInt(minutes)));
  console.log(`[resolver] Poll interval changed to ${minutes} min`);
}

function getPollInterval() {
  return parseInt(process.env.CRIC_POLL_MINUTES || '2');
}

module.exports = { startResolver, stopResolver, getCachedMatchData, getCachedFetchedAt, setPollInterval, getPollInterval };

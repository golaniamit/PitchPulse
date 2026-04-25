// Cricbuzz-backed auto-resolver — replaces server/engine/resolver.js (the CricAPI
// version, kept on disk as a dead file for potential revival). This module polls
// Cricbuzz's public pages for each match referenced by an active auto contract,
// evaluates the contract's condition, and settles it with the same randomised
// 60–90s delay as the old resolver (so bots still get a heads-up via
// setResolutionHint before settlement).
//
// Public API matches the old resolver so server/index.js and server/routes/admin.js
// don't need behavioural changes:
//   startResolver(), stopResolver(), setPollInterval(), getPollInterval(),
//   getCachedMatchData(), getCachedFetchedAt()
//
// Data sources (all public HTML, no auth):
//   fetchMatch(matchId)        — innings totals, striker/non-striker, match state
//   fetchOverByOver(matchId)   — per-over runs, wickets, and ball-by-ball string
//                                 (only fetched when a contract requires per-over data)

const db = require('../db');
const { settleContract } = require('../routes/contracts');
const { setResolutionHint } = require('./bots');
const {
  fetchMatch,
  fetchOverByOver,
  fetchScorecard,
  findInningsForTeam,
  oversAsFraction,
  parseOverSummary,
} = require('./cricbuzz');

let pollInterval = null;

// Shared cache for the /live-score endpoint. Holds the most recent normalised
// match snapshot from any poll cycle.
const cache = {
  matchData: null,
  fetchedAt: null,
};

// Per-match resolver health — what was the last successful fetch vs error, and
// whether the resolver loop has even run recently. Exposed to the admin via
// /api/admin/resolver-health so a small UI dot can flag outages without having
// to tail the backend console.
const health = {
  lastPollStartedAt: null,
  lastPollFinishedAt: null,
  lastPollError: null,
  perMatch: new Map(), // matchId → { lastOkAt, lastErrorAt, lastError }
};
function getHealth() {
  return {
    lastPollStartedAt: health.lastPollStartedAt,
    lastPollFinishedAt: health.lastPollFinishedAt,
    lastPollError: health.lastPollError,
    // Admin-configured cadence — the health dot uses this to decide what
    // "on time" means. Without it, a 60-min interval would wrongly go red
    // after 5 min because thresholds were hard-coded.
    pollIntervalMinutes: getPollInterval(),
    matches: [...health.perMatch.entries()].map(([matchId, h]) => ({ matchId, ...h })),
  };
}

// Over-snapshot ledger. Cricbuzz's live-over-by-over page only exposes a rolling
// window of ~8 overs, so powerplay contracts (overs 1–6) stop being resolvable
// once the innings has progressed past ~over 12. The poll loop merges every
// over entry it sees into this map AND persists to the over_ledger table, so
// a server restart mid-match doesn't lose history.
// Shape: Map<matchId, Map<"inningsId:over", overEntry>>.
const ledger = new Map();
const ingestStmt = db.prepare(`
  INSERT INTO over_ledger (match_id, innings_id, over_num, raw_json, updated_at)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(match_id, innings_id, over_num) DO UPDATE SET raw_json = excluded.raw_json, updated_at = CURRENT_TIMESTAMP
`);
const selectLedgerStmt = db.prepare(`SELECT match_id, innings_id, over_num, raw_json FROM over_ledger`);

function ingestOvers(matchId, overs) {
  if (!Array.isArray(overs) || overs.length === 0) return;
  const key = String(matchId);
  let byOver = ledger.get(key);
  if (!byOver) { byOver = new Map(); ledger.set(key, byOver); }
  for (const o of overs) {
    if (o?.inningsId == null || o?.overs == null) continue;
    const overNum = Math.round(parseFloat(o.overs));
    byOver.set(`${o.inningsId}:${overNum}`, o);
    try { ingestStmt.run(key, o.inningsId, overNum, JSON.stringify(o)); }
    catch (e) { console.warn('[cricbuzz-resolver] ledger persist failed:', e.message); }
  }
}

function getLedgerOvers(matchId) {
  const byOver = ledger.get(String(matchId));
  return byOver ? [...byOver.values()] : [];
}

// Boot — hydrate the in-memory ledger from whatever's in SQLite. Lossy (only
// restores what was previously persisted) but stops server restarts from
// wiping history mid-match.
function loadLedgerFromDb() {
  let count = 0;
  for (const row of selectLedgerStmt.all()) {
    try {
      const entry = JSON.parse(row.raw_json);
      const key = String(row.match_id);
      let byOver = ledger.get(key);
      if (!byOver) { byOver = new Map(); ledger.set(key, byOver); }
      byOver.set(`${row.innings_id}:${row.over_num}`, entry);
      count++;
    } catch { /* skip */ }
  }
  if (count > 0) console.log(`[cricbuzz-resolver] Loaded ${count} over entries from ledger`);
}
loadLedgerFromDb();
function getCachedMatchData() { return cache.matchData; }
function getCachedFetchedAt() { return cache.fetchedAt; }

// Dev-only injection point — lets a /simulate-match admin endpoint stuff a
// fake match into the cache without needing a live Cricbuzz poll. Used to
// exercise the contract parser's live-match context against known teams.
function _setCachedMatchData(match) {
  cache.matchData = match;
  cache.fetchedAt = Date.now();
}
function _clearCachedMatchData() {
  cache.matchData = null;
  cache.fetchedAt = null;
}

// ── Condition evaluators ──────────────────────────────────────────────────────
// Return true (YES), false (NO), or null (not yet determinable).

// runs_over: did `team` score `operator threshold` runs in over `over`?
function evalRunsOver(condition, match, overs) {
  const { team, over, operator, threshold } = condition;
  const innings = findInningsForTeam(match, team);
  if (!innings) return null;
  if (!isOverComplete(innings, over)) return null;
  const entry = findOverEntry(overs, innings.inningsId, over);
  if (!entry) return null;
  const runs = entry.runs ?? 0;
  return compare(runs, operator, threshold);
}

// wicket_over: did `batting_team` lose >= `min_wickets` wickets in over `over`?
function evalWicketOver(condition, match, overs) {
  const { batting_team, over, min_wickets } = condition;
  const innings = findInningsForTeam(match, batting_team);
  if (!innings) return null;
  if (!isOverComplete(innings, over)) return null;
  const entry = findOverEntry(overs, innings.inningsId, over);
  if (!entry) return null;
  const { wickets } = parseOverSummary(entry.ovrSummary);
  return wickets >= min_wickets;
}

// boundary_over: did `team` hit >= `boundary_count` of `boundary_type` in over `over`?
// boundary_type: 'four' | 'six' | 'four_or_six'. boundary_count defaults to 1.
function evalBoundaryOver(condition, match, overs) {
  const { team, over, boundary_type } = condition;
  const count = condition.boundary_count ?? 1;
  const innings = findInningsForTeam(match, team);
  if (!innings) return null;
  if (!isOverComplete(innings, over)) return null;
  const entry = findOverEntry(overs, innings.inningsId, over);
  if (!entry) return null;
  const { fours, sixes } = parseOverSummary(entry.ovrSummary);
  if (boundary_type === 'four') return fours >= count;
  if (boundary_type === 'six')  return sixes >= count;
  return (fours + sixes) >= count; // four_or_six (or unspecified)
}

// Over is "complete" when the innings has moved fully past it, or the innings
// has ended all-out (which closes a partial over). Cricbuzz's overSummaryList
// surfaces the in-progress over too, so evaluators must guard against firing
// on a partial — otherwise "3+ sixes in over 15" resolves NO after ball 3.
function isOverComplete(innings, overNumber) {
  if (!innings) return false;
  const played = parseFloat(innings.overs || 0);
  // Cricbuzz decimal form: 15.5 = 15 overs + 5 balls. floor(15.5) = 15 means
  // over 15 is NOT finished. 16.0 (auto-rolled after 6 legal balls) means it is.
  if (Math.floor(played) >= overNumber) return true;
  if (innings.wickets === 10) return true;              // all out closes a partial
  if (innings.isDeclared) return true;                   // declaration same effect
  return false;
}

// team_total: has `team` scored `operator threshold` by over `by_over`?
// Short-circuits are only valid BEFORE by_over elapses — once the deadline passes,
// the answer is locked to whatever the score was AT by_over (not now), so we pull
// the exact score at end of by_over from the OBO ledger.
function evalTeamTotal(condition, match, overs) {
  const { team, by_over, operator, threshold } = condition;
  const innings = findInningsForTeam(match, team);
  if (!innings) return null;

  const oversPlayed = oversAsFraction(innings.overs);
  const deadlineElapsed = oversPlayed >= by_over || innings.wickets === 10;

  if (!deadlineElapsed) {
    // Pre-deadline: monotonic (runs only grow), so ≥/> can lock YES, ≤/< can lock NO.
    const early = earlyResolveRuns(innings.score, operator, threshold);
    if (early !== null) return early;
    return null;
  }

  // Deadline passed — use the score at end of by_over. Priority:
  //  1) by_over covers the entire (closed) innings → innings.score IS the answer.
  //  2) Ledger has the exact over entry → use its score.
  //  3) Monotonic fallback: for `≥`/`>`, if current < threshold, NO (score at by_over ≤ current);
  //     for `≤`/`<`, if current > threshold, NO (score can only have grown).
  if (isInningsClosed(match, innings)) {
    const inningsBowledTo = Math.floor(oversPlayed);
    if (by_over >= inningsBowledTo) return compare(innings.score, operator, threshold);
  }
  const entry = findOverEntry(overs, innings.inningsId, by_over);
  if (entry) return compare(entry.score, operator, threshold);
  if ((operator === '>=' || operator === '>') && innings.score < threshold) return false;
  if ((operator === '<=' || operator === '<') && innings.score > threshold) return false;
  return null;
}

// batsman_milestone: did `batsman` reach `milestone` runs by over `by_over`?
// Early-NO path: if the scorecard shows the batsman has been dismissed with
// runs < milestone, he can't add any more, so NO locks in immediately — no
// need to wait for the by_over deadline.
function evalBatsmanMilestone(condition, match, scorecard) {
  const { batsman, milestone, by_over } = condition;
  const needle = String(batsman || '').toLowerCase();

  // Scorecard path: definitive per-batsman runs + out status.
  if (scorecard) {
    for (const inn of scorecard.innings || []) {
      const b = (inn.batsmen || []).find(x => playerNameMatches(batsman, x.name));
      if (!b) continue;
      if ((b.runs ?? 0) >= milestone) return true;       // monotonic early-YES
      if (b.isOut) return false;                         // out below threshold → can't recover
    }
  }

  // Mid-innings fallback: live miniscore (striker/non-striker runs).
  const runs = findBatsmanRuns(match, batsman);
  if (runs != null && runs >= milestone) return true;
  // If the deadline over has passed and the batsman is still short, it's NO.
  const currentOver = currentInningsOvers(match);
  if (currentOver != null && currentOver >= by_over) return false;
  return null;
}

// team_wickets_by_over: has `team` lost >= `min_wickets` cumulatively by end of over `by_over`?
// Pre-deadline the check is monotonic (wickets only accumulate), so an early-YES
// lock is safe. Post-deadline we must snapshot wickets at the end of by_over
// from the OBO ledger — using current wickets would wrongly flip NO→YES if
// later wickets fell after the deadline.
function evalTeamWicketsByOver(condition, match, overs) {
  const { team, by_over, min_wickets } = condition;
  const innings = findInningsForTeam(match, team);
  if (!innings) return null;

  const oversPlayed = oversAsFraction(innings.overs);
  const deadlineElapsed = oversPlayed >= by_over || isInningsClosed(match, innings);

  if (!deadlineElapsed) {
    return innings.wickets >= min_wickets ? true : null;
  }

  // Deadline elapsed. Fallbacks for "what was the count at end of by_over":
  //  1) by_over covers the entire (closed) innings → innings.wickets IS the count.
  //  2) ledger has the exact over entry.
  //  3) Current < threshold → count at by_over ≤ current < threshold → NO (monotonic).
  if (isInningsClosed(match, innings)) {
    const bowled = Math.floor(oversPlayed);
    if (by_over >= bowled) return innings.wickets >= min_wickets;
  }
  const entry = findOverEntry(overs, innings.inningsId, by_over);
  if (entry) return entry.wickets >= min_wickets;
  if (innings.wickets < min_wickets) return false;
  return null;
}

// innings_score: team's `innings`th-innings total vs threshold. Uses the monotonic
// short-circuit (≥/> lock YES, ≤/< lock NO) so a "220+ today" contract can resolve
// the moment 220 is reached — no need to wait out the full innings.
function evalInningsScore(condition, match) {
  const { team, innings: inningsNum, operator, threshold } = condition;
  const innings = match.innings.find(i => i.inningsId === inningsNum)
                 || findInningsForTeam(match, team);
  if (!innings) return null;

  const early = earlyResolveRuns(innings.score, operator, threshold);
  if (early !== null) return early;

  if (!isInningsClosed(match, innings)) return null;
  return compare(innings.score, operator, threshold);
}

// match_winner: did `team` beat `opponent`? Resolves when match.result exists (complete match).
function evalMatchWinner(condition, match) {
  if (!match.result) return null;
  if (match.result.type === 'no-result') return null;  // abandoned — contract stays pending for admin
  if (match.result.type === 'tie' || match.result.type === 'draw') return false;
  const { team } = condition;
  const teamObj = match.teams?.find(t =>
    t.shortName?.toLowerCase() === String(team).toLowerCase() ||
    t.name?.toLowerCase() === String(team).toLowerCase()
  );
  if (!teamObj) return null;
  return Number(match.result.winnerId) === Number(teamObj.id)
      || match.result.winnerName?.toLowerCase() === teamObj.name?.toLowerCase();
}

// toss_winner: resolves as soon as toss is known (typically ~30 min before first ball).
function evalTossWinner(condition, match) {
  if (!match.toss) return null;
  const { team } = condition;
  const teamObj = match.teams?.find(t =>
    t.shortName?.toLowerCase() === String(team).toLowerCase() ||
    t.name?.toLowerCase() === String(team).toLowerCase()
  );
  if (!teamObj) return null;
  return Number(match.toss.tossWinnerId) === Number(teamObj.id)
      || match.toss.tossWinnerName?.toLowerCase() === teamObj.name?.toLowerCase();
}

// Phase helpers — sum runs / wickets / boundaries across a range of overs.
// Aggregates over every entry we have in the ledger that falls in the window,
// then applies monotonic short-circuits (≥/>/min_wickets/count → YES as soon
// as hit; ≤/< → NO as soon as exceeded). Only `=` and the final-NO cases need
// the window to be fully bowled.
function evalOverRangeAggregate(condition, match, overs, overRange, kind) {
  const { team, operator, threshold } = condition;
  const count = condition.boundary_count ?? 1;
  const bType = condition.boundary_type || 'four_or_six';
  const minWkts = condition.min_wickets ?? 1;

  const innings = findInningsForTeam(match, team);
  if (!innings) return null;

  // Aggregate over the window. Missing entries are tolerated for short-circuit
  // (a running total can only grow with more data), but if we can't early-
  // resolve we'll need a complete window before settling.
  let totalRuns = 0, totalWkts = 0, totalFours = 0, totalSixes = 0;
  let missing = false;
  const effectiveEnd = innings.wickets === 10
    ? Math.min(overRange.end, Math.floor(parseFloat(innings.overs || 0)))
    : overRange.end;
  for (let ov = overRange.start; ov <= effectiveEnd; ov++) {
    const entry = findOverEntry(overs, innings.inningsId, ov);
    if (!entry) { missing = true; continue; }
    totalRuns += entry.runs ?? 0;
    const p = parseOverSummary(entry.ovrSummary);
    totalWkts  += p.wickets;
    totalFours += p.fours;
    totalSixes += p.sixes;
  }

  // Early-resolve YES as soon as threshold is hit (monotonic).
  if (kind === 'runs') {
    const early = earlyResolveRuns(totalRuns, operator, threshold);
    if (early !== null) return early;
  }
  if (kind === 'wickets' && totalWkts >= minWkts) return true;
  if (kind === 'boundaries') {
    if (bType === 'four' && totalFours >= count) return true;
    if (bType === 'six'  && totalSixes >= count) return true;
    if (bType !== 'four' && bType !== 'six' && (totalFours + totalSixes) >= count) return true;
  }

  // Haven't hit threshold yet — can't conclude NO until the window is fully
  // bowled AND the ledger has every over in it.
  if (!isOverComplete(innings, overRange.end)) return null;
  if (missing) return null;

  // Window complete → final compare.
  if (kind === 'runs')    return compare(totalRuns, operator, threshold);
  if (kind === 'wickets') return totalWkts >= minWkts;
  if (kind === 'boundaries') {
    if (bType === 'four') return totalFours >= count;
    if (bType === 'six')  return totalSixes >= count;
    return (totalFours + totalSixes) >= count;
  }
  return null;
}

// Closed = innings is over (all 10 out, or all 20 overs bowled in T20, or declared).
function isInningsClosed(match, innings) {
  if (!innings) return false;
  if (innings.wickets === 10) return true;
  if (innings.isDeclared) return true;
  if (match.format === 'T20' && Math.floor(parseFloat(innings.overs || 0)) >= 20) return true;
  // Match-level state also indicates close of both innings
  if (match.result) return true;
  // Next innings has started — this one must be closed
  if (match.innings.some(i => i.inningsId > innings.inningsId)) return true;
  return false;
}

// Phase windows (same constants the builder uses when rendering phase tiles).
const POWERPLAY = { start: 1,  end: 6  };
const DEATH     = { start: 16, end: 20 };

// bowler_wickets_by_over: did `bowler` take >= `min_wickets` cumulatively by end
// of over `by_over`?
//
// Two data paths:
//   1. Mid-innings: use the over ledger. Each overSummaryList entry carries
//      `bowlNames[]` + `bowlWickets` (the bowler's cumulative wicket count as of
//      that over). We pick the latest entry ≤ by_over naming this bowler.
//   2. End-of-innings / match-complete: fall back to the scorecard, which has
//      the definitive final wicket tally even if the ledger missed the bowler.
function evalBowlerWicketsByOver(condition, match, overs, scorecard) {
  const { bowler, min_wickets, by_over } = condition;
  const needle = String(bowler || '').toLowerCase();
  if (!needle) return null;

  // Scorecard-based early-resolves.
  //   • If the bowler has already bowled his quota (T20 max = 4 overs) and is
  //     still short, he can't add more — lock NO immediately.
  //   • If the bowler has already reached min_wickets, lock YES.
  //   • If the innings has CLOSED and by_over covers it, the final tally is
  //     authoritative either way.
  if (scorecard) {
    const MAX_OVERS = match.format === 'T20' ? 4 : 10; // T20=4, ODI=10
    for (const inn of scorecard.innings || []) {
      const b = (inn.bowlers || []).find(x => playerNameMatches(bowler, x.name));
      if (!b) continue;
      const wkts = b.wickets ?? 0;
      const ovs  = parseFloat(b.overs) || 0;
      if (wkts >= min_wickets) return true;                   // monotonic YES
      if (ovs >= MAX_OVERS) return false;                     // quota done, can't bowl more

      const matchInn = match.innings.find(i => i.inningsId === inn.inningsId);
      if (matchInn) {
        const inningsBowledTo = Math.floor(parseFloat(matchInn.overs || 0));
        if (isInningsClosed(match, matchInn) && by_over >= inningsBowledTo) return wkts >= min_wickets;
      }
    }
  }

  // Otherwise, use the ledger (handles mid-innings by_over checks).
  const bowlerInnings = new Set();
  for (const o of overs || []) {
    if ((o.bowlNames || []).some(n => n.toLowerCase().includes(needle))) {
      bowlerInnings.add(o.inningsId);
    }
  }
  if (bowlerInnings.size === 0) return null; // bowler hasn't bowled in the window yet

  for (const innId of bowlerInnings) {
    const innings = match.innings.find(i => i.inningsId === innId);
    if (!innings) continue;
    if (!isOverComplete(innings, by_over)) continue;

    const upto = (overs || [])
      .filter(o => o.inningsId === innId
                   && Math.round(parseFloat(o.overs)) <= by_over
                   && (o.bowlNames || []).some(n => n.toLowerCase().includes(needle)))
      .sort((a, b) => b.overs - a.overs);
    if (upto.length === 0) return null;   // bowler didn't bowl in-window before by_over — can't conclude
    const latest = upto[0];
    return (latest.bowlWickets ?? 0) >= min_wickets;
  }
  return null;
}

// player_match_stat: "Will <player> take a wicket today?" (stat_kind='wicket')
// Scorecard is the source of truth. Wickets are monotonic, so the YES branch
// can fire the moment we see ≥1 wicket — no need to wait for match-complete.
// Only the NO case (player never took one) needs the match to end.
function evalPlayerMatchStat(condition, match, scorecard) {
  if (!scorecard) return null;
  const { player, stat_kind } = condition;
  const kind = stat_kind || 'wicket';
  const needle = String(player || '').toLowerCase();
  if (!needle) return null;

  if (kind === 'wicket') {
    // Monotonic early-YES: any innings in which this bowler has ≥1 wicket.
    for (const inn of scorecard.innings || []) {
      const b = (inn.bowlers || []).find(x => playerNameMatches(player, x.name));
      if (b && (b.wickets ?? 0) >= 1) return true;
    }
    // NO only when the match itself is complete — until then they might still bowl.
    if (!match.result && match.state !== 'Complete') return null;
    return false;
  }
  // Future: 'boundary', 'run', etc.
  return null;
}

// player_runs: "Will <player> score N+ runs in this match?"
// Resolves YES the moment the batsman crosses the threshold (runs are monotonic
// — they can only go up). Resolves NO if the batsman is dismissed below the
// threshold (can't score any more), OR if the match ends and the batsman never
// reached it (including the case where they never came to bat).
function evalPlayerRuns(condition, match, scorecard) {
  if (!scorecard) return null;
  const { player, threshold, operator } = condition;
  if (!player || typeof threshold !== 'number') return null;
  const op = operator || '>=';

  for (const inn of scorecard.innings || []) {
    const b = (inn.batsmen || []).find(x => playerNameMatches(player, x.name));
    if (!b) continue;
    const runs = b.runs ?? 0;
    // Monotonic early-YES for >= and > thresholds.
    if ((op === '>=' || op === '>') && compare(runs, op, threshold) === true) return true;
    // Final NO: out below threshold can't recover any more runs.
    if (b.isOut && (op === '>=' || op === '>') && runs < threshold) return false;
    // For "below"/"equals" thresholds (rare for player_runs but allowed),
    // the answer is locked when the batsman is out OR the match completes.
    if ((op === '<=' || op === '<' || op === '=') && b.isOut) return compare(runs, op, threshold);
  }

  // Match-end fallback: if we still don't have a definitive answer and the
  // match is over, lock in based on whatever final state exists. Player who
  // never came to bat → resolve NO (didn't reach threshold).
  if (match.result || match.state === 'Complete') {
    for (const inn of scorecard.innings || []) {
      const b = (inn.batsmen || []).find(x => playerNameMatches(player, x.name));
      if (b) return compare(b.runs ?? 0, op, threshold);
    }
    return false;
  }
  return null;
}

// player_wickets: "Will <bowler> take N+ wickets in this match?"
// Resolves YES the moment they reach the threshold (wickets monotonic).
// Resolves NO when the bowler has bowled their full T20 quota (4 overs)
// without reaching it, OR the relevant innings is over and they can't bowl
// more, OR the match completes with them short.
function evalPlayerWickets(condition, match, scorecard) {
  if (!scorecard) return null;
  const { player, threshold, operator } = condition;
  if (!player || typeof threshold !== 'number') return null;
  const op = operator || '>=';
  const MAX_OVERS_T20 = 4;

  for (const inn of scorecard.innings || []) {
    const b = (inn.bowlers || []).find(x => playerNameMatches(player, x.name));
    if (!b) continue;
    const wkts = b.wickets ?? 0;
    const oversBowled = parseFloat(b.overs) || 0;

    // Monotonic early-YES.
    if ((op === '>=' || op === '>') && compare(wkts, op, threshold) === true) return true;
    // Bowler done (full quota) below threshold → NO.
    if (oversBowled >= MAX_OVERS_T20 && (op === '>=' || op === '>') && wkts < threshold) return false;
    // The innings the bowler is in has ended (all out or 20 overs done) and
    // they didn't bowl their full quota — they can't bowl more in this match.
    const battingInn = inn; // batting team's innings is what the bowler bowled to
    const inningsClosed = (battingInn.bowlers && battingInn.bowlers.length) &&
      ((parseFloat(battingInn.batTeamDetails?.overs) || 0) >= 20 || (battingInn.batTeamDetails?.batsmenData && Object.values(battingInn.batTeamDetails.batsmenData).filter(x => x.outDesc && x.outDesc !== 'not out' && x.outDesc !== 'batting' && x.outDesc !== '').length >= 10));
    if (inningsClosed && (op === '>=' || op === '>') && wkts < threshold) return false;
  }

  if (match.result || match.state === 'Complete') {
    for (const inn of scorecard.innings || []) {
      const b = (inn.bowlers || []).find(x => playerNameMatches(player, x.name));
      if (b) return compare(b.wickets ?? 0, op, threshold);
    }
    return false;
  }
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// Monotonic short-circuit for run totals (scores only go up during an innings /
// phase window). Returns true/false if the outcome is already locked, null if
// we should keep waiting. `=` never early-resolves — more runs could come in.
function earlyResolveRuns(value, operator, threshold) {
  switch (operator) {
    case '>=': return value >= threshold ? true  : null;
    case '>':  return value >  threshold ? true  : null;
    case '<=': return value >  threshold ? false : null;
    case '<':  return value >= threshold ? false : null;
    default:   return null;
  }
}

function findOverEntry(overs, inningsId, overNumber) {
  if (!Array.isArray(overs)) return null;
  return overs.find(o =>
    o.inningsId === inningsId &&
    Math.round(parseFloat(o.overs)) === overNumber
  ) || null;
}

// Current striker / non-striker runs — only available while the batsman is at
// the crease. Once out, they disappear from miniscore. For match contracts this
// window (striker visible → out) is enough to trigger a YES resolution; the NO
// case is handled by the `by_over` deadline.
function findBatsmanRuns(match, name) {
  const needle = String(name || '').toLowerCase();
  if (!needle) return null;
  const c = match.current;
  if (!c) return null;
  for (const b of [c.batsmanStriker, c.batsmanNonStriker]) {
    if (b?.name?.toLowerCase().includes(needle)) return b.runs ?? 0;
  }
  return null;
}

// Match a DB player name against a Cricbuzz scorecard name. iplt20 and
// Cricbuzz occasionally spell the same player differently (Mohammad ↔
// Mohammed, "M. Siddharth" ↔ "Manimaran Siddharth", etc.). Surname equality
// plus any first-initial / first-token overlap is a reliable signal they're
// the same player.
function playerNameMatches(queryName, candidateName) {
  if (!queryName || !candidateName) return false;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s.]/g, ' ').replace(/\s+/g, ' ').trim();
  const q = norm(queryName).split(/[\s.]+/).filter(Boolean);
  const c = norm(candidateName).split(/[\s.]+/).filter(Boolean);
  if (q.length === 0 || c.length === 0) return false;
  // Last-token (surname) must match exactly.
  if (q[q.length - 1] !== c[c.length - 1]) return false;
  // Plus: at least one earlier token overlaps, either as full word or by
  // first letter (so "M Siddharth" matches "Manimaran Siddharth").
  const qFirst = q.slice(0, -1);
  const cFirst = c.slice(0, -1);
  if (qFirst.length === 0 || cFirst.length === 0) return true;
  for (const a of qFirst) {
    for (const b of cFirst) {
      if (a === b) return true;
      if (a[0] === b[0]) return true;
    }
  }
  return false;
}

function currentInningsOvers(match) {
  if (!match.current) return null;
  const inn = match.innings.find(i => i.inningsId === match.current.inningsId);
  if (!inn) return null;
  return oversAsFraction(inn.overs);
}

// True if any evaluator in the set requires the per-over fetch.
function needsOverByOver(type) {
  return type === 'runs_over'
      || type === 'wicket_over'
      || type === 'boundary_over'
      || type === 'runs_powerplay'
      || type === 'wickets_powerplay'
      || type === 'boundaries_powerplay'
      || type === 'runs_death'
      || type === 'wickets_death'
      || type === 'boundaries_death'
      || type === 'bowler_wickets_by_over';
}

// True if any evaluator in the set requires the (heavier) scorecard fetch.
function needsScorecard(type) {
  return type === 'player_match_stat'
      || type === 'bowler_wickets_by_over'
      || type === 'batsman_milestone'
      || type === 'player_runs'
      || type === 'player_wickets';
}

// Human-readable explanation of why a contract is still pending. Called only
// when evaluate() returned null — stored on the contract's `last_eval_reason`
// column so admins can see "waiting for over 8 (match at 5.3)" directly on the
// list, instead of tailing backend logs.
function describePending(condition, match, overs, scorecard) {
  const type = condition.type;
  const team = condition.team || condition.batting_team;
  const innings = team ? findInningsForTeam(match, team) : null;
  const played = innings ? parseFloat(innings.overs || 0) : null;
  const at = played != null ? `match at ov ${played.toFixed(1)}` : 'match not started';

  switch (type) {
    case 'runs_over':
    case 'wicket_over':
    case 'boundary_over': {
      if (!innings) return 'Team innings not started';
      if (played < condition.over) return `Waiting for over ${condition.over} (${at})`;
      return `Over ${condition.over} in progress — waiting for 6th ball`;
    }
    case 'team_total':
      if (!innings) return 'Team innings not started';
      return `${innings.batTeamName} at ${innings.score}/${innings.wickets} in ${played.toFixed(1)} ov — waiting to cross ${condition.threshold} or for over ${condition.by_over}`;
    case 'team_wickets_by_over':
      if (!innings) return 'Team innings not started';
      return `${innings.wickets} wicket${innings.wickets === 1 ? '' : 's'} so far — waiting for ${condition.min_wickets} or end of over ${condition.by_over}`;
    case 'innings_score':
      if (!innings) return `Innings ${condition.innings} not started`;
      return `${innings.batTeamName} at ${innings.score} — waiting to cross ${condition.threshold} or innings to end`;
    case 'batsman_milestone': {
      const c = match.current;
      const onStrike = [c?.batsmanStriker, c?.batsmanNonStriker].find(b => b?.name?.toLowerCase().includes(String(condition.batsman || '').toLowerCase()));
      if (onStrike) return `${onStrike.name} on ${onStrike.runs} — needs ${condition.milestone} by ov ${condition.by_over}`;
      return `${condition.batsman} not currently batting — will resolve NO after ov ${condition.by_over}`;
    }
    case 'bowler_wickets_by_over': {
      if (!scorecard) return `Waiting for bowler stats`;
      for (const inn of scorecard.innings || []) {
        const b = (inn.bowlers || []).find(x => x.name?.toLowerCase().includes(String(condition.bowler || '').toLowerCase()));
        if (b) return `${b.name} at ${b.wickets} wkts — needs ${condition.min_wickets} by ov ${condition.by_over}`;
      }
      return `${condition.bowler} hasn't bowled yet`;
    }
    case 'runs_powerplay':
    case 'wickets_powerplay':
    case 'boundaries_powerplay':
      if (!innings) return 'Team innings not started';
      if (played < 6) return `Powerplay (ov 1-6) in progress (${at})`;
      return `Waiting for ledger coverage of powerplay (ov 1-6)`;
    case 'runs_death':
    case 'wickets_death':
    case 'boundaries_death':
      if (!innings) return 'Team innings not started';
      if (played < 20) return `Death overs (ov 16-20) not yet complete (${at})`;
      return `Waiting for ledger coverage of death overs (ov 16-20)`;
    case 'match_winner':
      if (!match.result) return `Match in progress — ${match.status || match.state || 'awaiting result'}`;
      return 'Pending';
    case 'toss_winner':
      return 'Waiting for toss data';
    case 'player_match_stat':
      if (!match.result && match.state !== 'Complete') return `Match in progress — ${match.status || match.state}`;
      return 'Pending';
    case 'player_runs':
      if (!scorecard) return `Waiting for scorecard`;
      for (const inn of scorecard.innings || []) {
        const b = (inn.bowlers || inn.batsmen || []).find(x => x.name && condition.player && x.name.toLowerCase().includes(String(condition.player).toLowerCase()));
        // Try batsmen specifically
        const batter = (inn.batsmen || []).find(x => x.name && condition.player && x.name.toLowerCase().includes(String(condition.player).toLowerCase()));
        if (batter) return `${batter.name} on ${batter.runs} — needs ${condition.threshold} (${batter.isOut ? 'out' : 'still batting'})`;
      }
      return `${condition.player} hasn't batted yet`;
    case 'player_wickets':
      if (!scorecard) return `Waiting for scorecard`;
      for (const inn of scorecard.innings || []) {
        const bowler = (inn.bowlers || []).find(x => x.name && condition.player && x.name.toLowerCase().includes(String(condition.player).toLowerCase()));
        if (bowler) return `${bowler.name} at ${bowler.wickets} wkts in ${bowler.overs} ov — needs ${condition.threshold}`;
      }
      return `${condition.player} hasn't bowled yet`;
    default:
      return `Pending (${type})`;
  }
}

function evaluate(condition, match, overs, scorecard) {
  switch (condition.type) {
    // Single-over
    case 'runs_over':               return evalRunsOver(condition, match, overs);
    case 'wicket_over':             return evalWicketOver(condition, match, overs);
    case 'boundary_over':           return evalBoundaryOver(condition, match, overs);

    // By-over cumulative
    case 'team_total':              return evalTeamTotal(condition, match, overs);
    case 'team_wickets_by_over':    return evalTeamWicketsByOver(condition, match, overs);
    case 'batsman_milestone':       return evalBatsmanMilestone(condition, match, scorecard);
    case 'bowler_wickets_by_over':  return evalBowlerWicketsByOver(condition, match, overs, scorecard);

    // Phase aggregates (overs 1–6 / 16–20)
    case 'runs_powerplay':          return evalOverRangeAggregate(condition, match, overs, POWERPLAY, 'runs');
    case 'wickets_powerplay':       return evalOverRangeAggregate(condition, match, overs, POWERPLAY, 'wickets');
    case 'boundaries_powerplay':    return evalOverRangeAggregate(condition, match, overs, POWERPLAY, 'boundaries');
    case 'runs_death':              return evalOverRangeAggregate(condition, match, overs, DEATH, 'runs');
    case 'wickets_death':           return evalOverRangeAggregate(condition, match, overs, DEATH, 'wickets');
    case 'boundaries_death':        return evalOverRangeAggregate(condition, match, overs, DEATH, 'boundaries');

    // Match-level
    case 'innings_score':           return evalInningsScore(condition, match);
    case 'match_winner':            return evalMatchWinner(condition, match);
    case 'toss_winner':             return evalTossWinner(condition, match);
    case 'player_match_stat':       return evalPlayerMatchStat(condition, match, scorecard);
    case 'player_runs':             return evalPlayerRuns(condition, match, scorecard);
    case 'player_wickets':          return evalPlayerWickets(condition, match, scorecard);

    default:                        return null; // manual / custom / unknown types stay pending
  }
}

// ── Main poll loop ─────────────────────────────────────────────────────────────

async function pollAndResolve() {
  if (process.env.ENABLE_CRICBUZZ_RESOLVER === 'false') return;
  health.lastPollStartedAt = Date.now();
  health.lastPollError = null;

  const contracts = db.prepare(
    "SELECT * FROM contracts " +
    "WHERE status = 'active' AND resolve_mode = 'auto' AND type != 'manual' " +
    "  AND (phase IS NULL OR phase != 'season') " +
    "  AND match_id IS NOT NULL AND match_id != ''"
  ).all();

  if (contracts.length === 0) {
    // Nothing to poll, but still mark the cycle as finished so the admin's
    // resolver-health dot stays green instead of "unknown" when the market is
    // quiet (no active auto contracts).
    health.lastPollFinishedAt = Date.now();
    return;
  }

  // Group contracts by match_id so we only fetch each match once per poll.
  const byMatch = new Map();
  for (const c of contracts) {
    if (!byMatch.has(c.match_id)) byMatch.set(c.match_id, []);
    byMatch.get(c.match_id).push(c);
  }

  for (const [matchId, group] of byMatch) {
    let match;
    try {
      match = await fetchMatch(matchId);
      const h = health.perMatch.get(matchId) || {};
      h.lastOkAt = Date.now();
      h.lastError = null;
      health.perMatch.set(matchId, h);
    }
    catch (e) {
      const h = health.perMatch.get(matchId) || {};
      h.lastErrorAt = Date.now();
      h.lastError = e.message;
      health.perMatch.set(matchId, h);
      console.warn(`[cricbuzz-resolver] fetchMatch(${matchId}) failed: ${e.message}`);
      continue;
    }

    cache.matchData = match;
    cache.fetchedAt = Date.now();

    // Fetch per-over data once if any contract in this group needs it, and
    // merge the (rolling) window into our accumulated ledger so phase contracts
    // retain coverage after the OBO window has moved past their range.
    const types = group.map(c => { try { return JSON.parse(c.condition_json).type; } catch { return null; } });
    const anyNeedsOvers     = types.some(t => t && needsOverByOver(t));
    const anyNeedsScorecard = types.some(t => t && needsScorecard(t));

    if (anyNeedsOvers) {
      try { ingestOvers(matchId, (await fetchOverByOver(matchId)).overs); }
      catch (e) {
        console.warn(`[cricbuzz-resolver] fetchOverByOver(${matchId}) failed: ${e.message}`);
      }
    }
    const overs = getLedgerOvers(matchId);

    let scorecard = null;
    if (anyNeedsScorecard) {
      try { scorecard = await fetchScorecard(matchId); }
      catch (e) {
        console.warn(`[cricbuzz-resolver] fetchScorecard(${matchId}) failed: ${e.message}`);
      }
    }

    for (const contract of group) {
      let condition;
      try { condition = JSON.parse(contract.condition_json); } catch { continue; }

      const result = evaluate(condition, match, overs, scorecard);
      if (result === null) {
        const reason = describePending(condition, match, overs, scorecard);
        db.prepare(`UPDATE contracts SET last_eval_reason = ?, last_eval_at = CURRENT_TIMESTAMP WHERE id = ?`).run(reason, contract.id);
        console.log(`[cricbuzz-resolver] ${contract.id} "${contract.title}" → pending (${reason})`);
        continue;
      }

      const resolution = result ? 'YES' : 'NO';
      console.log(`[cricbuzz-resolver] ${contract.id} "${contract.title}" → ${resolution} (settling in 60–90s)`);

      // Tip off the informed bot before settlement happens.
      setResolutionHint(contract.id, resolution);

      const contractId = contract.id;
      setTimeout(() => {
        const current = db.prepare('SELECT status FROM contracts WHERE id = ?').get(contractId);
        if (current?.status === 'active') {
          settleContract(contractId, resolution);
          console.log(`[cricbuzz-resolver] Settled contract ${contractId} as ${resolution}`);
        }
      }, randomBetween(60000, 90000));
    }
  }
  health.lastPollFinishedAt = Date.now();
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min) + min);
}

function startResolver() {
  if (pollInterval) return;
  const minutes = parseInt(process.env.CRIC_POLL_MINUTES || '2');
  pollInterval = setInterval(pollAndResolve, minutes * 60 * 1000);
  // Fire an initial poll immediately — otherwise setInterval waits for the
  // full interval before its first tick, so a 60-min cadence means the health
  // dot is "unknown" for up to an hour after boot.
  setTimeout(() => pollAndResolve().catch(e => console.warn('[cricbuzz-resolver] initial poll failed:', e.message)), 500);
  console.log(`[cricbuzz-resolver] Started — polling every ${minutes} min. Set ENABLE_CRICBUZZ_RESOLVER=false to disable.`);
}

function stopResolver() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;
}

function setPollInterval(minutes) {
  const ms = Math.max(1, parseInt(minutes)) * 60 * 1000;
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollAndResolve, ms);
  process.env.CRIC_POLL_MINUTES = String(Math.max(1, parseInt(minutes)));
  console.log(`[cricbuzz-resolver] Poll interval → ${minutes} min`);
}

function getPollInterval() {
  return parseInt(process.env.CRIC_POLL_MINUTES || '2');
}

module.exports = {
  startResolver,
  stopResolver,
  getCachedMatchData,
  getCachedFetchedAt,
  setPollInterval,
  getPollInterval,
  getHealth,
  // Exposed for tests + dev simulation endpoints
  _pollAndResolve: pollAndResolve,
  _evaluate: evaluate,
  _setCachedMatchData,
  _clearCachedMatchData,
};

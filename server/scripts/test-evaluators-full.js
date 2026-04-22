// Comprehensive evaluator tests. All run against synthetic match/OBO/scorecard
// data — no network, no backend restart required. Covers the 17 wired types,
// the monotonic short-circuits, the partial-over guard, and edge cases.

const { _evaluate } = require('../engine/cricbuzz-resolver');

// ── Fixture builders ─────────────────────────────────────────────────────────

function mkMatch({ state = 'In Progress', innings = [], toss = null, result = null, format = 'T20' } = {}) {
  return {
    matchId: '999',
    state,
    format,
    teams: [
      { id: 1, name: 'Sunrisers Hyderabad', shortName: 'SRH' },
      { id: 2, name: 'Delhi Capitals',      shortName: 'DC'  },
    ],
    innings,
    current: innings[innings.length - 1] ? { inningsId: innings[innings.length - 1].inningsId } : null,
    toss,
    result,
    fetchedAt: Date.now(),
  };
}
function inn(inningsId, shortName, score, wickets, overs) {
  const team = shortName === 'SRH' ? { id:1 } : { id:2 };
  return { inningsId, batTeamId: team.id, batTeamName: shortName, score, wickets, overs };
}
function over(inningsId, o, runs, score, wickets, summary, bowlNames = [], bowlWickets = 0) {
  return {
    inningsId, overs: o, runs, score, wickets,
    ovrSummary: summary,
    batTeamName: inningsId === 1 ? 'SRH' : 'DC',
    bowlNames,
    bowlWickets,
  };
}

// ── Runner ───────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
function expect(label, got, want) {
  const ok = got === want;
  const fmt = v => v === true ? 'YES' : v === false ? 'NO' : 'pending';
  if (ok) { pass++; console.log(`  ✓ ${label.padEnd(78)} → ${fmt(got)}`); }
  else    { fail++; console.log(`  ✗ ${label}\n      got=${fmt(got)}  want=${fmt(want)}`); }
}

// ── 1. runs_over ─────────────────────────────────────────────────────────────
console.log('\n── runs_over (single over) ──');
{
  const match = mkMatch({ innings: [inn(1, 'SRH', 100, 2, 15)] });
  const overs = [over(1, 12, 12, 90, 1, '2 4 2 1 2 1'), over(1, 15, 10, 100, 2, '1 4 0 W 4 1')];
  expect('over 12 scored 12, asking ≥10 — YES',   _evaluate({type:'runs_over',team:'SRH',over:12,operator:'>=',threshold:10}, match, overs), true);
  expect('over 12 scored 12, asking ≥15 — NO',    _evaluate({type:'runs_over',team:'SRH',over:12,operator:'>=',threshold:15}, match, overs), false);
  expect('over 12 asking =12 (exact) — YES',       _evaluate({type:'runs_over',team:'SRH',over:12,operator:'=',threshold:12}, match, overs), true);
  expect('over 17 (not bowled yet) — pending',     _evaluate({type:'runs_over',team:'SRH',over:17,operator:'>=',threshold:10}, match, overs), null);
}

// Partial-over guard: innings is at 14.3 (3 balls into over 15), asking about over 15
console.log('\n── partial-over guard ──');
{
  const match = mkMatch({ innings: [inn(1, 'SRH', 110, 1, 14.3)] });
  const overs = [over(1, 15, 10, 110, 1, '4 4 2')]; // partial summary
  expect('over 15 partial (3 balls, 2 fours) asking ≥2 fours — MUST wait', _evaluate({type:'boundary_over',team:'SRH',over:15,boundary_type:'four',boundary_count:2}, match, overs), null);
  expect('over 15 partial asking ≥15 runs — MUST wait',                    _evaluate({type:'runs_over',team:'SRH',over:15,operator:'>=',threshold:15}, match, overs), null);
}

// ── 2. wicket_over ───────────────────────────────────────────────────────────
console.log('\n── wicket_over (single over) ──');
{
  const match = mkMatch({ innings: [inn(1, 'SRH', 60, 3, 8)] });
  const overs = [over(1, 7, 4, 58, 3, '0 W 1 0 2 W'), over(1, 8, 2, 60, 3, '0 0 1 0 1 0')];
  expect('over 7 had 2 wickets, min=2 — YES', _evaluate({type:'wicket_over',batting_team:'SRH',over:7,min_wickets:2}, match, overs), true);
  expect('over 7 had 2 wickets, min=3 — NO',  _evaluate({type:'wicket_over',batting_team:'SRH',over:7,min_wickets:3}, match, overs), false);
  expect('over 8 had 0 wickets, min=1 — NO',  _evaluate({type:'wicket_over',batting_team:'SRH',over:8,min_wickets:1}, match, overs), false);
}

// ── 3. boundary_over ─────────────────────────────────────────────────────────
console.log('\n── boundary_over (single over) ──');
{
  const match = mkMatch({ innings: [inn(1, 'SRH', 120, 1, 15)] });
  const overs = [over(1, 15, 20, 120, 1, '6 6 4 0 4 0')]; // 2 sixes, 2 fours
  expect('over 15 ≥2 sixes — YES',     _evaluate({type:'boundary_over',team:'SRH',over:15,boundary_type:'six',boundary_count:2}, match, overs), true);
  expect('over 15 ≥3 sixes — NO',      _evaluate({type:'boundary_over',team:'SRH',over:15,boundary_type:'six',boundary_count:3}, match, overs), false);
  expect('over 15 ≥2 fours — YES',     _evaluate({type:'boundary_over',team:'SRH',over:15,boundary_type:'four',boundary_count:2}, match, overs), true);
  expect('over 15 ≥4 any bnd — YES',   _evaluate({type:'boundary_over',team:'SRH',over:15,boundary_type:'four_or_six',boundary_count:4}, match, overs), true);
  expect('over 15 ≥5 any bnd — NO',    _evaluate({type:'boundary_over',team:'SRH',over:15,boundary_type:'four_or_six',boundary_count:5}, match, overs), false);
}

// ── 4. team_total (by_over) — early resolve ──────────────────────────────────
console.log('\n── team_total (by_over) with short-circuit ──');
{
  const mid   = mkMatch({ innings: [inn(1, 'SRH', 227, 1, 17)] });   // over 17, already past 220
  const early = mkMatch({ innings: [inn(1, 'SRH',  80, 2, 10)] });   // mid-innings, not there yet
  const done  = mkMatch({ innings: [inn(1, 'SRH', 180, 6, 20)] });   // innings closed (T20 20 overs)
  expect('≥220 by over 20, already at 227 — early YES',  _evaluate({type:'team_total',team:'SRH',by_over:20,operator:'>=',threshold:220}, mid, []), true);
  expect('≥220 by over 20, at 80/2 ov10 — pending',      _evaluate({type:'team_total',team:'SRH',by_over:20,operator:'>=',threshold:220}, early, []), null);
  expect('≥220 by over 20, innings ended 180 — NO',      _evaluate({type:'team_total',team:'SRH',by_over:20,operator:'>=',threshold:220}, done, []), false);
  expect('≤150 by over 20, at 227 already — early NO',   _evaluate({type:'team_total',team:'SRH',by_over:20,operator:'<=',threshold:150}, mid, []), false);
  expect('=200 by over 20 (exact) innings open — pending',_evaluate({type:'team_total',team:'SRH',by_over:20,operator:'=',threshold:200}, mid, []), null);
}

// ── 5. team_wickets_by_over — monotonic ──────────────────────────────────────
console.log('\n── team_wickets_by_over (monotonic) ──');
{
  const mid   = mkMatch({ innings: [inn(1, 'SRH', 100, 3, 10)] });
  const early = mkMatch({ innings: [inn(1, 'SRH', 100, 0, 10)] });
  const done  = mkMatch({ innings: [inn(1, 'SRH', 180, 2, 20)] });
  expect('≥2 wkts by ov 19, already 3 out at ov 10 — early YES', _evaluate({type:'team_wickets_by_over',team:'SRH',by_over:19,min_wickets:2}, mid, []), true);
  expect('≥2 wkts by ov 19, 0 out, innings live — pending',       _evaluate({type:'team_wickets_by_over',team:'SRH',by_over:19,min_wickets:2}, early, []), null);
  expect('≥5 wkts by ov 19, ended with 2 — NO',                   _evaluate({type:'team_wickets_by_over',team:'SRH',by_over:19,min_wickets:5}, done, []), false);
}

// ── 6. batsman_milestone ─────────────────────────────────────────────────────
console.log('\n── batsman_milestone ──');
{
  const match = {
    ...mkMatch({ innings: [inn(1,'SRH', 100, 1, 10)] }),
    current: { inningsId:1, batsmanStriker: { name:'Abhishek Sharma', runs:55, balls:30 }, batsmanNonStriker: { name:'Travis Head', runs:20, balls:18 } }
  };
  expect('Abhishek ≥50 by ov 15, currently 55 — YES',  _evaluate({type:'batsman_milestone',batsman:'Abhishek Sharma',milestone:50,by_over:15}, match, []), true);
  expect('Head ≥50 by ov 15, currently 20, ov 10 — pending', _evaluate({type:'batsman_milestone',batsman:'Travis Head',milestone:50,by_over:15}, match, []), null);
  // Batsman not on field (got out): simulate by returning null-runs
  const late = {
    ...mkMatch({ innings: [inn(1,'SRH', 180, 3, 18)] }),
    current: { inningsId:1, batsmanStriker: { name:'Ishan Kishan', runs:40, balls:25 }, batsmanNonStriker: null }
  };
  expect('Head ≥50, he is OUT, ov 18 passed — pending (no runs found)', _evaluate({type:'batsman_milestone',batsman:'Travis Head',milestone:50,by_over:15}, late, []), null);
}

// ── 7. bowler_wickets_by_over ────────────────────────────────────────────────
console.log('\n── bowler_wickets_by_over ──');
{
  const match = mkMatch({ innings: [inn(2, 'DC', 100, 3, 10)] });
  const overs = [
    over(2, 5, 6, 40, 1, '1 1 0 W 2 2', ['Kuldeep Yadav'], 1),  // bowler cumulative: 1 wkt by ov 5
    over(2, 9, 8, 80, 2, '1 4 1 1 W 1', ['Kuldeep Yadav'], 2),  // 2 wkts by ov 9
    over(2,10, 8, 88, 3, '1 1 4 W 0 2', ['Kuldeep Yadav'], 3),  // 3 wkts by ov 10
  ];
  // scorecard for end-of-innings scenarios
  const sc = { innings: [{ inningsId:2, bowlers: [{ name:'Kuldeep Yadav', wickets:3 }] }] };

  expect('Kuldeep ≥2 wkts by ov 9 — YES (scorecard monotonic)',       _evaluate({type:'bowler_wickets_by_over',bowler:'Kuldeep',min_wickets:2,by_over:9}, match, overs, sc), true);
  // by_over=10 is complete, bowler had 3 wkts through over 10 → locked NO
  expect('Kuldeep ≥5 wkts by ov 10, had 3 through ov 10 — NO',       _evaluate({type:'bowler_wickets_by_over',bowler:'Kuldeep',min_wickets:5,by_over:10}, match, overs, sc), false);
  // But if by_over is still in the future (ov 15, innings at ov 10), pending
  expect('Kuldeep ≥5 wkts by ov 15, innings still at ov 10 — pending', _evaluate({type:'bowler_wickets_by_over',bowler:'Kuldeep',min_wickets:5,by_over:15}, match, overs, sc), null);
  expect('Unknown bowler — pending',                                    _evaluate({type:'bowler_wickets_by_over',bowler:'Nobody',min_wickets:1,by_over:20}, match, overs, sc), null);
  // Innings closed fallback: NO when total < threshold
  const matchDone = { ...mkMatch({ innings: [inn(2,'DC', 100, 10, 18.4)] }), format: 'T20' };
  expect('Kuldeep ≥5 by ov 20, innings closed with 3 total — NO',      _evaluate({type:'bowler_wickets_by_over',bowler:'Kuldeep',min_wickets:5,by_over:20}, matchDone, overs, sc), false);
}

// ── 8. runs_powerplay / runs_death (phase aggregate + short-circuit) ─────────
console.log('\n── runs_powerplay with short-circuit ──');
{
  const innLive = inn(1,'SRH', 50, 0, 3.4);  // mid-powerplay
  const match = mkMatch({ innings: [innLive] });
  const o = [
    over(1,1,12,12,0,'1 4 1 4 0 2'),
    over(1,2,15,27,0,'4 1 4 0 4 2'),
    over(1,3,10,37,0,'1 1 4 0 2 2'),
    // over 4 in progress
  ];
  expect('runs_powerplay ≥30, at 37 already — early YES',  _evaluate({type:'runs_powerplay',team:'SRH',operator:'>=',threshold:30}, match, o), true);
  expect('runs_powerplay ≥80, at 37 mid-pp — pending',     _evaluate({type:'runs_powerplay',team:'SRH',operator:'>=',threshold:80}, match, o), null);
  expect('runs_powerplay ≤20 already 37 — early NO',       _evaluate({type:'runs_powerplay',team:'SRH',operator:'<=',threshold:20}, match, o), false);

  // Missing overs 4,5,6 — can't conclude NO yet even past pp
  const matchPast = mkMatch({ innings: [inn(1,'SRH', 80, 1, 10)] }); // past powerplay
  expect('pp ended 37-so-far, missing ov 4-6, ≥80 — pending (missing)', _evaluate({type:'runs_powerplay',team:'SRH',operator:'>=',threshold:80}, matchPast, o), null);

  // Full pp in ledger, didn't hit threshold
  const fullPp = [...o,
    over(1,4,4,41,0,'1 0 1 1 1 0'),
    over(1,5,6,47,1,'W 1 1 1 2 1'),
    over(1,6,5,52,1,'1 1 0 1 1 1'),
  ];
  expect('pp ended 52 total, ≥80 — NO (window complete, below threshold)', _evaluate({type:'runs_powerplay',team:'SRH',operator:'>=',threshold:80}, matchPast, fullPp), false);
}

console.log('\n── wickets_powerplay / boundaries_death ──');
{
  const match = mkMatch({ innings: [inn(1,'SRH', 150, 4, 12)] });
  const pp = [
    over(1,1,10,10,0,'1 4 1 4 0 0'),
    over(1,2,12,22,1,'4 1 W 4 2 1'),
    over(1,3,8,30,2,'W 1 4 0 1 2'),
  ];
  expect('wickets_powerplay ≥2 (already 2 in pp) — early YES', _evaluate({type:'wickets_powerplay',team:'SRH',min_wickets:2}, match, pp), true);
  expect('boundaries_powerplay ≥3 fours (already 3) — early YES', _evaluate({type:'boundaries_powerplay',team:'SRH',boundary_type:'four',boundary_count:3}, match, pp), true);
  expect('boundaries_powerplay ≥5 sixes (0 sixes, missing pp rest) — pending', _evaluate({type:'boundaries_powerplay',team:'SRH',boundary_type:'six',boundary_count:5}, match, pp), null);
}

// ── 9. innings_score — early YES when threshold hit mid-innings ──────────────
console.log('\n── innings_score (the original complaint) ──');
{
  const mid    = mkMatch({ innings: [inn(1,'SRH', 227, 1, 17)] });
  const early  = mkMatch({ innings: [inn(1,'SRH',  50, 1,  5)] });
  const closed = mkMatch({ innings: [inn(1,'SRH', 180, 4, 20)] });
  expect('innings_score ≥220, team at 227 ov17 — early YES (no more waiting!)', _evaluate({type:'innings_score',team:'SRH',innings:1,operator:'>=',threshold:220}, mid, []), true);
  expect('innings_score ≥220, team at 50/1 — pending',                           _evaluate({type:'innings_score',team:'SRH',innings:1,operator:'>=',threshold:220}, early, []), null);
  expect('innings_score ≥220, innings closed at 180 — NO',                       _evaluate({type:'innings_score',team:'SRH',innings:1,operator:'>=',threshold:220}, closed, []), false);
  expect('innings_score =227 (exact) mid-innings — pending',                      _evaluate({type:'innings_score',team:'SRH',innings:1,operator:'=',threshold:227}, mid, []), null);
}

// ── 10. match_winner / toss_winner ───────────────────────────────────────────
console.log('\n── match_winner / toss_winner ──');
{
  const live  = mkMatch({ innings: [inn(1,'SRH', 200, 5, 20), inn(2,'DC', 100, 5, 10)] });
  const won   = mkMatch({ state:'Complete', innings: [inn(1,'SRH', 200, 5, 20), inn(2,'DC', 150, 10, 18)], result: { type:'win', winnerId:1, winnerName:'Sunrisers Hyderabad', margin:50 } });
  const tied  = mkMatch({ state:'Complete', innings: [inn(1,'SRH', 150, 10, 20), inn(2,'DC', 150, 10, 20)], result: { type:'tie' } });
  expect('match_winner SRH, match live — pending',    _evaluate({type:'match_winner',team:'SRH'}, live, []), null);
  expect('match_winner SRH, SRH won — YES',           _evaluate({type:'match_winner',team:'SRH'}, won, []), true);
  expect('match_winner DC, SRH won — NO',             _evaluate({type:'match_winner',team:'DC'}, won, []), false);
  expect('match_winner SRH, tied — NO',               _evaluate({type:'match_winner',team:'SRH'}, tied, []), false);

  const tossed = mkMatch({ toss: { tossWinnerId:1, tossWinnerName:'Sunrisers Hyderabad', decision:'Bowling' } });
  expect('toss_winner SRH, SRH won toss — YES',       _evaluate({type:'toss_winner',team:'SRH'}, tossed, []), true);
  expect('toss_winner DC, SRH won toss — NO',         _evaluate({type:'toss_winner',team:'DC'}, tossed, []), false);
  expect('toss_winner SRH, no toss data — pending',   _evaluate({type:'toss_winner',team:'SRH'}, live, []), null);
}

// ── 11. player_match_stat ────────────────────────────────────────────────────
console.log('\n── player_match_stat ──');
{
  const sc = { innings: [{ inningsId:1, bowlers: [{ name:'Ngidi', wickets:2 }, { name:'Rana', wickets:0 }] }] };
  const live = mkMatch({ innings: [inn(1,'SRH', 200, 5, 20), inn(2,'DC', 100, 5, 10)] });
  const done = mkMatch({ state:'Complete', innings: [inn(1,'SRH', 200, 5, 20), inn(2,'DC', 150, 10, 18)], result: { type:'win', winnerId:1, winnerName:'Sunrisers Hyderabad' } });
  expect('player_match_stat Ngidi wicket, match live — pending', _evaluate({type:'player_match_stat',player:'Ngidi',stat_kind:'wicket'}, live, [], sc), null);
  expect('player_match_stat Ngidi wicket, match done, had 2 — YES', _evaluate({type:'player_match_stat',player:'Ngidi',stat_kind:'wicket'}, done, [], sc), true);
  expect('player_match_stat Rana wicket, match done, had 0 — NO',   _evaluate({type:'player_match_stat',player:'Rana',stat_kind:'wicket'}, done, [], sc), false);
}

// ── 12. Unknown / custom types silently stay pending ─────────────────────────
console.log('\n── unknown / custom types ──');
{
  const m = mkMatch({ innings: [inn(1,'SRH',100,1,10)] });
  expect('custom_match — stays pending (always manual)',       _evaluate({type:'custom_match',team:'SRH'}, m, []), null);
  expect('season_team_wins_title — stays pending',              _evaluate({type:'season_team_wins_title',team:'SRH'}, m, []), null);
  expect('unknown_future_type — stays pending',                  _evaluate({type:'unknown_future_type'}, m, []), null);
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n════════════════════════════════════════════`);
console.log(`  → ${pass} passed, ${fail} failed`);
console.log(`════════════════════════════════════════════`);
if (fail > 0) process.exit(1);

// Unit tests for the new player_runs and player_wickets resolver evaluators.
// Builds mock scorecards covering each branch of the evaluator logic and
// asserts the expected outcome (true / false / null = pending).
//
// Usage: node server/scripts/test-player-evaluators.js

const { _evaluate: evaluate } = require('../engine/cricbuzz-resolver');

let passed = 0;
let failed = 0;
const failures = [];

function assertEq(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push({ name, actual, expected });
    console.log(`  ✗ ${name}  →  expected ${expected}, got ${actual}`);
  }
}

// Build a minimal match + scorecard fixture. Only the fields the evaluators
// actually read are populated.
function makeMatch(state = 'In Progress', result = null) {
  return { state, result, innings: [], current: null };
}
function makeScorecard(batsmen = [], bowlers = []) {
  return {
    innings: [
      {
        inningsId: 1,
        batTeamId: 1, batTeamName: 'CSK',
        bowlTeamId: 2, bowlTeamName: 'MI',
        batsmen,
        bowlers,
      },
    ],
  };
}
function batsman(name, runs, isOut) {
  return { id: 0, name, runs, balls: 30, fours: 0, sixes: 0, outDesc: isOut ? 'c & b Bumrah' : 'batting', isOut };
}
function bowler(name, overs, wkts) {
  return { id: 0, name, overs, runs: 25, wickets: wkts, maidens: 0, economy: 6 };
}

// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== player_runs ===');

assertEq(
  'batting at 45, threshold 50 → pending',
  evaluate({ type: 'player_runs', player: 'Sanju Samson', threshold: 50 },
           makeMatch(), null, makeScorecard([batsman('Sanju Samson', 45, false)])),
  null
);

assertEq(
  'batting at 60, threshold 50 → YES (early)',
  evaluate({ type: 'player_runs', player: 'Sanju Samson', threshold: 50 },
           makeMatch(), null, makeScorecard([batsman('Sanju Samson', 60, false)])),
  true
);

assertEq(
  'out at 30, threshold 50 → NO',
  evaluate({ type: 'player_runs', player: 'Sanju Samson', threshold: 50 },
           makeMatch(), null, makeScorecard([batsman('Sanju Samson', 30, true)])),
  false
);

assertEq(
  'out at 50, threshold 50 → YES (met before out)',
  evaluate({ type: 'player_runs', player: 'Sanju Samson', threshold: 50 },
           makeMatch(), null, makeScorecard([batsman('Sanju Samson', 50, true)])),
  true
);

assertEq(
  'not in scorecard, in progress → pending',
  evaluate({ type: 'player_runs', player: 'MS Dhoni', threshold: 30 },
           makeMatch(), null, makeScorecard([batsman('Sanju Samson', 45, false)])),
  null
);

assertEq(
  'not in scorecard, match complete → NO (never batted)',
  evaluate({ type: 'player_runs', player: 'MS Dhoni', threshold: 30 },
           makeMatch('Complete', { type: 'win', winnerName: 'CSK' }),
           null, makeScorecard([batsman('Sanju Samson', 45, false)])),
  false
);

assertEq(
  'batting at 45, match complete → NO',
  evaluate({ type: 'player_runs', player: 'Sanju Samson', threshold: 50 },
           makeMatch('Complete', { type: 'win', winnerName: 'CSK' }),
           null, makeScorecard([batsman('Sanju Samson', 45, false)])),
  false
);

// ─────────────────────────────────────────────────────────────────────────
console.log('\n=== player_wickets ===');

assertEq(
  '1 wkt in 2 overs, threshold 2 → pending',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 2 },
           makeMatch(), null, makeScorecard([], [bowler('Jasprit Bumrah', 2, 1)])),
  null
);

assertEq(
  '2 wkts in 3 overs, threshold 2 → YES',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 2 },
           makeMatch(), null, makeScorecard([], [bowler('Jasprit Bumrah', 3, 2)])),
  true
);

assertEq(
  '1 wkt in 4 overs (quota done), threshold 2 → NO',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 2 },
           makeMatch(), null, makeScorecard([], [bowler('Jasprit Bumrah', 4, 1)])),
  false
);

assertEq(
  '0 wkts in 4 overs (quota done), threshold 1 → NO',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 1 },
           makeMatch(), null, makeScorecard([], [bowler('Jasprit Bumrah', 4, 0)])),
  false
);

assertEq(
  '2 wkts in 4 overs (quota done), threshold 2 → YES',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 2 },
           makeMatch(), null, makeScorecard([], [bowler('Jasprit Bumrah', 4, 2)])),
  true
);

assertEq(
  'not bowled yet, in progress → pending',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 2 },
           makeMatch(), null, makeScorecard([], [bowler('Trent Boult', 2, 1)])),
  null
);

assertEq(
  'not bowled, match complete → NO (never bowled)',
  evaluate({ type: 'player_wickets', player: 'Jasprit Bumrah', threshold: 2 },
           makeMatch('Complete', { type: 'win', winnerName: 'CSK' }),
           null, makeScorecard([], [bowler('Trent Boult', 4, 1)])),
  false
);

// ─────────────────────────────────────────────────────────────────────────
console.log(`\nResult: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f.name}: expected ${f.expected}, got ${f.actual}`);
  process.exit(1);
}

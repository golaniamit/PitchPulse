// Replay harness — steps through a simulated innings over-by-over and
// evaluates each contract at every over boundary. Asserts:
//   - A contract never "flips" verdict (pending → YES → NO is a bug; once YES
//     or NO is reached it must stay there for the rest of the match).
//   - The verdict at a specified over matches what we expect.
//
// Use this to catch regressions after any change to the resolver. Run it:
//   node server/scripts/replay-scenarios.js
//
// Each scenario defines a synthetic innings (over-by-over) plus a list of
// contracts whose expected verdicts at specific overs are known.

const { _evaluate } = require('../engine/cricbuzz-resolver');
const { parseOverSummary } = require('../engine/cricbuzz');

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mkTeams() {
  return [
    { id: 1, name: 'Sunrisers Hyderabad', shortName: 'SRH' },
    { id: 2, name: 'Delhi Capitals',      shortName: 'DC'  },
  ];
}

// Build a match state snapshot representing "end of over K" given an innings
// timeline (array of per-over entries). The timeline is 1-indexed — timeline[0]
// is over 1.
function snapshotAtOver(innings1Timeline, overK, { format = 'T20', state = 'In Progress' } = {}) {
  if (overK === 0) {
    return {
      state, format,
      teams: mkTeams(),
      innings: [],
      current: null,
      result: null, toss: null,
    };
  }
  const completed = innings1Timeline.slice(0, overK);
  const last = completed[completed.length - 1];
  const innings = {
    inningsId: 1, batTeamId: 1, batTeamName: 'SRH',
    score: last.score, wickets: last.wickets, overs: overK,
  };
  const match = {
    state, format,
    teams: mkTeams(),
    innings: [innings],
    current: null,
    result: null, toss: null,
  };
  const overs = completed.map((o, i) => ({ inningsId: 1, overs: i + 1, ...o }));
  return { match, overs };
}

// ── Scenarios ────────────────────────────────────────────────────────────────

// Innings 1: SRH bats first, makes 200 all out at over 20.
// Timeline defines runs scored + ball string for each of the 20 overs.
const SRH_200 = [
  { runs: 8,  score: 8,   wickets: 0, ovrSummary: '1 1 0 4 0 2' },
  { runs: 12, score: 20,  wickets: 0, ovrSummary: '4 4 0 1 1 2' },
  { runs: 10, score: 30,  wickets: 1, ovrSummary: '1 W 4 1 2 2' },
  { runs: 8,  score: 38,  wickets: 1, ovrSummary: '1 1 0 4 0 2' },
  { runs: 14, score: 52,  wickets: 1, ovrSummary: '6 1 0 4 1 2' },
  { runs: 10, score: 62,  wickets: 2, ovrSummary: '1 W 2 4 2 1' },
  { runs: 6,  score: 68,  wickets: 2, ovrSummary: '1 1 1 0 2 1' },
  { runs: 12, score: 80,  wickets: 2, ovrSummary: '4 4 0 1 1 2' },
  { runs: 8,  score: 88,  wickets: 3, ovrSummary: '1 W 2 4 1 0' },
  { runs: 10, score: 98,  wickets: 3, ovrSummary: '4 1 0 4 0 1' },
  { runs: 9,  score: 107, wickets: 3, ovrSummary: '1 4 0 1 2 1' },
  { runs: 20, score: 127, wickets: 3, ovrSummary: '6 4 6 1 2 1' },
  { runs: 8,  score: 135, wickets: 4, ovrSummary: '1 4 W 1 1 1' },
  { runs: 10, score: 145, wickets: 4, ovrSummary: '1 4 0 4 0 1' },
  { runs: 6,  score: 151, wickets: 5, ovrSummary: '1 1 W 1 2 1' },
  { runs: 14, score: 165, wickets: 5, ovrSummary: '6 1 4 0 2 1' },
  { runs: 12, score: 177, wickets: 6, ovrSummary: '4 W 4 1 2 1' },
  { runs: 10, score: 187, wickets: 6, ovrSummary: '1 4 1 0 2 2' },
  { runs: 8,  score: 195, wickets: 7, ovrSummary: '1 4 W 1 1 1' },
  { runs: 5,  score: 200, wickets: 10, ovrSummary: '1 W 4 W W Nb' },
];

const scenarios = [
  {
    name: 'innings_score ≥200 — early-resolve once threshold hit',
    timeline: SRH_200,
    contracts: [
      {
        label: '≥200 at end',
        cond: { type:'innings_score', team:'SRH', innings:1, operator:'>=', threshold:200 },
        expectAt: { 15: null, 20: true }, // pending at ov15, YES at end
      },
      {
        label: '≥100 — should early-resolve YES at ov 11',
        cond: { type:'innings_score', team:'SRH', innings:1, operator:'>=', threshold:100 },
        expectAt: { 10: null, 11: true, 20: true }, // ov 11 crosses 100 (107)
      },
      {
        label: '≥300 — stays NO when innings ends below',
        cond: { type:'innings_score', team:'SRH', innings:1, operator:'>=', threshold:300 },
        expectAt: { 19: null, 20: false },
      },
    ],
  },
  {
    name: 'team_wickets_by_over ≥3 — monotonic early YES',
    timeline: SRH_200,
    contracts: [
      {
        label: '≥3 wkts by ov 12 — YES as soon as 3rd falls at ov 9',
        cond: { type:'team_wickets_by_over', team:'SRH', by_over:12, min_wickets:3 },
        expectAt: { 8: null, 9: true, 20: true },
      },
      {
        label: '≥5 wkts by ov 12 — NO once ov 12 complete with <5',
        cond: { type:'team_wickets_by_over', team:'SRH', by_over:12, min_wickets:5 },
        expectAt: { 11: null, 12: false },
      },
    ],
  },
  {
    name: 'runs_over — resolves at end of target over',
    timeline: SRH_200,
    contracts: [
      {
        label: 'ov 5 ≥12 (actual=14) — YES',
        cond: { type:'runs_over', team:'SRH', over:5, operator:'>=', threshold:12 },
        expectAt: { 4: null, 5: true, 20: true },
      },
      {
        label: 'ov 5 ≥20 (actual=14) — NO',
        cond: { type:'runs_over', team:'SRH', over:5, operator:'>=', threshold:20 },
        expectAt: { 4: null, 5: false, 20: false },
      },
    ],
  },
  {
    name: 'boundary_over — counts match ball strings',
    timeline: SRH_200,
    contracts: [
      {
        label: 'ov 12 ≥2 sixes (actual: 6,4,6,1,2,1 → 2 sixes) — YES',
        cond: { type:'boundary_over', team:'SRH', over:12, boundary_type:'six', boundary_count:2 },
        expectAt: { 11: null, 12: true },
      },
      {
        label: 'ov 12 ≥3 sixes — NO',
        cond: { type:'boundary_over', team:'SRH', over:12, boundary_type:'six', boundary_count:3 },
        expectAt: { 12: false },
      },
    ],
  },
  {
    name: 'runs_powerplay — aggregates overs 1-6 with short-circuit',
    timeline: SRH_200,
    contracts: [
      {
        // Runs in pp are monotonic — at ov 5 we've already summed 8+12+10+8+14=52,
        // which is ≥50, so early-YES. Over 6 can only add more.
        label: '≥50 in pp (reached by ov 5 at 52) — early YES',
        cond: { type:'runs_powerplay', team:'SRH', operator:'>=', threshold:50 },
        expectAt: { 4: null, 5: true, 6: true },
      },
      {
        label: '≥100 in pp — NO after ov 6 complete with 62',
        cond: { type:'runs_powerplay', team:'SRH', operator:'>=', threshold:100 },
        expectAt: { 5: null, 6: false },
      },
    ],
  },
];

// ── Runner ───────────────────────────────────────────────────────────────────

let pass = 0, fail = 0;
const issues = [];

for (const sc of scenarios) {
  console.log(`\n── ${sc.name}`);
  for (const c of sc.contracts) {
    // Step through every over and record the verdict
    const timeline = [];
    let lastVerdict = null;
    let flipped = false;
    for (let k = 0; k <= sc.timeline.length; k++) {
      const snap = snapshotAtOver(sc.timeline, k, { state: k === sc.timeline.length ? 'Complete' : 'In Progress' });
      const overs = snap.overs || [];
      const match = snap.match || snap;
      // When innings complete (wickets=10 or 20 overs), mark innings as closed
      if (k === sc.timeline.length) match.state = 'Complete';
      const verdict = _evaluate(c.cond, match, overs, null);
      timeline.push({ over: k, verdict });
      // Check flip: once verdict != null, it should not change
      if (lastVerdict !== null && lastVerdict !== verdict && verdict !== null) {
        flipped = true;
      }
      if (verdict !== null) lastVerdict = verdict;
    }

    // Check expectations
    let allOk = !flipped;
    const failures = [];
    for (const [overStr, want] of Object.entries(c.expectAt)) {
      const k = parseInt(overStr);
      const got = timeline.find(t => t.over === k)?.verdict;
      if (got !== want) {
        allOk = false;
        failures.push(`ov${k}: want=${want} got=${got}`);
      }
    }
    if (flipped) failures.unshift(`verdict flipped: ${JSON.stringify(timeline.filter(t => t.verdict !== null))}`);

    if (allOk) { pass++; console.log(`  ✓ ${c.label}`); }
    else       { fail++; console.log(`  ✗ ${c.label}\n      ${failures.join('\n      ')}`); issues.push(`${sc.name} / ${c.label}`); }
  }
}

console.log(`\n══════════════════════════════════════`);
console.log(`  → ${pass} passed, ${fail} failed`);
console.log(`══════════════════════════════════════`);
if (fail > 0) process.exit(1);

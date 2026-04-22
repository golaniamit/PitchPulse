// Smoke test for the Cricbuzz fetcher. Runs against a real match and prints a
// summary. Usage:
//   node server/scripts/test-cricbuzz.js               # default sample match
//   node server/scripts/test-cricbuzz.js <matchId>     # specific match
//   node server/scripts/test-cricbuzz.js <matchId> <slug>
//
// Also runs an assertion pass: required fields are non-null, innings totals add up,
// current over is within bounds.

const { fetchMatch, findInningsForTeam, oversAsFraction } = require('../engine/cricbuzz');

const DEFAULT_MATCH = '151845'; // MI vs GT, 30th match, IPL 2026 (completed, rich payload)

async function main() {
  const matchId = process.argv[2] || DEFAULT_MATCH;
  const slug = process.argv[3];

  console.log(`\n→ Fetching match ${matchId}${slug ? ` (slug=${slug})` : ' (auto slug)'}...\n`);

  const t0 = Date.now();
  const data = await fetchMatch(matchId, slug);
  const elapsed = Date.now() - t0;

  console.log(`✓ Fetched and parsed in ${elapsed}ms\n`);

  printSummary(data);
  runAssertions(data);
}

function printSummary(d) {
  console.log('── MATCH HEADER ──────────────────────────────');
  console.log(`State:  ${d.state}`);
  console.log(`Status: ${d.status}`);
  console.log(`Format: ${d.format}`);
  console.log(`Slug:   ${d.slug}`);
  console.log(`Teams:  ${d.teams.map(t => `${t.name} (${t.shortName}, id=${t.id})`).join('  vs  ')}`);

  console.log('\n── INNINGS ──────────────────────────────────');
  for (const i of d.innings) {
    const ov = oversAsFraction(i.overs).toFixed(3);
    console.log(
      `  Inn ${i.inningsId}: ${i.batTeamName.padEnd(5)} ${String(i.score).padStart(3)}/${i.wickets} ` +
      `in ${String(i.overs).padEnd(4)} ov  (ballNbr=${i.ballNbr}, fractional=${ov})`
    );
  }

  if (d.current) {
    console.log('\n── LIVE (miniscore) ─────────────────────────');
    const c = d.current;
    console.log(`  Batting: team ${c.batTeamId} — ${c.batTeamScore}/${c.batTeamWkts}`);
    if (c.batsmanStriker) {
      console.log(`  Striker:    ${c.batsmanStriker.name.padEnd(20)} ${c.batsmanStriker.runs}(${c.batsmanStriker.balls}), 4s=${c.batsmanStriker.fours} 6s=${c.batsmanStriker.sixes} SR=${c.batsmanStriker.strikeRate}`);
    }
    if (c.batsmanNonStriker) {
      console.log(`  Non-striker: ${c.batsmanNonStriker.name.padEnd(19)} ${c.batsmanNonStriker.runs}(${c.batsmanNonStriker.balls})`);
    }
    if (c.bowlerStriker) {
      console.log(`  Bowler:     ${c.bowlerStriker.name.padEnd(20)} ${c.bowlerStriker.overs}-${c.bowlerStriker.maidens}-${c.bowlerStriker.runs}-${c.bowlerStriker.wickets} (econ ${c.bowlerStriker.economy})`);
    }
    if (c.lastWicket) console.log(`  Last wkt:   ${c.lastWicket}`);
    if (c.recentOvsStats) console.log(`  Recent:     ${c.recentOvsStats}`);
    if (c.currentRunRate) console.log(`  CRR: ${c.currentRunRate}  RRR: ${c.requiredRunRate}`);
    if (c.responseLastUpdated) {
      const age = Math.round((Date.now() / 1000) - c.responseLastUpdated);
      console.log(`  Updated:    ${new Date(c.responseLastUpdated * 1000).toISOString()}  (${age}s ago)`);
    }
  }

  console.log('\n── HELPERS TEST ─────────────────────────────');
  if (d.teams.length) {
    const t = d.teams[0];
    const byId = findInningsForTeam(d, t.id);
    const byShort = findInningsForTeam(d, t.shortName);
    const byName = findInningsForTeam(d, t.name);
    console.log(`  findInningsForTeam(${t.id}):        ${byId ? `inn ${byId.inningsId}` : 'null'}`);
    console.log(`  findInningsForTeam("${t.shortName}"):   ${byShort ? `inn ${byShort.inningsId}` : 'null'}`);
    console.log(`  findInningsForTeam("${t.name}"): ${byName ? `inn ${byName.inningsId}` : 'null'}`);
  }
  console.log(`  oversAsFraction(15.5) = ${oversAsFraction(15.5)}  (expected 15.833…)`);
  console.log(`  oversAsFraction(15.6) = ${oversAsFraction(15.6)}  (expected 16.0)`);
}

function runAssertions(d) {
  console.log('\n── ASSERTIONS ───────────────────────────────');
  let pass = 0, fail = 0;
  const ok = (cond, label) => {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.log(`  ✗ ${label}`); fail++; }
  };

  ok(typeof d.matchId === 'string' || typeof d.matchId === 'number', 'matchId present');
  ok(d.state && typeof d.state === 'string', 'state is a non-empty string');
  ok(d.format && typeof d.format === 'string', 'format is a non-empty string');
  ok(Array.isArray(d.teams) && d.teams.length === 2, 'two teams parsed');
  ok(d.teams.every(t => t.name && t.shortName && t.id), 'every team has id + name + shortName');
  const isPrematch = d.state === 'Preview' || d.state === 'Toss';
  if (!isPrematch) {
    ok(Array.isArray(d.innings) && d.innings.length >= 1, 'at least one innings present (non-preview)');
  } else {
    console.log(`  · skipping innings check — state="${d.state}" (no ball bowled yet)`);
  }
  ok(d.innings.every(i => i.batTeamName && typeof i.score === 'number' && typeof i.wickets === 'number'),
     'each innings has batTeamName + numeric score + wickets');
  ok(d.innings.every(i => i.wickets >= 0 && i.wickets <= 10), 'wickets in [0,10]');
  ok(d.innings.every(i => i.score >= 0 && i.score < 1000), 'score in [0,1000)');

  if (d.format === 'T20') {
    ok(d.innings.every(i => oversAsFraction(i.overs) <= 20.0001), 'T20 overs ≤ 20');
  }

  // If a current miniscore exists, it should line up with the innings list
  if (d.current) {
    const matchingInn = d.innings.find(i => i.inningsId === d.current.inningsId);
    ok(!!matchingInn, 'current.inningsId matches an innings entry');
    if (matchingInn) {
      ok(matchingInn.score === d.current.batTeamScore,
        `current score ${d.current.batTeamScore} matches innings ${matchingInn.score}`);
      ok(matchingInn.wickets === d.current.batTeamWkts,
        `current wickets ${d.current.batTeamWkts} match innings ${matchingInn.wickets}`);
    }
  }

  console.log(`\n  → ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch(err => {
  console.error('\n✗ Test failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});

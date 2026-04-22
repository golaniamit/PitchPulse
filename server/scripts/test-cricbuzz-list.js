// Quick check of listLiveMatches: prints the normalized index.
const { listLiveMatches } = require('../engine/cricbuzz');

(async () => {
  const t0 = Date.now();
  const matches = await listLiveMatches();
  console.log(`Fetched ${matches.length} matches in ${Date.now() - t0}ms\n`);

  for (const m of matches.slice(0, 20)) {
    const teams = m.teams.map(t => t.shortName).join(' vs ');
    console.log(
      `  ${String(m.matchId).padEnd(8)} ${(m.state || '').padEnd(14)}` +
      ` ${teams.padEnd(14)} ${(m.format || '').padEnd(5)}` +
      ` ${(m.seriesName || '').slice(0, 30).padEnd(30)} ${m.status?.slice(0, 40)}`
    );
  }

  // IPL-only filter
  console.log('\nIPL only:');
  const ipl = await listLiveMatches({ seriesFilter: 'Indian Premier League' });
  for (const m of ipl) {
    console.log(`  ${m.matchId}  ${m.state}  ${m.teams.map(t => t.shortName).join(' vs ')}  ${m.status}`);
  }
})().catch(e => { console.error(e); process.exit(1); });

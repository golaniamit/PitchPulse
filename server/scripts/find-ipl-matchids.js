// Brute-force discover IPL 2026 matchIds by probing sequential match pages.
// Cricbuzz returns a fallback page (~190KB) for invalid IDs, and the full
// match page (300KB+) with a slug in the HTML for valid ones. We detect IPL
// 2026 matches by checking if the self-slug contains "indian-premier-league-2026".
// Output: server/scripts/ipl-2026-matchids.json

const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

const START = 150800;
const END   = 151900;
const CONCURRENCY = 20;

async function probe(id) {
  try {
    const r = await fetch(`https://www.cricbuzz.com/live-cricket-scores/${id}`, { headers: { 'User-Agent': UA } });
    const html = await r.text();
    // Valid match → multiple links mentioning its own id; fallback page → links mention the LIVE match id, not ours.
    // Detect by finding a self-referencing href like /live-cricket-scores/<id>/<slug>.
    const selfRe = new RegExp(`/live-cricket-scores/${id}/([a-z0-9-]+)`, 'g');
    const m = selfRe.exec(html);
    if (!m) return { id, valid: false };
    const slug = m[1];
    const isIpl = /indian-premier-league-2026/.test(slug);
    return { id, valid: true, slug, isIpl };
  } catch (e) {
    return { id, valid: false, error: e.message };
  }
}

async function main() {
  console.log(`Scanning matchIds ${START}..${END} at ${CONCURRENCY} in parallel...`);
  const found = [];
  const total = END - START + 1;
  let done = 0;

  for (let base = START; base <= END; base += CONCURRENCY) {
    const batch = [];
    for (let off = 0; off < CONCURRENCY && base + off <= END; off++) batch.push(probe(base + off));
    const results = await Promise.all(batch);
    for (const r of results) if (r.isIpl) found.push(r);
    done += results.length;
    process.stdout.write(`  ${done}/${total}  (${found.length} IPL 2026 found)\r`);
  }
  console.log();

  const out = { scannedAt: new Date().toISOString(), range: [START, END], matches: found };
  const outPath = path.join(__dirname, 'ipl-2026-matchids.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n→ Wrote ${outPath} — ${found.length} matches\n`);
  found.forEach(f => console.log(`  ${f.id}  ${f.slug}`));
}

main().catch(e => { console.error(e); process.exit(1); });

// Fetch player headshots from iplt20.com. For each active player with an
// ipl_id, loads their profile page, extracts the IPLHeadshot URL, downloads
// the image to client/public/players/<slug>.<ext>, and updates the DB.
//
// Flags:
//   --apply     actually write files + DB (otherwise dry-run report only)
//   --refetch   re-download even for players that already have a headshot_path

const fs = require('fs');
const path = require('path');
const db = require('../db');

const APPLY = process.argv.includes('--apply');
const REFETCH = process.argv.includes('--refetch');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';
const CONCURRENCY = 10;
const OUT_DIR = path.join(__dirname, '..', '..', 'client', 'public', 'players');

// ─── Extract the headshot URL from the iplt20 profile page ───────────────
async function findHeadshot(iplId, slug) {
  const url = `https://www.iplt20.com/players/${slug}/${iplId}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return { error: `HTTP ${r.status}` };
  const html = await r.text();
  const match = html.match(/https?:\/\/[^"'\s]*\/IPLHeadshot\d+\/[\w-]+\.(?:png|jpg|jpeg|webp)/i);
  if (!match) {
    if (/Default-Men\.(?:png|jpg|webp)/.test(html)) return { error: 'no-headshot-posted' };
    return { error: 'url-pattern-not-found' };
  }
  return { url: match[0] };
}

// ─── Download image to disk ──────────────────────────────────────────────
async function downloadImage(url, destPath) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`image HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 1000) throw new Error(`suspiciously small image (${buf.length} bytes)`);
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  if (APPLY && !fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

  let rows = db.prepare(`
    SELECT p.id, p.name, p.slug, p.ipl_id, p.headshot_path, t.short_code AS team
    FROM players p LEFT JOIN teams t ON p.team_id = t.id
    WHERE p.is_active = 1 AND p.ipl_id IS NOT NULL
    ORDER BY t.short_code, p.name
  `).all();

  if (!REFETCH) rows = rows.filter(p => !p.headshot_path);
  console.log(`→ ${rows.length} players to fetch headshots for` + (REFETCH ? ' (--refetch set)' : ''));

  const results = [];
  for (let base = 0; base < rows.length; base += CONCURRENCY) {
    const batch = rows.slice(base, base + CONCURRENCY);
    const settled = await Promise.all(batch.map(async p => {
      const res = await findHeadshot(p.ipl_id, p.slug);
      if (res.error) return { player: p, error: res.error };
      const ext = path.extname(new URL(res.url).pathname) || '.png';
      const fileName = `${p.slug}${ext}`;
      const destPath = path.join(OUT_DIR, fileName);
      const publicPath = `/players/${fileName}`;
      if (!APPLY) return { player: p, url: res.url, publicPath, dryRun: true };
      try {
        const size = await downloadImage(res.url, destPath);
        db.prepare('UPDATE players SET headshot_path = ? WHERE id = ?').run(publicPath, p.id);
        return { player: p, url: res.url, publicPath, size };
      } catch (e) {
        return { player: p, error: e.message };
      }
    }));
    results.push(...settled);
    const ok = results.filter(r => !r.error).length;
    const err = results.filter(r => r.error).length;
    process.stdout.write(`  ${results.length}/${rows.length}  (ok=${ok} err=${err})\r`);
  }
  console.log();

  const errors = results.filter(r => r.error);
  console.log(`\n✓ ${results.length - errors.length} headshots ${APPLY ? 'downloaded' : 'found (dry run)'}`);
  if (errors.length) {
    console.log(`\nErrors (${errors.length}):`);
    const grouped = {};
    for (const e of errors) {
      const key = e.error.split(' ')[0];
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(`${e.player.team} ${e.player.name}`);
    }
    for (const [k, list] of Object.entries(grouped)) {
      console.log(`  ${k}:  ${list.length} players`);
      list.slice(0, 10).forEach(n => console.log(`    ${n}`));
      if (list.length > 10) console.log(`    ... and ${list.length - 10} more`);
    }
  }

  if (!APPLY) {
    console.log('\n── DRY RUN — no files or DB updates. Re-run with --apply to commit. ──\n');
  } else {
    const withHeadshot = db.prepare("SELECT COUNT(*) AS n FROM players WHERE is_active = 1 AND headshot_path IS NOT NULL").get().n;
    const total = db.prepare("SELECT COUNT(*) AS n FROM players WHERE is_active = 1").get().n;
    console.log(`\nDB state: ${withHeadshot}/${total} active players have headshots\n`);
  }
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1); });

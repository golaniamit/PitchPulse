// One-off script — bulk-downloads Wikipedia infobox images for every
// player in the seed that doesn't already have a local headshot. Run
// with: `node server/scripts/fetch-headshots.js`.
//
// Downloads to client/public/players/{slug}.jpg (normalised filename,
// even if the source was a PNG — browsers handle it fine and it keeps
// the DB seed lookup simple).
//
// Rerun-safe: skips any player whose file already exists.

const fs = require('fs');
const path = require('path');
const players = require('../seeds/players');

const PLAYERS_DIR = path.join(__dirname, '..', '..', 'client', 'public', 'players');
const UA = 'IPL-Market/1.0 (contact: admin)';

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function main() {
  if (!fs.existsSync(PLAYERS_DIR)) fs.mkdirSync(PLAYERS_DIR, { recursive: true });

  const needing = players.filter(p => {
    if (p.headshot_path) return false;
    const slug = slugify(p.name);
    return !fs.existsSync(path.join(PLAYERS_DIR, slug + '.jpg'));
  });
  console.log(`Need headshots for ${needing.length} of ${players.length} players`);

  // ── Step 1: batch-lookup Wikipedia infobox images ──
  const nameToImg = {};
  const BATCH = 40;
  for (let i = 0; i < needing.length; i += BATCH) {
    const chunk = needing.slice(i, i + BATCH);
    const titles = chunk.map(p => p.name).join('|');
    const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=original&pilimit=${BATCH}&redirects=1&titles=${encodeURIComponent(titles)}`;
    process.stdout.write(`Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(needing.length / BATCH)}... `);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      const data = await r.json();
      const pages = data.query?.pages || {};
      // Build name-normalisation / redirect maps to trace response titles
      // back to the player name we originally queried.
      const normalized = {};
      for (const n of (data.query?.normalized || [])) normalized[n.from] = n.to;
      const redirects = {};
      for (const rd of (data.query?.redirects || [])) redirects[rd.from] = rd.to;
      let found = 0;
      for (const pageId in pages) {
        const page = pages[pageId];
        if (!page.original?.source) continue;
        for (const p of chunk) {
          let n = p.name;
          if (normalized[n]) n = normalized[n];
          if (redirects[n]) n = redirects[n];
          if (n === page.title) {
            nameToImg[p.name] = page.original.source;
            found++;
            break;
          }
        }
      }
      console.log(`found ${found} images`);
    } catch (e) {
      console.log(`failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 400));  // tiny rate-limit
  }

  console.log(`\n${Object.keys(nameToImg).length} total image URLs found. Downloading…`);

  // ── Step 2: download via Special:FilePath (gentler rate-limit than
  // the upload.wikimedia.org/thumb/ endpoint). Pace to ~1/sec and
  // retry on 429 with exponential backoff.
  let ok = 0, bad = 0, skipped = 0;
  const missing = needing.filter(p => !nameToImg[p.name]).map(p => p.name);
  const entries = Object.entries(nameToImg);
  for (let idx = 0; idx < entries.length; idx++) {
    const [name, imgUrl] = entries[idx];
    const slug = slugify(name);
    const filepath = path.join(PLAYERS_DIR, slug + '.jpg');
    try {
      if (/\.svg$/i.test(imgUrl)) { skipped++; continue; }
      // Pull the filename off the end of the upload URL so we can hit
      // Special:FilePath, which is a different (less rate-limited) endpoint.
      const mFile = imgUrl.match(/\/([^/]+)$/);
      const filename = mFile ? decodeURIComponent(mFile[1]) : null;
      if (!filename) { bad++; continue; }
      const specialUrl = `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=400`;

      let r = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        r = await fetch(specialUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' });
        if (r.status !== 429) break;
        const backoff = 3000 * (attempt + 1);
        process.stdout.write(`429 on ${name}, backing off ${backoff}ms… `);
        await new Promise(rs => setTimeout(rs, backoff));
      }
      if (!r || !r.ok) { bad++; console.log(`- ${name}: HTTP ${r?.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 500) { bad++; continue; }
      fs.writeFileSync(filepath, buf);
      ok++;
      if (ok % 10 === 0) process.stdout.write(`${ok} downloaded… `);
      await new Promise(rs => setTimeout(rs, 900));  // pacing
    } catch (e) {
      bad++;
      console.log(`- ${name}: ${e.message}`);
    }
  }

  console.log(`\nDone: ${ok} downloaded, ${bad} failed, ${skipped} SVG skipped`);
  console.log(`\nPlayers with no Wikipedia image (expected for uncapped): ${missing.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });

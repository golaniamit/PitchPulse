// Phase 1 — crawl match-squads pages for every reachable IPL 2026 match,
// aggregate players per team, and write a canonical-squads.json file.
// No DB changes. Run:  node server/scripts/fetch-ipl-squads.js

const fs = require('fs');
const path = require('path');
const { listLiveMatches, _decodeRSC, _extractObject, resolveSlug } = require('../engine/cricbuzz');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function fetchSquad(matchId, slug) {
  if (!slug) slug = await resolveSlug(matchId);
  const url = `https://www.cricbuzz.com/cricket-match-squads/${matchId}/${slug}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for match ${matchId}`);
  const rsc = _decodeRSC(await r.text());
  // The page exposes two "players" blocks (one per team, in sibling RSC chunks).
  // Each block has shape: { "playing XI": [...], "bench": [...] }
  // We scan for every occurrence of "players":{ and parse the matching object.
  const marker = '"players":{';
  const blocks = [];
  let idx = 0;
  while ((idx = rsc.indexOf(marker, idx)) !== -1) {
    const obj = walkObject(rsc, idx + marker.length - 1);
    if (obj) blocks.push(obj);
    idx += marker.length;
  }
  return blocks;
}

// Walk a JSON object starting from the opening '{' — same approach as the
// _extractObject helper in cricbuzz.js, inlined here to avoid export churn.
function walkObject(text, start) {
  let depth = 0, i = start, inStr = false, esc = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

function toCanonical(p) {
  return {
    cricbuzzId: p.id,
    name: p.fullName || p.name,
    shortName: p.name,
    role: p.role,
    battingStyle: p.battingStyle,
    bowlingStyle: p.bowlingStyle,
    teamId: p.teamId,
    teamName: p.teamName,
    imageId: p.imageDetails?.imageId,
    imageSlug: p.imageDetails?.alt,
    profileUrl: p.profileUrl,
    isOverseas: !!p.isOverseas,
  };
}

async function main() {
  console.log('→ Loading IPL 2026 match list from ipl-2026-matchids.json…');
  const idsFile = path.join(__dirname, 'ipl-2026-matchids.json');
  if (!fs.existsSync(idsFile)) {
    console.error('missing ipl-2026-matchids.json — run find-ipl-matchids.js first');
    process.exit(1);
  }
  const { matches: idList } = JSON.parse(fs.readFileSync(idsFile, 'utf8'));
  console.log(`  ${idList.length} IPL 2026 matchIds loaded`);

  // Shape matches the earlier listLiveMatches output so the scrape loop below works unchanged.
  const completedOrLive = idList.map(m => ({
    matchId: m.id,
    slug: m.slug,
    teams: [{ shortName: (m.slug.match(/^([a-z]+)-vs-/)?.[1] || '').toUpperCase() },
            { shortName: (m.slug.match(/-vs-([a-z]+)-/)?.[1] || '').toUpperCase() }],
    status: '',
  }));

  // teamId → Map<cricbuzzId, player>
  const perTeam = new Map();
  let scraped = 0, skipped = 0;
  for (const m of completedOrLive) {
    try {
      const blocks = await fetchSquad(m.matchId, m.slug);
      for (const block of blocks) {
        const xi = block['playing XI'] || [];
        const bench = block.bench || [];
        for (const p of [...xi, ...bench]) {
          if (!p.teamId || !p.id) continue;
          if (!perTeam.has(p.teamId)) perTeam.set(p.teamId, new Map());
          const team = perTeam.get(p.teamId);
          if (!team.has(p.id)) team.set(p.id, toCanonical(p));
        }
      }
      scraped++;
      process.stdout.write(`  ✓ ${m.matchId} ${(m.teams||[]).map(t=>t.shortName).join(' vs ')}  (${scraped}/${completedOrLive.length})\r`);
    } catch (e) {
      skipped++;
      console.log(`\n  ✗ ${m.matchId} — ${e.message}`);
    }
  }
  console.log(`\n\n→ Scraped ${scraped} match squads, skipped ${skipped}.`);

  // Write canonical-squads.json
  const out = {
    fetchedAt: new Date().toISOString(),
    sourceMatchIds: completedOrLive.map(m => m.matchId),
    teams: {},
  };
  for (const [teamId, playerMap] of perTeam) {
    const players = [...playerMap.values()];
    const teamName = players[0]?.teamName;
    out.teams[teamId] = {
      teamId,
      teamName,
      playerCount: players.length,
      players: players.sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  const outPath = path.join(__dirname, 'canonical-squads.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`→ Wrote ${outPath}\n`);
  console.log('Summary by team:');
  Object.values(out.teams).forEach(t => console.log(`  ${t.teamName?.padEnd(4)} — ${t.playerCount} unique players`));
}

main().catch(e => { console.error('\n✗', e.message); process.exit(1); });

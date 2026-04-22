// Scrape the canonical 25-player squads from iplt20.com — the official source.
// Writes server/scripts/ipl-canonical-squads.json with { teamShort: [{ iplId, slug, name, role, ... }] }.
// Read-only — no DB changes.

const fs = require('fs');
const path = require('path');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

const TEAMS = [
  { short: 'CSK',  slug: 'chennai-super-kings' },
  { short: 'DC',   slug: 'delhi-capitals' },
  { short: 'GT',   slug: 'gujarat-titans' },
  { short: 'KKR',  slug: 'kolkata-knight-riders' },
  { short: 'LSG',  slug: 'lucknow-super-giants' },
  { short: 'MI',   slug: 'mumbai-indians' },
  { short: 'PBKS', slug: 'punjab-kings' },
  { short: 'RCB',  slug: 'royal-challengers-bengaluru' },
  { short: 'RR',   slug: 'rajasthan-royals' },
  { short: 'SRH',  slug: 'sunrisers-hyderabad' },
];

async function fetchSquadPage(teamSlug) {
  const r = await fetch(`https://www.iplt20.com/teams/${teamSlug}/squad`, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${teamSlug}`);
  return await r.text();
}

// Extract every player's (name, slug, ipl_id) from a squad page.
// Also grab "Captain - X" / "Coach - Y" from the page metadata.
function parseSquad(html) {
  const players = [];
  const seen = new Set();
  // Each player is in a link + name block. Pattern:
  //   data-player_name="<Full Name>" href="https://www.iplt20.com/players/<slug>/<id>"
  const re = /data-player_name="([^"]+)"\s+href="https:\/\/www\.iplt20\.com\/players\/([a-z0-9-]+)\/(\d+)/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[3];
    if (seen.has(id)) continue;
    seen.add(id);
    players.push({ iplId: id, slug: m[2], name: m[1].trim() });
  }

  const captain = html.match(/<span>Captain<\/span>\s*<b>-<\/b>\s*([A-Za-z. ]+)/)?.[1]?.trim();
  const coach = html.match(/<span>Coach<\/span>\s*<b>-<\/b>\s*([A-Za-z. ]+)/)?.[1]?.trim();
  return { players, captain, coach };
}

// Profile page also has role/specialisation + nationality — fetch sparingly.
async function fetchRole(iplId, slug) {
  try {
    const r = await fetch(`https://www.iplt20.com/players/${slug}/${iplId}`, { headers: { 'User-Agent': UA } });
    if (!r.ok) return null;
    const html = await r.text();
    // Specialization block structure (from probe):
    //   <div class="grid-items"><p>Wicketkeeper Batter</p><span>Specialization</span></div>
    const roleMatch = html.match(/<p>([^<]+?)<\/p>\s*<span>Specialization<\/span>/);
    const natMatch  = html.match(/<div class="plyr-name-nationality">[\s\S]*?<span>([^<]+)<\/span>/);
    return {
      role: roleMatch?.[1]?.trim() || null,
      nationality: natMatch?.[1]?.trim() || null,
    };
  } catch { return null; }
}

async function main() {
  const out = { fetchedAt: new Date().toISOString(), teams: {} };

  for (const team of TEAMS) {
    console.log(`→ ${team.short}`);
    const html = await fetchSquadPage(team.slug);
    const { players, captain, coach } = parseSquad(html);
    console.log(`  ${players.length} players  | captain: ${captain || '?'}  | coach: ${coach || '?'}`);

    // Enrich each player with role + nationality (small batches to be polite)
    const enriched = [];
    for (const p of players) {
      const details = await fetchRole(p.iplId, p.slug);
      enriched.push({ ...p, ...(details || {}) });
      process.stdout.write(`    ${enriched.length}/${players.length}\r`);
    }
    console.log('                       ');
    out.teams[team.short] = { teamShort: team.short, teamSlug: team.slug, captain, coach, players: enriched };
  }

  const outPath = path.join(__dirname, 'ipl-canonical-squads.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\n→ Wrote ${outPath}`);
  console.log('\nSummary by team:');
  for (const [short, t] of Object.entries(out.teams)) {
    console.log(`  ${short.padEnd(5)} ${t.players.length} players`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });

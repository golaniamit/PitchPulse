// Regenerate server/seeds/players.js from the iplt20.com canonical squads
// so backend restarts don't deactivate players we just added via the audit.
//
// The seed is NOT the source of truth any more — canonical-squads.json is —
// but db.js re-runs the seed on every boot and deactivates anything not in
// it. Easier to regenerate the seed than to rewire the boot logic.

const fs = require('fs');
const path = require('path');

const canonical = JSON.parse(fs.readFileSync(path.join(__dirname, 'ipl-canonical-squads.json'), 'utf8'));

function normRole(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s.includes('wicketkeeper') || s === 'wk' || s.includes('wk-batter')) return 'wk';
  if (s.includes('allrounder') || s.includes('all rounder') || s.includes('all-rounder')) return 'all-rounder';
  if (s.includes('bowler')) return 'bowler';
  if (s.includes('batter') || s.includes('batsman')) return 'batter';
  return null;
}

// Team display order on the seed — matches the old file's grouping.
const ORDER = ['CSK', 'MI', 'RCB', 'RR', 'DC', 'KKR', 'PBKS', 'SRH', 'GT', 'LSG'];

const lines = [];
lines.push(`// IPL 2026 squads — auto-generated from iplt20.com canonical squads on`);
lines.push(`// ${new Date().toISOString().slice(0,10)} by server/scripts/regenerate-seed.js.`);
lines.push(`// Source of truth: server/scripts/ipl-canonical-squads.json.`);
lines.push(`// Re-run the generator to refresh after an audit.`);
lines.push(``);
lines.push(`module.exports = [`);
for (const short of ORDER) {
  const team = canonical.teams[short];
  if (!team) continue;
  lines.push(`  // ── ${short} ─────────────────────────────────────────────`);
  // Sort by name within team
  const sorted = [...team.players].sort((a, b) => a.name.localeCompare(b.name));
  for (const p of sorted) {
    const role = normRole(p.role);
    lines.push(`  { name: ${JSON.stringify(p.name).padEnd(32)}, team_short: '${short}'${' '.repeat(4 - short.length)}, role: '${role || '?'}'${' '.repeat('all-rounder'.length - (role||'').length)}, ipl_id: ${p.iplId} },`);
  }
  lines.push(``);
}
lines.push(`];`);

const outPath = path.join(__dirname, '..', 'seeds', 'players.js');
const backup = outPath + '.bak-' + Date.now();
fs.copyFileSync(outPath, backup);
fs.writeFileSync(outPath, lines.join('\n'));
console.log(`✓ Wrote ${outPath}`);
console.log(`📦 Backup: ${backup}`);
const totalPlayers = Object.values(canonical.teams).reduce((n, t) => n + t.players.length, 0);
console.log(`  ${totalPlayers} players across ${Object.keys(canonical.teams).length} teams`);

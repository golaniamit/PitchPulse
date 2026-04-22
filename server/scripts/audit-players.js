// Phase 2 (redo) — diff our DB against the iplt20.com canonical 25-man squads.
// Read-only. Writes server/scripts/audit-report.json.

const fs = require('fs');
const path = require('path');
const db = require('../db');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function similarity(a, b) {
  const sa = new Set(norm(a).split(' ').filter(Boolean));
  const sb = new Set(norm(b).split(' ').filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  // Require >=2 shared tokens OR full equality on single-token names, else 0.
  // This avoids false positives like Sharma↔Sharma or Singh↔Singh on 2-word names.
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  if (sa.size >= 2 && sb.size >= 2 && inter < 2) return inter / 4;  // weak signal
  return inter / Math.min(sa.size, sb.size);
}
function bestMatch(targetName, pool) {
  let best = null;
  for (const p of pool) {
    const s = similarity(targetName, p.name);
    if (!best || s > best.score) best = { player: p, score: s };
  }
  return best;
}

const canonical = JSON.parse(fs.readFileSync(path.join(__dirname, 'ipl-canonical-squads.json'), 'utf8'));
const ourTeams = db.prepare('SELECT id, short_code, name FROM teams').all();
const shortToOurId = Object.fromEntries(ourTeams.map(t => [t.short_code, t.id]));

const report = { generatedAt: new Date().toISOString(), source: 'iplt20.com', teams: {} };
let T = { matched: 0, moved: 0, variant: 0, missing: 0, stale: 0 };

for (const [short, team] of Object.entries(canonical.teams)) {
  const ourTeamId = shortToOurId[short];
  if (!ourTeamId) { console.warn('[warn] no DB team for', short); continue; }

  const dbSameTeam = db.prepare('SELECT id, name, role, is_active FROM players WHERE team_id = ?').all(ourTeamId);
  const dbAllActive = db.prepare('SELECT id, name, team_id, is_active FROM players WHERE is_active = 1').all();

  const tr = { short, ourId: ourTeamId, captain: team.captain, coach: team.coach,
               matched: [], moved: [], variant: [], missing: [], stale: [] };
  const seen = new Set();

  for (const cp of team.players) {
    // First: exact/near match within this team
    const same = bestMatch(cp.name, dbSameTeam.filter(p => !seen.has(p.id)));
    if (same && same.score >= 0.9) {
      seen.add(same.player.id);
      tr.matched.push({ iplId: cp.iplId, name: cp.name, dbId: same.player.id, dbName: same.player.name, inactive: !same.player.is_active });
      continue;
    }
    if (same && same.score >= 0.5) {
      seen.add(same.player.id);
      tr.variant.push({ iplId: cp.iplId, name: cp.name, dbId: same.player.id, dbName: same.player.name, score: +same.score.toFixed(2) });
      continue;
    }
    // Not on our team — check ALL active players for trade detection
    const global = bestMatch(cp.name, dbAllActive);
    if (global && global.score >= 0.9 && global.player.team_id !== ourTeamId) {
      tr.moved.push({ iplId: cp.iplId, name: cp.name, dbId: global.player.id, dbName: global.player.name, fromTeamId: global.player.team_id });
      continue;
    }
    tr.missing.push({ iplId: cp.iplId, name: cp.name, slug: cp.slug, role: cp.role, nationality: cp.nationality });
  }

  // Stale: DB players on this team not matched by anyone in canonical
  for (const p of dbSameTeam) {
    if (seen.has(p.id)) continue;
    if (!p.is_active) continue;
    tr.stale.push({ dbId: p.id, dbName: p.name, role: p.role });
  }

  // ── Auto-reconcile spelling variants ───────────────────────────────────
  // When a team has BOTH a missing (canonical-only) and a stale (DB-only)
  // whose names share any significant token, assume they're the same player
  // with a spelling variant. Reclassify as `variant` (rename) rather than
  // add+deactivate separately.
  const STOPWORDS = new Set(['singh', 'kumar', 'sharma', 'khan', 'patel', 'yadav']); // too common
  function tokens(n) { return norm(n).split(' ').filter(t => t.length > 2 && !STOPWORDS.has(t)); }
  const pairedMissingIdx = new Set();
  const pairedStaleIdx = new Set();
  for (let i = 0; i < tr.missing.length; i++) {
    for (let j = 0; j < tr.stale.length; j++) {
      if (pairedMissingIdx.has(i) || pairedStaleIdx.has(j)) continue;
      const mt = tokens(tr.missing[i].name);
      const st = tokens(tr.stale[j].dbName);
      if (mt.length === 0 || st.length === 0) continue;
      const shared = mt.filter(t => st.includes(t)).length;
      // Require at least ONE distinctive shared token (after stopword removal)
      // OR a very close string similarity on the full name.
      const nameSim = similarity(tr.missing[i].name, tr.stale[j].dbName);
      if (shared >= 1 || nameSim >= 0.5) {
        tr.variant.push({
          iplId: tr.missing[i].iplId,
          name: tr.missing[i].name,
          dbId: tr.stale[j].dbId,
          dbName: tr.stale[j].dbName,
          note: 'auto-reconciled from missing+stale pair',
        });
        pairedMissingIdx.add(i);
        pairedStaleIdx.add(j);
      }
    }
  }
  // Drop the paired entries
  tr.missing = tr.missing.filter((_, i) => !pairedMissingIdx.has(i));
  tr.stale   = tr.stale.filter((_, j) => !pairedStaleIdx.has(j));

  report.teams[short] = tr;
  T.matched += tr.matched.length;
  T.moved += tr.moved.length;
  T.variant += tr.variant.length;
  T.missing += tr.missing.length;
  T.stale += tr.stale.length;
}

report.totals = T;
const outPath = path.join(__dirname, 'audit-report.json');
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

// Pretty print
console.log('\n════ AUDIT (iplt20.com canonical 25-man squads) ═════════════\n');
for (const [short, t] of Object.entries(report.teams)) {
  const totalInCanonical = t.matched.length + t.moved.length + t.variant.length + t.missing.length;
  console.log(`${short.padEnd(5)} — canonical ${totalInCanonical}  ✓${t.matched.length}  ⇄${t.moved.length}  ?${t.variant.length}  ➕${t.missing.length}  ✗${t.stale.length}${t.captain ? `  |  C: ${t.captain}` : ''}`);
  if (t.moved.length)   { console.log('  ⇄ MOVED:');     t.moved.forEach(x => console.log(`      ${x.name}  (currently team #${x.fromTeamId}, should be ${short})  dbId=${x.dbId}`)); }
  if (t.variant.length) { console.log('  ? SPELLING:');  t.variant.forEach(x => console.log(`      "${x.dbName}" → "${x.name}"  dbId=${x.dbId}  score=${x.score}`)); }
  if (t.missing.length) { console.log('  ➕ MISSING:');   t.missing.forEach(x => console.log(`      ${x.name}  (${x.role || '?'}, ${x.nationality || '?'}, iplId=${x.iplId})`)); }
  if (t.stale.length)   { console.log('  ✗ NOT IN CANONICAL:');  t.stale.forEach(x => console.log(`      ${x.dbName}  (${x.role || '?'}, dbId=${x.dbId})`)); }
  console.log();
}
console.log(`Totals: matched ${T.matched}, moved ${T.moved}, variants ${T.variant}, missing ${T.missing}, stale ${T.stale}`);
console.log(`Report: ${outPath}\n`);

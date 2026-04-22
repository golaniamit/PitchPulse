// Phase 3 — apply the canonical-squad audit to the DB.
//
// Default: DRY RUN (prints every change, touches nothing).
// Apply for real:  node server/scripts/apply-audit.js --apply
//
// Changes made (all in a single transaction):
//   - Rename:      9 spelling variants to iplt20.com canonical names
//   - Trade:       update team_id for players who moved mid-season
//   - Insert:      new players from iplt20.com with ipl_id, role, nationality
//   - Deactivate:  players no longer in any IPL 2026 squad (is_active=0)
//   - Manual fixups: MI — Surya Kumar Yadav rename, Quinton de Kock trade
//
// On first run, this also adds an `ipl_id` column to `players` (idempotent).
// The column gives us a stable foreign key into iplt20.com data for the
// follow-up headshot fetch and future audits.

const fs = require('fs');
const path = require('path');
const db = require('../db');

const APPLY = process.argv.includes('--apply');

// ─── Helpers ─────────────────────────────────────────────────────────────

// Normalise iplt20's role strings to our existing {batter, bowler, all-rounder, wk} vocabulary.
function normRole(raw) {
  if (!raw) return null;
  const s = raw.toLowerCase().trim();
  if (s.includes('wicketkeeper') || s === 'wk' || s.includes('wk-batter')) return 'wk';
  if (s.includes('allrounder') || s.includes('all rounder') || s.includes('all-rounder')) return 'all-rounder';
  if (s.includes('bowler')) return 'bowler';
  if (s.includes('batter') || s.includes('batsman')) return 'batter';
  return null;
}

function pick(players, iplId) { return players.find(p => String(p.iplId) === String(iplId)); }

// ─── Load data ──────────────────────────────────────────────────────────

const report    = JSON.parse(fs.readFileSync(path.join(__dirname, 'audit-report.json'), 'utf8'));
const canonical = JSON.parse(fs.readFileSync(path.join(__dirname, 'ipl-canonical-squads.json'), 'utf8'));

// ─── Ensure ipl_id column + unique index exist ──────────────────────────
// SQLite can't add a UNIQUE column via ALTER TABLE, so we add the column
// first (NULL-allowed) and then enforce uniqueness with a partial index.
try { db.exec('ALTER TABLE players ADD COLUMN ipl_id INTEGER'); } catch (_) {}
try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_ipl_id ON players(ipl_id) WHERE ipl_id IS NOT NULL'); } catch (_) {}

const teams = db.prepare('SELECT id, short_code FROM teams').all();
const shortToId = Object.fromEntries(teams.map(t => [t.short_code, t.id]));

// ─── Build the change list ──────────────────────────────────────────────
const ops = { rename: [], trade: [], insert: [], deactivate: [], setIplId: [] };

for (const [short, t] of Object.entries(report.teams)) {
  const teamId = shortToId[short];
  const teamCanon = canonical.teams[short]?.players || [];

  // ✓ matched — set ipl_id on existing rows (stable key for later headshot fetch)
  for (const m of t.matched) {
    ops.setIplId.push({ dbId: m.dbId, iplId: m.iplId, reason: `matched exactly to ${m.name}` });
  }

  // ? variants — rename + set ipl_id
  for (const v of t.variant) {
    ops.rename.push({ dbId: v.dbId, from: v.dbName, to: v.name, iplId: v.iplId, teamShort: short });
  }

  // ⇄ trades — update team_id + set ipl_id
  for (const mv of t.moved) {
    ops.trade.push({ dbId: mv.dbId, name: mv.name, fromTeamId: mv.fromTeamId, toTeamId: teamId, iplId: mv.iplId, teamShort: short });
  }

  // ➕ missing — insert new row
  for (const miss of t.missing) {
    const canon = pick(teamCanon, miss.iplId);
    ops.insert.push({
      name: miss.name,
      slug: canon?.slug || null,
      teamId,
      role: normRole(canon?.role),
      iplId: miss.iplId,
      nationality: canon?.nationality,
      teamShort: short,
    });
  }

  // ✗ stale — deactivate
  for (const st of t.stale) {
    ops.deactivate.push({ dbId: st.dbId, name: st.dbName, teamShort: short });
  }
}

// ─── Manual fixups (audit matcher missed these) ─────────────────────────
// MI: "Surya Kumar Yadav" (iplId=108) is our existing Suryakumar Yadav (dbId=19)
const SURYA_DB_ID = 19;
const SURYA_IPL_ID = 108;
const suryaCanon = canonical.teams.MI.players.find(p => String(p.iplId) === String(SURYA_IPL_ID));
if (suryaCanon) {
  ops.rename.push({ dbId: SURYA_DB_ID, from: 'Suryakumar Yadav', to: 'Surya Kumar Yadav', iplId: SURYA_IPL_ID, teamShort: 'MI', note: 'manual fixup' });
  // Drop the false-positive "missing" and "stale" entries for Surya
  ops.insert = ops.insert.filter(o => String(o.iplId) !== String(SURYA_IPL_ID));
}
// MI: Quinton de Kock — iplt20 has him at MI; our DB has him at team #10 (LSG). Trade.
const QDK_IPL_ID = 834;
const qdkRow = db.prepare("SELECT id, team_id FROM players WHERE name LIKE 'Quinton%de Kock%'").get();
if (qdkRow) {
  ops.trade.push({ dbId: qdkRow.id, name: 'Quinton de Kock', fromTeamId: qdkRow.team_id, toTeamId: shortToId.MI, iplId: QDK_IPL_ID, teamShort: 'MI', note: 'manual fixup' });
  ops.insert = ops.insert.filter(o => String(o.iplId) !== String(QDK_IPL_ID));
}

// ─── Conflict resolution ────────────────────────────────────────────────
// A player who was traded from team A to team B appears in team A's `stale`
// bucket AND team B's `moved` bucket. We've created both a `trade` op and a
// `deactivate` op for the same dbId. The trade wins — drop the deactivate.
// Same story for renames (a renamed player is never also deactivated).
const keepAliveIds = new Set([
  ...ops.rename.map(r => r.dbId),
  ...ops.trade.map(t => t.dbId),
]);
ops.deactivate = ops.deactivate.filter(d => !keepAliveIds.has(d.dbId));

// ─── Print summary ──────────────────────────────────────────────────────

console.log('\n════ PLANNED CHANGES ═══════════════════════════════════════\n');

console.log(`RENAMES (${ops.rename.length}):`);
for (const r of ops.rename) console.log(`  [${r.teamShort}] ${r.from}  →  ${r.to}  (dbId=${r.dbId}, iplId=${r.iplId})${r.note ? ` — ${r.note}` : ''}`);

console.log(`\nTRADES (${ops.trade.length}):`);
for (const t of ops.trade) console.log(`  [${t.teamShort}] ${t.name}  team #${t.fromTeamId} → #${t.toTeamId}  (dbId=${t.dbId})${t.note ? ` — ${t.note}` : ''}`);

console.log(`\nINSERTS (${ops.insert.length}):`);
for (const i of ops.insert) console.log(`  [${i.teamShort}] + ${i.name}  (role=${i.role || '?'}, iplId=${i.iplId}, ${i.nationality || '?'})`);

console.log(`\nDEACTIVATE (${ops.deactivate.length}):`);
for (const d of ops.deactivate) console.log(`  [${d.teamShort}] − ${d.name}  (dbId=${d.dbId})`);

console.log(`\nSET ipl_id ON MATCHED (${ops.setIplId.length} existing rows)`);

if (!APPLY) {
  console.log('\n── DRY RUN — no DB changes. Re-run with --apply to commit. ──\n');
  process.exit(0);
}

// ─── Apply ───────────────────────────────────────────────────────────────

// Back up the DB file before touching anything
const dbPath = path.join(__dirname, '..', '..', 'market.db');
if (fs.existsSync(dbPath)) {
  const backup = `${dbPath}.bak-${Date.now()}`;
  fs.copyFileSync(dbPath, backup);
  console.log(`\n📦 DB backup: ${backup}`);
}

const tx = db.transaction(() => {
  const updateName = db.prepare('UPDATE players SET name = ?, ipl_id = ?, is_active = 1 WHERE id = ?');
  // Matched/variant/trade rows should always be active — the iplt20 list is canonical.
  const updateIplId = db.prepare('UPDATE players SET ipl_id = ?, is_active = 1 WHERE id = ?');
  const trade       = db.prepare('UPDATE players SET team_id = ?, ipl_id = ?, is_active = 1 WHERE id = ?');
  const deactivate  = db.prepare('UPDATE players SET is_active = 0 WHERE id = ?');
  const insert      = db.prepare(`INSERT INTO players (name, slug, team_id, role, ipl_id, is_active)
                                  VALUES (?, ?, ?, ?, ?, 1)`);

  // Renames
  for (const r of ops.rename) updateName.run(r.to, r.iplId, r.dbId);
  // Trades
  for (const t of ops.trade) trade.run(t.toTeamId, t.iplId, t.dbId);
  // ipl_id backfill for matched
  for (const s of ops.setIplId) {
    try { updateIplId.run(s.iplId, s.dbId); } catch (e) { /* unique conflict — another row already has this ipl_id */ }
  }
  // Deactivations
  for (const d of ops.deactivate) deactivate.run(d.dbId);
  // Inserts — upsert by ipl_id. If a row with that ipl_id already exists
  // (from an earlier partial run, or because the player was on another team
  // before), UPDATE it (reactivate + set current team/name/role) rather than
  // silently skipping. This makes re-running the script idempotent.
  const upsertByIplId = db.prepare(
    'UPDATE players SET name = ?, team_id = ?, role = ?, is_active = 1 WHERE ipl_id = ?'
  );
  for (const ins of ops.insert) {
    const existing = db.prepare('SELECT id FROM players WHERE ipl_id = ?').get(Number(ins.iplId));
    if (existing) {
      upsertByIplId.run(ins.name, ins.teamId, ins.role, Number(ins.iplId));
      continue;
    }
    // Genuinely new — ensure slug is unique then INSERT
    let slug = ins.slug || ins.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    let suffix = 0;
    while (db.prepare('SELECT 1 FROM players WHERE slug = ?').get(slug)) slug = `${ins.slug || ins.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${++suffix}`;
    insert.run(ins.name, slug, ins.teamId, ins.role, ins.iplId);
  }
});

try {
  tx();
  console.log('\n✓ Applied.\n');
} catch (e) {
  console.error('\n✗ Transaction failed — DB rolled back.');
  console.error(e.message);
  process.exit(1);
}

// Post-summary
const totalActive = db.prepare('SELECT COUNT(*) AS n FROM players WHERE is_active = 1').get().n;
const byTeam = db.prepare(`
  SELECT t.short_code, COUNT(p.id) AS n
  FROM teams t LEFT JOIN players p ON p.team_id = t.id AND p.is_active = 1
  GROUP BY t.id ORDER BY t.short_code
`).all();
console.log(`Active players now: ${totalActive}`);
for (const r of byTeam) console.log(`  ${r.short_code.padEnd(5)} ${r.n}`);

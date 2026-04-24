// One-shot audit + reversal for player_runs / player_wickets / batsman_milestone
// contracts that may have resolved NO incorrectly because of the stale-isOut
// bug in cricbuzz.js's scorecard normalizer (a batter still at the crease was
// being flagged as dismissed, triggering an early-NO).
//
// Usage:
//   node server/scripts/audit-player-resolutions.js             # dry-run audit only
//   node server/scripts/audit-player-resolutions.js --apply     # reverse mismatches
//
// Audit logic: for every resolved contract of the affected types, fetch the
// current Cricbuzz scorecard (using the FIXED normalizer) and re-run the same
// evaluator that originally settled it. If the re-evaluated answer disagrees
// with the stored resolution, it's flagged.
//
// Reversal logic (--apply): for each mismatched contract, subtract the old
// winner payouts from winners' balances, credit the new winners, and update
// the contracts row's resolution + resolve_reason. Mirrors the undo-settle
// route's math.

const db = require('../db');
const { fetchMatch, fetchScorecard } = require('../engine/cricbuzz');
const { _evaluate: evaluate } = require('../engine/cricbuzz-resolver');
const { adjustBalance } = require('../lib/context');

const APPLY = process.argv.includes('--apply');
const AFFECTED_TYPES = ['player_runs', 'player_wickets', 'batsman_milestone'];

async function main() {
  const contracts = db.prepare(
    `SELECT id, title, type, condition_json, match_id, resolution, resolve_reason, group_id, resolved_at
       FROM contracts
      WHERE status = 'resolved'
        AND type IN (${AFFECTED_TYPES.map(() => '?').join(',')})
      ORDER BY id DESC`
  ).all(...AFFECTED_TYPES);

  console.log(`Auditing ${contracts.length} resolved contract(s) of type ${AFFECTED_TYPES.join(', ')}...\n`);

  // Match-level caches so we don't refetch for every contract on the same match.
  const matchCache = new Map();
  const scorecardCache = new Map();

  const mismatches = [];
  for (const c of contracts) {
    const condition = safeParse(c.condition_json);
    if (!condition) {
      console.log(`  [skip] ${c.id} "${c.title}" — condition_json unparseable`);
      continue;
    }
    if (!c.match_id) {
      console.log(`  [skip] ${c.id} "${c.title}" — no match_id`);
      continue;
    }

    let match, scorecard;
    try {
      if (!matchCache.has(c.match_id)) matchCache.set(c.match_id, await fetchMatch(c.match_id));
      if (!scorecardCache.has(c.match_id)) scorecardCache.set(c.match_id, await fetchScorecard(c.match_id));
      match = matchCache.get(c.match_id);
      scorecard = scorecardCache.get(c.match_id);
    } catch (e) {
      console.log(`  [skip] ${c.id} "${c.title}" — fetch failed: ${e.message}`);
      continue;
    }

    // Evaluator signature: (condition, match, overs, scorecard)
    let newVerdict;
    try {
      newVerdict = evaluate(condition, match, null, scorecard);
    } catch (e) {
      console.log(`  [err]  ${c.id} "${c.title}" — evaluate threw: ${e.message}`);
      continue;
    }

    // Map evaluator output (true/false/null) to 'yes'/'no'/null.
    const newRes = newVerdict === true ? 'yes' : newVerdict === false ? 'no' : null;

    // "Was resolved, should still be pending" = resolved prematurely. Still a
    // mismatch — we reverse it and flip status back to 'active' so the
    // resolver can pick it up once the match genuinely ends.
    if (newRes === c.resolution) {
      console.log(`  [ok]    ${c.id} "${c.title}" — still ${c.resolution}`);
      continue;
    }

    const tag = newRes == null ? 'EARLY' : 'BAD';
    const target = newRes == null ? 'PENDING (reopen)' : newRes.toUpperCase();
    console.log(`  [${tag}]  ${c.id} "${c.title}" — was ${c.resolution.toUpperCase()}, should be ${target}`);
    mismatches.push({ contract: c, oldRes: c.resolution, newRes });
  }

  console.log(`\nFound ${mismatches.length} mismatch(es).`);
  if (mismatches.length === 0) return;

  if (!APPLY) {
    console.log('Dry-run complete. Re-run with --apply to reverse these resolutions.');
    return;
  }

  console.log('\nApplying reversals...');
  for (const { contract, oldRes, newRes } of mismatches) {
    reverseAndReResolve(contract, oldRes, newRes);
  }
  console.log('\nDone.');
}

function reverseAndReResolve(contract, oldRes, newRes) {
  const gid = contract.group_id || null;
  const positions = db.prepare('SELECT * FROM positions WHERE contract_id = ?').all(contract.id);

  let reversed = 0;
  let credited = 0;
  const txn = db.transaction(() => {
    // Step 1: always reverse the old-winner payouts.
    for (const pos of positions) {
      if (pos.side === oldRes) {
        const payout = pos.quantity * 100;
        const nb = adjustBalance(pos.user_id, gid, -payout);
        if (nb != null) reversed++;
      }
    }

    if (newRes == null) {
      // Premature resolution → reopen the contract so the resolver finishes it
      // correctly when the match genuinely ends.
      const newReason = `[audit-reopen] resolved ${oldRes.toUpperCase()} prematurely by isOut-normalizer bug; reopened for re-evaluation`;
      db.prepare(
        "UPDATE contracts SET status = 'active', resolution = NULL, resolved_at = NULL, " +
        "resolve_reason = ?, last_eval_at = NULL, last_eval_reason = NULL WHERE id = ?"
      ).run(newReason, contract.id);
    } else {
      // Definite flip → credit correct-side winners and update resolution.
      for (const pos of positions) {
        if (pos.side === newRes) {
          const payout = pos.quantity * 100;
          const nb = adjustBalance(pos.user_id, gid, payout);
          if (nb != null) credited++;
        }
      }
      const newReason = `[audit-reversal] was ${oldRes.toUpperCase()}, corrected to ${newRes.toUpperCase()} after isOut-normalizer fix`;
      db.prepare('UPDATE contracts SET resolution = ?, resolve_reason = ? WHERE id = ?')
        .run(newRes, newReason, contract.id);
    }
  });
  txn();

  const outcome = newRes == null
    ? `reopened (reversed ${reversed} old-winners)`
    : `${oldRes.toUpperCase()} → ${newRes.toUpperCase()}  (reversed ${reversed}, credited ${credited})`;
  console.log(`  [fixed] ${contract.id} "${contract.title}": ${outcome}`);
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

main().then(() => process.exit(0)).catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});

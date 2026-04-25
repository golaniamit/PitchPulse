// LLM-backed parser that converts free-text cricket prediction sentences
// into structured contract drafts ready for the ContractBuilder UI.
//
// Talks to a local Ollama instance. Model + URL are env-configurable so the
// admin can swap models without a code change. Defaults assume an Ollama
// running on the same host as the dev server.
//
// Pipeline:
//   sentence  →  /api/generate (format=json, low temp)
//             →  parsed JSON (model output)
//             →  toContractDraft() resolves team/player names to DB ids
//             →  ContractBuilder-shaped object the admin reviews + edits

const db = require('../db');
const { getCachedMatchData } = require('./cricbuzz-resolver');

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'deepseek-r1:14b';

// Edit this list to teach the parser new conventions. Plain English — these
// lines become part of the system prompt verbatim, so phrasing matters.
const DIRECTIVES = [
  'If a match is currently live and the sentence does not name a different match, assume the contract is for the live match (set match_id and team_short from the live match context).',
  'Default resolve_mode to "auto" for any contract that can be settled from match data. Use "manual" only for free-text questions that the resolver cannot evaluate.',
  'Phrase the title as a yes/no question (e.g. "Will MI score 50+ in the powerplay?").',
  'For thresholds: "50+", "at least 50", "fifty or more" → operator ">=" with threshold 50. "more than 50" → operator ">" with threshold 50.',
  'When the sentence mentions a phase like "powerplay", "death overs", or "this over", set the matching phase + type — do not fall back to a custom_* type unless the question genuinely doesn\'t fit any structured type.',
  'CRITICAL — "by" vs "in" distinguishes cumulative from single-over: "by the 11th", "by over 11", "by end of over 11", "after 11 overs" all mean CUMULATIVE TEAM TOTAL up to that point → use phase "by_over" with type "team_total" (or team_wickets_by_over for wickets). Versus "in over 11", "during over 11", "this over" which mean a SINGLE over → use phase "over" with type "runs_over" (or wicket_over).',
  'Cross-check the threshold against the type: a single over rarely sees more than ~30 runs, so a threshold of 50, 100, 120, 150+ almost certainly means the question is cumulative (team_total / by_over), not runs_over.',
  'CONTEXT-FILLING — sentences are often elliptical (e.g. just "120 by 12th", "3 wickets by 8", "50+ in powerplay"). Use the LIVE MATCH context to fill in missing pieces: the implied SUBJECT is the currently-batting team, the implied VERB is "score" for run-thresholds and "lose wickets" for wicket-thresholds, and the implied MATCH is the live match. Reconstruct a full yes/no title even when the input is just numbers + a phrase.',
  'When the sentence mentions a specific team that ISN\'T currently batting (e.g. "DC to win toss" while MI is batting), do NOT default to the batting team — use the team named in the sentence. The batting-team default only applies when the sentence omits the subject entirely.',
  'CRITICAL — once you resolve a team (named or inferred from the batting context), you MUST set BOTH "team_short" at the top level AND "condition.team" to that short_code. Never leave team_short null when a team is identifiable. Use the resolved team\'s actual short_code or full name in the title — never write generic phrases like "the batting team" or "the team" in the title.',
  'PLAYER CONTRACTS — for player_runs, player_wickets, batsman_milestone, bowler_wickets_by_over: the named player can be on EITHER side of the live match (a bowler will usually be from the BOWLING side, a batsman from the BATTING side). Do NOT assume the player is on the batting team. If you are unsure which side the player belongs to, leave team_short null — the server resolves the player\'s actual team from its roster and will fill team_short in for you. Never invent a team that isn\'t playing the live match.',
];

// Concrete JSON examples — fully resolved with the actual batting-team
// short_code substituted in. Showing the exact target shape (rather than
// "→ type=X, team=<batting team>" shorthand) stops the model from emitting
// placeholder text like "<batting team>" in its output.
function buildPhraseExamples(battingTeam, matchId) {
  // Use whatever is live; fall back to a clearly-marked example team if
  // there's no live match so the format itself stays informative.
  const T = battingTeam || 'MI';
  const M = matchId || 'EXAMPLE_MATCH_ID';
  // Each example is a labelled (input, output) pair so the model learns the
  // mapping rather than treating examples as a general template.
  return `
Input: "Will MI score 50+ in the powerplay?"
Output: {"title":"Will MI score 50+ in the powerplay?","type":"runs_powerplay","phase":"powerplay","subject_kind":"team","team_short":"MI","opponent_team_short":null,"player_name":null,"match_id":"${M}","over_number":null,"innings_number":null,"resolve_mode":"auto","condition":{"type":"runs_powerplay","team":"MI","operator":">=","threshold":50,"over":null,"min_wickets":null,"boundary_type":null,"boundary_count":null,"milestone":null}}

Input: "Will MI score 12+ in over 11?"
Output: {"title":"Will MI score 12+ runs in over 11?","type":"runs_over","phase":"over","subject_kind":"team","team_short":"MI","opponent_team_short":null,"player_name":null,"match_id":"${M}","over_number":11,"innings_number":null,"resolve_mode":"auto","condition":{"type":"runs_over","team":"MI","operator":">=","threshold":12,"over":11,"min_wickets":null,"boundary_type":null,"boundary_count":null,"milestone":null}}

Input: "Will Rohit score 30+ in this match?"
Output: {"title":"Will Rohit score 30+ runs in this match?","type":"player_runs","phase":"match","subject_kind":"player","team_short":"MI","opponent_team_short":null,"player_name":"Rohit","match_id":"${M}","over_number":null,"innings_number":null,"resolve_mode":"auto","condition":{"type":"player_runs","team":"MI","operator":">=","threshold":30,"over":null,"min_wickets":null,"boundary_type":null,"boundary_count":null,"milestone":null}}

ELLIPTICAL SHORTHAND (batting team here is "${T}" — substitute the LIVE batting team in your output):

Input: "120 by 12th"
Output: {"title":"Will ${T} score 120 by the 12th over?","type":"team_total","phase":"by_over","subject_kind":"team","team_short":"${T}","opponent_team_short":null,"player_name":null,"match_id":"${M}","over_number":12,"innings_number":null,"resolve_mode":"auto","condition":{"type":"team_total","team":"${T}","operator":">=","threshold":120,"over":12,"min_wickets":null,"boundary_type":null,"boundary_count":null,"milestone":null}}

Input: "3 wickets by 8"
Output: {"title":"Will ${T} lose 3+ wickets by over 8?","type":"team_wickets_by_over","phase":"by_over","subject_kind":"team","team_short":"${T}","opponent_team_short":null,"player_name":null,"match_id":"${M}","over_number":8,"innings_number":null,"resolve_mode":"auto","condition":{"type":"team_wickets_by_over","team":"${T}","operator":">=","threshold":null,"over":8,"min_wickets":3,"boundary_type":null,"boundary_count":null,"milestone":null}}

Input: "50+ in powerplay"
Output: {"title":"Will ${T} score 50+ runs in the powerplay?","type":"runs_powerplay","phase":"powerplay","subject_kind":"team","team_short":"${T}","opponent_team_short":null,"player_name":null,"match_id":"${M}","over_number":null,"innings_number":null,"resolve_mode":"auto","condition":{"type":"runs_powerplay","team":"${T}","operator":">=","threshold":50,"over":null,"min_wickets":null,"boundary_type":null,"boundary_count":null,"milestone":null}}

Input: "a wicket in 7"
Output: {"title":"Will ${T} lose a wicket in over 7?","type":"wicket_over","phase":"over","subject_kind":"team","team_short":"${T}","opponent_team_short":null,"player_name":null,"match_id":"${M}","over_number":7,"innings_number":null,"resolve_mode":"auto","condition":{"type":"wicket_over","team":"${T}","operator":">=","threshold":null,"over":7,"min_wickets":1,"boundary_type":null,"boundary_count":null,"milestone":null}}
  `.trim();
}

const TYPE_CATALOG = `
- runs_over (phase: over, subject: team) — Team scores N+ runs in a SPECIFIC over (over_number required)
- wicket_over (phase: over, subject: team) — Team loses N+ wickets in a SPECIFIC over (over_number required)
- boundary_over (phase: over, subject: team) — N+ sixes/fours in a SPECIFIC over
- team_total (phase: by_over, subject: team) — Team cumulative score BY end of over X
- team_wickets_by_over (phase: by_over, subject: team) — Team has lost N+ wickets by end of over X
- batsman_milestone (phase: by_over, subject: player) — Specific batsman scores N+ by end of over X
- runs_powerplay (phase: powerplay, subject: team) — Team scores N+ in overs 1-6
- wickets_powerplay (phase: powerplay, subject: team) — Team loses N+ wickets in overs 1-6
- boundaries_powerplay (phase: powerplay, subject: team) — N+ sixes/fours in overs 1-6
- runs_death (phase: death, subject: team) — Team scores N+ in overs 16-20
- wickets_death (phase: death, subject: team) — Team loses N+ wickets in overs 16-20
- boundaries_death (phase: death, subject: team) — N+ sixes/fours in overs 16-20
- match_winner (phase: match, subject: matchup) — Which team wins the match (set team_short to the picked winner)
- toss_winner (phase: match, subject: team) — Which team wins the toss
- innings_score (phase: match, subject: team) — Team total at end of innings
- player_runs (phase: match, subject: player) — Batsman scores N+ runs across the whole match
- player_wickets (phase: match, subject: player) — Bowler takes N+ wickets across the whole match
- manual (phase: match, subject: match_generic) — Free-text question; resolve_mode must be "manual"
`.trim();

// Richer live-match snapshot for the prompt. The parser uses the batting/
// bowling split to fill in elliptical sentences like "120 by 12th" → the
// implied subject is whoever is batting right now.
function getLiveMatchContext() {
  const matchId = process.env.CRIC_MATCH_ID;
  if (!matchId || matchId === 'the_match_id_for_todays_game') return null;
  const data = getCachedMatchData();

  // No cache yet (resolver hasn't polled) — fall back to env-only basics.
  if (!data) {
    const teamsRaw = (process.env.CRIC_MATCH_TEAMS || '').split('|').filter(Boolean);
    return {
      matchId,
      matchName: process.env.CRIC_MATCH_NAME || matchId,
      teams: teamsRaw,
      battingTeam: null,
      bowlingTeam: null,
      currentScore: null,
      currentOvers: null,
      status: null,
      format: null,
    };
  }

  const teamObjs = data.teams || [];
  const teamNames = teamObjs.map(t => t.shortName || t.name).filter(Boolean);
  const batting = data.current?.batTeamId
    ? teamObjs.find(t => t.id === data.current.batTeamId) || null
    : null;
  const bowling = batting
    ? teamObjs.find(t => t.id !== batting.id) || null
    : null;
  const lastInnings = data.innings?.[data.innings.length - 1];

  return {
    matchId,
    matchName: data.name || process.env.CRIC_MATCH_NAME || matchId,
    teams: teamNames,
    battingTeam: batting ? (batting.shortName || batting.name) : null,
    bowlingTeam: bowling ? (bowling.shortName || bowling.name) : null,
    currentScore: data.current
      ? `${data.current.batTeamScore ?? '?'}/${data.current.batTeamWkts ?? '?'}`
      : null,
    currentOvers: lastInnings?.overs ?? null,
    status: data.status || data.state || null,
    format: data.format || null,
  };
}

function getTeamCatalog() {
  const teams = db.prepare('SELECT id, name, short_code FROM teams ORDER BY short_code').all();
  return teams.map(t => `${t.short_code} — ${t.name}`).join('\n');
}

function buildPrompt(sentence) {
  const live = getLiveMatchContext();
  return `You parse cricket prediction sentences into structured JSON contract drafts.

CONTRACT TYPES (pick exactly one):
${TYPE_CATALOG}

PHASES: over, by_over, powerplay, death, match
SUBJECT KINDS: team, player, matchup, match_generic

${live ? `LIVE MATCH CONTEXT (treat as the default for any unspecified detail):
- match_id: "${live.matchId}"
- name: ${live.matchName}
- teams: ${live.teams.length ? live.teams.join(' vs ') : 'unknown'}
- currently batting: ${live.battingTeam || 'unknown'}
- currently bowling: ${live.bowlingTeam || 'unknown'}
- current score: ${live.currentScore ? `${live.currentScore} (${live.currentOvers ?? 0} overs)` : 'not started'}
- status: ${live.status || 'unknown'}
- format: ${live.format || 'T20'}` : 'NO MATCH IS CURRENTLY LIVE — leave match_id null unless the sentence names one.'}

TEAMS IN DATABASE (use the short_code, e.g. "MI", in team_short / opponent_team_short):
${getTeamCatalog()}

DIRECTIVES (follow these exactly):
${DIRECTIVES.map((d, i) => `${i + 1}. ${d}`).join('\n')}

EXAMPLES (study the input → JSON-output mapping carefully — match this format exactly):
${buildPhraseExamples(live?.battingTeam, live?.matchId)}

OUTPUT — return ONLY this JSON object, no commentary, no markdown fences:
{
  "title": "<the user-facing yes/no question>",
  "type": "<one type id from the catalog above>",
  "phase": "<one phase>",
  "subject_kind": "<one subject kind>",
  "team_short": "<short_code, or null>",
  "opponent_team_short": "<short_code, or null>",
  "player_name": "<full player name string, or null>",
  "match_id": "<match id or null>",
  "over_number": <integer or null>,
  "innings_number": <1, 2, or null>,
  "resolve_mode": "<auto or manual>",
  "condition": {
    "type": "<same as top-level type>",
    "team": "<short_code or null>",
    "operator": "<one of: >=, >, <=, or null>",
    "threshold": <integer or null>,
    "over": <integer or null>,
    "min_wickets": <integer or null>,
    "boundary_type": "<six, four, or null>",
    "boundary_count": <integer or null>,
    "milestone": <integer or null>
  }
}

If the sentence is too vague to map to a contract type, return: { "error": "<one sentence explaining what's missing>" }

SENTENCE: """${sentence.trim()}"""`.trim();
}

async function callOllama(prompt) {
  let r;
  try {
    // We don't pass format:'json' — reasoning models (deepseek-r1) tend to
    // return an empty {} in strict JSON mode when the prompt is non-trivial.
    // Instead we ask for raw output, strip thinking, and extract the {...}
    // block ourselves. Ollama already separates `thinking` from `response`
    // on R1-family models, so the response field is usually clean JSON.
    r = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: { temperature: 0.1 },
      }),
    });
  } catch (e) {
    const code = e.cause?.code || e.code;
    if (code === 'ECONNREFUSED') {
      throw new Error(`Ollama unreachable at ${OLLAMA_URL}. Is the ollama service running?`);
    }
    throw e;
  }

  if (!r.ok) {
    const text = await r.text().catch(() => '');
    if (r.status === 404) {
      throw new Error(`Model "${OLLAMA_MODEL}" not found. Run: ollama pull ${OLLAMA_MODEL}`);
    }
    throw new Error(`Ollama returned ${r.status}: ${text.slice(0, 300)}`);
  }

  const j = await r.json();
  return j.response || '';
}

function extractJson(raw) {
  // Reasoning models (deepseek-r1, etc.) emit <think>...</think> before the
  // answer. Strip that first, then try a clean parse, then fall back to a
  // regex grab of the outermost {...} block.
  let cleaned = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through */ }
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Model returned non-JSON: ${cleaned.slice(0, 300)}`);
  }
  return JSON.parse(match[0]);
}

async function parseSentence(sentence) {
  const prompt = buildPrompt(sentence);
  const raw = await callOllama(prompt);
  const parsed = extractJson(raw);
  if (parsed.error) return { ok: false, error: parsed.error, raw };
  return { ok: true, parsed, raw };
}

// Resolve team short_codes / player names to DB ids and shape the object the
// way ContractBuilder's `editing` prop expects. condition_json must be a
// STRING because the builder calls JSON.parse() on it.
function toContractDraft(parsed) {
  const teams   = db.prepare('SELECT id, short_code, name FROM teams').all();
  const players = db.prepare('SELECT id, name, team_id FROM players').all();

  // Standard Levenshtein. Returns edit distance between two lowercase strings.
  function lev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const dp = Array.from({ length: b.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= a.length; j++) dp[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const cost = b[i - 1] === a[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      }
    }
    return dp[b.length][a.length];
  }

  // Per-token threshold: short tokens (initials, "MS") need exact match;
  // longer tokens get more slack.
  function tokenThreshold(t) {
    if (t.length <= 3) return 0;
    if (t.length <= 5) return 1;
    return 2;
  }

  const findTeam = (code) => {
    if (!code) return null;
    const q = String(code).trim();
    const qU = q.toUpperCase();
    // Exact short_code (most common).
    let m = teams.find(t => t.short_code.toUpperCase() === qU);
    if (m) return m;
    // Substring on full name.
    const qL = q.toLowerCase();
    m = teams.find(t => t.name.toLowerCase().includes(qL));
    if (m) return m;
    // Fuzzy on short_code or first token of name (catches "MumbaiIndians",
    // "Mumbi", typos in the team's own short_code).
    let best = null, bestD = Infinity;
    for (const t of teams) {
      const candidates = [t.short_code.toLowerCase(), ...t.name.toLowerCase().split(/\s+/)];
      for (const c of candidates) {
        const d = lev(qL, c);
        const thresh = tokenThreshold(c);
        if (d <= thresh && d < bestD) { bestD = d; best = t; }
      }
    }
    return best;
  };

  const findPlayer = (name) => {
    if (!name) return null;
    const q = String(name).toLowerCase().trim();
    if (!q) return null;
    // 1. Exact substring (case-insensitive) — fast path for the common case.
    let m = players.find(p => p.name.toLowerCase().includes(q));
    if (m) return m;
    // 2. Tokenised fuzzy. Each query token must find a player-name token
    // within its length-scaled Levenshtein threshold; pick the player with
    // the lowest total distance across matched tokens.
    const qTokens = q.split(/\s+/).filter(t => t.length > 1);
    if (qTokens.length === 0) return null;
    let best = null, bestScore = Infinity;
    for (const p of players) {
      const pTokens = p.name.toLowerCase().split(/\s+/);
      let total = 0, allMatched = true;
      for (const qt of qTokens) {
        let bestTokenD = Infinity;
        for (const pt of pTokens) {
          const d = lev(qt, pt);
          if (d < bestTokenD) bestTokenD = d;
        }
        if (bestTokenD > tokenThreshold(qt)) { allMatched = false; break; }
        total += bestTokenD;
      }
      if (allMatched && total < bestScore) {
        bestScore = total;
        best = p;
      }
    }
    return best;
  };

  const team     = findTeam(parsed.team_short);
  const opponent = findTeam(parsed.opponent_team_short);
  const player   = findPlayer(parsed.player_name);

  // For player contracts, the player's actual roster team beats whatever the
  // model put in team_short — the model often hallucinates the team or
  // defaults to whoever is batting, even when the player is on the bowling
  // side. The DB's player.team_id is authoritative within a season; we skip
  // this override for season-phase contracts since rosters can shift between
  // seasons.
  const PLAYER_TYPES = new Set(['player_runs', 'player_wickets', 'batsman_milestone', 'bowler_wickets_by_over']);
  const isPlayerContract = parsed.subject_kind === 'player' || PLAYER_TYPES.has(parsed.type);
  let effectiveTeam = team;
  if (player && isPlayerContract && parsed.phase !== 'season') {
    const rosterTeam = teams.find(t => t.id === player.team_id) || null;
    if (rosterTeam) effectiveTeam = rosterTeam;
  }

  // Patch the condition's `team` to match whatever team we ended up with —
  // otherwise the resolver would settle against whichever name the model
  // emitted, even when we corrected it above.
  let conditionJson = null;
  if (parsed.condition) {
    const cond = { ...parsed.condition };
    if (effectiveTeam) cond.team = effectiveTeam.short_code;
    conditionJson = JSON.stringify(cond);
  }

  return {
    title: parsed.title || '',
    type: parsed.type || null,
    phase: parsed.phase || null,
    subject_kind: parsed.subject_kind || null,
    team_id: effectiveTeam?.id || null,
    opponent_team_id: opponent?.id || null,
    player_id: player?.id || null,
    match_id: parsed.match_id || null,
    over_number: parsed.over_number ?? null,
    innings_number: parsed.innings_number ?? null,
    resolve_mode: parsed.resolve_mode || 'auto',
    condition_json: conditionJson,
  };
}

module.exports = { parseSentence, toContractDraft };

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
];

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

function getLiveMatchContext() {
  const matchId = process.env.CRIC_MATCH_ID;
  if (!matchId || matchId === 'the_match_id_for_todays_game') return null;
  const data = getCachedMatchData();
  return {
    matchId,
    matchName: data?.name || process.env.CRIC_MATCH_NAME || matchId,
    teams: data?.teams || (process.env.CRIC_MATCH_TEAMS || '').split('|').filter(Boolean),
    status: data?.status || null,
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

${live ? `LIVE MATCH CONTEXT (use unless the sentence specifies a different match):
- match_id: "${live.matchId}"
- name: ${live.matchName}
- teams playing: ${live.teams.join(' vs ')}
- status: ${live.status || 'unknown'}` : 'NO MATCH IS CURRENTLY LIVE — leave match_id null unless the sentence names one.'}

TEAMS IN DATABASE (use the short_code, e.g. "MI", in team_short / opponent_team_short):
${getTeamCatalog()}

DIRECTIVES (follow these exactly):
${DIRECTIVES.map((d, i) => `${i + 1}. ${d}`).join('\n')}

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
  const players = db.prepare('SELECT id, name FROM players').all();

  const findTeam = (code) => {
    if (!code) return null;
    const c = String(code).toUpperCase();
    return teams.find(t => t.short_code.toUpperCase() === c) || null;
  };
  const findPlayer = (name) => {
    if (!name) return null;
    const n = String(name).toLowerCase();
    return players.find(p => p.name.toLowerCase().includes(n)) || null;
  };

  const team     = findTeam(parsed.team_short);
  const opponent = findTeam(parsed.opponent_team_short);
  const player   = findPlayer(parsed.player_name);

  return {
    title: parsed.title || '',
    type: parsed.type || null,
    phase: parsed.phase || null,
    subject_kind: parsed.subject_kind || null,
    team_id: team?.id || null,
    opponent_team_id: opponent?.id || null,
    player_id: player?.id || null,
    match_id: parsed.match_id || null,
    over_number: parsed.over_number ?? null,
    innings_number: parsed.innings_number ?? null,
    resolve_mode: parsed.resolve_mode || 'auto',
    condition_json: parsed.condition ? JSON.stringify(parsed.condition) : null,
  };
}

module.exports = { parseSentence, toContractDraft };

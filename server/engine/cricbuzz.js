// Cricbuzz fetcher — scrapes the public live-scores page and returns normalized match data.
//
// Cricbuzz's unofficial JSON endpoints are edge-blocked (403/302 to curl), but the
// live-cricket-scores HTML page embeds the data via Next.js RSC streaming
// (self.__next_f.push([1,"<chunk>"])). We decode those chunks and pull three objects
// out of the concatenated text: matchHeader, miniscore, and matchScoreDetails.
//
// The page returns a full snapshot on every fetch — no cursors, no auth. Tested against
// completed + in-progress matches. Per-over history is not in this payload; callers can
// derive it by snapshotting innings totals across polls.

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// ── HTTP ─────────────────────────────────────────────────────────────────────

async function fetchLiveScoresHTML(matchId, slug) {
  const url = `https://www.cricbuzz.com/live-cricket-scores/${matchId}/${slug}`;
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html' },
  });
  if (!r.ok) throw new Error(`Cricbuzz HTTP ${r.status} for match ${matchId}`);
  return await r.text();
}

// Discover the slug for a matchId by scraping the live-scores index page.
// Cricbuzz URLs require the slug; we cache the first hit per match.
const slugCache = new Map();
async function resolveSlug(matchId) {
  if (slugCache.has(matchId)) return slugCache.get(matchId);
  const r = await fetch('https://www.cricbuzz.com/cricket-match/live-scores', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!r.ok) throw new Error(`Cricbuzz index HTTP ${r.status}`);
  const html = await r.text();
  const re = new RegExp(`/live-cricket-scores/${matchId}/([a-z0-9-]+)`, 'i');
  const m = html.match(re);
  if (!m) throw new Error(`Match ${matchId} not found on Cricbuzz live-scores index`);
  slugCache.set(matchId, m[1]);
  return m[1];
}

// ── RSC decoding ─────────────────────────────────────────────────────────────

function decodeRSC(html) {
  // Each chunk: self.__next_f.push([1, "<json-encoded-string>"])
  const re = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  let combined = '';
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      combined += JSON.parse('"' + m[1] + '"');
    } catch { /* skip malformed chunk */ }
  }
  return combined;
}

// Extract a JSON object by locating a key and walking braces to find the matching close.
// RSC sometimes has "$ref" style values (e.g. "$28") — we keep those as strings; callers
// only care about numeric / string leaves.
function extractObject(text, key) {
  const marker = `"${key}":{`;
  const idx = text.indexOf(marker);
  if (idx < 0) return null;
  const start = idx + marker.length - 1; // position of '{'
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
        const raw = text.slice(start, i + 1);
        try { return JSON.parse(raw); } catch { return null; }
      }
    }
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────────────

async function fetchMatch(matchId, slug) {
  const effectiveSlug = slug || await resolveSlug(matchId);
  const html = await fetchLiveScoresHTML(matchId, effectiveSlug);
  const rsc = decodeRSC(html);

  const matchHeader = extractObject(rsc, 'matchHeader');
  const miniscore = extractObject(rsc, 'miniscore');
  const scoreDetails = extractObject(rsc, 'matchScoreDetails');

  if (!matchHeader && !miniscore && !scoreDetails) {
    throw new Error(`Could not parse Cricbuzz RSC payload for match ${matchId}`);
  }

  return normalize({ matchId, slug: effectiveSlug, matchHeader, miniscore, scoreDetails });
}

function normalize({ matchId, slug, matchHeader, miniscore, scoreDetails }) {
  const teams = [];
  if (matchHeader?.team1) {
    teams.push({
      id: matchHeader.team1.id,
      name: matchHeader.team1.name,
      shortName: matchHeader.team1.shortName,
    });
  }
  if (matchHeader?.team2) {
    teams.push({
      id: matchHeader.team2.id,
      name: matchHeader.team2.name,
      shortName: matchHeader.team2.shortName,
    });
  }

  const innings = (scoreDetails?.inningsScoreList || []).map(i => ({
    inningsId: i.inningsId,
    batTeamId: i.batTeamId,
    batTeamName: i.batTeamName,
    score: i.score,
    wickets: i.wickets,
    overs: i.overs,       // decimal form, e.g. 15.5 means 15 overs + 5 balls
    ballNbr: i.ballNbr,   // total legal balls bowled
    isDeclared: i.isDeclared,
    isFollowOn: i.isFollowOn,
  }));

  const current = miniscore ? {
    inningsId: miniscore.inningsId,
    batTeamId: miniscore.batTeam?.teamId,
    batTeamScore: miniscore.batTeam?.teamScore,
    batTeamWkts: miniscore.batTeam?.teamWkts,
    batsmanStriker: pickBatsman(miniscore.batsmanStriker),
    batsmanNonStriker: pickBatsman(miniscore.batsmanNonStriker),
    bowlerStriker: pickBowler(miniscore.bowlerStriker),
    currentRunRate: miniscore.currentRunRate,
    requiredRunRate: miniscore.requiredRunRate,
    lastWicket: miniscore.lastWicket,
    recentOvsStats: miniscore.recentOvsStats, // e.g. "...  | 0 4 0 4 0 1  | 0 W 0 0 Wd W"
    responseLastUpdated: miniscore.responseLastUpdated,
  } : null;

  return {
    matchId,
    slug,
    state: scoreDetails?.state || matchHeader?.state || null,
    status: scoreDetails?.customStatus || matchHeader?.status || null,
    format: scoreDetails?.matchFormat || matchHeader?.matchFormat || null,
    teams,
    innings,
    current,
    fetchedAt: Date.now(),
  };
}

function pickBatsman(b) {
  if (!b || !b.name) return null;
  return {
    id: b.id,
    name: b.name,
    runs: b.runs,
    balls: b.balls,
    fours: b.fours,
    sixes: b.sixes,
    strikeRate: parseFloat(b.strikeRate) || 0,
  };
}

function pickBowler(b) {
  if (!b || !b.name) return null;
  return {
    id: b.id,
    name: b.name,
    overs: b.overs,
    maidens: b.maidens,
    runs: b.runs,
    wickets: b.wickets,
    economy: b.economy,
  };
}

// ── Helpers for the resolver (over-snapshot math) ────────────────────────────

// Find the innings entry for a team by short name, full name, or teamId. Innings records
// only carry the short team name, so full-name lookups are resolved via the teams[] roster.
function findInningsForTeam(normalized, teamIdOrName) {
  if (teamIdOrName == null) return null;
  const key = String(teamIdOrName).toLowerCase();

  const team = normalized.teams?.find(t =>
    String(t.id) === key ||
    t.shortName?.toLowerCase() === key ||
    t.name?.toLowerCase() === key
  );
  const targetId = team?.id;
  const targetShort = team?.shortName?.toLowerCase();

  return normalized.innings.find(i => {
    if (targetId != null && i.batTeamId === targetId) return true;
    if (targetShort && i.batTeamName?.toLowerCase() === targetShort) return true;
    if (String(i.batTeamId) === key) return true;
    if (i.batTeamName?.toLowerCase() === key) return true;
    return false;
  }) || null;
}

// Cricbuzz overs use decimal form: 15.5 = 15 overs + 5 balls. Convert to fractional
// overs (ballNbr / 6) for comparison, since 15.5 sorts oddly against 15.6 / 16.0.
function oversAsFraction(oversDecimal) {
  if (oversDecimal == null) return 0;
  const whole = Math.floor(oversDecimal);
  const balls = Math.round((oversDecimal - whole) * 10);
  return whole + balls / 6;
}

// ── Index: list current live / upcoming matches ──────────────────────────────
// Scrapes the live-scores index page and returns a normalized list. Used by the
// admin "pick match" feature when creating a contract.

async function listLiveMatches({ seriesFilter } = {}) {
  const r = await fetch('https://www.cricbuzz.com/cricket-match/live-scores', {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!r.ok) throw new Error(`Cricbuzz index HTTP ${r.status}`);
  const html = await r.text();

  // Pull all unique (matchId, slug) pairs from the href anchors.
  const pairs = new Map();
  const linkRe = /\/live-cricket-scores\/(\d+)\/([a-z0-9-]+)/gi;
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const id = m[1];
    if (!pairs.has(id)) pairs.set(id, m[2]);
  }

  // Decode the RSC stream and harvest one matchInfo per matchId.
  const rsc = decodeRSC(html);
  const infoRe = /"matchInfo":\{/g;
  const infos = new Map();
  let im;
  while ((im = infoRe.exec(rsc)) !== null) {
    const obj = extractObject(rsc.slice(Math.max(0, im.index - 20)), 'matchInfo');
    if (obj && obj.matchId) {
      const idStr = String(obj.matchId);
      if (!infos.has(idStr)) infos.set(idStr, obj);
    }
  }

  const matches = [];
  for (const [id, slug] of pairs) {
    const info = infos.get(id);
    if (!info) continue;
    const teams = [];
    if (info.team1?.teamName) teams.push({ id: info.team1.id, name: info.team1.teamName, shortName: info.team1.teamSName });
    if (info.team2?.teamName) teams.push({ id: info.team2.id, name: info.team2.teamName, shortName: info.team2.teamSName });

    if (seriesFilter && info.seriesName && !info.seriesName.toLowerCase().includes(seriesFilter.toLowerCase())) continue;

    matches.push({
      matchId: id,
      slug,
      seriesId: info.seriesId,
      seriesName: info.seriesName,
      matchDesc: info.matchDesc,
      format: info.matchFormat,
      startDate: info.startDate ? Number(info.startDate) : null,
      state: info.state,
      status: info.status,
      teams,
      venue: info.venueInfo?.ground ? `${info.venueInfo.ground}, ${info.venueInfo.city || ''}`.replace(/,\s*$/, '') : null,
    });
  }

  // Sort: in-progress first, then upcoming (by startDate), completed last
  const stateRank = s => {
    if (/in progress|innings break|toss/i.test(s || '')) return 0;
    if (/preview|upcoming/i.test(s || '')) return 1;
    return 2;
  };
  matches.sort((a, b) => {
    const r = stateRank(a.state) - stateRank(b.state);
    if (r !== 0) return r;
    return (a.startDate || 0) - (b.startDate || 0);
  });

  return matches;
}

module.exports = {
  fetchMatch,
  resolveSlug,
  listLiveMatches,
  findInningsForTeam,
  oversAsFraction,
  // Exposed for tests
  _decodeRSC: decodeRSC,
  _extractObject: extractObject,
};

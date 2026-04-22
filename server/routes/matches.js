// Public match-info endpoints for regular users. Unlike the admin Cricbuzz
// helpers, these surface only the minimum the Markets page needs to decide
// which contracts belong to a currently-live match — no authentication gate
// beyond requireAuth, no data that isn't already visible on Cricbuzz.com.

const express = require('express');
const { requireAuth } = require('../middleware');
const { listLiveMatches } = require('../engine/cricbuzz');

const router = express.Router();

// Lightweight in-memory cache — this endpoint can be hit by every user every
// page load, so we avoid hammering Cricbuzz's live-scores index.
const cache = { matches: null, at: 0 };
const CACHE_MS = 60_000; // 60s is plenty — match state changes coarsely.

// Returns the currently in-progress (or innings-break / toss) matches, IPL
// series only. Used by the Markets tab to label the "Live" tab with team
// shortnames and to decide which contracts to bucket into it.
router.get('/live', requireAuth, async (req, res) => {
  const now = Date.now();
  if (cache.matches && (now - cache.at) < CACHE_MS) {
    return res.json({ matches: cache.matches, cached: true });
  }
  try {
    const all = await listLiveMatches({ seriesFilter: 'Indian Premier League' });
    const live = (all || []).filter(m => /in progress|innings break|toss/i.test(m.state || ''));
    const slim = live.map(m => ({
      matchId: m.matchId,
      teams: m.teams,
      state: m.state,
      status: m.status,
      matchDesc: m.matchDesc,
    }));
    cache.matches = slim;
    cache.at = now;
    res.json({ matches: slim, cached: false });
  } catch (e) {
    // Fail silently — the page still works without live-match info, the Live
    // tab just falls back to a generic label.
    res.json({ matches: [], error: e.message });
  }
});

module.exports = router;

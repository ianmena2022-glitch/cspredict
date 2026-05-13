// Odds multi-source: OddsPapi (pre-match) + TheOddsAPI (pre-match + live)
// Mantiene los mismos exports para compatibilidad con scheduler.js y api.js
const axios = require('axios');

const ODDS_KEY     = process.env.ODDS_API_KEY;      // OddsPapi
const THE_ODDS_KEY = process.env.THE_ODDS_API_KEY;  // TheOddsAPI (the-odds-api.com)

const ODDSPAPI_URL  = 'https://api.oddspapi.io/v4';
const THEODDS_URL   = 'https://api.the-odds-api.com/v4';

// Cache OddsPapi (fixtures upcoming)
const hltvCache = { fixtures: [], ts: 0 };
// Cache TheOddsAPI (todos los partidos con cuotas, live + upcoming)
const theoddsCache = { matches: [], ts: 0 };

const HLTV_TTL = 30 * 60 * 1000;

// ── OddsPapi helpers ──────────────────────────────────────────────────────────

function extractH2HOdds(bookmakerOdds) {
  if (!bookmakerOdds || typeof bookmakerOdds !== 'object') return null;
  for (const bm of Object.values(bookmakerOdds)) {
    const market = bm?.markets?.['171'];
    if (!market) continue;
    const o1 = parseFloat(market.outcomes?.['171']?.price);
    const o2 = parseFloat(market.outcomes?.['172']?.price);
    if (!isNaN(o1) && !isNaN(o2) && o1 > 1 && o2 > 1) {
      return { team1: +o1.toFixed(2), team2: +o2.toFixed(2) };
    }
  }
  return null;
}

// ── TheOddsAPI helpers ────────────────────────────────────────────────────────

function fuzzyMatch(a, b) {
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  return al.includes(bl) || bl.includes(al);
}

function extractTheOddsOdds(match, t1Name, t2Name) {
  // Preferir Pinnacle (más sharp), sino primero disponible
  const bookmakers = [...(match.bookmakers || [])].sort((a, b) =>
    a.key === 'pinnacle' ? -1 : b.key === 'pinnacle' ? 1 : 0
  );
  for (const bm of bookmakers) {
    const h2h = bm.markets?.find(m => m.key === 'h2h');
    if (!h2h?.outcomes || h2h.outcomes.length < 2) continue;

    // Intentar match por nombre de equipo
    const out1 = h2h.outcomes.find(o => fuzzyMatch(o.name, t1Name));
    const out2 = h2h.outcomes.find(o => fuzzyMatch(o.name, t2Name));

    if (out1 && out2 && out1.price > 1 && out2.price > 1) {
      return { team1: +out1.price.toFixed(2), team2: +out2.price.toFixed(2), source: bm.title };
    }
    // Fallback: primeros dos outcomes en orden
    const [a, b2] = h2h.outcomes;
    if (a?.price > 1 && b2?.price > 1) {
      return { team1: +a.price.toFixed(2), team2: +b2.price.toFixed(2), source: bm.title };
    }
  }
  return null;
}

function findTheOddsEntry(t1Name, t2Name) {
  return theoddsCache.matches.find(m => {
    const h = m.home_team || '';
    const a = m.away_team || '';
    return (fuzzyMatch(h, t1Name) && fuzzyMatch(a, t2Name)) ||
           (fuzzyMatch(h, t2Name) && fuzzyMatch(a, t1Name));
  });
}

// ── Refresh functions ─────────────────────────────────────────────────────────

async function refreshOddsPapi() {
  if (!ODDS_KEY) return;
  try {
    const now  = new Date();
    const from = now.toISOString().slice(0, 10);
    const to   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await axios.get(`${ODDSPAPI_URL}/fixtures`, {
      params: { apiKey: ODDS_KEY, sportId: 17, hasOdds: true, from, to },
      timeout: 10000,
    });
    const fixtures = r.data?.data || [];
    hltvCache.fixtures = fixtures
      .filter(f => f.statusId !== 1)
      .map(f => ({
        fixtureId: f.fixtureId,
        team1Name: f.participant1Name,
        team2Name: f.participant2Name,
        statusId:  f.statusId,
        startTime: f.startTime,
        odds1xbet: null,
      }));
    hltvCache.ts = Date.now();
    console.log(`[OddsPapi] ${hltvCache.fixtures.length} fixtures pre-match cacheados`);
  } catch (err) {
    console.error('[OddsPapi] refresh error:', err.message);
  }
}

async function refreshTheOddsApi() {
  if (!THE_ODDS_KEY) return;
  try {
    const r = await axios.get(`${THEODDS_URL}/sports/esports_cs2/odds`, {
      params: { apiKey: THE_ODDS_KEY, regions: 'eu,us', markets: 'h2h', oddsFormat: 'decimal' },
      timeout: 10000,
    });
    theoddsCache.matches = r.data || [];
    theoddsCache.ts = Date.now();
    const live = theoddsCache.matches.filter(m => m.commence_time && new Date(m.commence_time) <= new Date()).length;
    console.log(`[TheOddsAPI] ${theoddsCache.matches.length} partidos (${live} live), requests restantes: ${r.headers?.['x-requests-remaining'] ?? '?'}`);
  } catch (err) {
    console.error('[TheOddsAPI] refresh error:', err.response?.data?.message || err.message);
  }
}

// Refresca OddsPapi (pre-match, cada 30min)
// TheOddsAPI NO se refresca automáticamente — solo on-demand para ahorrar los 500 req/mes del free tier
async function refreshHltvOdds() {
  await refreshOddsPapi();
}

// ── Lookup ────────────────────────────────────────────────────────────────────

function findHltvEntry(t1Name, t2Name) {
  if (!hltvCache.fixtures.length) return null;
  const n1 = t1Name.toLowerCase().trim();
  const n2 = t2Name.toLowerCase().trim();
  return hltvCache.fixtures.find(e => {
    const e1 = e.team1Name?.toLowerCase() || '';
    const e2 = e.team2Name?.toLowerCase() || '';
    return (
      (e1.includes(n1) || n1.includes(e1)) && (e2.includes(n2) || n2.includes(e2)) ||
      (e1.includes(n2) || n2.includes(e1)) && (e2.includes(n1) || n1.includes(e2))
    );
  });
}

// ── On-demand odds fetch ──────────────────────────────────────────────────────

async function fetchHltvMatchOdds(t1Name, t2Name) {
  // 1. TheOddsAPI — fetch on-demand si hay key (cubre live + pre-match)
  if (THE_ODDS_KEY) {
    // Si el cache está vacío o tiene más de 5min, refrescar ahora
    if (!theoddsCache.ts || Date.now() - theoddsCache.ts > 5 * 60 * 1000) {
      await refreshTheOddsApi();
    }
    const entry = findTheOddsEntry(t1Name, t2Name);
    if (entry) {
      const odds = extractTheOddsOdds(entry, t1Name, t2Name);
      if (odds) return { team1: odds.team1, team2: odds.team2, source: odds.source + ' (TheOddsAPI)', matchUrl: null };
    }
  }

  // 2. OddsPapi — solo pre-match
  if (ODDS_KEY) {
    const entry = findHltvEntry(t1Name, t2Name);
    if (entry?.fixtureId) {
      if (entry.odds1xbet) return { ...entry.odds1xbet, source: 'OddsPapi', matchUrl: null };
      try {
        const r = await axios.get(`${ODDSPAPI_URL}/odds`, {
          params: { apiKey: ODDS_KEY, fixtureId: entry.fixtureId },
          timeout: 10000,
        });
        const bOdds = r.data?.data?.bookmakerOdds || r.data?.bookmakerOdds || {};
        const odds  = extractH2HOdds(bOdds);
        if (odds) {
          entry.odds1xbet = odds;
          return { ...odds, source: 'OddsPapi', matchUrl: null };
        }
      } catch (err) {
        console.error('[OddsPapi] fetchMatchOdds error:', err.response?.data?.error?.message || err.message);
      }
    }
  }

  return null;
}

module.exports = { refreshHltvOdds, findHltvEntry, fetchHltvMatchOdds, hltvCache, theoddsCache, HLTV_TTL };

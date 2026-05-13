// OddsPapi — reemplaza scraping HLTV (bloqueado por Cloudflare en datacenters)
// Mantiene los mismos exports para compatibilidad con scheduler.js y api.js
const axios = require('axios');

const ODDS_KEY = process.env.ODDS_API_KEY;
const BASE_URL = 'https://api.oddspapi.io/v4';

// Cache — misma estructura que antes
const hltvCache = { fixtures: [], ts: 0 };
const HLTV_TTL  = 30 * 60 * 1000;

// Extrae cuotas H2H del objeto bookmakerOdds de OddsPapi
// Mercado 171 = H2H, outcome 171 = team1, 172 = team2
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

// Refresca lista de fixtures CS2 upcoming (1 request cada 30min)
async function refreshHltvOdds() {
  if (!ODDS_KEY) {
    console.log('[OddsPapi] Sin ODDS_API_KEY, saltando');
    return;
  }
  try {
    const now  = new Date();
    const from = now.toISOString().slice(0, 10);
    const to   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await axios.get(`${BASE_URL}/fixtures`, {
      params: { apiKey: ODDS_KEY, sportId: 17, hasOdds: true, from, to },
      timeout: 10000,
    });
    const fixtures = r.data?.data || [];
    hltvCache.fixtures = fixtures
      .filter(f => f.statusId !== 1) // excluir partidos live (requieren plan premium)
      .map(f => ({
        fixtureId:  f.fixtureId,
        team1Name:  f.participant1Name,
        team2Name:  f.participant2Name,
        statusId:   f.statusId,
        startTime:  f.startTime,
        odds1xbet:  null, // se carga on-demand
      }));
    hltvCache.ts = Date.now();
    console.log(`[OddsPapi] ${hltvCache.fixtures.length} fixtures cacheados (próximos 7 días)`);
  } catch (err) {
    console.error('[OddsPapi] refreshHltvOdds error:', err.message);
  }
}

// Busca fixture por nombres de equipo (fuzzy match)
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

// Fetch on-demand: obtiene cuotas para un partido específico
async function fetchHltvMatchOdds(t1Name, t2Name) {
  if (!ODDS_KEY) return null;

  const entry = findHltvEntry(t1Name, t2Name);
  if (!entry?.fixtureId) return null;

  // Si ya tenemos cuotas cacheadas del fixture
  if (entry.odds1xbet) {
    return { ...entry.odds1xbet, source: 'OddsPapi', matchUrl: null };
  }

  try {
    const r = await axios.get(`${BASE_URL}/odds`, {
      params: { apiKey: ODDS_KEY, fixtureId: entry.fixtureId },
      timeout: 10000,
    });
    const bookmakerOdds = r.data?.data?.bookmakerOdds || r.data?.bookmakerOdds || {};
    const odds = extractH2HOdds(bookmakerOdds);
    if (odds) {
      entry.odds1xbet = odds; // guardar en cache para próximas consultas
      return { ...odds, source: 'OddsPapi', matchUrl: null };
    }
  } catch (err) {
    console.error('[OddsPapi] fetchMatchOdds error:', err.response?.data?.error?.message || err.message);
  }
  return null;
}

module.exports = { refreshHltvOdds, findHltvEntry, fetchHltvMatchOdds, hltvCache, HLTV_TTL };

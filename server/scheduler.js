const cron = require('node-cron');
const axios = require('axios');
const { teams, upcomingMatches } = require('./data/mockData');
const { predictAll } = require('./predictor');
const { db, savePrediction, resolveMatch, getBankroll, getSettings } = require('./db');

const PANDA_KEY = process.env.PANDASCORE_API_KEY;
const ODDS_KEY  = process.env.ODDS_API_KEY;

const pandaApi = axios.create({
  baseURL: 'https://api.pandascore.co',
  headers: { Authorization: `Bearer ${PANDA_KEY}` },
  timeout: 10000,
});

// Cache compartido con api.js
const cache = { matches: null, ts: 0, pinnacle: null };
const CACHE_TTL = 5 * 60 * 1000;

module.exports.cache = cache;

async function fetchOdds() {
  if (!ODDS_KEY || ODDS_KEY === 'your_key_here') return { bookmaker: [], pinnacle: [] };
  const res = await axios.get('https://api.the-odds-api.com/v4/sports/esports_cs2/odds', {
    params: { apiKey: ODDS_KEY, regions: 'eu,us', markets: 'h2h', oddsFormat: 'decimal' },
    timeout: 10000,
  });
  const all = res.data || [];
  const pinnacle  = all.filter(o => o.bookmakers?.some(b => b.key === 'pinnacle'));
  const bookmaker = all;
  return { bookmaker, pinnacle };
}

async function fetchLiveMatches() {
  if (!PANDA_KEY || PANDA_KEY === 'your_key_here') return null;
  const [upcoming, running] = await Promise.all([
    pandaApi.get('/csgo/matches/upcoming', { params: { per_page: 20, sort: 'begin_at' } }),
    pandaApi.get('/csgo/matches/running',  { params: { per_page: 10 } }),
  ]);
  return [...running.data, ...upcoming.data];
}

async function fetchFinishedMatches() {
  if (!PANDA_KEY || PANDA_KEY === 'your_key_here') return [];
  const res = await pandaApi.get('/csgo/matches/past', {
    params: { per_page: 20, sort: '-end_at' },
  });
  return res.data || [];
}

function findTeamKey(name) {
  if (!name) return null;
  const lower = name.toLowerCase();
  return Object.keys(teams).find(k => {
    const t = teams[k];
    return lower.includes(k) ||
           lower.includes(t.tag.toLowerCase()) ||
           lower.includes(t.name.toLowerCase());
  }) || null;
}

function extractOdds(oddsData, t1Name, t2Name, bookmakerKey) {
  const entry = oddsData.find(o =>
    (o.home_team?.toLowerCase().includes(t1Name.toLowerCase()) ||
     o.away_team?.toLowerCase().includes(t1Name.toLowerCase()))
  );
  if (!entry) return null;
  const bk = entry.bookmakers?.find(b => b.key === bookmakerKey) || entry.bookmakers?.[0];
  if (!bk) return null;
  const market = bk.markets?.[0];
  if (!market) return null;
  const o1 = market.outcomes?.find(o => o.name?.toLowerCase().includes(t1Name.toLowerCase()))?.price;
  const o2 = market.outcomes?.find(o => o.name?.toLowerCase().includes(t2Name.toLowerCase()))?.price;
  if (!o1 || !o2) return null;
  return { team1: +o1.toFixed(2), team2: +o2.toFixed(2) };
}

function mapMatch(m, oddsData, pinnacleData) {
  const t1 = m.opponents?.[0]?.opponent;
  const t2 = m.opponents?.[1]?.opponent;
  if (!t1 || !t2) return null;

  const t1Key = findTeamKey(t1.name) || `dyn_${t1.name}`;
  const t2Key = findTeamKey(t2.name) || `dyn_${t2.name}`;

  // Cuotas: primero 1xbet, luego cualquiera disponible
  const odds1xbet   = extractOdds(oddsData,    t1.name, t2.name, 'onexbet');
  const oddsPinnacle = extractOdds(pinnacleData, t1.name, t2.name, 'pinnacle');
  const oddsAny     = extractOdds(oddsData,    t1.name, t2.name, '');
  const finalOdds   = odds1xbet || oddsAny || { team1: 1.90, team2: 1.90 };

  return {
    id: `ps_${m.id}`,
    tournament: m.league?.name || 'Torneo CS2',
    tournamentTier: m.tier === 's' ? 'S' : m.tier === 'a' ? 'A' : 'B',
    team1: t1Key, team2: t2Key,
    team1Name: t1.name, team2Name: t2.name,
    date: m.begin_at || m.scheduled_at,
    format: m.number_of_games === 1 ? 'bo1' : m.number_of_games === 3 ? 'bo3' : 'bo5',
    maps: [],
    odds: finalOdds,
    pinnacleOdds: oddsPinnacle,
    stream: m.streams_list?.[0]?.raw_url || '#',
    live: m.status === 'running',
    pandaId: m.id,
  };
}

// ─── Actualizar partidos y predicciones cada 5 minutos ───────────────────────
async function refreshMatches() {
  try {
    const [pandaData, oddsData] = await Promise.allSettled([
      fetchLiveMatches(),
      fetchOdds(),
    ]);

    const rawMatches   = pandaData.status === 'fulfilled' && pandaData.value ? pandaData.value : null;
    const { bookmaker = [], pinnacle = [] } = oddsData.status === 'fulfilled' ? oddsData.value : {};

    let matchList;
    if (rawMatches) {
      matchList = rawMatches.map(m => mapMatch(m, bookmaker, pinnacle)).filter(Boolean);
    } else {
      matchList = upcomingMatches;
    }

    const settings  = getSettings();
    const bankroll  = getBankroll();
    const options   = {
      bankroll,
      kellyFraction: parseFloat(settings.kelly_fraction || 0.25),
      minEv:         parseFloat(settings.min_ev         || 0.05),
      minEdge:       parseFloat(settings.min_edge       || 0.03),
    };

    let predictions = predictAll(matchList, options);

    // Si PandaScore no devolvió nada útil, usar datos mock como base
    if (predictions.length === 0) {
      predictions = predictAll(upcomingMatches, options);
    }

    // Guardar en DB
    for (const p of predictions) {
      if (!p || !p.matchId) continue;
      savePrediction({
        match_id:      p.matchId,
        tournament:    p.match?.tournament || '',
        team1:         p.match?.team1Name || p.match?.team1 || '',
        team2:         p.match?.team2Name || p.match?.team2 || '',
        team1_prob:    p.team1?.probability,
        team2_prob:    p.team2?.probability,
        team1_odds:    p.match?.odds?.team1,
        team2_odds:    p.match?.odds?.team2,
        pinnacle_prob1: p.team1?.refProb,
        pinnacle_prob2: p.team2?.refProb,
        recommended:   p.recommendation ? (p.recommendation === p.match?.team1 ? p.match?.team1Name || p.match?.team1 : p.match?.team2Name || p.match?.team2) : null,
        confidence:    p.confidence,
        ev:            p.bestEv,
        kelly_fraction: p.kellyPct,
        kelly_amount:  p.kellyAmount,
        match_date:    p.match?.date,
        format:        p.match?.format,
        status:        'pending',
      });
    }

    cache.matches = predictions;
    cache.ts = Date.now();
    console.log(`[${new Date().toISOString()}] Partidos actualizados: ${predictions.length}`);
  } catch (err) {
    console.error('refreshMatches error:', err.message);
  }
}

// ─── Verificar resultados cada hora ──────────────────────────────────────────
async function checkResults() {
  try {
    const finished = await fetchFinishedMatches();
    const pending  = db.prepare("SELECT match_id FROM predictions WHERE status='pending'").all();
    const pendingIds = new Set(pending.map(p => p.match_id));

    for (const m of finished) {
      const matchId = `ps_${m.id}`;
      if (!pendingIds.has(matchId)) continue;

      const winner = m.winner?.name || m.results?.[0]?.team?.name;
      if (!winner) continue;

      const t1 = m.opponents?.[0]?.opponent;
      const t2 = m.opponents?.[1]?.opponent;
      const winnerKey = findTeamKey(winner) || `dyn_${winner}`;

      const result = resolveMatch(matchId, winnerKey);
      if (result) {
        console.log(`[Resultado] ${matchId}: ganó ${winner} | P&L: ${result.profit >= 0 ? '+' : ''}${result.profit?.toFixed(2)}`);
      }
    }
  } catch (err) {
    console.error('checkResults error:', err.message);
  }
}

function start() {
  // Ejecutar inmediatamente al arrancar
  refreshMatches();

  // Cada 5 minutos: actualizar partidos y cuotas
  cron.schedule('*/5 * * * *', refreshMatches);

  // Cada hora: verificar resultados y actualizar bankroll
  cron.schedule('0 * * * *', checkResults);

  console.log('Scheduler iniciado: partidos cada 5min, resultados cada 1h');
}

module.exports = { start, refreshMatches, checkResults, cache };

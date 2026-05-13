const cron = require('node-cron');
const axios = require('axios');
const { teams, upcomingMatches } = require('./data/mockData');
const { predictAll } = require('./predictor');
const { getTeamStats } = require('./teamStats');
const { db, savePrediction, resolveMatch, resolveUserBetsByMatch, getBankroll, getSettings } = require('./db');
const telegram = require('./telegram');
const { refreshHltvOdds, findHltvEntry, fetchHltvMatchOdds, hltvCache } = require('./hltvScraper');

const PANDA_KEY = process.env.PANDASCORE_API_KEY;

const pandaApi = axios.create({
  baseURL: 'https://api.pandascore.co',
  headers: { Authorization: `Bearer ${PANDA_KEY}` },
  timeout: 10000,
});

// Cache compartido con api.js
const cache = { matches: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

module.exports.cache = cache;

// Extrae el precio de un outcome: { players: { '0': { price } } }
function outcomePrice(outcome) {
async function fetchLiveMatches() {
  if (!PANDA_KEY || PANDA_KEY === 'your_key_here') return null;
  const [upcoming, running] = await Promise.all([
    pandaApi.get('/csgo/matches/upcoming', { params: { per_page: 50, sort: 'begin_at' } }),
    pandaApi.get('/csgo/matches/running',  { params: { per_page: 20 } }),
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

// Aliases para nombres que PandaScore usa distinto al mockData
const TEAM_ALIASES = {
  'natus vincere': 'navi',
  'team vitality': 'vitality',
  'faze clan': 'faze',
  'g2 esports': 'g2',
  'team liquid': 'liquid',
  'team spirit': 'spirit',
  'ninjas in pyjamas': 'nip',
  'virtus.pro': 'vitcheese',
  'virtus pro': 'vitcheese',
  'eternal fire': 'eternalfire',
  'gamerlegion': 'gamerlegion',
  'gamers legion': 'gamerlegion',
};

function findTeamKey(name) {
  if (!name) return null;
  const lower = name.toLowerCase().trim();

  // Alias exacto primero
  if (TEAM_ALIASES[lower]) return TEAM_ALIASES[lower];

  return Object.keys(teams).find(k => {
    const t = teams[k];
    return lower === k ||
           lower === t.tag.toLowerCase() ||
           lower === t.name.toLowerCase() ||
           lower.includes(t.name.toLowerCase()) ||
           t.name.toLowerCase().includes(lower);
  }) || null;
}

function mapMatch(m) {
  const t1 = m.opponents?.[0]?.opponent;
  const t2 = m.opponents?.[1]?.opponent;
  if (!t1 || !t2) return null;

  const t1Key = findTeamKey(t1.name) || `dyn_${t1.name}`;
  const t2Key = findTeamKey(t2.name) || `dyn_${t2.name}`;

  // Buscar en cache de HLTV (scrapeado cada 30min, sin costo adicional)
  const hltvEntry  = findHltvEntry(t1.name, t2.name);
  const finalOdds  = hltvEntry?.odds1xbet || null;
  const oddsFallback = !finalOdds;

  // Detectar LAN: si hay location en el torneo y no dice "online"
  const loc = (m.tournament?.location || '').toLowerCase();
  const isLan = loc !== '' && loc !== 'online';

  return {
    id: `ps_${m.id}`,
    tournament: m.league?.name || 'Torneo CS2',
    tournamentTier: m.tier === 's' ? 'S' : m.tier === 'a' ? 'A' : 'B',
    team1: t1Key, team2: t2Key,
    team1Name: t1.name, team2Name: t2.name,
    team1PandaId: t1.id,
    team2PandaId: t2.id,
    date: m.begin_at || m.scheduled_at,
    format: m.number_of_games === 1 ? 'bo1' : m.number_of_games === 3 ? 'bo3' : 'bo5',
    maps: [],
    odds: finalOdds || { team1: 1.90, team2: 1.90 },
    oddsFallback,
    hltvMatchUrl: hltvEntry?.matchUrl || null,
    pinnacleOdds: null,
    oddsSource: finalOdds ? '1xbet' : null,
    stream: m.streams_list?.[0]?.raw_url || '#',
    live: m.status === 'running',
    pandaId: m.id,
    isLan,
  };
}

// ─── Actualizar partidos y predicciones cada 5 minutos ───────────────────────
async function refreshMatches() {
  try {
    const pandaData = await fetchLiveMatches().catch(() => null);
    const rawMatches = pandaData || null;

    // Sin fallback a mock — si no hay partidos reales, mostramos nada
    if (!rawMatches || rawMatches.length === 0) {
      cache.matches = [];
      cache.ts = Date.now();
      console.log(`[${new Date().toISOString()}] Sin partidos de PandaScore`);
      return;
    }

    const rawList = rawMatches.map(m => mapMatch(m)).filter(Boolean);

    // Enriquecer con stats dinámicos de PandaScore (winRate real, forma, descanso, LAN)
    const matchList = await Promise.all(rawList.map(async (m) => {
      const [ds1, ds2] = await Promise.allSettled([
        getTeamStats(m.team1PandaId, m.team1Name),
        getTeamStats(m.team2PandaId, m.team2Name),
      ]);
      return {
        ...m,
        dynamicStats1: ds1.status === 'fulfilled' ? ds1.value : null,
        dynamicStats2: ds2.status === 'fulfilled' ? ds2.value : null,
      };
    }));

    const settings  = getSettings();
    const bankroll  = getBankroll();
    const options   = {
      bankroll,
      kellyFraction: parseFloat(settings.kelly_fraction || 0.25),
      minEv:         parseFloat(settings.min_ev         || 0.05),
      minEdge:       parseFloat(settings.min_edge       || 0.03),
    };

    const predictions = predictAll(matchList, options);

    // Guardar en DB
    for (const p of predictions) {
      if (!p || !p.matchId) continue;
      savePrediction({
        match_id:       p.matchId,
        tournament:     p.match?.tournament || '',
        team1:          p.match?.team1Name || p.match?.team1 || '',
        team2:          p.match?.team2Name || p.match?.team2 || '',
        team1_prob:     p.team1?.probability,
        team2_prob:     p.team2?.probability,
        team1_odds:     p.match?.odds?.team1,
        team2_odds:     p.match?.odds?.team2,
        pinnacle_prob1: p.team1?.refProb,
        pinnacle_prob2: p.team2?.refProb,
        recommended:    p.recommendation ? (p.recommendation === p.match?.team1 ? p.match?.team1Name || p.match?.team1 : p.match?.team2Name || p.match?.team2) : null,
        confidence:     p.confidence,
        ev:             p.bestEv,
        kelly_fraction: p.kellyPct,
        kelly_amount:   p.kellyAmount,
        match_date:     p.match?.date,
        format:         p.match?.format,
        is_lan:         p.match?.isLan ? 1 : 0,
        rest_days1:     p.team1?.restDays,
        rest_days2:     p.team2?.restDays,
        odds_moved:     p.oddsMovement || null,
        status:         'pending',
      });
    }

    cache.matches = predictions;
    cache.ts = Date.now();
    console.log(`[${new Date().toISOString()}] Partidos actualizados: ${predictions.length}`);

    // Notificar por Telegram las bets nuevas que cumplan el filtro de confianza
    const dbModule = require('./db');
    telegram.notifyBets(predictions, dbModule).catch(e => console.error('telegram notify:', e.message));
  } catch (err) {
    console.error('refreshMatches error:', err.message);
  }
}

// ─── Verificar resultados cada hora ──────────────────────────────────────────
async function checkResults() {
  try {
    const finished = await fetchFinishedMatches();
    const dbModule = require('../db');
    const pending  = dbModule.all("SELECT match_id FROM predictions WHERE status='pending'");
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
      resolveUserBetsByMatch(matchId, winner);
    }
  } catch (err) {
    console.error('checkResults error:', err.message);
  }
}

function start() {
  // Al arrancar: scrapear HLTV primero, luego cargar partidos
  refreshHltvOdds().then(() => refreshMatches());

  // Cada 5 minutos: actualizar partidos de PandaScore
  cron.schedule('*/5 * * * *', refreshMatches);

  // Cada 30 minutos: scrapear cuotas de HLTV (1 request, sin límite)
  cron.schedule('*/30 * * * *', refreshHltvOdds);

  // Cada hora: verificar resultados y actualizar bankroll
  cron.schedule('0 * * * *', checkResults);

  console.log('Scheduler iniciado: partidos 5min | cuotas HLTV 30min | resultados 1h');
}

module.exports = { start, refreshMatches, checkResults, cache, fetchHltvMatchOdds };

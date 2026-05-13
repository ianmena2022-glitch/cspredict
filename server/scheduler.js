const cron = require('node-cron');
const axios = require('axios');
const { teams, upcomingMatches } = require('./data/mockData');
const { predictAll } = require('./predictor');
const { getTeamStats } = require('./teamStats');
const { db, savePrediction, resolveMatch, resolveUserBetsByMatch, getBankroll, getSettings } = require('./db');
const telegram = require('./telegram');

const PANDA_KEY  = process.env.PANDASCORE_API_KEY;
const ODDS_KEY   = process.env.ODDS_API_KEY;       // OddsPapi key (ODDS_API_KEY en Railway)

const pandaApi = axios.create({
  baseURL: 'https://api.pandascore.co',
  headers: { Authorization: `Bearer ${PANDA_KEY}` },
  timeout: 10000,
});

// Cache compartido con api.js
const cache = { matches: null, ts: 0, pinnacle: null };
const CACHE_TTL = 5 * 60 * 1000;

// Cache de cuotas separado — se actualiza cada 30 min para ahorrar calls a OddsPapi
const oddsCache = { fixtures: [], ts: 0 };
const ODDS_TTL  = 30 * 60 * 1000;

module.exports.cache = cache;

// Extrae el precio de un outcome: { players: { '0': { price } } }
function outcomePrice(outcome) {
  if (!outcome) return null;
  const p = Object.values(outcome.players || {})[0];
  return p?.active !== false ? (p?.price ?? null) : null;
}

// Extrae cuotas h2h de un bookmaker dado dentro de bookmakerOdds
// Estrategia: busca market con exactamente 2 outcomes activos (match winner)
function extractBookmakerH2H(bkData) {
  if (!bkData?.bookmakerIsActive) return null;
  const markets = bkData.markets || {};

  // Preferir market 171 (h2h estándar en OddsPapi)
  const mkt171 = markets['171'];
  if (mkt171) {
    const o171 = outcomePrice(mkt171.outcomes?.['171']);
    const o172 = outcomePrice(mkt171.outcomes?.['172']);
    if (o171 && o172) return { team1: +o171.toFixed(2), team2: +o172.toFixed(2) };
  }

  // Fallback: buscar cualquier mercado con exactamente 2 outcomes activos
  for (const mkt of Object.values(markets)) {
    const outcomes = Object.values(mkt.outcomes || {});
    if (outcomes.length !== 2) continue;
    const prices = outcomes.map(o => outcomePrice(o)).filter(Boolean);
    if (prices.length === 2) {
      return { team1: +prices[0].toFixed(2), team2: +prices[1].toFixed(2) };
    }
  }
  return null;
}

// Extrae cuotas h2h de la respuesta de /odds priorizando: 1xbet → pinnacle → primer bookmaker disponible
function extractOddsPapi(oddsResp) {
  if (!oddsResp) return { odds1xbet: null, oddsPinnacle: null, oddsAny: null };
  const bkOdds = oddsResp.bookmakerOdds || oddsResp;

  const odds1xbet   = extractBookmakerH2H(bkOdds['1xbet']);
  const oddsPinnacle = extractBookmakerH2H(bkOdds['pinnacle']);

  // Fallback: primer bookmaker que tenga cuotas h2h válidas
  let oddsAny = null;
  for (const bkData of Object.values(bkOdds)) {
    const h2h = extractBookmakerH2H(bkData);
    if (h2h) { oddsAny = h2h; break; }
  }

  // Extraer fixturePath de 1xbet para deep link
  const fixturePath1xbet = bkOdds['1xbet']?.fixturePath || null;

  return { odds1xbet, oddsPinnacle, oddsAny, fixturePath1xbet };
}

// Solo trae la lista de fixtures (1 call cada 30min) — sin cuotas individuales
async function fetchOdds() {
  if (!ODDS_KEY || ODDS_KEY === 'your_key_here') return [];
  const now  = new Date();
  const from = now.toISOString().slice(0, 10);
  const to   = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const res  = await axios.get('https://api.oddspapi.io/v4/fixtures', {
    params: { apiKey: ODDS_KEY, sportId: 17, hasOdds: true, from, to },
    timeout: 15000,
  });
  const fixtures = res.data?.data || res.data || [];
  return Array.isArray(fixtures) ? fixtures.map(f => ({
    fixtureId: f.fixtureId,
    team1Name: f.participant1Name,
    team2Name: f.participant2Name,
  })) : [];
}

// Trae cuotas de un fixture específico — on-demand cuando el usuario clickea "Ver cuotas"
async function fetchOddsForFixture(fixtureId) {
  if (!ODDS_KEY || ODDS_KEY === 'your_key_here') return null;
  const res = await axios.get('https://api.oddspapi.io/v4/odds', {
    params: { apiKey: ODDS_KEY, fixtureId },
    timeout: 10000,
  });
  const oddsData = res.data?.data || res.data || {};
  return extractOddsPapi(oddsData);
}

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

// Busca en el array normalizado de OddsPapi el partido que coincide con t1Name/t2Name
function findOddsEntry(oddsNorm, t1Name, t2Name) {
  const n1 = t1Name.toLowerCase();
  const n2 = t2Name.toLowerCase();
  return oddsNorm.find(e => {
    const e1 = e.team1Name?.toLowerCase() || '';
    const e2 = e.team2Name?.toLowerCase() || '';
    return (e1.includes(n1) || n1.includes(e1)) && (e2.includes(n2) || n2.includes(e2)) ||
           (e1.includes(n2) || n2.includes(e1)) && (e2.includes(n1) || n1.includes(e2));
  });
}

function mapMatch(m, oddsNorm) {
  const t1 = m.opponents?.[0]?.opponent;
  const t2 = m.opponents?.[1]?.opponent;
  if (!t1 || !t2) return null;

  const t1Key = findTeamKey(t1.name) || `dyn_${t1.name}`;
  const t2Key = findTeamKey(t2.name) || `dyn_${t2.name}`;

  // oddsNorm ahora solo tiene fixtureId + team names — sin cuotas reales
  const entry = findOddsEntry(oddsNorm, t1.name, t2.name);

  // Si hay un fixture en OddsPapi, las cuotas se piden on-demand; marcamos oddsFallback=false
  // para mostrar "Ver cuotas". Si no hay fixture, oddsFallback=true.
  const oddsFallback = !entry;
  const fixtureId    = entry?.fixtureId || null;

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
    odds: { team1: 1.90, team2: 1.90 }, // placeholder — cuotas reales se piden on-demand
    oddsFallback,
    fixtureId,
    pinnacleOdds: null,
    oddsSource: null,
    fixturePath1xbet: null,
    stream: m.streams_list?.[0]?.raw_url || '#',
    live: m.status === 'running',
    pandaId: m.id,
    isLan,
  };
}

// ─── Actualizar cuotas cada 30 min (OddsPapi) ────────────────────────────────
async function refreshOdds() {
  try {
    const fixtures = await fetchOdds();
    oddsCache.fixtures = fixtures;
    oddsCache.ts = Date.now();
    console.log(`[${new Date().toISOString()}] Cuotas actualizadas: ${fixtures.length} partidos con odds`);
  } catch (err) {
    console.error('refreshOdds error:', err.message);
  }
}

// ─── Actualizar partidos y predicciones cada 5 minutos ───────────────────────
async function refreshMatches() {
  try {
    // Cuotas: usar cache si tiene menos de 30 min, si no refrescar
    if (!oddsCache.ts || Date.now() - oddsCache.ts > ODDS_TTL) {
      await refreshOdds();
    }

    const pandaData = await fetchLiveMatches().catch(() => null);
    const rawMatches = pandaData || null;
    const oddsNorm = oddsCache.fixtures || [];

    // Sin fallback a mock — si no hay partidos reales, mostramos nada
    if (!rawMatches || rawMatches.length === 0) {
      cache.matches = [];
      cache.ts = Date.now();
      console.log(`[${new Date().toISOString()}] Sin partidos de PandaScore`);
      return;
    }

    const rawList = rawMatches.map(m => mapMatch(m, oddsNorm)).filter(Boolean);

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
  // Ejecutar inmediatamente al arrancar
  refreshOdds().then(() => refreshMatches());

  // Cada 5 minutos: actualizar partidos (usa odds cacheadas)
  cron.schedule('*/5 * * * *', refreshMatches);

  // Cada 30 minutos: refrescar cuotas de TheOddsAPI (~1,440 calls/mes vs 8,640)
  cron.schedule('*/30 * * * *', refreshOdds);

  // Cada hora: verificar resultados y actualizar bankroll
  cron.schedule('0 * * * *', checkResults);

  console.log('Scheduler iniciado: partidos 5min | cuotas 30min | resultados 1h');
}

module.exports = { start, refreshMatches, refreshOdds, checkResults, cache, fetchOddsForFixture };

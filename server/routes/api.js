const express = require('express');
const router = express.Router();
const axios = require('axios');
const { teams, upcomingMatches, hltvRankings } = require('../data/mockData');
const { predict, predictAll } = require('../predictor');

const PANDA_KEY = process.env.PANDASCORE_API_KEY;
const ODDS_KEY  = process.env.ODDS_API_KEY;

const pandaApi = axios.create({
  baseURL: 'https://api.pandascore.co',
  headers: { Authorization: `Bearer ${PANDA_KEY}` },
  timeout: 8000,
});

// --- PandaScore: obtener partidos CS2 próximos ---
async function fetchLiveMatches() {
  const [upcoming, running] = await Promise.all([
    pandaApi.get('/csgo/matches/upcoming', { params: { per_page: 20, sort: 'begin_at' } }),
    pandaApi.get('/csgo/matches/running',  { params: { per_page: 10 } }),
  ]);
  return [...running.data, ...upcoming.data];
}

// --- TheOddsAPI: obtener cuotas CS2 ---
async function fetchOdds() {
  const res = await axios.get('https://api.the-odds-api.com/v4/sports/esports_cs2/odds', {
    params: {
      apiKey:  ODDS_KEY,
      regions: 'eu',
      markets: 'h2h',
      oddsFormat: 'decimal',
    },
    timeout: 8000,
  });
  return res.data;
}

// Mapea un partido de PandaScore al formato interno
function mapPandaMatch(m, oddsMap) {
  const t1 = m.opponents?.[0]?.opponent;
  const t2 = m.opponents?.[1]?.opponent;
  if (!t1 || !t2) return null;

  const matchKey = `${t1.name} vs ${t2.name}`;
  const oddsEntry = oddsMap[matchKey] || oddsMap[`${t2.name} vs ${t1.name}`];

  // Intentar matchear con equipos del mock para usar sus stats
  const t1Key = findTeamKey(t1.name);
  const t2Key = findTeamKey(t2.name);

  const defaultOdds = { team1: 1.90, team2: 1.90 };
  let odds = defaultOdds;

  if (oddsEntry) {
    const o1 = oddsEntry.outcomes?.find(o => o.name === t1.name)?.price;
    const o2 = oddsEntry.outcomes?.find(o => o.name === t2.name)?.price;
    if (o1 && o2) odds = { team1: +o1.toFixed(2), team2: +o2.toFixed(2) };
  }

  return {
    id: `ps_${m.id}`,
    tournament: m.league?.name || m.serie?.full_name || 'Torneo CS2',
    tournamentTier: mapTier(m.tier),
    team1: t1Key || 'unknown1',
    team2: t2Key || 'unknown2',
    team1Name: t1.name,
    team2Name: t2.name,
    team1Logo: t1.image_url,
    team2Logo: t2.image_url,
    date: m.begin_at || m.scheduled_at,
    format: m.number_of_games === 1 ? 'bo1' : m.number_of_games === 3 ? 'bo3' : 'bo5',
    maps: m.videogame_version ? [] : [],
    odds,
    stream: m.streams_list?.[0]?.raw_url || '#',
    live: m.status === 'running',
  };
}

function mapTier(tier) {
  if (!tier) return 'B';
  if (tier === 's') return 'S';
  if (tier === 'a') return 'A';
  return 'B';
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

// Construye un equipo dinámico para equipos no conocidos
function buildDynamicTeam(name, logo) {
  return {
    id: Math.random(), name, tag: name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 5),
    logo: '🎮', region: 'EU', hltvRank: 15, hltvRating: 0.65,
    recentForm: ['W','L','W','L','W'],
    winRate: 0.50, mapsPlayed: 100,
    mapStats: {
      mirage:   { winRate: 0.50, rating: 1.00 },
      inferno:  { winRate: 0.50, rating: 1.00 },
      ancient:  { winRate: 0.50, rating: 1.00 },
      anubis:   { winRate: 0.50, rating: 1.00 },
      nuke:     { winRate: 0.50, rating: 1.00 },
      overpass: { winRate: 0.50, rating: 1.00 },
      vertigo:  { winRate: 0.50, rating: 1.00 },
    },
    avgRating: 1.00, streak: 0,
  };
}

// Cache en memoria (5 minutos)
let cache = { matches: null, ts: 0 };
const CACHE_TTL = 5 * 60 * 1000;

async function getMatches() {
  if (cache.matches && Date.now() - cache.ts < CACHE_TTL) return cache.matches;

  if (!PANDA_KEY || PANDA_KEY === 'your_key_here') {
    return predictAll(upcomingMatches);
  }

  try {
    const [pandaMatches, oddsData] = await Promise.allSettled([
      fetchLiveMatches(),
      ODDS_KEY && ODDS_KEY !== 'your_key_here' ? fetchOdds() : Promise.resolve([]),
    ]);

    const rawMatches = pandaMatches.status === 'fulfilled' ? pandaMatches.value : [];
    const rawOdds    = oddsData.status === 'fulfilled'    ? oddsData.value    : [];

    // Indexar cuotas por nombre de partido
    const oddsMap = {};
    rawOdds.forEach(o => {
      const home = o.home_team, away = o.away_team;
      const market = o.bookmakers?.find(b => b.key === 'onexbet') ||
                     o.bookmakers?.find(b => b.key === 'betway')  ||
                     o.bookmakers?.[0];
      if (market) {
        oddsMap[`${home} vs ${away}`] = market.markets?.[0];
      }
    });

    // Registrar equipos dinámicos
    const dynamicTeams = {};
    const mapped = rawMatches
      .map(m => mapPandaMatch(m, oddsMap))
      .filter(Boolean)
      .map(m => {
        // Si el equipo no está en el mock, crear uno dinámico
        if (m.team1 === 'unknown1') {
          m.team1 = `dyn_${m.team1Name}`;
          dynamicTeams[m.team1] = buildDynamicTeam(m.team1Name, m.team1Logo);
        }
        if (m.team2 === 'unknown2') {
          m.team2 = `dyn_${m.team2Name}`;
          dynamicTeams[m.team2] = buildDynamicTeam(m.team2Name, m.team2Logo);
        }
        return m;
      });

    // Añadir equipos dinámicos al contexto del predictor
    Object.assign(teams, dynamicTeams);

    const predictions = mapped.length > 0
      ? predictAll(mapped)
      : predictAll(upcomingMatches);

    cache = { matches: predictions, ts: Date.now() };
    return predictions;

  } catch (err) {
    console.error('API fetch error:', err.message);
    return predictAll(upcomingMatches);
  }
}

// --- Rutas ---

router.get('/matches', async (req, res) => {
  try {
    const data = await getMatches();
    const source = PANDA_KEY && PANDA_KEY !== 'your_key_here' ? 'live' : 'mock';
    res.json({ data, source, updatedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/matches/:id/predict', async (req, res) => {
  try {
    const all = await getMatches();
    const pred = all.find(p => p.matchId === req.params.id);
    if (!pred) return res.status(404).json({ error: 'Match not found' });
    res.json(pred);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rankings', (req, res) => {
  const ranked = hltvRankings.map(r => ({ ...r, teamData: teams[r.team] }));
  res.json({ data: ranked, updatedAt: new Date().toISOString() });
});

router.get('/teams', (req, res) => {
  res.json({ data: Object.values(teams) });
});

router.get('/teams/:tag', (req, res) => {
  const team = Object.values(teams).find(
    t => t.tag.toLowerCase() === req.params.tag.toLowerCase()
  );
  if (!team) return res.status(404).json({ error: 'Team not found' });
  res.json({ data: team });
});

router.get('/status', (req, res) => {
  res.json({
    pandascore: PANDA_KEY && PANDA_KEY !== 'your_key_here' ? 'connected' : 'mock',
    oddsApi:    ODDS_KEY  && ODDS_KEY  !== 'your_key_here' ? 'connected' : 'mock',
    mode:       PANDA_KEY && PANDA_KEY !== 'your_key_here' ? 'live' : 'mock_data',
    cacheAge:   cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'empty',
  });
});

module.exports = router;

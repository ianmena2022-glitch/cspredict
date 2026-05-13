const express = require('express');
const router  = express.Router();
const { upcomingMatches } = require('../data/mockData');
const { predictAll }      = require('../predictor');
const { db, getBankroll, getSettings, updateSetting, getPredictions, getStats, getBankrollHistory,
        addUserBet, getUserBets, deleteUserBet, resolveUserBet, updateUserBetAmount, getUserBetStats } = require('../db');
const scheduler = require('../scheduler');

function getLiveData() {
  const { cache } = scheduler;
  // Usar cache si tiene datos recientes (con o sin partidos)
  if (cache.ts && Date.now() - cache.ts < 5 * 60 * 1000) {
    return { data: cache.matches || [], source: 'live' };
  }
  // Cache vacío: el scheduler aún no corrió, devolver vacío
  return { data: [], source: 'loading' };
}

// ── Partidos + predicciones ───────────────────────────────────────────────────
router.get('/matches', (req, res) => {
  const { data, source } = getLiveData();
  res.json({ data, source, updatedAt: new Date().toISOString() });
});

// ── Rankings HLTV (mock por ahora) ────────────────────────────────────────────
const { teams, hltvRankings } = require('../data/mockData');
router.get('/rankings', (req, res) => {
  const ranked = hltvRankings.map(r => ({ ...r, teamData: teams[r.team] }));
  res.json({ data: ranked, updatedAt: new Date().toISOString() });
});

// ── Bankroll actual ───────────────────────────────────────────────────────────
router.get('/bankroll', (req, res) => {
  const amount  = getBankroll();
  const history = getBankrollHistory();
  const stats   = getStats();
  res.json({ amount, history, stats });
});

// Actualizar bankroll manualmente
router.post('/bankroll', (req, res) => {
  const { amount, note } = req.body;
  if (amount === undefined || amount === '' || isNaN(+amount) || +amount <= 0) {
    return res.status(400).json({ error: 'amount debe ser un número mayor a 0' });
  }
  const dbModule = require('../db');
  dbModule.run("INSERT INTO bankroll (amount, note) VALUES (?, ?)", [+amount, note || 'Ajuste manual']);
  res.json({ amount: +amount });
});

// ── Historial de predicciones ─────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ data: getPredictions(limit) });
});

// ── Estadísticas globales (basadas en bets manuales del usuario) ──────────────
router.get('/stats', (req, res) => {
  const stats    = getUserBetStats();
  const bankroll = getBankroll();
  const history  = getBankrollHistory();
  const initial  = history[0]?.amount || 100;
  // ROI basado en profit real de user_bets
  const profit   = stats?.total_profit || 0;
  res.json({
    ...stats,
    bets_made: stats?.total || 0,
    bankroll,
    roi: initial > 0 ? +((profit / initial) * 100).toFixed(2) : 0,
    initialBankroll: initial,
    total_profit: profit,
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  res.json(getSettings());
});

router.post('/settings', (req, res) => {
  const allowed = ['kelly_fraction', 'min_ev', 'min_edge', 'max_bet_pct', 'auto_track', 'onebet_url',
                  'telegram_token', 'telegram_chat_id', 'telegram_confidences'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) updateSetting(k, v);
  }
  res.json(getSettings());
});

// ── Bets manuales del usuario ─────────────────────────────────────────────────
router.get('/bets', (req, res) => {
  res.json({ data: getUserBets() });
});

router.post('/bets', (req, res) => {
  const { match_id, tournament, team1, team2, bet_on, odds, amount, ev, kelly_pct, match_date, format } = req.body;
  if (!team1 || !team2 || !bet_on || !odds || !amount) {
    return res.status(400).json({ error: 'Faltan campos requeridos' });
  }
  const bet = addUserBet({ match_id, tournament, team1, team2, bet_on, odds, amount, ev, kelly_pct, match_date, format });
  res.json(bet);
});

router.delete('/bets/:id', (req, res) => {
  const ok = deleteUserBet(+req.params.id);
  if (!ok) return res.status(404).json({ error: 'Bet no encontrada' });
  res.json({ ok: true });
});

router.post('/bets/:id/resolve', (req, res) => {
  const { result } = req.body;
  if (!result) return res.status(400).json({ error: 'result requerido' });
  const r = resolveUserBet(+req.params.id, result);
  if (!r) return res.status(404).json({ error: 'Bet no encontrada o ya resuelta' });
  res.json(r);
});

router.patch('/bets/:id', (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount requerido' });
  updateUserBetAmount(+req.params.id, +amount);
  res.json({ ok: true });
});

// ── Resolver partido manualmente (por si el cron no lo detecta) ───────────────
router.post('/resolve/:matchId', (req, res) => {
  const { winner } = req.body;
  if (!winner) return res.status(400).json({ error: 'winner requerido' });
  const { resolveMatch } = require('../db');
  const result = resolveMatch(req.params.matchId, winner);
  if (!result) return res.status(404).json({ error: 'Partido no encontrado o ya resuelto' });
  res.json(result);
});

// ── Telegram ──────────────────────────────────────────────────────────────────
router.post('/telegram/test', async (req, res) => {
  const { sendTest } = require('../telegram');
  const ok = await sendTest();
  if (ok) res.json({ ok: true });
  else res.status(400).json({ error: 'No se pudo enviar. Verificá el token y chat_id.' });
});

// ── Cuotas on-demand — 1 call a OddsPapi por partido, solo cuando el usuario lo pide ──
router.get('/odds/:matchId', async (req, res) => {
  const { cache, fetchOddsForFixture } = scheduler;
  const prediction = (cache.matches || []).find(p => p.matchId === req.params.matchId || p.match?.id === req.params.matchId);
  if (!prediction) return res.status(404).json({ error: 'Partido no encontrado en cache' });

  const fixtureId = prediction.match?.fixtureId;
  if (!fixtureId) return res.status(404).json({ error: 'Sin fixture de OddsPapi para este partido' });

  try {
    const result = await fetchOddsForFixture(fixtureId);
    if (!result) return res.status(404).json({ error: 'Sin cuotas disponibles' });

    const { odds1xbet, oddsPinnacle, oddsAny, fixturePath1xbet } = result;
    const finalOdds = odds1xbet || oddsPinnacle || oddsAny;
    if (!finalOdds) return res.status(404).json({ error: 'Sin cuotas h2h disponibles' });

    res.json({
      odds:             finalOdds,
      pinnacleOdds:     oddsPinnacle,
      oddsSource:       odds1xbet ? '1xbet' : oddsPinnacle ? 'pinnacle' : 'otro',
      fixturePath1xbet: fixturePath1xbet || null,
      updatedAt:        new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Debug: ver qué devuelven las APIs de cuotas ───────────────────────────────
router.get('/debug/odds', async (req, res) => {
  const axios = require('axios');
  const ODDS_KEY = process.env.ODDS_API_KEY;
  const result = { key: ODDS_KEY ? ODDS_KEY.slice(0, 8) + '...' : 'NO KEY', theoddsapi: null, oddspapi: null };

  // Probar TheOddsAPI
  try {
    const r = await axios.get('https://api.the-odds-api.com/v4/sports/esports_cs2/odds', {
      params: { apiKey: ODDS_KEY, regions: 'eu,us', markets: 'h2h', oddsFormat: 'decimal' },
      timeout: 10000,
    });
    result.theoddsapi = { status: 'ok', count: r.data?.length, sample: r.data?.[0] || null, remaining: r.headers['x-requests-remaining'] };
  } catch (e) {
    result.theoddsapi = { status: 'error', code: e.response?.status, message: e.response?.data?.message || e.message };
  }

  // Probar OddsPapi
  try {
    const now = new Date();
    const from = now.toISOString().slice(0, 10);
    const to = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const r = await axios.get('https://api.oddspapi.io/v4/fixtures', {
      params: { apiKey: ODDS_KEY, sportId: 17, hasOdds: true, from, to },
      timeout: 10000,
    });
    const data = r.data?.data || r.data || [];
    const firstFixture = Array.isArray(data) ? data[0] : null;
    result.oddspapi = { status: 'ok', count: Array.isArray(data) ? data.length : typeof data, fixtureSample: firstFixture };

    // Si hay un fixture, buscar sus cuotas
    if (firstFixture?.fixtureId) {
      try {
        const ro = await axios.get('https://api.oddspapi.io/v4/odds', {
          params: { apiKey: ODDS_KEY, fixtureId: firstFixture.fixtureId },
          timeout: 10000,
        });
        result.oddspapi.oddsSample = ro.data?.data || ro.data;
      } catch (e2) {
        result.oddspapi.oddsError = e2.response?.data || e2.message;
      }
    }
  } catch (e) {
    result.oddspapi = { status: 'error', code: e.response?.status, message: e.response?.data?.message || e.message };
  }

  res.json(result);
});

// ── Status ────────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const PANDA_KEY = process.env.PANDASCORE_API_KEY;
  const ODDS_KEY  = process.env.ODDS_API_KEY;
  const { cache }  = scheduler;
  res.json({
    pandascore:   PANDA_KEY && PANDA_KEY !== 'your_key_here' ? 'connected' : 'mock',
    oddsApi:      ODDS_KEY  && ODDS_KEY  !== 'your_key_here' ? 'connected' : 'mock',
    mode:         PANDA_KEY && PANDA_KEY !== 'your_key_here' ? 'live' : 'mock_data',
    cacheAge:     cache.ts ? Math.round((Date.now() - cache.ts) / 1000) + 's' : 'empty',
    bankroll:     getBankroll(),
  });
});

module.exports = router;

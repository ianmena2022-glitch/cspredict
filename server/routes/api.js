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

// ── Cuotas bajo demanda (lee del cache, sin calls extra a TheOddsAPI) ─────────
router.get('/odds/:matchId', (req, res) => {
  const { cache } = scheduler;
  const match = (cache.matches || []).find(p => p.matchId === req.params.matchId || p.match?.id === req.params.matchId);
  if (!match) return res.status(404).json({ error: 'Partido no encontrado en cache' });
  res.json({
    odds:          match.match?.odds         || null,
    pinnacleOdds:  match.match?.pinnacleOdds || null,
    updatedAt:     cache.ts ? new Date(cache.ts).toISOString() : null,
  });
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

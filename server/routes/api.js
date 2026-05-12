const express = require('express');
const router  = express.Router();
const { upcomingMatches } = require('../data/mockData');
const { predictAll }      = require('../predictor');
const { db, getBankroll, getSettings, updateSetting, getPredictions, getStats, getBankrollHistory } = require('../db');
const scheduler = require('../scheduler');

function getLiveData() {
  const { cache } = scheduler;
  if (cache.matches && Date.now() - cache.ts < 5 * 60 * 1000) {
    return { data: cache.matches, source: 'live' };
  }
  const settings = getSettings();
  const bankroll  = getBankroll();
  const fallback  = predictAll(upcomingMatches, {
    bankroll,
    kellyFraction: parseFloat(settings.kelly_fraction || 0.25),
    minEv:         parseFloat(settings.min_ev         || 0.05),
    minEdge:       parseFloat(settings.min_edge       || 0.03),
  });
  return { data: fallback, source: 'mock' };
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
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'amount requerido' });
  db.prepare("INSERT INTO bankroll (amount, note) VALUES (?, ?)").run(+amount, note || 'Ajuste manual');
  res.json({ amount: +amount });
});

// ── Historial de predicciones ─────────────────────────────────────────────────
router.get('/history', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json({ data: getPredictions(limit) });
});

// ── Estadísticas globales ─────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const stats    = getStats();
  const bankroll = getBankroll();
  const history  = getBankrollHistory();
  const initial  = history[0]?.amount || 100;
  res.json({
    ...stats,
    bankroll,
    roi: history.length > 1 ? +((bankroll - initial) / initial * 100).toFixed(2) : 0,
    initialBankroll: initial,
  });
});

// ── Settings ──────────────────────────────────────────────────────────────────
router.get('/settings', (req, res) => {
  res.json(getSettings());
});

router.post('/settings', (req, res) => {
  const allowed = ['kelly_fraction', 'min_ev', 'min_edge', 'max_bet_pct', 'auto_track'];
  for (const [k, v] of Object.entries(req.body)) {
    if (allowed.includes(k)) updateSetting(k, v);
  }
  res.json(getSettings());
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

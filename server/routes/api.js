const express = require('express');
const router = express.Router();
const { teams, upcomingMatches, hltvRankings } = require('../data/mockData');
const { predict, predictAll } = require('../predictor');

router.get('/matches', (req, res) => {
  const predictions = predictAll(upcomingMatches);
  res.json({ data: predictions, source: 'mock', updatedAt: new Date().toISOString() });
});

router.get('/matches/:id/predict', (req, res) => {
  const match = upcomingMatches.find(m => m.id === req.params.id);
  if (!match) return res.status(404).json({ error: 'Match not found' });
  res.json({ data: predict(match.id, match), match });
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
  const pandaKey = process.env.PANDASCORE_API_KEY;
  const oddsKey  = process.env.ODDS_API_KEY;
  res.json({
    pandascore: pandaKey && pandaKey !== 'your_key_here' ? 'connected' : 'mock',
    oddsApi:    oddsKey  && oddsKey  !== 'your_key_here' ? 'connected' : 'mock',
    mode: pandaKey || oddsKey ? 'live' : 'mock_data',
  });
});

module.exports = router;

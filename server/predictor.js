const { teams, headToHead } = require('./data/mockData');

const WEIGHTS = {
  hltvRating:  0.25,
  recentForm:  0.20,
  avgRating:   0.20,
  winRate:     0.15,
  h2h:         0.12,
  mapPool:     0.08,
};

function formScore(form) {
  const points = form.map((r, i) => {
    const weight = (form.length - i) / form.length;
    return r === 'W' ? weight : 0;
  });
  return points.reduce((a, b) => a + b, 0) / form.length;
}

function mapPoolScore(team, maps) {
  if (!maps || maps.length === 0) return team.winRate;
  const scores = maps.map(m => team.mapStats[m]?.winRate ?? team.winRate);
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

function getH2HScore(t1Key, t2Key) {
  const key1 = `${t1Key}-${t2Key}`;
  const key2 = `${t2Key}-${t1Key}`;
  const h2h = headToHead[key1] || headToHead[key2];
  if (!h2h) return { t1: 0.5, t2: 0.5 };
  const isFlipped = !!headToHead[key2];
  const t1w = isFlipped ? h2h.team2Wins : h2h.team1Wins;
  const t2w = isFlipped ? h2h.team1Wins : h2h.team2Wins;
  return { t1: t1w / h2h.total, t2: t2w / h2h.total };
}

function normalizeRating(r)    { return Math.min(Math.max((r - 0.5)  / 0.6,  0), 1); }
function normalizeAvgRating(r) { return Math.min(Math.max((r - 0.85) / 0.65, 0), 1); }

function kelly(prob, odds, fraction = 0.25) {
  const edge = prob * odds - 1;
  if (edge <= 0) return 0;
  return Math.min((edge / (odds - 1)) * fraction, 0.05);
}

function removeMargin(odds1, odds2) {
  const impl1 = 1 / odds1;
  const impl2 = 1 / odds2;
  const margin = impl1 + impl2;
  return { p1: impl1 / margin, p2: impl2 / margin };
}

function predict(matchId, match, options = {}) {
  const { bankroll = 100, kellyFraction = 0.25, minEv = 0.05, minEdge = 0.03, pinnacleOdds } = options;

  const t1 = teams[match.team1];
  const t2 = teams[match.team2];

  // Si no tenemos datos de uno o ambos equipos, igual mostramos el partido
  // pero marcamos que los datos son insuficientes para una predicción fiable
  const hasData = !!(t1 && t2);

  if (!hasData) {
    const ref = removeMargin(match.odds.team1, match.odds.team2);
    return {
      matchId,
      insufficientData: true,
      team1: {
        name: match.team1Name || match.team1,
        tag:  match.team1Name || match.team1,
        logo: '🎮',
        probability: +(ref.p1 * 100).toFixed(1),
        ev: 0, edge: 0, clv: 0,
        scores: {},
        streakNote: null,
        refProb: +(ref.p1 * 100).toFixed(1),
      },
      team2: {
        name: match.team2Name || match.team2,
        tag:  match.team2Name || match.team2,
        logo: '🎮',
        probability: +(ref.p2 * 100).toFixed(1),
        ev: 0, edge: 0, clv: 0,
        scores: {},
        streakNote: null,
        refProb: +(ref.p2 * 100).toFixed(1),
      },
      recommendation: null,
      confidence: 'no_data',
      bestEv: 0,
      kellyPct: 0,
      kellyAmount: 0,
      pinnacleUsed: !!pinnacleOdds,
      weights: WEIGHTS,
    };
  }

  const h2h = getH2HScore(match.team1, match.team2);

  const s1 = {
    hltvRating: normalizeRating(t1.hltvRating),
    recentForm: formScore(t1.recentForm),
    avgRating:  normalizeAvgRating(t1.avgRating),
    winRate:    t1.winRate,
    h2h:        h2h.t1,
    mapPool:    mapPoolScore(t1, match.maps),
  };
  const s2 = {
    hltvRating: normalizeRating(t2.hltvRating),
    recentForm: formScore(t2.recentForm),
    avgRating:  normalizeAvgRating(t2.avgRating),
    winRate:    t2.winRate,
    h2h:        h2h.t2,
    mapPool:    mapPoolScore(t2, match.maps),
  };

  let raw1 = 0, raw2 = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    raw1 += w * s1[k];
    raw2 += w * s2[k];
  }
  const total = raw1 + raw2;
  const prob1 = raw1 / total;
  const prob2 = raw2 / total;

  const ref = pinnacleOdds
    ? removeMargin(pinnacleOdds.team1, pinnacleOdds.team2)
    : removeMargin(match.odds.team1,   match.odds.team2);

  const ev1   = prob1 * match.odds.team1 - 1;
  const ev2   = prob2 * match.odds.team2 - 1;
  const edge1 = prob1 - ref.p1;
  const edge2 = prob2 - ref.p2;
  const k1    = kelly(prob1, match.odds.team1, kellyFraction);
  const k2    = kelly(prob2, match.odds.team2, kellyFraction);

  let recommendation = null;
  let confidence = 'neutral';
  let kellyPct = 0;
  let kellyAmount = 0;

  const bestEv   = Math.max(ev1, ev2);
  const bestEdge = ev1 > ev2 ? edge1 : edge2;

  if (bestEv >= minEv && bestEdge >= minEdge) {
    const side  = ev1 > ev2 ? 1 : 2;
    recommendation = side === 1 ? match.team1 : match.team2;
    kellyPct    = side === 1 ? k1 : k2;
    kellyAmount = +(bankroll * kellyPct).toFixed(2);
    const ev = side === 1 ? ev1 : ev2;
    if (ev > 0.15) confidence = 'high';
    else if (ev > 0.08) confidence = 'medium';
    else confidence = 'low';
  }

  const streakNote = (t) => {
    if (t.streak >= 3)  return `🔥 ${t.streak} victorias seguidas`;
    if (t.streak <= -2) return `❄️ ${Math.abs(t.streak)} derrotas seguidas`;
    return null;
  };

  return {
    matchId,
    insufficientData: false,
    team1: {
      name: t1.name, tag: t1.tag, logo: t1.logo,
      probability: +(prob1 * 100).toFixed(1),
      ev: +ev1.toFixed(3), edge: +edge1.toFixed(3), clv: +((prob1 - ref.p1) / ref.p1).toFixed(3),
      scores: Object.fromEntries(Object.entries(s1).map(([k, v]) => [k, +v.toFixed(3)])),
      streakNote: streakNote(t1),
      refProb: +(ref.p1 * 100).toFixed(1),
    },
    team2: {
      name: t2.name, tag: t2.tag, logo: t2.logo,
      probability: +(prob2 * 100).toFixed(1),
      ev: +ev2.toFixed(3), edge: +edge2.toFixed(3), clv: +((prob2 - ref.p2) / ref.p2).toFixed(3),
      scores: Object.fromEntries(Object.entries(s2).map(([k, v]) => [k, +v.toFixed(3)])),
      streakNote: streakNote(t2),
      refProb: +(ref.p2 * 100).toFixed(1),
    },
    recommendation,
    confidence,
    bestEv:      +bestEv.toFixed(3),
    kellyPct:    +(kellyPct * 100).toFixed(2),
    kellyAmount,
    pinnacleUsed: !!pinnacleOdds,
    weights: WEIGHTS,
  };
}

function predictAll(matches, options = {}) {
  return matches.map(m => {
    const p = predict(m.id, m, options);
    if (!p) return null;
    return { ...p, match: m };
  }).filter(Boolean);
}

module.exports = { predict, predictAll };

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

function normalizeRating(rating) {
  return Math.min(Math.max((rating - 0.5) / 0.6, 0), 1);
}

function normalizeAvgRating(rating) {
  return Math.min(Math.max((rating - 0.85) / 0.65, 0), 1);
}

function predict(matchId, match) {
  const t1 = teams[match.team1];
  const t2 = teams[match.team2];
  if (!t1 || !t2) return null;

  const h2h = getH2HScore(match.team1, match.team2);

  const scores = {
    t1: {
      hltvRating: normalizeRating(t1.hltvRating),
      recentForm: formScore(t1.recentForm),
      avgRating:  normalizeAvgRating(t1.avgRating),
      winRate:    t1.winRate,
      h2h:        h2h.t1,
      mapPool:    mapPoolScore(t1, match.maps),
    },
    t2: {
      hltvRating: normalizeRating(t2.hltvRating),
      recentForm: formScore(t2.recentForm),
      avgRating:  normalizeAvgRating(t2.avgRating),
      winRate:    t2.winRate,
      h2h:        h2h.t2,
      mapPool:    mapPoolScore(t2, match.maps),
    },
  };

  let raw1 = 0, raw2 = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    raw1 += w * scores.t1[k];
    raw2 += w * scores.t2[k];
  }

  const total = raw1 + raw2;
  const prob1 = raw1 / total;
  const prob2 = raw2 / total;

  const ev1 = prob1 * match.odds.team1 - 1;
  const ev2 = prob2 * match.odds.team2 - 1;
  const impliedProb1 = 1 / match.odds.team1;
  const impliedProb2 = 1 / match.odds.team2;
  const edge1 = prob1 - impliedProb1;
  const edge2 = prob2 - impliedProb2;

  let recommendation = null;
  let confidence = 'neutral';
  const bestEv = Math.max(ev1, ev2);
  const bestEdge = ev1 > ev2 ? edge1 : edge2;

  if (bestEv > 0.05 && bestEdge > 0.03) {
    recommendation = ev1 > ev2 ? match.team1 : match.team2;
    if (bestEv > 0.15) confidence = 'high';
    else if (bestEv > 0.08) confidence = 'medium';
    else confidence = 'low';
  }

  const streakNote = (t) => {
    if (t.streak >= 3) return `🔥 ${t.streak} victorias seguidas`;
    if (t.streak <= -2) return `❄️ ${Math.abs(t.streak)} derrotas seguidas`;
    return null;
  };

  return {
    matchId,
    team1: {
      name: t1.name, tag: t1.tag, logo: t1.logo,
      probability: +(prob1 * 100).toFixed(1),
      ev: +ev1.toFixed(3), edge: +edge1.toFixed(3),
      scores: Object.fromEntries(Object.entries(scores.t1).map(([k, v]) => [k, +v.toFixed(3)])),
      streakNote: streakNote(t1),
    },
    team2: {
      name: t2.name, tag: t2.tag, logo: t2.logo,
      probability: +(prob2 * 100).toFixed(1),
      ev: +ev2.toFixed(3), edge: +edge2.toFixed(3),
      scores: Object.fromEntries(Object.entries(scores.t2).map(([k, v]) => [k, +v.toFixed(3)])),
      streakNote: streakNote(t2),
    },
    recommendation,
    confidence,
    bestEv: +bestEv.toFixed(3),
    h2hRecord: h2h,
    weights: WEIGHTS,
  };
}

function predictAll(matches) {
  return matches.map(m => ({ ...predict(m.id, m), match: m }));
}

module.exports = { predict, predictAll };

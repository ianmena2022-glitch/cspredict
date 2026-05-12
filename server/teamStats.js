const axios = require('axios');

const PANDA_KEY = process.env.PANDASCORE_API_KEY;

const pandaApi = axios.create({
  baseURL: 'https://api.pandascore.co',
  headers: { Authorization: `Bearer ${PANDA_KEY}` },
  timeout: 15000,
});

// teamId -> { stats, ts }
const cache = new Map();
const TTL = 6 * 60 * 60 * 1000; // 6 horas

// Curva de descanso: días desde último partido -> multiplicador de rendimiento
function restMultiplier(days) {
  if (days === null || days === undefined) return 1.0;
  if (days === 0)        return 0.88; // jugó hoy, fatiga
  if (days === 1)        return 0.94;
  if (days <= 4)         return 1.00; // óptimo
  if (days <= 7)         return 0.97;
  if (days <= 14)        return 0.93;
  return 0.88;                        // >2 semanas, oxidado
}

async function getTeamStats(pandaTeamId, teamName) {
  if (!PANDA_KEY || PANDA_KEY === 'your_key_here' || !pandaTeamId) return null;

  const hit = cache.get(pandaTeamId);
  if (hit && Date.now() - hit.ts < TTL) return hit.stats;

  try {
    const res = await pandaApi.get('/csgo/matches/past', {
      params: { 'filter[opponent_id]': pandaTeamId, per_page: 30, sort: '-end_at' },
    });
    const matches = res.data || [];
    if (matches.length === 0) return null;

    let wins = 0, losses = 0;
    const form = [];
    let lastMatchTs = null;
    let lanWins = 0, lanLosses = 0;

    for (const m of matches) {
      if (!m.winner) continue;
      const won = m.winner?.id === pandaTeamId;

      // LAN: PandaScore pone location en el torneo; "online" = remoto
      const loc = (m.tournament?.location || '').toLowerCase();
      const isLan = loc !== 'online' && loc !== '';

      if (form.length < 10) form.push(won ? 'W' : 'L');
      wins  += won ? 1 : 0;
      losses += won ? 0 : 1;
      if (!lastMatchTs && m.end_at) lastMatchTs = new Date(m.end_at).getTime();
      if (isLan) { lanWins += won ? 1 : 0; lanLosses += won ? 0 : 1; }
    }

    const total = wins + losses;
    if (total === 0) return null;

    // Racha actual
    let streak = 0;
    for (const r of form) {
      if (r === 'W') { if (streak >= 0) streak++; else break; }
      else           { if (streak <= 0) streak--; else break; }
    }

    const restDays = lastMatchTs
      ? Math.floor((Date.now() - lastMatchTs) / 86400000)
      : null;

    const stats = {
      winRate:          wins / total,
      recentForm:       form,
      streak,
      restDays,
      restMult:         restMultiplier(restDays),
      lanWinRate:       (lanWins + lanLosses) >= 5 ? lanWins / (lanWins + lanLosses) : null,
      matchesAnalyzed:  total,
    };

    cache.set(pandaTeamId, { stats, ts: Date.now() });
    console.log(`[teamStats] ${teamName}: ${total} partidos, WR=${+(stats.winRate*100).toFixed(1)}%, rest=${restDays}d, LAN=${stats.lanWinRate ? +(stats.lanWinRate*100).toFixed(1)+'%' : 'n/a'}`);
    return stats;
  } catch (err) {
    console.error(`[teamStats] ${teamName}:`, err.message);
    return null;
  }
}

module.exports = { getTeamStats, restMultiplier };

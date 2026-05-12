const axios = require('axios');

function getConfig() {
  // Leer en tiempo real para capturar cambios de settings sin reiniciar
  const { getSettings } = require('./db');
  const s = getSettings();
  return {
    token:       s.telegram_token  || process.env.TELEGRAM_TOKEN  || '',
    chatId:      s.telegram_chat_id || process.env.TELEGRAM_CHAT_ID || '',
    confidences: (s.telegram_confidences || 'high').split(',').map(c => c.trim()),
    enabled:     !!(s.telegram_token || process.env.TELEGRAM_TOKEN),
  };
}

async function sendMessage(text) {
  const { token, chatId } = getConfig();
  if (!token || !chatId) return false;
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id:    chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }, { timeout: 10000 });
    return true;
  } catch (err) {
    console.error('[telegram] Error:', err.response?.data?.description || err.message);
    return false;
  }
}

function formatBet(p) {
  const CONF_EMOJI = { high: '🔥', medium: '⚡', low: '⚠️' };
  const CONF_LABEL = { high: 'ALTA', medium: 'MEDIA', low: 'BAJA' };
  const m = p.match;
  const recTeam  = p.recommendation === m?.team1 ? p.team1 : p.team2;
  const recOdds  = p.recommendation === m?.team1 ? m?.odds?.team1 : m?.odds?.team2;
  const emoji    = CONF_EMOJI[p.confidence] || '📊';
  const label    = CONF_LABEL[p.confidence] || p.confidence;

  return [
    `${emoji} <b>Bet recomendada — Confianza ${label}</b>`,
    ``,
    `🎮 <b>${p.team1?.tag} vs ${p.team2?.tag}</b>`,
    `📋 ${m?.tournament || ''} · ${m?.format?.toUpperCase() || ''}`,
    m?.isLan ? `🏟️ Partido presencial (LAN)` : '',
    ``,
    `✅ Apostar: <b>${recTeam?.name || recTeam?.tag}</b> @ <b>${recOdds}x</b>`,
    `💵 Monto: $${p.kellyAmount?.toFixed(2)} (Kelly ${p.kellyPct?.toFixed(1)}%)`,
    `📊 Prob: ${recTeam?.probability}% · EV: +${(recTeam?.ev * 100).toFixed(1)}%`,
    p.pinnacleUsed ? `🔵 Edge vs Pinnacle: ${(recTeam?.edge * 100).toFixed(1)}%` : '',
  ].filter(l => l !== '').join('\n');
}

async function notifyBets(predictions, dbModule) {
  const { enabled, confidences } = getConfig();
  if (!enabled) return;

  const toNotify = predictions.filter(p =>
    p.recommendation &&
    confidences.includes(p.confidence) &&
    !dbModule.isTelegramNotified(p.matchId)
  );

  for (const p of toNotify) {
    const sent = await sendMessage(formatBet(p));
    if (sent) {
      dbModule.markTelegramNotified(p.matchId);
      console.log(`[telegram] Notificado: ${p.matchId}`);
    }
  }
}

async function sendTest() {
  return sendMessage(
    '✅ <b>Bot configurado correctamente</b>\n\nVas a recibir notificaciones cuando haya bets disponibles.'
  );
}

module.exports = { sendMessage, notifyBets, sendTest, getConfig };

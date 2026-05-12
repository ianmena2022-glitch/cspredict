const BASE = '/api';

export const getMatches    = () => fetch(`${BASE}/matches`).then(r => r.json());
export const getRankings   = () => fetch(`${BASE}/rankings`).then(r => r.json());
export const getStatus     = () => fetch(`${BASE}/status`).then(r => r.json());
export const getBankroll   = () => fetch(`${BASE}/bankroll`).then(r => r.json());
export const getStats      = () => fetch(`${BASE}/stats`).then(r => r.json());
export const getHistory    = (limit = 50) => fetch(`${BASE}/history?limit=${limit}`).then(r => r.json());
export const getSettings   = () => fetch(`${BASE}/settings`).then(r => r.json());

export const updateSettings = (body) =>
  fetch(`${BASE}/settings`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());

export const updateBankroll = (amount, note) =>
  fetch(`${BASE}/bankroll`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount, note }) }).then(r => r.json());

export const getUserBets    = ()         => fetch(`${BASE}/bets`).then(r => r.json());
export const addBet         = (body)     => fetch(`${BASE}/bets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
export const deleteBet      = (id)       => fetch(`${BASE}/bets/${id}`, { method: 'DELETE' }).then(r => r.json());
export const resolveBet     = (id, result) => fetch(`${BASE}/bets/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ result }) }).then(r => r.json());
export const updateBetAmount = (id, amount) => fetch(`${BASE}/bets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amount }) }).then(r => r.json());

export const getMatchOdds = (matchId) => fetch(`${BASE}/odds/${encodeURIComponent(matchId)}`).then(r => r.json());

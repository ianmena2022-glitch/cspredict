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

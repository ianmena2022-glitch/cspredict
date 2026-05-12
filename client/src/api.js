const BASE = '/api';

export async function getMatches() {
  const r = await fetch(`${BASE}/matches`);
  return r.json();
}

export async function getRankings() {
  const r = await fetch(`${BASE}/rankings`);
  return r.json();
}

export async function getTeams() {
  const r = await fetch(`${BASE}/teams`);
  return r.json();
}

export async function getStatus() {
  const r = await fetch(`${BASE}/status`);
  return r.json();
}

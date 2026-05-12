const initSqlJs = require('sql.js');
const path = require('path');
const fs   = require('fs');

const DB_DIR  = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '../data');
const DB_FILE = path.join(DB_DIR, 'cspredict.db');

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

let db;

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_FILE)) {
    db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    db = new SQL.Database();
  }
  createSchema();
  seedDefaults();
  // Persistir en disco cada 30 segundos
  setInterval(persist, 30_000);
}

function persist() {
  if (!db) return;
  fs.writeFileSync(DB_FILE, db.export());
}

function run(sql, params = []) {
  db.run(sql, params);
  return db;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt   = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function createSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS predictions (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id       TEXT NOT NULL UNIQUE,
      tournament     TEXT,
      team1          TEXT NOT NULL,
      team2          TEXT NOT NULL,
      team1_prob     REAL, team2_prob     REAL,
      team1_odds     REAL, team2_odds     REAL,
      pinnacle_prob1 REAL, pinnacle_prob2 REAL,
      recommended    TEXT,
      confidence     TEXT,
      ev             REAL,
      kelly_fraction REAL,
      kelly_amount   REAL,
      match_date     TEXT,
      format         TEXT,
      status         TEXT DEFAULT 'pending',
      result         TEXT,
      profit         REAL,
      created_at     TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS bankroll (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      amount     REAL NOT NULL,
      note       TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

function seedDefaults() {
  const count = get("SELECT COUNT(*) as c FROM bankroll");
  if (!count || count.c === 0) {
    db.run("INSERT INTO bankroll (amount, note) VALUES (?, ?)", [100, 'Bankroll inicial']);
  }
  const defaults = {
    kelly_fraction: '0.25',
    min_ev:         '0.05',
    min_edge:       '0.03',
    max_bet_pct:    '0.05',
    auto_track:     'true',
  };
  for (const [k, v] of Object.entries(defaults)) {
    db.run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [k, v]);
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

module.exports = {
  init,
  persist,

  getBankroll() {
    const row = get("SELECT amount FROM bankroll ORDER BY id DESC LIMIT 1");
    return row ? row.amount : 100;
  },

  getSettings() {
    const rows = all("SELECT key, value FROM settings");
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  updateSetting(key, value) {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, String(value)]);
    persist();
  },

  savePrediction(p) {
    db.run(`
      INSERT INTO predictions
        (match_id, tournament, team1, team2, team1_prob, team2_prob,
         team1_odds, team2_odds, pinnacle_prob1, pinnacle_prob2,
         recommended, confidence, ev, kelly_fraction, kelly_amount,
         match_date, format, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(match_id) DO UPDATE SET
        team1_prob=excluded.team1_prob, team2_prob=excluded.team2_prob,
        team1_odds=excluded.team1_odds, team2_odds=excluded.team2_odds,
        pinnacle_prob1=excluded.pinnacle_prob1, pinnacle_prob2=excluded.pinnacle_prob2,
        recommended=excluded.recommended, confidence=excluded.confidence,
        ev=excluded.ev, kelly_fraction=excluded.kelly_fraction,
        kelly_amount=excluded.kelly_amount, status=excluded.status
    `, [
      p.match_id, p.tournament, p.team1, p.team2,
      p.team1_prob, p.team2_prob, p.team1_odds, p.team2_odds,
      p.pinnacle_prob1, p.pinnacle_prob2, p.recommended, p.confidence,
      p.ev, p.kelly_fraction, p.kelly_amount, p.match_date, p.format, p.status,
    ]);
    persist();
  },

  resolveMatch(matchId, winner) {
    const pred = get("SELECT * FROM predictions WHERE match_id=?", [matchId]);
    if (!pred || pred.status !== 'pending') return null;

    const won    = pred.recommended === winner;
    const odds   = pred.recommended === pred.team1 ? pred.team1_odds : pred.team2_odds;
    const profit = pred.recommended
      ? (won ? pred.kelly_amount * (odds - 1) : -(pred.kelly_amount || 0))
      : 0;

    db.run("UPDATE predictions SET status='resolved', result=?, profit=? WHERE match_id=?",
      [winner, profit, matchId]);

    if (pred.recommended && pred.kelly_amount > 0) {
      const current = this.getBankroll();
      db.run("INSERT INTO bankroll (amount, note) VALUES (?, ?)",
        [current + profit, `${matchId}: ${won ? 'WIN' : 'LOSS'} ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`]);
    }
    persist();
    return { won, profit };
  },

  getPredictions(limit = 50) {
    return all("SELECT * FROM predictions ORDER BY created_at DESC LIMIT ?", [limit]);
  },

  getStats() {
    return get(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status='resolved' AND recommended IS NOT NULL AND result=recommended THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status='resolved' AND recommended IS NOT NULL AND result!=recommended THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN recommended IS NOT NULL THEN 1 ELSE 0 END) as bets_made,
        SUM(COALESCE(profit,0)) as total_profit,
        AVG(CASE WHEN ev IS NOT NULL THEN ev END) as avg_ev
      FROM predictions
    `);
  },

  getBankrollHistory() {
    return all("SELECT amount, note, created_at FROM bankroll ORDER BY id ASC");
  },

  // Exponer para rutas que lo necesiten
  run: (...args) => { db.run(...args); persist(); },
  get,
  all,
};

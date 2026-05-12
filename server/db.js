const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, 'cspredict.db'));

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id      TEXT NOT NULL UNIQUE,
    tournament    TEXT,
    team1         TEXT NOT NULL,
    team2         TEXT NOT NULL,
    team1_prob    REAL,
    team2_prob    REAL,
    team1_odds    REAL,
    team2_odds    REAL,
    pinnacle_prob1 REAL,
    pinnacle_prob2 REAL,
    recommended   TEXT,
    confidence    TEXT,
    ev            REAL,
    kelly_fraction REAL,
    kelly_amount  REAL,
    match_date    TEXT,
    format        TEXT,
    status        TEXT DEFAULT 'pending',
    result        TEXT,
    profit        REAL,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS bankroll (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    amount     REAL NOT NULL,
    note       TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// Bankroll inicial si no existe
const existing = db.prepare("SELECT COUNT(*) as c FROM bankroll").get();
if (existing.c === 0) {
  db.prepare("INSERT INTO bankroll (amount, note) VALUES (?, ?)").run(100, 'Bankroll inicial');
}

// Settings por defecto
const upsertSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO NOTHING
`);
upsertSetting.run('kelly_fraction', '0.25');   // Fracción Kelly (0.25 = quarter Kelly, más conservador)
upsertSetting.run('min_ev', '0.05');           // EV mínimo para recomendar
upsertSetting.run('min_edge', '0.03');         // Edge mínimo vs Pinnacle
upsertSetting.run('max_bet_pct', '0.05');      // Máximo 5% del bankroll por apuesta
upsertSetting.run('auto_track', 'true');       // Trackear predicciones automáticamente

module.exports = {
  db,

  getBankroll() {
    const rows = db.prepare("SELECT amount FROM bankroll ORDER BY id DESC LIMIT 1").get();
    return rows ? rows.amount : 100;
  },

  getSettings() {
    const rows = db.prepare("SELECT key, value FROM settings").all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  },

  updateSetting(key, value) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
      .run(key, String(value));
  },

  savePrediction(p) {
    return db.prepare(`
      INSERT INTO predictions
        (match_id, tournament, team1, team2, team1_prob, team2_prob,
         team1_odds, team2_odds, pinnacle_prob1, pinnacle_prob2,
         recommended, confidence, ev, kelly_fraction, kelly_amount,
         match_date, format, status)
      VALUES
        (@match_id, @tournament, @team1, @team2, @team1_prob, @team2_prob,
         @team1_odds, @team2_odds, @pinnacle_prob1, @pinnacle_prob2,
         @recommended, @confidence, @ev, @kelly_fraction, @kelly_amount,
         @match_date, @format, @status)
      ON CONFLICT(match_id) DO UPDATE SET
        team1_prob=excluded.team1_prob, team2_prob=excluded.team2_prob,
        team1_odds=excluded.team1_odds, team2_odds=excluded.team2_odds,
        pinnacle_prob1=excluded.pinnacle_prob1, pinnacle_prob2=excluded.pinnacle_prob2,
        recommended=excluded.recommended, confidence=excluded.confidence,
        ev=excluded.ev, kelly_fraction=excluded.kelly_fraction,
        kelly_amount=excluded.kelly_amount, status=excluded.status
    `).run(p);
  },

  resolveMatch(matchId, winner) {
    const pred = db.prepare("SELECT * FROM predictions WHERE match_id=?").get(matchId);
    if (!pred || pred.status !== 'pending') return null;

    const won = pred.recommended === winner;
    let profit = 0;
    if (pred.recommended) {
      const odds = pred.recommended === pred.team1 ? pred.team1_odds : pred.team2_odds;
      profit = won ? pred.kelly_amount * (odds - 1) : -(pred.kelly_amount || 0);
    }

    db.prepare("UPDATE predictions SET status='resolved', result=?, profit=? WHERE match_id=?")
      .run(winner, profit, matchId);

    if (pred.recommended && pred.kelly_amount > 0) {
      const current = this.getBankroll();
      db.prepare("INSERT INTO bankroll (amount, note) VALUES (?, ?)")
        .run(current + profit, `${matchId}: ${won ? 'WIN' : 'LOSS'} ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`);
    }

    return { won, profit };
  },

  getPredictions(limit = 50) {
    return db.prepare("SELECT * FROM predictions ORDER BY created_at DESC LIMIT ?").all(limit);
  },

  getStats() {
    const s = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved,
        SUM(CASE WHEN status='resolved' AND recommended IS NOT NULL AND result=recommended THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN status='resolved' AND recommended IS NOT NULL AND result!=recommended THEN 1 ELSE 0 END) as losses,
        SUM(CASE WHEN recommended IS NOT NULL THEN 1 ELSE 0 END) as bets_made,
        SUM(COALESCE(profit,0)) as total_profit,
        AVG(CASE WHEN ev IS NOT NULL THEN ev END) as avg_ev
      FROM predictions
    `).get();
    return s;
  },

  getBankrollHistory() {
    return db.prepare("SELECT amount, note, created_at FROM bankroll ORDER BY id ASC").all();
  },
};

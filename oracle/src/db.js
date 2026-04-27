/**
 * db.js — SQLite store untuk history rate dan last push
 * Ringan, tidak butuh MySQL untuk service oracle ini
 */
const Database = require("better-sqlite3")
const path     = require("path")
const fs       = require("fs")
const log      = require("./logger")

const DB_PATH = process.env.DB_PATH ?? "./data/oracle.db"

// Pastikan folder ada
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)

// Aktifkan WAL mode untuk concurrency yang lebih baik
db.pragma("journal_mode = WAL")

db.exec(`
  CREATE TABLE IF NOT EXISTS rate_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    rate_raw    INTEGER NOT NULL,
    rate_idr    REAL    NOT NULL,
    source      TEXT    NOT NULL,
    bi_date     TEXT    NOT NULL,
    tx_sig      TEXT,
    pushed      INTEGER NOT NULL DEFAULT 0,
    pushed_at   TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS oracle_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)

log.info("[db] SQLite initialized", { path: DB_PATH })

// ── Helpers ────────────────────────────────────────────────────────────────────
const stmtInsertRate = db.prepare(`
  INSERT INTO rate_history (rate_raw, rate_idr, source, bi_date)
  VALUES (@rate_raw, @rate_idr, @source, @bi_date)
`)

const stmtMarkPushed = db.prepare(`
  UPDATE rate_history SET pushed=1, pushed_at=datetime('now','localtime'), tx_sig=?
  WHERE id=?
`)

const stmtGetState = db.prepare(`SELECT value FROM oracle_state WHERE key=?`)
const stmtSetState = db.prepare(`
  INSERT INTO oracle_state (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value
`)

const stmtLastPushed = db.prepare(`
  SELECT * FROM rate_history WHERE pushed=1 ORDER BY pushed_at DESC LIMIT 1
`)

module.exports = {
  insertRate(data) {
    const info = stmtInsertRate.run(data)
    return info.lastInsertRowid
  },

  markPushed(id, txSig) {
    stmtMarkPushed.run(txSig, id)
  },

  getState(key) {
    const row = stmtGetState.get(key)
    return row ? row.value : null
  },

  setState(key, value) {
    stmtSetState.run(key, String(value))
  },

  getLastPushed() {
    return stmtLastPushed.get() ?? null
  },

  getHistory(limit = 30) {
    return db.prepare(`
      SELECT * FROM rate_history ORDER BY created_at DESC LIMIT ?
    `).all(limit)
  },
}
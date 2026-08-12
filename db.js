import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Шлях до БД. На Railway став OLX_DB=/data/olx.db і примонтуй Volume на /data,
// інакше дані злетять при кожному редеплої (файлова система ефемерна).
export const DB_PATH = process.env.OLX_DB || './data/olx.db';

export function openDb(path = DB_PATH) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS offers (
      offer_id          INTEGER PRIMARY KEY,
      category_id       INTEGER,
      title             TEXT,
      brand             TEXT,
      line              TEXT,
      type              TEXT,          -- full | tester | decant
      price_uah         REAL,
      condition         TEXT,          -- new | used | unknown
      city              TEXT,
      region            TEXT,
      created_time      TEXT,          -- UTC ISO, з OLX
      promoted          INTEGER,       -- 0/1
      first_seen        TEXT,
      last_seen         TEXT,
      gone_at           TEXT,          -- NULL = ще живе
      age_days_at_gone  REAL
    );

    CREATE TABLE IF NOT EXISTS crawls (
      crawl_ts   TEXT PRIMARY KEY,     -- UTC ISO, один рядок на цикл
      count      INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_offers_brand ON offers(brand);
    CREATE INDEX IF NOT EXISTS idx_offers_gone  ON offers(gone_at);
    CREATE INDEX IF NOT EXISTS idx_offers_cat   ON offers(category_id);
  `);
  return db;
}

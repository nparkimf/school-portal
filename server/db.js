import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import { FEE_FIELDS } from './constants.js';

const dataDir = path.join(import.meta.dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(dataDir, 'school-portal.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS schools (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    state        TEXT NOT NULL CHECK (state IN ('VA','DC','MD')),
    city         TEXT NOT NULL,
    school_type  TEXT NOT NULL DEFAULT 'Independent',
    grades_served TEXT NOT NULL DEFAULT '',
    website      TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (name, state, city)
  );

  CREATE TABLE IF NOT EXISTS tuition_fees (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id     INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    academic_year TEXT NOT NULL,
    level         TEXT NOT NULL CHECK (level IN ('Pre-K','Elementary','Middle','High')),
    ${FEE_FIELDS.map((f) => `${f.key} REAL NOT NULL DEFAULT 0 CHECK (${f.key} >= 0)`).join(',\n    ')},
    notes         TEXT NOT NULL DEFAULT '',
    updated_by    TEXT NOT NULL DEFAULT '',
    updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (school_id, academic_year, level)
  );

  CREATE INDEX IF NOT EXISTS idx_fees_year ON tuition_fees (academic_year);
  CREATE INDEX IF NOT EXISTS idx_schools_state ON schools (state);
`);

// SQL expression summing tuition and every fee column for a row aliased as `f`.
export const TOTAL_SQL = FEE_FIELDS.map((f) => `f.${f.key}`).join(' + ');

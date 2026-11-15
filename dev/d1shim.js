// Minimal Cloudflare D1 binding on top of node:sqlite, for local dev and tests.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const fix = (vals) => vals.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
const plain = (row) => (row ? { ...row } : row);

class Stmt {
  constructor(db, sql, binds = []) { this.db = db; this.sql = sql; this.binds = binds; }
  bind(...v) { return new Stmt(this.db, this.sql, fix(v)); }
  async all() { return { results: this.db.prepare(this.sql).all(...this.binds).map(plain), success: true, meta: {} }; }
  async first(col) { const r = plain(this.db.prepare(this.sql).get(...this.binds)); return r == null ? null : col ? r[col] : r; }
  async run() { const r = this.db.prepare(this.sql).run(...this.binds); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; }
  _runSync() { return this.db.prepare(this.sql).all(...this.binds).map(plain); }
}

export function makeD1(file) {
  const db = new DatabaseSync(file);
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try { const out = stmts.map((s) => ({ results: s._runSync(), success: true })); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    async exec(sql) { db.exec(sql); return { count: 1 }; },
  };
}

export function migrate(file) {
  const db = new DatabaseSync(file);
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../db/migrations');
  // Same bookkeeping table wrangler uses, so a D1 export can be loaded and migrated locally.
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM d1_migrations').all().map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f);
  }
  db.close();
}

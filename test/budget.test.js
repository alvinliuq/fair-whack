// Stage 6: the data budget is counted per Melbourne calendar month and includes Zyte and SerpApi.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../dev/d1shim.js';
import { BUDGET, monthSpend, monthStartIso, monthKey, budgetLevel } from '../shared/budget.js';

const fresh = () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-budget-')), 't.db');
  migrate(file);
  return file;
};
const addRun = (db, startedAt, cost, provider = null, mode = 'specials') =>
  db.prepare("INSERT INTO pipeline_runs (mode, retailer, started_at, status, cost_usd, provider) VALUES (?, 'coles', ?, 'ok', ?, ?)").run(mode, startedAt, cost, provider);

test('month starts at midnight Melbourne time, across daylight saving', () => {
  assert.equal(monthKey(new Date('2026-10-31T13:30:00Z')), '2026-11'); // 00:30 on 1 Nov in Melbourne
  assert.equal(monthKey(new Date('2026-10-31T12:59:00Z')), '2026-10');
  assert.equal(monthStartIso(new Date('2026-11-25T00:00:00Z')), '2026-10-31T13:00:00.000Z'); // AEDT
  assert.equal(monthStartIso(new Date('2026-07-15T00:00:00Z')), '2026-06-30T14:00:00.000Z'); // AEST
});

test('monthly spend: Apify + Zyte from runs this month, SerpApi as the fixed plan fee', async () => {
  const file = fresh();
  const db = new DatabaseSync(file);
  const now = new Date('2026-11-25T02:00:00Z');
  addRun(db, '2026-10-30T10:00:00Z', 50);              // last month: not counted
  addRun(db, '2026-11-02T10:00:00Z', 10.5);             // Apify (provider NULL)
  addRun(db, '2026-11-20T10:00:00Z', 4.25, 'apify');
  addRun(db, '2026-11-24T10:00:00Z', 0.3, 'zyte', 'zyte-probe');
  const m = await monthSpend(async (sql, p) => db.prepare(sql).all(...p), now);
  assert.equal(m.month, '2026-11');
  assert.equal(m.by.apify, 14.75);
  assert.equal(m.by.zyte, 0.3);
  assert.equal(m.by.serpapi, BUDGET.fixedUsd.serpapi);
  assert.equal(m.total, 14.75 + 0.3 + 75);
  assert.equal(budgetLevel(239.99), 'ok');
  assert.equal(budgetLevel(240), 'soft');
  assert.equal(budgetLevel(285), 'hard');
});

test('pipeline: catalogue stops at the soft limit, specials still run; everything stops at the hard limit', () => {
  const file = fresh();
  const db = new DatabaseSync(file);
  const fixtures = fs.mkdtempSync(path.join(os.tmpdir(), 'fw-fx-'));
  const run = (...args) => execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', 'pipeline/run.js', ...args],
    { env: { ...process.env, LOCAL_DB: file, APIFY_FIXTURE_DIR: fixtures }, encoding: 'utf8' });
  const last = (mode) => db.prepare('SELECT status, message FROM pipeline_runs WHERE mode = ? ORDER BY id DESC LIMIT 1').get(mode);

  addRun(db, new Date().toISOString(), BUDGET.softUsd - BUDGET.fixedUsd.serpapi + 1, null, 'catalogue'); // this month: soft limit passed
  run('catalogue', '--retailer=coles', '--force');
  assert.equal(last('catalogue').status, 'skipped');
  assert.match(last('catalogue').message, /catalogue paused/);
  run('specials', '--retailer=coles');
  assert.equal(last('specials').status, 'ok', 'specials keep running between the soft and hard limits');

  addRun(db, new Date().toISOString(), BUDGET.hardUsd, null, 'wishlist');
  run('specials', '--retailer=coles');
  assert.equal(last('specials').status, 'skipped');
  assert.match(last('specials').message, /monthly hard stop/);
});

test('saturday run skips the supermarkets', () => {
  const file = fresh();
  const out = execFileSync(process.execPath, ['--experimental-sqlite', '--no-warnings', 'pipeline/run.js', 'saturday'],
    { env: { ...process.env, LOCAL_DB: file, APIFY_FIXTURE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'fw-fx-')) }, encoding: 'utf8' });
  const db = new DatabaseSync(file);
  const ran = db.prepare("SELECT DISTINCT retailer FROM pipeline_runs WHERE mode = 'specials'").all().map((r) => r.retailer);
  for (const r of ['woolworths', 'coles', 'aldi']) assert.ok(!ran.includes(r), `${r} is not refreshed on Saturday`);
  assert.match(out, /mode=saturday/);
});

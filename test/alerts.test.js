// Stage 7 alerts: ❤️ items pushed on their own (≤3 each, otherwise merged), a summary counting ❤️ and 💜 items,
// at most 5 pushes a person a day, each special pushed once.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from '../dev/d1shim.js';
import { localDb } from '../pipeline/d1.js';
import { planAlerts, sendAlerts } from '../pipeline/alerts.js';

async function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-alert-')), 't.db');
  migrate(file);
  const db = await localDb(file);
  const now = new Date().toISOString();
  for (let i = 1; i <= 8; i++) {
    await db.run("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, cur_price_cents, cur_was_cents, cur_is_special, cur_promo_type, cur_captured_at, special_since) VALUES (?, 'coles', ?, ?, 200, 400, 1, 'half_price', ?, '2026-11-25')",
      [`coles:${i}`, String(i), `Item ${i}`, now]);
  }
  await db.run("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, cur_price_cents, cur_is_special, cur_captured_at) VALUES ('coles:9', 'coles', '9', 'Not on special', 500, 0, ?)", [now]);
  const user = async (id, items) => {
    await db.run("INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)", [id, id, now]);
    await db.run("INSERT INTO lists (id, user_id, name, created_at) VALUES (?, ?, 'My list', ?)", [`l-${id}`, id, now]);
    await db.run("INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, 'k', 'a', ?)", [`s-${id}`, id, `https://push/${id}`, now]);
    for (const [pid, mode] of items) await db.run('INSERT INTO list_items (id, list_id, product_id, alert_mode, created_at) VALUES (?, ?, ?, ?, ?)', [`${id}-${pid}`, `l-${id}`, pid, mode, now]);
  };
  return { db, user };
}

test('2 hearts + 1 purple: two single pushes and a summary of 3', async () => {
  const { db, user } = await setup();
  await user('u:ann', [['coles:1', 'any'], ['coles:2', 'half'], ['coles:3', 'off'], ['coles:9', 'any']]);
  const plan = await planAlerts(db);
  assert.deepEqual(plan.map((p) => p.kind), ['item', 'item', 'summary']);
  assert.match(plan[2].title, /^3 items on your list are on special/);
});

test('5 hearts: one merged push plus the summary; nothing again until a new special', async () => {
  const { db, user } = await setup();
  await user('u:ben', [1, 2, 3, 4, 5].map((i) => [`coles:${i}`, 'any']));
  const plan = await planAlerts(db);
  assert.deepEqual(plan.map((p) => p.kind), ['items', 'summary']);
  assert.match(plan[0].title, /5 items you're watching/);
  await sendAlerts(db, { dryRun: true });
  // Same specials again later: no item pushes; the summary only once in 20 hours.
  assert.deepEqual((await planAlerts(db)).map((p) => p.kind), []);
});

test('at most 5 pushes a day, summary kept', async () => {
  const { db, user } = await setup();
  await user('u:cat', [['coles:1', 'any'], ['coles:2', 'any']]);
  const earlier = new Date(Date.now() - 3600000).toISOString();
  for (let i = 0; i < 3; i++) await db.run("INSERT INTO push_events (user_id, kind, sent_at) VALUES ('u:cat', 'item', ?)", [earlier]);
  // 2 slots left: both hearts would need 2 + summary 1 -> merge the hearts into one, then the summary.
  assert.deepEqual((await planAlerts(db)).map((p) => p.kind), ['items', 'summary']);
  for (let i = 0; i < 2; i++) await db.run("INSERT INTO push_events (user_id, kind, sent_at) VALUES ('u:cat', 'item', ?)", [earlier]);
  assert.deepEqual((await planAlerts(db)).map((p) => p.kind), []);
});

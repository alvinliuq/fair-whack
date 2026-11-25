#!/usr/bin/env node
// Fair Whack data pipeline entry point.
//   node pipeline/run.js weekly      Wednesday: specials (every retailer) + wishlist refresh + matching + flags
//   node pipeline/run.js saturday    Saturday: specials of every retailer except the supermarkets + matching
//   node pipeline/run.js catalogue   monthly aisle crawl (skips unless 27+ days since last ok run; --force to override)
//   node pipeline/run.js alerts      send merged wishlist pushes
//   node pipeline/run.js match       re-run matching and the automatic review of possible matches
//   node pipeline/run.js review      dry run of matching + the automatic review (size, name, photo); --apply does it
//   node pipeline/run.js index       rebuild the search index only (--if-missing: skip when it is up to date)
//   node pipeline/run.js status      print spend and recent runs
// Options: --retailer=woolworths|coles   --force   --dry-run
import { makeDb } from './d1.js';
import { runActor } from './apify.js';
import { prepare, writeRecords, updateFlags } from './ingest.js';
import { runMatching, planMatching, linkChanges } from './match.js';
import { sendAlerts } from './alerts.js';
import { runReview } from './review.js';
import { loadIndexProducts, syncWordIndex, indexIsCurrent, clearApiCache } from './search-index.js';
import { ACTORS, POSTCODE, SPECIALS, AISLES, LIMITS, RUN_CAPS_USD, SUPERMARKETS } from './config.js';
import { BUDGET, SERPAPI, monthSpend, budgetLevel } from '../shared/budget.js';

const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith('--')) || 'weekly';
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => {
  const [k, v] = a.slice(2).split('=');
  return [k, v ?? true];
}));
const ALL_RETAILERS = Object.keys(SPECIALS);
const RETAILERS = opt.retailer ? [opt.retailer] : ALL_RETAILERS;
// Saturday's run skips the supermarkets (their specials change on Wednesdays).
const SATURDAY_RETAILERS = RETAILERS.filter((r) => !SUPERMARKETS.includes(r));

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

/** This Melbourne month's spend: Apify + Zyte (recorded runs) + SerpApi (fixed plan fee). */
const spentUsd = async (db) => (await monthSpend((sql, p) => db.all(sql, p))).total;

async function startRun(db, m, retailer, provider = null) {
  const startedAt = new Date().toISOString();
  await db.run('INSERT INTO pipeline_runs (mode, retailer, started_at, status, provider) VALUES (?, ?, ?, ?, ?)', [m, retailer, startedAt, 'running', provider]);
  const r = await db.all('SELECT MAX(id) AS id FROM pipeline_runs WHERE mode = ? AND started_at = ?', [m, startedAt]);
  return { id: r[0].id, startedAt };
}
async function endRun(db, id, status, items, cost, message) {
  await db.run('UPDATE pipeline_runs SET finished_at = ?, status = ?, items = ?, cost_usd = ?, message = ? WHERE id = ?',
    [new Date().toISOString(), status, items ?? null, cost ?? 0, message ? String(message).slice(0, 500) : null, id]);
}

/**
 * Monthly budget check. Returns the cap to use for this run, or { skip } to skip it.
 * extra = a job that stops at the soft limit (catalogue crawls). Specials and list refreshes run until the hard limit.
 */
async function capFor(db, key, { extra }) {
  const spent = await spentUsd(db);
  const level = budgetLevel(spent);
  if (level === 'hard') return { skip: `monthly hard stop: $${spent.toFixed(2)} of $${BUDGET.hardUsd} this month` };
  if (extra && level === 'soft') return { skip: `catalogue paused: $${spent.toFixed(2)} this month (soft limit $${BUDGET.softUsd})` };
  const cap = Math.min(RUN_CAPS_USD[key] ?? 1, BUDGET.hardUsd - spent);
  return { cap: Math.max(0.05, Math.round(cap * 100) / 100), spent };
}

function baseInput(retailer) {
  const input = { includeDetails: false, onlySpecials: false };
  if (POSTCODE[retailer]) input.postcode = POSTCODE[retailer];
  return input;
}

/** Run one scrape job (possibly several Apify runs) and ingest results. */
async function scrapeJob(db, kind, retailer, runs, { extra }) {
  const key = `${kind}:${retailer}`;
  const budget = await capFor(db, key, { extra });
  const { id, startedAt } = await startRun(db, kind, retailer);
  if (budget.skip) { log(key, 'skipped:', budget.skip); await endRun(db, id, 'skipped', 0, 0, budget.skip); return []; }
  let cost = 0, raw = [];
  try {
    let remaining = budget.cap;
    for (const [i, r] of runs.entries()) {
      if (remaining < 0.02) { log(key, 'cap reached, stopping'); break; }
      const left = runs.slice(i).reduce((s, x) => s + x.share, 0) || 1;
      const share = i < runs.length - 1 ? Math.max(0.05, Math.round((remaining * r.share / left) * 100) / 100) : Math.round(remaining * 100) / 100;
      log(key, `run ${i + 1}/${runs.length} cap $${share}`);
      const res = await runActor(ACTORS[retailer], { ...baseInput(retailer), ...r.input }, { maxChargeUsd: share, label: `${key}_${i}` });
      cost += res.costUsd; remaining -= res.costUsd;
      raw.push(...res.items);
      log(key, `run ${i + 1}: ${res.items.length} items, $${res.costUsd.toFixed(3)}, ${res.status}`);
    }
    const blocked = raw.filter((x) => x && x.error && /captcha|blocked|403|access denied/i.test(`${x.error} ${x.errorMessage || ''}`)).length;
    const { records, errors, excluded } = prepare(retailer, raw, startedAt);
    const written = await writeRecords(db, records);
    const flagged = await updateFlags(db, records.map((r) => r.product.id));
    const msg = `${written} saved, ${errors} errors, ${excluded} excluded, ${flagged} flags` + (blocked ? `, ${blocked} BLOCKED — check source` : '');
    log(key, msg);
    // Stop rule from the spec: if the source looks blocked, record it and do not retry.
    await endRun(db, id, blocked > raw.length / 2 ? 'failed' : 'ok', written, cost, msg);
    return records;
  } catch (e) {
    log(key, 'FAILED', e.message);
    await endRun(db, id, 'failed', raw.length, cost, e.message);
    process.exitCode = 1;
    return [];
  }
}

async function specials(db, retailers = RETAILERS) {
  if (!retailers.length) log('specials: no retailers for this run');
  for (const r of retailers) {
    const groups = SPECIALS[r];
    const total = groups.reduce((s, g) => s + g.max, 0);
    await scrapeJob(db, 'specials', r, groups.map((g) => ({
      share: g.max / total,
      input: { categoryUrls: [g.url], maxItemsPerQuery: g.max },
    })), { extra: false });
  }
}

async function wishlist(db) {
  for (const r of RETAILERS) {
    // Wishlisted products plus their matched twins at this retailer, not already refreshed this week.
    const fresh = new Date(Date.now() - 3 * 86400000).toISOString();
    const rows = await db.all(`
      SELECT DISTINCT o.product_url FROM list_items li
        JOIN retailer_product p ON p.id = li.product_id
        JOIN retailer_product o ON (o.id = p.id OR (p.canonical_product_id IS NOT NULL AND o.canonical_product_id = p.canonical_product_id))
       WHERE o.retailer = ? AND o.product_url IS NOT NULL AND COALESCE(o.cur_captured_at, '') < ?
       LIMIT ${LIMITS.wishlistMaxItems}`, [r, fresh]);
    const urls = rows.map((x) => x.product_url);
    if (!urls.length) { log(`wishlist:${r}`, 'nothing to refresh'); continue; }
    await scrapeJob(db, 'wishlist', r, [{ share: 1, input: { productUrls: urls, maxItemsPerQuery: 1 } }], { extra: false });
  }
}

async function catalogue(db) {
  for (const r of RETAILERS) {
    const last = await db.all("SELECT MAX(started_at) AS t FROM pipeline_runs WHERE mode = 'catalogue' AND retailer = ? AND status = 'ok'", [r]);
    const t = last[0]?.t;
    if (t && !opt.force && Date.now() - Date.parse(t) < LIMITS.catalogueEveryDays * 86400000) {
      log(`catalogue:${r}`, `skipped, last ok run ${t.slice(0, 10)}`);
      continue;
    }
    // One Apify run per department size (maxItemsPerQuery applies to every URL in a run).
    const bySize = new Map();
    for (const a of AISLES[r]) { if (!bySize.has(a.max)) bySize.set(a.max, []); bySize.get(a.max).push(a.url); }
    const total = AISLES[r].reduce((s, a) => s + a.max, 0);
    const runs = [...bySize.entries()].map(([max, urls]) => ({ share: (max * urls.length) / total, input: { categoryUrls: urls, maxItemsPerQuery: max } }));
    await scrapeJob(db, 'catalogue', r, runs, { extra: true });
  }
  // Products first seen up to now are the starting range; only later arrivals count as "new".
  const b = await db.all("SELECT value FROM app_meta WHERE key = 'new_baseline_at'");
  if (!b.length || opt.baseline) {
    await db.run("INSERT INTO app_meta (key, value) VALUES ('new_baseline_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [new Date().toISOString()]);
    log('new-product baseline set');
  }
}

const report = (r) => {
  log('match:', `${r.changed} products re-linked, ${r.candidates} review candidates (${r.removedFromQueue} cleared from the queue), ${r.clusters} canonical products, ${r.recategorised} recategorised`);
  log('search index:', r.index.error ? `NOT updated: ${r.index.error}` : `${r.index.rows} rows, ${r.index.written} written, ${r.index.removed} removed`);
};

/** Matching, then the automatic review of what is left in the queue (size + name + photo). */
async function match(db) {
  const plan = await planMatching(db);
  report(await runMatching(db, plan));
  // The review needs photos from the stores' sites; if that fails, the queue simply waits for a person.
  const r = await runReview(db, plan, { apply: true, log }).catch((e) => { log('review: skipped,', e.message); return null; });
  if (r?.approved) report(await runMatching(db)); // link the pairs just approved
}

/** Dry run: what matching and the review would change, without changing anything. */
async function review(db) {
  const plan = await planMatching(db);
  const ch = linkChanges(plan);
  log(`match (dry run): Woolworths products with a Coles twin: ${ch.linkedBefore} now, ${ch.linkedAfter} after; ${ch.gained.length} gain a twin, ${ch.lost.length} lose theirs, ${ch.changed.length} switch twin`);
  for (const [kind, list] of [['GAIN', ch.gained], ['LOSE', ch.lost], ['SWITCH', ch.changed]]) for (const line of list.slice(0, 400)) log(`${kind}\t${line}`);
  log(`match (dry run): queue ${plan.pending.length} now, ${plan.candidates.length} after`);
  await runReview(db, plan, { apply: false, allPhotos: !!opt['all-photos'], log });
  log('dry run: nothing was changed');
}

async function index(db) {
  if (opt['if-missing'] && await indexIsCurrent(db)) { log('search index: up to date, nothing to do'); return false; }
  const r = await syncWordIndex(db, await loadIndexProducts(db));
  log('search index:', `${r.rows} rows, ${r.written} written, ${r.removed} removed`);
  return true;
}


async function status(db) {
  const m = await monthSpend((sql, p) => db.all(sql, p));
  const level = budgetLevel(m.total);
  console.log(`Spend this month (${m.month}, Melbourne): $${m.total.toFixed(2)} of $${BUDGET.monthlyUsd}`
    + ` — Apify $${m.by.apify.toFixed(2)}, Zyte $${m.by.zyte.toFixed(2)} (estimated), SerpApi $${m.by.serpapi.toFixed(2)} (plan fee)`);
  console.log(`Limits: at $${BUDGET.softUsd} catalogue crawls stop; at $${BUDGET.hardUsd} everything stops. Now: ${level === 'ok' ? 'all jobs running' : level === 'soft' ? 'SOFT LIMIT — specials and list refreshes only' : 'HARD STOP — nothing runs'}`);
  const serp = await db.all('SELECT n FROM api_quota WHERE key = ?', [`serp:m:${m.month}`]).catch(() => []);
  console.log(`Google Shopping lookups this month: ${serp[0]?.n || 0} of ${SERPAPI.stopAtSearches} (plan ${SERPAPI.monthlySearches})`);
  await accountChecks();
  const runs = await db.all('SELECT mode, retailer, provider, started_at, status, items, cost_usd, message FROM pipeline_runs ORDER BY id DESC LIMIT 20');
  console.table(runs.map((r) => ({ ...r, cost_usd: Math.round((r.cost_usd || 0) * 1000) / 1000, message: (r.message || '').slice(0, 90) })));
}

/** The services' own figures, so a too-low account limit shows up before a run fails. */
async function accountChecks() {
  if (process.env.APIFY_TOKEN) {
    try {
      const r = await fetch('https://api.apify.com/v2/users/me/limits', { headers: { Authorization: `Bearer ${process.env.APIFY_TOKEN}` } });
      const d = (await r.json()).data || {};
      const used = d.current?.monthlyUsageUsd, max = d.limits?.maxMonthlyUsageUsd;
      if (used != null) console.log(`Apify account (its own billing cycle): $${Number(used).toFixed(2)} used of a $${max} monthly limit${max != null && max < 200 ? ' — BELOW the planned US$200: raise it in Apify → Settings → Usage & billing' : ''}${max != null && used >= max ? ' — LIMIT REACHED, Apify blocks every run until it is raised or the cycle resets' : ''}`);
      else console.log(`Apify account: could not read limits (${r.status})`);
    } catch (e) { console.log('Apify account: could not read limits,', e.message); }
  }
  if (process.env.SERPAPI_KEY) {
    try {
      const r = await fetch(`https://serpapi.com/account.json?api_key=${encodeURIComponent(process.env.SERPAPI_KEY)}`);
      const d = await r.json();
      if (d.plan_name || d.searches_per_month != null) console.log(`SerpApi account: plan "${d.plan_name}", ${d.this_month_usage ?? '?'} used, ${d.plan_searches_left ?? d.total_searches_left ?? '?'} left of ${d.searches_per_month ?? '?'} this month`);
      else console.log(`SerpApi account: ${d.error || `could not read (${r.status})`}`);
    } catch (e) { console.log('SerpApi account: could not read,', e.message); }
  } else console.log('SerpApi: SERPAPI_KEY not available to this job');
  console.log(process.env.ZYTE_API_KEY ? 'Zyte: key available (free trial, US$5 account cap)' : 'Zyte: ZYTE_API_KEY not available to this job');
}

const db = await makeDb();
log(`mode=${mode} retailers=${RETAILERS.join(',')}`);
if (mode === 'weekly') { await specials(db); await wishlist(db); await match(db); }
else if (mode === 'saturday') { await specials(db, SATURDAY_RETAILERS); if (SATURDAY_RETAILERS.length) await match(db); }
else if (mode === 'specials') { await specials(db); await match(db); }
else if (mode === 'wishlist') await wishlist(db);
else if (mode === 'catalogue') { await catalogue(db); await match(db); }
else if (mode === 'first') { await catalogue(db); await specials(db); await match(db); }
else if (mode === 'match') await match(db);
else if (mode === 'review') { if (opt.apply) await match(db); else { await review(db); process.exit(0); } }
else if (mode === 'index') { if (!(await index(db))) process.exit(0); }
else if (mode === 'alerts') { const r = await sendAlerts(db, { dryRun: !!opt['dry-run'] }); log('alerts:', JSON.stringify(r)); }
else if (mode === 'status') await status(db);
else { console.error(`Unknown mode ${mode}`); process.exit(2); }
// Anything that changed products or prices makes the saved API answers out of date.
if (!['alerts', 'status'].includes(mode)) {
  await clearApiCache(db).then(() => log('api cache cleared'), (e) => log('api cache NOT cleared:', e.message));
}

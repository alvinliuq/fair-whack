#!/usr/bin/env node
// Fair Whack data pipeline entry point.
//   node pipeline/run.js weekly      Wednesday: specials (every retailer) + wishlist refresh + matching + flags
//   node pipeline/run.js saturday    Saturday: specials of every retailer except the supermarkets + matching
//   node pipeline/run.js catalogue   monthly aisle crawl (skips unless 27+ days since last ok run; --force to override)
//   node pipeline/run.js alerts      send merged wishlist pushes
//   node pipeline/run.js match       re-run matching and the automatic review of possible matches
//   node pipeline/run.js review      dry run of matching + the automatic review (size, name, photo); --apply does it
//   node pipeline/run.js index       rebuild the search index only (--if-missing: skip when it is up to date)
//   node pipeline/run.js probe       tiny test run (5 products) of each first-batch retailer's scraper; shows what it returned
//   node pipeline/run.js zyte        technical check of the second-batch retailers with Zyte (no products saved)
//   node pipeline/run.js serpcheck   one live Google Shopping lookup ("dyson v8"), saved like a tester's search
//   node pipeline/run.js status      print spend and recent runs
// Options: --retailer=woolworths|coles   --force   --dry-run
import { makeDb } from './d1.js';
import { runActor } from './apify.js';
import { prepare, writeRecords, updateFlags } from './ingest.js';
import { ACTIVE_SOURCES as SOURCES, adaptItem } from './sources.js';
import { ZYTE_TARGETS, ZYTE_MAX_USD, checkStore, verdict } from './zyte.js';
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
const ALL_RETAILERS = [...Object.keys(SPECIALS), ...Object.keys(SOURCES)];
if (opt.retailer && !ALL_RETAILERS.includes(opt.retailer) && !(mode === 'zyte' && ZYTE_TARGETS[opt.retailer])) { console.error(`Unknown retailer ${opt.retailer}. Known: ${ALL_RETAILERS.join(', ')}`); process.exit(2); }
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
      const actor = SOURCES[retailer]?.actor || ACTORS[retailer];
      const input = SOURCES[retailer] ? r.input : { ...baseInput(retailer), ...r.input };
      const res = await runActor(actor, input, { maxChargeUsd: share, label: `${key}_${i}` });
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

/** Source runs ({ input, max }) -> scrapeJob runs ({ input, share }) with the cap split by item count. */
const withShares = (runs) => {
  const total = runs.reduce((s, x) => s + (x.max || 1), 0) || 1;
  return runs.map((x) => ({ input: x.input, share: (x.max || 1) / total }));
};

async function specials(db, retailers = RETAILERS) {
  if (!retailers.length) log('specials: no retailers for this run');
  for (const r of retailers) {
    if (SOURCES[r]) {
      if (!SOURCES[r].specials.length) { log(`specials:${r}`, 'no specials at this store; prices refresh with the catalogue and lists'); continue; }
      await scrapeJob(db, 'specials', r, withShares(SOURCES[r].specials), { extra: false });
      continue;
    }
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
    const runs = SOURCES[r] ? withShares(SOURCES[r].refresh(urls)) : [{ share: 1, input: { productUrls: urls, maxItemsPerQuery: 1 } }];
    await scrapeJob(db, 'wishlist', r, runs, { extra: false });
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
    if (SOURCES[r]) { await scrapeJob(db, 'catalogue', r, withShares(SOURCES[r].catalogue), { extra: true }); continue; }
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

/** Tiny run per first-batch retailer: is the scraper reachable, and does its output turn into products? Writes no products. */
async function probe(db) {
  for (const r of RETAILERS.filter((x) => SOURCES[x])) {
    const s = SOURCES[r];
    const base = (s.specials[0] || s.catalogue[0]).input;
    // The configured input first, then any alternatives, until one gives usable products.
    for (const [n, cand] of [base, ...(s.probeAlternatives || [])].entries()) {
      const input = { ...cand, ...(cand.operation ? { limit: 5 } : { maxItems: 5 }) };
      if (Array.isArray(input.queries) && input.queries.length > 1) input.queries = input.queries.slice(0, 1);
      if (Array.isArray(input.searchTerms) && input.searchTerms.length > 1) input.searchTerms = input.searchTerms.slice(0, 1);
      const label = n ? `probe:${r}#alt${n}` : `probe:${r}`;
      const budget = await capFor(db, `probe:${r}`, { extra: false });
      const { id } = await startRun(db, 'probe', r);
      if (budget.skip) { log(label, budget.skip); await endRun(db, id, 'skipped', 0, 0, budget.skip); break; }
      try {
        const res = await runActor(s.actor, input, { maxChargeUsd: Math.min(0.3, budget.cap), label, timeoutMin: 10 });
        const adapted = res.items.map((x) => adaptItem(r, x));
        const good = adapted.filter((x) => !x.error);
        const msg = `${res.items.length} returned, ${good.length} usable, $${res.costUsd.toFixed(3)}, ${res.status}`
          + (good[0] ? ` — e.g. ${good[0].name} $${good[0].price}${good[0].wasPrice ? ` (was $${good[0].wasPrice})` : ''}${good[0].url ? '' : ' (NO URL)'}` : '')
          + (adapted.find((x) => x.error) ? ` — problem: ${adapted.find((x) => x.error).error}` : '');
        log(label, `input ${JSON.stringify(input).slice(0, 300)}`);
        log(label, msg);
        if (res.items[0]) log(label, 'first item:', JSON.stringify(res.items[0]).slice(0, 1500));
        const tally = (f) => Object.entries(adapted.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {})).map(([k, v]) => `${k}: ${v}`).join(' · ');
        if (res.items.length > 5) {
          log(label, 'by category:', tally((x) => String(x.category || '—').split(' > ')[0]));
          log(label, 'by result:', tally((x) => x.error || (x.isOnSpecial ? 'ok, on special' : 'ok')));
        }
        await endRun(db, id, good.length ? 'ok' : 'failed', good.length, res.costUsd, msg);
        if (good.length && !opt.force) break; // --force: try every alternative
      } catch (e) {
        log(label, 'FAILED', e.message.slice(0, 700));
        await endRun(db, id, 'failed', 0, 0, e.message);
      }
    }
  }
}

/** Second batch: which retailers can Zyte read? Each request is recorded at an estimated cost. */
async function zyteCheck(db) {
  if (!process.env.ZYTE_API_KEY) { log('zyte: ZYTE_API_KEY is not set'); process.exitCode = 1; return; }
  const targets = opt.retailer ? { [opt.retailer]: ZYTE_TARGETS[opt.retailer] } : ZYTE_TARGETS;
  const zyteSoFar = async () => Number((await db.all("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM pipeline_runs WHERE provider = 'zyte'"))[0].s);
  const results = [];
  for (const [id, t] of Object.entries(targets)) {
    if (!t) { log(`zyte: unknown store ${id}`); continue; }
    if (budgetLevel(await spentUsd(db)) === 'hard') { log('zyte: monthly hard stop, not checking'); break; }
    const { id: runId } = await startRun(db, 'zyte-check', id, 'zyte');
    let cost = 0;
    const base = await zyteSoFar();
    const spend = async (usd) => { if (base + cost + usd > ZYTE_MAX_USD) return false; cost += usd; return true; };
    let r;
    try { r = await checkStore(id, t, spend, log); }
    catch (e) { r = { id, name: t.name, problem: e.message, products: 0 }; }
    const v = verdict(r);
    log(`zyte:${id}`, v);
    results.push({ store: t.name, verdict: v, sample: (r.sample || []).join(' | ').slice(0, 160) });
    await endRun(db, runId, r.products >= 5 ? 'ok' : 'failed', r.products, cost, `${v}${r.sample ? ` — e.g. ${r.sample[0]}` : ''}`);
  }
  console.table(results);
  log(`zyte: estimated spend on checks so far $${(await zyteSoFar()).toFixed(2)} (check stops at $${ZYTE_MAX_USD}; Zyte's own dashboard is the final word)`);
}

/** One live Google Shopping lookup through the same parsing and cache as the app. */
async function serpCheck(db) {
  const { serpResults } = await import('../shared/api.js');
  const { monthKey } = await import('../shared/budget.js');
  const q = 'dyson v8';
  const p = new URLSearchParams({ engine: 'google_shopping', q, gl: 'au', hl: 'en', google_domain: 'google.com.au', location: 'Melbourne,Victoria,Australia', api_key: process.env.SERPAPI_KEY || '' });
  const res = await fetch(`https://serpapi.com/search.json?${p}`);
  const data = await res.json();
  await db.run('INSERT INTO api_quota (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1', [`serp:m:${monthKey()}`]);
  if (data.error) { log('serpcheck: SerpApi error:', data.error); process.exitCode = 1; return; }
  const out = serpResults(data);
  await db.run('INSERT INTO serp_cache (q, fetched_at, data) VALUES (?, ?, ?) ON CONFLICT(q) DO UPDATE SET fetched_at = excluded.fetched_at, data = excluded.data',
    [q, new Date().toISOString(), JSON.stringify({ results: out })]);
  log(`serpcheck: "${q}" -> ${out.length} offers; cheapest:`);
  for (const r of [...out].sort((a, b) => a.priceCents - b.priceCents).slice(0, 5)) log(`  $${(r.priceCents / 100).toFixed(2)}  ${r.store}  ${r.title.slice(0, 70)}${r.link ? '' : '  (no link)'}`);
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
else if (mode === 'probe') await probe(db);
else if (mode === 'zyte') await zyteCheck(db);
else if (mode === 'serpcheck') await serpCheck(db);
else { console.error(`Unknown mode ${mode}`); process.exit(2); }
// Anything that changed products or prices makes the saved API answers out of date.
if (!['alerts', 'status', 'probe', 'zyte', 'serpcheck'].includes(mode)) {
  await clearApiCache(db).then(() => log('api cache cleared'), (e) => log('api cache NOT cleared:', e.message));
}

// Stage 6, second batch: stores read through Zyte API's automatic extraction (no scraper of our own).
// Listing pages -> productList (following "next page" links up to maxPages); list refresh -> product pages.
// Zyte returns no price per request, so each successful request is recorded at a cautious estimate
// (ZYTE_EST_USD); Zyte's own spending limit (US$70 a month) is the final safety net.
import { ZYTE_EST_USD, BUDGET } from '../shared/budget.js';

const API = 'https://api.zyte.com/v1/extract';

async function zyte(body) {
  const key = process.env.ZYTE_API_KEY;
  if (!key) throw new Error('ZYTE_API_KEY is not set');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(200000),
    }).catch((e) => ({ status: 0, json: async () => ({ detail: e.message }) }));
    const data = await res.json().catch(() => ({}));
    // 429 = slow down; 503/520/521 = temporary. Unsuccessful responses are not charged by Zyte.
    if ([429, 503, 520, 521].includes(res.status) && attempt < 3) { await new Promise((r) => setTimeout(r, 5000 * attempt)); continue; }
    return { status: res.status, data };
  }
}

const perRequest = (extractFrom) => (extractFrom === 'browserHtml' ? ZYTE_EST_USD.browser : 0) + ZYTE_EST_USD.extraction;

/** Zyte spend recorded this month (estimates). */
export async function zyteMonthUsd(db, since) {
  const r = await db.all("SELECT COALESCE(SUM(cost_usd), 0) AS s FROM pipeline_runs WHERE provider = 'zyte' AND started_at >= ?", [since]);
  return Number(r[0]?.s || 0);
}

/**
 * input: { pages: [[url, category], ...], extractFrom, maxPages } (listing pages)
 *     or { products: [url, ...], extractFrom } (product pages, list refresh)
 * budgetUsd: stop before spending more than this in the run.
 * Returns { items, costUsd, status } like runActor.
 */
export async function runZyte(input, { label = 'zyte', budgetUsd = 5, log = console.log, concurrency = 4 } = {}) {
  if (process.env.APIFY_FIXTURE_DIR) return { items: [], costUsd: 0, status: 'SUCCEEDED' };
  const est = perRequest(input.extractFrom);
  let cost = 0, stopped = false;
  const items = [];
  const jobs = input.products
    ? input.products.map((url) => ({ url, product: true }))
    : input.pages.map(([url, category]) => ({ url, category, page: 1 }));
  const work = async () => {
    while (jobs.length && !stopped) {
      const j = jobs.shift();
      if (cost + est > budgetUsd) { stopped = true; log(`${label}: run budget $${budgetUsd} reached, stopping`); break; }
      const body = j.product
        ? { url: j.url, product: true, productOptions: { extractFrom: input.extractFrom }, geolocation: 'AU' }
        : { url: j.url, productList: true, productListOptions: { extractFrom: input.extractFrom }, geolocation: 'AU' };
      const { status, data } = await zyte(body);
      if (status === 200) cost += est;
      if (j.product) {
        if (status === 200 && data.product) items.push({ ...data.product, _url: j.url });
        else log(`${label}: product ${j.url} -> ${status}`);
        continue;
      }
      const list = data.productList?.products || [];
      log(`${label}: ${j.url} -> ${status}${status === 200 ? `, ${list.length} products` : ` ${String(data.detail || data.title || '').slice(0, 100)}`}`);
      for (const p of list) items.push({ ...p, _category: j.category });
      const next = data.productList?.paginationNext?.url;
      if (status === 200 && next && list.length && j.page < (input.maxPages || 1)) jobs.push({ url: next, category: j.category, page: j.page + 1 });
    }
  };
  await Promise.all(Array.from({ length: concurrency }, work));
  return { items, costUsd: Math.round(cost * 10000) / 10000, status: stopped ? 'STOPPED_BUDGET' : 'SUCCEEDED' };
}

/** A Zyte product or productList item -> the shape normaliseScraped() reads. */
export function adaptZyte(x) {
  if (!x || !x.name) return { error: 'no item' };
  const num = (v) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const price = num(x.price);
  const reg = num(x.regularPrice);
  const was = reg && price != null && reg > price + 0.004 ? reg : null;
  const url = x.url || x.canonicalUrl || x._url || null;
  let id = x.productId || x.sku || x.mpn;
  if (!id && url) { try { id = new URL(url).pathname.replace(/\/+$/, '').split('/').pop(); } catch { id = null; } }
  const crumbs = Array.isArray(x.breadcrumbs) ? x.breadcrumbs.map((b) => b.name).filter((n) => n && !/^home$/i.test(n)) : [];
  return {
    productId: id,
    name: String(x.name).trim(),
    brand: x.brand?.name || null,
    size: x.size || null,
    price,
    wasPrice: was,
    isOnSpecial: !!was,
    promotionText: was ? `Save $${(was - price).toFixed(2)}` : null,
    category: crumbs.length ? crumbs.join(' > ') : x._category || null,
    image: x.mainImage?.url || (Array.isArray(x.images) ? x.images[0]?.url : null) || null,
    url,
    barcode: Array.isArray(x.gtin) && x.gtin[0] ? x.gtin[0].value : null,
    isAvailable: x.availability ? !/out ?of ?stock/i.test(x.availability) : true,
    unitPriceText: null,
  };
}

export { BUDGET };

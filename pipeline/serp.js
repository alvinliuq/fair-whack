// Stores read through Google Shopping (SerpApi) instead of a scraper (stage 6: Kmart, whose site blocks
// both Apify and Zyte). One search = one query; only results sold by the store itself are kept.
// SerpApi is a flat monthly fee, so runs cost $0; searches are counted against the plan instead, and the
// pipeline leaves SERPAPI.reserveForTesters searches for testers' own comparisons.
import { SERPAPI, monthKey } from '../shared/budget.js';

const API = 'https://serpapi.com/search.json';

/** Searches the pipeline may still use this month. */
export async function serpRoom(db) {
  const r = await db.all('SELECT n FROM api_quota WHERE key = ?', [`serp:m:${monthKey()}`]);
  return SERPAPI.stopAtSearches - SERPAPI.reserveForTesters - Number(r[0]?.n || 0);
}

/**
 * Run a list of Google Shopping searches for one store.
 * input: { store: /regex source/, queries: [[query, categoryPath], ...] }
 * Returns { items, costUsd: 0, status, searches } like runActor.
 */
export async function runSerp(db, input, { label = 'serp' } = {}) {
  if (process.env.APIFY_FIXTURE_DIR) return { items: [], costUsd: 0, status: 'SUCCEEDED', searches: 0 };
  const key = process.env.SERPAPI_KEY;
  if (!key) throw new Error('SERPAPI_KEY is not set');
  const store = new RegExp(input.store, 'i');
  const items = [];
  let searches = 0;
  for (const [q, category] of input.queries) {
    if ((await serpRoom(db)) <= 0) { console.log(`${label}: stopping, the month's pipeline searches are used up`); break; }
    const p = new URLSearchParams({ engine: 'google_shopping', q, gl: 'au', hl: 'en', google_domain: 'google.com.au', location: 'Melbourne,Victoria,Australia', api_key: key });
    await db.run('INSERT INTO api_quota (key, n) VALUES (?, 1) ON CONFLICT(key) DO UPDATE SET n = n + 1', [`serp:m:${monthKey()}`]);
    searches++;
    let data;
    try { data = await (await fetch(`${API}?${p}`)).json(); } catch (e) { console.log(`${label}: "${q}" failed: ${e.message}`); continue; }
    if (data.error) { if (!/any results/i.test(data.error)) console.log(`${label}: "${q}": ${data.error}`); continue; }
    for (const r of [...(data.shopping_results || []), ...(data.inline_shopping_results || [])]) {
      if (!store.test(r.source || '')) continue;
      items.push({ ...r, _query: q, _category: category });
    }
  }
  return { items, costUsd: 0, status: 'SUCCEEDED', searches };
}

/** A Google Shopping result -> the shape normaliseScraped() reads. */
export function adaptSerp(x, site) {
  if (!x || !x.title) return { error: 'no item' };
  const price = typeof x.extracted_price === 'number' ? x.extracted_price : null;
  const was = typeof x.extracted_old_price === 'number' && price != null && x.extracted_old_price > price + 0.004 ? x.extracted_old_price : null;
  const text = `${x.tag || ''} ${(x.extensions || []).join(' ')}`;
  // Google's own product id when there is one; otherwise the title (stable enough for one store's listing).
  const id = x.product_id || x.prds || String(x.title).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80);
  return {
    productId: `g${id}`,
    name: String(x.title).trim(),
    brand: null,
    size: null,
    price,
    wasPrice: was,
    isOnSpecial: !!(was || /\b(sale|clearance|reduced|price drop)\b/i.test(text)),
    promotionText: was ? `Save $${(was - price).toFixed(2)}` : (/clearance/i.test(text) ? 'Clearance' : null),
    category: x._category || null,
    image: x.thumbnail || x.serpapi_thumbnail || null,
    // Link to the store's own search for this product (Google's product page is not the store).
    url: `https://${site}/search/?searchTerm=${encodeURIComponent(String(x.title).trim())}`,
    barcode: null,
    isAvailable: true,
    unitPriceText: null,
  };
}

/** Product URL written by adaptSerp -> the words to search for again (list refresh). */
export const serpQueryFromUrl = (url) => {
  try { return new URL(url).searchParams.get('searchTerm'); } catch { return null; }
};

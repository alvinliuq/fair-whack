// Stage 6, second batch: can Zyte read these retailers' pages? (technical check only, no products saved)
// For each store: a listing page with Zyte's automatic product-list extraction, first from the plain HTML
// (cheapest), then with a browser if that found too little; then one product page from the list.
// Every request is recorded in pipeline_runs (provider 'zyte') at a cautious estimated cost, and the whole
// check stops well before the free trial's US$5.
import { ZYTE_EST_USD } from '../shared/budget.js';

export const ZYTE_TARGETS = {
  decathlon: { name: 'Decathlon', urls: ['https://www.decathlon.com.au/search?q=tent', 'https://www.decathlon.com.au/'] },
  petbarn: { name: 'Petbarn', urls: ['https://www.petbarn.com.au/dogs/dog-food', 'https://www.petbarn.com.au/search?q=dog%20food'] },
  peto: { name: 'PetO', urls: ['https://www.peto.com.au/search?q=dog+food', 'https://www.peto.com.au/'] },
  ebgames: { name: 'EB Games', urls: ['https://www.ebgames.com.au/search?q=nintendo', 'https://www.ebgames.com.au/'] },
  target: { name: 'Target', urls: ['https://www.target.com.au/search?text=towel', 'https://www.target.com.au/'] },
  kmart: { name: 'Kmart', urls: ['https://www.kmart.com.au/category/home/bathroom/towels/', 'https://www.kmart.com.au/search/?searchTerm=towel'] },
  thegoodguys: { name: 'The Good Guys', urls: ['https://www.thegoodguys.com.au/televisions', 'https://www.thegoodguys.com.au/search?q=tv'] },
  // Third batch (27 Nov).
  harveynorman: { name: 'Harvey Norman', urls: ['https://www.harveynorman.com.au/televisions', 'https://www.harveynorman.com.au/catalogsearch/result/?q=tv'] },
  petstock: { name: 'PETstock', urls: ['https://www.petstock.com.au/search?q=dog%20food', 'https://www.petstock.com.au/'] },
  petcircle: { name: 'Pet Circle', urls: ['https://www.petcircle.com.au/search?q=dog%20food', 'https://www.petcircle.com.au/'] },
};

export const ZYTE_MAX_USD = 3; // stop checks once technical checks (all time) have cost this much

async function zyte(body) {
  const key = process.env.ZYTE_API_KEY;
  if (!key) throw new Error('ZYTE_API_KEY is not set');
  const res = await fetch('https://api.zyte.com/v1/extract', {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const priced = (p) => p && p.name && (p.price != null || p.regularPrice != null);

/** Check one store. `spend(usd, note)` records each request; returns false when the check must stop. */
export async function checkStore(id, t, spend, log) {
  const r = { id, name: t.name, listUrl: null, mode: null, products: 0, sample: null, productPage: null, problem: null };
  for (const url of t.urls) {
    for (const extractFrom of ['httpResponseBody', 'browserHtml']) {
      const est = extractFrom === 'browserHtml' ? ZYTE_EST_USD.browser + ZYTE_EST_USD.extraction : ZYTE_EST_USD.extraction;
      if (!(await spend(est, `${id} list ${extractFrom}`))) { r.problem = 'stopped: check budget reached'; return r; }
      const { status, data } = await zyte({ url, productList: true, productListOptions: { extractFrom }, geolocation: 'AU' });
      const list = (data.productList?.products || []).filter(priced);
      log(`zyte:${id}`, `${url} via ${extractFrom}: HTTP ${status}${data.detail ? ` (${String(data.detail).slice(0, 120)})` : ''}, ${list.length} products with a price`);
      if (status !== 200) { r.problem = `${status} ${data.title || ''} ${String(data.detail || '').slice(0, 120)}`.trim(); if (status === 451 || status === 403) return r; continue; }
      if (list.length >= 5) {
        Object.assign(r, { listUrl: url, mode: extractFrom, products: list.length, problem: null,
          sample: list.slice(0, 3).map((p) => `${p.name} ${p.currency || ''} ${p.price ?? p.regularPrice}`) });
        const first = list.find((p) => p.url);
        if (first) {
          if (!(await spend(est, `${id} product ${extractFrom}`))) return r;
          let pg = await zyte({ url: first.url, product: true, productOptions: { extractFrom }, geolocation: 'AU' });
          if (!(pg.status === 200 && priced(pg.data.product)) && extractFrom !== 'browserHtml'
              && (await spend(ZYTE_EST_USD.browser + ZYTE_EST_USD.extraction, `${id} product browserHtml`))) {
            pg = await zyte({ url: first.url, product: true, productOptions: { extractFrom: 'browserHtml' }, geolocation: 'AU' });
            r.productNeedsBrowser = true;
          }
          const p = pg.data.product;
          r.productPage = pg.status === 200 && priced(p)
            ? `${p.name}: ${p.currency || ''} ${p.price}${p.regularPrice && p.regularPrice !== p.price ? ` (was ${p.regularPrice})` : ''}${p.gtin?.length ? `, barcode ${p.gtin[0].value}` : ''}`
            : `no price on product page (HTTP ${pg.status})`;
          log(`zyte:${id}`, `product page: ${r.productPage}`);
        }
        return r;
      }
      r.problem = r.problem || `only ${list.length} priced products found`;
    }
  }
  return r;
}

/** Verdict line for one store. */
export function verdict(r) {
  if (r.products >= 5 && r.productPage && !/^no price/.test(r.productPage)) return `YES — ${r.products} products from a listing page (${r.mode === 'browserHtml' ? 'needs a browser' : 'plain HTML, cheapest'}), product page OK${r.productNeedsBrowser ? ' (product page needs a browser)' : ''}`;
  if (r.products >= 5) return `PARTLY — listing works (${r.products} products, ${r.mode}), product page: ${r.productPage || 'not tried'}`;
  return `NO — ${r.problem || 'nothing usable'}`;
}

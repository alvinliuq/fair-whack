// Our own readers for stores whose pages Zyte's automatic extraction reads wrongly (checked 27 Nov):
//  - PetO (BigCommerce, plain HTML): Zyte took the "Everyday Price" (the was-price) as the price and missed the sale price.
//  - PETstock (Next.js): listing cards show "Save $X" and the price, no was-price, plus an Autoship price that Zyte
//    took as the price. Product pages carry the price and size in JSON-LD and a "Was $" line.
// Each parser returns { items, next } with items in the shape adaptZyte() reads (name, price, regularPrice, url, …).

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#8211': '–', '#8217': '’' };
export const decode = (s) => String(s || '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (ENT[k] != null) return ENT[k];
  if (k[0] === '#') { const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return m;
}).replace(/\s+/g, ' ').trim();
const money = (s) => { const n = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
const abs = (u, base) => { try { return new URL(decode(u), base).toString(); } catch { return null; } };

// ---------- PetO ----------
export function parsePeto(html, pageUrl) {
  const items = [];
  const cards = String(html).split(/<li class="product">/).slice(1);
  for (const c0 of cards) {
    const c = c0.split(/<\/li>/)[0];
    const t = c.match(/<h4 class="card-title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!t) continue;
    const price = money((c.match(/data-product-price-with-tax[^>]*>\s*([^<]*)</) || [])[1]);
    const was = money((c.match(/data-product-non-sale-price-with-tax[^>]*>\s*([^<]*)</) || [])[1]);
    const img = (c.match(/data-src="([^"]+)"/) || [])[1];
    if (price == null) continue;
    items.push({ name: decode(t[2]), url: abs(t[1], pageUrl), price, regularPrice: was && was > price ? was : null, mainImage: img ? { url: decode(img) } : null });
  }
  const next = (String(html).match(/pagination-item--next">\s*<a[^>]*href="([^"]+)"/) || [])[1];
  return { items, next: next ? abs(next, pageUrl) : null };
}

// ---------- PETstock ----------
const SIZE = /^\d+(\.\d+)?\s?(kg|g|ml|l|pk|pack|cm|m|lt|ltr|x\d+\w*)$/i;
export function parsePetstockList(html, pageUrl) {
  const items = [];
  const h = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '');
  const parts = h.split(/<a[^>]*href="(\/products\/[^"]+)"/);
  const seen = new Set();
  for (let i = 1; i < parts.length; i += 2) {
    const href = parts[i], c = parts[i + 1] || '';
    const url = abs(href, pageUrl);
    const key = url && url.split('?')[0];
    const title = c.match(/data-product-title="true"[^>]*>([\s\S]*?)<\/p>/);
    if (!title || seen.has(key)) continue;
    const name = decode(title[1].replace(/<[^>]+>/g, ''));
    // The card's text pieces in order: brand, name, size chips, "Save $x", price, "Autoship", autoship price, points…
    const tokens = c.replace(/<[^>]+>/g, '\u0001').split('\u0001').map(decode).filter(Boolean);
    const ni = tokens.indexOf(name);
    const brand = ni > 0 && !/\$|black furday|special|off\b/i.test(tokens[ni - 1]) ? tokens[ni - 1] : null;
    const after = tokens.slice(ni + 1);
    const auto = after.findIndex((x) => /^autoship$/i.test(x));
    const priceTokens = (auto >= 0 ? after.slice(0, auto) : after).filter((x) => /^\$\s?\d[\d,]*(\.\d\d)?$/.test(x));
    const price = money(priceTokens[priceTokens.length - 1]);
    if (price == null) continue;
    const save = money((after.slice(0, auto >= 0 ? auto : after.length).find((x) => /^save \$/i.test(x)) || ''));
    const size = after.find((x) => SIZE.test(x)) || null;
    const img = (c.match(/<img[^>]*src="([^"]+)"/) || [])[1];
    let image = img ? abs(img, pageUrl) : null;
    try { const inner = image && new URL(image).searchParams.get('url'); if (inner) image = inner; } catch {}
    seen.add(key);
    items.push({ name, brand: brand ? { name: brand } : null, size, url, price, regularPrice: save ? Math.round((price + save) * 100) / 100 : null, mainImage: image ? { url: image } : null });
  }
  return { items, next: null };
}

/** PETstock product page (plain HTML): JSON-LD price, size and sku; the "Was $" line under "Buy Once". */
export function parsePetstockProduct(html, pageUrl) {
  const h = String(html);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .find((x) => x && x['@type'] === 'Product');
  if (!ld) return { items: [], next: null };
  const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  const price = money(offer?.price);
  const buy = h.indexOf('Buy Once');
  const auto = h.indexOf('Autoship', buy + 1);
  const block = buy >= 0 ? h.slice(buy, auto > buy ? auto : buy + 6000).replace(/<!--[\s\S]*?-->/g, '') : '';
  const was = money((block.match(/Was \$\s*([\d,]+\.\d\d)/) || [])[1]);
  const crumbs = [...h.matchAll(/"@type":"ListItem","position":\d+,"name":"([^"]+)"/g)].map((m) => ({ name: m[1] }));
  return { items: price == null ? [] : [{
    name: decode(ld.name), brand: ld.brand?.name ? { name: ld.brand.name } : null, size: ld.size || null,
    url: pageUrl, price, regularPrice: was && was > price ? was : null,
    mainImage: Array.isArray(ld.image) && ld.image[0] ? { url: ld.image[0] } : null, breadcrumbs: crumbs,
    availability: /OutOfStock/i.test(offer?.availability || '') ? 'OutOfStock' : 'InStock',
  }], next: null };
}

export const PARSERS = { peto: parsePeto, petstock: parsePetstockList, petstockProduct: parsePetstockProduct };

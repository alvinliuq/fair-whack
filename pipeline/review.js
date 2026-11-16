// Decides the "possible matches" queue automatically, by three checks:
//   1. same pack size            (already true for every candidate; re-checked here)
//   2. names more than 90% alike (nameSimilarity below)
//   3. photos highly alike       (image-sim.js: shape and colour)
// A pair is linked only when all three pass and neither product is linked to something else.
// Nothing is rejected here: pairs that do not pass stay in the queue for a person to decide.
import { nameTokens, brandKey } from '../shared/normalize.js';
import { describeAll, compare } from './image-sim.js';
import { REVIEW } from './config.js';

const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
function dice(a, b) {
  if (a === b) return a ? 1 : 0;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

const VARIANT = { yoghurt: 'yogurt', flavoured: 'flavour', flavored: 'flavour', flavor: 'flavour', lite: 'light', sml: 'small', lge: 'large', med: 'medium' };
/** Singular/plural and common spelling variants count as the same word. */
export const stem = (t) => VARIANT[t] || t.replace(/ies$/, 'y').replace(/(ch|sh|x|ss|z|o)es$/, '$1').replace(/([^su])s$/, '$1');

/**
 * 0..1. Brand and size words are left out (they are compared separately) and word order is ignored.
 * The higher of:
 *  - word overlap, where "tomato"/"tomatoes" and "yoghurt"/"yogurt" count as the same word
 *    (scored like matching does: shared words / all words, +0.2 when one name only adds words, capped at 0.95)
 *  - letter-pair overlap of the sorted words, which forgives other small spelling differences
 */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a.name, a.brand), tb = nameTokens(b.name, b.brand);
  const A = new Set(ta.map(stem)), B = new Set(tb.map(stem));
  let words = 0;
  if (A.size && B.size) {
    const inter = [...A].filter((x) => B.has(x)).length;
    words = inter / (A.size + B.size - inter);
    if (words < 1 && (inter === A.size || inter === B.size)) words = Math.min(0.95, words + 0.2);
  }
  const letters = dice([...ta].sort().join(' '), [...tb].sort().join(' '));
  return Math.round(Math.max(words, letters) * 1000) / 1000;
}

export const sameSize = (a, b) => !!a.size_unit && a.size_unit === b.size_unit && a.size_value > 0 && b.size_value > 0
  && Math.abs(a.size_value - b.size_value) / Math.max(a.size_value, b.size_value) <= 0.01;

export const photosAlike = (sim, t = REVIEW) => !!sim && sim.shape >= t.shapeMin && sim.colour >= t.colourMin;

/**
 * rows: [{ id, a, b, sim }] (a, b products with .cluster = Set of retailers already linked to them besides themselves).
 * Returns { approve: [row], reasons: Map id -> reason } keeping every product in at most one new link.
 */
export function decide(rows, t = REVIEW) {
  const reasons = new Map();
  const pass = [];
  for (const r of rows) {
    const name = nameSimilarity(r.a, r.b);
    r.name = name;
    let why = null;
    if (r.a.linkedTo.has(r.b.retailer) || r.b.linkedTo.has(r.a.retailer)) why = 'already linked to another product';
    else if (!sameSize(r.a, r.b)) why = 'size differs';
    else if (brandKey(r.a.brand) !== brandKey(r.b.brand)) why = 'brand differs';
    else if (name <= t.nameMin) why = 'name not alike enough';
    else if (!r.sim) why = 'photo missing';
    else if (!photosAlike(r.sim, t)) why = 'photos differ';
    if (why) reasons.set(r.id, why); else pass.push(r);
  }
  // One new partner per product: best pairs first.
  pass.sort((x, y) => (y.name + y.sim.shape + y.sim.colour) - (x.name + x.sim.shape + x.sim.colour));
  const used = new Set(), approve = [];
  for (const r of pass) {
    if (used.has(r.a.id) || used.has(r.b.id)) { reasons.set(r.id, 'a better pair uses one of these products'); continue; }
    used.add(r.a.id); used.add(r.b.id); approve.push(r);
  }
  return { approve, reasons };
}

const COLS = 'id, retailer, name, brand, size_value, size_unit, size_text, image_url, canonical_product_id, match_method';

export async function runReview(db, { apply = false, log = console.log } = {}) {
  const cands = await db.all("SELECT id, product_a, product_b, score FROM match_candidate WHERE status = 'pending' ORDER BY id");
  const ids = [...new Set(cands.flatMap((c) => [c.product_a, c.product_b]))];
  const products = new Map((await db.allIn(`SELECT ${COLS} FROM retailer_product WHERE id IN (:ids)`, ids)).map((p) => [p.id, p]));
  // Which stores each product is already linked to (through its canonical product).
  const canons = [...new Set([...products.values()].map((p) => p.canonical_product_id).filter(Boolean))];
  const members = await db.allIn('SELECT id, retailer, canonical_product_id FROM retailer_product WHERE canonical_product_id IN (:ids)', canons);
  const byCanon = new Map();
  for (const m of members) { if (!byCanon.has(m.canonical_product_id)) byCanon.set(m.canonical_product_id, []); byCanon.get(m.canonical_product_id).push(m); }
  for (const p of products.values()) p.linkedTo = new Set((byCanon.get(p.canonical_product_id) || []).filter((m) => m.id !== p.id).map((m) => m.retailer));

  // Calibration: pairs matching already linked (alike) and same-brand products linked elsewhere (different).
  const cal = await calibrationPairs(db);
  const urls = [...products.values()].map((p) => p.image_url).concat(cal.flatMap((c) => [c.a.image_url, c.b.image_url]));
  log(`review: ${cands.length} pending pairs, ${ids.length} products, ${new Set(urls.filter(Boolean)).size} photos to fetch`);
  const photos = await describeAll(urls, { onProgress: (n, total) => log(`  photos ${n}/${total}`) });
  const failed = [...photos.entries()].filter(([, d]) => !d).map(([u]) => { try { return new URL(u).host; } catch { return '?'; } });
  const byHost = {}; for (const h of failed) byHost[h] = (byHost[h] || 0) + 1;
  log(`review: ${photos.size - failed.length} photos read, ${failed.length} failed ${JSON.stringify(byHost)}`);
  const simOf = (a, b) => { const x = photos.get(a.image_url), y = photos.get(b.image_url); return x && y ? compare(x, y) : null; };

  for (const c of cal) { const s = simOf(c.a, c.b); if (s) log(`CAL\t${c.kind}\t${s.shape}\t${s.colour}\t${c.a.name} | ${c.b.name}`); }

  const rows = cands.filter((c) => products.has(c.product_a) && products.has(c.product_b))
    .map((c) => ({ id: c.id, score: c.score, a: products.get(c.product_a), b: products.get(c.product_b) }));
  for (const r of rows) r.sim = simOf(r.a, r.b);
  const { approve, reasons } = decide(rows);
  for (const r of rows) {
    log(`CAND\t${reasons.get(r.id) || 'LINK'}\t${r.score}\t${r.name}\t${r.sim ? r.sim.shape : ''}\t${r.sim ? r.sim.colour : ''}\t${r.a.name} [${r.a.size_text || ''}] | ${r.b.name} [${r.b.size_text || ''}]`);
  }
  const tally = {}; for (const why of reasons.values()) tally[why] = (tally[why] || 0) + 1;
  log(`review: ${approve.length} pairs pass all three checks; left in the queue: ${JSON.stringify(tally)}`);
  if (apply && approve.length) {
    for (let i = 0; i < approve.length; i += 200) {
      await db.exec(`UPDATE match_candidate SET status = 'approved', decided_by = 'auto-review' WHERE status = 'pending' AND id IN (${approve.slice(i, i + 200).map((r) => Number(r.id)).join(',')})`);
    }
    log(`review: ${approve.length} pairs marked as the same product`);
  } else if (!apply) log('review: dry run, nothing changed (add --apply to link the passing pairs)');
  return { pending: cands.length, approved: approve.length, applied: apply, left: tally };
}

/** Up to ~300 known-alike and ~300 known-different pairs with photos, for checking the photo thresholds. */
async function calibrationPairs(db, each = 300) {
  const rows = await db.all(`SELECT ${COLS} FROM retailer_product WHERE match_method IN ('gtin', 'rule') AND image_url IS NOT NULL AND retailer IN ('woolworths', 'coles') ORDER BY canonical_product_id LIMIT 6000`);
  const groups = new Map();
  for (const p of rows) { if (!groups.has(p.canonical_product_id)) groups.set(p.canonical_product_id, []); groups.get(p.canonical_product_id).push(p); }
  const linked = [];
  for (const g of groups.values()) {
    const w = g.find((p) => p.retailer === 'woolworths'), c = g.find((p) => p.retailer === 'coles');
    if (w && c) linked.push({ w, c });
  }
  const step = Math.max(1, Math.floor(linked.length / each));
  const alike = linked.filter((_, i) => i % step === 0).slice(0, each).map(({ w, c }) => ({ kind: 'alike', a: w, b: c }));
  // Different: a Woolworths product against the Coles twin of another product of the same brand.
  const byBrand = new Map();
  for (const l of linked) { const k = brandKey(l.w.brand); if (!k) continue; if (!byBrand.has(k)) byBrand.set(k, []); byBrand.get(k).push(l); }
  const different = [];
  for (const list of byBrand.values()) {
    for (let i = 0; i + 1 < list.length && different.length < each; i += 2) different.push({ kind: 'different', a: list[i].w, b: list[i + 1].c });
  }
  return [...alike, ...different];
}

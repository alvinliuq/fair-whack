// Decides the "possible matches" queue automatically, by three checks:
//   1. same pack size            (already true for every candidate; re-checked here)
//   2. names more than 90% alike (nameSimilarity below)
//   3. photos highly alike       (image-sim.js: shape and colour)
// or, when the two photos are almost identical, names at least 60% alike (REVIEW.near in config.js).
// A pair is linked only when all three pass (and the names do not carry different numbers).
// Nothing is rejected here: pairs that do not pass stay in the queue for a person to decide.
import { nameTokens, brandKey, numbersConflict } from '../shared/normalize.js';
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
    else if (numbersConflict(r.a, r.b)) why = 'numbers in the names differ';
    else if (t.near ? name < t.near.nameMin : name <= t.nameMin) why = 'name not alike enough';
    else if (!r.sim) why = 'photo missing';
    else {
      r.strict = name > t.nameMin && photosAlike(r.sim, t);
      const near = !!t.near && r.sim.shape >= t.near.shapeMin && r.sim.colour >= t.near.colourMin;
      if (!r.strict && !near) why = name > t.nameMin ? 'photos differ' : 'name under 90% and photos not near-identical';
    }
    if (why) reasons.set(r.id, why); else pass.push(r);
  }
  // One new partner per product: pairs passing the strict rule first, then the best of the rest.
  pass.sort((x, y) => (y.strict - x.strict) || (y.name + y.sim.shape + y.sim.colour) - (x.name + x.sim.shape + x.sim.colour));
  const used = new Set(), approve = [];
  for (const r of pass) {
    if (used.has(r.a.id) || used.has(r.b.id)) { reasons.set(r.id, 'a better pair uses one of these products'); continue; }
    used.add(r.a.id); used.add(r.b.id); approve.push(r);
  }
  return { approve, reasons };
}

/**
 * plan: result of planMatching() (products, the candidate queue and the clusters after matching).
 * Photos are fetched only for pairs that pass every other check, unless allPhotos is set.
 */
export async function runReview(db, plan, { apply = false, allPhotos = false, log = console.log } = {}) {
  const byId = new Map(plan.products.map((p) => [p.id, p]));
  // Stores each product is linked to after matching (its own store included).
  const stores = new Map();
  for (const p of plan.products) { const c = plan.canonOf.get(p.id); if (!stores.has(c)) stores.set(c, new Set()); stores.get(c).add(p.retailer); }
  const rows = plan.candidates.filter((c) => byId.has(c.product_a) && byId.has(c.product_b)).map((c) => {
    const a = { ...byId.get(c.product_a) }, b = { ...byId.get(c.product_b) };
    a.linkedTo = new Set([...stores.get(plan.canonOf.get(a.id))].filter((r) => r !== a.retailer));
    b.linkedTo = new Set([...stores.get(plan.canonOf.get(b.id))].filter((r) => r !== b.retailer));
    return { id: `${a.id}|${b.id}`, score: c.score, a, b, sim: null };
  });
  // First pass without photos shows which pairs are worth fetching photos for.
  const first = decide(rows.map((r) => ({ ...r })));
  const need = rows.filter((r) => allPhotos || first.reasons.get(r.id) === 'photo missing');
  const urls = need.flatMap((r) => [r.a.image_url, r.b.image_url]);
  log(`review: ${rows.length} pairs in the queue, ${need.length} need their photos compared; fetching ${new Set(urls.filter(Boolean)).size} photos`);
  const photos = await describeAll(urls, { onProgress: (n, total) => log(`  photos ${n}/${total}`) });
  const failed = [...photos.values()].filter((d) => !d).length;
  if (failed) log(`review: ${failed} photos could not be read`);
  for (const r of need) { const x = photos.get(r.a.image_url), y = photos.get(r.b.image_url); r.sim = x && y ? compare(x, y) : null; }

  const { approve, reasons } = decide(rows);
  for (const r of rows) {
    if (!allPhotos && !need.includes(r)) continue; // keep the log to the pairs that were actually looked at
    log(`CAND\t${reasons.get(r.id) || (r.strict ? 'LINK' : 'LINK-PHOTO')}\t${r.score}\t${r.name}\t${r.sim ? r.sim.shape : ''}\t${r.sim ? r.sim.colour : ''}\t${r.a.name} [${r.a.size_text || ''}] | ${r.b.name} [${r.b.size_text || ''}]`);
  }
  const tally = {}; for (const why of reasons.values()) tally[why] = (tally[why] || 0) + 1;
  log(`review: ${approve.length} pairs pass (${approve.filter((r) => r.strict).length} by name over 90%, ${approve.filter((r) => !r.strict).length} by near-identical photo); left for a person: ${JSON.stringify(tally)}`);
  if (apply && approve.length) {
    for (const r of approve) {
      await db.run("UPDATE match_candidate SET status = 'approved', decided_by = 'auto-review' WHERE status = 'pending' AND product_a = ? AND product_b = ?", [r.a.id, r.b.id]);
    }
    log(`review: ${approve.length} pairs marked as the same product`);
  }
  return { queue: rows.length, approved: approve.length, applied: apply, left: tally };
}

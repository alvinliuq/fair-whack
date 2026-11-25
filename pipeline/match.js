// Cross-retailer matching (spec section 6.5).
//  1. Same GTIN -> same canonical product.
//  2. Same brand + same size + similar name -> auto link (score >= MATCH.autoAccept)
//     or a review candidate (score between reviewFloor and autoAccept). Best-scoring pairs are linked
//     first, and a product gets at most one partner per store, so an exact twin always beats a near one.
//  3. Everything else is its own canonical product.
// Manual decisions (match_method = 'manual') and rejected pairs are never overridden.
import { nameTokens, brandKey, jaccard, mapCategory, splitCategory, numbersConflict } from '../shared/normalize.js';
import { MATCH } from './config.js';
import { syncWordIndex } from './search-index.js';

export function scorePair(a, b) {
  if (a.retailer === b.retailer) return 0;
  if (!a.size_unit || a.size_unit !== b.size_unit || !a.size_value || !b.size_value) return 0;
  if (Math.abs(a.size_value - b.size_value) / Math.max(a.size_value, b.size_value) > 0.01) return 0;
  const ba = brandKey(a.brand), bb = brandKey(b.brand);
  if (ba !== bb) return 0; // both blank is allowed (fresh produce), scored on name alone
  if (numbersConflict(a, b)) return 0; // "85% Cocoa" is not "90% Cocoa", "Size 4" is not "Size 5"
  const ta = nameTokens(a.name, a.brand), tb = nameTokens(b.name, b.brand);
  let s = jaccard(ta, tb);
  // Identical token sets score 1; tiny bonus when one is a subset of the other (word-order / filler differences).
  const A = new Set(ta), B = new Set(tb);
  const subset = [...A].every((x) => B.has(x)) || [...B].every((x) => A.has(x));
  if (subset && s < 1) s = Math.min(0.95, s + 0.2);
  return Math.round(s * 1000) / 1000;
}

export function computeMatches(products, rejectedPairs = new Set(), approvedPairs = []) {
  const byId = new Map(products.map((p) => [p.id, { ...p }]));
  // Union-find over product ids.
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const rset = new Map(); // root -> Set of retailers in that cluster
  const clusterOf = new Map(); // root -> product ids in that cluster
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const [keepR, dropR] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(dropR, keepR);
    for (const r of rset.get(dropR)) rset.get(keepR).add(r);
    clusterOf.get(keepR).push(...clusterOf.get(dropR));
  };
  // A pair someone marked "Different" never ends up together, not even through a third product.
  const rejectedOf = new Map();
  for (const k of rejectedPairs) {
    const [a, b] = k.split('|');
    for (const [x, y] of [[a, b], [b, a]]) { if (!rejectedOf.has(x)) rejectedOf.set(x, new Set()); rejectedOf.get(x).add(y); }
  }
  const splitByPerson = (x, y) => {
    if (!rejectedOf.size) return false;
    const rx = find(x), ry = find(y);
    if (rx === ry) return false;
    const other = new Set(clusterOf.get(ry));
    return clusterOf.get(rx).some((id) => [...(rejectedOf.get(id) || [])].some((r) => other.has(r)));
  };
  for (const [id, p] of byId) { parent.set(id, id); rset.set(id, new Set([p.retailer])); clusterOf.set(id, [id]); }
  const method = new Map(); // id -> {method, conf}

  // Manual links already in the DB: keep products that share a manual canonical id together.
  const manualGroups = new Map();
  for (const p of byId.values()) {
    if (p.match_method === 'manual' && p.canonical_product_id) {
      if (!manualGroups.has(p.canonical_product_id)) manualGroups.set(p.canonical_product_id, []);
      manualGroups.get(p.canonical_product_id).push(p.id);
    }
  }
  for (const ids of manualGroups.values()) for (const id of ids.slice(1)) union(ids[0], id);
  for (const [a, b] of approvedPairs) if (byId.has(a) && byId.has(b)) { union(a, b); method.set(a, { m: 'manual', c: 1 }); method.set(b, { m: 'manual', c: 1 }); }

  // 1. GTIN
  const byGtin = new Map();
  for (const p of byId.values()) if (p.gtin && p.gtin.length >= 8) {
    if (!byGtin.has(p.gtin)) byGtin.set(p.gtin, []);
    byGtin.get(p.gtin).push(p.id);
  }
  for (const ids of byGtin.values()) if (ids.length > 1) {
    for (const id of ids.slice(1)) union(ids[0], id);
    for (const id of ids) if (!method.has(id)) method.set(id, { m: 'gtin', c: 1 });
  }

  // 2. Rules, blocked by brand + unit + rounded size.
  const blocks = new Map();
  for (const p of byId.values()) {
    const b = brandKey(p.brand) || '-';
    if (!p.size_unit || !p.size_value) continue;
    const key = `${b}|${p.size_unit}|${Math.round(p.size_value)}`;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(p);
  }
  // Score every cross-store pair in a block, then link from the best score down. Linking in whatever
  // order the products happened to load let "Dairy Milk" pair with "Dairy Milk Snack" (0.95) before its
  // exact twin (1.0) was looked at, which then could not be linked.
  const scored = [];
  for (const group of blocks.values()) {
    if (group.length < 2 || group.length > 200) continue;
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a.retailer === b.retailer) continue;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      if (rejectedPairs.has(`${x.id}|${y.id}`)) continue;
      const s = scorePair(x, y);
      if (s >= MATCH.reviewFloor) scored.push({ x, y, s });
    }
  }
  scored.sort((p, q) => q.s - p.s || (p.x.id < q.x.id ? -1 : p.x.id > q.x.id ? 1 : p.y.id < q.y.id ? -1 : 1));
  // True when linking x and y would put two products of one store in the same cluster.
  const clash = (x, y) => {
    const rx = find(x.id), ry = find(y.id);
    return rx !== ry && [...rset.get(ry)].some((r) => rset.get(rx).has(r));
  };
  for (const { x, y, s } of scored) {
    if (s < MATCH.autoAccept || clash(x, y) || splitByPerson(x.id, y.id)) continue;
    union(x.id, y.id);
    for (const id of [x.id, y.id]) if (!method.has(id) || method.get(id).c < s) method.set(id, { m: 'rule', c: s });
  }
  // Review candidates: unlinked pairs where neither product already has a partner in the other's store.
  // (A product that has its twin does not need a person to look at its near misses.)
  const candidates = [];
  for (const { x, y, s } of scored) {
    if (find(x.id) === find(y.id) || clash(x, y) || splitByPerson(x.id, y.id)) continue;
    candidates.push({ product_a: x.id, product_b: y.id, score: s });
  }

  // Build assignments. Canonical id = "c:" + smallest member id (stable).
  const members = new Map();
  for (const id of byId.keys()) {
    const r = find(id);
    if (!members.has(r)) members.set(r, []);
    members.get(r).push(id);
  }
  const assignments = [];
  const canonOf = new Map(); // every product id -> its canonical id after this run
  for (const ids of members.values()) {
    ids.sort();
    const manualCanon = ids.map((id) => byId.get(id)).find((p) => p.match_method === 'manual' && p.canonical_product_id)?.canonical_product_id;
    const canon = manualCanon || `c:${ids[0]}`;
    for (const id of ids) {
      canonOf.set(id, canon);
      const p = byId.get(id);
      const m = p.match_method === 'manual' ? { m: 'manual', c: 1 } : ids.length === 1 ? { m: 'self', c: 1 } : method.get(id) || { m: 'rule', c: 0.9 };
      if (p.canonical_product_id !== canon || p.match_method !== m.m) {
        assignments.push({ id, canonical_product_id: canon, match_method: m.m, match_confidence: m.c });
      }
    }
  }
  return { assignments, candidates, clusters: members.size, canonOf };
}

/** Read everything matching needs and work out the result, without changing the database. */
export async function planMatching(db) {
  // Page by id so each product is read once (OFFSET re-reads every earlier row on each page).
  const products = [];
  for (let last = ''; ;) {
    const page = await db.all(
      `SELECT id, retailer, name, brand, size_value, size_unit, size_text, image_url, gtin, canonical_product_id, match_method,
              family_id, comparable_group_id, category, category_path, cat1, cat2
         FROM retailer_product WHERE id > ? ORDER BY id LIMIT 5000`, [last]);
    products.push(...page);
    if (page.length < 5000) break;
    last = page[page.length - 1].id;
  }
  const rows = await db.all('SELECT id, product_a, product_b, status FROM match_candidate');
  const rejected = new Set(rows.filter((d) => d.status === 'rejected').map((d) => `${d.product_a}|${d.product_b}`));
  const approved = rows.filter((d) => d.status === 'approved').map((d) => [d.product_a, d.product_b]);
  const pending = rows.filter((d) => d.status === 'pending');
  return { products, pending, ...computeMatches(products, rejected, approved) };
}

/** Which products gain, lose or change their partner in the other store under a plan. */
export function linkChanges(plan) {
  const group = (canonOfId) => {
    const m = new Map();
    for (const p of plan.products) { const c = canonOfId(p); if (!c) continue; if (!m.has(c)) m.set(c, []); m.get(c).push(p); }
    return m;
  };
  const before = group((p) => p.canonical_product_id), after = group((p) => plan.canonOf.get(p.id));
  const partners = (g, p, c) => (g.get(c) || []).filter((o) => o.retailer !== p.retailer).map((o) => o.id).sort().join(',');
  const out = { gained: [], lost: [], changed: [], linkedBefore: 0, linkedAfter: 0 };
  const byId = new Map(plan.products.map((p) => [p.id, p]));
  for (const p of plan.products) {
    if (p.retailer !== 'woolworths') continue; // count each link once, from the Woolworths side
    const b = partners(before, p, p.canonical_product_id), a = partners(after, p, plan.canonOf.get(p.id));
    if (b) out.linkedBefore++;
    if (a) out.linkedAfter++;
    if (a === b) continue;
    const names = (ids) => ids.split(',').filter(Boolean).map((id) => byId.get(id)?.name).join(' + ');
    (b && a ? out.changed : a ? out.gained : out.lost).push(`${p.name}  |  was: ${names(b) || '-'}  |  now: ${names(a) || '-'}`);
  }
  return out;
}

export async function runMatching(db, plan = null) {
  plan ||= await planMatching(db);
  const { products, assignments, candidates, clusters } = plan;

  if (assignments.length) {
    await db.exec('CREATE TABLE IF NOT EXISTS _match_tmp (id TEXT PRIMARY KEY, canonical_product_id TEXT, match_method TEXT, match_confidence REAL)');
    await db.exec('DELETE FROM _match_tmp');
    await db.insertRows('_match_tmp', ['id', 'canonical_product_id', 'match_method', 'match_confidence'], assignments);
    await db.exec(`UPDATE retailer_product SET
        canonical_product_id = (SELECT canonical_product_id FROM _match_tmp t WHERE t.id = retailer_product.id),
        match_method = (SELECT match_method FROM _match_tmp t WHERE t.id = retailer_product.id),
        match_confidence = (SELECT match_confidence FROM _match_tmp t WHERE t.id = retailer_product.id)
      WHERE id IN (SELECT id FROM _match_tmp)`);
    await db.exec('DELETE FROM _match_tmp');
  }
  // The review queue is exactly the current candidates: drop pending pairs that are now linked,
  // or where one product has found its partner. Nothing a person decided is touched.
  const wanted = new Set(candidates.map((c) => `${c.product_a}|${c.product_b}`));
  const stale = plan.pending.filter((d) => !wanted.has(`${d.product_a}|${d.product_b}`)).map((d) => Number(d.id));
  for (let i = 0; i < stale.length; i += 300) {
    await db.exec(`DELETE FROM match_candidate WHERE status = 'pending' AND id IN (${stale.slice(i, i + 300).join(',')})`);
  }
  if (candidates.length) {
    const now = new Date().toISOString();
    await db.insertRows('match_candidate', ['product_a', 'product_b', 'score', 'status', 'created_at'],
      candidates.map((c) => ({ ...c, status: 'pending', created_at: now })),
      'ON CONFLICT(product_a, product_b) DO NOTHING');
  }
  // Re-apply category rules (merged category + the store's own levels) where they changed.
  const recat = [];
  for (const p of products) {
    const c = mapCategory(p.category_path, p.name, p.retailer);
    const { cat1, cat2 } = splitCategory(p.category_path);
    if (c !== p.category || cat1 !== p.cat1 || (cat2 || null) !== (p.cat2 || null)) recat.push({ id: p.id, category: c, cat1, cat2 });
  }
  if (recat.length) {
    await db.exec('CREATE TABLE IF NOT EXISTS _cat_tmp (id TEXT PRIMARY KEY, category TEXT, cat1 TEXT, cat2 TEXT)');
    await db.exec('DELETE FROM _cat_tmp');
    await db.insertRows('_cat_tmp', ['id', 'category', 'cat1', 'cat2'], recat);
    await db.exec(`UPDATE retailer_product SET
        category = (SELECT category FROM _cat_tmp t WHERE t.id = retailer_product.id),
        cat1 = (SELECT cat1 FROM _cat_tmp t WHERE t.id = retailer_product.id),
        cat2 = (SELECT cat2 FROM _cat_tmp t WHERE t.id = retailer_product.id)
      WHERE id IN (SELECT id FROM _cat_tmp)`);
    await db.exec('DELETE FROM _cat_tmp');
  }
  // Refresh canonical_product (one row per cluster) for reporting.
  await db.exec(`DELETE FROM canonical_product`);
  await db.exec(`INSERT INTO canonical_product (id, gtin, display_name, brand, size_value, size_unit, family_id, comparable_group_id, category)
    SELECT canonical_product_id, MAX(gtin), MIN(name), MIN(brand), MIN(size_value), MIN(size_unit), MIN(family_id), MIN(comparable_group_id), MIN(category)
      FROM retailer_product WHERE canonical_product_id IS NOT NULL GROUP BY canonical_product_id`);
  // Search index: matching already has every product in memory, so refresh it here.
  // A failure here must not fail the run: search falls back to scanning until the next run.
  const index = await syncWordIndex(db, products).catch((e) => ({ error: e.message }));
  return { changed: assignments.length, candidates: candidates.length, removedFromQueue: stale.length, clusters, recategorised: recat.length, index };
}

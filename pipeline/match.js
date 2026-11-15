// Cross-retailer matching (spec section 6.5).
//  1. Same GTIN -> same canonical product.
//  2. Same brand + same size + similar name -> auto link (score >= MATCH.autoAccept)
//     or a review candidate (score between reviewFloor and autoAccept).
//  3. Everything else is its own canonical product.
// Manual decisions (match_method = 'manual') and rejected pairs are never overridden.
import { nameTokens, brandKey, jaccard, mapCategory, splitCategory } from '../shared/normalize.js';
import { MATCH } from './config.js';

export function scorePair(a, b) {
  if (a.retailer === b.retailer) return 0;
  if (!a.size_unit || a.size_unit !== b.size_unit || !a.size_value || !b.size_value) return 0;
  if (Math.abs(a.size_value - b.size_value) / Math.max(a.size_value, b.size_value) > 0.01) return 0;
  const ba = brandKey(a.brand), bb = brandKey(b.brand);
  if (ba !== bb) return 0; // both blank is allowed (fresh produce), scored on name alone
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
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra === rb) return;
    const [keepR, dropR] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(dropR, keepR);
    for (const r of rset.get(dropR)) rset.get(keepR).add(r);
  };
  for (const [id, p] of byId) { parent.set(id, id); rset.set(id, new Set([p.retailer])); }
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
  const candidates = [];
  for (const group of blocks.values()) {
    if (group.length < 2 || group.length > 200) continue;
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a.retailer === b.retailer) continue;
      const [x, y] = a.id < b.id ? [a, b] : [b, a];
      if (rejectedPairs.has(`${x.id}|${y.id}`)) continue;
      const s = scorePair(x, y);
      if (s >= MATCH.autoAccept) {
        // Do not merge two products from the same retailer through a chain.
        const rx = find(x.id), ry = find(y.id);
        const clash = rx !== ry && [...rset.get(ry)].some((r) => rset.get(rx).has(r));
        if (clash) { candidates.push({ product_a: x.id, product_b: y.id, score: s }); continue; }
        union(x.id, y.id);
        for (const id of [x.id, y.id]) if (!method.has(id) || method.get(id).c < s) method.set(id, { m: 'rule', c: s });
      } else if (s >= MATCH.reviewFloor) {
        candidates.push({ product_a: x.id, product_b: y.id, score: s });
      }
    }
  }

  // Build assignments. Canonical id = "c:" + smallest member id (stable).
  const members = new Map();
  for (const id of byId.keys()) {
    const r = find(id);
    if (!members.has(r)) members.set(r, []);
    members.get(r).push(id);
  }
  const assignments = [];
  for (const ids of members.values()) {
    ids.sort();
    const manualCanon = ids.map((id) => byId.get(id)).find((p) => p.match_method === 'manual' && p.canonical_product_id)?.canonical_product_id;
    const canon = manualCanon || `c:${ids[0]}`;
    for (const id of ids) {
      const p = byId.get(id);
      const m = p.match_method === 'manual' ? { m: 'manual', c: 1 } : ids.length === 1 ? { m: 'self', c: 1 } : method.get(id) || { m: 'rule', c: 0.9 };
      if (p.canonical_product_id !== canon || p.match_method !== m.m) {
        assignments.push({ id, canonical_product_id: canon, match_method: m.m, match_confidence: m.c });
      }
    }
  }
  return { assignments, candidates, clusters: members.size };
}

export async function runMatching(db) {
  const products = [];
  for (let offset = 0; ; offset += 5000) {
    const page = await db.all(
      `SELECT id, retailer, name, brand, size_value, size_unit, gtin, canonical_product_id, match_method,
              family_id, comparable_group_id, category, category_path, cat1, cat2
         FROM retailer_product ORDER BY id LIMIT 5000 OFFSET ${offset}`);
    products.push(...page);
    if (page.length < 5000) break;
  }
  const decided = await db.all("SELECT product_a, product_b, status FROM match_candidate WHERE status IN ('approved','rejected')");
  const rejected = new Set(decided.filter((d) => d.status === 'rejected').map((d) => `${d.product_a}|${d.product_b}`));
  const approved = decided.filter((d) => d.status === 'approved').map((d) => [d.product_a, d.product_b]);
  const { assignments, candidates, clusters } = computeMatches(products, rejected, approved);

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
  if (candidates.length) {
    const now = new Date().toISOString();
    await db.insertRows('match_candidate', ['product_a', 'product_b', 'score', 'status', 'created_at'],
      candidates.map((c) => ({ ...c, status: 'pending', created_at: now })),
      'ON CONFLICT(product_a, product_b) DO NOTHING');
  }
  // Re-apply category rules (merged category + the store's own levels) where they changed.
  const recat = [];
  for (const p of products) {
    const c = mapCategory(p.category_path, p.name);
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
  return { changed: assignments.length, candidates: candidates.length, clusters, recategorised: recat.length };
}

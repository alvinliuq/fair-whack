// Write normalised scraper items into D1 and recompute discount flags.
import { normaliseScraped, discountFlag } from '../shared/normalize.js';
import { LIMITS } from './config.js';

const PRODUCT_COLS = [
  'id', 'retailer', 'retailer_product_id', 'name', 'brand', 'size_text', 'size_value', 'size_unit',
  'pack_count', 'uses_per_pack', 'gtin', 'category_path', 'category', 'image_url', 'product_url',
  'family_id', 'comparable_group_id',
  'cur_price_cents', 'cur_was_cents', 'cur_unit_cents', 'cur_unit_basis', 'cur_retailer_unit_text',
  'cur_is_special', 'cur_promo_type', 'cur_promo_text', 'cur_multibuy_qty', 'cur_multibuy_cents',
  'cur_in_stock', 'cur_source', 'cur_captured_at', 'special_since', 'first_seen_at', 'last_seen_at',
];

// Static fields refresh from the newest data; existing values are kept when the new one is empty.
const keep = (c) => `${c} = COALESCE(excluded.${c}, retailer_product.${c})`;
const CONFLICT = `ON CONFLICT(id) DO UPDATE SET
  name = excluded.name,
  ${['brand', 'size_text', 'size_value', 'size_unit', 'pack_count', 'uses_per_pack', 'gtin', 'category_path', 'image_url', 'product_url'].map(keep).join(',\n  ')},
  category = excluded.category,
  family_id = excluded.family_id,
  comparable_group_id = excluded.comparable_group_id,
  cur_price_cents = excluded.cur_price_cents,
  cur_was_cents = excluded.cur_was_cents,
  cur_unit_cents = excluded.cur_unit_cents,
  cur_unit_basis = excluded.cur_unit_basis,
  cur_retailer_unit_text = excluded.cur_retailer_unit_text,
  cur_is_special = excluded.cur_is_special,
  cur_promo_type = excluded.cur_promo_type,
  cur_promo_text = excluded.cur_promo_text,
  cur_multibuy_qty = excluded.cur_multibuy_qty,
  cur_multibuy_cents = excluded.cur_multibuy_cents,
  cur_in_stock = excluded.cur_in_stock,
  cur_source = excluded.cur_source,
  cur_captured_at = excluded.cur_captured_at,
  special_since = CASE
    WHEN excluded.cur_is_special = 1 AND retailer_product.cur_is_special = 1
         AND COALESCE(retailer_product.cur_promo_type, '') = COALESCE(excluded.cur_promo_type, '')
      THEN COALESCE(retailer_product.special_since, excluded.special_since)
    WHEN excluded.cur_is_special = 1 THEN excluded.special_since
    ELSE NULL END,
  last_seen_at = excluded.last_seen_at
WHERE excluded.cur_captured_at >= COALESCE(retailer_product.cur_captured_at, '')`;

const SNAP_COLS = [
  'product_id', 'price_cents', 'was_cents', 'unit_cents', 'unit_basis', 'is_special', 'promo_type', 'promo_text',
  'multibuy_qty', 'multibuy_cents', 'in_stock', 'price_context', 'source', 'reported_by', 'evidence_url', 'captured_at',
];

/** Normalise raw items; drop errors, duplicates and excluded categories. */
export function prepare(retailer, items, capturedAt) {
  const byId = new Map();
  let errors = 0, excluded = 0;
  for (const it of items) {
    const rec = normaliseScraped(retailer, it, capturedAt);
    if (!rec) { errors++; continue; }
    if (rec.snapshot.price_cents == null) { errors++; continue; }
    if (LIMITS.excludeCategories.includes(rec.product.category)) { excluded++; continue; }
    byId.set(rec.product.id, rec); // last one wins
  }
  return { records: [...byId.values()], errors, excluded };
}

export async function writeRecords(db, records) {
  if (!records.length) return 0;
  const rows = records.map(({ product: p, snapshot: s }) => ({
    ...p,
    cur_price_cents: s.price_cents,
    cur_was_cents: s.was_cents,
    cur_unit_cents: s.unit_cents,
    cur_unit_basis: s.unit_basis,
    cur_retailer_unit_text: s.retailer_unit_text,
    cur_is_special: s.is_special,
    cur_promo_type: s.promo_type,
    cur_promo_text: s.promo_text,
    cur_multibuy_qty: s.multibuy_qty,
    cur_multibuy_cents: s.multibuy_cents,
    cur_in_stock: s.in_stock,
    cur_source: s.source,
    cur_captured_at: s.captured_at,
    special_since: s.is_special ? s.captured_at : null,
    first_seen_at: s.captured_at,
    last_seen_at: s.captured_at,
  }));
  await db.insertRows('retailer_product', PRODUCT_COLS, rows, CONFLICT);
  await db.insertRows('price_snapshot', SNAP_COLS, records.map(({ product, snapshot }) => ({ ...snapshot, product_id: product.id })));
  return rows.length;
}

/** Recompute 12-week low / median / discount flag / anomaly flag for the given products. */
export async function updateFlags(db, productIds) {
  if (!productIds.length) return 0;
  const since = new Date(Date.now() - 84 * 86400000).toISOString();
  const cur = await db.allIn(
    'SELECT id, cur_price_cents, cur_was_cents, cur_captured_at FROM retailer_product WHERE id IN (:ids)', productIds);
  const hist = await db.allIn(
    'SELECT product_id, price_cents, captured_at FROM price_snapshot WHERE product_id IN (:ids) AND captured_at >= ?',
    productIds, [since]);
  const byProduct = new Map();
  for (const h of hist) {
    if (!byProduct.has(h.product_id)) byProduct.set(h.product_id, []);
    byProduct.get(h.product_id).push(h);
  }
  const updates = [];
  for (const c of cur) {
    const history = (byProduct.get(c.id) || []).filter((h) => h.captured_at < c.cur_captured_at);
    const { flag, weeks, low, med } = discountFlag({ price_cents: c.cur_price_cents, was_cents: c.cur_was_cents }, history);
    // Anomaly: price moved more than 70% vs the median; kept visible but marked for admin review.
    const anomaly = med && c.cur_price_cents && (c.cur_price_cents < med * 0.3 || c.cur_price_cents > med * 3) ? 'anomaly' : null;
    updates.push({ id: c.id, low12_cents: low, median12_cents: med, history_weeks: weeks, discount_flag: flag, price_flag: anomaly });
  }
  // Upsert-only-these-columns trick: insert into a temp table then update from it.
  await db.exec('CREATE TABLE IF NOT EXISTS _flag_tmp (id TEXT PRIMARY KEY, low12_cents INTEGER, median12_cents INTEGER, history_weeks INTEGER, discount_flag TEXT, price_flag TEXT)');
  await db.exec('DELETE FROM _flag_tmp');
  await db.insertRows('_flag_tmp', ['id', 'low12_cents', 'median12_cents', 'history_weeks', 'discount_flag', 'price_flag'], updates);
  await db.exec(`UPDATE retailer_product SET
      low12_cents = (SELECT low12_cents FROM _flag_tmp t WHERE t.id = retailer_product.id),
      median12_cents = (SELECT median12_cents FROM _flag_tmp t WHERE t.id = retailer_product.id),
      history_weeks = (SELECT history_weeks FROM _flag_tmp t WHERE t.id = retailer_product.id),
      discount_flag = (SELECT discount_flag FROM _flag_tmp t WHERE t.id = retailer_product.id),
      price_flag = (SELECT price_flag FROM _flag_tmp t WHERE t.id = retailer_product.id)
    WHERE id IN (SELECT id FROM _flag_tmp)`);
  await db.exec('DELETE FROM _flag_tmp');
  return updates.length;
}

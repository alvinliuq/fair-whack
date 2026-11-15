// Wishlist alerts (spec section 7): one merged push per user per day,
// dedupe by product + promotion start, only fresh prices (seen in the last 8 days).
import { ALERTS } from './config.js';

const RETAILER_NAME = { woolworths: 'Woolworths', coles: 'Coles', aldi: 'ALDI', costco: 'Costco' };
const money = (c) => `$${(c / 100).toFixed(2)}`;

export function itemTriggered(item, offer) {
  if (!offer.cur_is_special || offer.cur_price_cents == null) return false;
  if (item.alert_mode === 'off') return false;
  if (item.alert_mode === 'half') return offer.cur_promo_type === 'half_price';
  if (item.alert_mode === 'target') {
    if (!item.target_cents) return false;
    const each = offer.cur_multibuy_qty && offer.cur_multibuy_cents ? Math.round(offer.cur_multibuy_cents / offer.cur_multibuy_qty) : offer.cur_price_cents;
    return Math.min(each, offer.cur_price_cents) <= item.target_cents;
  }
  return true; // any
}

export function describeOffer(o) {
  const promo = o.cur_promo_type === 'half_price' ? 'half price'
    : o.cur_promo_type === 'multibuy' && o.cur_promo_text ? o.cur_promo_text
    : o.cur_was_cents ? `was ${money(o.cur_was_cents)}` : 'on special';
  return `${o.name} ${money(o.cur_price_cents)} at ${RETAILER_NAME[o.retailer] || o.retailer} (${promo})`;
}

/** Work out which users get which alerts. Pure-ish: reads from db, returns a plan. */
export async function planAlerts(db, now = new Date()) {
  const fresh = new Date(now.getTime() - 8 * 86400000).toISOString();
  const rows = await db.all(`
    SELECT li.id AS item_id, li.alert_mode, li.target_cents, l.user_id, l.retailer AS list_retailer,
           o.id AS offer_id, o.name, o.retailer, o.cur_price_cents, o.cur_was_cents, o.cur_is_special,
           o.cur_promo_type, o.cur_promo_text, o.cur_multibuy_qty, o.cur_multibuy_cents, o.special_since
      FROM list_items li
      JOIN lists l ON l.id = li.list_id
      JOIN retailer_product p ON p.id = li.product_id
      JOIN retailer_product o ON (o.id = p.id OR (p.canonical_product_id IS NOT NULL AND o.canonical_product_id = p.canonical_product_id))
     WHERE li.alert_mode != 'off'
       AND o.retailer IN ('woolworths','coles')
       AND o.cur_is_special = 1
       AND o.cur_captured_at >= ?
       AND (l.retailer IS NULL OR l.retailer = o.retailer)`, [fresh]);

  const recentCut = new Date(now.getTime() - 20 * 3600000).toISOString();
  const recent = await db.all('SELECT user_id, COUNT(*) AS n FROM push_log WHERE sent_at >= ? GROUP BY user_id', [recentCut]);
  const sentToday = new Set(recent.filter((r) => r.n > 0).map((r) => r.user_id));
  const log = await db.all('SELECT user_id, product_id, promo_key FROM push_log');
  const seen = new Set(log.map((l) => `${l.user_id}|${l.product_id}|${l.promo_key}`));

  const perUser = new Map();
  for (const r of rows) {
    if (!itemTriggered(r, r)) continue;
    const promoKey = r.special_since || 'unknown';
    const k = `${r.user_id}|${r.offer_id}|${promoKey}`;
    if (seen.has(k)) continue;
    if (!perUser.has(r.user_id)) perUser.set(r.user_id, new Map());
    const m = perUser.get(r.user_id);
    // One offer per list item: keep the cheapest.
    const prev = m.get(r.item_id);
    if (!prev || r.cur_price_cents < prev.cur_price_cents) m.set(r.item_id, { ...r, promo_key: promoKey });
  }
  const plan = [];
  for (const [userId, items] of perUser) {
    if (sentToday.has(userId)) continue;
    const offers = [...items.values()].sort((a, b) => (a.cur_promo_type === 'half_price' ? -1 : 0) - (b.cur_promo_type === 'half_price' ? -1 : 0));
    if (!offers.length) continue;
    const title = offers.length === 1 ? 'On special from your list' : `${offers.length} items from your list are on special`;
    const body = offers.slice(0, 3).map(describeOffer).join('\n') + (offers.length > 3 ? `\n+${offers.length - 3} more` : '');
    plan.push({ userId, title, body, offers });
  }
  return plan;
}

export async function sendAlerts(db, { dryRun = false } = {}) {
  const plan = await planAlerts(db);
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  let webpush = null;
  if (!dryRun && pub && priv) {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:beta@fairwhack.app', pub, priv);
  }
  let sent = 0, users = 0;
  const now = new Date().toISOString();
  for (const p of plan) {
    const subs = await db.all('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ?', [p.userId]);
    if (!subs.length) continue;
    let delivered = false;
    for (const s of subs) {
      if (!webpush) { delivered = true; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: p.title, body: p.body, url: '/#/digest' }),
          { TTL: 12 * 3600 });
        delivered = true; sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.run('DELETE FROM push_subs WHERE id = ?', [s.id]);
        else console.warn(`push failed for ${p.userId}: ${e.statusCode || ''} ${e.message}`);
      }
    }
    if (delivered) {
      users++;
      await db.insertRows('push_log', ['user_id', 'product_id', 'promo_key', 'sent_at'],
        p.offers.map((o) => ({ user_id: p.userId, product_id: o.offer_id, promo_key: o.promo_key, sent_at: now })),
        'ON CONFLICT(user_id, product_id, promo_key) DO NOTHING');
    }
  }
  return { planned: plan.length, users, sent };
}

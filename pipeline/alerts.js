// List alerts (stage 7): ❤️ items pushed on their own, a Wednesday/Saturday summary for the whole list,
// dedupe by product + promotion start, only fresh prices (seen in the last 8 days), at most 5 pushes a day.
import { ALERTS } from './config.js';
import { RETAILER_IDS, retailerName } from '../shared/retailers.js';

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
  return `${o.name} ${money(o.cur_price_cents)} at ${retailerName(o.retailer)} (${promo})`;
}

/**
 * Work out which pushes go to whom (stage 7).
 *  - ❤️ items (alert_mode any | half | target) that just went on special: one push each when a person has
 *    3 or fewer, otherwise one push naming them. Each special is pushed once (push_log).
 *  - Summary (the Wednesday and Saturday runs): "N items on your list are on special", counting ❤️ and 💜 items.
 *  - At most ALERTS.maxPushesPerUserPerDay pushes per person in 20 hours (push_events); the summary comes last.
 */
export async function planAlerts(db, now = new Date(), { summary = true } = {}) {
  const fresh = new Date(now.getTime() - 8 * 86400000).toISOString();
  const rows = await db.all(`
    SELECT li.id AS item_id, li.alert_mode, li.target_cents, l.user_id,
           o.id AS offer_id, o.name, o.retailer, o.cur_price_cents, o.cur_was_cents, o.cur_is_special,
           o.cur_promo_type, o.cur_promo_text, o.cur_multibuy_qty, o.cur_multibuy_cents, o.special_since
      FROM list_items li
      JOIN lists l ON l.id = li.list_id
      JOIN retailer_product p ON p.id = li.product_id
      JOIN retailer_product o ON (o.id = p.id OR (p.canonical_product_id IS NOT NULL AND o.canonical_product_id = p.canonical_product_id))
     WHERE o.retailer IN (${RETAILER_IDS.map((r) => `'${r}'`).join(',')})
       AND o.cur_is_special = 1
       AND o.cur_captured_at >= ?`, [fresh]);

  const recentCut = new Date(now.getTime() - 20 * 3600000).toISOString();
  const recent = await db.all('SELECT user_id, kind, COUNT(*) AS n FROM push_events WHERE sent_at >= ? GROUP BY user_id, kind', [recentCut]).catch(() => []);
  const used = new Map(), hadSummary = new Set();
  for (const r of recent) { used.set(r.user_id, (used.get(r.user_id) || 0) + r.n); if (r.kind === 'summary') hadSummary.add(r.user_id); }
  const log = await db.all('SELECT user_id, product_id, promo_key FROM push_log');
  const seen = new Set(log.map((l) => `${l.user_id}|${l.product_id}|${l.promo_key}`));

  const alertItems = new Map(); // user -> item_id -> cheapest triggered offer not yet pushed
  const onSpecial = new Map();  // user -> item_id -> cheapest offer on special (summary)
  const cheaper = (m, key, r) => { const prev = m.get(key); if (!prev || r.cur_price_cents < prev.cur_price_cents) m.set(key, r); };
  for (const r of rows) {
    if (!onSpecial.has(r.user_id)) onSpecial.set(r.user_id, new Map());
    cheaper(onSpecial.get(r.user_id), r.item_id, r);
    if (r.alert_mode === 'off' || !itemTriggered(r, r)) continue;
    const promoKey = r.special_since || 'unknown';
    if (seen.has(`${r.user_id}|${r.offer_id}|${promoKey}`)) continue;
    if (!alertItems.has(r.user_id)) alertItems.set(r.user_id, new Map());
    cheaper(alertItems.get(r.user_id), r.item_id, { ...r, promo_key: promoKey });
  }
  const halfFirst = (a, b) => (a.cur_promo_type === 'half_price' ? -1 : 0) - (b.cur_promo_type === 'half_price' ? -1 : 0);
  const plan = [];
  const users = new Set([...alertItems.keys(), ...onSpecial.keys()]);
  for (const userId of users) {
    let room = ALERTS.maxPushesPerUserPerDay - (used.get(userId) || 0);
    const hearts = [...(alertItems.get(userId)?.values() || [])].sort(halfFirst);
    // Keep one slot for the summary when it is due.
    const wantSummary = summary && !hadSummary.has(userId) && (onSpecial.get(userId)?.size || 0) > 0;
    const forItems = Math.max(0, room - (wantSummary ? 1 : 0));
    if (hearts.length && forItems > 0) {
      if (hearts.length <= ALERTS.maxSinglePushes && hearts.length <= forItems) {
        for (const o of hearts) plan.push({ userId, kind: 'item', title: `On special: ${o.name}`, body: describeOffer(o), url: '/#/lists', offers: [o] });
        room -= hearts.length;
      } else {
        plan.push({ userId, kind: 'items', title: `${hearts.length} items you're watching are on special`,
          body: hearts.slice(0, 3).map((o) => o.name).join(', ') + (hearts.length > 3 ? ` +${hearts.length - 3} more` : ''), url: '/#/lists', offers: hearts });
        room -= 1;
      }
    }
    if (wantSummary && room > 0) {
      const all = [...onSpecial.get(userId).values()].sort(halfFirst);
      plan.push({ userId, kind: 'summary', title: all.length === 1 ? '1 item on your list is on special' : `${all.length} items on your list are on special`,
        body: all.slice(0, 3).map(describeOffer).join('\n') + (all.length > 3 ? `\n+${all.length - 3} more` : ''), url: '/#/digest', offers: [] });
    }
  }
  return plan;
}

export async function sendAlerts(db, { dryRun = false, summary = true } = {}) {
  const plan = await planAlerts(db, new Date(), { summary });
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  let webpush = null;
  if (!dryRun && pub && priv) {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:beta@fairwhack.app', pub, priv);
  }
  let sent = 0;
  const users = new Set();
  const now = new Date().toISOString();
  const subsOf = new Map();
  for (const p of plan) {
    if (!subsOf.has(p.userId)) subsOf.set(p.userId, await db.all('SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ?', [p.userId]));
    const subs = subsOf.get(p.userId);
    if (!subs.length) continue;
    let delivered = false;
    for (const s of subs) {
      if (!webpush) { delivered = true; continue; }
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title: p.title, body: p.body, url: p.url, tag: p.kind === 'summary' ? 'fw-summary' : `fw-${p.kind}-${p.offers[0]?.offer_id || ''}` }),
          { TTL: 12 * 3600 });
        delivered = true; sent++;
      } catch (e) {
        if (e.statusCode === 404 || e.statusCode === 410) await db.run('DELETE FROM push_subs WHERE id = ?', [s.id]);
        else console.warn(`push failed for ${p.userId}: ${e.statusCode || ''} ${e.message}`);
      }
    }
    if (delivered) {
      users.add(p.userId);
      await db.run('INSERT INTO push_events (user_id, kind, sent_at) VALUES (?, ?, ?)', [p.userId, p.kind, now]);
      if (p.offers.length) await db.insertRows('push_log', ['user_id', 'product_id', 'promo_key', 'sent_at'],
        p.offers.map((o) => ({ user_id: p.userId, product_id: o.offer_id, promo_key: o.promo_key, sent_at: now })),
        'ON CONFLICT(user_id, product_id, promo_key) DO NOTHING');
    }
  }
  return { planned: plan.length, users: users.size, sent };
}

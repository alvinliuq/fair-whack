// FW2.2 "Your Brand, Your Deal": matching rules, admin set-up, Home, campaign page, follow / not interested,
// sharing, the outbound link and brand alerts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeD1, migrate } from '../dev/d1shim.js';
import { handle } from '../shared/api.js';
import { scoreCampaign, pickForHome, outboundUrl, profileFits, cleanTarget } from '../shared/brands.js';

test('score: list category 40, brand/follow 30, household 20, similar families 10', () => {
  const c = { tags: { categories: ['Sports & Outdoors'], brands: ['adidas'] }, target: { sizes: ['4'] }, brandName: 'adidas' };
  const me = { listCategories: new Set(['Sports & Outdoors']), listBrands: new Set(['adidas']), follows: false, vector: { size: '4' }, similarEngaged: true };
  const s = scoreCampaign(c, me);
  assert.equal(s.score, 100);
  assert.equal(s.reasons[0].text, 'Your list has Sports & Outdoors items');
  const none = scoreCampaign({ ...c, reason: 'Summer running sale' }, { listCategories: new Set(), listBrands: new Set(), vector: { size: '1' } });
  assert.equal(none.score, 0);
  assert.equal(none.reasons[0].text, 'Summer running sale');
  assert.equal(scoreCampaign(c, { listCategories: new Set(), listBrands: new Set(), follows: true }).reasons[0].text, 'You follow adidas');
});

test('fixed mode shows the first 5 in priority order; match mode needs 40+', () => {
  const xs = [0, 90, 10, 50, 40, 70, 30].map((score, i) => ({ c: { id: i }, score, priority: 10 - i }));
  assert.deepEqual(pickForHome(xs, 'fixed').map((x) => x.c.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(pickForHome(xs, 'match').map((x) => x.c.id), [1, 5, 3, 4]);
});

test('household target and outbound links', () => {
  assert.equal(profileFits({ pets: ['dog'] }, { pets: ['dog', 'cat'] }), true);
  assert.equal(profileFits({ kids: true }, { kids: false }), false);
  assert.equal(profileFits({ sizes: ['4'] }, {}), null);
  assert.equal(cleanTarget({ sizes: [], pets: ['fish'] }), null);
  assert.equal(outboundUrl('javascript:alert(1)'), null);
  assert.equal(outboundUrl('https://www.adidas.com.au/sale?x=1', { campaign: 'adidas-summer' }), 'https://www.adidas.com.au/sale?x=1&utm_source=fairwhack&utm_medium=app&utm_campaign=adidas-summer');
  assert.equal(outboundUrl('https://t.cfjump.com/123?Url=abc', { addUtm: false }), 'https://t.cfjump.com/123?Url=abc');
});

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fw-brands-')), 't.db');
  migrate(file);
  const env = { DB: makeD1(file), INVITE_CODE: 'beta', ADMIN_CODE: 'admin', SESSION_SECRET: 's' };
  const now = new Date().toISOString();
  env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, brand, category, cur_price_cents, cur_captured_at, canonical_product_id) VALUES ('decathlon:1', 'decathlon', '1', 'Runner shoe', 'Kalenji', 'Sports & Outdoors', 8900, ?, 'c1')").run(now);
  env.DB.raw.prepare("INSERT INTO retailer_product (id, retailer, retailer_product_id, name, brand, category, cur_price_cents, cur_captured_at, canonical_product_id) VALUES ('bigw:1', 'bigw', '1', 'Runner shoe', 'Kalenji', 'Sports & Outdoors', 7900, ?, 'c1')").run(now);
  const person = async (name, code = 'beta', ref) => {
    const res = await handle(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ name, code, ref }) }), env);
    const cookie = res.headers.get('Set-Cookie').split(';')[0];
    const call = async (p, body, method) => {
      const r = await handle(new Request(`http://x${p}`, { method: method || (body ? 'POST' : 'GET'), headers: { Cookie: cookie }, body: body ? JSON.stringify(body) : undefined }), env);
      return { status: r.status, ...(await r.json()) };
    };
    const raw = (p) => handle(new Request(`http://x${p}`, { headers: { Cookie: cookie } }), env);
    return { call, raw, id: (await res.json()).user.id };
  };
  return { env, person };
}

async function makeCampaign(admin, extra = {}) {
  const brand = await admin.call('/api/admin/brands', { name: 'Kalenji', website: 'https://www.decathlon.com.au', status: 'approved', confirmed: extra.confirmed ?? true, checks: { known: 1, official: 1, real_offer: 1, overlap: 1 } });
  assert.equal(brand.status, 200, brand.error);
  const day = 86400000;
  const c = await admin.call('/api/admin/campaigns', {
    brand_id: brand.id, title: 'Summer Run', offer: 'Up to 40% off running shoes', landing_url: 'https://www.decathlon.com.au/running',
    starts_at: new Date(Date.now() - day).toISOString(), ends_at: new Date(Date.now() + 7 * day).toISOString(), categories: ['Sports & Outdoors'],
    products: [{ name: 'Kalenji Runner', price: '99.00', url: 'https://www.decathlon.com.au/p/1', compare_ids: ['decathlon:1'] }], ...extra,
  });
  assert.equal(c.status, 200, c.error);
  return { brandId: brand.id, id: c.id };
}

test('brands need all four checks to be approved; campaigns need an approved brand to go live', async () => {
  const { person } = setup();
  const admin = await person('Boss', 'admin');
  const r = await admin.call('/api/admin/brands', { name: 'NoChecks', status: 'approved' });
  assert.equal(r.status, 400);
  const pending = await admin.call('/api/admin/brands', { name: 'Later' });
  const c = await admin.call('/api/admin/campaigns', { brand_id: pending.id, title: 'X', offer: 'Y', landing_url: 'https://a.com', ends_at: new Date(Date.now() + 86400000).toISOString() });
  assert.equal((await admin.call(`/api/admin/campaigns/${c.id}/status`, { status: 'live' })).status, 400);
  const tester = await person('Tess');
  assert.equal((await tester.call('/api/admin/brands')).status, 403);
});

test('Home shows live campaigns with a reason; page compares other stores honestly; follow, hide, share, go', async () => {
  const { person, env } = setup();
  const admin = await person('Boss', 'admin');
  const t = await person('Tess');
  const { id, brandId } = await makeCampaign(admin);
  let home = await t.call('/api/brands/home');
  assert.equal(home.campaigns.length, 0, 'drafts are not shown');
  await admin.call(`/api/admin/campaigns/${id}/status`, { status: 'live' });
  home = await t.call('/api/brands/home');
  assert.equal(home.title, 'Your Brand, Your Deal');
  assert.equal(home.campaigns.length, 1);
  assert.equal(home.campaigns[0].reason, 'Hand-picked by Fair Whack');

  // On the list: the reason becomes personal.
  const list = (await t.call('/api/lists')).lists[0];
  await t.call(`/api/lists/${list.id}/items`, { product_id: 'bigw:1' });
  home = await t.call('/api/brands/home');
  assert.equal(home.campaigns[0].reason, 'Your list has Sports & Outdoors items');

  const page = await t.call(`/api/brands/c/${id}`);
  assert.equal(page.products[0].offers.length, 2, 'linked product plus its matched twin');
  assert.equal(page.products[0].offers[0].retailer, 'bigw');
  assert.equal(page.products[0].cheaperElsewhere, true, 'a cheaper store is shown, not hidden');

  assert.equal((await t.call(`/api/brands/${brandId}/follow`, { on: true, campaign: id }, 'PUT')).following, true);
  assert.equal((await t.call(`/api/brands/c/${id}`)).reasons.includes('You follow Kalenji'), true);

  const go = await t.raw(`/api/go/${id}`);
  assert.equal(go.status, 302);
  assert.match(go.headers.get('Location'), /^https:\/\/www\.decathlon\.com\.au\/running\?utm_source=fairwhack&utm_medium=app&utm_campaign=kalenji-summer-run$/);
  const share = await t.call(`/api/brands/c/${id}/share`, {});
  assert.match(share.link, /^\/deal\?c=.+&r=.+/);

  // Public share page, then a new person signing up from it is linked to the sharer.
  const pub = await handle(new Request(`http://x/api/public/deal/${id}?r=${new URL('http://x' + share.link).searchParams.get('r')}`), env);
  const pd = await pub.json();
  assert.equal(pd.from, 'Tess');
  assert.equal(pd.products[0].best.retailer, 'bigw');
  const n = await person('Newbie', 'beta', new URL('http://x' + share.link).searchParams.get('r'));
  assert.equal(env.DB.raw.prepare('SELECT referred_by FROM users WHERE id = ?').get(n.id).referred_by, t.id);

  await t.call(`/api/brands/${brandId}/hide`, { on: true, campaign: id }, 'PUT');
  assert.equal((await t.call('/api/brands/home')).campaigns.length, 0, 'not interested hides the brand');

  const rep = await admin.call('/api/admin/brands');
  const st = rep.campaigns[0].stats;
  assert.equal(st.views, 1);
  assert.equal(st.clicks, 1);
  assert.equal(st.follow, 1);
  assert.equal(st.hide, 1);
  assert.equal(st.share, 1);
  assert.equal(st.opens, 1);
});

test('brand alerts: once per campaign, followers always, others only at 70+, and only when switched on', async () => {
  const { person, env } = setup();
  const admin = await person('Boss', 'admin');
  const fan = await person('Fan'), match = await person('Match'), off = await person('Off'), cold = await person('Cold');
  const { id, brandId } = await makeCampaign(admin, { brand_tags: 'Kalenji' });
  await fan.call(`/api/brands/${brandId}/follow`, { on: true }, 'PUT');
  for (const u of [match, off]) { const l = (await u.call('/api/lists')).lists[0]; await u.call(`/api/lists/${l.id}/items`, { product_id: 'bigw:1' }); }
  await off.call('/api/me/brand-alerts', { on: false }, 'PUT');
  const r = await admin.call(`/api/admin/campaigns/${id}/status`, { status: 'live' });
  assert.equal(r.alerts.sent, 2);
  const who = env.DB.raw.prepare("SELECT user_id FROM notifications WHERE kind = 'brand' ORDER BY user_id").all().map((x) => x.user_id);
  assert.deepEqual(who, [fan.id, match.id].sort());
  assert.ok(!who.includes(cold.id) && !who.includes(off.id));
  await admin.call(`/api/admin/campaigns/${id}/status`, { status: 'paused' });
  const again = await admin.call(`/api/admin/campaigns/${id}/status`, { status: 'live' });
  assert.equal(again.alerts.sent, 0, 'sent once per campaign');
});

test('Top 20 is called "Most popular - Top 20 this week" until enough similar families', async () => {
  const { person } = setup();
  const t = await person('Tess');
  assert.equal((await t.call('/api/top20')).title, 'Most popular - Top 20 this week');
});

test('beta demo brands (not confirmed): labelled demo, no public link, no push alerts until confirmed', async () => {
  const { person, env } = setup();
  const admin = await person('Boss', 'admin');
  const fan = await person('Fan');
  const { id, brandId } = await makeCampaign(admin, { confirmed: false });
  await fan.call(`/api/brands/${brandId}/follow`, { on: true }, 'PUT');
  const r = await admin.call(`/api/admin/campaigns/${id}/status`, { status: 'live' });
  assert.equal(r.alerts.demo, true);
  assert.equal(r.alerts.sent, 0);
  assert.equal((await fan.call('/api/brands/home')).campaigns[0].confirmed, false);
  assert.equal((await fan.call(`/api/brands/c/${id}/share`, {})).status, 400, 'no public link for a demo');
  const pub = await (await handle(new Request(`http://x/api/public/deal/${id}`), env)).json();
  assert.equal(pub.ended, true, 'public page refuses demos');
  // Confirming the brand later: alerts go out once.
  const b = (await admin.call('/api/admin/brands')).brands[0];
  await admin.call('/api/admin/brands', { ...b, confirmed: true, checks: { known: 1, official: 1, real_offer: 1, overlap: 1 } });
  assert.equal((await fan.call('/api/brands/home')).campaigns[0].confirmed, true);
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'brand'").get().n, 1);
});

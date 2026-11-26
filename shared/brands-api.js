// FW2.2 "Your Brand, Your Deal": API routes. Registered from shared/api.js with its helpers (see the bottom of api.js).
import { BRAND_ZONE, KINDS, scoreCampaign, pickForHome, outboundUrl, safeUrl, slugify, isLive, cleanTarget } from './brands.js';

export function registerBrandRoutes(d) {
  const { route, json, HttpError, body, nowIso, uid, selectIn, COLS, pub, sortOffers, isActive, profileVector, similarity, TOP,
    ensureSocial, notify, readSession, CATEGORY_LIST } = d;
  const melDay = () => new Date(Date.now() + 11 * 3600000).toISOString().slice(0, 10);
  const parse = (s, fb) => { try { return s ? JSON.parse(s) : fb; } catch { return fb; } };
  const brandOut = (b) => b && { id: b.id, name: b.name, website: b.website, logo: b.logo_url, color: b.color, host: hostOf(b.website) };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };

  async function event(env, campaignId, userId, kind, ref = null) {
    const sql = kind === 'view'
      ? 'INSERT OR IGNORE INTO campaign_events (campaign_id, user_id, kind, day, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      : 'INSERT INTO campaign_events (campaign_id, user_id, kind, day, ref, created_at) VALUES (?, ?, ?, ?, ?, ?)';
    await env.DB.prepare(sql).bind(campaignId, userId, kind, melDay(), ref, nowIso()).run().catch(() => {});
  }

  /** Live campaigns with their brand and tags, in priority order. */
  async function liveCampaigns(env) {
    const now = nowIso();
    const rows = (await env.DB.prepare(`SELECT c.*, b.name AS brand_name, b.website AS brand_website, b.logo_url AS brand_logo, b.color AS brand_color
        FROM campaigns c JOIN brands b ON b.id = c.brand_id
        WHERE c.status = 'live' AND b.status = 'approved' AND c.starts_at <= ? AND c.ends_at > ?
        ORDER BY c.priority DESC, c.starts_at DESC`).bind(now, now).all()).results;
    return withTags(env, rows);
  }
  async function withTags(env, rows) {
    const tags = await selectIn(env, 'SELECT campaign_id, kind, value FROM campaign_tags WHERE campaign_id IN', rows.map((r) => r.id));
    for (const r of rows) {
      const mine = tags.filter((t) => t.campaign_id === r.id);
      r.tags = { categories: mine.filter((t) => t.kind === 'category').map((t) => t.value), brands: mine.filter((t) => t.kind === 'brand').map((t) => t.value) };
      r.targetObj = parse(r.target, null);
    }
    return rows;
  }

  /** What we know about one person for matching: list categories and brands, follows, household. */
  async function personContext(env, user) {
    const items = (await env.DB.prepare(`SELECT DISTINCT p.category, p.brand FROM list_items li JOIN lists l ON l.id = li.list_id
        JOIN retailer_product p ON p.id = li.product_id WHERE l.user_id = ?`).bind(user.id).all()).results;
    const follows = new Set((await env.DB.prepare('SELECT brand_id FROM user_brand_follow WHERE user_id = ?').bind(user.id).all()).results.map((r) => r.brand_id));
    const hidden = new Set((await env.DB.prepare('SELECT brand_id FROM user_brand_hide WHERE user_id = ? AND until > ?').bind(user.id, nowIso()).all()).results.map((r) => r.brand_id));
    const hh = await env.DB.prepare('SELECT data FROM household WHERE user_id = ?').bind(user.id).first().catch(() => null);
    return {
      listCategories: new Set(items.map((i) => i.category).filter(Boolean)),
      listBrands: new Set(items.map((i) => String(i.brand || '').trim().toLowerCase()).filter(Boolean)),
      follows, hidden,
      vector: profileVector(user, parse(hh?.data, {})),
    };
  }

  /** Campaign ids that people similar to `user` clicked, saved from or followed. */
  async function similarEngaged(env, user, me, campaignIds) {
    if (!campaignIds.length) return new Set();
    const ev = (await selectIn(env, "SELECT DISTINCT campaign_id, user_id FROM campaign_events WHERE kind IN ('click','wish','follow') AND user_id IS NOT NULL AND campaign_id IN", campaignIds))
      .filter((e) => e.user_id !== user.id);
    const people = [...new Set(ev.map((e) => e.user_id))];
    if (!people.length) return new Set();
    const us = await selectIn(env, 'SELECT id, age_range, gender, household_size, fav_categories FROM users WHERE id IN', people);
    const hh = new Map((await selectIn(env, 'SELECT user_id, data FROM household WHERE user_id IN', people)).map((r) => [r.user_id, parse(r.data, {})]));
    const similar = new Set(us.filter((u) => similarity(me.vector, profileVector(u, hh.get(u.id) || {})) >= TOP.similarity).map((u) => u.id));
    return new Set(ev.filter((e) => similar.has(e.user_id)).map((e) => e.campaign_id));
  }

  function cardOut(c, s) {
    return {
      id: c.id, kind: c.kind, kindLabel: KINDS[c.kind] || KINDS.brand, title: c.title, offer: c.offer, image: c.image_url, endsAt: c.ends_at, startsAt: c.starts_at,
      brand: { id: c.brand_id, name: c.brand_name, logo: c.brand_logo, color: c.brand_color, website: c.brand_website, host: hostOf(c.brand_website) },
      reason: s.reasons[0].text, reasons: s.reasons.map((r) => r.text), score: s.score,
    };
  }

  async function scoreAll(env, user, list) {
    const me = await personContext(env, user);
    const sim = await similarEngaged(env, user, me, list.map((c) => c.id));
    return { me, scored: list.map((c) => ({ c, priority: c.priority, ...scoreCampaign({ tags: c.tags, target: c.targetObj, reason: c.reason, brandName: c.brand_name },
      { ...me, follows: me.follows.has(c.brand_id), similarEngaged: sim.has(c.id) }) })) };
  }

  // ----- Home -----
  route('GET', '/api/brands/home', async ({ env, user }) => {
    const live = await liveCampaigns(env);
    const { me, scored } = await scoreAll(env, user, live);
    const shown = pickForHome(scored.filter((x) => !me.hidden.has(x.c.brand_id)));
    if (shown.length) {
      await env.DB.batch(shown.map((x) => env.DB.prepare('INSERT OR IGNORE INTO campaign_events (campaign_id, user_id, kind, day, created_at) VALUES (?, ?, \'view\', ?, ?)')
        .bind(x.c.id, user.id, melDay(), nowIso()))).catch(() => {});
    }
    // Campaigns that went live on their start date get their alerts sent the first time anyone opens Home.
    const due = live.filter((c) => !c.notified_at);
    for (const c of due) await sendAlerts(env, c).catch((e) => console.error('brand alerts', e));
    return json({ title: 'Your Brand, Your Deal', mode: BRAND_ZONE.mode, campaigns: shown.map((x) => cardOut(x.c, x)), total: live.length });
  });

  /** Every live campaign ("See all"). */
  route('GET', '/api/brands/all', async ({ env, user }) => {
    const live = await liveCampaigns(env);
    const { me, scored } = await scoreAll(env, user, live);
    return json({ campaigns: scored.filter((x) => !me.hidden.has(x.c.brand_id)).map((x) => cardOut(x.c, x)), hidden: scored.filter((x) => me.hidden.has(x.c.brand_id)).length });
  });

  async function productsFor(env, campaignId) {
    const rows = (await env.DB.prepare('SELECT * FROM campaign_products WHERE campaign_id = ? ORDER BY sort, rowid').bind(campaignId).all()).results;
    const ids = [...new Set(rows.flatMap((r) => parse(r.compare_ids, [])))];
    const base = await selectIn(env, `SELECT ${COLS} FROM retailer_product WHERE id IN`, ids);
    const canons = [...new Set(base.map((p) => p.canonical_product_id).filter(Boolean))];
    const twins = await selectIn(env, `SELECT ${COLS} FROM retailer_product WHERE canonical_product_id IN`, canons);
    const all = new Map([...base, ...twins].filter((p) => isActive(p.retailer) && p.cur_price_cents != null).map((p) => [p.id, p]));
    return rows.map((r) => {
      const own = parse(r.compare_ids, []);
      const canonsOf = new Set(own.map((id) => all.get(id)?.canonical_product_id).filter(Boolean));
      // One offer per store: the cheapest listing of that store.
      const byStore = new Map();
      for (const p of all.values()) {
        if (!own.includes(p.id) && !canonsOf.has(p.canonical_product_id)) continue;
        const o = pub(p);
        const prev = byStore.get(o.retailer);
        if (!prev || o.effective < prev.effective) byStore.set(o.retailer, o);
      }
      const offers = [...byStore.values()].sort(sortOffers);
      return {
        id: r.id, name: r.name, image: r.image_url, price: r.price_cents, was: r.was_cents, url: safeUrl(r.url),
        offers, cheaperElsewhere: !!(offers[0] && r.price_cents != null && offers[0].effective < r.price_cents),
      };
    });
  }

  // ----- campaign page -----
  route('GET', '/api/brands/c/:id', async ({ env, user, params }) => {
    const c = (await withTags(env, (await env.DB.prepare(`SELECT c.*, b.name AS brand_name, b.website AS brand_website, b.logo_url AS brand_logo, b.color AS brand_color, b.status AS brand_status
        FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = ?`).bind(params.id).all()).results))[0];
    if (!c || (!user.is_admin && (!isLive(c) || c.brand_status !== 'approved'))) throw new HttpError(404, 'This deal has ended');
    const { me, scored } = await scoreAll(env, user, [c]);
    const products = await productsFor(env, c.id);
    return json({
      ...cardOut(c, scored[0]), details: c.details, code: c.code, perk: c.perk, terms: c.terms, live: isLive(c), status: c.status,
      following: me.follows.has(c.brand_id), hidden: me.hidden.has(c.brand_id), products,
    });
  });

  route('POST', '/api/brands/c/:id/event', async ({ env, user, params, request }) => {
    const kind = String((await body(request)).kind || '');
    if (!['share', 'wish'].includes(kind)) throw new HttpError(400, 'Unknown event');
    await event(env, params.id, user.id, kind);
    return json({ ok: true });
  });

  route('PUT', '/api/brands/:id/follow', async ({ env, user, params, request }) => {
    const { on, campaign } = await body(request);
    if (on) {
      await env.DB.prepare('INSERT OR IGNORE INTO user_brand_follow (user_id, brand_id, created_at) VALUES (?, ?, ?)').bind(user.id, params.id, nowIso()).run();
      if (campaign) await event(env, String(campaign), user.id, 'follow');
    } else await env.DB.prepare('DELETE FROM user_brand_follow WHERE user_id = ? AND brand_id = ?').bind(user.id, params.id).run();
    return json({ ok: true, following: !!on });
  });

  route('PUT', '/api/brands/:id/hide', async ({ env, user, params, request }) => {
    const { on, campaign } = await body(request);
    if (on) {
      const until = new Date(Date.now() + BRAND_ZONE.hideDays * 86400000).toISOString();
      await env.DB.prepare('INSERT INTO user_brand_hide (user_id, brand_id, until, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, brand_id) DO UPDATE SET until = excluded.until')
        .bind(user.id, params.id, until, nowIso()).run();
      if (campaign) await event(env, String(campaign), user.id, 'hide');
    } else await env.DB.prepare('DELETE FROM user_brand_hide WHERE user_id = ? AND brand_id = ?').bind(user.id, params.id).run();
    return json({ ok: true, hidden: !!on });
  });

  /** Share with friends in the app (a notification each), or get a link to share elsewhere. */
  route('POST', '/api/brands/c/:id/share', async ({ env, user, params, request }) => {
    const b = await body(request);
    const c = await env.DB.prepare('SELECT c.id, c.offer, b.name AS brand_name FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = ?').bind(params.id).first();
    if (!c) throw new HttpError(404, 'Deal not found');
    const me = await ensureSocial(env, user);
    const to = [...new Set((Array.isArray(b.to) ? b.to : []).map(String))].slice(0, 30);
    let sent = 0;
    if (to.length) {
      const ok = new Set((await env.DB.prepare(`SELECT a, b FROM friendships WHERE status = 'accepted' AND (a = ? OR b = ?)`).bind(me.id, me.id).all()).results.map((r) => (r.a === me.id ? r.b : r.a)));
      const note = String(b.note || '').trim().slice(0, 200);
      for (const t of to.filter((x) => ok.has(x))) {
        await notify(env, t, { kind: 'brand_share', title: `${me.name} shared a ${c.brand_name} deal`, body: note ? `“${note}” · ${c.offer}` : c.offer, url: `/#/brand/${c.id}` });
        sent++;
      }
      if (!sent) throw new HttpError(400, 'You can only share with friends');
    }
    await event(env, c.id, user.id, 'share', to.length ? 'friends' : 'link');
    return json({ ok: true, sent, link: `/deal?c=${encodeURIComponent(c.id)}&r=${encodeURIComponent(me.friend_code)}` });
  });

  // ----- public share page (no sign-in): /deal?c=<id>&r=<sharer's friend code> -----
  route('GET', '/api/public/deal/:id', async ({ env, params, url }) => {
    const c = (await env.DB.prepare(`SELECT c.*, b.name AS brand_name, b.website AS brand_website, b.logo_url AS brand_logo, b.color AS brand_color, b.status AS brand_status
        FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = ?`).bind(params.id).first());
    if (!c || !isLive(c) || c.brand_status !== 'approved') return json({ ended: true });
    const ref = String(url.searchParams.get('r') || '').slice(0, 40);
    const from = ref ? await env.DB.prepare('SELECT name FROM users WHERE friend_code = ?').bind(ref).first() : null;
    await event(env, c.id, null, 'open', ref || null);
    const products = (await productsFor(env, c.id)).map(({ offers, ...p }) => ({ ...p, best: offers[0] ? { retailer: offers[0].retailer, effective: offers[0].effective } : null }));
    return json({
      id: c.id, kindLabel: KINDS[c.kind] || KINDS.brand, title: c.title, offer: c.offer, details: c.details, image: c.image_url, endsAt: c.ends_at,
      brand: { name: c.brand_name, logo: c.brand_logo, color: c.brand_color, host: hostOf(c.brand_website) },
      from: from ? from.name.split(' ')[0] : null, hasCode: !!c.code, products,
    });
  }, { public: true });

  /** "Go to site": count the click, then send the person on (with UTM tags, or the affiliate link as entered). */
  route('GET', '/api/go/:id', async ({ env, request, params, url }) => {
    const c = await env.DB.prepare(`SELECT c.id, c.title, c.landing_url, c.add_utm, b.name AS brand_name FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = ?`).bind(params.id).first();
    if (!c) return new Response('Not found', { status: 404 });
    const pid = url.searchParams.get('p');
    const prod = pid ? await env.DB.prepare('SELECT url FROM campaign_products WHERE id = ? AND campaign_id = ?').bind(pid, c.id).first() : null;
    const src = url.searchParams.get('src') === 'share' ? 'share' : 'app';
    const dest = outboundUrl(prod?.url || c.landing_url, { addUtm: !!c.add_utm, campaign: slugify(`${c.brand_name} ${c.title}`), medium: src });
    if (!dest) return new Response('Link not available', { status: 404 });
    const userId = await readSession(env, request).catch(() => null);
    await event(env, c.id, userId, 'click', pid ? `product:${pid}` : src);
    return new Response(null, { status: 302, headers: { Location: dest, 'Cache-Control': 'no-store', 'Referrer-Policy': 'origin' } });
  }, { public: true });

  // ----- images uploaded in Admin -----
  route('GET', '/api/assets/:id', async ({ env, params }) => {
    const a = await env.DB.prepare('SELECT mime, data FROM brand_assets WHERE id = ?').bind(params.id).first();
    if (!a) return new Response('Not found', { status: 404 });
    const bin = Uint8Array.from(atob(a.data), (ch) => ch.charCodeAt(0));
    return new Response(bin, { headers: { 'Content-Type': a.mime, 'Cache-Control': 'public, max-age=31536000, immutable' } });
  }, { public: true });

  // ----- brand deal alerts -----
  /**
   * Once per campaign, when it is live: followers of the brand get a push; other people get one if the campaign
   * scores alertScore or more for them, they haven't had a brand alert in alertEveryDays, and brand alerts are on.
   * Everyone: at most 5 pushes a day overall (shared with special alerts), and never for a hidden brand.
   */
  async function sendAlerts(env, c) {
    const claimed = await env.DB.prepare('UPDATE campaigns SET notified_at = ? WHERE id = ? AND notified_at IS NULL').bind(nowIso(), c.id).run();
    if (!claimed.meta?.changes) return { sent: 0 };
    if (!c.tags) [c] = await withTags(env, [c]);
    const users = (await env.DB.prepare('SELECT * FROM users WHERE brand_alerts = 1 AND is_design = 0').all()).results;
    const dayCut = new Date(Date.now() - 20 * 3600000).toISOString();
    const weekCut = new Date(Date.now() - BRAND_ZONE.alertEveryDays * 86400000).toISOString();
    const recent = (await env.DB.prepare('SELECT user_id, kind, sent_at FROM push_events WHERE sent_at >= ?').bind(weekCut).all()).results;
    const brandName = c.brand_name || (await env.DB.prepare('SELECT name FROM brands WHERE id = ?').bind(c.brand_id).first())?.name || 'A brand';
    let sent = 0;
    for (const u of users) {
      const { me, scored } = await scoreAll(env, u, [{ ...c, brand_name: brandName }]);
      if (me.hidden.has(c.brand_id)) continue;
      const follower = me.follows.has(c.brand_id);
      const mine = recent.filter((r) => r.user_id === u.id);
      if (mine.filter((r) => r.sent_at >= dayCut).length >= 5) continue;
      if (!follower && (scored[0].score < BRAND_ZONE.alertScore || mine.some((r) => r.kind === 'brand'))) continue;
      await notify(env, u.id, { kind: 'brand', title: follower ? `New from ${brandName}: ${c.title}` : `${brandName}: ${c.offer}`, body: follower ? c.offer : scored[0].reasons[0].text, url: `/#/brand/${c.id}` });
      await env.DB.prepare('INSERT INTO push_events (user_id, kind, sent_at) VALUES (?, ?, ?)').bind(u.id, follower ? 'brand_follow' : 'brand', nowIso()).run();
      sent++;
    }
    return { sent };
  }

  route('PUT', '/api/me/brand-alerts', async ({ env, user, request }) => {
    const on = !!(await body(request)).on;
    await env.DB.prepare('UPDATE users SET brand_alerts = ? WHERE id = ?').bind(on ? 1 : 0, user.id).run();
    return json({ ok: true, on });
  });
  route('GET', '/api/me/brand-alerts', async ({ env, user }) => {
    const follows = (await env.DB.prepare('SELECT b.id, b.name, b.logo_url AS logo, b.color FROM user_brand_follow f JOIN brands b ON b.id = f.brand_id WHERE f.user_id = ? ORDER BY b.name').bind(user.id).all()).results;
    const hidden = (await env.DB.prepare('SELECT b.id, b.name, h.until FROM user_brand_hide h JOIN brands b ON b.id = h.brand_id WHERE h.user_id = ? AND h.until > ? ORDER BY b.name').bind(user.id, nowIso()).all()).results;
    return json({ on: user.brand_alerts !== 0, follows, hidden });
  });

  // ================= Admin =================
  const ADMIN = { admin: true };
  const str = (v, n = 300) => { const s = String(v ?? '').trim().slice(0, n); return s || null; };
  const cents = (v) => { if (v === '' || v == null) return null; const n = Math.round(Number(v) * 100); return Number.isFinite(n) && n >= 0 ? n : null; };
  const iso = (v, fb) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : fb; };
  const CHECKS = ['known', 'official', 'real_offer', 'overlap'];

  route('GET', '/api/admin/brands', async ({ env }) => {
    const brands = (await env.DB.prepare(`SELECT b.*, (SELECT COUNT(*) FROM user_brand_follow f WHERE f.brand_id = b.id) AS followers FROM brands b ORDER BY b.name`).all()).results
      .map((b) => ({ ...b, checks: parse(b.checks, {}) }));
    const campaigns = (await env.DB.prepare(`SELECT c.id, c.brand_id, c.kind, c.title, c.offer, c.image_url, c.starts_at, c.ends_at, c.priority, c.status, c.notified_at, b.name AS brand_name
        FROM campaigns c JOIN brands b ON b.id = c.brand_id ORDER BY (c.status = 'live') DESC, c.priority DESC, c.updated_at DESC`).all()).results;
    const ev = (await env.DB.prepare(`SELECT campaign_id, kind, COUNT(*) AS n, COUNT(DISTINCT user_id) AS people FROM campaign_events GROUP BY campaign_id, kind`).all()).results;
    const now = nowIso();
    for (const c of campaigns) {
      const m = Object.fromEntries(ev.filter((e) => e.campaign_id === c.id).map((e) => [e.kind, e]));
      const views = m.view?.people || 0, clicks = m.click?.n || 0;
      c.stats = { views, viewDays: m.view?.n || 0, clicks, clickPeople: m.click?.people || 0, ctr: views ? clicks / (m.view?.n || 1) : 0,
        wish: m.wish?.n || 0, follow: m.follow?.n || 0, share: m.share?.n || 0, hide: m.hide?.n || 0, hideRate: views ? (m.hide?.n || 0) / views : 0, opens: m.open?.n || 0 };
      c.live = isLive(c, now);
    }
    return json({ brands, campaigns, categories: CATEGORY_LIST.filter((x) => x !== 'Liquor' && x !== 'Other'), kinds: KINDS, zone: BRAND_ZONE, checks: CHECKS });
  }, ADMIN);

  route('POST', '/api/admin/brands', async ({ env, request }) => {
    const b = await body(request);
    const name = str(b.name, 80);
    if (!name) throw new HttpError(400, 'Brand name is required');
    const website = b.website ? safeUrl(b.website) : null;
    if (b.website && !website) throw new HttpError(400, 'Website must start with https://');
    const checks = Object.fromEntries(CHECKS.map((k) => [k, !!b.checks?.[k]]));
    const status = ['pending', 'approved', 'paused'].includes(b.status) ? b.status : 'pending';
    if (status === 'approved' && !CHECKS.every((k) => checks[k])) throw new HttpError(400, 'Tick all four admission checks before approving');
    const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null;
    const logo = b.logo ? (String(b.logo).startsWith('/api/assets/') ? String(b.logo) : safeUrl(b.logo)) : null;
    const id = b.id || uid();
    await env.DB.prepare(`INSERT INTO brands (id, name, website, logo_url, color, contact, status, checks, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, website = excluded.website, logo_url = excluded.logo_url, color = excluded.color, contact = excluded.contact,
        status = excluded.status, checks = excluded.checks, notes = excluded.notes, updated_at = excluded.updated_at`)
      .bind(id, name, website, logo, color, str(b.contact, 200), status, JSON.stringify(checks), str(b.notes, 1000), nowIso(), nowIso()).run();
    return json({ ok: true, id });
  }, ADMIN);

  route('GET', '/api/admin/campaigns/:id', async ({ env, params }) => {
    const c = (await withTags(env, (await env.DB.prepare('SELECT * FROM campaigns WHERE id = ?').bind(params.id).all()).results))[0];
    if (!c) throw new HttpError(404, 'Campaign not found');
    const prods = (await env.DB.prepare('SELECT * FROM campaign_products WHERE campaign_id = ? ORDER BY sort, rowid').bind(c.id).all()).results;
    const ids = [...new Set(prods.flatMap((p) => parse(p.compare_ids, [])))];
    const linked = new Map((await selectIn(env, `SELECT ${COLS} FROM retailer_product WHERE id IN`, ids)).map((p) => [p.id, pub(p)]));
    return json({ ...c, target: c.targetObj, products: prods.map((p) => ({ ...p, compare: parse(p.compare_ids, []).map((id) => linked.get(id) || { id, name: id, missing: true }) })) });
  }, ADMIN);

  route('POST', '/api/admin/campaigns', async ({ env, request }) => {
    const b = await body(request);
    const brand = await env.DB.prepare('SELECT id FROM brands WHERE id = ?').bind(String(b.brand_id || '')).first();
    if (!brand) throw new HttpError(400, 'Choose a brand');
    const title = str(b.title, 80), offer = str(b.offer, 120);
    if (!title || !offer) throw new HttpError(400, 'Campaign name and offer line are required');
    const landing = safeUrl(b.landing_url);
    if (!landing) throw new HttpError(400, 'Landing page link must start with https://');
    const starts = iso(b.starts_at, nowIso());
    const ends = iso(b.ends_at, null);
    if (!ends || ends <= starts) throw new HttpError(400, 'End date must be after the start date');
    const img = b.image_url ? (String(b.image_url).startsWith('/api/assets/') ? String(b.image_url) : safeUrl(b.image_url)) : null;
    const id = b.id || uid();
    const prev = b.id ? await env.DB.prepare('SELECT status FROM campaigns WHERE id = ?').bind(id).first() : null;
    const status = prev?.status || 'draft';
    const cats = [...new Set((Array.isArray(b.categories) ? b.categories : []).map(String).filter((x) => CATEGORY_LIST.includes(x)))];
    const brandTags = [...new Set(String(b.brand_tags || '').split(',').map((x) => x.trim()).filter(Boolean))].slice(0, 20);
    const products = (Array.isArray(b.products) ? b.products : []).slice(0, 12).map((p, i) => ({
      id: p.id || uid(), sort: i, name: str(p.name, 140), image: p.image_url ? (String(p.image_url).startsWith('/api/assets/') ? String(p.image_url) : safeUrl(p.image_url)) : null,
      price: cents(p.price), was: cents(p.was), url: p.url ? safeUrl(p.url) : null,
      compare: [...new Set((Array.isArray(p.compare_ids) ? p.compare_ids : []).map(String))].slice(0, 20),
    })).filter((p) => p.name);
    const stmts = [
      env.DB.prepare(`INSERT INTO campaigns (id, brand_id, kind, title, offer, reason, details, code, perk, terms, image_url, landing_url, add_utm, starts_at, ends_at, priority, status, target, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET brand_id = excluded.brand_id, kind = excluded.kind, title = excluded.title, offer = excluded.offer, reason = excluded.reason,
          details = excluded.details, code = excluded.code, perk = excluded.perk, terms = excluded.terms, image_url = excluded.image_url, landing_url = excluded.landing_url,
          add_utm = excluded.add_utm, starts_at = excluded.starts_at, ends_at = excluded.ends_at, priority = excluded.priority, target = excluded.target, updated_at = excluded.updated_at`)
        .bind(id, brand.id, b.kind === 'retailer' ? 'retailer' : 'brand', title, offer, str(b.reason, 100), str(b.details, 1500), str(b.code, 40), str(b.perk, 200), str(b.terms, 2000),
          img, landing, b.add_utm === false ? 0 : 1, starts, ends, Math.max(-99, Math.min(99, parseInt(b.priority, 10) || 0)), status, JSON.stringify(cleanTarget(b.target)), nowIso(), nowIso()),
      env.DB.prepare('DELETE FROM campaign_tags WHERE campaign_id = ?').bind(id),
      ...cats.map((v) => env.DB.prepare('INSERT INTO campaign_tags (campaign_id, kind, value) VALUES (?, \'category\', ?)').bind(id, v)),
      ...brandTags.map((v) => env.DB.prepare('INSERT INTO campaign_tags (campaign_id, kind, value) VALUES (?, \'brand\', ?)').bind(id, v)),
      env.DB.prepare('DELETE FROM campaign_products WHERE campaign_id = ?').bind(id),
      ...products.map((p) => env.DB.prepare('INSERT INTO campaign_products (id, campaign_id, sort, name, image_url, price_cents, was_cents, url, compare_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(p.id, id, p.sort, p.name, p.image, p.price, p.was, p.url, JSON.stringify(p.compare))),
    ];
    await env.DB.batch(stmts);
    return json({ ok: true, id });
  }, ADMIN);

  /** live | paused | ended | draft. Going live (inside its dates) sends the brand alerts once. */
  route('POST', '/api/admin/campaigns/:id/status', async ({ env, params, request }) => {
    const status = String((await body(request)).status || '');
    if (!['live', 'paused', 'ended', 'draft'].includes(status)) throw new HttpError(400, 'Unknown status');
    const c = await env.DB.prepare('SELECT c.*, b.status AS brand_status, b.name AS brand_name FROM campaigns c JOIN brands b ON b.id = c.brand_id WHERE c.id = ?').bind(params.id).first();
    if (!c) throw new HttpError(404, 'Campaign not found');
    if (status === 'live' && c.brand_status !== 'approved') throw new HttpError(400, 'Approve the brand first (Admin → Brands)');
    await env.DB.prepare('UPDATE campaigns SET status = ?, updated_at = ? WHERE id = ?').bind(status, nowIso(), c.id).run();
    let alerts = null;
    if (status === 'live' && isLive({ ...c, status })) alerts = await sendAlerts(env, { ...c, status });
    return json({ ok: true, alerts });
  }, ADMIN);

  route('DELETE', '/api/admin/campaigns/:id', async ({ env, params }) => {
    await env.DB.batch(['campaign_products', 'campaign_tags'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE campaign_id = ?`).bind(params.id))
      .concat(env.DB.prepare("DELETE FROM campaigns WHERE id = ? AND status != 'live'").bind(params.id)));
    return json({ ok: true });
  }, ADMIN);

  route('POST', '/api/admin/assets', async ({ env, request }) => {
    const { dataUrl } = await body(request);
    const m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new HttpError(400, 'Send a JPEG, PNG or WebP image');
    const bytes = Math.floor(m[2].length * 3 / 4);
    if (bytes > 900000) throw new HttpError(400, 'Image too large (max 900 KB after resizing)');
    const id = uid();
    await env.DB.prepare('INSERT INTO brand_assets (id, mime, data, bytes, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, m[1], m[2], bytes, nowIso()).run();
    return json({ ok: true, url: `/api/assets/${id}` });
  }, ADMIN);
}

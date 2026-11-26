// Fair Whack FW2.2 — "Your Brands, Your Deals": partner brand campaigns.
// Home rail (under Top 20) · campaign page (#/brand/<id>) · all deals (#/brands) · How Fair Whack makes money (#/earn)
// · brand alerts (Settings → Alerts) · Admin → Brand deals (#/adminbrands, #/admincampaign/<id|new>).
// Partner placement only ever affects this section: never search, store comparisons or Top 20.
let ctx;
export function init(c) { ctx = c; }

const $ = (s, el = document) => el.querySelector(s);
const DISCLOSURE = 'Partner brands may pay Fair Whack a fee or commission. It never changes search results, store comparisons or Top 20.';
// Brands not yet confirmed with Fair Whack are "Demo" campaigns for the internal beta only.
const DEMO_NOTE = (b) => `${b.name} is not a Fair Whack partner and has not reviewed or endorsed this page. Any extra Fair Whack discount shown is simulated for testing and is not available. Prices and offers are copied from ${b.host || 'the brand\'s website'} and may have changed: check there before buying.`;
const tag = (c, inline = false) => c.confirmed
  ? `<span class="partner${inline ? ' inline' : ''}" title="${ctx.esc(DISCLOSURE)}">Partner</span>`
  : `<span class="partner demo${inline ? ' inline' : ''}" title="${ctx.esc(DEMO_NOTE(c.brand))}">Beta demo</span>`;

const sday = (iso) => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
const day = (iso) => new Date(iso).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
function endsText(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (ms < 0) return 'Ended';
  if (ms < 86400000 && new Date(iso).getDate() === new Date().getDate()) return 'Ends today';
  if (ms < 2 * 86400000) return 'Ends tomorrow';
  return `Ends ${day(iso)}`;
}
const soon = (iso) => Date.parse(iso) - Date.now() < 2 * 86400000;
const initial = (n) => ctx.esc(String(n || '?').trim()[0] || '?').toUpperCase();

function logoBadge(b, cls = '') {
  const { esc } = ctx;
  return `<span class="blogo ${cls}" style="--bc:${esc(b.color || '#FFFFFF')}">${b.logo ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}">` : `<b>${esc(b.name)}</b>`}</span>`;
}

function card(c) {
  const { esc } = ctx;
  return `<a class="bcard" href="#/brand/${encodeURIComponent(c.id)}" data-cid="${esc(c.id)}">
    <span class="bimg" style="--bc:${esc(c.brand.color || '#EFEAFF')}">
      ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="bimg-ph">${initial(c.brand.name)}</span>`}
      ${tag(c)}
      ${logoBadge(c.brand)}
    </span>
    <span class="btext">
      <b class="boffer">${esc(c.offer)}</b>
      <span class="breason"><span aria-hidden="true">✦</span> ${esc(c.reason)}</span>
      <span class="bmeta"><span class="${soon(c.endsAt) ? 'hot' : ''}">${endsText(c.endsAt)}</span> · ${esc(c.kindLabel)} · ${esc(c.brand.name)}</span>
    </span>
  </a>`;
}

// ---------- Home ----------
export async function homeRail(el) {
  const { api } = ctx;
  const d = await api('/api/brands/home').catch(() => null);
  if (!d || !d.campaigns.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-head"><h2>${ctx.esc(d.title)}</h2><a href="#/brands">See all${d.total > d.campaigns.length ? ` (${d.total})` : ''} ›</a></div>
    <p class="sec-sub">${d.campaigns.some((c) => !c.confirmed) ? 'Beta demo: brands are not partners yet' : 'Offers from partner brands'} · <a href="#/earn" class="muted-link">How this works</a></p>
    <div class="rail brail" tabindex="0" aria-label="Partner brand deals, swipe for more">${d.campaigns.map(card).join('')}</div>`;
}

export async function allPage() {
  const { app, api, esc, toast } = ctx;
  app.innerHTML = '<h1>Your Brands, Your Deals</h1><p class="muted">Loading…</p>';
  const d = await api('/api/brands/all');
  const followBtn = (c) => `<button type="button" class="btn small ${c.following ? 'light' : 'ghost'} bfollow-btn" data-fb="${esc(c.brand.id)}" aria-pressed="${c.following}">${c.following ? '✓ Following' : '+ Follow'}</button>`;
  app.innerHTML = `<h1>Your Brands, Your Deals</h1>
    <p class="lead small">All brand deals running now, most relevant to you first. ${d.campaigns.some((c) => !c.confirmed) ? 'Deals marked Beta demo are not from partners. ' : ''}<a href="#/earn">How this works</a></p>
    ${d.campaigns.length ? `<div class="bgrid">${d.campaigns.map((c) => `<div class="bcard-wrap">${card(c)}<div class="bcard-actions"><span class="small muted">${esc(c.brand.name)}</span>${followBtn(c)}</div></div>`).join('')}</div>`
      : '<div class="empty"><b>No brand deals right now</b>Check back soon.</div>'}
    ${d.hidden ? `<p class="small muted center">${d.hidden} hidden because you chose “Not interested”. <a href="#/alerts">Manage</a></p>` : ''}`;
  app.querySelectorAll('[data-fb]').forEach((btn) => (btn.onclick = async () => {
    const id = btn.dataset.fb, on = btn.getAttribute('aria-pressed') !== 'true';
    const c = d.campaigns.find((x) => x.brand.id === id);
    try {
      await api(`/api/brands/${encodeURIComponent(id)}/follow`, { method: 'PUT', body: { on, campaign: on ? c.id : undefined } });
      // A brand can have several deals: update every button for it.
      app.querySelectorAll(`[data-fb="${CSS.escape(id)}"]`).forEach((b) => { b.setAttribute('aria-pressed', on); b.textContent = on ? '✓ Following' : '+ Follow'; b.classList.toggle('light', on); b.classList.toggle('ghost', !on); });
      d.campaigns.filter((x) => x.brand.id === id).forEach((x) => (x.following = on));
      toast(on ? `Following ${c.brand.name}` : `Unfollowed ${c.brand.name}`);
    } catch (e) { toast(e.message); }
  }));
}

// ---------- campaign page ----------
export async function page(id) {
  const { app, api, esc, money, toast, RET, heart, thumb } = ctx;
  app.innerHTML = '<p class="muted">Loading…</p>';
  let c;
  try { c = await api(`/api/brands/c/${encodeURIComponent(id)}`); } catch (e) {
    app.innerHTML = `<div class="empty"><b>${esc(e.message)}</b><a href="#/">Back to Home</a></div>`; return;
  }
  const go = (pid) => `/api/go/${encodeURIComponent(c.id)}${pid ? `?p=${encodeURIComponent(pid)}` : ''}`;
  const site = c.brand.host || 'the brand website';
  const goLabel = c.kind === 'retailer' ? `Go to the event on ${site}` : `Go to ${site}`;
  app.innerHTML = `
    ${c.live ? '' : `<div class="notice">Admin preview · this campaign is <b>${esc(c.status)}</b> and not shown to testers.</div>`}
    <div class="bhead">
      <div class="row">${logoBadge(c.brand, 'big')}<span class="spacer"></span>
        <button class="btn small ${c.following ? 'light' : 'ghost'}" id="follow" aria-pressed="${c.following}">${c.following ? '✓ Following' : '+ Follow brand'}</button></div>
      <div class="bhead-t">${tag(c, true)} <span class="small muted">${esc(c.kindLabel)} · ${esc(c.brand.name)}</span>
        <h1>${esc(c.title)}</h1>
        <p class="small muted">${day(c.startsAt)} – ${day(c.endsAt)} · <span class="${soon(c.endsAt) ? 'hot' : ''}">${endsText(c.endsAt)}</span></p></div>
    </div>
    ${c.image ? `<div class="bhero" style="--bc:${esc(c.brand.color || '#EFEAFF')}"><img src="${esc(c.image)}" alt="" referrerpolicy="no-referrer"></div>` : ''}
    ${c.confirmed ? '' : `<div class="notice demo-note"><b>Beta demo</b> ${esc(DEMO_NOTE(c.brand))}</div>`}
    <div class="card why"><b>Why you're seeing this</b><ul>${c.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      <p class="small muted">${c.confirmed ? esc(DISCLOSURE) : 'Picked by the Fair Whack team to test this section. No brand pays Fair Whack during the beta.'} <a href="#/earn">Learn more</a></p></div>
    <h2>The offer</h2>
    <div class="card stack boffer-card"><b class="big">${esc(c.offer)}</b>
      ${c.details ? `<p>${esc(c.details).replace(/\n/g, '<br>')}</p>` : ''}
      ${c.code ? `<div class="bcode"><span><span class="small muted">Fair Whack code</span><b>${esc(c.code)}</b></span><button class="btn small ticket" id="copy">Copy</button></div>` : ''}
      ${c.perk ? `<p class="bperk">🎁 ${esc(c.perk)}</p>` : ''}
      ${c.terms ? `<details><summary class="small">Terms</summary><p class="small muted">${esc(c.terms).replace(/\n/g, '<br>')}</p></details>` : ''}
    </div>
    ${c.products.length ? `<h2>Featured products</h2><p class="sec-sub">${esc(c.brand.name)} price, and the same product at other stores when we have it. Cheapest first.</p>
      <div class="stack">${c.products.map((p) => `<div class="card bprod">
        <div class="bprod-top">${p.image ? `<div class="thumb"><img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : (p.offers[0] ? thumb(p.offers[0]) : '<div class="thumb"><span class="ph">' + initial(p.name) + '</span></div>')}
          <div class="bprod-n"><b>${esc(p.name)}</b>
            <div class="small">${esc(c.brand.name)} <b class="num">${money(p.price)}</b>${p.was && p.was > p.price ? ` <s class="muted">${money(p.was)}</s>` : ''}</div>
            ${p.url ? `<a class="small" href="${go(p.id)}" target="_blank" rel="noopener" data-out>View on ${esc(site)} ↗</a>` : ''}</div>
          ${p.offers[0] ? heart(p.offers[0]) : ''}</div>
        ${p.offers.length ? `<div class="bcompare">${p.cheaperElsewhere ? `<div class="bcheaper">Cheaper at ${esc(RET[p.offers[0].retailer] || p.offers[0].retailer)} right now</div>` : ''}
          ${p.offers.map((o) => `<a class="brow" href="#/p/${encodeURIComponent(o.id)}"><span class="ret ${o.retailer}">${esc(RET[o.retailer] || o.retailer)}</span><span class="spacer"></span>${o.special ? '<span class="badge b-promo">Special</span>' : ''}<b class="num ${p.price != null && o.effective < p.price ? 'save' : ''}">${money(o.effective)}</b></a>`).join('')}</div>` : ''}
      </div>`).join('')}</div>` : ''}
    <div class="bactions">
      <a class="btn block" href="${go()}" target="_blank" rel="noopener" data-out>${esc(goLabel)} ↗</a>
      <p class="small muted center">You'll leave Fair Whack and open ${esc(site)}.</p>
      <div class="row"><button class="btn light" id="bshare" style="flex:1">Share</button><button class="btn danger" id="bhide" style="flex:1">${c.hidden ? 'Show this brand again' : 'Not interested'}</button></div>
    </div>`;

  const follow = $('#follow');
  follow.onclick = async () => {
    const on = follow.getAttribute('aria-pressed') !== 'true';
    try {
      await api(`/api/brands/${encodeURIComponent(c.brand.id)}/follow`, { method: 'PUT', body: { on, campaign: c.id } });
      follow.setAttribute('aria-pressed', on); follow.textContent = on ? '✓ Following' : '+ Follow brand';
      follow.classList.toggle('light', on); follow.classList.toggle('ghost', !on);
      toast(on ? `Following ${c.brand.name}: you'll hear about new deals` : 'Unfollowed');
    } catch (e) { toast(e.message); }
  };
  const copy = $('#copy');
  if (copy) copy.onclick = async () => { try { await navigator.clipboard.writeText(c.code); toast('Code copied'); } catch { toast(c.code); } };
  $('#bshare').onclick = () => shareSheet(c).catch((e) => toast(e.message));
  $('#bhide').onclick = async () => {
    const on = !c.hidden;
    try {
      await api(`/api/brands/${encodeURIComponent(c.brand.id)}/hide`, { method: 'PUT', body: { on, campaign: c.id } });
      if (on) {
        toast(`You won't see ${c.brand.name} deals for 90 days`, { label: 'Undo', run: () => api(`/api/brands/${encodeURIComponent(c.brand.id)}/hide`, { method: 'PUT', body: { on: false } }).then(() => toast('Shown again')) });
        location.hash = '#/';
      } else { toast('Shown again'); page(id); }
    } catch (e) { toast(e.message); }
  };
  // Saving a featured product from here counts towards the campaign's "added to list" figure.
  app.querySelectorAll('.bprod [data-heart]').forEach((b) => b.addEventListener('click', () => {
    if (!b.classList.contains('on')) api(`/api/brands/c/${encodeURIComponent(c.id)}/event`, { method: 'POST', body: { kind: 'wish' } }).catch(() => {});
  }, true));
}

async function shareSheet(c) {
  const { sheet, esc, api, toast } = ctx;
  const s = await api('/api/social').catch(() => null);
  sheet(`<h3>Share this deal</h3><p class="small muted" style="margin-top:-4px">${esc(c.brand.name)} · ${esc(c.offer)}</p>
    ${s?.friends.length ? `<form id="bshare-f">
      <div class="card list-rows friends-pick">${s.friends.map((f) => `<label class="r friend"><span class="avatar">${initial(f.name)}</span><span class="n"><b>${esc(f.name)}</b><span class="small muted">@${esc(f.handle)}</span></span><input type="checkbox" name="to" value="${esc(f.id)}"></label>`).join('')}</div>
      <input name="note" maxlength="200" placeholder="Add a note (optional)" style="width:100%;margin:8px 0">
      <button class="btn" style="width:100%">Send to friends</button></form>`
      : '<div class="empty" style="margin:0 0 8px"><b>No friends yet</b><a href="#/friends">Add friends</a> to share deals with them.</div>'}
    ${c.confirmed ? `<button class="btn light" id="bshare-out" style="width:100%;margin-top:8px">Share a link…</button>
    <p class="small muted" style="margin-top:8px">The link opens a page anyone can see, with an invitation to join Fair Whack.</p>`
    : '<p class="small muted" style="margin-top:8px">Beta demo deals can only be shared with friends inside Fair Whack, not as a public link.</p>'}`);
  const f = $('#bshare-f');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const to = [...f.querySelectorAll('input[name=to]:checked')].map((x) => x.value);
    if (!to.length) { toast('Choose at least one friend'); return; }
    try {
      const r = await api(`/api/brands/c/${encodeURIComponent(c.id)}/share`, { method: 'POST', body: { to, note: f.note.value } });
      $('#sheet').hidden = true; toast(r.sent === 1 ? 'Sent' : `Sent to ${r.sent} friends`);
    } catch (err) { toast(err.message); }
  };
  if ($('#bshare-out')) $('#bshare-out').onclick = async () => {
    try {
      const r = await api(`/api/brands/c/${encodeURIComponent(c.id)}/share`, { method: 'POST', body: {} });
      const link = location.origin + r.link;
      if (navigator.share) await navigator.share({ title: `${c.brand.name}: ${c.offer}`, text: `${c.brand.name}: ${c.offer} (via Fair Whack)`, url: link });
      else { await navigator.clipboard.writeText(link); toast('Link copied'); }
    } catch { /* closed */ }
  };
}

// ---------- Me → Brands you follow ----------
export async function followingPage() {
  const { app, api, esc, toast } = ctx;
  app.innerHTML = '<h1>Brands you follow</h1><p class="muted">Loading…</p>';
  const d = await api('/api/me/follows');
  app.innerHTML = `<h1>Brands you follow</h1>
    <p class="lead small">You hear about every new deal from these brands (when brand deal alerts are on in Settings → Alerts).</p>
    ${d.brands.length ? `<div class="stack">${d.brands.map((b) => `<div class="card bfollow" data-b="${esc(b.id)}">
        <div class="row">${logoBadge(b, 'small')}<span class="n" style="flex:1;min-width:0"><b>${esc(b.name)}</b>
          <span class="small muted" style="display:block">${b.confirmed ? 'Partner' : 'Beta demo'}${b.host ? ` · ${esc(b.host)}` : ''}</span></span>
          <button class="btn small light" data-unf="${esc(b.id)}">Unfollow</button></div>
        ${b.campaigns.length ? b.campaigns.map((c) => `<a class="bfollow-deal" href="#/brand/${encodeURIComponent(c.id)}"><span><b>${esc(c.offer)}</b><span class="small muted" style="display:block">${esc(c.title)} · <span class="${soon(c.endsAt) ? 'hot' : ''}">${endsText(c.endsAt)}</span></span></span><span aria-hidden="true">›</span></a>`).join('')
          : '<p class="small muted" style="margin:8px 0 0">No deal right now. We\'ll tell you when there\'s a new one.</p>'}
      </div>`).join('')}</div>`
      : '<div class="empty"><b>You don\'t follow any brands yet</b>Tap <b>+ Follow brand</b> on a deal in Your Brands, Your Deals on Home.<p style="margin:10px 0 0"><a class="btn small" href="#/">Go to Home</a></p></div>'}`;
  app.querySelectorAll('[data-unf]').forEach((btn) => (btn.onclick = async () => {
    const b = d.brands.find((x) => x.id === btn.dataset.unf);
    try {
      await api(`/api/brands/${encodeURIComponent(b.id)}/follow`, { method: 'PUT', body: { on: false } });
      toast(`Unfollowed ${b.name}`, { label: 'Undo', run: () => api(`/api/brands/${encodeURIComponent(b.id)}/follow`, { method: 'PUT', body: { on: true } }).then(() => followingPage()) });
      followingPage();
    } catch (e) { toast(e.message); }
  }));
}

// ---------- How Fair Whack makes money ----------
export function earnPage() {
  ctx.app.innerHTML = `<h1>How Fair Whack makes money</h1><div class="card stack">
    <p><b>Fair Whack is built around your list.</b> We help you find the right products for your household at the best price, and help good brands reach people who are already looking for what they sell.</p>
    <p><b>Your Brands, Your Deals</b> on Home shows offers from partner brands. Every partner offer is marked <span class="partner inline">Partner</span>. Partners may pay us a fee for the placement, or a commission when you buy after tapping through.</p>
    <p><b>What payment never changes:</b> search results, “same product in other stores”, store comparisons, Bargains and Top 20. On a partner's page we still show other stores' prices for the same product, even when another store is cheaper.</p>
    <p><b>Who can be a partner:</b> known brands and official stores only, with real offers (lower than their recent usual price, or an extra you can't get elsewhere), in categories our users shop for.</p>
    <p><b>You're in control:</b> follow brands you like, choose “Not interested” to hide a brand for 90 days, or turn off brand deal alerts in Settings → Alerts.</p>
    <p class="small muted">During the beta no brand pays Fair Whack and there is no cashback. Deals marked <b>Beta demo</b> are picked by the Fair Whack team to test this section: those brands are not partners, have not reviewed the pages, and any extra Fair Whack discount shown on them is simulated and not available.</p></div>`;
}

// ---------- Settings → Alerts: brand deal alerts, followed and hidden brands ----------
export async function alertsBox(el) {
  const { api, esc, toast } = ctx;
  const d = await api('/api/me/brand-alerts').catch(() => null);
  if (!d) { el.innerHTML = ''; return; }
  el.innerHTML = `<h2>Brand deals</h2><div class="card stack">
    <label class="row switch-row"><span style="flex:1"><b>Brand deal alerts</b><span class="small muted" style="display:block">At most one a week, only for partner deals that closely match your list and household. Brands you follow tell you about every new deal.</span></span>
      <input type="checkbox" id="balerts" ${d.on ? 'checked' : ''}></label>
    ${d.follows.length ? `<div><b class="small">Following</b> <a class="small" href="#/following">See all</a><div class="bchips">${d.follows.map((b) => `<span class="chip">${esc(b.name)} <button class="linkbtn" data-unf="${esc(b.id)}" aria-label="Unfollow ${esc(b.name)}">✕</button></span>`).join('')}</div></div>` : ''}
    ${d.hidden.length ? `<div><b class="small">Not interested</b><div class="bchips">${d.hidden.map((b) => `<span class="chip">${esc(b.name)} <span class="muted small">until ${new Date(b.until).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span> <button class="linkbtn" data-unh="${esc(b.id)}" aria-label="Show ${esc(b.name)} again">✕</button></span>`).join('')}</div></div>` : ''}
    <p class="small muted">${esc(DISCLOSURE)} <a href="#/earn">How Fair Whack makes money</a></p></div>`;
  $('#balerts', el).onchange = async (e) => { try { await api('/api/me/brand-alerts', { method: 'PUT', body: { on: e.target.checked } }); toast(e.target.checked ? 'Brand deal alerts on' : 'Brand deal alerts off'); } catch (err) { toast(err.message); } };
  el.querySelectorAll('[data-unf]').forEach((b) => (b.onclick = async () => { await api(`/api/brands/${encodeURIComponent(b.dataset.unf)}/follow`, { method: 'PUT', body: { on: false } }); alertsBox(el); }));
  el.querySelectorAll('[data-unh]').forEach((b) => (b.onclick = async () => { await api(`/api/brands/${encodeURIComponent(b.dataset.unh)}/hide`, { method: 'PUT', body: { on: false } }); alertsBox(el); }));
}

// ================= Admin =================
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const CHECK_LABEL = { known: 'Well-known brand', official: 'Links to the official site or an authorised retailer', real_offer: 'Offer is real: below the recent usual price, or an exclusive extra', overlap: 'Category overlaps what testers have on their lists' };
const STATUS_LABEL = { draft: 'Draft', live: 'Live', paused: 'Paused', ended: 'Ended' };

export async function adminPage() {
  const { app, api, esc, state } = ctx;
  if (!state.me?.isAdmin) { app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/admin/brands');
  const live = d.campaigns.filter((c) => c.live);
  app.innerHTML = `<h1>Brand deals</h1>
    <p class="lead small">“Your Brands, Your Deals” on Home. Mode: <b>${d.zone.mode === 'fixed' ? `same ${d.zone.size} live campaigns for everyone` : 'matched to each person'}</b> · ${live.length} live${live.length > d.zone.size ? ` (only the first ${d.zone.size} by priority show)` : ''}.</p>
    <div class="row"><h2 style="flex:1">Campaigns</h2><a class="btn small" href="#/admincampaign/new">+ New campaign</a></div>
    <div class="card" style="overflow-x:auto"><table class="t"><tr><th>Campaign</th><th>Status</th><th>Dates</th><th title="People who saw it on Home">Seen</th><th>Clicks</th><th title="Clicks ÷ daily views">CTR</th><th title="Added to a list from the page">Listed</th><th>Follows</th><th>Shares</th><th title="Not interested">Hidden</th><th title="Share-page opens by people not signed in">Opens</th></tr>
      ${d.campaigns.map((c) => `<tr><td class="bcol"><a href="#/admincampaign/${esc(c.id)}"><b>${esc(c.brand_name)}</b> · ${esc(c.title)}</a><div class="small muted">${c.brand_confirmed ? 'Partner' : 'Beta demo'} · ${esc(d.kinds[c.kind])} · priority ${c.priority}</div></td>
        <td><span class="bstatus ${c.live ? 'live' : c.status}">${c.live ? 'Live' : c.status === 'live' ? 'Scheduled' : STATUS_LABEL[c.status]}</span></td>
        <td class="small nowrap">${sday(c.starts_at)} – ${sday(c.ends_at)}</td>
        <td class="num">${c.stats.views}</td><td class="num">${c.stats.clicks}</td><td class="num">${pct(c.stats.ctr)}</td><td class="num">${c.stats.wish}</td>
        <td class="num">${c.stats.follow}</td><td class="num">${c.stats.share}</td><td class="num ${c.stats.hideRate > 0.2 ? 'hot' : ''}">${c.stats.hide}${c.stats.views ? ` <span class="muted">(${pct(c.stats.hideRate)})</span>` : ''}</td><td class="num">${c.stats.opens}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">No campaigns yet</td></tr>'}</table></div>
    <p class="small muted">“Hidden” is the share of people who saw it and chose Not interested: the main check that a deal suits its audience.</p>
    <div class="row"><h2 style="flex:1">Brands</h2><button class="btn small" id="newbrand">+ New brand</button></div>
    <div class="card list-rows">${d.brands.map((b) => `<button class="r brow-admin" data-b="${esc(b.id)}">${logoBadge({ name: b.name, logo: b.logo_url, color: b.color }, 'small')}<span class="n"><b>${esc(b.name)}</b><span class="small muted">${b.confirmed ? 'Partner' : 'Beta demo'} · ${esc((b.website || '').replace(/^https?:\/\/(www\.)?/, ''))} · ${b.followers} following</span></span><span class="bstatus ${b.status}">${esc(b.status)}</span></button>`).join('') || '<p class="small muted">No brands yet. Add a brand first, then its campaigns.</p>'}</div>`;
  $('#newbrand').onclick = () => brandSheet({}, d);
  app.querySelectorAll('[data-b]').forEach((x) => (x.onclick = () => brandSheet(d.brands.find((b) => b.id === x.dataset.b), d)));
}

async function upload(file, max) {
  const { dataUrl } = await ctx.shrink(file, max);
  return (await ctx.api('/api/admin/assets', { method: 'POST', body: { dataUrl } })).url;
}
function imageField(name, label, value, max) {
  const { esc } = ctx;
  return `<div class="field"><label>${label}</label><div class="row"><input name="${name}" value="${esc(value || '')}" placeholder="https://… or upload" style="flex:1"><button type="button" class="btn small light" data-up="${name}" data-max="${max}">Upload</button></div>
    <div class="bpreview" data-prev="${name}">${value ? `<img src="${esc(value)}" alt="">` : ''}</div></div>`;
}
function bindUploads(form) {
  form.querySelectorAll('[data-up]').forEach((b) => (b.onclick = async () => {
    const file = await ctx.pickFile(false);
    if (!file) return;
    b.disabled = true; b.textContent = '…';
    try {
      const url = await upload(file, Number(b.dataset.max));
      form.elements[b.dataset.up].value = url;
      form.querySelector(`[data-prev="${b.dataset.up}"]`).innerHTML = `<img src="${url}" alt="">`;
    } catch (e) { ctx.toast(e.message); }
    b.disabled = false; b.textContent = 'Upload';
  }));
}

function brandSheet(b, d) {
  const { sheet, esc, api, toast } = ctx;
  const checks = b.checks || {};
  sheet(`<h3>${b.id ? 'Edit brand' : 'New brand'}</h3><form id="bf" class="stack">
    <div class="field"><label>Brand name</label><input name="name" value="${esc(b.name || '')}" required></div>
    <div class="field"><label>Website</label><input name="website" value="${esc(b.website || '')}" placeholder="https://www.example.com.au"></div>
    ${imageField('logo', 'Logo (square or wide, shown on a coloured tab)', b.logo_url, 400)}
    <div class="field"><label>Tab colour behind the logo</label><input name="color" type="color" value="${esc(b.color || '#FFFFFF')}"></div>
    <div class="field"><label>Contact</label><input name="contact" value="${esc(b.contact || '')}" placeholder="Name, email"></div>
    <fieldset class="field"><legend>Admission checks (all four to approve)</legend>${d.checks.map((k) => `<label class="row small"><input type="checkbox" name="ck_${k}" ${checks[k] ? 'checked' : ''}> ${CHECK_LABEL[k]}</label>`).join('')}</fieldset>
    <label class="row small"><input type="checkbox" name="confirmed" ${b.confirmed ? 'checked' : ''}> <span><b>Arrangement confirmed with the brand</b> (shows as Partner, allows public share links and push alerts). Leave unticked for beta demos.</span></label>
    <div class="field"><label>Status</label><select name="status">${['pending', 'approved', 'paused'].map((s) => `<option ${b.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
    <div class="field"><label>Notes</label><textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></div>
    <div class="err" id="berr"></div>
    <button class="btn">Save brand</button></form>`, (s, close) => {
    const f = $('#bf', s);
    bindUploads(f);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const v = Object.fromEntries(new FormData(f));
      try {
        await api('/api/admin/brands', { method: 'POST', body: { id: b.id, ...v, confirmed: !!v.confirmed, checks: Object.fromEntries(d.checks.map((k) => [k, !!v[`ck_${k}`]])) } });
        close(); toast('Brand saved'); adminPage();
      } catch (err) { $('#berr', s).textContent = err.message; }
    };
  });
}

const toLocal = (iso) => { if (!iso) return ''; const t = new Date(iso); return new Date(t.getTime() - t.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export async function campaignEditor(id) {
  const { app, api, esc, toast, state, money, RET } = ctx;
  if (!state.me?.isAdmin) { app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  app.innerHTML = '<p class="muted">Loading…</p>';
  const d = await api('/api/admin/brands');
  const c = id && id !== 'new' ? await api(`/api/admin/campaigns/${encodeURIComponent(id)}`) : { kind: 'brand', add_utm: 1, priority: 0, status: 'draft', tags: { categories: [], brands: [] }, products: [], starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 14 * 86400000).toISOString() };
  if (!d.brands.length) { app.innerHTML = '<h1>New campaign</h1><div class="empty"><b>Add a brand first</b><a href="#/adminbrands">Admin → Brand deals</a></div>'; return; }
  const t = c.target || {};
  const opts = (name, list, sel, labels = {}) => list.map((x) => `<label class="chip pick"><input type="checkbox" name="${name}" value="${esc(x)}" ${sel?.includes(x) ? 'checked' : ''}>${esc(labels[x] || x)}</label>`).join('');
  let prods = c.products.map((p) => ({ id: p.id, name: p.name, image_url: p.image_url || '', price: p.price_cents != null ? (p.price_cents / 100).toFixed(2) : '', was: p.was_cents != null ? (p.was_cents / 100).toFixed(2) : '', url: p.url || '', compare: p.compare || [] }));
  const live = c.status === 'live';
  app.innerHTML = `<p><a href="#/adminbrands">‹ Brand deals</a></p>
    <h1>${c.id ? esc(c.title) : 'New campaign'} ${c.id ? `<span class="bstatus ${c.status}">${STATUS_LABEL[c.status]}</span>` : ''}</h1>
    <form id="cf" class="stack">
      <div class="card stack"><h3>Basics</h3>
        <div class="field"><label>Brand</label><select name="brand_id">${d.brands.map((b) => `<option value="${esc(b.id)}" ${c.brand_id === b.id ? 'selected' : ''}>${esc(b.name)}${b.status !== 'approved' ? ` (${b.status})` : ''}</option>`).join('')}</select></div>
        <div class="field"><label>Type</label><select name="kind">${Object.entries(d.kinds).map(([k, l]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="field"><label>Campaign name (page title)</label><input name="title" value="${esc(c.title || '')}" maxlength="80" required placeholder="Summer Sale"></div>
        <div class="field"><label>Offer in one line (card)</label><input name="offer" value="${esc(c.offer || '')}" maxlength="120" required placeholder="Up to 40% off running shoes"></div>
        <div class="field"><label>Default reason (when nothing personal matches)</label><input name="reason" value="${esc(c.reason || '')}" maxlength="100" placeholder="Hand-picked by Fair Whack"></div>
        ${imageField('image_url', 'Main image (wide, about 2:1)', c.image_url, 1200)}
        <div class="field"><label>Landing page</label><input name="landing_url" value="${esc(c.landing_url || '')}" required placeholder="https://…"></div>
        <label class="row small"><input type="checkbox" name="add_utm" ${c.add_utm ? 'checked' : ''}> Add Fair Whack tracking tags (utm_source=fairwhack). Untick for affiliate links.</label>
        <div class="row"><div class="field" style="flex:1"><label>Starts</label><input type="datetime-local" name="starts_at" value="${toLocal(c.starts_at)}" required></div>
          <div class="field" style="flex:1"><label>Ends</label><input type="datetime-local" name="ends_at" value="${toLocal(c.ends_at)}" required></div></div>
        <div class="field"><label>Priority (higher shows first)</label><input type="number" name="priority" value="${c.priority || 0}" min="-99" max="99"></div>
      </div>
      <div class="card stack"><h3>Offer details</h3>
        <div class="field"><label>What the offer is</label><textarea name="details" rows="3" maxlength="1500">${esc(c.details || '')}</textarea></div>
        <div class="field"><label>Fair Whack exclusive code (only if there is one)</label><input name="code" value="${esc(c.code || '')}" maxlength="40"></div>
        <div class="field"><label>Other extra (only if there is one)</label><input name="perk" value="${esc(c.perk || '')}" maxlength="200" placeholder="Free shipping on orders over $50"></div>
        <div class="field"><label>Terms</label><textarea name="terms" rows="3" maxlength="2000">${esc(c.terms || '')}</textarea></div>
      </div>
      <div class="card stack"><h3>Matching</h3><p class="small muted">Used for the reason on each card, and for alerts. While the mode is “same for everyone”, tags don't decide who sees the campaign.</p>
        <div class="field"><label>Categories</label><div class="bchips">${opts('categories', d.categories, c.tags?.categories)}</div></div>
        <div class="field"><label>Brand names as they appear on products (comma separated)</label><input name="brand_tags" value="${esc((c.tags?.brands || []).join(', '))}" placeholder="adidas, Adidas Originals"></div>
        <div class="field"><label>Household size</label><div class="bchips">${opts('sizes', ['1', '2', '3', '4', '5+'], t.sizes)}</div></div>
        <div class="field"><label>Age</label><div class="bchips">${opts('ages', ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'], t.ages)}</div></div>
        <div class="field"><label>Kids at home</label><select name="kids"><option value="">Doesn't matter</option><option value="yes" ${t.kids === true ? 'selected' : ''}>Yes</option><option value="no" ${t.kids === false ? 'selected' : ''}>No</option></select></div>
        <div class="field"><label>Pets</label><div class="bchips">${opts('pets', ['dog', 'cat', 'other'], t.pets, { dog: 'Dog', cat: 'Cat', other: 'Other pets' })}</div></div>
      </div>
      <div class="card stack"><div class="row"><h3 style="flex:1">Featured products</h3><button type="button" class="btn small light" id="addp">+ Add product</button></div>
        <p class="small muted">Link each one to the same product in Fair Whack so testers see other stores' prices, even when they're cheaper.</p>
        <div id="plist" class="stack"></div></div>
      <div class="err" id="cerr"></div>
      <div class="row bsave"><button class="btn" style="flex:1">Save</button>
        ${c.id ? `${live ? '<button type="button" class="btn light" data-st="paused">Pause</button>' : '<button type="button" class="btn ticket" data-st="live">Save and go live</button>'}
        <a class="btn light" href="#/brand/${esc(c.id)}">Preview</a>` : ''}</div>
      ${c.id ? `<div class="row small">${!live ? '<button type="button" class="linkbtn" data-st="ended">Mark ended</button> · <button type="button" class="linkbtn danger" id="cdel">Delete</button>' : '<button type="button" class="linkbtn" data-st="ended">End now</button>'}</div>` : ''}
    </form>`;
  const f = $('#cf');
  bindUploads(f);
  const drawProds = () => {
    $('#plist').innerHTML = prods.map((p, i) => `<div class="card flat stack bp-edit" data-i="${i}">
      <div class="row"><b style="flex:1">Product ${i + 1}</b><button type="button" class="linkbtn" data-pdel="${i}">Remove</button></div>
      <div class="field"><label>Name</label><input data-k="name" value="${esc(p.name)}"></div>
      <div class="field"><label>Image link (optional)</label><input data-k="image_url" value="${esc(p.image_url)}" placeholder="https://…"></div>
      <div class="row"><div class="field" style="flex:1"><label>Price on site ($)</label><input data-k="price" inputmode="decimal" value="${esc(p.price)}"></div><div class="field" style="flex:1"><label>Was ($)</label><input data-k="was" inputmode="decimal" value="${esc(p.was)}"></div></div>
      <div class="field"><label>Product link</label><input data-k="url" value="${esc(p.url)}" placeholder="https://…"></div>
      <div class="small"><b>Same product in Fair Whack</b> ${p.compare.length ? p.compare.map((o, j) => `<span class="chip">${esc(RET[o.retailer] || o.retailer || '')} ${esc(o.name)} ${o.effective != null ? money(o.effective) : ''} <button type="button" class="linkbtn" data-unlink="${i}:${j}">✕</button></span>`).join('') : '<span class="muted">none linked</span>'}</div>
      <div class="row"><input data-find="${i}" placeholder="Search Fair Whack products to link" style="flex:1"><button type="button" class="btn small light" data-go="${i}">Search</button></div>
      <div data-res="${i}" class="stack"></div></div>`).join('') || '<p class="small muted">No featured products.</p>';
  };
  drawProds();
  const sync = () => f.querySelectorAll('.bp-edit').forEach((el) => { const p = prods[Number(el.dataset.i)]; el.querySelectorAll('[data-k]').forEach((x) => (p[x.dataset.k] = x.value)); });
  $('#addp').onclick = () => { sync(); prods.push({ name: '', image_url: '', price: '', was: '', url: '', compare: [] }); drawProds(); };
  $('#plist').onclick = async (e) => {
    const del = e.target.closest('[data-pdel]'), un = e.target.closest('[data-unlink]'), go = e.target.closest('[data-go]'), pick = e.target.closest('[data-pick]');
    if (del) { sync(); prods.splice(Number(del.dataset.pdel), 1); drawProds(); }
    if (un) { sync(); const [i, j] = un.dataset.unlink.split(':').map(Number); prods[i].compare.splice(j, 1); drawProds(); }
    if (go) {
      const i = Number(go.dataset.go), q = f.querySelector(`[data-find="${i}"]`).value.trim();
      if (!q) return;
      const r = await api(`/api/search?q=${encodeURIComponent(q)}&log=0`).catch((err) => ({ groups: [], error: err.message }));
      f.querySelector(`[data-res="${i}"]`).innerHTML = r.groups.slice(0, 8).map((g) => `<button type="button" class="r small bpick" data-pick="${i}" data-id="${esc(g.best.id)}" data-name="${esc(g.name)}" data-ret="${esc(g.best.retailer)}" data-price="${g.best.effective ?? ''}">${esc(g.name)} ${esc(g.size || '')} · ${g.offers.length} store${g.offers.length > 1 ? 's' : ''} from ${money(g.best.effective)}</button>`).join('') || '<span class="small muted">Nothing found</span>';
    }
    if (pick) {
      sync();
      const p = prods[Number(pick.dataset.pick)];
      if (!p.compare.some((o) => o.id === pick.dataset.id)) p.compare.push({ id: pick.dataset.id, name: pick.dataset.name, retailer: pick.dataset.ret, effective: pick.dataset.price ? Number(pick.dataset.price) : null });
      if (!p.name) p.name = pick.dataset.name;
      drawProds();
    }
  };
  const save = async () => {
    sync();
    const v = new FormData(f);
    const all = (k) => v.getAll(k);
    const body = {
      id: c.id, brand_id: v.get('brand_id'), kind: v.get('kind'), title: v.get('title'), offer: v.get('offer'), reason: v.get('reason'), image_url: v.get('image_url'),
      landing_url: v.get('landing_url'), add_utm: !!v.get('add_utm'), starts_at: new Date(v.get('starts_at')).toISOString(), ends_at: new Date(v.get('ends_at')).toISOString(),
      priority: v.get('priority'), details: v.get('details'), code: v.get('code'), perk: v.get('perk'), terms: v.get('terms'),
      categories: all('categories'), brand_tags: v.get('brand_tags'),
      target: { sizes: all('sizes'), ages: all('ages'), pets: all('pets'), kids: v.get('kids') === 'yes' ? true : v.get('kids') === 'no' ? false : null },
      products: prods.map((p) => ({ id: p.id, name: p.name, image_url: p.image_url, price: p.price, was: p.was, url: p.url, compare_ids: p.compare.map((o) => o.id) })),
    };
    const r = await api('/api/admin/campaigns', { method: 'POST', body });
    return r.id;
  };
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { const nid = await save(); toast('Saved'); if (!c.id) location.hash = `#/admincampaign/${nid}`; else campaignEditor(nid); } catch (err) { $('#cerr').textContent = err.message; }
  };
  f.querySelectorAll('[data-st]').forEach((b) => (b.onclick = async () => {
    try {
      if (b.dataset.st === 'live') await save();
      const r = await api(`/api/admin/campaigns/${encodeURIComponent(c.id)}/status`, { method: 'POST', body: { status: b.dataset.st } });
      toast(b.dataset.st === 'live' ? (r.alerts?.demo ? 'Live as a beta demo (no push alerts)' : r.alerts ? `Live · ${r.alerts.sent} brand alert${r.alerts.sent === 1 ? '' : 's'} sent` : 'Scheduled: goes live on its start date') : 'Saved');
      campaignEditor(c.id);
    } catch (err) { $('#cerr').textContent = err.message; }
  }));
  const del = $('#cdel');
  if (del) del.onclick = async () => { if (!confirm('Delete this campaign? Its figures stay in the totals.')) return; await api(`/api/admin/campaigns/${encodeURIComponent(c.id)}`, { method: 'DELETE' }); location.hash = '#/adminbrands'; };
}

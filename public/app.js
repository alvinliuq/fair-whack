// Fair Whack beta — single-page app (no build step).
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const RET = { woolworths: 'Woolworths', coles: 'Coles', aldi: 'ALDI', costco: 'Costco' };
const state = { me: null, meta: null, lists: null };

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (c) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);
const unitText = (p) => {
  if (p.unit == null || !p.unitBasis) return p.retailerUnit || '';
  return `${money(p.unit)} / ${p.unitBasis === 'each' ? 'each' : p.unitBasis}`;
};
const ago = (iso) => {
  if (!iso) return '';
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 14 ? `${d} days ago` : new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};
const initials = (n) => esc(String(n || '?').replace(/[^A-Za-z ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?');
const thumb = (p) => `<div class="thumb">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ph',textContent:'${initials(p.brand || p.name)}'}))">` : `<span class="ph">${initials(p.brand || p.name)}</span>`}</div>`;

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) { state.me = null; location.hash = '#/login'; throw new Error('Please sign in'); }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function badges(p, { stale = true } = {}) {
  const b = [];
  if (p.promoType === 'half_price') b.push('<span class="badge b-half">½ PRICE</span>');
  else if (p.special) b.push(`<span class="badge b-promo">${esc(p.multibuy ? p.promoText || 'Multibuy' : p.promoText || 'Special')}</span>`);
  if (p.discountFlag === 'low12') b.push('<span class="badge b-low">12-wk low</span>');
  if (p.discountFlag === 'inflated') b.push('<span class="badge b-inflated" title="The “was” price is higher than its usual price">Was price inflated</span>');
  if (stale && p.stale) b.push(`<span class="badge b-stale">Checked ${ago(p.checkedAt)}</span>`);
  return b.length ? `<div class="badges">${b.join('')}</div>` : '';
}

function tile(p) {
  return `<a class="tile" href="#/p/${encodeURIComponent(p.id)}">
    ${thumb(p)}${badges(p)}
    <span class="ret ${p.retailer}">${RET[p.retailer]}</span>
    <div class="name">${esc(p.name)}</div>
    <div class="foot">
      <div class="price num">${money(p.effective)}${p.was ? `<small>${money(p.was)}</small>` : ''}</div>
      ${p.multibuy ? `<div class="unit">${esc(p.promoText)} · ${money(p.price)} for 1</div>` : ''}
      <div class="unit num">${esc(unitText(p))}${p.perUse ? ` · ${money(p.perUse)}/use` : ''}</div>
    </div>
  </a>`;
}

function offerRow(o, best) {
  const save = o.saving ? `<span class="note">Save ${money(o.saving)}</span>` : '';
  return `<a class="offer ${best ? 'best' : ''}" href="#/p/${encodeURIComponent(o.id)}">
    <div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span>${badges(o)}${best ? '<span class="tag-best">Cheapest</span>' : ''}</div>
    <div class="p num">${money(o.effective)}</div>
    <div class="note">${o.was ? `was ${money(o.was)} ` : ''}${save}${o.source === 'user_report' ? ' Reported by a tester' : ''}${o.source === 'manual' ? ' Entered manually' : ''}</div>
    <div class="u num">${esc(unitText(o))}${o.perUse ? ` · ${money(o.perUse)}/use` : ''}</div>
  </a>`;
}

function loading(n = 4) { app.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`; }
function fail(e) { app.innerHTML = `<div class="empty"><b>Something went wrong</b>${esc(e.message)}<p><button class="btn small light" onclick="location.reload()">Try again</button></p></div>`; }

// ---------- views ----------
const views = {};

views.login = () => {
  document.body.classList.add('anon');
  app.innerHTML = `<form class="login stack" id="f">
    <img class="logo" src="/icons/icon-192.png" alt="">
    <h1>Fair Whack</h1>
    <p class="lead">Compare Woolworths, Coles, ALDI and Costco prices, and get told when things you buy go on special. Internal beta.</p>
    <div class="field"><label for="name">Your name</label><input id="name" name="name" autocomplete="name" placeholder="e.g. Sam Nguyen" required></div>
    <div class="field"><label for="code">Invite code</label><input id="code" name="code" autocomplete="off" autocapitalize="off" required></div>
    <div class="err" id="err"></div>
    <button class="btn block">Sign in</button>
    <p class="small muted">Use the same name on every device to keep your lists. Prices are collected weekly and may differ in store.</p>
  </form>`;
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api('/api/login', { method: 'POST', body: { name: fd.get('name'), code: fd.get('code') } });
      void r;
      state.me = null; // route() reloads the profile (incl. push key)
      document.body.classList.remove('anon');
      if (location.hash === '#/') route(); else location.hash = '#/';
    } catch (err) { $('#err').textContent = err.message; }
  };
};

views.home = async () => {
  loading();
  try {
    const [d, meta] = await Promise.all([api('/api/digest'), state.meta || api('/api/meta')]);
    state.meta = meta;
    const upd = meta.retailers.filter((r) => ['woolworths', 'coles'].includes(r.retailer)).map((r) => `${RET[r.retailer]} ${ago(r.updated)}`).join(' · ');
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    app.innerHTML = `
      <h1>G'day ${esc(state.me.name.split(' ')[0])}</h1>
      <p class="lead small">${upd ? `Prices updated: ${upd}` : 'Waiting for the first price update.'}</p>
      ${!standalone && /iPhone|iPad/.test(navigator.userAgent) ? `<a class="notice info" style="display:block;text-decoration:none" href="#/install"><b>Add Fair Whack to your Home Screen</b> to get special alerts on iPhone →</a>` : ''}
      <h2>From your list this week <a href="#/lists">My list</a></h2>
      ${d.fromYourList.length ? `<div class="grid">${d.fromYourList.map(tile).join('')}</div>` : `<div class="card flat empty"><b>Nothing from your list is on special</b>Search a product and tap ♡ to watch it.<p><a class="btn small" href="#/search">Find products</a></p></div>`}
      <h2>Best half-price deals <a href="#/specials?half=1">See all</a></h2>
      ${d.topHalfPrice.length ? `<div class="grid">${d.topHalfPrice.map(tile).join('')}</div>` : '<div class="empty">No half-price specials loaded yet.</div>'}`;
  } catch (e) { fail(e); }
};

views.specials = async (q) => {
  const f = { retailer: q.get('retailer') || '', category: q.get('category') || '', half: q.get('half') === '1', sort: q.get('sort') || 'saving', real: q.get('real') === '1' };
  const meta = state.meta || (state.meta = await api('/api/meta').catch(() => ({ categories: [] })));
  const link = (patch) => {
    const n = { ...f, ...patch };
    const s = new URLSearchParams();
    if (n.retailer) s.set('retailer', n.retailer);
    if (n.category) s.set('category', n.category);
    if (n.half) s.set('half', '1');
    if (n.real) s.set('real', '1');
    if (n.sort !== 'saving') s.set('sort', n.sort);
    return `#/specials${s.toString() ? '?' + s : ''}`;
  };
  app.innerHTML = `<h1>Specials</h1>
    <div class="chips">
      <a class="chip ${!f.retailer ? 'on' : ''}" href="${link({ retailer: '' })}">All stores</a>
      ${['woolworths', 'coles', 'aldi'].map((r) => `<a class="chip ${f.retailer === r ? 'on' : ''}" href="${link({ retailer: r })}">${RET[r]}</a>`).join('')}
      <a class="chip ticket ${f.half ? 'on' : ''}" href="${link({ half: !f.half })}">½ price only</a>
      <a class="chip ${f.real ? 'on' : ''}" href="${link({ real: !f.real })}" title="Hide specials where the “was” price looks inflated">Genuine only</a>
    </div>
    <div class="chips">
      <a class="chip ${!f.category ? 'on' : ''}" href="${link({ category: '' })}">All aisles</a>
      ${(meta.categories || []).filter((c) => c !== 'Liquor').map((c) => `<a class="chip ${f.category === c ? 'on' : ''}" href="${link({ category: c })}">${esc(c)}</a>`).join('')}
    </div>
    <div class="row" style="margin:4px 0 12px"><span class="small muted">Sort</span>
      <div class="seg">${[['saving', 'Biggest saving'], ['unit', 'Unit price'], ['price', 'Price']].map(([k, l]) => `<button data-sort="${k}" class="${f.sort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    </div>
    <div id="res"><div class="grid">${'<div class="skeleton"></div>'.repeat(4)}</div></div>`;
  app.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => (location.hash = link({ sort: b.dataset.sort }))));
  const res = $('#res');
  let page = 0;
  const load = async () => {
    const s = new URLSearchParams({ page });
    if (f.retailer) s.set('retailer', f.retailer);
    if (f.category) s.set('category', f.category);
    if (f.half) s.set('half', '1');
    if (f.real) s.set('real', '1');
    s.set('sort', f.sort);
    const d = await api(`/api/specials?${s}`);
    if (page === 0) res.innerHTML = d.items.length ? '<div class="grid" id="g"></div>' : '<div class="empty"><b>No specials here</b>Try another store or aisle.</div>';
    const g = $('#g', res);
    if (g) g.insertAdjacentHTML('beforeend', d.items.map(tile).join(''));
    $('#more', res)?.remove();
    if (d.more) {
      res.insertAdjacentHTML('beforeend', '<p class="center"><button class="btn light" id="more">Load more</button></p>');
      $('#more').onclick = () => { page++; load().catch(fail); };
    }
  };
  load().catch(fail);
};

views.search = async (q) => {
  const term = q.get('q') || '';
  const sort = q.get('sort') || 'price';
  $('#topsearch input').value = term;
  if (!term) {
    app.innerHTML = `<h1>Compare prices</h1><p class="lead">Search for something you buy. We line up the same product across stores, and show the cheapest per 100g, per litre or per item.</p>
      <form id="sf" class="field"><input type="search" name="q" placeholder="e.g. milk 2L, Tim Tam, dishwasher tablets" enterkeyhint="search" autofocus></form>
      <h2>Try</h2><div class="chips" style="flex-wrap:wrap">${['milk', 'eggs', 'bread', 'coffee', 'toilet paper', 'laundry liquid', 'nappies', 'peanut butter'].map((t) => `<a class="chip" href="#/search?q=${encodeURIComponent(t)}">${t}</a>`).join('')}</div>`;
    $('#sf').onsubmit = (e) => { e.preventDefault(); const v = new FormData(e.target).get('q').trim(); if (v) location.hash = `#/search?q=${encodeURIComponent(v)}`; };
    return;
  }
  app.innerHTML = `<h1>“${esc(term)}”</h1>
    <div class="row" style="margin:4px 0 12px"><span class="small muted">Sort</span>
      <div class="seg"><button data-s="price" class="${sort === 'price' ? 'on' : ''}">Cheapest</button><button data-s="unit" class="${sort === 'unit' ? 'on' : ''}">Best unit price</button></div></div>
    <div id="res"><div class="skeleton"></div></div>`;
  app.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => (location.hash = `#/search?q=${encodeURIComponent(term)}&sort=${b.dataset.s}`)));
  try {
    const d = await api(`/api/search?q=${encodeURIComponent(term)}&sort=${sort}`);
    $('#res').innerHTML = d.groups.length ? d.groups.map((g) => `<div class="group">
        <a class="group-head" href="#/p/${encodeURIComponent(g.best.id)}">${thumb(g.best)}<div class="t"><div class="name">${esc(g.name)}</div><div class="small muted">${esc(g.size || '')}${g.offers.length > 1 ? ` · ${g.offers.length} stores` : ''}</div></div></a>
        ${g.offers.map((o, i) => offerRow(o, i === 0 && g.offers.length > 1 && (g.offers[1].effective ?? 1e12) > (o.effective ?? 0))).join('')}
      </div>`).join('') : `<div class="empty"><b>No matches yet</b>The beta only covers products we've already collected (about 3,000 per store). Try a shorter word.</div>`;
  } catch (e) { fail(e); }
};

function sparkline(history) {
  if (history.length < 2) return '<p class="small muted">Price history builds up week by week.</p>';
  const byRet = {};
  for (const h of history) (byRet[h.product_id.split(':')[0]] ||= []).push(h);
  const all = history.map((h) => h.price_cents);
  const t0 = Date.parse(history[0].captured_at), t1 = Math.max(Date.parse(history[history.length - 1].captured_at), t0 + 1);
  const lo = Math.min(...all), hi = Math.max(...all), span = Math.max(hi - lo, 1);
  const W = 320, H = 80, P = 6;
  const x = (t) => P + ((Date.parse(t) - t0) / (t1 - t0)) * (W - 2 * P);
  const y = (c) => H - P - ((c - lo) / span) * (H - 2 * P);
  const col = { woolworths: 'var(--woolworths)', coles: 'var(--coles)', aldi: 'var(--aldi)', costco: 'var(--costco)' };
  const lines = Object.entries(byRet).map(([r, hs]) => `<polyline fill="none" stroke="${col[r]}" stroke-width="2" stroke-linejoin="round" points="${hs.map((h) => `${x(h.captured_at).toFixed(1)},${y(h.price_cents).toFixed(1)}`).join(' ')}"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price over the last 12 weeks">${lines}</svg>
    <div class="row small muted"><span>${new Date(t0).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span><span class="spacer"></span><span>Low ${money(lo)} · High ${money(hi)}</span></div>`;
}

views.product = async (q, id) => {
  loading(1);
  try {
    const d = await api(`/api/product/${encodeURIComponent(id)}`);
    const p = d.product;
    const best = d.offers[0];
    const saved = d.saved[0];
    app.innerHTML = `
      <div class="hero">${thumb(p)}<div><span class="ret ${p.retailer}">${RET[p.retailer]}</span><h1>${esc(p.name)}</h1><div class="small muted">${esc(p.size || '')}${p.brand ? ` · ${esc(p.brand)}` : ''}</div>${badges(p, { stale: false })}</div></div>
      <div class="facts">
        <div class="fact"><b class="num">${money(p.effective)}</b><span>${p.was ? `was ${money(p.was)}` : 'Current price'}${p.multibuy ? ` · ${esc(p.promoText)}` : ''}</span></div>
        <div class="fact"><b class="num">${esc(unitText(p) || '—')}</b><span>Unit price</span></div>
        ${p.perUse ? `<div class="fact"><b class="num">${money(p.perUse)}</b><span>Per use (${p.uses} uses)</span></div>` : ''}
        ${p.low12 ? `<div class="fact"><b class="num">${money(p.low12)}</b><span>Lowest in ${p.historyWeeks || 12} weeks</span></div>` : ''}
      </div>
      <p class="small muted">Checked ${ago(p.checkedAt)}${p.stale ? ' — may have changed' : ''}. ${p.anomaly ? '<b>Unusual price change, being checked.</b>' : ''}</p>
      <div class="row" style="margin:12px 0"><button class="btn ${saved ? 'ghost' : ''}" id="watch" style="flex:1">${saved ? '♥ On your list' : '♡ Watch for specials'}</button>${p.url ? `<a class="btn light" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">View at ${RET[p.retailer]}</a>` : ''}</div>
      ${d.offers.length > 1 ? `<h2>Same product, other stores</h2><div class="group">${d.offers.map((o, i) => offerRow(o, i === 0 && (d.offers[1].effective ?? 1e12) > (o.effective ?? 0))).join('')}</div>` : ''}
      <h2>Price history</h2><div class="card">${sparkline(d.history)}</div>
      ${d.sizes.length ? `<h2>Other sizes</h2><div class="group">${d.sizes.map((o) => `<a class="offer" href="#/p/${encodeURIComponent(o.id)}"><div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span><span class="small">${esc(o.size || o.name)}</span></div><div class="p num">${money(o.effective)}</div><div></div><div class="u num">${esc(unitText(o))}</div></a>`).join('')}</div>` : ''}
      ${d.similar.length ? `<h2>Similar items, by unit price</h2><div class="grid">${d.similar.slice(0, 6).map(tile).join('')}</div>` : ''}`;
    $('#watch').onclick = () => (saved ? editItemSheet(saved, p, () => views.product(q, id)) : addToListSheet(p, () => views.product(q, id)));
    void best;
  } catch (e) { fail(e); }
};

function sheet(html, onMount) {
  const s = $('#sheet');
  s.innerHTML = `<div class="panel" role="dialog" aria-modal="true">${html}</div>`;
  s.hidden = false;
  const close = () => { s.hidden = true; s.innerHTML = ''; };
  s.onclick = (e) => { if (e.target === s) close(); };
  onMount?.(s, close);
  return close;
}

function alertOptions(cur = 'any', target = null, price = null) {
  const opts = [
    ['any', 'Any special', 'Tell me whenever it goes on special'],
    ['half', 'Half price only', 'Only when it is ½ price'],
    ['target', 'Below my price', 'When it drops to my target price'],
    ['off', 'No alerts', 'Just keep it on my list'],
  ];
  return opts.map(([k, t, s]) => `<label class="opt ${cur === k ? 'on' : ''}"><input type="radio" name="mode" value="${k}" ${cur === k ? 'checked' : ''}><div><b>${t}</b><span>${s}</span>
    ${k === 'target' ? `<div class="field" style="margin-top:8px"><input name="target" inputmode="decimal" placeholder="${price ? (price / 100 * 0.7).toFixed(2) : '5.00'}" value="${target ? (target / 100).toFixed(2) : ''}" aria-label="Target price in dollars"></div>` : ''}</div></label>`).join('');
}
function bindOpts(s) {
  s.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => { s.querySelectorAll('.opt').forEach((x) => x.classList.remove('on')); o.classList.add('on'); }));
}
function readOpts(s) {
  const mode = s.querySelector('input[name=mode]:checked')?.value || 'any';
  const t = parseFloat(String(s.querySelector('input[name=target]')?.value || '').replace(/[^0-9.]/g, ''));
  if (mode === 'target' && !(t > 0)) throw new Error('Enter a target price');
  return { alert_mode: mode, target_cents: mode === 'target' ? Math.round(t * 100) : null };
}

async function addToListSheet(p, done) {
  const { lists } = await api('/api/lists');
  sheet(`<h3>Watch “${esc(p.name)}”</h3>
    ${lists.length > 1 ? `<div class="field"><label>List</label><select name="list">${lists.map((l) => `<option value="${l.id}">${esc(l.name)}${l.retailer ? ` (${RET[l.retailer]} only)` : ''}</option>`).join('')}</select></div><p></p>` : ''}
    ${alertOptions('any', null, p.price)}
    <p class="small muted">We check matching products at other stores too, unless the list is set to one store.</p>
    <div class="err" id="e"></div><button class="btn block" id="ok">Add to list</button>`, (s, close) => {
    bindOpts(s);
    $('#ok', s).onclick = async () => {
      try {
        const listId = s.querySelector('select[name=list]')?.value || lists[0].id;
        await api(`/api/lists/${listId}/items`, { method: 'POST', body: { product_id: p.id, ...readOpts(s) } });
        close(); toast('Added to your list'); done?.(); maybeAskPush();
      } catch (e) { $('#e', s).textContent = e.message; }
    };
  });
}

function editItemSheet(item, p, done) {
  sheet(`<h3>${esc(p.name)}</h3>${alertOptions(item.alert_mode || item.alertMode, item.target_cents ?? item.target, p.price)}
    <div class="err" id="e"></div><div class="row"><button class="btn danger" id="rm">Remove</button><button class="btn" id="ok" style="flex:1">Save</button></div>`, (s, close) => {
    bindOpts(s);
    $('#ok', s).onclick = async () => {
      try { await api(`/api/items/${item.id}`, { method: 'PATCH', body: readOpts(s) }); close(); toast('Saved'); done?.(); } catch (e) { $('#e', s).textContent = e.message; }
    };
    $('#rm', s).onclick = async () => { await api(`/api/items/${item.id}`, { method: 'DELETE' }); close(); toast('Removed'); done?.(); };
  });
}

const MODE_LABEL = { any: 'Any special', half: '½ price only', target: 'Below target', off: 'No alerts' };

views.lists = async () => {
  loading(2);
  try {
    const { lists } = await api('/api/lists');
    const total = (l) => l.items.reduce((s, i) => s + (i.best.effective || 0), 0);
    app.innerHTML = `<h1>My list</h1><p class="lead small">Products you watch. The price shown is the cheapest matching offer${lists.some((l) => l.retailer) ? ' (or the chosen store)' : ''}.</p>
      ${lists.map((l) => `<div class="card" style="margin-bottom:12px">
        <div class="row"><b style="font-size:16px">${esc(l.name)}</b><span class="small muted">${l.retailer ? `${RET[l.retailer]} only` : 'Any store'}</span><span class="spacer"></span><button class="btn small light" data-edit="${l.id}">Edit</button></div>
        ${l.items.length ? `<div class="list-rows" style="margin-top:6px">${l.items.map((i) => `<div class="r">
          <a href="#/p/${encodeURIComponent(i.best.id)}" class="n" style="text-decoration:none"><div>${esc(i.product.name)}</div>
            <div class="small"><span class="ret ${i.best.retailer}">${RET[i.best.retailer]}</span> ${i.best.special ? (i.best.promoType === 'half_price' ? '<span class="badge b-half">½ PRICE</span>' : '<span class="badge b-promo">Special</span>') : ''} <span class="muted">· ${MODE_LABEL[i.alertMode]}${i.alertMode === 'target' && i.target ? ` ${money(i.target)}` : ''}</span></div></a>
          <div style="text-align:right"><div class="num" style="font-weight:800">${money(i.best.effective)}</div>${i.best.was ? `<div class="small muted num" style="text-decoration:line-through">${money(i.best.was)}</div>` : ''}</div>
          <button class="btn small light" data-item='${esc(JSON.stringify({ id: i.id, alertMode: i.alertMode, target: i.target, pid: i.product.id, name: i.product.name, price: i.product.price }))}' aria-label="Alert settings">⋯</button>
        </div>`).join('')}</div>
        <div class="row small" style="border-top:1px solid var(--line);padding-top:10px;margin-top:4px"><span class="muted">${l.items.length} item${l.items.length === 1 ? '' : 's'} · best prices today</span><span class="spacer"></span><b class="num">${money(total(l))}</b></div>` : '<div class="empty" style="padding:18px">Empty. Search a product and tap ♡ Watch.</div>'}
      </div>`).join('')}
      <button class="btn ghost block" id="newlist">+ New list</button>
      <div id="pushbox" style="margin-top:14px"></div>`;
    app.querySelectorAll('[data-item]').forEach((b) => (b.onclick = () => {
      const i = JSON.parse(b.dataset.item);
      editItemSheet(i, { name: i.name, price: i.price }, () => views.lists());
    }));
    app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => listSheet(lists.find((l) => l.id === b.dataset.edit), lists.length)));
    $('#newlist').onclick = () => listSheet(null, lists.length);
    renderPushBox($('#pushbox'));
  } catch (e) { fail(e); }
};

function listSheet(l, count) {
  sheet(`<h3>${l ? 'Edit list' : 'New list'}</h3>
    <div class="field"><label>Name</label><input name="n" value="${esc(l?.name || '')}" placeholder="e.g. Weekly shop"></div><p></p>
    <div class="field"><label>Store</label><select name="r"><option value="">Any store (cheapest match)</option>${['woolworths', 'coles', 'aldi', 'costco'].map((r) => `<option value="${r}" ${l?.retailer === r ? 'selected' : ''}>${RET[r]} only</option>`).join('')}</select></div><p></p>
    <div class="row">${l && count > 1 ? '<button class="btn danger" id="del">Delete list</button>' : ''}<button class="btn" id="ok" style="flex:1">Save</button></div>`, (s, close) => {
    $('#ok', s).onclick = async () => {
      const body = { name: $('[name=n]', s).value, retailer: $('[name=r]', s).value || null };
      if (l) await api(`/api/lists/${l.id}`, { method: 'PATCH', body }); else await api('/api/lists', { method: 'POST', body });
      close(); views.lists();
    };
    const del = $('#del', s);
    if (del) del.onclick = async () => { if (confirm('Delete this list?')) { await api(`/api/lists/${l.id}`, { method: 'DELETE' }); close(); views.lists(); } };
  });
}

// ---------- push ----------
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
function b64ToU8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
async function currentSub() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
async function enablePush() {
  const key = state.vapid;
  if (!key) throw new Error('Alerts are not configured on the server yet');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were not allowed. You can turn them on in Settings.');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }));
  await api('/api/push/subscribe', { method: 'POST', body: sub.toJSON() });
}
async function disablePush() {
  const sub = await currentSub();
  if (sub) { await api('/api/push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
}
async function renderPushBox(el) {
  if (!el) return;
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!pushSupported()) {
    el.innerHTML = ios && !standalone
      ? `<div class="notice">To get alerts on iPhone, first <a href="#/install">add Fair Whack to your Home Screen</a>, then open it from there.</div>`
      : `<div class="notice">This browser can't receive alerts. You'll still see specials on the Home screen.</div>`;
    return;
  }
  const sub = await currentSub().catch(() => null);
  el.innerHTML = sub
    ? `<div class="notice info row"><span>🔔 Special alerts are on for this device. Sent around 8am Wednesdays, at most once a day.</span><span class="spacer"></span><button class="btn small light" id="poff">Turn off</button></div>`
    : `<div class="card row"><span>🔔 Get a heads-up when your items go on special.</span><span class="spacer"></span><button class="btn small ticket" id="pon">Turn on</button></div>`;
  const on = $('#pon', el), off = $('#poff', el);
  if (on) on.onclick = async () => { try { await enablePush(); toast('Alerts on'); renderPushBox(el); } catch (e) { toast(e.message); } };
  if (off) off.onclick = async () => { await disablePush(); toast('Alerts off'); renderPushBox(el); };
}
async function maybeAskPush() {
  if (!pushSupported() || localStorage.getItem('fw_push_asked')) return;
  const sub = await currentSub().catch(() => null);
  if (sub) return;
  try { localStorage.setItem('fw_push_asked', '1'); } catch {}
  sheet(`<h3>Want a heads-up?</h3><p>We'll send one notification when items on your list go on special (usually Wednesday morning, never more than once a day).</p>
    <div class="row"><button class="btn light" id="no">Not now</button><button class="btn ticket" id="yes" style="flex:1">Turn on alerts</button></div>`, (s, close) => {
    $('#no', s).onclick = close;
    $('#yes', s).onclick = async () => { close(); try { await enablePush(); toast('Alerts on'); } catch (e) { toast(e.message); } };
  });
}

views.more = () => {
  app.innerHTML = `<h1>More</h1>
    <div class="card menu">
      <a href="#/report"><span class="ic">🧾</span><span>Report a Costco price<span class="sub">Costco prices aren't online. Tell us what you saw.</span></span></a>
      <a href="#/alerts"><span class="ic">🔔</span><span>Alerts<span class="sub">Turn special alerts on or off for this device</span></span></a>
      <a href="#/install"><span class="ic">📲</span><span>Add to Home Screen<span class="sub">Install on iPhone or Android</span></span></a>
      <a href="#/about"><span class="ic">ℹ️</span><span>About the prices<span class="sub">Where they come from and how often</span></span></a>
      ${state.me?.isAdmin ? '<a href="#/admin"><span class="ic">🛠️</span><span>Admin<span class="sub">Spend, data runs, reviews, ALDI import</span></span></a>' : ''}
      <button id="logout"><span class="ic">↩︎</span><span>Sign out<span class="sub">Signed in as ${esc(state.me?.name)}</span></span></button>
    </div>
    <p class="small muted center" style="margin-top:20px">Fair Whack internal beta · for testers only · please don't share screenshots outside the team</p>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.me = null; location.hash = '#/login'; };
};

views.alerts = () => { app.innerHTML = '<h1>Alerts</h1><p class="lead">One notification when items on your list go on special. Usually Wednesday around 8am, never more than once a day.</p><div id="pb"></div>'; renderPushBox($('#pb')); };

views.install = () => {
  const ios = /iPhone|iPad/.test(navigator.userAgent);
  app.innerHTML = `<h1>Add to Home Screen</h1>
    <div class="card"><b>${ios ? 'iPhone / iPad (Safari)' : 'iPhone (Safari)'}</b><ol class="steps">
      <li>Open this site in <b>Safari</b> (not Chrome or the Gmail browser).</li>
      <li>Tap the <b>Share</b> button (square with an arrow).</li>
      <li>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>Fair Whack</b> from your Home Screen, go to <b>My list</b> and tap <b>Turn on</b> alerts.</li>
    </ol><p class="small muted">Alerts need iOS 16.4 or later.</p></div>
    <div class="card" style="margin-top:10px"><b>Android (Chrome)</b><ol class="steps"><li>Tap the <b>⋮</b> menu.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol></div>`;
};

views.about = () => {
  app.innerHTML = `<h1>About the prices</h1><div class="card stack small">
    <p><b>Woolworths and Coles:</b> specials are collected every Wednesday morning; about 3,000 everyday products per store are refreshed every four weeks, and items on anyone's list are refreshed weekly. Coles prices are for Victoria.</p>
    <p><b>ALDI:</b> entered by hand from ALDI's website and catalogue, so coverage is small.</p>
    <p><b>Costco:</b> warehouse prices aren't online. They come from testers' reports, checked by an admin.</p>
    <p><b>Unit prices</b> are worked out by us (per 100g, per litre or per item) so different sizes compare fairly. <b>Per use</b> uses the count printed on the pack, e.g. “40 washes”.</p>
    <p><b>“12-wk low”</b> means the price is the lowest we've seen in 12 weeks. <b>“Was price inflated”</b> means the “was” price is more than 10% above what it usually sold for.</p>
    <p>Prices can change or differ in store. Always check before you buy. This beta is for internal testing only and is not connected to or endorsed by any supermarket.</p></div>`;
};

views.report = async () => {
  app.innerHTML = `<h1>Report a Costco price</h1><p class="lead small">Seen a good price at Costco? Add it here. An admin checks it before it shows up.</p>
    <form id="f" class="stack">
      <div class="field"><label>Product name *</label><input name="name" required placeholder="e.g. Kirkland Signature Bath Tissue"></div>
      <div class="two"><div class="field"><label>Brand</label><input name="brand" placeholder="Kirkland"></div><div class="field"><label>Size / pack</label><input name="size_text" placeholder="36 rolls"></div></div>
      <div class="two"><div class="field"><label>Price $ *</label><input name="price" required inputmode="decimal" placeholder="29.99"></div><div class="field"><label>Date seen</label><input name="observed_on" type="date" value="${new Date().toISOString().slice(0, 10)}"></div></div>
      <div class="field"><label>Warehouse</label><select name="store"><option>Docklands</option><option>Ringwood</option><option>Epping</option><option>Moorabbin</option><option>Geelong</option><option>Preston</option><option>Other</option></select></div>
      <div class="field"><label>Barcode (optional)</label><input name="gtin" inputmode="numeric" placeholder="Numbers under the barcode"></div>
      <div class="field"><label>Note</label><input name="note" placeholder="e.g. member special until Sunday"></div>
      <div class="err" id="e"></div><button class="btn block">Send report</button>
    </form><h2>Your reports</h2><div id="mine" class="small muted">Loading…</div>`;
  const loadMine = async () => {
    const { reports } = await api('/api/reports/mine');
    $('#mine').innerHTML = reports.length ? `<div class="card list-rows">${reports.map((r) => `<div class="r"><div class="n"><div>${esc(r.name)}</div><span class="muted">${esc(r.store || '')} · ${r.observed_on}</span></div><b class="num">${money(r.price_cents)}</b><span class="badge ${r.status === 'approved' ? 'b-low' : r.status === 'rejected' ? 'b-inflated' : 'b-stale'}">${r.status}</span></div>`).join('')}</div>` : 'None yet.';
  };
  loadMine();
  $('#f').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/reports', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); e.target.reset(); toast('Thanks! Report sent'); loadMine(); } catch (err) { $('#e').textContent = err.message; }
  };
};

views.admin = async () => {
  if (!state.me?.isAdmin) { app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  loading(2);
  try {
    const [o, rep, mt] = await Promise.all([api('/api/admin/overview'), api('/api/admin/reports'), api('/api/admin/matches')]);
    const pct = Math.min(100, (o.spendUsd / o.budgetUsd) * 100);
    app.innerHTML = `<h1>Admin</h1>
      <div class="card"><div class="row"><b>Data spend</b><span class="spacer"></span><b class="num">$${o.spendUsd.toFixed(2)} / $${o.budgetUsd}</b></div>
        <div class="meter ${o.spendUsd >= 80 ? 'hot' : ''}" style="margin-top:8px"><i style="width:${pct}%"></i></div>
        <p class="small muted">At $80, only weekly specials keep running. At $95, everything stops. Apify's own figures are the final word.</p></div>
      <h2>Products</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>Store</th><th>Products</th><th>Last 28d</th><th>Specials</th><th>Matched</th><th>Updated</th></tr>
        ${o.counts.map((c) => `<tr><td>${RET[c.retailer] || c.retailer}</td><td class="num">${c.products}</td><td class="num">${c.fresh28}</td><td class="num">${c.specials}</td><td class="num">${c.matched}</td><td>${ago(c.updated)}</td></tr>`).join('')}</table></div>
      <h2>Costco reports <span class="small muted">${o.pending.reports} pending</span></h2>
      <div class="card">${rep.reports.length ? rep.reports.slice(0, 30).map((r) => `<div class="list-rows"><div class="r"><div class="n"><div><b>${esc(r.name)}</b> ${esc(r.size_text || '')}</div><span class="small muted">${esc(r.brand || '')} · ${esc(r.store || '')} · ${r.observed_on} · by ${esc(r.user_name || '?')}${r.note ? ` · ${esc(r.note)}` : ''}</span></div><b class="num">${money(r.price_cents)}</b>
        ${r.status === 'pending' ? `<button class="btn small" data-rep="${r.id}" data-a="approve">✓</button><button class="btn small danger" data-rep="${r.id}" data-a="reject">✕</button>` : `<span class="badge ${r.status === 'approved' ? 'b-low' : 'b-inflated'}">${r.status}</span>`}</div></div>`).join('') : '<p class="small muted">No reports yet.</p>'}</div>
      <h2>Possible matches <span class="small muted">${o.pending.matches} pending</span></h2>
      <div class="stack">${mt.matches.length ? mt.matches.map((m) => `<div class="card"><div class="pair">
        <div><span class="ret ${m.a_retailer}">${RET[m.a_retailer]}</span><div class="small">${esc(m.a_name)} ${esc(m.a_size || '')}</div><b class="num">${money(m.a_price)}</b></div>
        <div><span class="ret ${m.b_retailer}">${RET[m.b_retailer]}</span><div class="small">${esc(m.b_name)} ${esc(m.b_size || '')}</div><b class="num">${money(m.b_price)}</b></div></div>
        <div class="row" style="margin-top:8px"><span class="small muted">score ${m.score}</span><span class="spacer"></span><button class="btn small danger" data-m="${m.id}" data-a="reject">Different</button><button class="btn small" data-m="${m.id}" data-a="approve">Same product</button></div></div>`).join('') : '<p class="small muted">Nothing to review.</p>'}</div>
      <h2>ALDI prices (CSV)</h2>
      <div class="card stack"><p class="small muted">Paste rows: <code>name,brand,size,price,was price,special,url,category</code>. Header row optional. Same name+brand+size updates the price.</p>
        <div class="field"><textarea id="csv" rows="6" placeholder="name,brand,size,price,was price,special&#10;Farmdale Full Cream Milk,Farmdale,2L,3.09,,&#10;Willow Toilet Tissue 18 Pack,Willow,18 pack,8.99,10.99,yes"></textarea></div>
        <button class="btn" id="imp">Import</button><div class="small" id="impres"></div></div>
      <h2>Data runs</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>When</th><th>Job</th><th>Status</th><th>Items</th><th>$</th><th>Note</th></tr>
        ${o.runs.map((r) => `<tr><td>${ago(r.started_at)}</td><td>${r.mode} ${r.retailer || ''}</td><td>${r.status}</td><td class="num">${r.items ?? ''}</td><td class="num">${(r.cost_usd || 0).toFixed(2)}</td><td class="small">${esc(r.message || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No runs yet</td></tr>'}</table></div>
      <h2>Testers</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>Name</th><th>Joined</th><th>Watching</th><th>Alerts</th></tr>
        ${o.users.map((u) => `<tr><td>${esc(u.name)}</td><td>${ago(u.created_at)}</td><td class="num">${u.items}</td><td>${u.devices ? '🔔' : '—'}</td></tr>`).join('')}</table></div>`;
    app.querySelectorAll('[data-rep]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/reports/${b.dataset.rep}`, { method: 'POST', body: { action: b.dataset.a } }); toast('Done'); views.admin(); }));
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/matches/${b.dataset.m}`, { method: 'POST', body: { action: b.dataset.a } }); toast('Saved'); views.admin(); }));
    $('#imp').onclick = async () => {
      try { const r = await api('/api/admin/aldi', { method: 'POST', body: { csv: $('#csv').value } }); $('#impres').textContent = `Imported ${r.imported} rows. ${r.errors.join('; ')}`; } catch (e) { $('#impres').textContent = e.message; }
    };
  } catch (e) { fail(e); }
};

// ---------- router ----------
async function route() {
  const [path, qs] = (location.hash.slice(1) || '/').split('?');
  const q = new URLSearchParams(qs || '');
  const parts = path.split('/').filter(Boolean);
  if (!state.me && parts[0] !== 'login') {
    try { const r = await api('/api/me'); state.me = r.user; state.vapid = r.vapidPublicKey; }
    catch { return; } // api() redirects to login
  }
  if (state.me) document.body.classList.remove('anon');
  const name = parts[0] || 'home';
  const tab = { home: 'home', specials: 'specials', search: 'search', p: 'search', lists: 'lists', digest: 'home' }[name] || 'more';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('#sheet').hidden = true;
  window.scrollTo(0, 0);
  if (name === 'login') return views.login();
  if (name === 'p') return views.product(q, decodeURIComponent(parts.slice(1).join('/')));
  if (name === 'digest') return views.home();
  return (views[name] || views.home)(q);
}

$('#topsearch').onsubmit = (e) => {
  e.preventDefault();
  const v = e.target.q.value.trim();
  if (v) { e.target.q.blur(); location.hash = `#/search?q=${encodeURIComponent(v)}`; }
};
addEventListener('hashchange', route);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();

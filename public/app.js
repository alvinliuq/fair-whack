// Fair Whack beta — single-page app (no build step).
const $ = (s, el = document) => el.querySelector(s);
const app = $('#app');
const RET = { woolworths: 'Woolworths', coles: 'Coles', aldi: 'ALDI', costco: 'Costco' };
const STORES = ['woolworths', 'coles'];
const state = { me: null, profile: null, needsProfile: false, meta: null, vapid: null, saved: new Map(), products: new Map(), listOpen: {} };

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
const qs = (o) => { const s = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false) s.set(k, v === true ? '1' : v); const t = s.toString(); return t ? `?${t}` : ''; };
const isNew = (p) => state.meta?.newReady && p.firstSeen && state.meta.newSince && p.firstSeen > state.meta.newSince;

function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button class="toast-btn">${esc(action.label)}</button>` : ''}`;
  t.hidden = false;
  if (action) t.querySelector('.toast-btn').onclick = () => { t.hidden = true; action.run(); };
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), action ? 5000 : 2600);
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
  if (isNew(p)) b.push('<span class="badge b-new">NEW</span>');
  if (stale && p.stale) b.push(`<span class="badge b-stale">Checked ${ago(p.checkedAt)}</span>`);
  return b.length ? `<div class="badges">${b.join('')}</div>` : '';
}

// ---------- hearts ----------
const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.6s-7.4-4.5-9.3-9.1C1.3 8.1 3.4 4.8 6.8 4.8c2 0 3.4 1.1 4.2 2.4h2c.8-1.3 2.2-2.4 4.2-2.4 3.4 0 5.5 3.3 4.1 6.7-1.9 4.6-9.3 9.1-9.3 9.1z"/></svg>';
function heart(p) {
  state.products.set(p.id, p);
  const on = state.saved.has(p.id);
  return `<button type="button" class="heart ${on ? 'on' : ''}" data-heart="${esc(p.id)}" aria-pressed="${on}" aria-label="${on ? 'On your list — alert settings' : 'Add to my list'}">${HEART}</button>`;
}
function refreshHearts() {
  document.querySelectorAll('[data-heart]').forEach((b) => {
    const on = state.saved.has(b.dataset.heart);
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? 'On your list — alert settings' : 'Add to my list');
  });
  const w = $('#watch');
  if (w) { const on = state.saved.has(w.dataset.pid); w.textContent = on ? '♥ On your list' : '♡ Add to my list'; w.classList.toggle('ghost', on); }
}
async function loadSaved() {
  const { saved } = await api('/api/saved');
  state.saved = new Map(saved.map((s) => [s.product_id, s]));
  refreshHearts();
}
async function onHeart(id) {
  const p = state.products.get(id) || { id, name: 'this product' };
  const saved = state.saved.get(id);
  if (saved) return editItemSheet(saved, p, async () => { await loadSaved(); if (location.hash.startsWith('#/lists')) views.lists(); });
  const { lists } = await api('/api/lists');
  if (lists.length === 1) {
    await api(`/api/lists/${lists[0].id}/items`, { method: 'POST', body: { product_id: id, alert_mode: 'any' } });
    await loadSaved();
    toast(`Added to ${lists[0].name}`);
    maybeAskPush();
    return;
  }
  addToListSheet(p, lists, async () => { await loadSaved(); });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-heart]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  onHeart(b.dataset.heart).catch((err) => toast(err.message));
}, true);

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
    ${heart(p)}
  </a>`;
}

function offerRow(o, best) {
  const save = o.saving ? `<span class="note">Save ${money(o.saving)}</span>` : '';
  return `<a class="offer ${best ? 'best' : ''}" href="#/p/${encodeURIComponent(o.id)}">
    <div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span>${badges(o)}${best ? '<span class="tag-best">Cheapest</span>' : ''}</div>
    <div class="p num">${money(o.effective)}</div>
    <div class="note">${o.was ? `was ${money(o.was)} ` : ''}${save}</div>
    <div class="u num">${esc(unitText(o))}${o.perUse ? ` · ${money(o.perUse)}/use` : ''}</div>
  </a>`;
}

function loading(n = 4, el = app) { el.innerHTML = `<div class="grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`; }
function fail(e, el = app) { el.innerHTML = `<div class="empty"><b>Something went wrong</b>${esc(e.message)}<p><button class="btn small light" onclick="location.reload()">Try again</button></p></div>`; }
function chips(items, current, href, { all = 'All', cls = '' } = {}) {
  return `<div class="chips ${cls}">${all ? `<a class="chip ${!current ? 'on' : ''}" href="${href('')}">${esc(all)}</a>` : ''}${items.map((c) => `<a class="chip ${current === c.name ? 'on' : ''}" href="${href(c.name)}">${esc(c.name)}${c.count != null ? ` <span class="cnt">${c.count}</span>` : ''}</a>`).join('')}</div>`;
}

/** Paged product grid with "Load more". */
function pagedGrid(el, fetchPage, empty) {
  let page = 0;
  const load = async () => {
    const d = await fetchPage(page);
    if (page === 0) el.innerHTML = d.items.length ? '<div class="grid" data-g></div>' : `<div class="empty">${empty}</div>`;
    const g = el.querySelector('[data-g]');
    if (g) g.insertAdjacentHTML('beforeend', d.items.map(tile).join(''));
    el.querySelector('[data-more]')?.remove();
    if (d.more) {
      el.insertAdjacentHTML('beforeend', '<p class="center" data-more><button class="btn light">Load more</button></p>');
      el.querySelector('[data-more] button').onclick = () => { page++; load().catch((e) => toast(e.message)); };
    }
    return d;
  };
  loading(4, el);
  return load().catch((e) => fail(e, el));
}

// ---------- views ----------
const views = {};

views.login = () => {
  document.body.classList.add('anon');
  app.innerHTML = `<form class="login stack" id="f">
    <img class="logo" src="/icons/icon-192.png" alt="">
    <h1>Fair Whack</h1>
    <p class="lead">Compare Woolworths and Coles prices, and get told when the things you buy go on special. Internal beta.</p>
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
      await api('/api/login', { method: 'POST', body: { name: fd.get('name'), code: fd.get('code') } });
      state.me = null; // route() reloads the profile
      document.body.classList.remove('anon');
      if (location.hash === '#/') route(); else location.hash = '#/';
    } catch (err) { $('#err').textContent = err.message; }
  };
};

// ----- profile (required during the beta) -----
const AGE_LABEL = { '18-24': '18–24', '25-34': '25–34', '35-44': '35–44', '45-54': '45–54', '55-64': '55–64', '65+': '65+' };
const GENDER_LABEL = { male: 'Male', female: 'Female', other: 'Other' };
const HOUSE_LABEL = { 1: 'Just me', 2: '2', 3: '3', 4: '4', '5+': '5 or more' };

views.welcome = async () => {
  document.body.classList.add('onboarding');
  const opts = await api('/api/profile/options');
  const pr = state.profile || {};
  const radio = (name, values, labels, cur) => `<div class="pills">${values.map((v) => `<label class="pill"><input type="radio" name="${name}" value="${v}" ${cur === v ? 'checked' : ''}><span>${labels[v] || v}</span></label>`).join('')}</div>`;
  app.innerHTML = `<form id="pf" class="stack profile">
    <h1>${pr.done ? 'Your details' : `Welcome${state.me ? `, ${esc(state.me.name.split(' ')[0])}` : ''}!`}</h1>
    <p class="lead">${pr.done ? 'Update anytime.' : 'Four quick questions so we can show you deals that suit your household. Required during the beta.'}</p>
    <fieldset><legend>Age</legend>${radio('ageRange', opts.ageRanges, AGE_LABEL, pr.ageRange)}</fieldset>
    <fieldset><legend>Gender</legend>${radio('gender', opts.genders, GENDER_LABEL, pr.gender)}</fieldset>
    <fieldset><legend>People in your household</legend>${radio('household', opts.household, HOUSE_LABEL, pr.household)}</fieldset>
    <fieldset><legend>What do you want to hear about first? <span class="muted small">Pick any</span></legend>
      <div class="pills">${opts.categories.filter((c) => c !== 'Other').map((c) => `<label class="pill"><input type="checkbox" name="fav" value="${esc(c)}" ${(pr.favCategories || []).includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div></fieldset>
    <div class="err" id="err"></div>
    <button class="btn block">${pr.done ? 'Save' : 'Start saving'}</button>
    <p class="small muted">Only used inside Fair Whack to sort deals for you and to understand who uses the beta. Never shared.</p>
  </form>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api('/api/profile', { method: 'POST', body: { ageRange: fd.get('ageRange'), gender: fd.get('gender'), household: fd.get('household'), favCategories: fd.getAll('fav') } });
      const r = await api('/api/me'); state.profile = r.profile; state.needsProfile = r.needsProfile;
      document.body.classList.remove('onboarding');
      toast('Saved');
      location.hash = pr.done ? '#/more' : '#/';
    } catch (err) { $('#err').textContent = err.message; }
  };
};

// ----- Home: your list + Best Deals -----
views.home = async (q) => {
  const f = { store: STORES.includes(q.get('store')) ? q.get('store') : '', cat: q.get('cat') || '', sort: q.get('sort') === 'price' ? 'price' : '' };
  const link = (patch) => `#/${qs({ ...f, ...patch })}`;
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const meta = state.meta || {};
  const upd = (meta.retailers || []).filter((r) => STORES.includes(r.retailer)).map((r) => `${RET[r.retailer]} ${ago(r.updated)}`).join(' · ');
  app.innerHTML = `
    <h1>G'day ${esc(state.me.name.split(' ')[0])}</h1>
    <p class="lead small">${upd ? `Prices updated: ${upd}` : 'Waiting for the first price update.'}</p>
    ${!standalone && /iPhone|iPad/.test(navigator.userAgent) ? `<a class="notice info" style="display:block;text-decoration:none" href="#/install"><b>Add Fair Whack to your Home Screen</b> to get special alerts on iPhone →</a>` : ''}
    <h2>On special from your list <a href="#/lists">My List</a></h2>
    <div id="mine"><div class="skeleton" style="height:120px"></div></div>
    <h2 id="deals">Best Deals</h2>
    <div class="chips"><a class="chip ${!f.store ? 'on' : ''}" href="${link({ store: '', cat: '' })}">All stores</a>${STORES.map((r) => `<a class="chip store ${f.store === r ? 'on' : ''}" href="${link({ store: r, cat: '' })}"><span class="ret ${r}"></span>${RET[r]}</a>`).join('')}</div>
    <div id="cats"></div>
    <div class="row" style="margin:2px 0 12px"><span class="small muted" id="dlabel"></span><span class="spacer"></span>
      <div class="seg"><button data-sort="" class="${!f.sort ? 'on' : ''}">Biggest saving</button><button data-sort="price" class="${f.sort === 'price' ? 'on' : ''}">Price</button></div></div>
    <div id="res"></div>`;
  app.querySelectorAll('[data-sort]').forEach((b) => (b.onclick = () => (location.hash = link({ sort: b.dataset.sort }))));
  if (q.get('store') || q.get('cat') || q.get('sort')) setTimeout(() => $('#deals')?.scrollIntoView({ block: 'start' }), 0);
  api('/api/digest').then((d) => {
    $('#mine').innerHTML = d.fromYourList.length ? `<div class="grid">${d.fromYourList.map(tile).join('')}</div>`
      : `<div class="card flat empty" style="padding:18px"><b>Nothing from your list is on special this week</b>Tap 🧡 on any product to watch it.<p><a class="btn small" href="#/browse">Browse products</a></p></div>`;
  }).catch((e) => fail(e, $('#mine')));
  api(`/api/categories${qs({ scope: 'deals', retailer: f.store })}`).then((c) => {
    $('#cats').innerHTML = chips(c.categories, f.cat, (name) => link({ cat: name }), { all: f.store ? `All ${RET[f.store]} aisles` : 'All categories' });
  }).catch(() => {});
  const d = await pagedGrid($('#res'), (page) => api(`/api/deals${qs({ retailer: f.store, category: f.cat, sort: f.sort || 'saving', page })}`),
    '<b>No deals here right now</b>Try another store or category.');
  if (d && $('#dlabel')) $('#dlabel').textContent = d.forYou ? 'Picked for you first' : '';
};

// ----- Browse a store's full range -----
views.browse = async (q, store) => {
  if (!STORES.includes(store)) {
    const meta = state.meta || {};
    const count = (r) => (meta.retailers || []).find((x) => x.retailer === r)?.products || 0;
    app.innerHTML = `<h1>Browse</h1><p class="lead">Walk the aisles of each store, see what's new, and tap 🧡 to track prices on anything.</p>
      <div class="stores">${STORES.map((r) => `<a class="storecard ${r}" href="#/browse/${r}"><span class="dot"></span><b>${RET[r]}</b><span class="muted small">${count(r).toLocaleString('en-AU')} products · ${esc(meta.newLabel || 'New this week')}</span><span class="go">›</span></a>`).join('')}</div>`;
    return;
  }
  const f = { cat1: q.get('cat1') || '', cat2: q.get('cat2') || '', sort: ['new', 'saving', 'price_asc', 'price_desc'].includes(q.get('sort')) ? q.get('sort') : 'saving' };
  const link = (patch) => `#/browse/${store}${qs({ ...f, ...patch })}`;
  const newLabel = state.meta?.newLabel || 'New this week';
  app.innerHTML = `<div class="row"><a href="#/browse" class="back" aria-label="All stores">‹</a><h1 style="margin:0"><span class="ret ${store} big"></span>${RET[store]}</h1></div>
    <div id="c1" style="margin-top:10px"><div class="chips"><span class="chip">Loading aisles…</span></div></div><div id="c2"></div>
    <div class="chips sorts">${[['new', newLabel], ['saving', 'Biggest saving'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']].map(([k, l]) => `<a class="chip ${k === 'new' ? 'ticket' : ''} ${f.sort === k ? 'on' : ''}" href="${link({ sort: k })}">${l}</a>`).join('')}</div>
    <div id="res"></div>`;
  api(`/api/categories${qs({ retailer: store })}`).then((c) => {
    $('#c1').innerHTML = chips(c.categories, f.cat1, (name) => link({ cat1: name, cat2: '' }), { all: 'All aisles' });
    const top = c.categories.find((x) => x.name === f.cat1);
    if (top && top.children.length > 1) $('#c2').innerHTML = chips(top.children, f.cat2, (name) => link({ cat2: name }), { all: `All ${f.cat1}`, cls: 'sub' });
    app.querySelector('#c1 .chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }).catch(() => {});
  pagedGrid($('#res'), (page) => api(`/api/browse${qs({ retailer: store, cat1: f.cat1, cat2: f.cat2, sort: f.sort, page })}`),
    f.sort === 'new'
      ? `<b>Nothing new ${newLabel.includes('month') ? 'this month' : 'this week'} yet</b>New arrivals show up after each Wednesday update.`
      : '<b>No products here</b>Try another aisle.');
};

// ----- Search & Compare -----
const SEARCH_SORTS = [['relevance', 'Best match'], ['unit', 'Unit price'], ['saving', 'Biggest saving'], ['price_asc', 'Price: low to high'], ['price_desc', 'Price: high to low']];

function searchBox(term) {
  return `<form id="sf" class="searchbox" role="search" autocomplete="off">
    <input type="search" name="q" value="${esc(term)}" placeholder="Search products or brands" enterkeyhint="search" aria-label="Search products or brands" aria-autocomplete="list" aria-controls="sugg">
    <ul id="sugg" class="suggest" role="listbox" hidden></ul></form>`;
}
function bindSearchBox() {
  const form = $('#sf'), input = form.q, list = $('#sugg');
  const go = (v) => { v = v.trim(); if (!v) return; list.hidden = true; input.blur(); location.hash = `#/search?q=${encodeURIComponent(v)}`; };
  form.onsubmit = (e) => { e.preventDefault(); go(input.value); };
  let timer, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const v = input.value.trim();
    if (v.length < 2) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      const my = ++seq;
      const { suggestions } = await api(`/api/suggest?q=${encodeURIComponent(v)}`).catch(() => ({ suggestions: [] }));
      if (my !== seq) return;
      list.innerHTML = suggestions.map((s) => `<li role="option" data-v="${esc(s.text)}">${s.kind === 'brand' ? '<span class="tag">Brand</span>' : '<span class="tag">⌕</span>'}<span>${esc(s.text)}</span></li>`).join('');
      list.hidden = !suggestions.length;
    }, 180);
  });
  list.addEventListener('pointerdown', (e) => { const li = e.target.closest('li'); if (li) { e.preventDefault(); input.value = li.dataset.v; go(li.dataset.v); } });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 150));
}

views.search = async (q) => {
  const term = q.get('q') || '';
  const sort = SEARCH_SORTS.some(([k]) => k === q.get('sort')) ? q.get('sort') : 'relevance';
  app.innerHTML = `<h1>Search &amp; Compare</h1>${searchBox(term)}<div id="body"></div>`;
  bindSearchBox();
  const body = $('#body');
  if (!term) {
    body.innerHTML = `<h2>Hot Keywords</h2><div id="hot" class="chips wrap"><span class="chip">…</span></div><div id="hist"></div>`;
    api('/api/search/hot').then((h) => { $('#hot').innerHTML = h.keywords.map((t) => `<a class="chip" href="#/search?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join(''); }).catch(() => {});
    const renderHistory = async () => {
      const { history } = await api('/api/search/history');
      $('#hist').innerHTML = history.length ? `<h2>Search History <button class="linkbtn" id="clr">Clear all</button></h2>
        <div class="card list-rows hist">${history.map((h) => `<div class="r"><a class="n" href="#/search?q=${encodeURIComponent(h)}"><span class="muted">↺</span> ${esc(h)}</a><button class="x" data-del="${esc(h)}" aria-label="Remove ${esc(h)}">✕</button></div>`).join('')}</div>` : '';
      $('#hist').querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { await api(`/api/search/history?q=${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); renderHistory(); }));
      const clr = $('#clr');
      if (clr) clr.onclick = async () => { await api('/api/search/history', { method: 'DELETE' }); renderHistory(); };
    };
    renderHistory().catch(() => {});
    if (!/iPhone|iPad/.test(navigator.userAgent)) $('#sf input').focus();
    return;
  }
  body.innerHTML = `<div class="chips sorts">${SEARCH_SORTS.map(([k, l]) => `<a class="chip ${sort === k ? 'on' : ''}" href="#/search?q=${encodeURIComponent(term)}&sort=${k}">${l}</a>`).join('')}</div><div id="res"><div class="skeleton"></div></div>`;
  try {
    // Re-sorting the same search is not logged again.
    const d = await api(`/api/search?q=${encodeURIComponent(term)}&sort=${sort}${q.get('sort') ? '&log=0' : ''}`);
    $('#res').innerHTML = d.groups.length ? `<p class="small muted">${d.groups.length}${d.groups.length >= 80 ? '+' : ''} products</p>` + d.groups.map((g) => `<div class="group">
        <a class="group-head" href="#/p/${encodeURIComponent(g.best.id)}">${thumb(g.best)}<div class="t"><div class="name">${esc(g.name)}</div><div class="small muted">${esc(g.size || '')}${g.offers.length > 1 ? ` · ${g.offers.length} stores` : ''}</div></div>${heart(g.best)}</a>
        ${g.offers.map((o, i) => offerRow(o, i === 0 && g.offers.length > 1 && (g.offers[1].effective ?? 1e12) > (o.effective ?? 0))).join('')}
      </div>`).join('') : `<div class="empty"><b>No matches</b>Try a shorter word or a brand name.</div>`;
  } catch (e) { fail(e, $('#res')); }
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
  const col = { woolworths: 'var(--woolworths)', coles: 'var(--coles)' };
  const lines = Object.entries(byRet).map(([r, hs]) => `<polyline fill="none" stroke="${col[r] || '#888'}" stroke-width="2" stroke-linejoin="round" points="${hs.map((h) => `${x(h.captured_at).toFixed(1)},${y(h.price_cents).toFixed(1)}`).join(' ')}"/>`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Price over the last 12 weeks">${lines}</svg>
    <div class="row small muted"><span>${new Date(t0).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}</span><span class="spacer"></span><span>Low ${money(lo)} · High ${money(hi)}</span></div>`;
}

views.product = async (q, id) => {
  loading(1);
  try {
    const d = await api(`/api/product/${encodeURIComponent(id)}`);
    const p = d.product;
    state.products.set(p.id, p);
    const on = state.saved.has(p.id);
    app.innerHTML = `
      <div class="hero">${thumb(p)}<div><span class="ret ${p.retailer}">${RET[p.retailer]}</span><h1>${esc(p.name)}</h1><div class="small muted">${esc(p.size || '')}${p.brand ? ` · ${esc(p.brand)}` : ''}</div>${badges(p, { stale: false })}</div></div>
      <div class="facts">
        <div class="fact"><b class="num">${money(p.effective)}</b><span>${p.was ? `was ${money(p.was)}` : 'Current price'}${p.multibuy ? ` · ${esc(p.promoText)}` : ''}</span></div>
        <div class="fact"><b class="num">${esc(unitText(p) || '—')}</b><span>Unit price</span></div>
        ${p.perUse ? `<div class="fact"><b class="num">${money(p.perUse)}</b><span>Per use (${p.uses} uses)</span></div>` : ''}
        ${p.low12 ? `<div class="fact"><b class="num">${money(p.low12)}</b><span>Lowest in ${p.historyWeeks || 12} weeks</span></div>` : ''}
      </div>
      <p class="small muted">Checked ${ago(p.checkedAt)}${p.stale ? ' — may have changed' : ''}. ${p.anomaly ? '<b>Unusual price change, being checked.</b>' : ''}</p>
      <div class="row" style="margin:12px 0"><button class="btn ${on ? 'ghost' : ''}" id="watch" data-pid="${esc(p.id)}" style="flex:1">${on ? '♥ On your list' : '♡ Add to my list'}</button>${p.url ? `<a class="btn light" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">View at ${RET[p.retailer]}</a>` : ''}</div>
      ${d.offers.length > 1 ? `<h2>Same product, other store</h2><div class="group">${d.offers.map((o, i) => offerRow(o, i === 0 && (d.offers[1].effective ?? 1e12) > (o.effective ?? 0))).join('')}</div>` : ''}
      <h2>Price history</h2><div class="card">${sparkline(d.history)}</div>
      ${d.sizes.length ? `<h2>Other sizes</h2><div class="group">${d.sizes.map((o) => `<a class="offer" href="#/p/${encodeURIComponent(o.id)}"><div class="l"><span class="ret ${o.retailer}">${RET[o.retailer]}</span><span class="small">${esc(o.size || o.name)}</span></div><div class="p num">${money(o.effective)}</div><div></div><div class="u num">${esc(unitText(o))}</div></a>`).join('')}</div>` : ''}
      ${d.similar.length ? `<h2>Similar items, by unit price</h2><div class="grid">${d.similar.slice(0, 6).map(tile).join('')}</div>` : ''}`;
    $('#watch').onclick = () => onHeart(p.id).catch((e) => toast(e.message));
  } catch (e) { fail(e); }
};

// ----- sheets -----
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

function addToListSheet(p, lists, done) {
  sheet(`<h3>Add “${esc(p.name)}” to…</h3>
    <div class="stack">${lists.map((l, i) => `<label class="opt ${i === 0 ? 'on' : ''}" data-l><input type="radio" name="list" value="${l.id}" ${i === 0 ? 'checked' : ''}><div><b>${esc(l.name)}</b><span>${l.retailer ? `${RET[l.retailer]} only` : 'Any store'} · ${l.items.length} item${l.items.length === 1 ? '' : 's'}</span></div></label>`).join('')}</div>
    <p class="small muted">You'll be told when it goes on special. Change this later from the 🧡.</p>
    <div class="err" id="e"></div><button class="btn block" id="ok">Add to list</button>`, (s, close) => {
    s.querySelectorAll('[data-l]').forEach((o) => o.addEventListener('click', () => { s.querySelectorAll('[data-l]').forEach((x) => x.classList.remove('on')); o.classList.add('on'); }));
    $('#ok', s).onclick = async () => {
      try {
        const listId = s.querySelector('input[name=list]:checked').value;
        await api(`/api/lists/${listId}/items`, { method: 'POST', body: { product_id: p.id, alert_mode: 'any' } });
        close(); toast(`Added to ${lists.find((l) => l.id === listId).name}`); await done?.(); maybeAskPush();
      } catch (e) { $('#e', s).textContent = e.message; }
    };
  });
}

/** Alert settings for an item already on a list, with a confirmed "Remove". */
function editItemSheet(item, p, done) {
  const mode = item.alert_mode || item.alertMode;
  const target = item.target_cents ?? item.target;
  sheet(`<h3>${esc(p.name)}</h3><p class="small muted" style="margin-top:-6px">On ${esc(item.list_name || 'your list')}. When should we tell you?</p>
    ${alertOptions(mode, target, p.price)}
    <div class="err" id="e"></div>
    <div id="acts" class="row"><button class="btn danger" id="rm">Remove from list</button><button class="btn" id="ok" style="flex:1">Save</button></div>`, (s, close) => {
    bindOpts(s);
    $('#ok', s).onclick = async () => {
      try { await api(`/api/items/${item.id}`, { method: 'PATCH', body: readOpts(s) }); close(); toast('Alert updated'); await done?.(); } catch (e) { $('#e', s).textContent = e.message; }
    };
    $('#rm', s).onclick = () => {
      $('#acts', s).innerHTML = `<div class="confirm"><b>Remove this item from ${esc(item.list_name || 'your list')}?</b><span class="small muted">You'll stop getting alerts for it.</span>
        <div class="row"><button class="btn light" id="no" style="flex:1">Keep it</button><button class="btn danger-solid" id="yes" style="flex:1">Remove</button></div></div>`;
      $('#no', s).onclick = () => { close(); editItemSheet(item, p, done); };
      $('#yes', s).onclick = async () => { await api(`/api/items/${item.id}`, { method: 'DELETE' }); close(); toast('Removed from your list'); await done?.(); };
    };
  });
}

// ----- My List -----
const MODE_LABEL = { any: 'Any special', half: '½ price only', target: 'Below target', off: 'No alerts' };

views.lists = async () => {
  loading(2);
  try {
    const { lists } = await api('/api/lists');
    app.innerHTML = `<h1>My List</h1><p class="lead small">Tap a list to open it. Prices shown are the cheapest matching offer${lists.some((l) => l.retailer) ? ' (or the chosen store)' : ''}.</p>
      ${lists.map((l, idx) => {
        const open = state.listOpen[l.id] ?? idx === 0;
        const onSpecial = l.items.filter((i) => i.best.special).length;
        return `<details class="card listcard" data-list="${l.id}" ${open ? 'open' : ''}>
        <summary><span class="chev">›</span><div class="t"><b>${esc(l.name)}</b><span class="small muted">${l.retailer ? `${RET[l.retailer]} only` : 'Any store'} · ${l.items.length} item${l.items.length === 1 ? '' : 's'}${onSpecial ? ` · <span class="hot">${onSpecial} on special</span>` : ''}</span></div><button class="btn small light" data-edit="${l.id}">Edit</button></summary>
        ${l.items.length ? `<div class="list-rows">${l.items.map((i) => { state.products.set(i.product.id, i.product); return `<div class="r">
          <a href="#/p/${encodeURIComponent(i.best.id)}" class="n" style="text-decoration:none"><div>${esc(i.product.name)}</div>
            <div class="small"><span class="ret ${i.best.retailer}">${RET[i.best.retailer]}</span> ${i.best.special ? (i.best.promoType === 'half_price' ? '<span class="badge b-half">½ PRICE</span>' : '<span class="badge b-promo">Special</span>') : ''} <span class="muted">· ${MODE_LABEL[i.alertMode]}${i.alertMode === 'target' && i.target ? ` ${money(i.target)}` : ''}</span></div></a>
          <div style="text-align:right"><div class="num" style="font-weight:800">${money(i.best.effective)}</div>${i.best.was ? `<div class="small muted num" style="text-decoration:line-through">${money(i.best.was)}</div>` : ''}</div>
          ${heart(i.product)}
        </div>`; }).join('')}</div>` : '<div class="empty" style="padding:14px">Empty. Tap 🧡 on any product to add it here.</div>'}
      </details>`; }).join('')}
      <button class="btn ghost block" id="newlist">+ New list</button>
      <div id="pushbox" style="margin-top:14px"></div>`;
    app.querySelectorAll('details[data-list]').forEach((d) => d.addEventListener('toggle', () => { state.listOpen[d.dataset.list] = d.open; }));
    app.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = (e) => { e.preventDefault(); listSheet(lists.find((l) => l.id === b.dataset.edit), lists.length); }));
    $('#newlist').onclick = () => listSheet(null, lists.length);
    renderPushBox($('#pushbox'));
  } catch (e) { fail(e); }
};

function listSheet(l, count) {
  sheet(`<h3>${l ? 'Edit list' : 'New list'}</h3>
    <div class="field"><label>Name</label><input name="n" value="${esc(l?.name || '')}" placeholder="e.g. Weekly shop"></div><p></p>
    <div class="field"><label>Store</label><select name="r"><option value="">Any store (cheapest match)</option>${STORES.map((r) => `<option value="${r}" ${l?.retailer === r ? 'selected' : ''}>${RET[r]} only</option>`).join('')}</select></div><p></p>
    <div class="row">${l && count > 1 ? '<button class="btn danger" id="del">Delete list</button>' : ''}<button class="btn" id="ok" style="flex:1">Save</button></div>`, (s, close) => {
    $('#ok', s).onclick = async () => {
      const body = { name: $('[name=n]', s).value, retailer: $('[name=r]', s).value || null };
      if (l) await api(`/api/lists/${l.id}`, { method: 'PATCH', body }); else await api('/api/lists', { method: 'POST', body });
      close(); views.lists();
    };
    const del = $('#del', s);
    if (del) del.onclick = async () => { if (confirm('Delete this list and everything on it?')) { await api(`/api/lists/${l.id}`, { method: 'DELETE' }); close(); await loadSaved(); views.lists(); } };
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
      <a href="#/welcome"><span class="ic">👤</span><span>Your details<span class="sub">Age, household and favourite categories</span></span></a>
      <a href="#/alerts"><span class="ic">🔔</span><span>Alerts<span class="sub">Turn special alerts on or off for this device</span></span></a>
      <a href="#/install"><span class="ic">📲</span><span>Add to Home Screen<span class="sub">Install on iPhone or Android</span></span></a>
      <a href="#/about"><span class="ic">ℹ️</span><span>About the prices<span class="sub">Where they come from and how often</span></span></a>
      ${state.me?.isAdmin ? '<a href="#/admin"><span class="ic">🛠️</span><span>Admin<span class="sub">Spend, data runs, match review, testers</span></span></a>' : ''}
      <button id="logout"><span class="ic">↩︎</span><span>Sign out<span class="sub">Signed in as ${esc(state.me?.name)}</span></span></button>
    </div>
    <p class="small muted center" style="margin-top:20px">Fair Whack FW1.1 internal beta · for testers only · please don't share screenshots outside the team</p>`;
  $('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); state.me = null; state.saved = new Map(); location.hash = '#/login'; };
};

views.alerts = () => { app.innerHTML = '<h1>Alerts</h1><p class="lead">One notification when items on your list go on special. Usually Wednesday around 8am, never more than once a day.</p><div id="pb"></div>'; renderPushBox($('#pb')); };

views.install = () => {
  app.innerHTML = `<h1>Add to Home Screen</h1>
    <div class="card"><b>iPhone / iPad (Safari)</b><ol class="steps">
      <li>Open this site in <b>Safari</b> (not Chrome or the Gmail browser).</li>
      <li>Tap the <b>Share</b> button (square with an arrow).</li>
      <li>Scroll and tap <b>Add to Home Screen</b>, then <b>Add</b>.</li>
      <li>Open <b>Fair Whack</b> from your Home Screen, go to <b>My List</b> and tap <b>Turn on</b> alerts.</li>
    </ol><p class="small muted">Alerts need iOS 16.4 or later.</p></div>
    <div class="card" style="margin-top:10px"><b>Android (Chrome)</b><ol class="steps"><li>Tap the <b>⋮</b> menu.</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li></ol></div>`;
};

views.about = () => {
  app.innerHTML = `<h1>About the prices</h1><div class="card stack small">
    <p><b>Stores:</b> during the beta Fair Whack covers <b>Woolworths</b> and <b>Coles</b> (Victorian prices).</p>
    <p><b>How often:</b> specials are collected every Wednesday morning. About 10,000 products per store are refreshed every four weeks, and anything on someone's list is refreshed weekly.</p>
    <p><b>Browse</b> uses each store's own aisles, so it looks like their website. <b>“All stores”</b> uses a combined set of categories.</p>
    <p><b>“New”</b> means we saw the product for the first time this week (this month once the beta has run for a month).</p>
    <p><b>Unit prices</b> are worked out by us (per 100g, per litre or per item) so different sizes compare fairly. <b>Per use</b> uses the count printed on the pack, e.g. “40 washes”.</p>
    <p><b>“12-wk low”</b> means the lowest price we've seen in 12 weeks. <b>“Was price inflated”</b> means the “was” price is more than 10% above what it usually sold for.</p>
    <p>Prices can change or differ in store. Always check before you buy. This beta is for internal testing only and is not connected to or endorsed by any supermarket.</p></div>`;
};

views.admin = async () => {
  if (!state.me?.isAdmin) { app.innerHTML = '<div class="empty">Admins only.</div>'; return; }
  loading(2);
  try {
    const [o, mt] = await Promise.all([api('/api/admin/overview'), api('/api/admin/matches')]);
    const pct = Math.min(100, (o.spendUsd / o.budgetUsd) * 100);
    const counts = o.counts.filter((c) => STORES.includes(c.retailer));
    const tally = (key, labels) => { const m = {}; for (const u of o.users) { const k = u[key] || '—'; m[k] = (m[k] || 0) + 1; } return Object.entries(m).map(([k, n]) => `${labels[k] || k}: ${n}`).join(' · '); };
    app.innerHTML = `<h1>Admin</h1>
      <div class="card"><div class="row"><b>Data spend</b><span class="spacer"></span><b class="num">$${o.spendUsd.toFixed(2)} / $${o.budgetUsd}</b></div>
        <div class="meter ${o.spendUsd >= 80 ? 'hot' : ''}" style="margin-top:8px"><i style="width:${pct}%"></i></div>
        <p class="small muted">At $80, only weekly specials keep running. At $95, everything stops. Apify's own figures are the final word.</p></div>
      <h2>Products</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>Store</th><th>Products</th><th>Last 28d</th><th>Specials</th><th>Matched</th><th>Updated</th></tr>
        ${counts.map((c) => `<tr><td>${RET[c.retailer] || c.retailer}</td><td class="num">${c.products}</td><td class="num">${c.fresh28}</td><td class="num">${c.specials}</td><td class="num">${c.matched}</td><td>${ago(c.updated)}</td></tr>`).join('')}</table></div>
      <div class="row"><h2 style="flex:1;justify-content:flex-start;gap:8px">Testers <span class="small muted">${o.users.length}</span></h2><button class="btn small ghost" id="csv">Download list (CSV)</button></div>
      <div class="card small stack"><div><b>Age</b> ${tally('age_range', AGE_LABEL)}</div><div><b>Gender</b> ${tally('gender', GENDER_LABEL)}</div><div><b>Household</b> ${tally('household_size', HOUSE_LABEL)}</div></div>
      <div class="card" style="overflow-x:auto;margin-top:10px"><table class="t"><tr><th>Name</th><th>Last active</th><th>Age</th><th>Gender</th><th>Home</th><th>Watching</th><th>Searches</th><th>Alerts</th><th></th></tr>
        ${o.users.map((u) => `<tr><td>${esc(u.name)}${u.is_admin ? ' <span class="small muted">admin</span>' : ''}</td><td>${ago(u.last_active_at) || '—'}</td><td>${AGE_LABEL[u.age_range] || '—'}</td><td>${GENDER_LABEL[u.gender] || '—'}</td><td>${HOUSE_LABEL[u.household_size] || '—'}</td><td class="num">${u.items}</td><td class="num">${u.searches ?? 0}</td><td>${u.devices ? '🔔' : '—'}</td><td>${u.id === o.me ? '<span class="small muted">you</span>' : `<button class="btn small ghost" data-u="${esc(u.id)}">Manage</button>`}</td></tr>`).join('')}</table></div>
      ${o.removed.length ? `<div class="card small stack" style="margin-top:10px"><div><b>Removed</b> <span class="muted">These names cannot sign in.</span></div>
        ${o.removed.map((r) => `<div class="row"><span style="flex:1">${esc(r.name)} <span class="muted">removed ${ago(r.removed_at)}</span></span><button class="btn small ghost" data-back="${esc(r.id)}">Allow back</button></div>`).join('')}</div>` : ''}
      <h2>Possible matches <span class="small muted">${o.pending.matches} pending</span></h2>
      <div class="stack">${mt.matches.length ? mt.matches.map((m) => `<div class="card"><div class="pair">
        <div><span class="ret ${m.a_retailer}">${RET[m.a_retailer]}</span><div class="small">${esc(m.a_name)} ${esc(m.a_size || '')}</div><b class="num">${money(m.a_price)}</b></div>
        <div><span class="ret ${m.b_retailer}">${RET[m.b_retailer]}</span><div class="small">${esc(m.b_name)} ${esc(m.b_size || '')}</div><b class="num">${money(m.b_price)}</b></div></div>
        <div class="row" style="margin-top:8px"><span class="small muted">score ${m.score}</span><span class="spacer"></span><button class="btn small danger" data-m="${m.id}" data-a="reject">Different</button><button class="btn small" data-m="${m.id}" data-a="approve">Same product</button></div></div>`).join('') : '<p class="small muted">Nothing to review.</p>'}</div>
      <h2>Data runs</h2><div class="card" style="overflow-x:auto"><table class="t"><tr><th>When</th><th>Job</th><th>Status</th><th>Items</th><th>$</th><th>Note</th></tr>
        ${o.runs.map((r) => `<tr><td>${ago(r.started_at)}</td><td>${r.mode} ${r.retailer || ''}</td><td>${r.status}</td><td class="num">${r.items ?? ''}</td><td class="num">${(r.cost_usd || 0).toFixed(2)}</td><td class="small">${esc((r.message || '').slice(0, 140))}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No runs yet</td></tr>'}</table></div>`;
    app.querySelectorAll('[data-m]').forEach((b) => (b.onclick = async () => { await api(`/api/admin/matches/${b.dataset.m}`, { method: 'POST', body: { action: b.dataset.a } }); toast('Saved'); views.admin(); }));
    app.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => testerSheet(o.users.find((u) => u.id === b.dataset.u), o.users.filter((u) => u.id !== b.dataset.u))));
    app.querySelectorAll('[data-back]').forEach((b) => (b.onclick = async () => { await api('/api/admin/users', { method: 'POST', body: { action: 'restore', id: b.dataset.back } }); toast('They can sign in again'); views.admin(); }));
    $('#csv').onclick = () => downloadTesters(o.users);
  } catch (e) { fail(e); }
};

/** Admin: remove a tester, or merge two names used by the same person. Both ask for confirmation. */
function testerSheet(u, others) {
  const main = () => sheet(`<h3>${esc(u.name)}</h3>
    <p class="small muted" style="margin-top:-6px">Joined ${ago(u.created_at) || '—'} · last active ${ago(u.last_active_at) || '—'} · watching ${u.items} item${u.items === 1 ? '' : 's'}</p>
    ${others.length ? `<div class="field"><label for="into">Same person as another tester? Move this tester's lists and alerts to</label>
      <select id="into"><option value="">Choose a tester…</option>${others.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></div>
      <button class="btn ghost" id="merge" style="width:100%;margin-top:8px">Merge into the chosen tester</button>` : ''}
    <div class="err" id="e"></div>
    <button class="btn danger" id="rm" style="width:100%;margin-top:14px">Remove from the beta</button>`, (s, close) => {
    const run = async (body, done) => { try { await api('/api/admin/users', { method: 'POST', body }); close(); toast(done); views.admin(); } catch (e) { close(); toast(e.message); } };
    const ask = (title, note, yes, body, done) => sheet(`<h3>${esc(u.name)}</h3><div class="confirm"><b>${title}</b><span class="small muted">${note}</span>
      <div class="row"><button class="btn light" id="no" style="flex:1">Cancel</button><button class="btn danger-solid" id="yes" style="flex:1">${yes}</button></div></div>`, (c) => {
      $('#no', c).onclick = main;
      $('#yes', c).onclick = () => run(body, done);
    });
    if ($('#merge', s)) $('#merge', s).onclick = () => {
      const into = others.find((x) => x.id === $('#into', s).value);
      if (!into) { $('#e', s).textContent = 'Choose the tester to merge into'; return; }
      ask(`Merge ${esc(u.name)} into ${esc(into.name)}?`, `${esc(into.name)} keeps everything from both. The name "${esc(u.name)}" is deleted and is signed out. This cannot be undone.`,
        'Merge', { action: 'merge', id: u.id, into: into.id }, `Merged into ${into.name}`);
    };
    $('#rm', s).onclick = () => ask(`Remove ${esc(u.name)} from the beta?`, 'Their lists and alerts are deleted and they are signed out straight away. They cannot sign in again with this name unless you allow it.',
      'Remove', { action: 'remove', id: u.id }, `${u.name} removed`);
  });
  main();
}

/** Admin: the tester table as a CSV file (opens in Excel or Numbers). */
function downloadTesters(users) {
  const day = (iso) => (iso ? iso.slice(0, 10) : '');
  const favs = (u) => { try { return (JSON.parse(u.fav_categories || '[]') || []).join('; '); } catch { return ''; } };
  const rows = [['Name', 'Admin', 'Joined', 'Last active', 'Age', 'Gender', 'Household', 'Favourite categories', 'Items watched', 'Searches', 'Alert devices'],
    ...users.map((u) => [u.name, u.is_admin ? 'yes' : '', day(u.created_at), day(u.last_active_at), AGE_LABEL[u.age_range] || '', GENDER_LABEL[u.gender] || '', HOUSE_LABEL[u.household_size] || '', favs(u), u.items, u.searches ?? 0, u.devices])];
  // Quote every cell; a leading ' stops spreadsheet apps treating a typed name as a formula.
  const cell = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };
  const csv = '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `fair-whack-testers-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- router ----------
async function route() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const q = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  if (!state.me && parts[0] !== 'login') {
    try {
      const r = await api('/api/me');
      state.me = r.user; state.profile = r.profile; state.needsProfile = r.needsProfile; state.vapid = r.vapidPublicKey;
      [state.meta] = await Promise.all([api('/api/meta').catch(() => null), loadSaved().catch(() => {})]);
    } catch { return; } // api() sends to login
  }
  if (state.me) document.body.classList.remove('anon');
  const name = parts[0] || 'home';
  // Profile is required during the beta.
  if (state.me && state.needsProfile && name !== 'welcome' && name !== 'login') { location.hash = '#/welcome'; return; }
  document.body.classList.toggle('onboarding', name === 'welcome' && state.needsProfile);
  document.body.classList.toggle('on-search', name === 'search');
  const tab = { home: 'home', digest: 'home', browse: 'browse', search: 'search', p: 'search', lists: 'lists' }[name] || 'more';
  document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
  $('#sheet').hidden = true;
  if (!q.get('store') && !q.get('cat') && !q.get('sort')) window.scrollTo(0, 0);
  try {
    if (name === 'login') return views.login();
    if (name === 'p') return await views.product(q, decodeURIComponent(parts.slice(1).join('/')));
    if (name === 'browse') return await views.browse(q, parts[1]);
    if (name === 'digest') return await views.home(q);
    return await (views[name] || views.home)(q);
  } catch (e) { fail(e); }
}

$('#topsearch').onsubmit = (e) => {
  e.preventDefault();
  const v = e.target.q.value.trim();
  if (v) { e.target.q.blur(); e.target.q.value = ''; location.hash = `#/search?q=${encodeURIComponent(v)}`; }
};
addEventListener('hashchange', route);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
route();

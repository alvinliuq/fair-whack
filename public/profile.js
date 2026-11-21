// FW2.0: More page (Save More), profile hub and the three profile sections. Loaded on demand from app.js.
import {
  SECTIONS, VEHICLE_FIELDS, AGE_BANDS, ADULT_BANDS, MEMBER_GENDERS, MAX_MEMBERS, sectionById, progress, answered,
} from './household.js?v=5';
import { attachAutocomplete, loadPlaces } from './maps.js?v=1';

// Save More modules. Add a new one here (e.g. investing) and it gets a card on More.
export const MODULES = [
  { id: 'fuel', title: 'Fuel', icon: '⛽', blurb: 'Cheapest fuel near you and along your routes', profile: 'fuel', live: true },
  { id: 'bills', title: 'Bills', icon: '⚡', blurb: 'Electricity and gas plans compared for your home', profile: 'bills', live: true },
];
const PRIVACY = 'This information is only used to work out savings for you. It is never shared with anyone. You can change or clear it at any time.';

let ctx; // { api, esc, toast, app, state, HOME_STORES }
let cache = null; // { answers, categories, household }
export function init(c) { ctx = c; }
async function load(force) {
  if (!cache || force) cache = await ctx.api('/api/household');
  return cache;
}

const pct = (all) => { const t = all.reduce((s, p) => s + p.total, 0); return t ? Math.round((all.reduce((s, p) => s + p.done, 0) / t) * 100) : 0; };
// Progress colour: under 40% red, 40–59% orange, 60–79% yellow, 80% and up green.
const tone = (p) => (p < 40 ? 'red' : p < 60 ? 'orange' : p < 80 ? 'yellow' : 'green');
const bar = (p) => `<div class="pbar ${tone(p)}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${Math.max(p, 3)}%"></i></div>`;
const mainCard = (p, tip, href) => `<${href ? `a href="${href}"` : 'div'} class="prof-main ${tone(p)}" ${href ? '' : 'id="pmain"'}>
    <div class="pm-top"><span>Profile Complete</span><b>${p}%</b></div>${bar(p)}<p>${tip}</p></${href ? 'a' : 'div'}>`;
function nextTip(d) {
  const a = d.answers;
  const n = Number(String(d.household || '1').replace('+', ''));
  if ((a.members || []).length < n) return `Your home has ${d.household} people. Add the other ${n - (a.members || []).length === 1 ? 'person' : 'people'} in Save more on Groceries.`;
  for (const s of SECTIONS) {
    const q = s.questions.find((x) => x.star && x.type !== 'later' && (!x.show || x.show(a)) && !answered(x, a));
    if (q) return `Next: ${q.label.replace(/\?$/, '')} (${s.title}).`;
  }
  return 'Your profile is complete. Thanks!';
}

// ---------- More ----------
export async function more() {
  const { app, esc, state } = ctx;
  app.innerHTML = `<h1>More</h1>
    <h2 class="sec-title">Save More</h2>
    <div class="save-grid">${MODULES.map((m) => `<a class="save-card" href="#/${m.id}"><span class="ic" aria-hidden="true">${m.icon}</span><b>${m.title}</b><span>${m.blurb}</span>${m.live ? '' : '<em>Coming soon</em>'}</a>`).join('')}</div>
    <h2 class="sec-title">Your profile</h2>
    <div id="pc">${mainCard(0, 'Loading…', '#/profile')}</div>
    <h2 class="sec-title">Settings</h2>
    <div class="card menu">
      <a href="#/alerts"><span class="ic">🔔</span><span>Alerts<span class="sub">Turn special alerts on or off for this device</span></span></a>
      <a href="#/install"><span class="ic">📲</span><span>Add to Home Screen<span class="sub">Install on iPhone or Android</span></span></a>
      <a href="#/about"><span class="ic">ℹ️</span><span>About the prices<span class="sub">Where they come from and how often</span></span></a>
      ${state.me?.isAdmin ? '<a href="#/admin"><span class="ic">🛠️</span><span>Admin<span class="sub">Spend, data runs, match review, testers</span></span></a>' : ''}
      <button id="logout"><span class="ic">↩︎</span><span>Sign out<span class="sub">Signed in as ${esc(state.me?.name)}</span></span></button>
    </div>
    <p class="small muted center" style="margin-top:20px">Fair Whack FW2.0 internal beta · for testers only · please don't share screenshots outside the team</p>`;
  document.getElementById('logout').onclick = ctx.logout;
  billsSummary().then((t) => { const el = document.querySelector('.save-card[href="#/bills"] span:not(.ic)'); if (t && el) el.textContent = t.short; }).catch(() => {});
  try {
    const d = await load(true);
    const p = pct(SECTIONS.map((s) => progress(s, d.answers)));
    const el = document.getElementById('pc');
    if (el) el.innerHTML = mainCard(p, esc(nextTip(d)), '#/profile');
  } catch {}
}

// ---------- Fuel / Bills (placeholders until each module ships) ----------
const $m = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;
let summaryP = null;
/** Monthly savings across electricity and gas, for the More card and the profile. */
async function billsSummary(force) {
  if (!summaryP || force) {
    summaryP = Promise.all(['elec', 'gas'].map((f) => ctx.api(`/api/bills/estimate?fuel=${f}`).catch(() => null))).then(([e, g]) => {
      const save = (r) => (r?.best?.length && r.current?.total ? Math.max(0, (r.current.total - r.best[0].year) / 12) : null);
      const se = save(e), sg = save(g);
      if (se == null && sg == null) return null;
      const tot = (se || 0) + (sg || 0);
      return { e: se, g: sg, short: tot >= 1 ? `Save about ${$m(tot)} a month` : 'Your plans look good' };
    });
  }
  return summaryP;
}

export async function modulePage(id, q) {
  if (id === 'bills') return billsPage(q);
  if (id === 'fueltest') return fuelTest();
  const { app, esc } = ctx;
  const m = MODULES.find((x) => x.id === id);
  const s = sectionById(m.profile);
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>${m.icon} ${m.title}</h1>
    <div class="card"><b>Coming soon</b><p class="small muted" style="margin:6px 0 0">${id === 'fuel'
    ? 'Fuel prices on a map near you, along any route from A to B, with brand filters and the cheapest and dearest marked.'
    : 'Every Victorian electricity and gas plan compared against your home, with an estimate of what you could save each month.'}</p></div>
    ${id === 'fuel' && ctx.state.me?.isAdmin ? '<p><a class="btn small light" href="#/fueltest">Admin: test Google fuel prices</a></p>' : ''}
    <h2 class="sec-title">Get ready</h2><div id="sp"></div>`;
  const d = await load();
  document.getElementById('sp').innerHTML = sectionCard(s, d.answers, esc);
}

// ---------- profile hub ----------
function sectionCard(s, a, esc, summary) {
  const p = progress(s, a);
  const live = MODULES.find((m) => m.profile === s.id)?.live !== false;
  let unlockedText = s.unlocked;
  if (s.id === 'fuel') unlockedText = 'All set. Fuel prices are sorted for your car.';
  if (s.id === 'bills') unlockedText = summary ? `Switching could save about ${$m(summary.e || 0)} a month on electricity${summary.g != null ? ` and ${$m(summary.g)} on gas` : ''}. See Bills.` : 'All set. See your savings in Bills.';
  const status = p.unlocked
    ? (live ? unlockedText : `All set. Your savings estimate will show here when ${s.id === 'fuel' ? 'Fuel' : 'Bills'} launches.`)
    : s.locked(p.starsLeft);
  return `<a class="card sec-card" href="#/profile/${s.id}">
    <div class="row"><b>${esc(s.title)}</b><span class="muted small">${p.done}/${p.total} answered</span></div>
    <p class="small">${esc(s.why)}</p>${bar(p.total ? Math.round((p.done / p.total) * 100) : 0)}
    <p class="small ${p.unlocked ? 'ok' : 'muted'}">${p.unlocked ? '✓ ' : ''}${esc(status)}</p></a>`;
}

export async function hub() {
  const { app, esc } = ctx;
  app.innerHTML = '<a class="back" href="#/more">‹ More</a><h1>Your profile</h1><p class="muted">Loading…</p>';
  const d = await load(true);
  const sum = progress(sectionById('bills'), d.answers).unlocked ? await billsSummary(true).catch(() => null) : null;
  const p = pct(SECTIONS.map((s) => progress(s, d.answers)));
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Your profile</h1>
    <p class="lead">The more you tell us, the better we can match specials and plans to your home, and the more you can save. Everything here is optional.</p>
    ${mainCard(p, esc(nextTip(d)))}
    <h2 class="sec-title">Your three ways to save</h2>
    ${SECTIONS.map((s) => sectionCard(s, d.answers, esc, s.id === 'bills' ? sum : null)).join('')}
    <p class="small muted">${PRIVACY}</p>`;
}

// ---------- section editor ----------
const pill = (name, v, label, on, multi, path) =>
  `<label class="pill"><input type="${multi ? 'checkbox' : 'radio'}" name="${name}" value="${v}" data-p="${path}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
const pills = (path, opts, cur, multi) => `<div class="pills">${opts.map((x) => pill(path, x.v, x.label, multi ? (cur || []).includes(x.v) : cur === x.v, multi, path)).join('')}</div>`;
const select = (path, opts, cur, blank = 'Choose…') =>
  `<select data-p="${path}"><option value="">${blank}</option>${opts.map((x) => `<option value="${x.v}" ${cur === x.v ? 'selected' : ''}>${x.label}</option>`).join('')}</select>`;
const input = (path, val, attrs = '') => `<input data-p="${path}" value="${ctx.esc(val ?? '')}" ${attrs}>`;

function fieldHtml(f, val, path) {
  if (f.type === 'choice') return f.options.length > 4 ? select(path, f.options, val) : pills(path, f.options, val, false);
  if (f.type === 'text') return input(path, val, `placeholder="${f.placeholder || ''}" maxlength="${f.max || 60}"`);
  const mode = f.type === 'int' ? 'numeric' : 'decimal';
  return input(path, val, `inputmode="${mode}" class="num"`);
}
function formHtml(fields, v, base) {
  return fields.filter((f) => !f.show || f.show(v || {})).map((f) =>
    `<div class="fld"><span class="fl">${f.label}</span>${fieldHtml(f, (v || {})[f.id], `${base}.${f.id}`)}</div>`).join('');
}

function questionHtml(q, a, d) {
  const { esc } = ctx;
  const v = a[q.id];
  let body = '';
  if (q.type === 'single') body = q.select ? select(q.id, q.options, v) : pills(q.id, q.options, v, false);
  else if (q.type === 'multi') {
    body = pills(q.id, q.options === 'categories' ? d.categories.filter((c) => c !== 'Other').map((c) => ({ v: c, label: esc(c) })) : q.options, v, true);
    const sel = (v || []).filter((k) => !(q.only || []).includes(k));
    if (q.counts && sel.length) {
      const cnt = a[`${q.id}_count`] || {};
      body += sel.map((k) => `<div class="fld cnt"><span class="fl">How many ${esc((q.options.find((x) => x.v === k)?.label || k).toLowerCase())}${k === 'other' ? ' pets' : 's'}?</span>
        ${pills(`${q.id}_count.${k}`, q.counts.map((c) => ({ v: c, label: c })), cnt[k] || '1', false)}</div>`).join('');
    }
    if (q.other && (v || []).includes('other')) body += `<div class="fld"><span class="fl">${q.other}</span>${input(`${q.id}_other`, a[`${q.id}_other`], 'maxlength="60" placeholder="e.g. Halal, dairy free"')}</div>`;
  }
  else if (q.type === 'members') {
    const ms = Array.isArray(v) && v.length ? v : [{ gender: '', age: '' }];
    const n = Number(String(d.household || '1').replace('+', ''));
    body = ms.map((m, i) => `<div class="mrow"><b>${i === 0 ? 'Person 1 (you)' : `Person ${i + 1}`}</b>
        ${select(`members.${i}.gender`, MEMBER_GENDERS, m.gender, 'Gender')}
        ${select(`members.${i}.age`, i === 0 ? AGE_BANDS.filter((b) => ADULT_BANDS.includes(b.v)) : AGE_BANDS, m.age, 'Age')}
        ${i > 0 ? `<button type="button" class="x" data-del="members.${i}" aria-label="Remove person ${i + 1}">✕</button>` : '<span></span>'}</div>`).join('')
      + (ms.length < MAX_MEMBERS ? '<button type="button" class="btn small light" data-add="members">+ Add a person</button>' : '')
      + (ms.length < n ? `<p class="small muted">You told us ${d.household} people live in your home.</p>` : '');
  } else if (q.type === 'address') {
    const x = v || {};
    body = `<div class="fld"><span class="fl">Street address</span>${input(`${q.id}.line`, x.line, 'autocomplete="street-address" placeholder="Start typing your address"')}</div>
      <div class="two"><div class="fld"><span class="fl">Suburb</span>${input(`${q.id}.suburb`, x.suburb, 'autocomplete="address-level2" placeholder="Bentleigh East"')}</div>
      <div class="fld"><span class="fl">Postcode</span>${input(`${q.id}.postcode`, x.postcode, 'inputmode="numeric" maxlength="4" autocomplete="postal-code" placeholder="3165" class="num"')}</div></div>`;
  } else if (q.type === 'places') {
    const ps = Array.isArray(v) ? v : [];
    const home = a.address?.line ? `${a.address.line}${a.address.suburb ? `, ${a.address.suburb}` : ''}` : 'Add your address in Save more on Groceries';
    body = `<div class="mrow place"><b>Home</b><span class="small muted">${esc(home)}</span></div>`
      + ps.map((p, i) => `<div class="mrow place">${input(`places.${i}.name`, p.name, 'placeholder="Name, e.g. Work" maxlength="30"')}
          ${input(`places.${i}.address`, p.address, 'placeholder="Address" maxlength="120"')}
          <button type="button" class="x" data-del="places.${i}" aria-label="Remove place">✕</button></div>`).join('')
      + '<button type="button" class="btn small light" data-add="places">+ Add a place</button>';
  } else if (q.type === 'vehicles') {
    const cs = Array.isArray(v) && v.length ? v : [{}];
    body = cs.map((c, i) => `<div class="subcard"><div class="row"><b>${esc(c.name) || `Car ${i + 1}`}</b>${cs.length > 1 ? `<button type="button" class="x" data-del="vehicles.${i}" aria-label="Remove car">✕</button>` : ''}</div>
        ${formHtml(VEHICLE_FIELDS, c, `vehicles.${i}`)}</div>`).join('')
      + (cs.length < 6 ? '<button type="button" class="btn small light" data-add="vehicles">+ Add a car</button>' : '');
  } else if (q.type === 'form') {
    const isUnknown = q.unknown && v?.unknown;
    body = (isUnknown ? '' : formHtml(q.fields, v, q.id))
      + (q.unknown ? `<label class="chk"><input type="checkbox" data-p="${q.id}.unknown" ${isUnknown ? 'checked' : ''}> ${q.unknown}</label>` : '');
  } else if (q.type === 'routes') {
    const rs = Array.isArray(v) ? v : [];
    body = (rs.length ? rs.map((r) => `<div class="mrow place"><b>${esc(r.name)}</b><span class="small muted">${r.points.map((p) => esc(p.label.split(',')[0])).join(' → ')}</span></div>`).join('') : '')
      + '<a class="btn small light" href="#/fuel?tab=route">Plan a route in Fuel</a>';
  } else if (q.type === 'later') body = '<span class="soon">Coming soon</span>';
  return `<fieldset class="q ${answered(q, a) ? 'done' : ''}"><legend>${esc(q.label)}${q.star ? ' <span class="star" title="Needed for your result">★</span>' : ''}</legend>
    ${q.hint ? `<p class="small muted">${esc(q.hint)}</p>` : ''}${body}</fieldset>`;
}

function setPath(a, path, value, s) {
  const parts = path.split('.');
  const q = s.questions.find((x) => x.id === parts[0]);
  if (!q && parts.length === 2) { a[parts[0]] = { ...(a[parts[0]] || {}), [parts[1]]: value }; return; }
  if (!q) { a[parts[0]] = value; return; }
  if (parts.length === 1) {
    if (q?.type === 'multi') {
      let arr = [...(a[q.id] || [])];
      arr = arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value];
      if ((q.only || []).includes(value) && arr.includes(value)) arr = [value];
      else arr = arr.filter((x) => !(q.only || []).includes(x));
      a[q.id] = arr;
    } else a[q.id] = value;
    return;
  }
  if (parts.length === 2) {
    a[parts[0]] = { ...(a[parts[0]] || {}), [parts[1]]: value };
    if (parts[1] === 'unknown') a[parts[0]] = value ? { unknown: true } : {};
    return;
  }
  const list = Array.isArray(a[parts[0]]) ? [...a[parts[0]]] : [];
  const i = Number(parts[1]);
  while (list.length <= i) list.push({});
  list[i] = { ...list[i], [parts[2]]: value };
  a[parts[0]] = list;
}

export async function editor(id) {
  const { app, esc, api, toast } = ctx;
  const s = sectionById(id);
  if (!s) { location.hash = '#/profile'; return; }
  const d = await load();
  const a = structuredClone(d.answers);
  let dirty = false;
  const render = () => {
    const p = progress(s, a);
    const qs = s.questions.filter((q) => !q.show || q.show(a));
    const groups = s.groups || [{ id: undefined }];
    app.innerHTML = `<a class="back" href="#/profile">‹ Your profile</a><h1>${esc(s.title)}</h1>
      <p class="lead">${esc(s.why)}</p>
      <div class="card"><div class="row"><b>${p.done} of ${p.total} answered</b><span class="small muted">★ needed for your result</span></div>${bar(p.total ? Math.round((p.done / p.total) * 100) : 0)}</div>
      <form id="hf" class="stack profile" novalidate>
        ${groups.map((g) => `${g.title ? `<h2 class="sec-title">${g.title}</h2>` : ''}${qs.filter((q) => q.group === g.id).map((q) => questionHtml(q, a, d)).join('')}`).join('')}
        <div class="savebar"><button class="btn block" id="save">Save</button></div>
        <p class="small muted">${PRIVACY}</p>
        <p class="center"><button type="button" class="btn danger small" id="clear">Clear this section</button></p>
      </form>`;
    bind();
  };
  const bind = () => {
    const f = document.getElementById('hf');
    f.addEventListener('input', (e) => {
      const t = e.target;
      if (!t.dataset.p || t.tagName !== 'INPUT' || ['radio', 'checkbox'].includes(t.type)) return;
      setPath(a, t.dataset.p, t.value.trim(), s); dirty = true;
      // Typing over a picked address drops its map position.
      const m = t.dataset.p.match(/^(address)\.line$|^places\.(\d+)\.address$/);
      if (m) { const o = m[1] ? a.address : a.places?.[Number(m[2])]; if (o) { delete o.lat; delete o.lng; delete o.placeId; } }
    });
    f.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.dataset.p) return;
      if (t.type === 'text' || (t.tagName === 'INPUT' && !['radio', 'checkbox'].includes(t.type))) return render();
      const val = t.type === 'checkbox' && t.dataset.p.endsWith('.unknown') ? t.checked : t.value;
      setPath(a, t.dataset.p, val, s); dirty = true;
      const y = window.scrollY; render(); window.scrollTo(0, y);
    });
    // Address suggestions from Google (typing still works if Google can't load).
    const redraw = () => { dirty = true; const y = window.scrollY; render(); window.scrollTo(0, y); };
    attachAutocomplete(f.querySelector('[data-p="address.line"]'), (x) => {
      a.address = { line: x.line, suburb: x.suburb, postcode: x.postcode, lat: x.lat, lng: x.lng, placeId: x.placeId };
      redraw();
    });
    f.querySelectorAll('[data-p^="places."][data-p$=".address"]').forEach((el) => attachAutocomplete(el, (x) => {
      const i = Number(el.dataset.p.split('.')[1]);
      a.places[i] = { ...a.places[i], address: x.full || [x.line, x.suburb].filter(Boolean).join(', '), lat: x.lat, lng: x.lng, placeId: x.placeId };
      redraw();
    }));
    f.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.add;
      a[k] = [...(Array.isArray(a[k]) && a[k].length ? a[k] : k === 'members' || k === 'vehicles' ? [{}] : []), {}];
      dirty = true; const y = window.scrollY; render(); window.scrollTo(0, y);
    }));
    f.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => {
      const [k, i] = b.dataset.del.split('.');
      a[k] = a[k].filter((_, j) => j !== Number(i));
      dirty = true; const y = window.scrollY; render(); window.scrollTo(0, y);
    }));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const btn = document.getElementById('save'); btn.disabled = true;
      try {
        const r = await api(`/api/household/${id}`, { method: 'PUT', body: { answers: a } });
        cache = { ...d, answers: r.answers, household: r.household ?? d.household };
        if (id === 'about' && Array.isArray(a.stores) && a.stores.length) { try { localStorage.setItem(ctx.HOME_STORES, JSON.stringify(a.stores)); } catch {} }
        dirty = false; toast('Saved'); location.hash = '#/profile';
      } catch (err) { btn.disabled = false; toast(err.message); }
    };
    document.getElementById('clear').onclick = async () => {
      if (!confirmClear()) return;
      const r = await api(`/api/household/${id}`, { method: 'DELETE' });
      cache = { ...d, answers: r.answers }; dirty = false; toast('Cleared'); location.hash = '#/profile';
    };
  };
  const confirmClear = () => window.confirm(`Clear everything in ${s.title}?${id === 'about' ? ' Your age, gender and favourite categories from sign-up stay.' : ''}`);
  const leave = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  addEventListener('beforeunload', leave);
  addEventListener('hashchange', () => removeEventListener('beforeunload', leave), { once: true });
  render();
}

// ---------- Bills ----------
async function billsPage(q) {
  const { app, esc, api, toast } = ctx;
  const fuel = q?.get('fuel') === 'gas' ? 'gas' : 'elec';
  const unit = fuel === 'gas' ? 'MJ' : 'kWh';
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>⚡ Bills</h1>
    <div class="seg wide" role="tablist"><a href="#/bills" class="${fuel === 'elec' ? 'on' : ''}">Electricity</a><a href="#/bills?fuel=gas" class="${fuel === 'gas' ? 'on' : ''}">Gas</a></div>
    <div id="bl"><p class="muted">Comparing plans…</p></div>`;
  let r;
  try { r = await api(`/api/bills/estimate?fuel=${fuel}`); } catch (e) { document.getElementById('bl').innerHTML = `<p class="err">${esc(e.message)}</p>`; return; }
  const el = document.getElementById('bl');
  const finish = (title, text, href = '#/profile/bills', cta = 'Finish your home profile') =>
    `<div class="card"><b>${title}</b><p class="small muted" style="margin:6px 0 10px">${text}</p><a class="btn small" href="${href}">${cta}</a></div>`;
  if (r.needAddress) { el.innerHTML = finish('Add your home address', 'We need your postcode to find the plans available at your home.', '#/profile/about', 'Add your address'); return; }
  if (r.noGas) { el.innerHTML = '<div class="card"><b>No mains gas</b><p class="small muted" style="margin:6px 0 0">Your profile says your home isn’t connected to mains gas, so there’s nothing to compare. Change this in Save more on Bills if that’s wrong.</p></div>'; return; }
  if (fuel === 'gas' && r.ready === false && !r.best) { el.innerHTML = finish('Tell us about your gas', 'Is your home on mains gas, and what do you use it for?'); return; }
  if (r.noPlans) { el.innerHTML = '<div class="card"><b>No plans found for your postcode yet</b><p class="small muted" style="margin:6px 0 0">Plan data is refreshed every Sunday. If your postcode is right, let us know.</p></div>'; return; }
  const cur = r.current?.total, best = r.best || [];
  const save = cur && best[0] ? Math.max(0, cur - best[0].year) : 0;
  const basis = { bill: 'from your last bill', retailer: `a typical ${esc(r.current?.brand || '')} plan, estimated for your home`, standing: 'the standard default offer, estimated for your home', typical: 'a typical plan, estimated for your home' }[r.current?.basis] || '';
  const net = r.networks?.length > 1 ? `<div class="card net"><b>Which ${fuel === 'gas' ? 'gas' : 'electricity'} network is on your bill?</b>
      <p class="small muted" style="margin:4px 0 8px">Your postcode is served by more than one. It’s printed on your bill as the “distributor”.</p>
      <div class="pills">${r.networks.map((n) => `<button type="button" class="pill-btn ${n === r.network ? 'on' : ''}" data-net="${esc(n)}">${esc(n.replace(/ \((electricity|gas)\)/, ''))}</button>`).join('')}</div>
      ${r.chosen ? '' : '<p class="small muted" style="margin:8px 0 0">Showing the more common one for now.</p>'}</div>` : '';
  const parts = r.usage?.parts || [];
  const totParts = parts.reduce((x, p) => x + p[1], 0) || 1;
  el.innerHTML = `
    ${r.missing?.length ? `<div class="card warn-card"><b>${r.missing.length} more answer${r.missing.length > 1 ? 's' : ''} for an accurate estimate</b><p class="small" style="margin:4px 0 8px">${r.missing.map(esc).join(' · ')}</p><a class="btn small" href="#/profile/bills">Answer now</a></div>` : ''}
    ${net}
    <div class="card hero-save">
      ${save >= 12 ? `<span class="small">You could save about</span><b>${$m(save / 12)} a month</b><span class="small">${$m(save)} a year by switching to ${esc(best[0].brandName)}</span>`
        : ['bill', 'retailer'].includes(r.current?.basis) ? `<b>You’re on a good deal</b><span class="small">None of the ${r.count} plan${r.count === 1 ? '' : 's'} we checked is clearly cheaper for your home.</span>`
        : `<span class="small">Cheapest plan for your home</span><b>${$m(best[0].month)} a month</b><span class="small">Tell us your retailer or add a bill to see what you’d save.</span>`}
      <p class="small muted" style="margin:10px 0 0">Now: about ${$m(cur / 12)} a month (${basis}).</p>
    </div>
    <h2 class="sec-title">Cheapest plans for your home</h2>
    ${best.map((b, i) => `<div class="card plan">
      <div class="row"><span class="rank">${i + 1}</span><div class="pn"><b>${esc(b.brandName)}</b><span class="small muted">${esc(b.name)}</span></div>
        <div class="pp"><b>${$m(b.month)}</b><span class="small muted">/month</span></div></div>
      <div class="tags"><span class="tag">${b.tariff}</span>${b.type !== 'MARKET' ? '<span class="tag">Default offer</span>' : ''}${b.cl ? '<span class="tag">Controlled load</span>' : ''}
        ${cur && cur - b.year >= 12 ? `<span class="tag good">Save ${$m(cur - b.year)}/yr</span>` : ''}</div>
      <p class="small muted" style="margin:6px 0 0">${$m(b.year)} a year · supply ${b.supplyDay.toFixed(0)}¢/day${b.condDisc ? ` · includes ${$m(b.condDisc)} of conditional discounts` : ''}${b.fit ? ` · ${$m(b.fit)} solar credits` : ''}</p>
      ${b.url ? `<p class="small" style="margin:6px 0 0"><a href="${esc(b.url)}" target="_blank" rel="noopener">View plan on ${esc(b.brandName)} ›</a></p>` : ''}
    </div>`).join('')}
    <h2 class="sec-title">Your estimated use</h2>
    <div class="card"><div class="row"><b>${(r.usage?.units || 0).toLocaleString('en-AU')} ${unit} a year</b><span class="small muted">${r.usage?.fromBill ? 'matched to your bill' : 'from your profile'}</span></div>
      ${parts.map(([k, v]) => `<div class="ub"><span>${esc(k)}</span><i style="width:${Math.max(2, Math.round((v / totParts) * 100))}%"></i><em>${v.toLocaleString('en-AU')}</em></div>`).join('')}
      ${r.usage?.solarKwh ? `<p class="small muted">Solar panels make about ${r.usage.solarKwh.toLocaleString('en-AU')} kWh a year; part of it is used at home and the rest earns feed-in credits.</p>` : ''}
      ${r.usage?.fromBill ? '' : '<p class="small" style="margin:8px 0 0"><a href="#/profile/bills">Add your last bill</a> for a sharper estimate.</p>'}
    </div>
    <p class="small muted" style="margin-top:14px">Estimates for the next 12 months, including GST. They leave out one-off sign-up credits, concessions and fees for paper bills or late payment, and can’t know every detail of your home. Check the plan with the retailer before you switch. Not financial advice.
    ${r.count} ${fuel === 'gas' ? 'gas' : 'electricity'} plan${r.count === 1 ? '' : 's'} compared on the ${esc((r.network || '').replace(/ \((electricity|gas)\)/, ''))} network. Plan data: Australian Energy Regulator${r.updated ? `, updated ${new Date(r.updated).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}. You can also compare at <a href="https://compare.energy.vic.gov.au" target="_blank" rel="noopener">Victorian Energy Compare</a>.</p>`;
  el.querySelectorAll('[data-net]').forEach((b) => (b.onclick = async () => {
    try { await api('/api/bills/network', { method: 'POST', body: { fuel, network: b.dataset.net } }); summaryP = null; billsPage(q); } catch (e) { toast(e.message); }
  }));
}

// ---------- Admin: does Google Places have Victorian fuel prices? ----------
async function fuelTest() {
  const { app, esc } = ctx;
  app.innerHTML = `<a class="back" href="#/fuel">‹ Fuel</a><h1>Google fuel price test</h1>
    <p class="lead">Looks up petrol stations within 5 km and shows the fuel prices Google has for them, and how old they are.</p>
    <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn small" id="ft-home">Near my home address</button><button class="btn small light" id="ft-here">Near where I am now</button></div>
    <div id="ft" style="margin-top:12px"></div>`;
  const out = document.getElementById('ft');
  const run = async (center, label) => {
    out.innerHTML = `<p class="muted">Asking Google about stations near ${esc(label)}…</p>`;
    const lib = await loadPlaces();
    if (!lib?.Place?.searchNearby) { out.innerHTML = '<p class="err">Google Maps didn’t load. Check the connection and try again.</p>'; return; }
    let places;
    try {
      await ctx.api('/api/fuel/quota', { method: 'POST', body: { calls: 1 } });
      ({ places } = await lib.Place.searchNearby({
        fields: ['displayName', 'formattedAddress', 'location', 'fuelOptions'],
        locationRestriction: { center, radius: 5000 }, includedPrimaryTypes: ['gas_station'], maxResultCount: 20, rankPreference: 'DISTANCE',
      }));
    } catch (e) { out.innerHTML = `<p class="err">Google refused the request: ${esc(e.message || e)}</p><p class="small muted">If it mentions billing or permissions, the fuel price data may need a different API setting.</p>`; return; }
    const now = Date.now();
    const rows = (places || []).map((p) => {
      const prices = (p.fuelOptions?.fuelPrices || []).map((f) => {
        const m = f.price || {};
        const val = m.units != null ? Number(m.units) + Number(m.nanos || 0) / 1e9 : Number(String(m).replace(/[^\d.]/g, ''));
        const t = f.updateTime ? new Date(f.updateTime) : null;
        return { type: String(f.type || '').replace(/_/g, ' ').toLowerCase(), val, hours: t ? (now - t.getTime()) / 3600000 : null };
      });
      return { name: p.displayName?.text || p.displayName || '', addr: p.formattedAddress || '', prices };
    });
    const withP = rows.filter((r) => r.prices.length);
    const ages = withP.flatMap((r) => r.prices.map((x) => x.hours)).filter((x) => x != null).sort((a, b) => a - b);
    const med = ages.length ? ages[Math.floor(ages.length / 2)] : null;
    const fmtAge = (h) => (h == null ? 'unknown' : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
    out.innerHTML = `<div class="card"><b>${withP.length} of ${rows.length} stations have prices</b>
        <p class="small muted" style="margin:4px 0 0">Typical price age: ${fmtAge(med)}${ages.length ? ` · newest ${fmtAge(ages[0])} · oldest ${fmtAge(ages[ages.length - 1])}` : ''}</p></div>
      ${rows.map((r) => `<div class="card" style="margin-top:8px"><b>${esc(r.name)}</b><p class="small muted" style="margin:2px 0 6px">${esc(r.addr)}</p>
        ${r.prices.length ? r.prices.map((x) => `<div class="small">${esc(x.type)}: <b>${Number.isFinite(x.val) ? `$${x.val.toFixed(3)}` : '?'}</b> <span class="muted">(${fmtAge(x.hours)} ago)</span></div>`).join('') : '<p class="small muted" style="margin:0">No prices from Google</p>'}</div>`).join('')}`;
  };
  document.getElementById('ft-home').onclick = async () => {
    const d = await load();
    const ad = d.answers.address;
    if (ad?.lat) run({ lat: ad.lat, lng: ad.lng }, ad.suburb || 'home');
    else out.innerHTML = '<p class="err">Your home address has no map position yet. Pick it from the suggestions in Save more on Groceries, or use “Near where I am now”.</p>';
  };
  document.getElementById('ft-here').onclick = () => {
    if (!navigator.geolocation) { out.innerHTML = '<p class="err">This browser can’t share your location.</p>'; return; }
    out.innerHTML = '<p class="muted">Finding you…</p>';
    navigator.geolocation.getCurrentPosition((p) => run({ lat: p.coords.latitude, lng: p.coords.longitude }, 'you'),
      () => { out.innerHTML = '<p class="err">Location was not allowed.</p>'; }, { timeout: 10000 });
  };
}

// FW2.0: More page (Save More), profile hub and the three profile sections. Loaded on demand from app.js.
import {
  SECTIONS, VEHICLE_FIELDS, AGE_BANDS, ADULT_BANDS, MEMBER_GENDERS, MAX_MEMBERS, sectionById, progress, answered,
} from './household.js?v=1';

// Save More modules. Add a new one here (e.g. investing) and it gets a card on More.
export const MODULES = [
  { id: 'fuel', title: 'Fuel', icon: '⛽', blurb: 'Cheapest fuel near you and along your routes', profile: 'fuel', live: false },
  { id: 'bills', title: 'Bills', icon: '⚡', blurb: 'Electricity and gas plans compared for your home', profile: 'bills', live: false },
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
const bar = (p) => `<div class="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${p}"><i style="width:${p}%"></i></div>`;
function nextTip(d) {
  const a = d.answers;
  const n = Number(String(d.household || '1').replace('+', ''));
  if ((a.members || []).length < n) return `Your home has ${d.household} people. Add the other ${n - (a.members || []).length === 1 ? 'person' : 'people'} in About You and Your Family.`;
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
    <a class="card prof-card" href="#/profile" id="pc"><div class="row"><b>Your profile</b><span class="muted small">Loading…</span></div>${bar(0)}<p class="small muted"> </p></a>
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
  try {
    const d = await load(true);
    const p = pct(SECTIONS.map((s) => progress(s, d.answers)));
    const el = document.getElementById('pc');
    if (el) el.innerHTML = `<div class="row"><b>Your profile</b><span class="muted small">${p}% complete</span></div>${bar(p)}<p class="small muted">${esc(nextTip(d))}</p>`;
  } catch {}
}

// ---------- Fuel / Bills (placeholders until each module ships) ----------
export async function modulePage(id) {
  const { app, esc } = ctx;
  const m = MODULES.find((x) => x.id === id);
  const s = sectionById(m.profile);
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>${m.icon} ${m.title}</h1>
    <div class="card"><b>Coming soon</b><p class="small muted" style="margin:6px 0 0">${id === 'fuel'
    ? 'Fuel prices on a map near you, along any route from A to B, with brand filters and the cheapest and dearest marked.'
    : 'Every Victorian electricity and gas plan compared against your home, with an estimate of what you could save each month.'}</p></div>
    <h2 class="sec-title">Get ready</h2><div id="sp"></div>`;
  const d = await load();
  document.getElementById('sp').innerHTML = sectionCard(s, d.answers, esc);
}

// ---------- profile hub ----------
function sectionCard(s, a, esc) {
  const p = progress(s, a);
  const live = MODULES.find((m) => m.profile === s.id)?.live !== false;
  const status = p.unlocked
    ? (live ? s.unlocked : `All set. Your savings estimate will show here when ${s.id === 'fuel' ? 'Fuel' : 'Bills'} launches.`)
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
  const p = pct(SECTIONS.map((s) => progress(s, d.answers)));
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>Your profile</h1>
    <p class="lead">The more you tell us, the better we can match specials and plans to your home, and the more you can save. Everything here is optional.</p>
    <div class="card"><div class="row"><b>${p}% complete</b></div>${bar(p)}<p class="small muted">${esc(nextTip(d))}</p></div>
    ${SECTIONS.map((s) => sectionCard(s, d.answers, esc)).join('')}
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
  else if (q.type === 'multi') body = pills(q.id, q.options === 'categories' ? d.categories.filter((c) => c !== 'Other').map((c) => ({ v: c, label: esc(c) })) : q.options, v, true);
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
    body = `<div class="fld"><span class="fl">Street address</span>${input(`${q.id}.line`, x.line, 'autocomplete="street-address" placeholder="12 Smith St"')}</div>
      <div class="two"><div class="fld"><span class="fl">Suburb</span>${input(`${q.id}.suburb`, x.suburb, 'autocomplete="address-level2" placeholder="Bentleigh East"')}</div>
      <div class="fld"><span class="fl">Postcode</span>${input(`${q.id}.postcode`, x.postcode, 'inputmode="numeric" maxlength="4" autocomplete="postal-code" placeholder="3165" class="num"')}</div></div>`;
  } else if (q.type === 'places') {
    const ps = Array.isArray(v) ? v : [];
    const home = a.address?.line ? `${a.address.line}${a.address.suburb ? `, ${a.address.suburb}` : ''}` : 'Add your address in About You and Your Family';
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
  } else if (q.type === 'later') body = '<span class="soon">Coming soon</span>';
  return `<fieldset class="q ${answered(q, a) ? 'done' : ''}"><legend>${esc(q.label)}${q.star ? ' <span class="star" title="Needed for your result">★</span>' : ''}</legend>
    ${q.hint ? `<p class="small muted">${esc(q.hint)}</p>` : ''}${body}</fieldset>`;
}

function setPath(a, path, value, s) {
  const parts = path.split('.');
  const q = s.questions.find((x) => x.id === parts[0]);
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
    });
    f.addEventListener('change', (e) => {
      const t = e.target;
      if (!t.dataset.p) return;
      if (t.type === 'text' || (t.tagName === 'INPUT' && !['radio', 'checkbox'].includes(t.type))) return render();
      const val = t.type === 'checkbox' && t.dataset.p.endsWith('.unknown') ? t.checked : t.value;
      setPath(a, t.dataset.p, val, s); dirty = true;
      const y = window.scrollY; render(); window.scrollTo(0, y);
    });
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

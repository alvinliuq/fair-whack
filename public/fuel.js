// FW2.0c Fuel: prices near you and along a route, on a Google map. Prices come from Google Places (fuelOptions).
// Places content is used live and kept only in memory for a few minutes (Google terms: no storing).
import { MAPS_KEY, loadPlaces, attachAutocomplete } from './maps.js?v=1';

let ctx; // { api, esc, toast, app, state, sheet }
export function init(c) { ctx = c; }

export const FUELS = [
  { k: 'u91', label: 'ULP 91', g: ['SP91', 'REGULAR_UNLEADED'] },
  { k: 'e10', label: 'E10', g: ['SP91_E10', 'SP95_E10'] },
  { k: 'p95', label: 'Premium 95', g: ['SP95', 'PREMIUM', 'MIDGRADE'] },
  { k: 'p98', label: 'Premium 98', g: ['SP98', 'SP99', 'SP100'] },
  { k: 'diesel', label: 'Diesel', g: ['DIESEL', 'TRUCK_DIESEL'] },
  { k: 'lpg', label: 'LPG', g: ['LPG'] },
];
const BRANDS = [
  ['7-Eleven', /7[\s-]?eleven/i, '#F47B20'], ['Ampol', /ampol|caltex|foodary/i, '#E30613'], ['BP', /\bbp\b/i, '#009B3A'],
  ['Shell', /shell|reddy|coles express/i, '#F7C600'], ['United', /united/i, '#0057B8'], ['Mobil', /mobil/i, '#0050A0'],
  ['Liberty', /liberty/i, '#C8102E'], ['Metro', /metro/i, '#00A651'], ['Costco', /costco/i, '#005DAA'], ['Apco', /apco/i, '#D71920'],
  ['Puma', /puma/i, '#E2001A'], ['Viva', /viva energy/i, '#7A1F7A'],
];
const brandOf = (name) => (BRANDS.find(([, re]) => re.test(name)) || ['Independent', null, '#6E6880']);
const LS = { fuel: 'fw_fuel_type', radius: 'fw_fuel_radius', brands: 'fw_fuel_brands' };
const get = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v ?? d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const km = (a, b) => { const R = 6371, r = Math.PI / 180; const dl = (b.lat - a.lat) * r, dg = (b.lng - a.lng) * r;
  const x = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dg / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const cents = (v) => (v > 10 ? v : v * 100);
const ago = (h) => (h == null ? '' : h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`);
const PROFILE_FUEL = { u91: 'u91', e10: 'e10', p95: 'p95', p98: 'p98', diesel: 'diesel', lpg: 'lpg' };

// ---------- data ----------
const memo = new Map(); // key -> { at, places }
const MEMO_MS = 30 * 60000;
/** Every paid Google search asks the server first, so the beta stays inside Google's free monthly allowance. */
async function allow(calls = 1) { await ctx.api('/api/fuel/quota', { method: 'POST', body: { calls } }); }
function toStation(p) {
  const name = p.displayName?.text || p.displayName || '';
  const loc = p.location ? (typeof p.location.lat === 'function' ? { lat: p.location.lat(), lng: p.location.lng() } : { lat: p.location.latitude ?? p.location.lat, lng: p.location.longitude ?? p.location.lng }) : null;
  const now = Date.now();
  const prices = {};
  for (const f of p.fuelOptions?.fuelPrices || []) {
    const t = String(f.type || '').toUpperCase();
    const m = f.price || {};
    const val = m.units != null ? Number(m.units) + Number(m.nanos || 0) / 1e9 : Number(String(m).replace(/[^\d.]/g, ''));
    const at = f.updateTime ? new Date(f.updateTime).getTime() : null;
    const fuel = FUELS.find((x) => x.g.includes(t));
    if (!fuel || !Number.isFinite(val) || val <= 0) continue;
    const c = cents(val), hours = at ? (now - at) / 3600000 : null;
    if (!prices[fuel.k] || (fuel.g.indexOf(t) < fuel.g.indexOf(prices[fuel.k].t))) prices[fuel.k] = { c, hours, t };
  }
  const [brand, , color] = brandOf(name);
  return { id: p.id, name, addr: p.formattedAddress || '', loc, prices, brand, color };
}
async function nearby(center, radiusKm) {
  const key = `n:${center.lat.toFixed(3)},${center.lng.toFixed(3)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.places.filter((s) => km(center, s.loc) <= radiusKm + 0.05);
  const lib = await loadPlaces();
  if (!lib?.Place?.searchNearby) throw new Error('Google Maps didn’t load. Check your connection and try again.');
  // One search returns the 20 nearest stations (each search counts against the free allowance).
  await allow(1);
  const res = [await lib.Place.searchNearby({
    fields: ['id', 'displayName', 'formattedAddress', 'location', 'fuelOptions'],
    locationRestriction: { center, radius: 10000 }, // always the widest area; the chosen area is filtered on the device
    includedPrimaryTypes: ['gas_station'], maxResultCount: 20, rankPreference: 'DISTANCE',
  })];
  const seen = new Map();
  for (const { places } of res) for (const p of places || []) if (!seen.has(p.id)) seen.set(p.id, toStation(p));
  const all = [...seen.values()].filter((s) => s.loc);
  memo.set(key, { at: Date.now(), places: all });
  return all.filter((s) => km(center, s.loc) <= radiusKm + 0.05);
}

// polyline (Google encoded) → [{lat,lng}]
function decode(str) {
  const pts = []; let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lng += d;
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}
const ll = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
async function computeRoute(points) {
  const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS_KEY, 'X-Goog-FieldMask': 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration' },
    body: JSON.stringify({ origin: ll(points[0]), destination: ll(points[points.length - 1]), intermediates: points.slice(1, -1).map(ll), travelMode: 'DRIVE', languageCode: 'en-AU', regionCode: 'AU' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.routes?.[0]) throw new Error(d.error?.message || 'Couldn’t work out that route.');
  const rt = d.routes[0];
  return { enc: rt.polyline.encodedPolyline, path: decode(rt.polyline.encodedPolyline), km: (rt.distanceMeters || 0) / 1000, mins: Math.round(parseInt(rt.duration || '0', 10) / 60) };
}
function distToPath(p, path) {
  let best = Infinity;
  for (let i = 0; i < path.length; i += Math.max(1, Math.floor(path.length / 600))) best = Math.min(best, km(p, path[i]));
  return best;
}
async function alongRoute(route, corridorKm) {
  const key = `r:${route.enc.length}:${route.enc.slice(0, 60)}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_MS) return hit.places.filter((s) => s.off <= corridorKm);
  let raw = [];
  await allow(1);
  try {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': MAPS_KEY, 'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.fuelOptions' },
      body: JSON.stringify({ textQuery: 'petrol station', includedType: 'gas_station', pageSize: 20, searchAlongRouteParameters: { polyline: { encodedPolyline: route.enc } } }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error?.message || 'search failed');
    raw = (d.places || []).map(toStation);
  } catch {
    // Fallback: three circles (start, middle, end of the route).
    const lib = await loadPlaces();
    if (lib?.Place?.searchNearby) {
      await allow(3);
      const pts = [route.path[0], route.path[Math.floor(route.path.length / 2)], route.path[route.path.length - 1]];
      const res = await Promise.all(pts.map((c) => lib.Place.searchNearby({
        fields: ['id', 'displayName', 'formattedAddress', 'location', 'fuelOptions'],
        locationRestriction: { center: c, radius: Math.round(Math.max(3000, corridorKm * 1000 + 1000)) }, includedPrimaryTypes: ['gas_station'], maxResultCount: 20, rankPreference: 'DISTANCE',
      }).catch(() => ({ places: [] }))));
      for (const { places } of res) raw.push(...(places || []).map(toStation));
    }
  }
  const seen = new Map();
  for (const s of raw) if (s.loc && !seen.has(s.id)) { s.off = distToPath(s.loc, route.path); seen.set(s.id, s); }
  const all = [...seen.values()];
  memo.set(key, { at: Date.now(), places: all });
  return all.filter((s) => s.off <= corridorKm);
}

// ---------- map ----------
let gm = null; // { map, markers, me, line }
async function mapIn(el, center, zoom = 13) {
  await loadPlaces();
  const { Map } = await google.maps.importLibrary('maps');
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
  const map = new Map(el, { center, zoom, mapId: 'DEMO_MAP_ID', disableDefaultUI: true, zoomControl: false, gestureHandling: 'greedy', clickableIcons: false });
  gm = { map, AME: AdvancedMarkerElement, markers: [], me: null, line: null };
  map.addListener('zoom_changed', () => el.classList.toggle('far', map.getZoom() < 13));
  return gm;
}
function clearMarkers() { for (const m of gm?.markers || []) m.map = null; if (gm) gm.markers = []; }
function meMarker(pos) {
  if (!gm) return;
  if (gm.me) gm.me.map = null;
  const d = document.createElement('div'); d.className = 'fme';
  gm.me = new gm.AME({ map: gm.map, position: pos, content: d, zIndex: 1 });
}

// ---------- page ----------
const st = { tab: 'near', center: null, centerLabel: '', list: false, sel: null, route: null, points: [], corridor: 1, stations: [] };

export async function page(q) {
  const { app, esc } = ctx;
  st.tab = ['near', 'route', 'saved'].includes(q?.get('tab')) ? q.get('tab') : st.tab || 'near';
  const prof = await ctx.api('/api/household').catch(() => ({ answers: {} }));
  const a = prof.answers || {};
  if (!localStorage.getItem(LS.fuel)) { const v = (a.vehicles || [])[0]?.fuel; if (PROFILE_FUEL[v]) set(LS.fuel, PROFILE_FUEL[v]); }
  st.home = a.address?.lat ? { lat: a.address.lat, lng: a.address.lng, label: 'Home' } : null;
  st.places = [...(st.home ? [{ name: 'Home', lat: st.home.lat, lng: st.home.lng, address: [a.address.line, a.address.suburb].filter(Boolean).join(', ') }] : []),
    ...(a.places || []).filter((p) => p.lat)];
  st.routes = a.routes || [];
  st.fuelAnswers = a;
  app.innerHTML = `<a class="back" href="#/more">‹ More</a><h1>⛽ Fuel</h1>
    <div class="seg wide" role="tablist">${[['near', 'Nearby'], ['route', 'Route'], ['saved', 'Saved']].map(([k, l]) => `<a href="#/fuel?tab=${k}" data-replace class="${st.tab === k ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="fz"></div><p class="small muted" id="fquota"></p>`;
  if (ctx.state.me?.isAdmin) ctx.api('/api/fuel/quota').then((u) => { const el = document.getElementById('fquota'); if (el) el.textContent = `Admin: ${u.usedMonth} of ${u.limits.month} Google fuel searches used this month (free allowance 1,000).`; }).catch(() => {});
  if (st.tab === 'near') return nearTab();
  if (st.tab === 'route') return routeTab();
  return savedTab();
}

function chipsBar() {
  const fuel = FUELS.find((f) => f.k === get(LS.fuel, 'u91')) || FUELS[0];
  const brands = get(LS.brands, []);
  return `<div class="fchips">
    <button class="fchip on" data-act="fuel">⛽ ${fuel.label}</button>
    <button class="fchip ${brands.length ? 'on' : ''}" data-act="brands">🏷 ${brands.length ? `Brands (${brands.length})` : 'Brands'}</button>
    ${st.tab === 'near' ? `<button class="fchip" data-act="radius">${get(LS.radius, 5)} km</button>` : `<button class="fchip" data-act="corridor">Within ${st.corridor} km</button>`}
    <button class="fchip right" data-act="list">${st.list ? '🗺 Map' : '☰ List'}</button></div>`;
}

function visible(stations) {
  const fk = get(LS.fuel, 'u91');
  const brands = get(LS.brands, []);
  const rows = stations.filter((s) => s.prices[fk] && (!brands.length || brands.includes(s.brand)));
  const vals = rows.map((s) => s.prices[fk].c);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return { fk, rows: rows.sort((x, y) => x.prices[fk].c - y.prices[fk].c), lo, hi, noPrice: stations.filter((s) => !s.prices[fk] && (!brands.length || brands.includes(s.brand))) };
}

function render(stations, center) {
  const { esc } = ctx;
  const z = document.getElementById('fz-body');
  if (!z) return;
  st.stations = stations;
  const v = visible(stations);
  const info = document.getElementById('fz-info');
  const ages = v.rows.map((s) => s.prices[v.fk].hours).filter((x) => x != null).sort((x, y) => x - y);
  if (info) info.innerHTML = v.rows.length
    ? `${v.rows.length} station${v.rows.length === 1 ? '' : 's'} with ${esc(FUELS.find((f) => f.k === v.fk).label)} prices${v.lo < v.hi ? ` · cheapest <b>${v.lo.toFixed(1)}</b> · dearest <b>${v.hi.toFixed(1)}</b>` : ` · <b>${v.lo.toFixed(1)}</b>`} ¢/L${ages.length ? ` · prices typically ${ago(ages[Math.floor(ages.length / 2)])}` : ''}`
    : 'No prices for this fuel here. Try another fuel, more brands or a wider area.';
  // markers
  if (gm) {
    clearMarkers();
    for (const s of v.rows) {
      const p = s.prices[v.fk].c;
      const tag = v.lo < v.hi && p === v.lo ? 'low' : v.lo < v.hi && p === v.hi ? 'high' : '';
      const d = document.createElement('button');
      d.type = 'button';
      d.className = `fmk ${tag}`;
      d.innerHTML = `<b>${p.toFixed(1)}</b>${tag ? `<em>${tag === 'low' ? 'Lowest' : 'Highest'}</em>` : ''}<span style="background:${s.color}">${esc(s.brand === 'Independent' ? s.name.slice(0, 10) : s.brand)}</span>`;
      const m = new gm.AME({ map: gm.map, position: s.loc, content: d, zIndex: tag === 'low' ? 30 : tag === 'high' ? 20 : 10, title: s.name });
      d.addEventListener('click', () => showStation(s));
      gm.markers.push(m);
    }
  }
  const list = document.getElementById('fz-list');
  if (list) list.innerHTML = v.rows.map((s, i) => `<button class="frow" data-id="${esc(s.id)}"><span class="rank">${i + 1}</span>
      <span class="fb" style="background:${s.color}">${esc(s.brand)}</span>
      <span class="fn"><b>${esc(s.name)}</b><small>${esc(s.addr.split(',').slice(0, 2).join(','))}${center ? ` · ${km(center, s.loc).toFixed(1)} km` : ''}${s.off != null ? ` · ${s.off.toFixed(1)} km off route` : ''}</small></span>
      <span class="fp ${v.lo < v.hi && s.prices[v.fk].c === v.lo ? 'low' : v.lo < v.hi && s.prices[v.fk].c === v.hi ? 'high' : ''}"><b>${s.prices[v.fk].c.toFixed(1)}</b><small>${ago(s.prices[v.fk].hours)}</small></span></button>`).join('')
    + (v.noPrice.length ? `<p class="small muted" style="margin:10px 2px">${v.noPrice.length} more station${v.noPrice.length > 1 ? 's' : ''} nearby without a price for this fuel.</p>` : '');
  list?.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => showStation(stations.find((s) => s.id === b.dataset.id))));
}

function showStation(s) {
  const { esc, sheet } = ctx;
  if (!s) return;
  const dest = `https://www.google.com/maps/dir/?api=1&destination=${s.loc.lat},${s.loc.lng}&destination_place_id=${encodeURIComponent(s.id)}`;
  sheet(`<h3>${esc(s.name)}</h3><p class="small muted" style="margin:-4px 0 10px">${esc(s.addr)}</p>
    ${FUELS.filter((f) => s.prices[f.k]).map((f) => `<div class="row" style="justify-content:space-between;padding:6px 0;border-top:1px solid var(--line)"><span>${f.label}</span><span><b>${s.prices[f.k].c.toFixed(1)}</b> ¢/L <small class="muted">${ago(s.prices[f.k].hours)}</small></span></div>`).join('') || '<p class="muted">No prices from Google for this station.</p>'}
    <p style="margin-top:14px"><a class="btn block" href="${dest}" target="_blank" rel="noopener">Directions in Google Maps</a></p>
    <p class="small muted center">Prices from Google. Check the price board before you fill up.</p>`);
}

function bindChips(reload) {
  const { sheet, esc } = ctx;
  document.querySelectorAll('.fchips [data-act]').forEach((b) => (b.onclick = () => {
    const act = b.dataset.act;
    if (act === 'list') { st.list = !st.list; document.getElementById('fz').classList.toggle('as-list', st.list); b.textContent = st.list ? '🗺 Map' : '☰ List'; return; }
    if (act === 'fuel') {
      const cur = get(LS.fuel, 'u91');
      const close = sheet(`<h3>Fuel type</h3><div class="pills">${FUELS.map((f) => `<button class="pill-btn ${f.k === cur ? 'on' : ''}" data-f="${f.k}">${f.label}</button>`).join('')}</div>`, (s) => {
        s.querySelectorAll('[data-f]').forEach((x) => (x.onclick = () => { set(LS.fuel, x.dataset.f); close(); reload(); }));
      });
    }
    if (act === 'radius') {
      const cur = get(LS.radius, 5);
      const close = sheet(`<h3>Search area</h3><div class="pills">${[2, 5, 10].map((r) => `<button class="pill-btn ${r === cur ? 'on' : ''}" data-r="${r}">${r} km</button>`).join('')}</div>`, (s) => {
        s.querySelectorAll('[data-r]').forEach((x) => (x.onclick = () => { set(LS.radius, Number(x.dataset.r)); close(); reload(); }));
      });
    }
    if (act === 'corridor') {
      const close = sheet(`<h3>How far off the route?</h3><div class="pills">${[0.5, 1, 2, 3].map((r) => `<button class="pill-btn ${r === st.corridor ? 'on' : ''}" data-c="${r}">${r} km</button>`).join('')}</div>`, (s) => {
        s.querySelectorAll('[data-c]').forEach((x) => (x.onclick = () => { st.corridor = Number(x.dataset.c); close(); reload(); }));
      });
    }
    if (act === 'brands') {
      const counts = {};
      for (const s of st.stations) counts[s.brand] = (counts[s.brand] || 0) + 1;
      let sel = get(LS.brands, []);
      const names = Object.keys(counts).sort((x, y) => counts[y] - counts[x]);
      const draw = (s) => {
        s.querySelector('#bl').innerHTML = `<button class="pill-btn ${sel.length ? '' : 'on'}" data-b="__all">All</button>`
          + names.map((n) => `<button class="pill-btn ${sel.includes(n) ? 'on' : ''}" data-b="${esc(n)}">${esc(n)} <small>${counts[n]}</small></button>`).join('');
        s.querySelectorAll('[data-b]').forEach((x) => (x.onclick = () => {
          const n = x.dataset.b;
          if (n === '__all') sel = [];
          else sel = sel.includes(n) ? sel.filter((y) => y !== n) : [...sel, n];
          draw(s);
        }));
      };
      const close = sheet(`<h3>Brands</h3><p class="small muted" style="margin:-4px 0 10px">Pick one or more. All shows every brand.</p><div class="pills" id="bl"></div>
        <p style="margin-top:14px"><button class="btn block" id="bok">Show stations</button></p>`, (s) => {
        draw(s);
        s.querySelector('#bok').onclick = () => { set(LS.brands, sel); close(); reload(); };
      });
    }
  }));
}

function shell(extraTop = '') {
  return `${extraTop}${chipsBar()}<p class="small muted finfo" id="fz-info">Loading prices…</p>
    <div id="fz-body"><div class="fmap" id="fz-map"></div><button class="flocate" id="fz-loc" aria-label="Use my location">➤</button><div id="fz-list" class="flist"></div></div>
    <p class="small muted" style="margin-top:8px">Shows up to the 20 nearest stations. Prices from Google, usually updated within a day or two. Check the price board before you fill up.</p>`;
}

async function nearTab() {
  const { esc, toast } = ctx;
  const fz = document.getElementById('fz');
  if (!st.center) st.center = st.home || null;
  if (!st.center) {
    fz.innerHTML = `<div class="card"><b>Where should we look?</b><p class="small muted" style="margin:6px 0 10px">Use your location, or add your home address in your profile.</p>
      <button class="btn small" id="useloc">Use my location</button> <a class="btn small light" href="#/profile/about">Add home address</a></div>`;
    document.getElementById('useloc').onclick = () => locate(() => nearTab());
    return;
  }
  fz.innerHTML = shell(`<p class="small" style="margin:0 0 6px">Near <b>${esc(st.center.label || 'you')}</b></p>`);
  fz.classList.toggle('as-list', st.list);
  const reload = async (force) => {
    document.getElementById('fz-info').textContent = 'Loading prices…';
    try {
      const radius = get(LS.radius, 5);
      if (force) memo.clear();
      if (gm?.map) gm.map.setZoom(radius <= 2 ? 14 : radius <= 5 ? 13 : 12);
      render(await nearby(st.center, radius), st.center);
    } catch (e) { document.getElementById('fz-info').textContent = e.message; }
    document.querySelectorAll('.fchips').forEach((c) => c.outerHTML = chipsBar());
    bindChips(reload);
  };
  try { await mapIn(document.getElementById('fz-map'), st.center, 13); meMarker(st.center); } catch { document.getElementById('fz-map').innerHTML = '<p class="muted center" style="padding-top:40%">Map unavailable</p>'; }
  document.getElementById('fz-loc').onclick = () => locate(async () => { gm?.map.panTo(st.center); meMarker(st.center); reload(); });
  bindChips(reload);
  reload();

  function locate(done) {
    if (!navigator.geolocation) return toast('This browser can’t share your location');
    navigator.geolocation.getCurrentPosition((p) => { st.center = { lat: p.coords.latitude, lng: p.coords.longitude, label: 'your location' }; done(); },
      () => toast('Location not allowed. You can still use your home address.'), { timeout: 10000, maximumAge: 60000 });
  }
}

// ---------- route ----------
function pointInput(i, p, n) {
  const { esc } = ctx;
  const label = i === 0 ? 'From' : i === n - 1 ? 'To' : `Stop ${i}`;
  return `<div class="rpt"><span class="rl">${label}</span><div class="fld"><input data-i="${i}" value="${esc(p?.label || '')}" placeholder="Start typing an address" autocomplete="off"></div>
    <button type="button" class="qpick" data-pick="${i}" aria-label="Choose a saved place" aria-haspopup="listbox" aria-expanded="false">★</button>
    ${i > 0 && i < n - 1 ? `<button class="x" data-del="${i}" aria-label="Remove stop">✕</button>` : '<span></span>'}</div>`;
}
async function routeTab() {
  const { esc, toast, api } = ctx;
  const fz = document.getElementById('fz');
  if (!st.points.length) st.points = [st.home ? { ...st.home } : { label: '' }, { label: '' }];
  const quick = [{ label: 'My location', here: true }, ...st.places.map((p) => ({ label: p.name, sub: p.address, lat: p.lat, lng: p.lng }))];
  const draw = () => {
    fz.innerHTML = `<div class="card rform profile">
        ${st.points.map((p, i) => pointInput(i, p, st.points.length)).join('')}
        <div class="row" style="gap:8px;margin-top:10px"><button class="btn small light" id="addstop">+ Add a stop</button><button class="btn small" id="go">Show fuel along the route</button></div>
      </div><div id="rres"></div>`;
    fz.querySelectorAll('input[data-i]').forEach((el) => {
      const i = Number(el.dataset.i);
      el.addEventListener('focus', () => (st.focus = i));
      el.addEventListener('input', () => { st.points[i] = { label: el.value }; });
      attachAutocomplete(el, (x) => { st.points[i] = { label: x.full ? x.full.replace(/, Australia$/, '') : [x.line, x.suburb].filter(Boolean).join(', '), lat: x.lat, lng: x.lng }; draw(); });
    });
    fz.querySelectorAll('[data-del]').forEach((b) => (b.onclick = () => { st.points.splice(Number(b.dataset.del), 1); draw(); }));
    fz.querySelector('#addstop').onclick = () => { if (st.points.length >= 7) return toast('Up to 5 stops'); st.points.splice(st.points.length - 1, 0, { label: '' }); draw(); };
    // Saved-place picker: a ★ button beside each field opens a small menu (My location first).
    const closePick = () => { fz.querySelectorAll('.qp-list').forEach((m) => m.remove()); fz.querySelectorAll('.qpick').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); }); };
    fz.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const at = Number(b.dataset.pick);
      const open = b.classList.contains('on');
      closePick();
      if (open) return;
      b.classList.add('on'); b.setAttribute('aria-expanded', 'true');
      const menu = document.createElement('div');
      menu.className = 'ac-list qp-list';
      menu.setAttribute('role', 'listbox');
      menu.innerHTML = quick.map((q, k) => `<button type="button" role="option" data-q="${k}"><b>${q.here ? '📍' : '★'} ${esc(q.label)}</b>${q.sub ? `<span>${esc(q.sub)}</span>` : ''}</button>`).join('')
        + (st.places.length ? '' : '<div class="ac-by" style="text-align:left">No saved places yet. Add them in Profile → Save more on Fuel.</div>');
      b.closest('.rpt').appendChild(menu);
      menu.querySelectorAll('[data-q]').forEach((o) => (o.onclick = (ev) => {
        ev.stopPropagation();
        const qv = quick[Number(o.dataset.q)];
        closePick();
        const fill = (pt) => { st.points[at] = pt; st.focus = null; draw(); };
        if (qv.here) navigator.geolocation?.getCurrentPosition((p) => fill({ label: 'My location', lat: p.coords.latitude, lng: p.coords.longitude }), () => toast('Location not allowed'));
        else fill({ label: qv.label, lat: qv.lat, lng: qv.lng });
      }));
    }));
    if (!st.pickOutside) {
      st.pickOutside = true;
      document.addEventListener('click', (e) => {
        if (e.target.closest?.('.qp-list, .qpick')) return;
        document.querySelectorAll('.qp-list').forEach((m) => m.remove());
        document.querySelectorAll('.qpick.on').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); });
      });
    }
    fz.querySelector('#go').onclick = go;
  };
  const go = async () => {
    if (st.points.some((p) => !p.lat)) return toast('Pick each place from the suggestions');
    const res = document.getElementById('rres');
    res.innerHTML = shell('');
    document.getElementById('fz').classList.toggle('as-list', st.list);
    document.getElementById('fz-info').textContent = 'Working out the route…';
    let route;
    try { route = await computeRoute(st.points); } catch (e) { document.getElementById('fz-info').textContent = e.message; return; }
    st.route = route;
    const reload = async (force) => {
      document.getElementById('fz-info').textContent = 'Finding stations along the route…';
      if (force) memo.clear();
      try { render(await alongRoute(route, st.corridor), null); } catch (e) { document.getElementById('fz-info').textContent = e.message; }
      document.querySelectorAll('.fchips').forEach((c) => c.outerHTML = chipsBar());
      bindChips(reload);
    };
    try {
      await mapIn(document.getElementById('fz-map'), route.path[0], 12);
      const b = new google.maps.LatLngBounds(); route.path.forEach((p) => b.extend(p)); gm.map.fitBounds(b, 40);
      gm.line = new google.maps.Polyline({ map: gm.map, path: route.path, strokeColor: '#5B2BE0', strokeOpacity: 0.85, strokeWeight: 5 });
    } catch {}
    document.getElementById('fz-loc').remove();
    res.insertAdjacentHTML('afterbegin', `<p class="small" style="margin:12px 0 6px">${route.km.toFixed(1)} km · about ${route.mins} min drive
      <button class="btn small light" id="saveroute" style="margin-left:8px">★ Save route</button></p>`);
    document.getElementById('saveroute').onclick = () => saveRoute();
    bindChips(reload);
    reload();
  };
  const saveRoute = () => {
    const close = ctx.sheet(`<h3>Save this route</h3><div class="fld profile"><input id="rn" maxlength="30" placeholder="Name, e.g. To work"></div><p style="margin-top:12px"><button class="btn block" id="rs">Save</button></p>`, (s) => {
      s.querySelector('#rs').onclick = async () => {
        const name = s.querySelector('#rn').value.trim();
        if (!name) return;
        const routes = [...st.routes.filter((r) => r.name !== name), { name, points: st.points.map((p) => ({ label: p.label, lat: p.lat, lng: p.lng })) }].slice(-10);
        try {
          const cur = await api('/api/household');
          const fuelKeys = ['vehicles', 'fuel_brands', 'fuel_discounts', 'places'];
          const answers = Object.fromEntries(fuelKeys.filter((k) => cur.answers[k] !== undefined).map((k) => [k, cur.answers[k]]));
          await api('/api/household/fuel', { method: 'PUT', body: { answers: { ...answers, routes } } });
          st.routes = routes; ctx.profileChanged?.(); close(); toast('Route saved');
        } catch (e) { toast(e.message); }
      };
    });
  };
  draw();
  if (st.points.every((p) => p.lat) && st.points.length >= 2 && st.autoGo) { st.autoGo = false; go(); }
}

function savedTab() {
  const { esc } = ctx;
  const fz = document.getElementById('fz');
  fz.innerHTML = `<h2 class="sec-title">Saved places</h2>
    ${st.places.length ? st.places.map((p, i) => `<div class="card srow"><div><b>${esc(p.name)}</b><small>${esc(p.address || '')}</small></div>
      <div class="row" style="gap:6px"><button class="btn small light" data-near="${i}">Prices near</button><button class="btn small light" data-from="${i}">Route from</button></div></div>`).join('')
      : '<p class="small muted">No saved places yet.</p>'}
    <p><a class="btn small light" href="#/profile/fuel">Add or rename places</a></p>
    <h2 class="sec-title">Saved routes</h2>
    ${st.routes.length ? st.routes.map((r, i) => `<div class="card srow"><div><b>${esc(r.name)}</b><small>${r.points.map((p) => esc(p.label.split(',')[0])).join(' → ')}</small></div>
      <div class="row" style="gap:6px"><button class="btn small" data-route="${i}">Show prices</button><button class="btn small danger" data-delr="${i}" aria-label="Delete route">✕</button></div></div>`).join('')
      : '<p class="small muted">No saved routes yet. Plan one in Route and tap ★ Save route.</p>'}`;
  fz.querySelectorAll('[data-near]').forEach((b) => (b.onclick = () => { const p = st.places[Number(b.dataset.near)]; st.center = { lat: p.lat, lng: p.lng, label: p.name }; window.fwGo('#/fuel?tab=near', { replace: true }); }));
  fz.querySelectorAll('[data-from]').forEach((b) => (b.onclick = () => { const p = st.places[Number(b.dataset.from)]; st.points = [{ label: p.name, lat: p.lat, lng: p.lng }, { label: '' }]; window.fwGo('#/fuel?tab=route', { replace: true }); }));
  fz.querySelectorAll('[data-route]').forEach((b) => (b.onclick = () => { st.points = st.routes[Number(b.dataset.route)].points.map((p) => ({ ...p })); st.autoGo = true; window.fwGo('#/fuel?tab=route', { replace: true }); }));
  fz.querySelectorAll('[data-delr]').forEach((b) => (b.onclick = async () => {
    const routes = st.routes.filter((_, i) => i !== Number(b.dataset.delr));
    const cur = await ctx.api('/api/household');
    const answers = Object.fromEntries(['vehicles', 'fuel_brands', 'fuel_discounts', 'places'].filter((k) => cur.answers[k] !== undefined).map((k) => [k, cur.answers[k]]));
    await ctx.api('/api/household/fuel', { method: 'PUT', body: { answers: { ...answers, routes } } });
    st.routes = routes; ctx.profileChanged?.(); savedTab();
  }));
}

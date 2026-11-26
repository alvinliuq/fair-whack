// Fair Whack — friends and sharing (stage 7).
// Me → Friends: your @user name and QR code, scan a friend's code, add by user name, requests, friends.
// Me → My account: display name and @user name. Shared with you: products friends sent.
// Friends are added only when the other person accepts. Friends can't see each other's lists or profile.
let ctx;
export function init(c) { ctx = c; }

const $ = (s, el = document) => el.querySelector(s);
const ORIGIN = location.origin;
const addLink = (code) => `${ORIGIN}/#/add/${encodeURIComponent(code)}`;

// QR codes: small libraries copied in at deploy time (public/vendor), loaded only when needed.
const libs = {};
function loadScript(src, global) {
  if (window[global]) return Promise.resolve(window[global]);
  if (!libs[src]) libs[src] = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = () => (window[global] ? res(window[global]) : rej(new Error('not loaded')));
    s.onerror = () => rej(new Error('not loaded'));
    document.head.append(s);
  });
  return libs[src];
}
async function qrSvg(text) {
  const qrcode = await loadScript('/vendor/qrcode.js', 'qrcode');
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
}

// ---------- the Me menu (top right, every page) ----------
export async function meSheet() {
  const { state, esc, sheet } = ctx;
  const s = await socialData().catch(() => null);
  const badge = (n) => (n ? `<span class="pill">${n}</span>` : '');
  sheet(`<div class="me-head"><span class="avatar big">${esc(initials(state.me.name))}</span><div><b>${esc(state.me.name)}</b>${s ? `<div class="small muted">@${esc(s.me.handle)}</div>` : ''}</div></div>
    <div class="card menu">
      <a href="#/friends"><span class="ic">🧑‍🤝‍🧑</span><span>Friends ${badge(s?.incoming.length)}<span class="sub">Your QR code · add friends · requests</span></span></a>
      <a href="#/shared"><span class="ic">🎁</span><span>Shared with you ${badge(s?.unseenShares)}<span class="sub">Products your friends sent</span></span></a>
      <a href="#/account"><span class="ic">👤</span><span>My account<span class="sub">Name and user name</span></span></a>
      <a href="#/profile"><span class="ic">📋</span><span>My profile<span class="sub">You and your family, fuel, bills</span></span></a>
      ${state.me.isAdmin ? '<a href="#/admin"><span class="ic">🛠️</span><span>Admin<span class="sub">Spend, data runs, match review, testers</span></span></a>' : ''}
      <button id="me-out"><span class="ic">↩︎</span><span>Sign out</span></button>
    </div>`, null, () => ctx.markMe(false));
  ctx.markMe(true);
  $('#me-out').onclick = ctx.logout;
  document.querySelectorAll('#sheet .menu a').forEach((a) => a.addEventListener('click', () => { $('#sheet').hidden = true; }));
}

const initials = (n) => String(n || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

/** Friend requests + unseen shares: the dot on the Me button. */
export async function refreshBadge() {
  const s = await socialData(true).catch(() => null);
  const n = s ? s.incoming.length + s.unseenShares : 0;
  const b = $('#me-btn');
  if (b) { b.dataset.count = n ? String(n) : ''; b.setAttribute('aria-label', n ? `Me, ${n} new` : 'Me'); }
  return s;
}

let cache = null, cacheAt = 0;
async function socialData(fresh) {
  if (!fresh && cache && Date.now() - cacheAt < 15000) return cache;
  cache = await ctx.api('/api/social'); cacheAt = Date.now();
  return cache;
}
const invalidate = () => { cache = null; };

// ---------- Friends ----------
export async function friendsPage() {
  const { app, esc, api, toast } = ctx;
  app.innerHTML = '<h1>Friends</h1><p class="muted">Loading…</p>';
  const s = await socialData(true);
  const person = (p, actions) => `<div class="r friend"><span class="avatar">${esc(initials(p.name))}</span><span class="n"><b>${esc(p.name)}</b><span class="small muted">@${esc(p.handle || '')}</span></span>${actions}</div>`;
  app.innerHTML = `<h1>Friends</h1>
    <p class="lead">Share good finds with friends. Friends see only what you share with them, never your lists or profile.</p>
    <div class="card qr-card">
      <div id="qr" class="qr" aria-label="Your friend QR code"></div>
      <div class="qr-t"><b>@${esc(s.me.handle)}</b><span class="small muted">Friends scan this code, or add you by your user name. You'll be asked before anyone is added.</span>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap"><button class="btn small" id="scan">Scan a friend's code</button><button class="btn small light" id="byname">Add by user name</button><button class="btn small light" id="sharecode">Send my link</button></div></div>
    </div>
    ${s.incoming.length ? `<h2>Requests</h2><div class="card list-rows">${s.incoming.map((p) => person(p, `<button class="btn small" data-accept="${esc(p.id)}">Accept</button><button class="btn small light" data-decline="${esc(p.id)}">Decline</button>`)).join('')}</div>` : ''}
    <h2>Your friends ${s.friends.length ? `<span class="small muted">${s.friends.length}</span>` : ''}</h2>
    ${s.friends.length ? `<div class="card list-rows">${s.friends.map((p) => person(p, `<button class="linkbtn small" data-manage="${esc(p.id)}" data-name="${esc(p.name)}">Manage</button>`)).join('')}</div>`
      : '<div class="empty"><b>No friends yet</b>Show your QR code to someone, or add them by user name.</div>'}
    ${s.outgoing.length ? `<h2>Waiting for them to accept</h2><div class="card list-rows">${s.outgoing.map((p) => person(p, `<button class="linkbtn small" data-decline="${esc(p.id)}">Cancel</button>`)).join('')}</div>` : ''}
    ${s.blocked.length ? `<h2>Blocked</h2><div class="card list-rows">${s.blocked.map((p) => person(p, `<button class="linkbtn small" data-decline="${esc(p.id)}">Unblock</button>`)).join('')}</div>` : ''}
    <p class="small muted center" style="margin-top:16px"><button class="linkbtn small" id="newcode">Make a new QR code</button> · the old code and link stop working.</p>`;
  qrSvg(addLink(s.me.code)).then((svg) => { $('#qr').innerHTML = svg; }).catch(() => { $('#qr').innerHTML = `<div class="small muted center">QR code unavailable here.<br>User name: <b>@${esc(s.me.handle)}</b></div>`; });
  const done = (msg) => { invalidate(); toast(msg); friendsPage(); refreshBadge(); };
  app.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    try {
      if (b.dataset.accept) { await api(`/api/friends/${encodeURIComponent(b.dataset.accept)}/accept`, { method: 'POST' }); done('Friend added'); }
      else if (b.dataset.decline) { await api(`/api/friends/${encodeURIComponent(b.dataset.decline)}`, { method: 'DELETE' }); done('Done'); }
      else if (b.dataset.manage) manageSheet(b.dataset.manage, b.dataset.name, done);
      else if (b.id === 'scan') scanFriend();
      else if (b.id === 'byname') byNameSheet();
      else if (b.id === 'sharecode') shareMyLink(s.me);
      else if (b.id === 'newcode' && confirm('Make a new QR code? Your current code and link will stop working.')) { await api('/api/social/code/new', { method: 'POST' }); done('New QR code ready'); }
    } catch (err) { toast(err.message); }
  };
}

function manageSheet(id, name, done) {
  const { sheet, esc, api, toast } = ctx;
  sheet(`<h3>${esc(name)}</h3><div class="card menu">
      <button data-act="remove"><span class="ic">➖</span><span>Remove friend<span class="sub">You can add each other again later</span></span></button>
      <button data-act="block"><span class="ic">⛔</span><span>Block<span class="sub">They can't send you requests or products</span></span></button></div>`);
  document.querySelectorAll('#sheet [data-act]').forEach((b) => (b.onclick = async () => {
    try {
      if (b.dataset.act === 'remove') await api(`/api/friends/${encodeURIComponent(id)}`, { method: 'DELETE' });
      else await api(`/api/friends/${encodeURIComponent(id)}/block`, { method: 'POST' });
      $('#sheet').hidden = true; done(b.dataset.act === 'remove' ? 'Removed' : 'Blocked');
    } catch (e) { toast(e.message); }
  }));
}

async function shareMyLink(me) {
  const url = addLink(me.code);
  const text = `Add me on Fair Whack (@${me.handle})`;
  try {
    if (navigator.share) await navigator.share({ title: 'Fair Whack', text, url });
    else { await navigator.clipboard.writeText(`${text}: ${url}`); ctx.toast('Link copied'); }
  } catch { /* closed */ }
}

function byNameSheet() {
  const { sheet } = ctx;
  sheet(`<h3>Add by user name</h3><form id="byname-f" class="row" style="gap:8px"><input name="h" placeholder="@username" autocapitalize="none" autocomplete="off" required style="flex:1"><button class="btn">Find</button></form><div id="byname-r"></div>`);
  $('#byname-f').onsubmit = (e) => { e.preventDefault(); confirmPerson({ handle: e.target.h.value.trim() }, $('#byname-r')); };
  setTimeout(() => $('#byname-f input')?.focus(), 50);
}

/** Show who it is, then send the request (also used for scanned codes and opened links). */
async function confirmPerson(who, el) {
  const { api, esc, toast } = ctx;
  el.innerHTML = '<p class="muted">Looking…</p>';
  try {
    const r = await api(`/api/social/lookup?${who.code ? `code=${encodeURIComponent(who.code)}` : `handle=${encodeURIComponent(who.handle)}`}`);
    const msg = { friends: 'You are already friends.', requested: 'Request sent. Waiting for them to accept.', they_requested: 'They asked to be your friend.', you_blocked: 'You blocked this person.' }[r.status];
    el.innerHTML = `<div class="card list-rows"><div class="r friend"><span class="avatar">${esc(initials(r.person.name))}</span><span class="n"><b>${esc(r.person.name)}</b><span class="small muted">@${esc(r.person.handle)}</span></span></div></div>
      ${msg ? `<p class="small muted">${msg}</p>` : ''}
      ${['none', 'they_requested'].includes(r.status) ? `<button class="btn" id="send-req" style="width:100%">${r.status === 'they_requested' ? 'Accept' : 'Send friend request'}</button>` : ''}`;
    const b = $('#send-req', el);
    if (b) b.onclick = async () => {
      try {
        const res = await api('/api/friends/request', { method: 'POST', body: who.code ? { code: who.code } : { handle: who.handle } });
        invalidate();
        toast(res.status === 'friends' ? `You and ${r.person.name} are now friends` : `Request sent to ${r.person.name}`);
        $('#sheet').hidden = true;
        if (location.hash.startsWith('#/friends')) friendsPage(); else location.hash = '#/friends';
      } catch (e) { toast(e.message); }
    };
  } catch (e) { el.innerHTML = `<p class="small">${esc(e.message)}</p>`; }
}

/** Opened from a scanned link or a "Send my link" message: #/add/<code>. */
export async function addPage(code) {
  ctx.app.innerHTML = '<h1>Add a friend</h1><div id="addr"></div>';
  await confirmPerson({ code }, $('#addr'));
}

// Camera scanner for friend codes (works inside the installed app, where the phone's camera app would open the browser instead).
async function scanFriend() {
  const { toast } = ctx;
  let jsQR;
  try { jsQR = await loadScript('/vendor/jsQR.js', 'jsQR'); } catch { toast('The scanner is not available here. Add them by user name instead.'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('This browser can\'t open the camera. Add them by user name instead.'); return; }
  const ov = document.createElement('div');
  ov.className = 'scanner';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'Scan a friend code');
  ov.innerHTML = `<video playsinline muted autoplay></video><div class="shade"><div class="frame square"></div></div>
    <div class="top"><b>Scan a friend's code</b><button class="x scan-close" aria-label="Close">✕</button></div>
    <div class="bottom"><p class="hint">Point at your friend's Fair Whack QR code (Me → Friends on their phone)</p></div>`;
  document.body.append(ov);
  let stream, stop = false;
  const close = () => { stop = true; stream?.getTracks().forEach((t) => t.stop()); ov.remove(); };
  $('.scan-close', ov).onclick = close;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } }); }
  catch { close(); toast('The camera could not start. Add them by user name instead.'); return; }
  const v = $('video', ov);
  v.srcObject = stream; await v.play().catch(() => {});
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  const tick = () => {
    if (stop) return;
    if (v.videoWidth) {
      const w = 480, h = Math.round(480 * v.videoHeight / v.videoWidth);
      c.width = w; c.height = h; g.drawImage(v, 0, 0, w, h);
      const r = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
      const m = r?.data && r.data.match(/#\/add\/([A-Za-z0-9_-]+)/);
      if (m) { close(); location.hash = `#/add/${m[1]}`; return; }
    }
    requestAnimationFrame(tick);
  };
  tick();
}

// ---------- My account ----------
export async function accountPage() {
  const { app, esc, api, toast, state } = ctx;
  const s = await socialData(true);
  const signIn = state.me.id.replace(/^[ud]:/, '').replace(/-/g, ' ');
  app.innerHTML = `<h1>My account</h1>
    <form class="card form" id="acc">
      <label>Name<input name="name" value="${esc(state.me.name)}" maxlength="40" required><span class="small muted">What friends see. You still sign in with “${esc(signIn)}” and the invite code.</span></label>
      <label>User name<div class="row" style="gap:6px"><span class="muted">@</span><input name="handle" value="${esc(s.me.handle)}" maxlength="20" autocapitalize="none" autocomplete="off" required style="flex:1"></div><span class="small muted">3–20 letters, numbers, dots or underscores. Friends use it to add you.</span></label>
      <button class="btn">Save</button>
    </form>`;
  $('#acc').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      if (f.name.value.trim() !== state.me.name) { const r = await api('/api/social/name', { method: 'PUT', body: { name: f.name.value } }); state.me.name = r.name; }
      if (f.handle.value.trim().replace(/^@/, '').toLowerCase() !== s.me.handle) await api('/api/social/handle', { method: 'PUT', body: { handle: f.handle.value } });
      invalidate(); toast('Saved');
    } catch (err) { toast(err.message); }
  };
}

// ---------- share a product ----------
export async function shareSheet(p) {
  const { sheet, esc, api, toast, RET, money } = ctx;
  const s = await socialData().catch(() => null);
  const link = `${ORIGIN}/#/p/${encodeURIComponent(p.id)}`;
  sheet(`<h3>Share</h3><p class="small muted" style="margin-top:-4px">${esc(p.name)} · ${RET[p.retailer]} ${money(p.effective ?? p.price)}</p>
    ${s?.friends.length ? `<form id="share-f">
      <div class="card list-rows friends-pick">${s.friends.map((f) => `<label class="r friend"><span class="avatar">${esc(initials(f.name))}</span><span class="n"><b>${esc(f.name)}</b><span class="small muted">@${esc(f.handle)}</span></span><input type="checkbox" name="to" value="${esc(f.id)}"></label>`).join('')}</div>
      <input name="note" maxlength="200" placeholder="Add a note (optional)" style="width:100%;margin:8px 0">
      <button class="btn" style="width:100%">Send to friends</button></form>`
      : '<div class="empty" style="margin:0 0 8px"><b>No friends yet</b><a href="#/friends">Add friends</a> to share products with them.</div>'}
    <button class="btn light" id="share-out" style="width:100%;margin-top:8px">Share another way…</button>`);
  const f = $('#share-f');
  if (f) f.onsubmit = async (e) => {
    e.preventDefault();
    const to = [...f.querySelectorAll('input[name=to]:checked')].map((x) => x.value);
    if (!to.length) { toast('Choose at least one friend'); return; }
    try {
      const r = await api('/api/shares', { method: 'POST', body: { product_id: p.id, to, note: f.note.value } });
      $('#sheet').hidden = true; toast(r.sent === 1 ? 'Sent' : `Sent to ${r.sent} friends`);
    } catch (err) { toast(err.message); }
  };
  $('#share-out').onclick = async () => {
    try {
      if (navigator.share) await navigator.share({ title: p.name, text: `${p.name} – ${RET[p.retailer]} ${money(p.effective ?? p.price)} on Fair Whack`, url: link });
      else { await navigator.clipboard.writeText(link); toast('Link copied'); }
    } catch { /* closed */ }
  };
}

// ---------- Shared with you ----------
export async function sharedPage() {
  const { app, esc, api, toast, RET, money, thumb, heart, ago } = ctx;
  app.innerHTML = '<h1>Shared with you</h1><p class="muted">Loading…</p>';
  const d = await api('/api/shares');
  app.innerHTML = `<h1>Shared with you</h1>
    ${d.shares.length ? `<div class="card list-rows shared-list">${d.shares.map((s) => `<div class="r share ${s.seen ? '' : 'new'}">
        <a class="share-main" href="#/p/${encodeURIComponent(s.best.id)}">${thumb(s.best)}<span class="n"><b>${esc(s.product.name)}</b>
          <span class="small"><span class="ret ${s.best.retailer}">${RET[s.best.retailer]}</span> <b class="num">${money(s.best.effective)}</b>${s.stores > 1 ? ` <span class="muted">· cheapest of ${s.stores} stores</span>` : ''}</span>
          <span class="small muted">From ${esc(s.from.name)} · ${ago(s.sharedAt)}${s.note ? ` · “${esc(s.note)}”` : ''}</span></span></a>
        ${heart(s.best)}<button class="linkbtn small" data-del="${esc(s.id)}" aria-label="Remove">✕</button></div>`).join('')}</div>`
      : '<div class="empty"><b>Nothing shared yet</b>When friends share a product with you, it shows up here.</div>'}`;
  app.onclick = async (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    e.preventDefault();
    try { await api(`/api/shares/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); b.closest('.r').remove(); } catch (err) { toast(err.message); }
  };
  if (d.shares.some((s) => !s.seen)) api('/api/shares/seen', { method: 'POST' }).then(() => { invalidate(); refreshBadge(); }).catch(() => {});
}

/** Home: "Shared with you" rail (only when something was shared). */
export async function homeRail(el) {
  const { api, esc, tile } = ctx;
  const d = await api('/api/shares').catch(() => ({ shares: [] }));
  const recent = d.shares.slice(0, 12);
  if (!recent.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="sec-head"><h2>Shared with you</h2><a href="#/shared">See all ›</a></div>
    <div class="rail" tabindex="0" aria-label="Products friends shared, swipe for more">${recent.map((s) => `<div class="shared-tile">${tile(s.best)}<div class="from small ${s.seen ? 'muted' : ''}">${s.seen ? '' : '<b class="dot"></b>'}From ${esc(s.from.name)}${s.note ? `: “${esc(s.note)}”` : ''}</div></div>`).join('')}</div>`;
}

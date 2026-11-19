// Fair Whack — supermarket barcode reader (EAN-13, UPC-A, EAN-8).
// iPhone Safari has no BarcodeDetector, so camera frames are decoded here: each scan line is
// split into dark/light runs, and every 59-run (EAN-13) or 43-run (EAN-8) window is matched
// against the digit patterns. A result only counts if its check digit is right.

const L = ['3211', '2221', '2122', '1411', '1132', '1231', '1114', '1312', '1213', '3112'].map((s) => [...s].map(Number));
const G = L.map((w) => [...w].reverse());
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLG', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
const MAX_DIGIT_ERR = 1.6;

function digit(runs, at, table) {
  const w = [runs[at], runs[at + 1], runs[at + 2], runs[at + 3]];
  const sum = w[0] + w[1] + w[2] + w[3];
  let best = -1, err = Infinity;
  for (let d = 0; d < 10; d++) {
    let e = 0;
    for (let i = 0; i < 4; i++) e += Math.abs((w[i] * 7) / sum - table[d][i]);
    if (e < err) { err = e; best = d; }
  }
  return err <= MAX_DIGIT_ERR ? { d: best, err } : null;
}

function guardOk(runs, at, n, mod) {
  for (let i = 0; i < n; i++) { const m = runs[at + i] / mod; if (m < 0.4 || m > 1.9) return false; }
  return true;
}

function eanCheck(ds) {
  const n = ds.length;
  let sum = 0;
  for (let i = 0; i < n - 1; i++) sum += ds[i] * ((n - 1 - i) % 2 === 1 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === ds[n - 1];
}

/** runs: widths, runs[i] is dark when dark[i] is true. Returns a digit string or null. */
function decodeRuns(runs, dark) {
  const n = runs.length;
  for (let i = 1; i + 43 <= n; i++) {
    if (!dark[i]) continue;
    // EAN-13 / UPC-A: 3 + 24 + 5 + 24 + 3 runs, 95 modules
    if (i + 59 <= n) {
      let total = 0;
      for (let k = 0; k < 59; k++) total += runs[i + k];
      const mod = total / 95;
      if (runs[i - 1] >= mod * 2.5 && guardOk(runs, i, 3, mod) && guardOk(runs, i + 27, 5, mod) && guardOk(runs, i + 56, 3, mod)) {
        const ds = []; let parity = ''; let ok = true;
        for (let k = 0; k < 6 && ok; k++) {
          const a = digit(runs, i + 3 + k * 4, L), b = digit(runs, i + 3 + k * 4, G);
          const pick = !a ? b : !b ? a : a.err <= b.err ? a : b;
          if (!pick) { ok = false; break; }
          ds.push(pick.d); parity += pick === a ? 'L' : 'G';
        }
        for (let k = 0; k < 6 && ok; k++) {
          const r = digit(runs, i + 32 + k * 4, L);
          if (!r) ok = false; else ds.push(r.d);
        }
        const first = PARITY.indexOf(parity);
        if (ok && first >= 0) {
          const all = [first, ...ds];
          if (eanCheck(all)) return all.join('');
        }
      }
    }
    // EAN-8: 3 + 16 + 5 + 16 + 3 runs, 67 modules
    let total = 0;
    for (let k = 0; k < 43; k++) total += runs[i + k];
    const mod = total / 67;
    if (runs[i - 1] >= mod * 2.5 && guardOk(runs, i, 3, mod) && guardOk(runs, i + 19, 5, mod) && guardOk(runs, i + 40, 3, mod)) {
      const ds = []; let ok = true;
      for (let k = 0; k < 4 && ok; k++) { const r = digit(runs, i + 3 + k * 4, L); if (!r) ok = false; else ds.push(r.d); }
      for (let k = 0; k < 4 && ok; k++) { const r = digit(runs, i + 24 + k * 4, L); if (!r) ok = false; else ds.push(r.d); }
      if (ok && eanCheck(ds)) return ds.join('');
    }
  }
  return null;
}

function runsOf(bits) {
  const runs = [], dark = [];
  let cur = bits[0], len = 0;
  for (let x = 0; x < bits.length; x++) {
    if (bits[x] === cur) len++;
    else { runs.push(len); dark.push(cur === 1); cur = bits[x]; len = 1; }
  }
  runs.push(len); dark.push(cur === 1);
  return { runs, dark };
}

/** Decode one line of luminance values (0–255). Tries two thresholds and both directions. */
export function decodeLine(lum) {
  const w = lum.length;
  if (w < 60) return null;
  // light smoothing removes sensor noise without merging thin bars
  const s = new Float32Array(w);
  for (let x = 0; x < w; x++) s[x] = (lum[Math.max(0, x - 1)] + 2 * lum[x] + lum[Math.min(w - 1, x + 1)]) / 4;
  const win = Math.max(8, Math.round(w / 14));
  const integ = new Float64Array(w + 1);
  for (let x = 0; x < w; x++) integ[x + 1] = integ[x] + s[x];
  let lo = 255, hi = 0;
  for (let x = 0; x < w; x++) { if (s[x] < lo) lo = s[x]; if (s[x] > hi) hi = s[x]; }
  if (hi - lo < 30) return null;
  const mid = (lo + hi) / 2;
  const local = new Uint8Array(w), global = new Uint8Array(w), range = new Uint8Array(w);
  for (let x = 0; x < w; x++) {
    const a = Math.max(0, x - win), b = Math.min(w, x + win + 1);
    const mean = (integ[b] - integ[a]) / (b - a);
    local[x] = s[x] < Math.min(mean, hi - 12) ? 1 : 0;
    global[x] = s[x] < mid ? 1 : 0;
    // midpoint of the nearby darkest and lightest values: copes with glare across the label
    let mn = 255, mx = 0;
    for (let k = a; k < b; k += 2) { if (s[k] < mn) mn = s[k]; if (s[k] > mx) mx = s[k]; }
    range[x] = mx - mn > 30 && s[x] < (mn + mx) / 2 ? 1 : 0;
  }
  for (const bits of [local, range, global]) {
    const { runs, dark } = runsOf(bits);
    const fwd = decodeRuns(runs, dark);
    if (fwd) return fwd;
    const back = decodeRuns(runs.slice().reverse(), dark.slice().reverse());
    if (back) return back;
  }
  return null;
}

/** Decode an ImageData (or {data,width,height}) by sampling horizontal lines across its middle. */
export function decodeImage(img, { lines = 21, from = 0.2, to = 0.8 } = {}) {
  const { data, width, height } = img;
  const votes = new Map();
  const row = new Uint8Array(width);
  for (let k = 0; k < lines; k++) {
    const y = Math.round(height * (from + ((to - from) * k) / Math.max(1, lines - 1)));
    const o = y * width * 4;
    for (let x = 0; x < width; x++) {
      const i = o + x * 4;
      row[x] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    }
    const code = decodeLine(row);
    if (code) votes.set(code, (votes.get(code) || 0) + 1);
  }
  let best = null, n = 0;
  for (const [c, v] of votes) if (v > n) { best = c; n = v; }
  return best ? { code: best, votes: n } : null;
}

/** UPC-A comes back as a 13-digit EAN starting with 0; the server tries both forms. */
export const validBarcode = (s) => /^(\d{8}|\d{12,14})$/.test(s) && eanCheck([...s].map(Number));

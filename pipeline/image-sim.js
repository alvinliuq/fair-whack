// How alike two product photos are. Used to decide "possible matches" without a person looking.
//
// Each photo is cropped to the product (white margin trimmed), shrunk to 32x32, then described by:
//   - shape: a 64-bit perceptual hash of the grey image (layout of light and dark areas)
//   - colour: the average colour of an 8x8 grid of cells
// Two photos of the same pack taken by different stores agree on both. Flavour variants of one
// brand usually share the shape but not the colours, which is why colour is checked separately.
const N = 32;

/** rgb: Uint8Array/Buffer of N*N*3 bytes -> { hash: BigInt (64 bits), cells: Float32Array(8*8*3) } */
export function describe(rgb) {
  const grey = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) grey[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  // Low-frequency 8x8 corner of the 2-D DCT.
  const cos = describe.cos || (describe.cos = Array.from({ length: 8 }, (_, u) => Float64Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)))));
  const rows = new Float64Array(N * 8); // DCT along x for each row
  for (let y = 0; y < N; y++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let x = 0; x < N; x++) s += grey[y * N + x] * cos[u][x];
    rows[y * 8 + u] = s;
  }
  const coef = [];
  for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
    let s = 0;
    for (let y = 0; y < N; y++) s += rows[y * 8 + u] * cos[v][y];
    coef.push(s);
  }
  const rest = coef.slice(1).sort((a, b) => a - b); // ignore the overall brightness term
  const median = (rest[31] + rest[30]) / 2;
  let hash = 0n;
  for (let i = 1; i < 64; i++) if (coef[i] > median) hash |= 1n << BigInt(i);
  const cells = new Float32Array(8 * 8 * 3);
  for (let cy = 0; cy < 8; cy++) for (let cx = 0; cx < 8; cx++) for (let c = 0; c < 3; c++) {
    let s = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) s += rgb[((cy * 4 + y) * N + cx * 4 + x) * 3 + c];
    cells[(cy * 8 + cx) * 3 + c] = s / 16;
  }
  return { hash, cells };
}

/** { shape, colour } each 0..1 (1 = identical). */
export function compare(a, b) {
  let diff = a.hash ^ b.hash, bits = 0;
  while (diff) { bits += Number(diff & 1n); diff >>= 1n; }
  const shape = 1 - bits / 63;
  // Colour: only cells where at least one photo shows the product (not white background).
  let sum = 0, n = 0;
  for (let i = 0; i < 64; i++) {
    const [r1, g1, b1] = [a.cells[i * 3], a.cells[i * 3 + 1], a.cells[i * 3 + 2]];
    const [r2, g2, b2] = [b.cells[i * 3], b.cells[i * 3 + 1], b.cells[i * 3 + 2]];
    if (Math.min(r1, g1, b1) > 235 && Math.min(r2, g2, b2) > 235) continue;
    sum += Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 441.7; n++;
  }
  const colour = n ? 1 - sum / n : 0;
  return { shape: Math.round(shape * 1000) / 1000, colour: Math.round(colour * 1000) / 1000 };
}

let sharpLib;
/** Download a photo and describe it. Returns null when it cannot be fetched or read. */
export async function describeUrl(url, { timeoutMs = 15000 } = {}) {
  if (!url || !/^https?:\/\//.test(url)) return null;
  sharpLib ||= (await import('sharp')).default;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15', Accept: 'image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8' },
      });
      if (!res.ok) { if (res.status >= 500 || res.status === 429) continue; return null; }
      const buf = Buffer.from(await res.arrayBuffer());
      const base = () => sharpLib(buf, { failOn: 'none' }).flatten({ background: '#ffffff' }).toColourspace('srgb');
      const shrink = (img) => img.resize(N, N, { fit: 'contain', background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let out;
      // Trim the white margin first so both stores' photos are framed the same way.
      try { out = await shrink(sharpLib(await base().trim({ background: '#ffffff', threshold: 24 }).png().toBuffer())); } catch { out = await shrink(base()); }
      const { data, info } = out;
      if (info.channels === 3) return describe(data);
      const rgb = Buffer.alloc(N * N * 3);
      for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = data[i * info.channels + Math.min(c, info.channels - 1)];
      return describe(rgb);
    } catch { /* retry once, then give up */ }
  }
  return null;
}

/** Describe many photos, a few at a time. Returns Map url -> description | null. */
export async function describeAll(urls, { concurrency = 10, onProgress } = {}) {
  const list = [...new Set(urls.filter(Boolean))];
  const out = new Map();
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < list.length) {
      const url = list[next++];
      out.set(url, await describeUrl(url));
      if (onProgress && out.size % 500 === 0) onProgress(out.size, list.length);
    }
  }));
  return out;
}

// Barcode reader: synthetic EAN-13 / UPC-A / EAN-8 scan lines with blur, noise, odd scaling and glare.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeLine, decodeImage, validBarcode } from '../public/barcode.js';

const LC = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const GC = LC.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).reverse().join(''));
const RC = LC.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLG', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

function modules(code) {
  const d = [...code].map(Number);
  if (d.length === 8) return '101' + d.slice(0, 4).map((x) => LC[x]).join('') + '01010' + d.slice(4).map((x) => RC[x]).join('') + '101';
  const p = PAR[d[0]];
  return '101' + d.slice(1, 7).map((x, i) => (p[i] === 'L' ? LC : GC)[x]).join('') + '01010' + d.slice(7).map((x) => RC[x]).join('') + '101';
}

/** Render to a luminance line: quiet zones, a module width in pixels (can be fractional), blur, noise, light gradient. */
function render(code, { mod = 3, blur = 1, noise = 8, glare = 0, width = 640, offset = 90, seed = 1 } = {}) {
  const m = modules(code);
  let r = seed;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  const line = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const k = Math.floor((x - offset) / mod);
    const dark = k >= 0 && k < m.length && m[k] === '1';
    line[x] = (dark ? 40 : 215) + glare * (x / width);
  }
  const out = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let s = 0, n = 0;
    for (let k = -blur; k <= blur; k++) { const i = Math.min(width - 1, Math.max(0, x + k)); s += line[i]; n++; }
    out[x] = Math.max(0, Math.min(255, s / n + (rand() - 0.5) * 2 * noise));
  }
  return out;
}

test('reads EAN-13 at several sizes, blurred and noisy', () => {
  for (const code of ['9300605000032', '9310072011691', '9300633603465', '4006381333931']) {
    for (const mod of [2.2, 3, 4.6]) {
      assert.equal(decodeLine(render(code, { mod, blur: 1, noise: 10 })), code, `${code} @ ${mod}px`);
    }
  }
});

test('reads upside-down and with uneven light', () => {
  const code = '9300605000032';
  assert.equal(decodeLine(render(code).reverse()), code);
  assert.equal(decodeLine(render(code, { glare: 60, mod: 2.8 })), code);
});

test('reads UPC-A (as 13 digits) and EAN-8', () => {
  assert.equal(decodeLine(render('0036000291452', { mod: 3.3 })), '0036000291452');
  assert.equal(decodeLine(render('96385074', { mod: 4 })), '96385074');
});

test('never invents a code from noise', () => {
  let r = 7;
  const rand = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let t = 0; t < 300; t++) {
    const line = Uint8Array.from({ length: 640 }, () => (rand() < 0.5 ? 40 : 215));
    assert.equal(decodeLine(line), null);
  }
});

test('image decode votes across lines', () => {
  const code = '9310072011691', w = 640, h = 120;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const line = render(code, { seed: y + 3, noise: 14 });
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = line[x]; data[i + 3] = 255; }
  }
  assert.equal(decodeImage({ data, width: w, height: h }).code, code);
});

test('check digits', () => {
  assert.ok(validBarcode('9300605000032'));
  assert.ok(validBarcode('036000291452'));
  assert.ok(!validBarcode('9300605000033'));
  assert.ok(!validBarcode('12345'));
});

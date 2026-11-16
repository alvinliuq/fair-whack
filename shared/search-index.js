// Search index shared by the pipeline (which builds it) and the API (which reads it).
//
// word_index holds one row per word: word -> the products whose name or brand contains
// that word. A search for "tim ta" reads the rows for words starting with "tim" and the
// rows for words starting with "ta", then keeps the products that appear in both. That is
// a few dozen rows read, where scanning retailer_product with LIKE read every product.
import { normText } from './normalize.js';

/** Bump when the rules in indexWords() change: the next deploy then rebuilds the index. */
export const INDEX_VERSION = 'v1';
export const INDEX_META_KEY = 'search_index_at';
/** Products per row. Keeps every row far below D1's 100 KB statement limit. */
export const PART_SIZE = 3000;

const SHORT = { woolworths: 'w', coles: 'c', aldi: 'a', costco: 'k' };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));

/** "woolworths:123456" -> "w123456". Ids we cannot shorten are stored whole (they contain ':'). */
export function packId(id) {
  const i = id.indexOf(':');
  const short = i > 0 ? SHORT[id.slice(0, i)] : null;
  const rest = id.slice(i + 1);
  return short && !/[,:]/.test(rest) ? short + rest : id;
}
export function unpackId(code) {
  return code.includes(':') ? code : `${LONG[code[0]]}:${code.slice(1)}`;
}

/** Words a product can be found by: every word of its name and brand, two characters or longer. */
export function indexWords(name, brand) {
  const out = new Set();
  for (const text of [name, brand]) {
    if (!text) continue;
    const raw = String(text);
    // "Arnott's" is indexed as "arnott" and as "arnotts", so both spellings find it.
    for (const s of [normText(raw), normText(raw.replace(/['’`]/g, ''))]) {
      for (const w of s.split(' ')) if (w.length > 1) out.add(w);
    }
  }
  return out;
}

/** Search text -> tokens. Each token must start a word of the product. */
export function searchTokens(text, max = 6) {
  return [...new Set(normText(text).split(' ').filter((t) => t.length > 1))].slice(0, max);
}

/** Rows the index should hold for these products: Map "word|part" -> ids string. */
export function buildIndexRows(products) {
  const byWord = new Map();
  for (const p of products) {
    const code = packId(p.id);
    if (code.includes(',')) continue;
    for (const w of indexWords(p.name, p.brand)) {
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push(code);
    }
  }
  const rows = new Map();
  for (const [word, codes] of byWord) {
    codes.sort();
    for (let i = 0, part = 0; i < codes.length; i += PART_SIZE, part++) {
      rows.set(`${word}|${part}`, { word, part, ids: codes.slice(i, i + PART_SIZE).join(',') });
    }
  }
  return rows;
}

/**
 * Pick product ids from index rows.
 * perToken: for each token, the rows [{ word, ids }] whose word starts with it.
 * Returns up to `cap` ids that match every token; exact-word matches come first.
 */
export function pickIds(tokens, perToken, cap) {
  if (perToken.some((rows) => !rows.length)) return [];
  // Best matches first: the exact word, then shorter words.
  const lead = [...perToken[0]].sort((a, b) => (a.word === tokens[0] ? 0 : 1) - (b.word === tokens[0] ? 0 : 1) || a.word.length - b.word.length || (a.word < b.word ? -1 : 1));
  const others = perToken.slice(1).map((rows) => {
    const set = new Set();
    for (const r of rows) for (const c of r.ids.split(',')) set.add(c);
    return set;
  }).sort((a, b) => a.size - b.size);
  // Walk the first token's products in order, keep those every other token also has, stop at the cap.
  const out = [], seen = new Set();
  for (const r of lead) {
    for (const c of r.ids.split(',')) {
      if (!c || seen.has(c) || !others.every((s) => s.has(c))) continue;
      seen.add(c); out.push(unpackId(c));
      if (out.length >= cap) return out;
    }
  }
  return out;
}

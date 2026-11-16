// Keeps the word_index table in step with retailer_product. Only rows that changed are written.
import { buildIndexRows, INDEX_VERSION, INDEX_META_KEY } from '../shared/search-index.js';
import { sqlLiteral } from './d1.js';

/** Every product's id, name and brand. Pages by id so each product is read once. */
export async function loadIndexProducts(db) {
  const out = [];
  for (let last = ''; ;) {
    const page = await db.all('SELECT id, name, brand FROM retailer_product WHERE id > ? ORDER BY id LIMIT 5000', [last]);
    out.push(...page);
    if (page.length < 5000) break;
    last = page[page.length - 1].id;
  }
  return out;
}

async function loadExisting(db) {
  const rows = new Map();
  for (let w = '', p = -1; ;) {
    const page = await db.all('SELECT word, part, ids FROM word_index WHERE (word, part) > (?, ?) ORDER BY word, part LIMIT 500', [w, p]);
    for (const r of page) rows.set(`${r.word}|${r.part}`, r.ids);
    if (page.length < 500) break;
    ({ word: w, part: p } = page[page.length - 1]);
  }
  return rows;
}

/** products: [{ id, name, brand }] for the whole table. */
export async function syncWordIndex(db, products) {
  const want = buildIndexRows(products);
  const have = await loadExisting(db);
  const upserts = [];
  for (const [key, row] of want) if (have.get(key) !== row.ids) upserts.push(row);
  const gone = [...have.keys()].filter((k) => !want.has(k)).map((k) => { const i = k.lastIndexOf('|'); return { word: k.slice(0, i), part: Number(k.slice(i + 1)) }; });

  await db.insertRows('word_index', ['word', 'part', 'ids'], upserts, 'ON CONFLICT(word, part) DO UPDATE SET ids = excluded.ids');
  for (let i = 0; i < gone.length; i += 100) {
    const list = gone.slice(i, i + 100).map((g) => `(${sqlLiteral(g.word)}, ${g.part})`).join(',');
    await db.exec(`DELETE FROM word_index WHERE (word, part) IN (VALUES ${list})`);
  }
  await db.run('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [INDEX_META_KEY, `${INDEX_VERSION}:${new Date().toISOString()}`]);
  return { rows: want.size, written: upserts.length, removed: gone.length };
}

/** True when the index was built with the current rules. */
export async function indexIsCurrent(db) {
  const r = await db.all('SELECT value FROM app_meta WHERE key = ?', [INDEX_META_KEY]);
  return !!r[0]?.value?.startsWith(`${INDEX_VERSION}:`);
}

/** Saved API answers are only valid until prices or products change. */
export async function clearApiCache(db) {
  await db.exec('DELETE FROM api_cache');
}

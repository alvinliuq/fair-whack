// Database adapters for the pipeline.
//  - REST: Cloudflare D1 HTTP API (used in GitHub Actions)
//  - local: node:sqlite file (used for local testing; set LOCAL_DB=path)
// Both expose: all(sql, params) -> rows, run(sql, params), exec(sql), insertRows(table, cols, rows, conflictClause)

export function sqlLiteral(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function chunkRows(prefix, suffix, rowSqls, maxBytes = 90000) {
  const out = [];
  let cur = [], size = prefix.length + suffix.length;
  for (const r of rowSqls) {
    if (cur.length && (size + r.length + 2 > maxBytes || cur.length >= 200)) {
      out.push(prefix + cur.join(',\n') + suffix);
      cur = []; size = prefix.length + suffix.length;
    }
    cur.push(r); size += r.length + 2;
  }
  if (cur.length) out.push(prefix + cur.join(',\n') + suffix);
  return out;
}

function withBulk(base) {
  base.insertRows = async (table, cols, rows, conflict = '') => {
    if (!rows.length) return 0;
    const prefix = `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n`;
    const rowSqls = rows.map((r) => '(' + cols.map((c) => sqlLiteral(r[c])).join(', ') + ')');
    for (const stmt of chunkRows(prefix, conflict ? `\n${conflict}` : '', rowSqls)) await base.exec(stmt);
    return rows.length;
  };
  // IN (...) helper for large id lists, chunked.
  base.allIn = async (sqlWithIn, ids, params = [], size = 300) => {
    const out = [];
    for (let i = 0; i < ids.length; i += size) {
      const list = ids.slice(i, i + size).map(sqlLiteral).join(',');
      out.push(...(await base.all(sqlWithIn.replace('(:ids)', `(${list})`), params)));
    }
    return out;
  };
  return base;
}

export async function makeDb() {
  if (process.env.LOCAL_DB) return localDb(process.env.LOCAL_DB);
  const acc = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const dbId = process.env.D1_DATABASE_ID;
  if (!acc || !token || !dbId) throw new Error('Missing CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / D1_DATABASE_ID');
  return restDb(acc, token, dbId);
}

export function restDb(acc, token, dbId) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${acc}/d1/database/${dbId}/query`;
  async function q(sql, params = []) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(params.length ? { sql, params } : { sql }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.success) return body.result;
      const msg = JSON.stringify(body.errors || body).slice(0, 500);
      if (attempt < 4 && (res.status >= 500 || res.status === 429)) {
        await new Promise((r) => setTimeout(r, 1500 * attempt));
        continue;
      }
      throw new Error(`D1 ${res.status}: ${msg} :: ${sql.slice(0, 200)}`);
    }
  }
  return withBulk({
    async all(sql, params = []) { const r = await q(sql, params); return r[r.length - 1]?.results || []; },
    async run(sql, params = []) { const r = await q(sql, params); return r[r.length - 1]?.meta || {}; },
    async exec(sql) { await q(sql); },
  });
}

export async function localDb(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  const norm = (p) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
  return withBulk({
    raw: db,
    async all(sql, params = []) { return db.prepare(sql).all(...norm(params)); },
    async run(sql, params = []) { return db.prepare(sql).run(...norm(params)); },
    async exec(sql) { db.exec(sql); },
  });
}

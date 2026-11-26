// Local dev server: serves public/ and routes /api/* to the same handler used on Cloudflare.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { makeD1, migrate } from './d1shim.js';
import { handle } from '../shared/api.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dbFile = process.env.LOCAL_DB || path.join(root, 'dev', 'local.db');
migrate(dbFile);
const env = {
  DB: makeD1(dbFile),
  INVITE_CODE: process.env.INVITE_CODE || 'beta',
  ADMIN_CODE: process.env.ADMIN_CODE || 'admin',
  DESIGN_CODE: process.env.DESIGN_CODE || 'design',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret',
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith('/api/')) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
    const r = await handle(request, env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = path.join(root, 'public', decodeURIComponent(url.pathname));
  if (!p.startsWith(path.join(root, 'public'))) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p) && fs.existsSync(`${p}.html`)) p = `${p}.html`; // like Cloudflare Pages: /deal -> deal.html
  if (!fs.existsSync(p)) p = path.join(root, 'public', 'index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const port = Number(process.env.PORT || 8788);
server.listen(port, () => console.log(`Fair Whack dev: http://localhost:${port}  (invite: ${env.INVITE_CODE}, admin: ${env.ADMIN_CODE})`));

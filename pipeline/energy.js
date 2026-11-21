// Weekly: Victorian residential electricity and gas plans from the AER (Consumer Data Right product data; free, no key).
// Lists every retailer's plans, fetches details only for new or changed plans, stores compact models in D1 (energy_plan).
import { makeDb } from './d1.js';
import { normalizePlan, MODEL_VERSION } from '../shared/energy.js';

// The AER serves every retailer's plans at cdr.energymadeeasy.gov.au/<slug> (AER list of retailer base URIs, Jan 2026).
export const AER_SLUGS = ('1st-energy actewagl active-utilities agl alinta altogether amber ampol arc-energy arcline arcstream aseno aurora besy blue-nrg brighte '
  + 'cleanco cleanpeak coles commander cooperative covau cpe-mascot diamond discover dodo ea-connect energy-locals energy-locals-urban energyaustralia engie '
  + 'erc-energy ergon evergy flipped flow-power future-x sunswitch gee-energy globird glow-power humenergy igeno io-energy kogan locality-planning localvolts '
  + 'lumo macarthur macquarie metered-energy microgrid momentum myob nectr next-business origin ovo-energy ovo-energy-ctm pacific-blue perpetual powerhub '
  + 'powershop powow raa radian real-utilities red-energy savant seene shell-energy silver-asset smart-energy solstice stanwell sumo-power sumo-gas circular '
  + 'tango telstra-energy tesla veolia winconnect yes-energy zen-energy').split(' ');
const BASE = 'https://cdr.energymadeeasy.gov.au';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, v) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'x-v': String(v), 'x-min-v': '1', Accept: 'application/json' } });
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      return await r.json();
    } catch (e) {
      if (attempt >= 4) throw e;
      await sleep(1500 * attempt);
    }
  }
}
const vicPostcodes = (p) => (p.geography?.includedPostcodes || []).filter((x) => /^3\d{3}$/.test(x));

export async function runEnergy() {
  const db = await makeDb();
  const started = new Date().toISOString();
  const known = new Map((await db.all('SELECT id, last_updated FROM energy_plan')).map((r) => [r.id, r.last_updated]));
  const listed = [];
  for (const slug of AER_SLUGS) {
    let page = 1, n = 0;
    try {
      for (;;) {
        const d = await get(`${BASE}/${slug}/cds-au/v1/energy/plans?effective=CURRENT&type=ALL&fuelType=ALL&page-size=1000&page=${page}`, 1);
        if (!d) break;
        for (const p of d.data?.plans || []) {
          if (p.customerType === 'BUSINESS' || !['ELECTRICITY', 'GAS'].includes(p.fuelType)) continue;
          const pcs = vicPostcodes(p);
          if (!pcs.length) continue;
          listed.push({ slug, p, pcs }); n++;
        }
        if (page >= (d.meta?.totalPages || 1)) break;
        page++;
      }
      if (n) console.log(`${slug}: ${n} Victorian residential plans`);
    } catch (e) { console.log(`${slug}: list failed (${e.message})`); }
  }
  console.log(`Listed ${listed.length} plans`);
  const stamp = (x) => `${x.p.lastUpdated || ''}#v${MODEL_VERSION}`;
  const todo = listed.filter((x) => known.get(x.p.planId) !== stamp(x));
  console.log(`Fetching details for ${todo.length} new or changed plans`);
  const rows = [];
  const skipped = {};
  let i = 0;
  async function worker() {
    while (i < todo.length) {
      const x = todo[i++];
      try {
        const d = await get(`${BASE}/${x.slug}/cds-au/v1/energy/plans/${encodeURIComponent(x.p.planId)}`, 3);
        if (!d?.data) continue;
        const m = normalizePlan(d.data);
        if (m.unsupported) { skipped[m.unsupported] = (skipped[m.unsupported] || 0) + 1; continue; }
        rows.push({ id: m.id, brand: x.slug, fuel: m.fuel, networks: `|${(d.data.geography?.distributors || []).map((s) => s.trim()).join('|')}|`,
          postcodes: `,${x.pcs.join(',')},`, model: JSON.stringify(m), last_updated: stamp(x), seen_at: started });
      } catch (e) { skipped.error = (skipped.error || 0) + 1; }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  console.log(`Saved ${rows.length} plans; skipped ${JSON.stringify(skipped)}`);
  await db.insertRows('energy_plan', ['id', 'brand', 'fuel', 'networks', 'postcodes', 'model', 'last_updated', 'seen_at'], rows,
    'ON CONFLICT(id) DO UPDATE SET brand = excluded.brand, fuel = excluded.fuel, networks = excluded.networks, postcodes = excluded.postcodes, model = excluded.model, last_updated = excluded.last_updated, seen_at = excluded.seen_at');
  // Unchanged plans: mark seen. Plans no longer listed: remove (only when the listing clearly worked).
  const unchanged = listed.filter((x) => known.get(x.p.planId) === stamp(x)).map((x) => x.p.planId);
  for (let k = 0; k < unchanged.length; k += 300) {
    const ids = unchanged.slice(k, k + 300).map((s) => `'${s.replace(/'/g, "''")}'`).join(',');
    await db.run(`UPDATE energy_plan SET seen_at = ? WHERE id IN (${ids})`, [started]);
  }
  if (listed.length > 1000) await db.run('DELETE FROM energy_plan WHERE seen_at < ?', [started]);
  await db.run("INSERT INTO app_meta (key, value) VALUES ('energy_updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [started]);
  await db.run("DELETE FROM api_cache WHERE key LIKE 'energy:%'");
  const c = await db.all('SELECT fuel, COUNT(*) AS n FROM energy_plan GROUP BY fuel');
  console.log('Plans in database:', JSON.stringify(c));
}

if (import.meta.url === `file://${process.argv[1]}`) runEnergy().catch((e) => { console.error(e); process.exit(1); });

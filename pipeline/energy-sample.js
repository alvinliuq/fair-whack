// One-off discovery: what the AER energy plan data (CDR Product Reference Data) looks like for Victoria.
// Writes small samples to energy-sample/ for review. Run by .github/workflows/energy.yml (mode: sample).
import fs from 'node:fs';
const OUT = 'energy-sample';
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (...a) => { const s = a.join(' '); console.log(s); log.push(s); };

async function get(url, v) {
  const r = await fetch(url, { headers: { 'x-v': String(v), 'x-min-v': '1', Accept: 'application/json' } });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${url} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

// 1. Brands from the CDR register
let brands = [];
try {
  const d = await get('https://api.cdr.gov.au/cdr-register/v1/energy/data-holders/brands/summary', 1);
  fs.writeFileSync(`${OUT}/register.json`, JSON.stringify(d, null, 1).slice(0, 200000));
  brands = (d.data || []).map((b) => ({ name: b.brandName, uri: b.productBaseUri || b.publicBaseUri })).filter((b) => b.uri);
  say('register brands', brands.length);
} catch (e) { say('register failed', e.message); }
if (!brands.length) brands = ['agl', 'origin', 'energyaustralia', 'red-energy', 'lumo', 'alinta', 'simply-energy', 'powershop', 'momentum', 'dodo', 'tango', 'globird', 'ovo-energy'].map((s) => ({ name: s, uri: `https://cdr.energymadeeasy.gov.au/${s}` }));
fs.writeFileSync(`${OUT}/brands.json`, JSON.stringify(brands, null, 1));

// 2. Plan lists per brand (residential), keep the Victorian ones
const VIC = /citipower|powercor|jemena|united energy|ausnet|multinet|australian gas networks|agn/i;
const summary = [];
let firstList = null;
for (const b of brands) {
  const base = b.uri.replace(/\/$/, '').replace(/\/cds-au\/v1$/, '');
  let page = 1, n = 0, vic = 0;
  try {
    for (;;) {
      const d = await get(`${base}/cds-au/v1/energy/plans?effective=CURRENT&type=ALL&fuelType=ALL&page-size=1000&page=${page}`, 1);
      if (!firstList) { firstList = d; fs.writeFileSync(`${OUT}/list-first.json`, JSON.stringify({ ...d, data: { plans: (d.data?.plans || []).slice(0, 5) } }, null, 1)); }
      for (const p of d.data?.plans || []) {
        n++;
        const dist = (p.geography?.distributors || []).join(',');
        if (p.customerType === 'BUSINESS') continue;
        if (VIC.test(dist)) { vic++; summary.push({ brand: b.name, base, planId: p.planId, fuel: p.fuelType, type: p.type, name: p.displayName, dist, pc: (p.geography?.includedPostcodes || []).length }); }
      }
      if (!d.links?.next || page >= (d.meta?.totalPages || 1)) break;
      page++;
    }
    say(b.name, 'plans', n, 'vic residential', vic);
  } catch (e) { say(b.name, 'ERR', e.message.slice(0, 160)); }
}
fs.writeFileSync(`${OUT}/vic-summary.json`, JSON.stringify(summary, null, 0));
say('VIC residential plans total', summary.length, 'elec', summary.filter((x) => x.fuel === 'ELECTRICITY').length, 'gas', summary.filter((x) => x.fuel === 'GAS').length, 'dual', summary.filter((x) => x.fuel === 'DUAL').length);
const distCount = {};
for (const s of summary) for (const d of s.dist.split(',')) distCount[d] = (distCount[d] || 0) + 1;
say('distributor names', JSON.stringify(distCount));
say('plans with postcode lists', summary.filter((x) => x.pc > 0).length);

// 3. A few full plan details: single rate, time of use, gas, from different brands
const pick = [];
const seen = new Set();
for (const s of summary) {
  const k = `${s.fuel}|${s.brand}`;
  if (seen.has(k) || pick.length >= 14) continue;
  seen.add(k); pick.push(s);
}
for (const [i, s] of pick.entries()) {
  for (const v of [3, 2, 1]) {
    try {
      const d = await get(`${s.base}/cds-au/v1/energy/plans/${encodeURIComponent(s.planId)}`, v);
      fs.writeFileSync(`${OUT}/detail-${i}-${s.fuel}-v${v}.json`, JSON.stringify(d, null, 1));
      say('detail', i, s.brand, s.fuel, 'v', v, 'ok');
      break;
    } catch (e) { say('detail', i, s.brand, 'v', v, 'ERR', e.message.slice(0, 120)); }
  }
}
fs.writeFileSync(`${OUT}/log.txt`, log.join('\n'));

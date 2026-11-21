// Fair Whack Bills (FW2.0): AER plan data → compact plan models, household profile → usage, usage × plan → yearly cost.
// Plan prices from the AER (Consumer Data Right product data) EXCLUDE GST; we add 10% to supply and usage charges.
// Feed-in credits carry no GST. All money here is dollars (not cents).

const GST = 1.1;
const DAYS = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const SLOTS = 48; // half hours

// ---------------------------------------------------------------- plan normalisation
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
function periodDays(p) {
  const m = /^P(\d+)([DWMY])$/.exec(String(p || 'P1D'));
  if (!m) return 1;
  return Number(m[1]) * { D: 1, W: 7, M: 30.4375, Y: 365.25 }[m[2]];
}
const DAY_IDX = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
function dayMask(days) {
  let m = 0;
  for (const d of days || []) {
    if (d in DAY_IDX) m |= 1 << DAY_IDX[d];
    else if (d === 'BUSINESS_DAYS' || d === 'WEEKDAYS') m |= 0b0111110;
    else if (d === 'WEEKENDS') m |= 0b1000001;
  }
  return m || 0b1111111;
}
const minutes = (t, end) => {
  const m = /^(\d{1,2}):?(\d{2})/.exec(String(t || ''));
  if (!m) return end ? 1440 : 0;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return end && v === 0 ? 1440 : Math.min(1440, v);
};
/** Rate blocks: [{ p: $/unit ex GST, v: units per day for this block (null = rest) }] */
function blocks(rates, period) {
  const days = periodDays(period);
  return (rates || []).map((r) => ({ p: num(r.unitPrice), v: num(r.volume) != null ? num(r.volume) / days : null })).filter((b) => b.p != null);
}
const md = (s, dflt) => { const m = /^(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? [Number(m[1]), Number(m[2])] : dflt; };

/**
 * AER plan detail (v3 `data`) → compact model, or { unsupported: reason }.
 * model: { id, brand, brandName, fuel: 'E'|'G', type, name, cl, periods, clRate, clSupply, fit, disc, fees, elig, url }
 */
export function normalizePlan(d) {
  const fuel = d.fuelType === 'GAS' ? 'G' : d.fuelType === 'ELECTRICITY' ? 'E' : null;
  if (!fuel) return { unsupported: 'dual fuel' };
  const c = (fuel === 'E' ? d.electricityContract : d.gasContract) || {};
  const out = {
    id: d.planId, brand: d.brand, brandName: d.brandName || d.brand, fuel, type: d.type, name: d.displayName || '',
    model: c.pricingModel || 'SINGLE_RATE', periods: [], fit: [], disc: [], fees: 0, elig: [], url: d.additionalInformation?.overviewUri || null,
  };
  for (const t of c.tariffPeriod || []) {
    const per = { from: md(t.startDate, [1, 1]), to: md(t.endDate, [12, 31]), supply: num(t.dailySupplyCharge) ?? num(t.dailySupplyCharges) ?? 0 };
    if (t.dailySupplyChargeType === 'BAND' && Array.isArray(t.bandedDailySupplyCharges)) per.supply = num(t.bandedDailySupplyCharges[0]?.unitPrice) ?? per.supply;
    if (t.rateBlockUType === 'singleRate' && t.singleRate) {
      per.single = blocks(t.singleRate.rates, t.singleRate.period);
      if (!per.supply) per.supply = num(t.singleRate.dailySupplyCharge) ?? 0;
    } else if (t.rateBlockUType === 'timeOfUseRates' && Array.isArray(t.timeOfUseRates)) {
      per.tou = t.timeOfUseRates.map((r) => ({
        kind: r.type || 'OTHER',
        b: blocks(r.rates, r.period),
        win: (r.timeOfUse || []).map((w) => [dayMask(w.days), minutes(w.startTime), minutes(w.endTime, true)]),
      })).filter((r) => r.b.length);
      if (!per.tou.length) return { unsupported: 'empty time of use' };
    } else if (t.rateBlockUType === 'demandCharges') {
      return { unsupported: 'demand charges' };
    } else return { unsupported: `rate type ${t.rateBlockUType || 'missing'}` };
    if (!per.single?.length && !per.tou?.length) return { unsupported: 'no rates' };
    out.periods.push(per);
  }
  if (!out.periods.length) return { unsupported: 'no tariff' };
  // Controlled load (dedicated off-peak circuit, e.g. electric storage hot water)
  const cl = (c.controlledLoad || [])[0];
  if (cl) {
    const r = cl.singleRate?.rates?.[0]?.unitPrice ?? cl.timeOfUseRates?.[0]?.rates?.[0]?.unitPrice;
    out.clRate = num(r);
    out.clSupply = num(cl.singleRate?.dailySupplyCharge) ?? num(cl.dailySupplyCharge) ?? 0;
  }
  // Solar feed-in (retailer): first current scheme
  const fit = (c.solarFeedInTariff || []).find((f) => f.scheme !== 'PREMIUM') || (c.solarFeedInTariff || [])[0];
  if (fit) {
    const rates = fit.singleTariff?.rates || fit.timeVaryingTariffs?.[0]?.rates || [];
    // Feed-in volumes have no period in the data: large numbers are yearly, small ones daily.
    out.fit = rates.map((r) => { const v = num(r.volume); return { p: num(r.unitPrice), v: v == null ? null : v > 200 ? v / 365 : v }; }).filter((r) => r.p != null);
  }
  for (const x of c.discounts || []) {
    const m = x.methodUType;
    const pct = (v) => { const n = num(v); return n == null ? null : n > 1 ? n / 100 : n; };
    const k = m === 'percentOfBill' ? { kind: 'bill', rate: pct(x.percentOfBill?.rate) }
      : m === 'percentOfUse' ? { kind: 'use', rate: pct(x.percentOfUse?.rate) }
      : m === 'fixedAmount' ? { kind: 'fixed', amount: num(x.fixedAmount?.amount) }
      : m === 'percentOverThreshold' ? { kind: 'over', rate: pct(x.percentOverThreshold?.rate), over: num(x.percentOverThreshold?.usageAmount) } : null;
    if (k && (k.rate != null || k.amount != null)) out.disc.push({ ...k, cond: x.type !== 'GUARANTEED', name: x.displayName || x.category || '' });
  }
  for (const f of c.fees || []) {
    if (f.type !== 'MEMBERSHIP') continue;
    const a = num(f.amount);
    if (a == null) continue;
    out.fees += f.term === 'ANNUAL' ? a : f.term === 'MONTHLY' ? a * 12 : f.term === 'DAILY' ? a * 365 : 0;
  }
  out.elig = (c.eligibility || []).map((e) => ({ t: e.type, i: String(e.information || '').slice(0, 300) }));
  return out;
}

// ---------------------------------------------------------------- usage model
const shape = (fn) => { const a = Array.from({ length: SLOTS }, (_, i) => fn(i / 2)); const s = a.reduce((x, y) => x + y, 0); return a.map((x) => x / s); };
const between = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);
const SHAPES = {
  away: shape((h) => (between(h, 0, 6) ? 0.45 : between(h, 6, 9) ? 1.3 : between(h, 9, 16) ? 0.6 : between(h, 16, 22) ? 1.9 : 0.9)),
  some: shape((h) => (between(h, 0, 6) ? 0.45 : between(h, 6, 9) ? 1.2 : between(h, 9, 16) ? 0.9 : between(h, 16, 22) ? 1.7 : 0.9)),
  home: shape((h) => (between(h, 0, 6) ? 0.45 : between(h, 6, 9) ? 1.1 : between(h, 9, 16) ? 1.15 : between(h, 16, 22) ? 1.5 : 0.9)),
  day: shape((h) => (between(h, 9, 17) ? 1 : 0.02)),
  night: shape((h) => (between(h, 0, 6) ? 1 : 0.01)),
  evening: shape((h) => (between(h, 17, 22) ? 1 : 0.01)),
  cooling: shape((h) => (between(h, 13, 21) ? 1 : between(h, 21, 23) ? 0.4 : 0.02)),
  heating: shape((h) => (between(h, 6, 9) ? 1 : between(h, 17, 23) ? 1 : between(h, 9, 17) ? 0.25 : 0.1)),
  solar: shape((h) => (between(h, 7, 18) ? Math.sin(((h - 7) / 11) * Math.PI) : 0)),
};
const W = (arr) => { const s = arr.reduce((a, b) => a + b, 0); return arr.map((x) => x / s); };
// month weights (Jan..Dec)
const M = {
  flat: W(DAYS),
  cooling: W([1.25, 1.1, 0.6, 0.1, 0, 0, 0, 0, 0, 0.15, 0.45, 1.0]),
  heating: W([0, 0, 0.05, 0.35, 0.75, 1.0, 1.1, 1.0, 0.7, 0.35, 0.1, 0]),
  hotwater: W([0.8, 0.8, 0.85, 0.95, 1.05, 1.15, 1.2, 1.15, 1.05, 0.95, 0.85, 0.8].map((x, i) => x * DAYS[i])),
  solar: W([1.35, 1.22, 1.02, 0.78, 0.58, 0.48, 0.53, 0.68, 0.88, 1.08, 1.22, 1.33].map((x, i) => x * DAYS[i])),
  summerish: W([1, 1, 1, 0.6, 0.3, 0.2, 0.2, 0.3, 0.5, 0.8, 1, 1].map((x, i) => x * DAYS[i])),
};
const HRS = { 0: 0, '1-3': 2, '4-6': 5, '7+': 8 };
const peopleOf = (a, household) => {
  const n = Array.isArray(a.members) && a.members.length ? a.members.length : Number(String(household || '2').replace('+', '')) || 2;
  return Math.min(8, Math.max(1, n));
};

/**
 * Household answers → electricity usage.
 * Returns { loads: [{ kwh, months, shape, cl? }], solarKwh, batteryKwh, notes } where each load is spread by month weights and a 48-slot shape.
 */
export function electricityUsage(a, household) {
  const p = peopleOf(a, household);
  const loads = [];
  const add = (kwh, months, shp, cl = false, label = '') => { if (kwh > 0) loads.push({ kwh, months, shape: shp, cl, label }); };
  const sizeF = (a.home_type === 'apartment' ? 0.85 : a.home_type === 'townhouse' ? 0.95 : 1) * (1 + 0.05 * (Math.min(6, Number(String(a.bedrooms || '3').replace('+', ''))) - 3));
  const occ = a.daytime === 'mostly' ? 'home' : a.daytime === 'sometimes' ? 'some' : 'away';
  add((1500 + 650 * (p - 1)) * sizeF * (occ === 'home' ? 1.1 : 1), M.flat, SHAPES[occ], false, 'Lights, fridge and everyday use');
  // Air conditioning
  const ac = a.ac_type;
  if (ac && ac !== 'none') {
    const u = a.ac_units || {};
    const indoor = Number(u.indoor) || (ac === 'ducted' ? 1 : 2);
    const outdoor = Number(u.outdoor) || 1;
    const h = a.ac_hours || {};
    const cool = ac === 'ducted' ? 3.2 * outdoor : ac === 'split' ? 0.9 * indoor : 0.45 * Math.max(1, outdoor);
    const heat = ac === 'ducted' ? 3.8 * outdoor : ac === 'split' ? 1.1 * indoor : 0;
    add(cool * (HRS[h.summer] ?? 3) * 60, M.cooling, SHAPES.cooling, false, 'Cooling');
    add(heat * (HRS[h.winter] ?? 3) * 100 * sizeF, M.heating, SHAPES.heating, false, 'Heating');
  }
  // Hot water
  const hw = { elec_storage: 1000, elec_instant: 900, heat_pump: 330, solar: 350 }[a.hot_water] || 0;
  if (hw) add(hw * Math.min(6, p), M.hotwater, a.hot_water === 'elec_instant' ? SHAPES[occ] : SHAPES.night, a.hot_water === 'elec_storage', 'Hot water');
  // EV
  if (a.ev?.has === 'yes') {
    const km = Number(a.ev.km) || 250 * (Number(a.ev.count) || 1);
    add(km * 52 * 0.17, M.flat, SHAPES[{ night: 'night', day: 'day', evening: 'evening' }[a.ev.when] || 'night'], false, 'Electric car');
  }
  // Pool
  if (a.pool?.has === 'yes') {
    const sh = HRS[a.pool.summer] ?? 5, wh = HRS[a.pool.winter] ?? 2;
    add(1.0 * (sh * 150 + wh * 215), M.summerish, SHAPES.day, false, 'Pool pump');
    if (a.pool.heated === 'yes') add(1800, M.summerish, SHAPES.day, false, 'Pool heating');
  }
  // Appliances
  const ap = a.appliances || [];
  const AP = { oven: [350, M.flat, 'evening'], induction: [300, M.flat, 'evening'], dryer: [350, M.heating.map((x, i) => x * 0.6 + M.flat[i] * 0.4), occ],
    dishwasher: [280, M.flat, 'evening'], fridge2: [400, M.flat, occ], heater: [650, M.heating, 'heating'], floor: [1500, M.heating, 'heating'], blanket: [80, M.heating, 'night'] };
  for (const k of ap) if (AP[k]) add(AP[k][0], AP[k][1], SHAPES[AP[k][2]], false, 'Appliances');
  // Home office
  if (a.home_office?.has === 'yes') {
    const ppl = Number(String(a.home_office.people || '1').replace('+', '')) || 1;
    const days = Number(a.home_office.days) || 2;
    add(ppl * days * 46 * (1.2 + (ac && ac !== 'none' ? 1.0 : 0)), M.flat, SHAPES.day, false, 'Working from home');
  }
  const solarKwh = a.solar?.has === 'yes' ? (Number(a.solar.kw) || 6.6) * 3.6 * 365 : 0;
  const batteryKwh = a.battery?.has === 'yes' ? (Number(a.battery.kwh) || 10) : 0;
  return { loads, solarKwh, batteryKwh };
}

/** Household answers → gas usage in MJ: { loads: [{ mj, months }] } */
export function gasUsage(a, household) {
  if (a.has_gas !== 'yes') return { loads: [] };
  const p = peopleOf(a, household);
  const loads = [];
  const add = (mj, months, label) => { if (mj > 0) loads.push({ mj, months, label }); };
  const sizeF = (a.home_type === 'apartment' ? 0.6 : a.home_type === 'townhouse' ? 0.85 : 1) * (1 + 0.12 * (Math.min(6, Number(String(a.bedrooms || '3').replace('+', ''))) - 3));
  if (a.gas_heating && a.gas_heating !== 'no') {
    const months = { '0-2': 1.5, '3-4': 3.5, '5+': 5.5 }[a.heating_use?.months] ?? 4;
    const hours = { '1-3': 2, '4-6': 5, '7+': 8 }[a.heating_use?.hours] ?? 4;
    const mjh = a.gas_heating === 'ducted' ? 38 : 14; // average input while running
    add(mjh * hours * months * 30 * sizeF, M.heating, 'Heating');
  }
  const hw = a.gas_hot_water === 'storage' ? 5200 : a.gas_hot_water === 'instant' ? 3800 : a.hot_water === 'gas' ? 4300 : 0;
  if (hw) add(hw * Math.max(1.5, Math.min(6, p)), M.hotwater, 'Hot water');
  if (a.cooktop === 'gas') add(({ '0-5': 3, '6-10': 8, '11-15': 13, '16+': 18 }[a.cooking] ?? 8) * 210, M.flat, 'Cooking');
  return { loads };
}

// ---------------------------------------------------------------- pricing
const doy = (m, d) => { let n = 0; for (let i = 0; i < m - 1; i++) n += DAYS[i]; return n + d; };
/** Share of month mi (0-based) covered by a tariff period. */
function monthShare(per, mi) {
  const a = doy(per.from[0], per.from[1]), b = doy(per.to[0], per.to[1]);
  const ms = doy(mi + 1, 1), me = ms + DAYS[mi] - 1;
  let covered = 0;
  for (let d = Math.floor(ms); d <= Math.floor(me); d++) if (a <= b ? d >= a && d <= b : d >= a || d <= b) covered++;
  return covered / Math.round(DAYS[mi]);
}
/** Cost of `units` in a block-priced tariff over `days`. */
function blockCost(bl, units, days) {
  let left = units, cost = 0;
  for (const b of bl) {
    const cap = b.v == null ? Infinity : b.v * days;
    const take = Math.min(left, cap);
    cost += take * b.p; left -= take;
    if (left <= 0) break;
  }
  if (left > 0 && bl.length) cost += left * bl[bl.length - 1].p;
  return cost;
}
/** Fraction of a week's half-hour slot s that falls in a TOU window list. */
function slotWeight(win, s) {
  const m0 = s * 30, m1 = m0 + 30;
  let w = 0;
  for (let d = 0; d < 7; d++) {
    for (const [mask, st, en] of win) {
      if (!(mask & (1 << d))) continue;
      const inWin = st <= en ? m0 >= st && m1 <= en : m0 >= st || m1 <= en;
      if (inWin) { w += 1; break; }
    }
  }
  return w / 7;
}
const touCache = new WeakMap();
function touWeights(tou) {
  if (touCache.has(tou)) return touCache.get(tou);
  const ws = tou.map((r) => Array.from({ length: SLOTS }, (_, s) => slotWeight(r.win, s)));
  for (let s = 0; s < SLOTS; s++) { // uncovered or double-covered time goes to the first or is shared
    const tot = ws.reduce((x, w) => x + w[s], 0);
    if (tot === 0) ws[0][s] = 1;
    else if (tot > 1) ws.forEach((w) => (w[s] /= tot));
    else if (tot < 1) ws[0][s] += 1 - tot;
  }
  touCache.set(tou, ws);
  return ws;
}

/** Per-month, per-slot grid of grid imports (kWh) + controlled load kWh + exports, from an electricity usage model. */
export function electricityGrid(u, scale = 1) {
  const grid = Array.from({ length: 12 }, () => new Array(SLOTS).fill(0));
  const cl = new Array(12).fill(0);
  for (const l of u.loads) {
    for (let mi = 0; mi < 12; mi++) {
      const mk = l.kwh * scale * l.months[mi];
      if (l.cl) { cl[mi] += mk; continue; }
      for (let s = 0; s < SLOTS; s++) grid[mi][s] += mk * l.shape[s];
    }
  }
  const exp = new Array(12).fill(0);
  if (u.solarKwh) {
    for (let mi = 0; mi < 12; mi++) {
      const days = DAYS[mi];
      let monthExport = 0;
      for (let s = 0; s < SLOTS; s++) {
        const gen = u.solarKwh * M.solar[mi] * SHAPES.solar[s];
        const use = Math.min(gen, grid[mi][s]);
        grid[mi][s] -= use; monthExport += gen - use;
      }
      if (u.batteryKwh) { // battery stores daytime export and covers the evening
        let store = Math.min(monthExport, u.batteryKwh * 0.9 * days);
        monthExport -= store;
        for (let s = 34; s < 48 && store > 0; s++) { const t = Math.min(store, grid[mi][s]); grid[mi][s] -= t; store -= t; }
        for (let s = 0; s < 14 && store > 0; s++) { const t = Math.min(store, grid[mi][s]); grid[mi][s] -= t; store -= t; }
      }
      exp[mi] = monthExport;
    }
  }
  return { grid, cl, exp };
}

/** Yearly cost (incl GST) of an electricity plan for a grid. Returns { total, supply, usage, fit, disc, condDisc, fees } */
export function electricityCost(plan, g) {
  let supply = 0, usage = 0, fit = 0;
  for (let mi = 0; mi < 12; mi++) {
    const days = DAYS[mi];
    for (const per of plan.periods) {
      const share = monthShare(per, mi);
      if (!share) continue;
      supply += per.supply * days * share;
      if (per.single) {
        const kwh = g.grid[mi].reduce((x, y) => x + y, 0) * share;
        usage += blockCost(per.single, kwh, days * share);
      } else {
        const ws = touWeights(per.tou);
        per.tou.forEach((r, ri) => {
          let kwh = 0;
          for (let s = 0; s < SLOTS; s++) kwh += g.grid[mi][s] * ws[ri][s];
          usage += blockCost(r.b, kwh * share, days * share);
        });
      }
    }
    if (g.cl[mi]) {
      const rate = plan.clRate ?? (plan.periods[0].single?.[0]?.p ?? plan.periods[0].tou?.reduce((m, r) => Math.min(m, r.b[0].p), Infinity));
      usage += g.cl[mi] * rate;
      supply += (plan.clSupply || 0) * days;
    }
    if (g.exp[mi] && plan.fit.length) {
      const per = plan.fit;
      const dailyExp = g.exp[mi] / days;
      let left = dailyExp, credit = 0;
      for (const f of per) { const take = f.v == null ? left : Math.min(left, f.v); credit += take * f.p; left -= take; if (left <= 0) break; }
      if (left > 0) credit += left * per[per.length - 1].p;
      fit += credit * days;
    }
  }
  return finish(plan, supply, usage, fit, g.grid.reduce((x, m) => x + m.reduce((a, b) => a + b, 0), 0));
}

function finish(plan, supply, usage, fit, units) {
  supply *= GST; usage *= GST;
  let disc = 0, condDisc = 0;
  for (const d of plan.disc) {
    const v = d.kind === 'bill' ? (supply + usage) * d.rate : d.kind === 'use' ? usage * d.rate : d.kind === 'fixed' ? d.amount : d.kind === 'over' ? Math.max(0, usage - (d.over || 0)) * d.rate : 0;
    disc += v; if (d.cond) condDisc += v;
  }
  const total = supply + usage - fit - disc + (plan.fees || 0);
  return { total, supply, usage, fit, disc, condDisc, fees: plan.fees || 0, units };
}

export function gasMonthly(u, scale = 1) {
  return Array.from({ length: 12 }, (_, mi) => u.loads.reduce((x, l) => x + l.mj * scale * l.months[mi], 0));
}
export function gasCost(plan, monthly) {
  let supply = 0, usage = 0;
  for (let mi = 0; mi < 12; mi++) {
    const days = DAYS[mi];
    for (const per of plan.periods) {
      const share = monthShare(per, mi);
      if (!share) continue;
      supply += per.supply * days * share;
      const bl = per.single || per.tou?.[0]?.b || [];
      usage += blockCost(bl, monthly[mi] * share, days * share);
    }
  }
  return finish(plan, supply, usage, 0, monthly.reduce((a, b) => a + b, 0));
}

// ---------------------------------------------------------------- eligibility
const BLOCK_TYPES = new Set(['EXISTING_CUST', 'SMALL_BUSINESS', 'REQ_EQUIP_SUPPLIER', 'THIRD_PARTY_ONLY', 'SPORT_CLUB_MEMBER', 'ORG_MEMBER',
  'LOYALTY_MEMBER', 'GROUP_BUY_MEMBER', 'CONTINGENT_PLAN']);
/** Can this household take this plan? ctx: { solar, battery, ev, pool, pension } */
export function eligible(plan, ctx) {
  if (plan.type === 'REGULATED') return true;
  for (const e of plan.elig || []) {
    if (BLOCK_TYPES.has(e.t)) return false;
    if (e.t === 'EXISTING_SOLAR' && !ctx.solar) return false;
    if (e.t === 'EXISTING_BATTERY' && !ctx.battery) return false;
    if (e.t === 'EXISTING_POOL' && !ctx.pool) return false;
    if (e.t === 'SENIOR_CARD' && !ctx.pension) return false;
    const t = e.i.toLowerCase();
    if (/\b(existing|current) (agl |origin |\w+ )?customers? only\b|only available to existing/.test(t)) return false;
    if (/\bmembers?\b|membership/.test(t) && !/group buy/.test(t) && /(racv|club|union|member of|members only|must be a member)/.test(t)) return false;
    if (/solar/.test(t) && /(only|must|require|eligible)/.test(t) && !/(no solar|without solar|not have solar)/.test(t) && !ctx.solar) return false;
    if (/batter(y|ies)/.test(t) && /(only|must|require)/.test(t) && !ctx.battery) return false;
    if (/(electric vehicle|\bev\b)/.test(t) && /(only|must|require|own)/.test(t) && !ctx.ev) return false;
    if (/(seniors? card|pension)/.test(t) && /(only|must|require)/.test(t) && !ctx.pension) return false;
  }
  return true;
}
const hasCL = (p) => /CONT_LOAD/.test(p.model || '');

// ---------------------------------------------------------------- compare
const median = (xs) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : null; };
/**
 * Compare plans for one fuel. plans = normalised models available at the address (one network).
 * Returns { usage, current, best: [...], count } — money is yearly, incl GST.
 */
export function compare(fuel, plans, a, household) {
  const ctx = { solar: a.solar?.has === 'yes', battery: a.battery?.has === 'yes', ev: a.ev?.has === 'yes', pool: a.pool?.has === 'yes', pension: a.concession === 'pension' };
  let pool = plans.filter((p) => p.fuel === fuel && eligible(p, ctx));
  if (fuel === 'E') {
    const wantCL = a.hot_water === 'elec_storage';
    const same = pool.filter((p) => hasCL(p) === wantCL);
    if (same.length) pool = same;
  }
  if (!pool.length) return { count: 0 };
  const usage = fuel === 'E' ? electricityUsage(a, household) : gasUsage(a, household);
  const costAt = (scale) => {
    if (fuel === 'E') { const g = electricityGrid(usage, scale); return (p) => electricityCost(p, g); }
    const m = gasMonthly(usage, scale); return (p) => gasCost(p, m);
  };
  const bill = fuel === 'E' ? a.elec_bill : a.gas_bill;
  const brand = fuel === 'E' ? a.elec_retailer : a.gas_retailer;
  const billYear = bill && !bill.unknown && bill.amount > 0 && bill.days > 0 ? (bill.amount / bill.days) * 365 : null;
  let scale = 1;
  const mine = brand && !['other', 'unsure'].includes(brand) ? pool.filter((p) => p.brand === brand) : [];
  const refPlans = mine.length ? mine : pool.filter((p) => p.type !== 'MARKET').length ? pool.filter((p) => p.type !== 'MARKET') : pool;
  if (billYear) {
    // Scale usage so the household's own retailer (or the standing offers) would cost what the bill says.
    for (let i = 0; i < 3; i++) {
      const c = median(refPlans.map(costAt(scale)).map((x) => x.total));
      const fixed = median(refPlans.map(costAt(0)).map((x) => x.total));
      if (c == null || c - fixed <= 1) break;
      scale = Math.min(3, Math.max(0.3, scale * ((billYear - fixed) / (c - fixed))));
    }
  }
  const cost = costAt(scale);
  const rows = pool.map((p) => ({ p, c: cost(p) })).filter((r) => Number.isFinite(r.c.total));
  rows.sort((x, y) => x.c.total - y.c.total);
  const seen = new Set();
  const best = [];
  for (const r of rows) {
    const k = `${r.p.brand}|${r.p.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    best.push(r);
    if (best.length >= 5) break;
  }
  let current;
  if (billYear) current = { total: billYear, basis: 'bill' };
  else if (mine.length) current = { total: median(mine.map((p) => cost(p).total)), basis: 'retailer', brand: mine[0].brandName };
  else {
    const std = pool.filter((p) => p.type !== 'MARKET');
    current = { total: median((std.length ? std : pool).map((p) => cost(p).total)), basis: std.length ? 'standing' : 'typical' };
  }
  const units = best[0]?.c.units ?? 0;
  return {
    count: pool.length,
    usage: { units: Math.round(units), unit: fuel === 'E' ? 'kWh' : 'MJ', scaled: Math.round(scale * 100) / 100, fromBill: !!billYear,
      parts: (fuel === 'E' ? usage.loads.map((l) => [l.label, l.kwh * scale]) : usage.loads.map((l) => [l.label, l.mj * scale])).reduce((acc, [k, v]) => { const f = acc.find((x) => x[0] === k); if (f) f[1] += v; else acc.push([k, v]); return acc; }, []).map(([k, v]) => [k, Math.round(v)]),
      solarKwh: fuel === 'E' ? Math.round(usage.solarKwh || 0) : 0 },
    current: current && { ...current, total: Math.round(current.total) },
    best: best.map(({ p, c }) => ({
      id: p.id, brand: p.brand, brandName: p.brandName, name: p.name, type: p.type, url: p.url,
      tariff: p.periods.some((x) => x.tou) ? 'Time of use' : 'Single rate', cl: hasCL(p),
      year: Math.round(c.total), month: Math.round(c.total / 12), condDisc: Math.round(c.condDisc), fit: Math.round(c.fit),
      supplyDay: Math.round(p.periods[0].supply * GST * 10000) / 100, // cents/day incl GST
    })),
  };
}

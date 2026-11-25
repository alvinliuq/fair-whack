// Monthly data budget (stage 6). Shared by the pipeline (Node) and the API (Cloudflare Workers).
// Months are Melbourne calendar months: everything resets at 00:00 on the 1st, Melbourne time.
//
// What counts:
//   apify    recorded cost of every Apify run this month (pipeline_runs, provider NULL or 'apify')
//   zyte     estimated cost of every Zyte request this month (pipeline_runs, provider 'zyte')
//   serpapi  the plan's fixed monthly fee (SerpApi bills a flat amount, not per search)

export const BUDGET = {
  monthlyUsd: 300,
  // At this monthly total only specials and list refreshes keep running; catalogue crawls stop.
  softUsd: 240,
  // At this monthly total everything stops, including new Google Shopping lookups.
  hardUsd: 285,
  // Fixed monthly fees counted from the 1st of each month.
  fixedUsd: { serpapi: 75 },
};

export const SERPAPI = {
  monthlySearches: 5000,   // plan size
  stopAtSearches: 4900,    // keep a small margin for retries
  perUserPerDay: 60,       // one tester can't use the month's searches by accident
  cacheHours: 24,          // the same keyword is looked up at most once in this time
};

// Zyte does not return a price per request, so each request is recorded at a cautious estimate.
// These are above Zyte's published per-request rates for browser rendering and automatic extraction.
export const ZYTE_EST_USD = { http: 0.002, browser: 0.012, extraction: 0.02 };

const TZ = 'Australia/Melbourne';

/** "2026-11" for the Melbourne month containing `date`. */
export function monthKey(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' })
    .formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}

/** UTC ISO time of 00:00 on the 1st of the Melbourne month containing `date`. */
export function monthStartIso(date = new Date()) {
  const [y, m] = monthKey(date).split('-').map(Number);
  // Melbourne is UTC+10 or UTC+11. Try both and keep the one that lands on local midnight of the 1st.
  for (const off of [11, 10]) {
    const t = new Date(Date.UTC(y, m - 1, 1, -off));
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(t);
    if (local.startsWith(`${y}-${String(m).padStart(2, '0')}-01`) && /\b00$/.test(local)) return t.toISOString();
  }
  return new Date(Date.UTC(y, m - 1, 1, -10)).toISOString();
}

/** Sum the month's spend. `all(sql, params)` returns rows (pipeline db.all, or a D1 wrapper). */
export async function monthSpend(all, date = new Date()) {
  const since = monthStartIso(date);
  const rows = await all(
    "SELECT COALESCE(provider, 'apify') AS provider, COALESCE(SUM(cost_usd), 0) AS usd FROM pipeline_runs WHERE started_at >= ? GROUP BY COALESCE(provider, 'apify')",
    [since]);
  const by = { apify: 0, zyte: 0, ...BUDGET.fixedUsd };
  for (const r of rows) by[r.provider] = (by[r.provider] || 0) + Number(r.usd || 0);
  const total = Object.values(by).reduce((s, x) => s + x, 0);
  return { month: monthKey(date), since, by, total: Math.round(total * 10000) / 10000 };
}

/** 'ok' | 'soft' (only specials and list refreshes) | 'hard' (everything stops). */
export function budgetLevel(total) {
  if (total >= BUDGET.hardUsd) return 'hard';
  if (total >= BUDGET.softUsd) return 'soft';
  return 'ok';
}

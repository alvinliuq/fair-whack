// Minimal Apify client: start a run with a hard spend cap, wait, read the dataset.
// Set APIFY_FIXTURE_DIR to read local JSON files instead (testing, no cost).
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://api.apify.com/v2';

function token() {
  const t = process.env.APIFY_TOKEN;
  if (!t) throw new Error('APIFY_TOKEN is not set');
  return t;
}

async function api(method, p, body) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${API}${p}`, {
      method,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if (attempt < 4 && (res.status >= 500 || res.status === 429)) {
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw new Error(`Apify ${method} ${p.split('?')[0]} -> ${res.status}: ${text.slice(0, 300)}`);
  }
}

/** Cost of a finished run in USD. Prefers pay-per-event charges; falls back to platform usage. */
export function runCostUsd(run) {
  const counts = run.chargedEventCounts || {};
  const events = run.pricingInfo?.pricingPerEvent?.actorChargeEvents || {};
  let ppe = 0, priced = false;
  for (const [ev, n] of Object.entries(counts)) {
    const price = events[ev]?.eventPriceUsd;
    if (price != null) { ppe += price * n; priced = true; }
  }
  if (priced) return Math.round(ppe * 10000) / 10000;
  return Math.round((run.usageTotalUsd || 0) * 10000) / 10000;
}

/**
 * Run an actor and return { items, costUsd, status, runId }.
 * maxChargeUsd is passed to Apify as maxTotalChargeUsd: the run is stopped by Apify once reached.
 */
export async function runActor(actorId, input, { maxChargeUsd, label = 'run', timeoutMin = 55 } = {}) {
  if (process.env.APIFY_FIXTURE_DIR) return fixture(label);
  const qs = new URLSearchParams();
  if (maxChargeUsd != null) qs.set('maxTotalChargeUsd', String(maxChargeUsd));
  qs.set('timeout', String(timeoutMin * 60));
  const started = await api('POST', `/acts/${actorId}/runs?${qs}`, input);
  let run = started.data;
  const deadline = Date.now() + (timeoutMin + 5) * 60 * 1000;
  while (['READY', 'RUNNING'].includes(run.status)) {
    if (Date.now() > deadline) {
      await api('POST', `/actor-runs/${run.id}/abort`).catch(() => {});
      throw new Error(`${label}: timed out`);
    }
    await new Promise((r) => setTimeout(r, 15000));
    run = (await api('GET', `/actor-runs/${run.id}?waitForFinish=60`)).data;
  }
  const items = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true&format=json&offset=${offset}&limit=1000`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) throw new Error(`${label}: dataset read failed ${res.status}`);
    const page = await res.json();
    items.push(...page);
    if (page.length < 1000) break;
  }
  // Re-read run so charges include everything.
  run = (await api('GET', `/actor-runs/${run.id}`)).data;
  return { items, costUsd: runCostUsd(run), status: run.status, runId: run.id };
}

function fixture(label) {
  const dir = process.env.APIFY_FIXTURE_DIR;
  const file = path.join(dir, `${label.replace(/[:/]/g, '_')}.json`);
  const items = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  return { items, costUsd: 0, status: 'SUCCEEDED', runId: `fixture:${label}` };
}

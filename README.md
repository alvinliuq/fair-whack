# Fair Whack — internal beta

Victorian supermarket price comparison PWA (Woolworths, Coles, ALDI, Costco). Internal testing only.

- `public/` — the app (static PWA, no build step)
- `functions/api/[[path]].js` → `shared/api.js` — API on Cloudflare Pages Functions, data in Cloudflare D1
- `pipeline/` — weekly data collection via Apify, normalisation, matching, discount flags, push alerts (runs in GitHub Actions)
- `db/migrations/` — D1 schema
- `dev/` — local server (node:sqlite stand-in for D1) and sample data

## Setup (once)

Add these **GitHub → Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Account ID |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Custom Token with **Account · D1 · Edit** and **Account · Cloudflare Pages · Edit** |
| `APIFY_TOKEN` | Apify Console → Settings → API & Integrations → Personal API token |
| `INVITE_CODE` | Code testers type to sign in |
| `ADMIN_CODE` | Code that signs you in as admin (different from the invite code) |
| `SESSION_SECRET` | Any long random string (40+ characters). Also used to derive the push-notification keys, so don't change it later |

Then **Actions → Deploy → Run workflow**. The first deploy creates the database, publishes the site at `https://fair-whack.pages.dev` (Cloudflare may add a suffix if the name is taken — see the Deploy log) and starts the first data collection.

In Apify, set a monthly usage limit (Settings → Usage & billing) as a second safety net.

## Schedules (Melbourne time)

| When | Job |
|---|---|
| Wed 02:30 | Specials (Woolworths + Coles, ~2,500 each, half-price first), refresh of wishlisted items, matching |
| Wed 08:00 | One merged push per tester for list items on special |
| Mon 03:00 | Catalogue crawl (~10k products per store, each store's own departments), only if 27+ days since the last one |

Run any job by hand: **Actions → Pipeline → Run workflow** (`status` shows spend).

Budget guard: per-run caps in `pipeline/config.js`; at $80 recorded spend only specials keep running; at $95 everything stops.

## Managing testers

Sign in with the admin code, then **More → Admin → Testers**. The table shows when each tester was last active (refreshed at most once an hour). **Manage** on a row offers:

- **Merge into another tester** — for one person who signed in under two names. Lists, alerts and search history move to the tester you choose; the other name is deleted.
- **Remove from the beta** — deletes their lists and alerts, signs them out at once, and blocks that name. **Allow back** (under "Removed") lifts the block; they start again with an empty account.

**Download list (CSV)** saves the table for Excel or Numbers. Everyone shares one invite code, so a removed person could still sign in under a different name: change `INVITE_CODE` and redeploy if that matters.

## Database reads (Cloudflare D1 free plan: 5 million rows read a day)

The free plan stops the database for the rest of the day (until 00:00 UTC) once the limit is hit, so the app avoids reading every product:

- **Search and suggestions** read `word_index` (word → products) instead of scanning `retailer_product`. The pipeline's matching step keeps it up to date; a deploy builds it if it is missing. Rebuild by hand: **Actions → Pipeline → Run workflow → `match`**.
- **Store totals, category counts, deal and browse pages** are saved in `api_cache` for 6 hours. Every pipeline run that changes data empties it.
- If either table is missing or empty the app still works, by reading the products directly (slow path).

## Local

```bash
node --experimental-sqlite dev/seed.js     # sample data through the real pipeline
node --experimental-sqlite dev/server.js   # http://localhost:8788  invite: beta  admin: admin
npm test
```

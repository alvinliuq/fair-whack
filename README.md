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
| `DESIGN_CODE` *(optional)* | Code for design reviewers. Signs in to a separate "design review" account (never a tester's account, never admin). Delete the secret and redeploy to end the review; anyone signed in with it is signed out |
| `SESSION_SECRET` | Any long random string (40+ characters). Also used to derive the push-notification keys, so don't change it later |
| `SERPAPI_KEY` | SerpApi → Api Key (Google Shopping comparison in search) |
| `ZYTE_API_KEY` | Zyte → API key (technical checks of second-batch retailers) |

Then **Actions → Deploy → Run workflow**. The first deploy creates the database, publishes the site at `https://fair-whack.pages.dev` (Cloudflare may add a suffix if the name is taken — see the Deploy log) and starts the first data collection.

In Apify, set a monthly usage limit (Settings → Usage & billing) as a second safety net.

## Schedules (Melbourne time)

| When | Job |
|---|---|
| Wed 02:30 | Specials (Woolworths + Coles, ~2,500 each, half-price first), refresh of wishlisted items, matching |
| Wed 08:00 | One merged push per tester for list items on special |
| Mon 03:00 | Catalogue crawl (~10k products per store, each store's own departments), only if 27+ days since the last one |

Run any job by hand: **Actions → Pipeline → Run workflow** (`status` shows spend).

Budget guard (monthly, Melbourne calendar month, resets on the 1st; figures in `shared/budget.js`):
this month's Apify runs + Zyte requests (estimated) + the SerpApi plan fee (US$75) are added up. At **$240** catalogue
crawls stop and only specials and list refreshes run; at **$285** everything stops, including new Google Shopping lookups.
Per-run caps are in `pipeline/config.js`. `status` also prints Apify's and SerpApi's own account figures.

## Matching products across stores

Every pipeline run links the same product at Woolworths and Coles (`pipeline/match.js`), then reviews what it could not decide (`pipeline/review.js`):

- **Linked automatically:** same brand and size, names at least 90% alike. Best pairs are linked first, so an exact twin beats a near one, and names with different numbers ("85% Cocoa" / "90% Cocoa") never match.
- **Reviewed automatically:** pairs that are less alike are linked only when all three hold: same size, names more than 90% alike once plurals and spelling variants are evened out, and the two stores' photos are highly alike (thresholds in `pipeline/config.js` → `REVIEW`).
- **Left for a person:** everything else, in **Admin → Possible matches**. Nothing is rejected automatically.

See what a run would change without changing anything: **Actions → Pipeline → Run workflow → `review`** (leave "apply" off) and read the log.

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

## FW1.2 (Grape & Lime)

- **Look:** Grape & Lime identity from the design handoff (`public/icons/*` regenerated, Bricolage Grotesque + DM Sans from Google Fonts). Store names are neutral text; no store colours.
- **Home:** "On special from your list" is a swipe rail with Woolworths / Coles toggles (both on by default, remembered per device). The second section is "Bargains you're missing" and hides items already on the tester's list.
- **Search by photo:** `POST /api/search/photo` sends a resized JPEG to Workers AI (`[ai]` binding in `wrangler.toml`, model `@cf/meta/llama-3.2-11b-vision-instruct`, licence accepted automatically on first use, LLaVA as fallback). Photos are not stored.
- **Scan a barcode:** `public/barcode.js` decodes EAN-13 / UPC-A / EAN-8 from the camera (iPhone Safari has no BarcodeDetector). `GET /api/search/barcode` matches `retailer_product.gtin` in any leading-zero form, then falls back to an Open Food Facts name lookup.
- **Restore FW1.1:** branch `release-fw1.1`.

## Bills: electricity and gas plans (FW2.0)

Every Sunday 04:00 Melbourne, **Actions → Energy** downloads Victorian residential electricity and gas plans from the
Australian Energy Regulator (the same data as Energy Made Easy and Victorian Energy Compare; free, no key) into `energy_plan`.
Run it by hand: **Actions → Energy → Run workflow → `plans`**. The calculator is `shared/energy.js`: it turns the household
profile (More → Your profile → Save more on Bills) into yearly usage, matches it to the last bill when one is entered,
and prices every eligible plan at the home's postcode, including GST.

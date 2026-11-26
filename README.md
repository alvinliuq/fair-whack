# Fair Whack — internal beta

Shopping list + price comparison PWA across Australian retailers. Internal testing only.

Stores (`shared/retailers.js`): Woolworths, Coles (Apify `atalaia`), and since stage 6 ALDI, Costco, Bunnings, BIG W, Officeworks, Chemist Warehouse (Apify `abotapi` scrapers), JB Hi-Fi (Apify `dromb`) and Kmart from **Google Shopping** (SerpApi, `pipeline/serp.js`: Kmart's site blocks Apify and Zyte; about 41 searches per range refresh, 5 per specials run, one per list item; runs cost $0 and stop while 2,500 of the month's searches are left for testers). Second batch (`pipeline/zyte-source.js`, Zyte API automatic extraction of listing pages): Target, The Good Guys, Petbarn, PetO (plain HTML) and Decathlon, EB Games (browser); third batch (27 Nov): Harvey Norman (plain HTML, search pages) PETstock (category pages, browser) and Pet Circle (category pages, plain HTML); each request recorded at an estimated cost, Zyte runs stop at US$65 a month (Zyte's own limit: US$70). What each scraper is asked for and how its output is read: `pipeline/sources.js`. A store shows in the app once it has products. Test a scraper cheaply: **Actions → Pipeline → Run workflow → `probe`** (5 products per store, no products saved).

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
| Wed 02:30 | Specials of every retailer (Woolworths + Coles ~2,500 each, half-price first), refresh of wishlisted items, matching |
| Wed 08:00 | One merged push per tester for list items on special |
| Sat 02:30 | Specials of every retailer except the supermarkets (Woolworths, Coles, ALDI change theirs on Wednesdays), matching |
| Sat 08:00 | One merged push per tester for list items on special |
| Wed + Sat 17:00 | `retry`: stores whose specials did not update successfully that day run again (Wednesday with their list items). Admin shows a warning for any store whose last specials run failed or whose last good one is older than 8 days (supermarkets) or 5 days (others) |
| Mon 03:00 | Catalogue crawl (~10k products per store, each store's own departments), only if 27+ days since the last one |

Run any job by hand: **Actions → Pipeline → Run workflow** (`status` shows spend).

Budget guard (monthly, Melbourne calendar month, resets on the 1st; figures in `shared/budget.js`):
this month's Apify runs + Zyte requests (estimated) + the SerpApi plan fee (US$75) are added up. At **$240** catalogue
crawls stop and only specials and list refreshes run; at **$285** everything stops, including new Google Shopping lookups.
Per-run caps are in `pipeline/config.js`. Apify's own account limit (US$100, its own billing cycle) is read before each run: catalogue crawls stop $15 before it and everything $3 before it, so Apify never blocks the specials. `status` also prints Apify's and SerpApi's own account figures.

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
- **Home:** "Deals on your list" (was "On special from your list"): only list items on special now. All stores shows each product once, at its lowest special (a tie goes to the store checked most recently); a single store shows that store's specials. Which store is cheapest overall, special or not, is on the product page ("Lowest" pill); a Home tile also gets "Lowest" when it is the lowest price anywhere: our stores plus the product's saved Google Shopping results, less what the tester ignored (`GET /api/lowest`, no new lookups) is a swipe rail with Woolworths / Coles toggles (both on by default, remembered per device). The second section is "Bargains you're missing" and hides items already on the tester's list.
- **Search by photo:** `POST /api/search/photo` sends a resized JPEG to Workers AI (`[ai]` binding in `wrangler.toml`, model `@cf/meta/llama-3.2-11b-vision-instruct`, licence accepted automatically on first use, LLaVA as fallback). Photos are not stored.
- **Scan a barcode:** `public/barcode.js` decodes EAN-13 / UPC-A / EAN-8 from the camera (iPhone Safari has no BarcodeDetector). `GET /api/search/barcode` matches `retailer_product.gtin` in any leading-zero form, then falls back to an Open Food Facts name lookup.
- **Restore FW1.1:** branch `release-fw1.1`.

## Bills: electricity and gas plans (FW2.0)

Every Sunday 04:00 Melbourne, **Actions → Energy** downloads Victorian residential electricity and gas plans from the
Australian Energy Regulator (the same data as Energy Made Easy and Victorian Energy Compare; free, no key) into `energy_plan`.
Run it by hand: **Actions → Energy → Run workflow → `plans`**. The calculator is `shared/energy.js`: it turns the household
profile (More → Your profile → Save more on Bills) into yearly usage, matches it to the last bill when one is entered,
and prices every eligible plan at the home's postcode, including GST.

## Google Shopping comparison (stage 6)

Search shows an **Elsewhere online** section under our own results (Google's relevance order, used items labelled): other shops' prices for the same words from Google
Shopping via SerpApi (`GET /api/search/web`, Developer plan, 5,000 searches a month). Each keyword is looked up at most
once every 24 hours for everyone (`serp_cache`). Results are valid for a day and refreshed only when someone looks (a product page, or Home's list items in the background); nothing is refreshed on a schedule. Lookups stop at 4,900 a month, 60 Search-page keyword lookups per tester a day (200 product refreshes), and at the monthly
budget's hard stop; the last saved results are shown instead. The product page also looks its product up (`GET /api/product/:id/web`, same cache and caps; when fewer than 5 same-product rows come back, a second, shorter search without colour or pack size is added, and close matches fill up to 5: a title may leave out our variant words and up to 70% of the naming words may differ; marked "Close match", counted for Lowest like the rest; a tester can Ignore them). Rows are kept only when they are the same product (`shared/webmatch.js`: brand compared without spaces and only when it is in the product's name; variant words such as Advanced, Kids, Ultimate, Album must agree both ways, Disc/Digital/Slim only when our name has them; no multipacks; product words missing from the title plus extra naming words in it at most 40% of the product's words; a different pack number drops the row, no pack number keeps it, marked "Size not shown" (still counted for Lowest); price within 0.4–2.5× ours, no used items, no store we already read for it); the cheapest price on the page, ours or Google's, gets a **Lowest** pill. eBay and other marketplace sellers count. A tester can tap **Ignore** on a Google Shopping card (one shop, one product, just for them, `user_web_ignore`): the card stays, greyed, and is left out of Lowest; **Undo** brings it back. Home (`GET /api/lowest`) runs the same lookups in the background for the items in "Deals on your list" and marks the lowest with the pill.

## Friends and sharing (stage 7)

Top right on every page: **Settings** and **Me** (Friends, Shared with you, My account, My profile, Admin, Sign out).
Friends are added by @user name or by scanning a friend's QR code (Me → Friends); either way the other person must
accept. Friends see only products shared with them, never lists or profiles. Shared products show in Home →
"Shared with you" and Me → Shared with you. Friend requests and shares are pushed straight away (`shared/push.js`:
an empty VAPID wake-up push; the service worker then fetches `/api/notifications/pending`). QR codes use
`qrcode-generator` and `jsqr`, copied from npm into `public/vendor/` at deploy.

## Your Brands, Your Deals (FW2.2)

Partner brand deals on Home, under "Most popular - Top 20 this week". Code: `shared/brands.js` (rules), `shared/brands-api.js`
(API), `public/brands.js` (pages), `public/deal.html` (public share page), migration `0015_brand_deals.sql`.

- **Set up:** Admin → **Brand deals**. Add a brand (logo, tab colour, website; tick the four admission checks to approve it),
  then a campaign (type Brand site / Retailer event, offer line, image, landing page, dates, priority, optional Fair Whack code,
  matching tags, featured products linked to the same products in Fair Whack). **Save and go live** sends brand alerts once.
  Images can be uploaded (stored in D1, served from `/api/assets/<id>`).
- **Who sees what:** `BRAND_ZONE.mode = 'fixed'` in `shared/brands.js`: everyone sees the same live campaigns, top 5 by priority.
  Switch to `'match'` when there are enough users: only campaigns scoring 40+ (list category 40, brand on list or followed 30,
  household target 20, similar families engaged 10), best first. The score already writes the reason on each card.
- **Honesty rules:** every card and page says Partner; featured products always show other stores' prices, even cheaper ones;
  partner deals never touch search, same-product comparison, Bargains or Top 20 (More → How Fair Whack makes money).
- **People:** Follow brand (told about each new campaign) · Not interested (brand hidden 90 days) · Share to friends (push) or
  as a link (`/deal?c=…&r=<friend code>`; someone who then signs up is recorded in `users.referred_by`).
  Brand deal alerts: Settings → Alerts, on by default, at most one a week for deals scoring 70+, within the 5-a-day push cap.
- **Links out:** `/api/go/<campaign>` counts the click, then redirects with `utm_source=fairwhack` (untick for affiliate links).
- **Results:** the campaign table shows seen, clicks, CTR, added to list, follows, shares, Not interested (and its rate), share-page opens.
- **Beta demo vs Partner:** a brand shows as **Partner** only when "Arrangement confirmed with the brand" is ticked
  (Admin → Brand deals → brand). Until then its campaigns are **Beta demo**: labelled so on the card and page, with a note
  that the brand is not a partner and any extra Fair Whack discount is simulated; no public share link (friends only); no push alerts.
  Before public launch every campaign must be confirmed with the brand.

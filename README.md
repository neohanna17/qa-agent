# qa-agent

Automated QA smoke‑test agent for LevCharity's ~20 public fundraising sites. It crawls every site on a schedule with **Playwright** (stealth‑patched to get past Cloudflare bot checks), runs structural + visual health checks, sanity‑checks screenshots with **Claude Haiku vision**, and writes the results to **Firebase Realtime Database**. A static dashboard (hosted on Netlify) reads those results and shows daily pass/fail per site.

No servers to run — everything happens in GitHub Actions on a cron, and the dashboard is static HTML reading straight from Firebase.

---

## How it works

```
GitHub Actions (cron)
      │
      ├─ scripts/smoke-test.js   ← daily: homepage/structure checks on every site
      │     • Playwright + stealth loads each site
      │     • DOM checks: logo, nav, footer, broken images, search, donate elements…
      │     • screenshots → Claude Haiku vision for a visual sanity pass
      │
      └─ scripts/flow-test.js    ← weekly: deeper per‑site flows by site type
      │
      ▼
Firebase Realtime Database   (autoResults / autoLatest / autoSummary)
      ▼
dashboard/ (static, Netlify)  ← reads RTDB, shows daily results + per‑site detail
```

---

## Repository layout

| Path | What it is |
|---|---|
| `scripts/smoke-test.js` | Daily smoke suite across all sites (structural checks + Claude vision). |
| `scripts/flow-test.js` | Weekly flow suite; sites classified by type and tested with the matching module set. |
| `dashboard/index.html` | Results dashboard — daily pass/fail grid + summary stats. |
| `dashboard/site.html` | Per‑site detail view (drill‑down from the grid). |
| `.github/workflows/daily-qa.yml` | Cron + manual triggers that run the suites in CI. |
| `netlify.toml` | Publishes `dashboard/` as the Netlify site root. |
| `package.json` | Scripts + dependencies (Playwright, stealth plugin, firebase-admin). |

---

## The two test suites

### `smoke-test.js` — daily
Loads each site's homepage (and key sub‑pages where relevant) and asserts the basics are healthy:
- **Logo** present and loaded (handles WordPress `img.custom-logo`, Elementor, and headless‑Chrome image quirks).
- **No broken images** (excludes SVGs, lazy, hidden, and zero‑layout images to avoid false positives).
- **Navigation** and **footer** links present (tolerates Elementor/portal layouts that legitimately lack a `<nav>` or footer links).
- **Search** returns results (dropdown, filtered list, or URL‑based).
- **Donate page** essentials where applicable (e.g. amount/equipment cards, add‑to‑cart, currency/language selector).
- **Visual sanity** — screenshots are sent to **Claude Haiku** vision as a cheap second opinion (~fractions of a cent per shot).

Built from direct DOM inspection of every site, with per‑site special cases documented inline (Misaskim, ADI, Nitzanim, Yorkville, Shomrim, United Hatzalah Cloudflare skips, etc.) to keep false positives at zero.

### `flow-test.js` — weekly
Deeper, journey‑style validation. Each site is classified and only the modules that actually exist on it are tested:

| Site type | What it checks |
|---|---|
| `teamCampaign` | Fundraiser list, hero, donations/about, search, pagination |
| `p2pCampaign` | Hero, progress bar, donate button, social share |
| `donationForm` | Amounts, donate button, checkout flow |
| `portal` | Multi‑page hubs (donate, events, membership) |

---

## Sites covered (~20)
`pantry` (Pantry Packers) · `israelthon` · `yorkville` · `chaiathon` · `fcl` · `uh` (United Hatzalah) · `clc` · `afmda` · `misaskim` · `shomrim` · `fallen` · `nitzanim` · `imf` (Israel Magen Fund) · `adi` · `yeshiva` · `nahal` · `r2bo` · `ots` · `mizrachi` · `kolleldc`

The authoritative list lives in the `SITES` array at the top of each script (and a matching list in `dashboard/index.html`).

---

## Running locally

Requires **Node ≥ 18**.

```bash
npm install
npx playwright install chromium --with-deps
```

Set the environment variables (see below), then:

```bash
# Smoke test — all sites
FIREBASE_DATABASE_URL="https://<your-db>.firebaseio.com" \
ANTHROPIC_API_KEY="sk-ant-…" \
npm test

# Smoke test — a single site
SINGLE_SITE=pantry npm test

# Flow test — all sites (no Anthropic key needed)
FIREBASE_DATABASE_URL="https://<your-db>.firebaseio.com" npm run flow

# Flow test — a single site, or by type
SINGLE_SITE=pantry npm run flow
SITE_TYPE=donationForm node scripts/flow-test.js
```

Screenshots are written to `/tmp/qa-screenshots` (smoke) and `/tmp/flow-screenshots` (flow).

### Environment variables
| Variable | Used by | Purpose |
|---|---|---|
| `FIREBASE_DATABASE_URL` | both | Realtime Database base URL; results are written here via REST. |
| `ANTHROPIC_API_KEY` | smoke | Claude vision API key (model: `claude-haiku-4-5`). |
| `SINGLE_SITE` | both | Run just one site by `id` (empty = all). |
| `SITE_TYPE` | flow | Run only sites of one type (e.g. `donationForm`). |

---

## Continuous integration & scheduling

`.github/workflows/daily-qa.yml`:
- **Daily 05:00 UTC** (08:00 Israel) → `smoke-test.js`
- **Mondays 07:00 UTC** → `flow-test.js`
- **Manual** (`workflow_dispatch`) with inputs: `site_id` (single site, blank = all) and `test_type` (`smoke` | `flow`).

Required GitHub Actions **secrets**: `ANTHROPIC_API_KEY`, `FIREBASE_DATABASE_URL`.

---

## Dashboard & deployment

The dashboard is static HTML in `dashboard/`, deployed by Netlify (`netlify.toml` publishes `dashboard/` at the site root). It talks directly to Firebase Realtime Database (project `qa-tracker-73b87`) behind a lightweight access gate.

It reads:
- `autoResults/{YYYY-MM-DD}` — per‑site results for a given day
- `autoLatest` — pointer to the most recent run
- `autoSummary` — recent daily roll‑ups (pass rate over time)

`index.html` shows the daily grid + summary stats and links to `site.html?id={siteId}` for the per‑site breakdown.

---

## Firebase data model (Realtime Database)

```
autoResults/
  2026-07-29/
    pantry/    { checks: [...], passed, failed, screenshot, … }
    israelthon/ { … }
autoLatest      { date: "2026-07-29", … }
autoSummary/    { <run>: { date, passRate, tested, … } }
```

The test scripts write results with a REST `PUT`/`POST` to `${FIREBASE_DATABASE_URL}/<path>.json`.

---

## Adding or changing a site
1. Add an entry to the `SITES` array in **`scripts/smoke-test.js`** and, if it should get flow coverage, in **`scripts/flow-test.js`** (with its `type` + type‑specific config).
2. Add the same `id`/`name` to the `SITES` array in **`dashboard/index.html`** so it appears on the grid.
3. Run locally with `SINGLE_SITE=<id>` to confirm no false failures before it goes into the daily sweep.

---

## Notes
- **Cloudflare:** some sites (e.g. United Hatzalah sub‑pages) block GitHub Actions IPs; those checks are explicitly skipped and flagged for manual verification rather than failing the run.
- **Headless image quirks:** SVGs report `naturalWidth=0` and lazy/hidden images aren't loaded in headless Chrome — the broken‑image check accounts for all of these to avoid false positives.
- **Vision model:** smoke tests use Claude Haiku (`claude-haiku-4-5`) via the Anthropic Messages API. (The `package.json` description still says "Gemini vision" and is out of date relative to the code.)

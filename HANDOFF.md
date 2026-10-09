# SatLapse handoff

State as of 2026-10-07: **Phases 1–3 are complete.** Phase 4 (additional data layers) hasn't started; see "Next steps". Repo: https://github.com/ashtonwallen/OSINT-SatLapse-Satellite-Image-Tool. Hosting target: Vercel at `satlapse.ashtonwilliamallen.com`.

## What was built

| Area | What's there |
|---|---|
| **Drawing & search** | Photon place search behind a swappable `Geocoder` interface; polygon and rectangle drawing; a 100 km² limit with an explanation, set by entitlements and overridable with `VITE_MAX_AREA_KM2`; small areas get a 2 km context window. |
| **Imagery** | Sentinel-2 L2A merged from three catalogues (Earth Search C1 and legacy, Planetary Computer), with same-day tile mosaicking. Landsat 4–8 C2 L2 back to 1982 ("Since 1984"), harmonised to Sentinel-2. NAIP aerial imagery (US, 0.3–1 m) on its own native-resolution grid. USGS high-res basemap toggle. |
| **Backfill & tracking** | Web Worker engine: catalogue search, SCL-only cloud screening over the polygon, sampling (every / month / quarter), chronological processing with change versus previous and baseline, aerial pass, then events. Interrupted runs resume. Every app open checks each area for new scenes and shows a "new" badge. |
| **Products** | True colour, NDVI, NDWI, NDBI, change overlays (vs previous, vs first), and per-scene land-cover shares. |
| **Change detection** | Pure, deterministic `src/core/detect.ts`: seasonal reference (same ±35 days in earlier years, robust median/MAD), onset-only flags, confirmation by the next scene, confidence levels high/medium/low, and a previous-scene fallback. Smoke/haze scenes are detected relative to each area's history and excluded. Events are plain JSON with provenance. |
| **Replay & visualisation** | Player with step and speed controls, a time-proportional timeline with event markers, layer cards, change highlight, opacity, a chart synced to the player (hover, click to seek, table view, colour-blind-validated palette), a before/after swipe for any two dates (satellite or aerial), and a map legend plus date chip. |
| **Export** | GIF (gifenc) and MP4 (WebCodecs via mediabunny) with date, sensor and attribution burned in. Project files (`.satlapse`, v2, plus v1 import). Self-contained HTML report and PDF (via the print dialog) that cite date, sensor and STAC item ID for every finding. |
| **Projects** | Projects hold areas, Markdown notes (safe renderer), annotations pinned to place and date, and a unified timeline. (The code and storage still call these `Investigation`, see "Decisions".) |
| **Sharing** | Share links carry the project name and outlines only, in the URL fragment, and show a confirmation panel. v1 links still work. |
| **AI (optional)** | Copy to AI (prompt or zip with labelled key images). Ollama (local, with a no-tools fallback). Bring-your-own-key for Anthropic (official SDK, streaming, server-side refusal fallbacks), OpenAI, Gemini and OpenRouter. Six tools; drafts need approval; keys are memory-only by default with opt-in persistence. |
| **Security** | One host list drives the CSP `<meta>`, `_headers` and `vercel.json` (the build fails on drift). The `/security` page covers storage, every host, how to verify, key safety and running locally. No analytics. |
| **Docs/pages** | `/methodology`, `/security`, README, CONTRIBUTING, SPIKE (all feasibility work and measurements), PLAN. |
| **Paid-tier prep** | `src/config/entitlements.ts` (all free today), `src/core/alerts.ts` (`NotificationChannel` + `toAlert`), `src/core/highres.ts` (`OnDemandImageryProvider`), a waitlist button driven by `BRAND.alertsWaitlistUrl` (hidden while empty), and `#area=…&date=…` deep links. |
| **Example** | `public/examples/oroville.satlapse`, loaded by "Try an example". |

Tests: 28 unit tests (vitest) covering geometry, sampling, products, offsets, NAIP and Landsat logic, seasonal detection (synthetic series), the agent loop (scripted fake model), project file round-trips, share links, and the alerts and entitlements interfaces.

## Architecture

```
React UI (src/App.tsx, src/ui)                       src/pages (/security, /methodology)
  │  postMessage                                     src/export (GIF/MP4, report)
  ▼                                                  src/ai (providers, agent, tools)
Engine worker (src/workers/engine.worker.ts)
  │  calls
  ▼
src/core  ── runtime-agnostic: fetch + Storage + ImageEncoder only
  catalog.ts / stac.ts   STAC search, normalisation, PC SAS signing
  cog.ts / scene.ts      range reads, overview selection, mosaics, QA→SCL, harmonisation
  products.ts            indices, land cover, pixel change
  detect.ts              seasonal-aware events (pure)
  naip.ts                aerial frames
  engine.ts              backfill/track orchestration
  project.ts / share.ts  portability
  alerts.ts / highres.ts paid-tier interfaces
  │
  ▼
Storage interface ── IdbStorage (src/storage/idb.ts) | MemoryStorage (Node/tests)
```

`scripts/sync-node.ts` runs the full engine under Node with `MemoryStorage` and a sharp encoder. That proves the core runs outside the browser.

## Decisions and tradeoffs

- **Merged catalogues.** No single free Sentinel-2 catalogue is complete: Collection 1 has gaps such as 2022, and the legacy collection has duplicates and an offset quirk. Merging costs three searches per sync but gives the most complete record.
- **SCL-first screening.** Cloud screening reads only the 20 m SCL band (about 10 KB per scene) before any full download. That's the main reason long histories are affordable.
- **Fixed 10 m grid per area, snapped to 20 m in the area's UTM zone.** Every sensor is resampled onto it so per-pixel change lines up. Landsat (30 m) and the 2 km context window cost extra pixels for small areas.
- **Land-cover thresholds are global and simple** (documented on `/methodology`). "Built & bare" really is built *and* bare; the UI says so instead of overclaiming.
- **The seasonal detector is stats-level.** PLAN §3 also proposed 40 m per-month reference composites for pixel-level seasonal masks. They were **not built**. The change *overlays* still compare with the previous and first scenes, and seasonal reasoning applies to *flagged events*. This is the main deviation from the plan; see "Next steps".
- **Data-quality checks are visual first.** Three real bugs passed type checks and tests and were only caught by looking at rendered frames: the legacy Earth Search offset (twice) and wildfire smoke passing the cloud mask (see SPIKE.md addenda). Keep doing this when changing processing.
- **Harmonisation:** Roy et al. 2016 *surface-reflectance* coefficients (TM/ETM+ → OLI), and OLI is treated as equal to MSI. The top-of-atmosphere set broke water detection, and a regression test guards against that.
- **NAD83 vs WGS84 UTM** are treated as identical for NAIP (about 1–2 m apart in CONUS). USGS northern-zone CRSs south of the equator are translated by the 10,000 km false northing.
- **PDF uses the browser print dialog** (no dependency, works offline). It needs one extra click.
- **Naming.** The UI says "project", while code and storage keep `Investigation` and `investigationId`. Renaming them would require an IndexedDB migration for no user benefit.
- **AI conversations aren't persisted**, for privacy. Keys are memory-only unless the user opts in.
- **Anthropic is called through the official SDK** in browser mode. OpenAI, Gemini and OpenRouter use plain `fetch`, to keep the bundle small and the provider layer uniform. The Anthropic SDK and mediabunny are lazy-loaded.

## Performance limits found (measured)

| Scenario | Result |
|---|---|
| One scene, 100 km² | 2–6 s, 10–30 MB (Phase 1). Earth Search uses 1024 px COG tiles, so small areas often cost as much as large ones. |
| 1 year, monthly, ~6–30 km² (browser) | about 27 s end to end. |
| 89 km², 2015→, quarterly (Node) | 652 candidates, 44 processed, 3.5 min, 1.2 GB. |
| 11.5 km², 1982→, quarterly incl. Landsat (Node) | 1,550 candidates, 168 processed, 10 min, ~1 GB. |
| NAIP | 0.3–0.9 MB per stored frame. Overview selection keeps downloads proportional to the output resolution. |
| GIF / MP4 export (6 frames, ~540 px) | 0.3 s / 1.3 s. |

**Storage:** about 1 MB per Sentinel-2 frame at 10 m for 30–90 km² (6 images). Long histories of large areas can reach hundreds of MB in IndexedDB; the app requests persistent storage but doesn't yet show usage or warn near quota.

## Stubbed, incomplete or untested

- **AI providers haven't been called live.** No real API keys were used during development. Verified instead: CORS preflights for all four hosted providers, the full agent loop with a scripted fake model, and the tool host against real data. **Before launch, run one real conversation per provider.** Suggested model names (for example `gpt-5`, `gemini-2.5-pro`) may need updating; the model field is free text.
- **Ollama** is untested against a running instance.
- **Phase 4 data layers** (Sentinel-1, VIIRS, FIRMS, Sentinel-5P) aren't started.
- **Seasonal pixel composites** weren't built (see above).
- **No storage usage meter or quota warning.** No per-area "reprocess" button, which is needed if processing logic changes for existing areas.
- **Tracking only happens while the app is open** (by design for the free tier).
- **Old Landsat 7 SLC-off scenes are rejected** instead of gap-filled.
- **There are no end-to-end browser tests.** UI flows were verified by hand in a real browser (desktop and phone viewports, plus a production build under the CSP).
- **The example covers 2015→ at 20 m without aerial frames**, to keep the download near 10 MB.
- **The Open Graph image is static** (`public/og.png`).

## What would make adding a backend harder (and mitigations)

- **Images are stored as encoded Blobs keyed by scene.** A server would want object storage (S3/R2) with the same keys. `Storage.putImage/getImage` already isolates this.
- **The engine assumes a single writer per area** (the worker queue). A server needs a per-area job lock (for example a Postgres advisory lock or a queue with a unique key).
- **Planetary Computer SAS tokens are fetched anonymously**, which is fine server-side too, but at volume Microsoft may expect a subscription key.
- **IDs are client-generated UUIDs.** Sync between browser and server needs ownership plus conflict rules, since areas can be edited on both sides.
- **AI tools read from the in-browser `ProjectData`.** A hosted AI provider needs the same tool host, backed by server storage. The `ChatProvider` and `ToolHost` interfaces are already separate.

## What a backend needs for each paid feature

| Feature | Backend work |
|---|---|
| **Scheduled server-side tracking** | A Node worker that runs `syncArea()` from `src/core/engine.ts` on a schedule (every 1–3 days per area, plus a STAC "new item" check). Postgres implementation of `Storage` (areas, scenes, events, rasters as bytea or object storage) and an S3/R2 `ImageEncoder` target using sharp. A job queue with per-area locking and retry. |
| **Email/SMS/webhook alerts** | After each sync: `detectEvents()` → `newSince(events, lastDeliveredDate)` → `shouldNotify(e, subscriber)` → `toAlert(e, area, baseUrl)` → `NotificationChannel.send()`. Implement channels with SES/Postmark (email), Twilio (SMS) and signed POST (webhook). Store subscribers, cursors and delivery logs. The deep link format `#area=…&date=…` is already handled by the app. |
| **Built-in AI (no key)** | A server-side `ChatProvider` holding the API key, rate-limited per user and metered against entitlements. Reuse `runAgent`, `TOOLS` and `describeProject` with a server `ToolHost` reading from server storage. |
| **More and larger areas** | Raise `LIMITS.pro` in entitlements. For large areas: process tiles in parallel server-side, use coarser grids (`resolutionFor`) or COG overviews, and serve results as tiles instead of single images. |
| **On-demand high-res imagery** | Implement `OnDemandImageryProvider` (`src/core/highres.ts`) server-side against an aggregator (SkyFi/UP42) or providers (Planet, Maxar, Airbus). Add payments (Stripe), order tracking, licence storage, and delivery of COGs into the area's storage. Display via the existing NAIP-style "aerial" path (own grid, `readSamplesToGrid`). |
| **Accounts & sync** | Auth (e.g. email magic link or OAuth), mapping of client UUIDs to owners, an upload path from IndexedDB to server (the `.satlapse` project file is a ready-made transfer format), and entitlement lookup to replace `currentTier`. |

## Next steps

1. **Before launch:** connect Vercel (see README), set the waitlist URL if you want the button, test each AI provider with a real low-limit key, and replace `public/og.png` with a branded image if desired.
2. **Phase 4 feasibility** (Sentinel-1 RTC, VIIRS, FIRMS with an optional user key, Sentinel-5P), then build the feasible ones as toggleable layers.
3. **Seasonal pixel composites:** low-res per-month reference rasters, so change overlays can say "vs same season last year".
4. **Storage management:** usage meter, quota warning, per-area purge of old imagery, and a "reprocess" action.
5. **More free sources** via the registry: HLS, MODIS, Copernicus DEM hillshade, ESA WorldCover and JRC surface water as context layers.
6. **End-to-end tests** (Playwright) for draw → backfill → replay → export.

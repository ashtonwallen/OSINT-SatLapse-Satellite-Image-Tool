# SatLapse plan (revised after the scope update)

Status as of 2026-10-06: **Phase 1 done** (see SPIKE.md). **Phase 2 done; stopped at Checkpoint 2.** Phases 3 and 4 below include the scope update.

---

## Where things stand (Phase 2 deliverables)

All of these were verified in a real browser.

| Requirement | Status |
|---|---|
| Search a place, pan, draw a polygon or rectangle, name it | ✅ Photon geocoder behind a `Geocoder` interface. Polygon and rectangle drawing with a live km² readout. |
| Max area (default 100 km², configurable) with a clear explanation | ✅ Set by `VITE_MAX_AREA_KM2`. Oversized areas are blocked with an explanation of why. |
| Backfill on creation: history depth, sampling, SCL-based polygon cloud filter | ✅ Merged catalogue (Earth Search C1, then legacy, then PC) → SCL-only screening → sampling → full processing. 1 year, monthly, 5.8 km²: **27 s** in the browser. |
| Progress shown while the UI stays usable | ✅ Engine runs in a Web Worker with phase and progress messages, plus cancel. Interrupted backfills resume on next open. |
| True colour, NDVI, NDWI, NDBI, change vs previous and vs baseline, per-scene stats | ✅ Computed in `src/core/products.ts`, stored as WebP (imagery) and PNG (change overlays). |
| Persist in IndexedDB | ✅ `src/storage/idb.ts` implements the `Storage` interface (`src/core/storage.ts`). |
| Track: check for newer scenes on open, "new imagery" badge | ✅ Verified by deleting scenes and reopening: they were re-found, processed, badged, and the badge cleared when the area was opened. |
| Basic replay with scrubber | ✅ Play/pause, speed, scrubber, view toggle, change overlay drawn on the map. |

Bugs found and fixed during Phase 2:
- **Legacy Earth Search double offset.** Earth Search's legacy collection sets `earthsearch:boa_offset_applied: true` on baseline ≥04.00 items but still advertises `offset: -0.1`. Applying both made 2022 water vanish. Now all three sources agree to 4 decimal places on the same date, and a unit test covers it.
- MapLibre 6 needed its worker URL set explicitly under Vite.
- The "new imagery" badge didn't clear when an area was opened.

Known weaknesses that Phase 3 addresses:
- Change events are far too noisy. Lake Oroville produced dozens of "probably seasonal" events. This is exactly what the new seasonal-aware detection requirement fixes (§3b).
- "Built-up" is really "built-up & bare ground". Desert soil and fallow fields are spectrally similar to concrete at 10 m. The UI says so, and the methodology page will explain it.
- The example project is not bundled yet. The first full-history run produced 44 MB, which is too big. It will be regenerated at 20 m after §3b (§3h).

Measured full-history backfill, under Node with the same engine code: Lake Oroville, 89 km², 2015→2026, best per quarter. 652 candidate acquisitions were screened and 44 processed, in **3.5 min and 1.2 GB downloaded**. Nearly all of the bytes come from full-scene processing, because Earth Search's 1024 px COG tiles mean an 89 km² area touches 4–9 tiles per band.

---

## How the scope update maps onto existing work

I followed the instruction to change as little as possible. Each item is classified as *new* (nothing to change), *extend* (additive), or *conflict* (existing code must change), with the proposed least-disruptive fix.

### 1. Rename: SatLapse at satlapse.ashtonwilliamallen.com (no conflict)
The name was already SatLapse. `siteUrl` in `src/config/brand.ts` now points to `satlapse.ashtonwilliamallen.com`. `BRAND.repoUrl` points to the GitHub repo. Page titles and Open Graph tags will be generated from `BRAND` at build time, so `brand.ts` remains the only file to edit.

### 2. Investigations as the top-level object (conflict: storage schema)
Today `Area` is top-level in IndexedDB (schema v1).
**Fix:** bump to schema v2 and DB version 2.
- Add an `investigations` store: `{id, schemaVersion, name, notesMarkdown, ai: {provider, model}, createdAt, updatedAt}`.
- Add an `annotations` store: `{id, investigationId, areaId, lngLat, sceneDate, text, author: 'user' | 'ai-approved', createdAt}`.
- Add `investigationId` to `Area`.
- The `onupgradeneeded` migration creates one default investigation ("My investigation") and moves every existing area into it. Data is never rewritten.
- The engine is unaffected because it works per area.
- The event log is a derived view: change events (per area) merged with annotations, sorted by date. Nothing new needs storing beyond annotations.
- Export, import and share links move to the investigation level, while still reading v1 files and links (see §6).

### 3. Seasonal-aware change detection (conflict: replaces `src/core/events.ts`)
The current detector compares each scene only with the previous one and labels repeats as "recurring". The replacement is a pure, deterministic module, `src/core/detect/`, with no browser APIs. Its input is plain data (scene stats and optional seasonal-reference stats) and its output is `ChangeEvent[]`, so it can run unchanged on a server.

- **Seasonal reference.** For each scene, collect prior-year scenes within ±30 days of the same day-of-year. Then:
  - **With ≥2 prior years available:** compute the median and the robust spread (MAD) of each land-cover share. Flag an event when the scene departs from that seasonal norm *and* the departure persists into the next scene (when one exists). Confidence is **high** with ≥3 years, **medium** with 2.
  - **Otherwise:** fall back to previous-scene comparison (today's logic). Confidence is **low**.
- **Pixel-level localisation.** I'll keep a low-resolution (40 m) per-month-of-year reference composite: a running mean of the quantized indices. That costs about 6 MB per 100 km² area and lets the event's change mask be computed against the same season too, not only against the previous scene. Areas processed before this change have no composites yet, so their events use the stats-level reference only and say so. A "Reprocess" button rebuilds them.
- `ChangeEvent` gains `confidence: 'high' | 'medium' | 'low'`, `method: 'seasonal' | 'previous'`, `reference: {dates, years}`, and sensor/source provenance. It stays a plain JSON object, which is also the payload the notification interface (§9) consumes.

### 4. Landsat Collection 2 L2, 1984→ (extend; the sensor abstraction is a mild conflict)
Quick probe done today, full write-up to follow in SPIKE.md:
- **Earth Search Landsat is not usable from a browser.** Its assets are `s3://usgs-landsat/...`, a requester-pays bucket.
- **Planetary Computer `landsat-c2-l2` works.** It has STAC with CORS, SAS-signed Azure COGs with Range and CORS, and coverage back to Landsat 4 (1982).

Current code assumes Sentinel-2 band names and the SCL cloud mask. **Fix:**
- Add `sensor` to `SceneRef` (`S2A/B/C`, `L4/5/7/8/9`), with a per-sensor band map and cloud mask. Landsat uses `QA_PIXEL` bits (cloud, shadow, cirrus, fill) instead of SCL.
- Landsat pixels (30 m) are resampled onto the area's existing grid, so per-pixel change still lines up. The UI labels Landsat frames "Landsat 5 · 30 m".
- Landsat is used where Sentinel-2 isn't available (before mid-2015), plus an optional "fill gaps" setting.
- **Harmonisation:** published cross-sensor coefficients (Roy et al. 2016 for ETM+/TM→OLI, and the HLS Sentinel-2→Landsat bandpass adjustments) bring indices onto one scale.
- **Landsat 7 SLC-off stripes** (from 2003) are masked as nodata.
- **Limits** go on /methodology: 30 m vs 10 m, fewer clear scenes in the 1980s–90s, residual cross-sensor bias.

### 5. Multi-provider AI with full investigation context (new, not built yet)
`src/ai/` will have one `ChatProvider` interface:
```ts
interface ChatProvider {
  id: 'anthropic' | 'openai' | 'gemini' | 'openrouter' | 'ollama'
  listModels?(): Promise<string[]>
  chat(req: { system: string; messages: ChatMessage[]; tools: ToolDef[]; signal?: AbortSignal; onText?(delta: string): void }): Promise<ChatTurn>
}
```
- Tool calls are normalized across providers, and each adapter translates images into its provider's format. Anthropic uses the official SDK in browser mode (`dangerouslyAllowBrowser`, which sends the direct-browser-access header) and is lazy-loaded.
- **Tools:**
  - `get_stats(areaId, from, to)`
  - `get_scene_image(areaId, date, view)`
  - `list_events(areaId?, kind?, from?, to?)`
  - `list_annotations()`
  - `draft_annotation(areaId, lngLat, date, text)`
  - `draft_report_section(title, markdown)`
- **Draft tools never write.** They create pending drafts that the user accepts or discards in the UI.
- **Context:** the system prompt carries investigation metadata, notes, a compact per-area time-series table, events and annotations. Images are only fetched through tool calls.
- **Provider and model** are chosen per investigation and stored on the investigation.
- **Keys:** in memory by default. Persisting to `localStorage` is opt-in, with a warning.
- **"Copy to AI"** builds the same context as a paste-ready prompt. The bundle download adds 3–6 key images (baseline, latest, largest-change dates) with attribution burned in.
- **Browser access to Gemini and OpenRouter** is expected to work (both document browser use) but gets verified first. If either fails, it's documented and dropped rather than proxied.

### 6. Reports and portability at the investigation level (extend)
- **Project file v2** (`.satlapse` zip) holds the investigation, its notes, annotations and N areas with their images and rasters. Importing a **v1** single-area file creates a new investigation around it.
- **Share links v2** use the URL fragment `#i=` to carry the investigation name plus each area's polygon and name. Old `#share=` v1 links still decode. As before, no imagery and no notes are included.
- **HTML report:** a self-contained single file with images inlined as data URIs. Every finding cites the scene date and source (catalogue and item ID). Copernicus attribution is included, plus USGS for Landsat.
- **PDF:** the same report, rendered with print CSS and saved through the browser's "Save as PDF". This adds no dependency and works offline, but it does need one click in the print dialog. A 300 KB PDF library would be the alternative; I'd rather not add it unless you want one-click PDF downloads.

### 7. Phase 4 data layers (new; each starts with a feasibility check)
The quick notes below are hypotheses to verify, not conclusions:
- **Sentinel-1 RTC/GRD:** PC hosts `sentinel-1-rtc` and `sentinel-1-grd` with SAS tokens, so this is likely feasible. A radar change view would use the log-ratio of VV backscatter.
- **VIIRS nighttime lights:** NASA's Black Marble downloads need an Earthdata login token. Monthly composites may only exist behind a key, so this might get skipped with the reason documented.
- **NASA FIRMS:** needs a free MAP_KEY. It will be an optional user-supplied key, stored like the AI keys.
- **Sentinel-5P NO₂:** PC has L2 NetCDF; parsing it in-browser needs an HDF5/WASM reader. Feasible but heavy, and it would be clearly labelled as a regional, roughly 5 km product.

### 8. Paid-tier preparation (new; interfaces only, no backend)
- `BRAND.alertsWaitlistUrl`: the "Get alerts for this area" button opens an explanation and an external link. It's hidden when the URL is empty and sends no data.
- `src/config/entitlements.ts`: `can(feature)` returns `true` for every feature today, from a single feature table.
- `src/core/alerts.ts`: a `NotificationChannel` interface (email, SMS, webhook) that consumes `ChangeEvent`. No implementations.
- `src/core/highres.ts`: an `OnDemandImageryProvider` interface (quote, order, status, fetch). No implementations.
- HANDOFF.md will spell out what a backend needs for each paid feature: scheduled `syncArea` in a Node worker with a Postgres/S3 `Storage` implementation, the detection module feeding notification channels, server-held AI keys behind the same `ChatProvider` interface, quotas from entitlements, and the high-res provider.

---

## Data source strategy (standing goal)

Goal: connect as many **free** sources as possible now, and add **paid** sources later through premium tiers. Rather than one-off integrations, every source goes through a single registry:

```ts
interface DataSource {
  id: string; label: string; kind: 'optical' | 'radar' | 'thermal' | 'night-lights' | 'fire' | 'atmosphere' | 'landcover' | 'elevation'
  tier: 'free' | 'paid'            // gated through entitlements
  requiresKey: boolean             // user-supplied key (e.g. FIRMS) vs key-free
  resolutionM: number; coverage: { start: string; end?: string; region: 'global' | string }
  browserAccess: 'verified' | 'unverified' | 'server-only'
}
```

The existing STAC sources (Earth Search C1, Earth Search legacy, Planetary Computer) become the first entries. Each new source gets a feasibility line in SPIKE.md before it's built.

**Free candidates to evaluate.** Most are on Planetary Computer, which is already proven to work from the browser.
- **Optical**
  - Landsat C2 L2, 1982→ (verified; Phase 3d)
  - HLS (harmonized Landsat + Sentinel-2)
  - NAIP 0.6–1 m aerial imagery (US only)
  - MODIS daily reflectance and vegetation indices
- **Radar:** Sentinel-1 RTC and GRD.
- **Thermal and fire:** Landsat surface temperature, MODIS/VIIRS active fire, FIRMS (user's free key).
- **Night lights:** VIIRS, if available without a key.
- **Atmosphere:** Sentinel-5P NO₂, CO and aerosol.
- **Context layers**
  - ESA WorldCover and the Esri/IO 10 m land-cover time series
  - JRC Global Surface Water
  - Copernicus DEM 30 m for hillshade and terrain
  - Microsoft building footprints
  - Open Buildings

**Paid candidates for premium tiers** (interfaces only for now; the `OnDemandImageryProvider` stub in §8 is the hook):
- **High-resolution optical:** Planet, Maxar/Vantor, Airbus, Satellogic, BlackSky.
- **SAR:** Umbra, Capella, ICEYE.
- **Aggregators:** SkyFi, UP42. One aggregator would give access to many providers through a single integration.

## Revised phase plan

**Phase 3: full feature build** (ordered by dependencies)

- **3a. Schema v2:** investigations, the v1 migration, a notes editor (Markdown), annotations pinned to a location and scene date, and a unified timeline of events plus annotations.
- **3b. Seasonal-aware detection:** pure module, confidence levels, monthly reference composites, unit tests with synthetic seasonal series, and confidence shown in the UI.
- **3c. Replay and visualization:**
  - Player with speed control.
  - Synced chart (vegetation, water, built & bare) with event markers.
  - Before/after slider for any two dates.
  - GIF and MP4 export with attribution burned in.
- **3d. Landsat:**
  - Spike section in SPIKE.md.
  - Sensor abstraction and QA_PIXEL masking.
  - Harmonisation, with a sensor and resolution badge on each frame.
- **3e. AI:**
  - "Copy to AI" and the image bundle.
  - Provider interface with Anthropic, OpenAI, Gemini, OpenRouter and Ollama (plus `OLLAMA_ORIGINS` docs).
  - Tools, a draft-approval UI, and key handling.
- **3f. Portability:** project file v2, share links v2, HTML report, PDF via print.
- **3g. Security and paid prep:**
  - Strict CSP generated from one host list and emitted as a meta tag, `_headers` and `vercel.json`.
  - A /security page.
  - Waitlist button, entitlements, notification and high-res interfaces.
- **3h. Polish:**
  - Regenerated example (Lake Oroville at 20 m, target ≤10 MB), "Try an example".
  - /methodology covering investigations, seasonal detection and confidence, multi-sensor history, and limits.
  - Open Graph image and metadata.
  - Dark responsive pass.
  - README with screenshots and GIF, CONTRIBUTING.md, HANDOFF.md.

→ **Checkpoint 3**

**Phase 4: data layers.** Run the feasibility check for each layer and document it in SPIKE.md. Build the feasible ones as toggleable layers, and skip any that need a server, documenting why.
→ **Checkpoint 4**

## Decisions I need from you (none of them block Phase 3)
1. ~~GitHub repo URL~~: done, `ashtonwallen/OSINT-SatLapse-Satellite-Image-Tool`.
2. PDF export: browser print-to-PDF (proposed, no dependency) or a one-click PDF library (~300 KB, loaded on demand)?
3. The alerts waitlist form URL. The button stays hidden until it's set.

# Phase 1 feasibility spike

**Verdict: feasible with no backend.** Both imagery sources (Element84 Earth Search and Microsoft Planetary Computer) work directly from the browser. STAC search, HTTP range reads of the Sentinel-2 COGs, decoding, and true-colour/NDVI rendering all run client-side in a Web Worker. A 100 km² area takes about 2–6 s per scene end to end. No API keys or proxies are needed.

Run it yourself: `npm install && npm run dev`, then open `/spike.html` and click **Run full matrix**.
Headless/Node version of the same pipeline: `npx jiti scripts/spike-node.ts -115.52 32.9 100 earth-search-c1 out/`.

Tested 2026-10-06 from Chrome (the Claude desktop browser pane) and Node 22, on a residential connection on the US West Coast.

## 1. CORS

Checked two ways: with curl, sending an `Origin` header and an `OPTIONS` preflight, and with real `fetch`/geotiff.js requests from a page served on `http://localhost:5191`, where the browser enforces CORS.

| Endpoint | Purpose | Preflight | Result |
|---|---|---|---|
| `earth-search.aws.element84.com/v1/search` | STAC search (POST JSON) | `Allow-Origin: *`, allows `Content-Type` | ✅ works from browser |
| `sentinel-cogs.s3.us-west-2.amazonaws.com` | Earth Search legacy L2A COGs | `Allow-Origin: *`, allows `Range` header | ✅ |
| `e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com` | Earth Search Collection 1 COGs | `Allow-Origin: *`, allows `Range` | ✅ |
| `planetarycomputer.microsoft.com/api/stac/v1/search` | STAC search | `Allow-Origin: *` | ✅ |
| `planetarycomputer.microsoft.com/api/sas/v1/token/sentinel-2-l2a` | Anonymous SAS token for blobs | `Allow-Origin: *` | ✅ (no account or key) |
| `sentinel2l2a01.blob.core.windows.net` | PC COGs (SAS-signed) | Echoes origin, allows `Range` | ✅ |

Caveat: Azure blob storage does **not** list `Content-Range` in `Access-Control-Expose-Headers`. geotiff.js copes with this. Range reads still worked because the reader doesn't need the total file size. It is still worth knowing if we ever write a custom range client.

## 2. Timing per scene

Pipeline steps:
1. STAC search, last 180 days, scene cloud ≤10%.
2. Open 6 COG headers in parallel.
3. Windowed reads of B02, B03, B04, B08 (10 m) and B11, SCL (20 m, nearest-neighbour resampled to the 10 m grid).
4. Polygon rasterization, SCL cloud stats, true colour, NDVI.

Areas are squares centred on Imperial Valley, CA (farmland) and Lake Mead, NV (water and desert). Each cell shows the first run, then the second.

| Source | Area | Pixels | Search | COG headers | Band reads (wall) | Processing | **Total** | Requests | Downloaded |
|---|---|---|---|---|---|---|---|---|---|
| Earth Search C1 | 10 km² | 324×322 | 0.7–0.9 s | 0.6 s | 1.8–2.6 s | 0.04 s | **2.7 / 3.3 s** | 30 / 48 | 6.3 / 10.1 MB |
| Earth Search C1 | 100 km² | 1016×1018 | 0.3–0.5 s | 0.3 s | 1.5–2.3 s | 0.3 s | **3.1 / 2.1 s** | 84 / 48 | 24.8 / 10.1 MB |
| Earth Search legacy | 10 km² | 324×322 | 0.7–1.0 s | 1.2 s | 2.2–2.7 s | 0.04 s | **3.2 / 3.4 s** | 43 / 54 | 7.4 / 11.6 MB |
| Earth Search legacy | 100 km² | 1016×1018 | 0.2–0.4 s | 1.2 s | 1.9–2.4 s | 0.3 s | **3.2 / 2.4 s** | 76 / 54 | 29.3 / 11.6 MB |
| Planetary Computer | 10 km² | 324×322 | 1.1 s | 0.3–0.8 s | 1.1–2.4 s | 0.03 s | **3.5 / 2.2 s** | 36 / 42 | 2.4 / 2.9 MB |
| Planetary Computer | 100 km² | 1016×1018 | 0.6 s | 0.3 s | 2.6–5.2 s | 0.3 s | **6.1 / 3.5 s** | 144 / 96 | 18.6 / 8.2 MB |

Notes:
- "Band reads (wall)" includes the header time. All 6 bands are fetched concurrently.
- Processing for 1 M pixels (rasterize, SCL stats, two renders) takes about 0.3 s in a worker. CPU is not the bottleneck; network is.
- Node runs of the same code were similar: 3.9–5.2 s for 100 km² including search.
- **Bytes depend on the COG's internal tiling more than on area.** Earth Search 10 m bands use 1024×1024 internal tiles (about 10 km on a side), while Planetary Computer uses 512×512. A 10 km² window that crosses tile boundaries can fetch the same 2×2 block of tiles as a 100 km² window. That is why the Lake Mead runs on Earth Search show identical request and byte counts for both sizes. PC downloads 2–4× less for small areas. All files are DEFLATE-compressed and have 4 overview levels, which could be used for previews or larger areas later.
- Downloads include whole compressed tiles plus header blocks, so they are much larger than the raw pixel payload (about 1 MB of uint16 data for 10 km² across 6 bands).

### What this implies for backfill (estimate, not measured yet)

A 100 km² area with "all available" history means roughly 70–150 acquisitions a year for about 10 years, so 700–1,500 candidate scenes. At 2–4 s and 10–30 MB per full scene, fetching everything would take about an hour and 10+ GB. Phase 2 should therefore:
1. **Check SCL first.** Read only the 20 m SCL band (one file, 512 px tiles), compute cloud % over the polygon, and fetch the other five bands only for usable scenes. This also implements "filter by cloud over the polygon, not scene metadata".
2. **Pre-filter with scene metadata leniently** (e.g. scene cloud ≤ 80%) to skip hopeless scenes cheaply. Only the polygon-level SCL check is authoritative.
3. **Apply the sampling choice before the band reads.** Choosing "best per month" means about 12 full scene reads a year instead of about 100.
4. Run 3–4 scenes concurrently. Browsers cap at about 6 connections per host on HTTP/1.1, but S3 and Azure both use HTTP/2, so the real limit will be bandwidth.

Rough target: "best per month, all history" for 100 km² should take a few minutes and download a few hundred MB.

## 3. Correctness checks

- **Reflectance offsets.** Earth Search publishes `raster:bands[].offset/scale` in STAC (`-0.1 / 0.0001` for processing baseline ≥ 04.00), and we use it. PC serves raw DNs, so we apply the `-1000` DN `BOA_ADD_OFFSET` when `s2:processing_baseline >= 04.00`. Check: over the same farmland, median red reflectance was **0.176** from Earth Search C1 (Oct 3) and **0.175** from PC (Oct 1), so the two sources agree.
- **Visual check.** True-colour and NDVI PNGs were rendered for both sites and inspected. Colours are natural, NDVI follows field boundaries, and water shows as water.
- **Pixel grid.** The output grid is snapped to 20 m multiples in the area's UTM zone, so 10 m and 20 m bands align exactly. Every scene of an area lands on identical pixels, which is required for per-pixel change detection.

## 4. Findings that shape Phase 2

1. **Catalogue completeness differs a lot.** Scenes per year over Imperial Valley:

   | Year | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
   |---|---|---|---|---|---|---|---|---|---|---|---|
   | Earth Search C1 | 0 | 1 | 18 | 59 | 73 | 73 | **7** | 71 | 64 | 73 | 69 |
   | Earth Search legacy | 0 | 49 | 85 | 135* | 147* | 161* | 72 | 71 | 65 | 73 | 69 |
   | Planetary Computer | 48 | 47 | 69 | 72 | 71 | 66 | 95 | 118 | 59 | 73 | 66 |

   \* About half are duplicates: reprocessed `_0_` and `_1_` items for the same date and tile.

   **Decision:** treat "Element84 first, PC second" as a **merged catalogue**, not a fallback. Query Earth Search C1, then Earth Search legacy, then PC. Deduplicate by acquisition date + MGRS tile and prefer the earlier sources. PC fills the gaps (2016 and most of 2022). Each `SceneRef` already carries its source and band offsets, so mixing sources works.
2. **Areas often straddle MGRS tiles.** The Lake Mead square ran off the north edge of tile 11SPV, leaving 1.5% of the polygon as nodata. The STAC item `bbox` is a lon/lat envelope of a tilted UTM square, so a bbox check can pass when the tile doesn't fully cover the area. Phase 2 must **mosaic all same-day tiles** onto the area's grid, filling nodata from each one in turn. The reader already returns `0` outside a file's extent, so this is a simple merge.
3. **UTM zone edges.** Every scene is read in the area's own UTM zone. Tiles from a neighbouring zone are skipped instead of reprojected. Sentinel-2 tiles from each zone extend past the zone boundary, so in practice an area under 100 km² is covered by same-zone tiles. Reprojection only becomes necessary for much larger areas, such as a future paid tier.
4. **Slight rotation.** A lon/lat square appears slightly rotated on the UTM grid (meridian convergence). This is cosmetic. Rendered images are north-up in UTM, which is the right choice for an analytical product.
5. **Planetary Computer tokens** are anonymous and last about an hour. They're cached in memory and refreshed 5 minutes before expiry.
6. **CSP hosts needed** (for Phase 3):
   - `earth-search.aws.element84.com`
   - `sentinel-cogs.s3.us-west-2.amazonaws.com`
   - `e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com`
   - `planetarycomputer.microsoft.com`
   - `*.blob.core.windows.net` (in practice `sentinel2l2a01.blob.core.windows.net`)

## 5. Code produced (kept, not throwaway)

- `src/core/geo.ts`: area, UTM selection, projection (proj4), snapped grids, polygon rasterization.
- `src/core/stac.ts`: multi-source STAC search with pagination, normalization to `SceneRef`, PC SAS signing.
- `src/core/cog.ts`: windowed, resampled band reads onto a grid (geotiff.js).
- `src/core/scene.ts`: band loading, reflectance conversion, SCL classification, cloud/coverage stats, normalized difference, true-colour and colour-ramp renderers (raw RGBA, no DOM).
- `src/core/attribution.ts`: Copernicus attribution string.
- `src/spike/*`: the spike page and its worker.
- `scripts/spike-node.ts`: the same pipeline under Node, which proves `src/core` has no browser dependencies.

## 6. Decisions made along the way

- geotiff.js 3, proj4 for projection, Vite 8, React 19, TypeScript 7, Tailwind 4.
- All pixel work happens in a Web Worker from the start. The spike already uses one.
- Fixed tone mapping for true colour (gain 3.2, gamma 1/1.25) rather than per-image stretch, so brightness is comparable across dates in a timelapse.
- Scene-level cloud cover is only a pre-filter. Polygon cloud % comes from SCL classes 3, 8, 9 and 10 (cloud shadow, medium/high-probability cloud, thin cirrus). Classes 0 and 1 count as nodata.

---

## Addendum (Phase 2): measured backfill and a correction

**Backfill performance (same engine code in the browser worker and under Node):**

| Area | History / sampling | Candidates screened | Processed | Time | Downloaded |
|---|---|---|---|---|---|
| Imperial Valley, 5.8 km² (browser) | 1 year / monthly | 83 | 13 | 27 s | n/a |
| Imperial Valley, 12.5 km² (Node) | 1 year / monthly | 83 | 13 | 21 s | 85 MB |
| Lake Oroville, 89 km² (Node) | 2015→2026 / quarterly | 652 | 44 | 3.5 min | 1.2 GB |

Screening with SCL alone is cheap: 83 scenes cost about 1 MB and 11 s. Full processing dominates, at 6–28 MB per scene depending on how many 1024 px COG tiles the area touches.

**Correction to §3 (reflectance offsets).** Legacy Earth Search items (`sentinel-2-l2a`) from processing baseline 04.00 onward carry `earthsearch:boa_offset_applied: true`. Their pixels already have the +1000 DN offset removed, yet `raster:bands` still says `offset: -0.1`. Honouring both subtracts the offset twice, which pushed water reflectance negative and made Lake Oroville's water "disappear" in 2022. Fixed in `src/core/stac.ts`. After the fix, all three sources agree on the same acquisition (green 0.0550 / NIR 0.0367 on 2023-07-03), and a unit test covers it.

**Landsat (quick probe; the full spike follows in Phase 3d).** Earth Search's `landsat-c2-l2` assets point at `s3://usgs-landsat` (requester-pays), so a browser can't read them. Planetary Computer's `landsat-c2-l2` works: STAC with CORS, SAS-signed `landsateuwest.blob.core.windows.net` COGs with Range and CORS, and history back to Landsat 4 (1982).

## Addendum (Phase 3.1): NAIP high-resolution aerial imagery

**Access:** Planetary Computer STAC `naip` collection with SAS-signed blobs on `naipeuwest.blob.core.windows.net`. STAC and blob storage both send CORS headers and accept Range requests; no key needed. US only. The archive goes back to roughly 2010, flown every 2–3 years per state, at 1 m (to ~2015), then 0.6 m, and 0.3 m in some recent states.

**Approach:**
- NAIP frames get their own grid in the area's UTM zone, at native resolution, capped at 4096 px per side (a 100 km² area renders at ~2.5 m).
- The reader picks the coarsest COG overview that's still at least as fine as that grid. Without this, downsampled frames would download up to ~70× more data than needed.
- NAD83/UTM and WGS84/UTM are treated as the same CRS (~1–2 m apart in CONUS).
- Quads in a different UTM zone from the area are skipped.

**Measured:**
- **Small area (0.2 km², ~2 km context window):** 6 years (2012–2022) at 1 m and 0.6 m. Each frame is 2000–3335 px across and 0.3–0.9 MB stored as WebP.
- **30 km² area (in the browser):** 6 years, rendered at 1.4 m because of the size cap.

**Limits:**
- Uncalibrated 8-bit values, so NAIP gets no land-cover stats and isn't part of change detection.
- Low frequency (every 2–3 years).
- Contiguous US only.

## Addendum (Phase 3.5): Landsat Collection 2 Level-2

**Browser access, verified from the app:**
- Earth Search's `landsat-c2-l2` items point at `s3://usgs-landsat` (requester-pays), which a browser can't read.
- Planetary Computer's `landsat-c2-l2` works: STAC with CORS, plus SAS-signed `landsateuwest.blob.core.windows.net` COGs with Range and CORS. Coverage runs from Landsat 4 (1982) through 9.

**Integration:**
- Asset keys are shared across TM, ETM+ and OLI (`blue`, `green`, `red`, `nir08`, `swir16`, `qa_pixel`), so one normalizer handles every Landsat mission.
- QA_PIXEL bits (fill, dilated cloud, cirrus, cloud, shadow, snow, water) are converted to SCL-equivalent classes. Screening, masking and stats then run unchanged.
- **Southern hemisphere:** USGS uses northern-zone codes everywhere (EPSG:326zz with negative northings), while area grids use EPSG:327zz there. Grids are translated by the 10,000 km false northing instead of skipping those scenes.
- **Resolution:** 30 m pixels are resampled (nearest neighbour) onto the area's 10 m grid. Each frame is labelled "Landsat N · 30 m".
- **Date range:** Landsat is used up to the first Sentinel-2 acquisition (cut-off 2015-06-27), via the "Since 1984" history option.
- **Landsat 7 stripes:** after May 2003, Landsat 7's broken scan-line corrector leaves striped gaps in the data. Those scenes fall below the 90% coverage threshold and are rejected automatically, so in practice the record leans on Landsat 5 (to 2011–13) and Landsat 8.

**Harmonisation:** TM/ETM+ values are converted to the OLI scale with the **surface-reflectance** OLS coefficients from Roy et al. (2016), Table 2. OLI is then treated as equivalent to Sentinel-2 MSI; HLS bandpass differences are about 2–3%.

**Bug caught by visual check:** the first version used the same paper's *top-of-atmosphere* coefficients, whose NIR intercept of +0.041 made open water read as 0–1% in the Landsat 5 and 7 years. The fix changes Lake Oroville's water share from 1% → 52% (1990, Landsat 5) and 0% → 36% (January 2014, Landsat 7). Landsat 8 (unharmonised) reads 47% in April 2014. These are consistent with each other and with the imagery. A unit test now asserts that dark water keeps a positive NDWI after harmonisation.

**Cost, measured:** an 11.5 km² area, best-per-quarter, 1982–2026:
- 1,550 candidate acquisitions screened, 168 processed.
- 10 min and ~1 GB in Node, with similar cost expected in the browser.

The form warns about this and recommends quarterly sampling for this range.

## Addendum (Phase 3.8): two data-quality corrections found while building the example

Both were caught by **looking at rendered frames**, not by tests.

**1. Legacy Earth Search offset rule, corrected again.** The Phase 2 fix zeroed the offset only when `earthsearch:boa_offset_applied` was `true`. Lake Oroville's 13 July 2022 frame (flag `false`) still rendered nearly black and read 4% water. Raw DN comparison with Planetary Computer for the same acquisitions:

| Date | Legacy flag | Legacy green DN (median) | PC green DN (median) |
|---|---|---|---|
| 2022-04-24 | `true` | 395 | 1,400 |
| 2022-07-13 | `false` | 504 | 1,512 |

In both cases the legacy pixels have the +1000 offset already removed. The flag is unreliable. **Rule now: legacy-collection pixels never get the offset** (Collection 1 and PC still do, per their metadata). A unit test covers both flag values.

**2. Wildfire smoke passes the cloud mask.** The 1 October 2020 frame is uniformly hazed by the 2020 California fire smoke. SCL classified it as 0% cloud, and it produced a false "45 km² vegetation loss, high confidence" event. The L2A aerosol band doesn't separate it either: AOT was 0.24 under smoke versus 0.11–0.16 on clear dates, because the retrieval saturates. The blue/red reflectance ratio over clear vegetation and soil does:

| Date | Conditions | Blue/red (median, land) |
|---|---|---|
| 2020-07-03, 2020-10-16, 2021–2024 summers | clear | 0.49–0.64 |
| 2020-09-26 | smoke | 0.88 |
| 2020-10-01 | heavy smoke | 1.08 |

Scenes far above **their area's own** median ratio (more than max(0.15, 4×MAD) above it) are labelled "possible smoke or haze" and excluded from flagged changes and seasonal baselines. They still appear in the timeline.

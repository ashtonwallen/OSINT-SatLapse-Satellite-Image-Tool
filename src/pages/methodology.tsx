import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { BRAND } from '../config/brand'
import { DATA_SOURCES } from '../core/sources'
import { METRIC_RULES, SEASON_DAYS, Z_MIN } from '../core/detect'
import { THRESHOLDS } from '../core/products'
import { H2, PageLayout, code } from './PageLayout'

const TOC = [
  ['overview', 'How it works'], ['sentinel-2', 'Sentinel-2'], ['landsat', 'Landsat (1984→)'], ['naip', 'High-res aerial (NAIP)'],
  ['clouds', 'Cloud masking'], ['indices', 'Spectral indices & land cover'], ['change', 'Change detection & confidence'],
  ['projects', 'Projects, notes & annotations'], ['limits', 'Resolution & limits'], ['architecture', 'Browser-only architecture'], ['ai', 'AI analysis'], ['sources', 'Data sources'],
]

function Methodology() {
  return (
    <PageLayout
      title="Methodology"
      intro={<>What {BRAND.name} measures, how, and where it can mislead you. Written for technical readers who aren't remote-sensing specialists.</>}
    >
      <nav className="grid gap-1 text-sm sm:grid-cols-2">{TOC.map(([id, t]) => <a key={id} href={`#${id}`} className="text-neutral-400 hover:text-white">→ {t}</a>)}</nav>

      <section className="space-y-3">
        <H2 id="overview">How it works</H2>
        <p>You draw an area. {BRAND.name} finds every satellite pass over it, keeps the clear ones, processes each into images and land-cover statistics, and compares each date with earlier ones to flag unusual change. It then keeps checking for new passes every time you open the app. All of this runs in your browser.</p>
        <ol>
          <li><b>Search</b> public catalogues (STAC APIs) for scenes intersecting the area.</li>
          <li><b>Screen</b> each date by reading only its small cloud-classification band over your polygon.</li>
          <li><b>Sample</b>: keep every clear scene, or the clearest per month or quarter.</li>
          <li><b>Process</b> the chosen dates: download just the pixels over your area (HTTP range requests into Cloud Optimized GeoTIFFs), mosaic tiles, compute indices, render images.</li>
          <li><b>Detect</b> changes against the same season in earlier years, with a confidence level.</li>
        </ol>
      </section>

      <section className="space-y-3">
        <H2 id="sentinel-2">Sentinel-2 (2015 onwards)</H2>
        <p>The core imagery is ESA's Sentinel-2 Level-2A <i>surface reflectance</i>: atmospherically corrected measurements of how much light the ground reflects in each band. {BRAND.name} uses blue, green, red, near-infrared (10 m pixels) and short-wave infrared (20 m, resampled to 10 m). Satellites 2A, 2B and 2C together revisit most places every 2–5 days.</p>
        <p>The archive is assembled from three catalogues (Element84 Earth Search Collection 1 and legacy, and Microsoft Planetary Computer) because none is complete on its own. Duplicate acquisitions are removed and same-day tiles are stitched together so areas crossing tile edges are complete. Reflectance offsets introduced by ESA in 2022 (processing baseline 04.00) are handled per source; the sources agree to within 0.001 reflectance on the same date.</p>
      </section>

      <section className="space-y-3">
        <H2 id="landsat">Landsat (1984 onwards)</H2>
        <p>With "Since 1984", Landsat 4, 5, 7 and 8 Collection 2 Level-2 surface reflectance fills the years before Sentinel-2. Landsat pixels are 30 m, three times coarser, so older frames look blockier and are labelled with their sensor and resolution.</p>
        <p><b>Harmonisation.</b> Different sensors see slightly different colours. TM and ETM+ values are converted to the Landsat 8 OLI scale with published coefficients (Roy et al., 2016, surface-reflectance set), and OLI is treated as equivalent to Sentinel-2 (differences ~2–3%, as in NASA's Harmonized Landsat Sentinel-2 product). This keeps the charts comparable across the 2015 hand-over, but small steps at sensor changes are still possible, and pixel-level change maps between a 30 m and a 10 m image show some edge noise.</p>
        <p>Landsat 7 images after May 2003 have striped gaps (a hardware failure) and are mostly excluded by the coverage check. The 1980s–90s also have fewer usable images.</p>
      </section>

      <section className="space-y-3">
        <H2 id="naip">High-resolution aerial imagery (NAIP, US only)</H2>
        <p>For the contiguous US, {BRAND.name} also fetches USDA NAIP aerial photographs: 0.3–1 m pixels, flown roughly every 2–3 years per state. These are sharp enough to see buildings, vehicles and individual trees. They're shown as a separate "Aerial" timeline at native resolution (capped at 4096 px per side), and aren't used for automatic statistics because they are uncalibrated 8-bit images. Use them to see <i>what</i> changed and the satellite frames to see <i>when</i>.</p>
      </section>

      <section className="space-y-3">
        <H2 id="clouds">Cloud masking</H2>
        <p>Scene-level cloud figures describe a whole ~110 km tile and are almost useless for a small area. Instead, {BRAND.name} reads each scene's per-pixel classification (Sentinel-2's Scene Classification Layer; Landsat's QA_PIXEL bits) and computes cloud cover <i>over your polygon only</i>. Cloud, cirrus and cloud shadow pixels are masked from every statistic. A scene is used if at least 90% of the polygon was imaged and cloud is below your chosen limit (default 20%).</p>
        <p><b>Smoke and haze.</b> Classification layers often miss smoke (for example the September 2020 California wildfire smoke was classified as clear), and the aerosol estimate saturates in thick smoke. So {BRAND.name} also measures each scene's blue/red brightness ratio over clear vegetation and soil. Haze scatters blue light, pushing the ratio from a typical ~0.5–0.65 to ~0.9–1.1. A scene far above <i>that area's own</i> usual ratio is labelled "possible smoke or haze", kept in the timeline, and excluded from flagged changes and seasonal baselines. Using the area's own history avoids false alarms over naturally grey surfaces like cities.</p>
      </section>

      <section className="space-y-3">
        <H2 id="indices">Spectral indices and land cover</H2>
        <table>
          <thead><tr><th>Index</th><th>Formula</th><th>What it highlights</th></tr></thead>
          <tbody>
            <tr><td>NDVI</td><td><code>(NIR − Red) / (NIR + Red)</code></td><td>Green vegetation (healthy plants reflect strongly in near-infrared)</td></tr>
            <tr><td>NDWI</td><td><code>(Green − NIR) / (Green + NIR)</code></td><td>Open water (water absorbs near-infrared)</td></tr>
            <tr><td>NDBI</td><td><code>(SWIR − NIR) / (SWIR + NIR)</code></td><td>Built-up surfaces and bare ground</td></tr>
          </tbody>
        </table>
        <p>Each clear pixel is classified as <b>water</b> if NDWI &gt; {THRESHOLDS.water}, else <b>vegetation</b> if NDVI &gt; {THRESHOLDS.veg}, else <b>built-up &amp; bare</b> if NDBI &gt; {THRESHOLDS.built} and NDVI &lt; {THRESHOLDS.builtMaxNdvi}. Percentages are shares of clear pixels.</p>
        <p><b>"Built & bare" includes bare soil.</b> At 10 m, dry soil, fallow fields, sand and rock reflect much like concrete, so in deserts and farmland this class mostly measures bare ground. Treat increases as "land became bare or built", then check imagery to tell which.</p>
      </section>

      <section className="space-y-3">
        <H2 id="change">Change detection and confidence</H2>
        <h3>Pixel change maps</h3>
        <p>For every scene, pixels are compared with the previous scene and with the first scene. A pixel is marked as vegetation loss/gain if NDVI changes by ≥ {THRESHOLDS.dNdvi}, water gain/loss if it crosses the water threshold, and new built/bare if it becomes built/bare and NDBI rises by ≥ {THRESHOLDS.dNdbi}. These are the coloured "highlight change" overlays.</p>
        <h3>Flagged changes (seasonal-aware)</h3>
        <p>Comparing with the previous image flags every harvest, snowfall and reservoir cycle. So flagged changes compare each scene with <b>the same time of year in earlier years</b>: scenes within ±{SEASON_DAYS} days of the same date. Each earlier year contributes its median, and a change is flagged when a land-cover share departs from the typical value by at least a minimum amount ({METRIC_RULES.map((r) => `${r.minPts} points for ${r.label.toLowerCase()}`).join(', ')}) <i>and</i> by at least {Z_MIN}× the normal year-to-year spread. Only the start of a departure is flagged, not every scene while it lasts.</p>
        <table>
          <thead><tr><th>Confidence</th><th>Meaning</th></tr></thead>
          <tbody>
            <tr><td>High</td><td>Compared with the same season in 3+ earlier years, and the next image confirms it persisted.</td></tr>
            <tr><td>Medium</td><td>Only 2 earlier years to compare with; or a high-confidence change not yet confirmed by a later image.</td></tr>
            <tr><td>Low</td><td>Fewer than 2 earlier years, so compared with the previous image only (seasonal effects can't be ruled out); or the next image contradicted it (possibly temporary).</td></tr>
          </tbody>
        </table>
        <p>The detector is a pure, deterministic module (<a href={code('src/core/detect.ts')}>src/core/detect.ts</a>) so results are reproducible and the same code can run on a server.</p>
      </section>

      <section className="space-y-3">
        <H2 id="projects">Projects, notes and annotations</H2>
        <p>A project groups one or more areas with free-form Markdown notes and annotations pinned to a location and scene date ("new structure appears here"). Flagged changes from all areas and your annotations appear together on the project timeline. Reports cite the scene date, sensor and catalogue item ID behind every finding so others can retrieve the exact source image.</p>
      </section>

      <section className="space-y-3">
        <H2 id="limits">Resolution and other limits</H2>
        <ul>
          <li><b>10 m pixels</b> (30 m for Landsat): fields, reservoirs, burn scars, new roads and large construction are visible; individual buildings, vehicles and people are not. A house is 1–2 pixels.</li>
          <li><b>Revisit and clouds</b>: in persistently cloudy regions, usable images can be weeks or months apart, so a change's timing is only known to within that gap (descriptions say so).</li>
          <li><b>Thresholds are global</b>, not tuned per region; very dark soils, shadowed slopes, turbid or shallow water and snow can be misclassified.</li>
          <li><b>Geolocation</b> is accurate to roughly a pixel; cross-sensor comparisons may show one-pixel edge effects.</li>
          <li>Flagged changes are leads to investigate, not conclusions.</li>
        </ul>
      </section>

      <section className="space-y-3">
        <H2 id="architecture">Browser-only architecture</H2>
        <p>There is no {BRAND.name} server. The static site loads; your browser then talks directly to public imagery archives. Satellite images are stored as <i>Cloud Optimized GeoTIFFs</i>, which allow reading just the bytes covering your area with HTTP range requests, so a 100 km² area needs a few MB per band rather than the ~100 MB file. Processing runs in a Web Worker so the app stays responsive, and results are stored in your browser's IndexedDB. See the <a href={`${import.meta.env.BASE_URL}security/`}>security page</a> for exactly which hosts are contacted.</p>
      </section>

      <section className="space-y-3">
        <H2 id="ai">AI analysis (optional)</H2>
        <p>Everything above works without AI. Optionally you can copy the project summary into any AI chat, run a local model with Ollama, or use your own key with Anthropic, OpenAI, Google Gemini or OpenRouter. The model receives the summary statistics, flagged changes, annotations and notes, and must request specific images through tools. It can draft annotations and report sections, which are only saved if you approve them. AI output can be wrong; check it against the imagery.</p>
        <p>AI agents such as Claude Code, Claude Desktop or Cursor can also use {BRAND.name} directly through its <a href={`${BRAND.repoUrl}#use-with-ai-agents-mcp`}>MCP server</a>. It runs the same engine, detection and analysis tools on your own computer, and saves projects as files you can open here.</p>
      </section>

      <section className="space-y-3">
        <H2 id="sources">Data sources</H2>
        <table>
          <thead><tr><th>Source</th><th>Resolution</th><th>Coverage</th><th>Credit</th></tr></thead>
          <tbody>
            {DATA_SOURCES.filter((d) => d.status === 'active').map((d) => (
              <tr key={d.id}><td>{d.label}<div className="text-xs text-neutral-500">{d.provider}</div></td><td>{d.resolutionM} m</td><td>{d.coverage.start.slice(0, 4)}→, {d.coverage.region}</td><td className="text-xs">{d.attribution}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm">Reference: Roy, D.P. et al. (2016). Characterization of Landsat-7 to Landsat-8 reflective wavelength and normalized difference vegetation index continuity. <i>Remote Sensing of Environment</i>, 185, 57–70.</p>
      </section>
    </PageLayout>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Methodology /></StrictMode>)

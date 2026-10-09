# Contributing to SatLapse

Thanks for helping. SatLapse is a browser-only tool: there is no backend, and that constraint is deliberate. Please read this short guide before opening a pull request.

## Getting started

```bash
npm install
npm run dev        # app at http://localhost:5173 (+ /security/, /methodology/, /spike.html)
npm test           # unit tests (vitest)
npm run typecheck
npm run build      # production build into dist/ (applies the strict CSP)
npm run preview    # serve dist/ locally with the CSP header
```

Node 20+ is required. No API keys are needed for anything except optional AI features.

## Ground rules

- **No backend, no keys for core features.** Anything new must work from a static site, entirely in the browser, against key-free public services. If a data source needs a server or a key, document why in `SPIKE.md` and leave it out, or make the key optional and user-supplied.
- **Every outbound host goes in `src/config/csp.ts`.** Then run `npm run csp:sync` and commit `vercel.json`. The build fails if they drift. Also add the host to the table on `/security` (rendered from the same file).
- **Keep `src/core` runtime-agnostic.** No DOM, React or IndexedDB imports there. It must run in a Web Worker and in Node (`scripts/sync-node.ts` exercises it). Persistence goes through the `Storage` interface; image encoding goes through `ImageEncoder`.
- **Attribution is mandatory.** Anything that exports imagery must carry "Contains modified Copernicus Sentinel data [year]" (and USGS/USDA credits for Landsat/NAIP).
- **Schema changes** bump `SCHEMA_VERSION` in `src/core/types.ts` and add a migration in `src/storage/idb.ts`. Never silently break existing users' data.
- **Look at the output.** Imagery and statistics bugs often pass type checks and tests. When you change processing, render a few frames (`scripts/sync-node.ts` writes a project file you can import) and check them.

## Where things live

| Path | What |
|---|---|
| `src/core/` | Engine: STAC search, COG reads, mosaicking, indices, change detection (`detect.ts`), project files, share links, paid-tier interfaces |
| `src/storage/` | IndexedDB `Storage` implementation, browser image encoder |
| `src/workers/` | Engine Web Worker |
| `src/ai/` | Provider-neutral chat types, agent loop, tools, provider adapters, key handling |
| `src/ui/`, `src/App.tsx` | React UI |
| `src/export/` | GIF/MP4 timelapse export, HTML/PDF report |
| `src/pages/` | `/security` and `/methodology` |
| `src/config/` | Branding (`brand.ts`), CSP host list, entitlements, app limits |
| `scripts/` | Node tools: example generation, CSP sync, the Phase 1 spike |

## Adding a data source

1. Check browser access first (CORS on the catalogue and on the file hosts, Range support). Write the result in `SPIKE.md`.
2. Add a descriptor to `DATA_SOURCES` in `src/core/sources.ts`.
3. Add hosts to `src/config/csp.ts` and run `npm run csp:sync`.
4. Normalise items into the existing shapes (`SceneRef` for optical sources) so the rest of the pipeline works unchanged.
5. Add credits to attribution, the report and `/methodology`.

## Pull requests

- Keep changes focused, and explain the user-visible effect.
- Include tests for logic in `src/core` and `src/ai`.
- By contributing you agree your work is licensed under AGPL-3.0.

Security issues: please use a private GitHub security advisory rather than a public issue.

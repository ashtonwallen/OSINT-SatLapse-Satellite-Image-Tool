# SatLapse

Draw an area on a map, pull its full Sentinel-2 satellite history, track it going forward, replay how it changed, and (optionally) analyze it with AI. Free, open source, and runs entirely in your browser: no server, no accounts, no API keys.

> **Status: in development.** Phases 1 (feasibility) and 2 (core prototype) are complete. See [PLAN.md](PLAN.md) for the roadmap and [SPIKE.md](SPIKE.md) for feasibility results and measurements. A full README with screenshots comes with Phase 3.

## Run locally

```bash
npm install
npm run dev
```

Then open the printed URL. `npm run build` produces a static site in `dist/`. Set `BASE_PATH=/sub/path/` when hosting under a sub-path.

## License

[AGPL-3.0](LICENSE). Contains modified Copernicus Sentinel data.

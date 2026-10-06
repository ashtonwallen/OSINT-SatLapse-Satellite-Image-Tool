// Operational limits. Override at build time with VITE_* env vars.
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d)

export const APP_CONFIG = {
  /** Largest area a user may draw. Bigger areas mean proportionally more
   *  download and storage per scene; see the explanation in the UI. */
  maxAreaKm2: num(import.meta.env.VITE_MAX_AREA_KM2, 100),
  /** Default Ollama endpoint. */
  ollamaUrl: 'http://localhost:11434',
  geocoder: 'photon' as const,
}

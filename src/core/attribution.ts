// Copernicus licence requires this notice on anything derived from Sentinel data.
export function copernicusAttribution(years: number[] | number): string {
  const ys = (Array.isArray(years) ? years : [years]).filter(Number.isFinite)
  if (ys.length === 0) return 'Contains modified Copernicus Sentinel data'
  const min = Math.min(...ys)
  const max = Math.max(...ys)
  return `Contains modified Copernicus Sentinel data ${min === max ? min : `${min}–${max}`}`
}

import { describe, expect, it } from 'vitest'
import { validatePolygon } from '../area'
import { gridForPolygon, rasterizePolygon, ringAreaKm2, squareAround, utmEpsgFor } from '../geo'
import { compareRasters, landCover } from '../products'
import { periodKey, selectScenes } from '../sampling'
import { decodeShare, encodeShare } from '../share'
import { SOURCES } from '../stac'
import { INVALID } from '../types'

describe('geo', () => {
  it('computes area and rasterizes a square to roughly the right pixel count', () => {
    const sq = squareAround([-115.5, 32.9], 4)
    expect(ringAreaKm2(sq.coordinates[0])).toBeCloseTo(4, 1)
    const grid = gridForPolygon(sq, utmEpsgFor([-115.5, 32.9]))
    const px = rasterizePolygon(sq, grid).reduce((n, v) => n + v, 0)
    expect(px * 100 / 1e6).toBeGreaterThan(3.8) // 10 m pixels -> km²
    expect(px * 100 / 1e6).toBeLessThan(4.2)
    expect(grid.x0 % 20).toBe(0)
  })
  it('rejects areas over the limit with an explanation', () => {
    const v = validatePolygon(squareAround([0, 10], 150), 100)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/limit is 100/)
  })
})

describe('sampling', () => {
  const c = (date: string, cloudPct: number) => ({ date, cloudPct, coveragePct: 100 })
  it('picks the clearest scene per month and skips taken periods', () => {
    const picked = selectScenes([c('2024-01-03', 10), c('2024-01-20', 2), c('2024-02-05', 5), c('2024-03-01', 1)], 'month', new Set(['2024-03']))
    expect(picked.map((p) => p.date)).toEqual(['2024-01-20', '2024-02-05'])
  })
  it('builds quarter keys', () => expect(periodKey('2024-08-01', 'quarter')).toBe('2024-Q3'))
})

describe('products', () => {
  it('classifies land cover with water taking precedence', () => {
    expect(landCover(0.6, -0.5, -0.3)).toBe(1)
    expect(landCover(0.1, 0.3, -0.2)).toBe(2)
    expect(landCover(0.05, -0.2, 0.15)).toBe(3)
  })
  it('flags water gain and ignores invalid pixels', () => {
    const r = (ndvi: number[], ndwi: number[], ndbi: number[]) => ({ ndvi: Int8Array.from(ndvi), ndwi: Int8Array.from(ndwi), ndbi: Int8Array.from(ndbi) })
    const a = r([10, 50, INVALID], [-30, -40, 0], [5, -20, 0])
    const b = r([5, 50, 10], [40, -40, 0], [-10, -20, 0])
    const { stats } = compareRasters(a, b, { comparedTo: 'x', comparedDate: '2024-01-01', polygonPx: 3 })
    expect(stats.waterGainPct).toBeCloseTo(50)
    expect(stats.comparablePct).toBeCloseTo(66.67, 1)
  })
})

describe('stac normalization', () => {
  const item = (props: Record<string, unknown>) => ({
    id: 'x', bbox: [0, 0, 1, 1] as [number, number, number, number],
    properties: { datetime: '2022-04-24T00:00:00Z', 'proj:epsg': 32610, ...props },
    assets: Object.fromEntries(['blue', 'green', 'red', 'nir', 'swir16', 'scl'].map((k) => [k, { href: k, 'raster:bands': [{ scale: 1e-4, offset: -0.1 }] }])),
  })
  it('does not double-apply the BOA offset on legacy Earth Search items', () => {
    expect(SOURCES['earth-search'].normalize(item({ 'earthsearch:boa_offset_applied': true })).bands.red.offset).toBe(0)
    expect(SOURCES['earth-search-c1'].normalize(item({})).bands.red.offset).toBe(-0.1)
  })
})

describe('share links', () => {
  it('round-trips polygon and name', () => {
    const geometry = squareAround([10, 50], 2)
    const back = decodeShare(encodeShare({ name: 'Ünïcode test', geometry }))
    expect(back?.name).toBe('Ünïcode test')
    expect(back?.geometry.coordinates[0][1][0]).toBeCloseTo(geometry.coordinates[0][1][0], 4)
  })
  it('rejects garbage', () => expect(decodeShare('not-a-token')).toBeNull())
})

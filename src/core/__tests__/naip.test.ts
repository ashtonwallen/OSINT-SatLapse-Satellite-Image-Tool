import { describe, expect, it } from 'vitest'
import { createArea } from '../area'
import { squareAround } from '../geo'
import { groupNaip, naipGrid, type NaipItem } from '../naip'

const item = (year: number, gsd: number, epsg = 32611, day = '06-01'): NaipItem => ({
  id: `${year}-${gsd}-${epsg}`, datetime: `${year}-${day}T00:00:00Z`, year, gsd, epsg, href: 'x', state: 'ca',
})

describe('naip', () => {
  it('groups quads by year, keeps only the area UTM zone, takes the finest gsd', () => {
    const g = groupNaip([item(2020, 0.6), item(2020, 0.6, 32611, '05-20'), item(2022, 0.3), item(2022, 0.6, 32612)], 32611)
    expect(g.map((a) => [a.year, a.items.length, a.gsd, a.date])).toEqual([[2020, 2, 0.6, '2020-05-20'], [2022, 1, 0.3, '2022-06-01']])
  })
  it('uses native resolution for small areas and caps output size for large ones', () => {
    const small = createArea('s', squareAround([-115.5, 32.9], 0.2))
    expect(naipGrid(small, 0.6).res).toBe(0.6)
    const big = createArea('b', squareAround([-115.5, 32.9], 90))
    const g = naipGrid(big, 0.6)
    expect(Math.max(g.width, g.height)).toBeLessThanOrEqual(4096)
    expect(g.res).toBeGreaterThan(2)
  })
})

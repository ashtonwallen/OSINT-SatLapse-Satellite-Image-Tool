import { describe, expect, it } from 'vitest'
import { gridInCrs, sameUtmZone } from '../geo'
import { qaPixelToScl, SCL } from '../scene'
import { ETM_TO_OLI } from '../stac'

describe('landsat', () => {
  it('translates southern-hemisphere grids into USGS northern-zone coordinates', () => {
    const g = { epsg: 32723, x0: 180000, y0: 8250000, res: 10, width: 10, height: 10 }
    expect(gridInCrs(g, 32623)?.y0).toBe(-1750000)
    expect(gridInCrs(g, 32622)).toBeNull()
    expect(sameUtmZone(32623, 32723)).toBe(true)
    expect(sameUtmZone(32610, 32611)).toBe(false)
  })
  it('decodes QA_PIXEL bits into SCL-equivalent classes', () => {
    // fill, dilated cloud, cloud, shadow, snow, water, clear
    const out = qaPixelToScl([1, 0b10, 0b1000, 0b10000, 0b100000, 0b10000000, 0b1000000])
    expect([...out]).toEqual([SCL.NO_DATA, SCL.CLOUD_HIGH, SCL.CLOUD_HIGH, SCL.CLOUD_SHADOW, SCL.SNOW, SCL.WATER, SCL.UNCLASSIFIED])
  })
  it('harmonisation keeps dark water water (NDWI sign preserved)', () => {
    const h = (b: keyof typeof ETM_TO_OLI, v: number) => v * ETM_TO_OLI[b].slope + ETM_TO_OLI[b].intercept
    const green = h('green', 0.045), nir = h('nir', 0.015)
    expect((green - nir) / (green + nir)).toBeGreaterThan(0.3)
  })
})

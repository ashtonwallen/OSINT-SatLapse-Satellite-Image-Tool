import { describe, expect, it } from 'vitest'
import { detectEvents, seasonalDistance } from '../detect'
import type { SceneRecord } from '../types'

// Deterministic pseudo-noise so tests are stable.
const noise = (i: number) => Math.sin(i * 12.9898) * 1.5

/** Monthly scenes with a strong annual vegetation cycle (e.g. crops). */
function series(years: number, tweak: (date: string, i: number, base: { veg: number; water: number; built: number }) => void = () => {}): SceneRecord[] {
  const out: SceneRecord[] = []
  let i = 0
  for (let y = 2019; y < 2019 + years; y++) {
    for (let m = 1; m <= 12; m++) {
      const date = `${y}-${String(m).padStart(2, '0')}-15`
      const phase = ((m - 1) / 12) * 2 * Math.PI
      const base = { veg: 50 + 25 * Math.sin(phase) + noise(i), water: 10 + 3 * Math.cos(phase) + noise(i + 99) / 3, built: 15 + noise(i + 7) / 2 }
      tweak(date, i, base)
      out.push({
        id: `a|${date}`, areaId: 'a', date, datetime: `${date}T00:00:00Z`, status: 'processed', sources: [{ sourceId: 'earth-search-c1', itemId: `S2_${date}`, tile: '11SPS' }],
        cloudPct: 0, coveragePct: 100,
        stats: { vegPct: base.veg, waterPct: base.water, builtPct: base.built, meanNdvi: null, meanNdwi: null, meanNdbi: null },
      })
      i++
    }
  }
  return out
}

describe('seasonal detection', () => {
  it('raises nothing for a strong but normal seasonal cycle', () => {
    expect(detectEvents('a', 10, series(5))).toEqual([])
  })

  it('flags a persistent drop once, at onset, with high confidence', () => {
    const scenes = series(5, (date, _i, b) => { if (date >= '2022-06-01') { b.veg -= 25; b.built += 20 } })
    const ev = detectEvents('a', 10, scenes)
    const veg = ev.filter((e) => e.kind === 'veg_loss')
    expect(veg).toHaveLength(1)
    expect(veg[0].date).toBe('2022-06-15')
    expect(veg[0].method).toBe('seasonal')
    expect(veg[0].confidence).toBe('high')
    expect(veg[0].confirmedBy).toBe('a|2022-07-15')
    expect(veg[0].reference.years).toEqual([2019, 2020, 2021])
    expect(veg[0].sources[0].itemId).toBe('S2_2022-06-15')
    expect(veg[0].description).toMatch(/typical/)
    expect(ev.filter((e) => e.kind === 'built_gain')).toHaveLength(1)
  })

  it('downgrades a one-off spike that the next scene contradicts', () => {
    const ev = detectEvents('a', 10, series(4, (date, _i, b) => { if (date === '2022-03-15') b.water += 12 }))
    expect(ev).toHaveLength(1)
    expect(ev[0].kind).toBe('water_gain')
    expect(ev[0].confidence).toBe('medium') // 3 years → high, transient → medium
    expect(ev[0].confirmedBy).toBeUndefined()
  })

  it('uses medium confidence with only two reference years', () => {
    const ev = detectEvents('a', 10, series(3, (date, _i, b) => { if (date >= '2021-05-01') b.veg -= 30 }))
    expect(ev.find((e) => e.kind === 'veg_loss')?.confidence).toBe('medium')
  })

  it('ignores a smoke-hazed scene instead of flagging it', () => {
    const scenes = series(5, (date, _i, b) => { if (date === '2022-09-15') { b.veg -= 40; b.built += 25 } })
    scenes.forEach((s) => { s.stats!.haze = s.date === '2022-09-15' ? 1.05 : 0.55 + (Number(s.date.slice(5, 7)) % 3) * 0.02 })
    expect(detectEvents('a', 10, scenes)).toEqual([])
  })

  it('wraps seasons across the new year', () => {
    expect(seasonalDistance('2021-12-28', '2023-01-03')).toBe(6)
  })
})

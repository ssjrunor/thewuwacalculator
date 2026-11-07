/*
  Author: Runor Ewhro
  description: the build score's anchors (0 / 100 / 200 at baseline, benchmark
               and perfect), its slopes either side, and the best-scenario pick.
*/

import { describe, expect, it } from 'vitest'
import { buildScore, validAnchors } from '@/engine/leaderboard/scoreFormula'
import { pickBest } from '@/engine/leaderboard/pickBest'

const anchors = { baselineDps: 20_000, benchDps: 40_000, perfectDps: 60_000 }

describe('build score', () => {
  it('maps the three references to 0, 100 and 200 and interpolates between them', () => {
    expect([20_000, 30_000, 40_000, 50_000, 60_000].map((dps) => buildScore(dps, anchors))).toEqual([0, 50, 100, 150, 200])
  })

  it('keeps the upper slope past perfect and stops at 0 below the baseline', () => {
    expect(buildScore(70_000, anchors)).toBe(250)
    expect(buildScore(10_000, anchors)).toBe(0)
  })

  it('refuses anchors that do not rise', () => {
    expect(validAnchors({ baselineDps: 40_000, benchDps: 40_000, perfectDps: 60_000 })).toBe(false)
    expect(buildScore(50_000, { baselineDps: 0, benchDps: 50_000, perfectDps: 50_000 })).toBeNull()
    expect(buildScore(Number.NaN, anchors)).toBeNull()
  })
})

describe('best scenario', () => {
  const row = (scenarioId: string, score: number | null, dps: number | null, status: 'ok' | 'unsupported' = 'ok') =>
    ({ scenarioId, status, score, dps })

  it('takes the highest score, then the higher dps, then the lower id', () => {
    expect(pickBest([row('b', 120, 1), row('a', 130, 1), row('c', 130, 2)])?.scenarioId).toBe('c')
    expect(pickBest([row('b', 130, 2), row('a', 130, 2)])?.scenarioId).toBe('a')
  })

  it('never picks an unscored or unsupported row', () => {
    expect(pickBest([row('a', null, 9), row('b', 500, 9, 'unsupported')])).toBeNull()
  })
})

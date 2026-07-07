/*
  Author: Runor Ewhro
  Description: breadth net for the damage pipeline. Every shipped resonator must
               simulate end-to-end and produce well-formed, deterministic,
               non-dead damage. This does not pin exact numbers (the benchmark
               fingerprints and the optimizer parity test do). its job is to
               catch any resonator a data drop or engine change silently breaks
               (NaN, a throw, or a kit that resolves to nothing), across the
               whole roster.
*/

import { describe, expect, it } from 'vitest'
import { listResSds } from '@/domain/services/resonatorSeedService'
import { makeEnemy, mkMaxResRt } from '@/domain/state/defaults'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters'
import { runResSmlt } from '@/engine/pipeline'

const seeds = listResSds()

function simulate(seedId: string) {
  const seed = seeds.find((entry) => entry.id === seedId)
  if (!seed) throw new Error(`missing seed ${seedId}`)
  // a maxed kit (level/skills/traces/weapon) so damage reflects a real build;
  // echoes stay empty so this measures the resonator's own kit, not gear.
  const runtime = mkMaxResRt(seed)
  return runResSmlt(runtime, seed, makeEnemy(), makeRuntimeMap(runtime))
}

describe('resonator damage invariants', () => {
  it('ships at least one resonator to sweep', () => {
    expect(seeds.length).toBeGreaterThan(0)
  })

  it.each(seeds.map((seed) => [seed.id] as const))(
    'produces finite, non-dead, deterministic damage for %s',
    (seedId) => {
      const result = simulate(seedId)

      // every simulated row resolves to a real, non-negative number, catching a
      // NaN/Infinity leaking out of a new formula branch, missing stat, or bad
      // multiplier. allSkills is the resonator's full kit; perSkill is whatever
      // its default rotation drives (legitimately empty for some supports).
      for (const row of [...result.allSkills, ...result.perSkill]) {
        expect(Number.isFinite(row.avg)).toBe(true)
        expect(row.avg).toBeGreaterThanOrEqual(0)
      }
      expect(Number.isFinite(result.total.avg)).toBe(true)

      // the resonator's kit can actually deal damage somewhere, catching a
      // roster entry whose damage skills all resolve to nothing (broken hits,
      // unmapped element, dangling feature ref). Checked on the full kit, not
      // the default rotation, so a support's empty rotation is not a failure.
      const dealsDamage = result.allSkills.some(
        (row) => row.aggregationType === 'damage' && row.avg > 0,
      )
      expect(dealsDamage).toBe(true)

      // same inputs, same output, catching accidental nondeterminism (Map
      // iteration order, undefined-key reads) that would make scores unstable.
      const again = simulate(seedId)
      expect(again.total.avg).toBe(result.total.avg)
    },
  )
})

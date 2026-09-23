/*
  Author: Runor Ewhro
  Description: Verifies allocation-light modulation counts match fully
               materialized effect groups for every resonator.
*/

import { describe, expect, it } from 'vitest'
import { listResSds } from '@/data/catalog/resonatorSeedService.ts'
import { makeResRuntime } from '@/engine/runtime/defaults.ts'
import {
  countLive,
  countModulationEffects,
  makeModulationBays,
} from '@/modules/simulation/surfaces/modulation/lib/modulationBays.ts'

describe('Modulation effect counts', () => {
  it('keeps the allocation-light badge count equal to the rendered bays', () => {
    for (const seed of listResSds()) {
      const runtime = makeResRuntime(seed)
      expect(
        countModulationEffects(runtime, runtime),
        seed.name,
      ).toEqual(countLive(makeModulationBays(runtime, runtime)))
    }
  })
})

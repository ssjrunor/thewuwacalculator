/*
  Author: Runor Ewhro
  Description: Verifies calculation-only bundles reproduce full-catalog combat
               results for every resonator in beta and live data modes.
*/

import { readFile } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { initGameData } from '@/data/gameData'
import { listResSds, getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeEnemy, makeResRuntime } from '@/engine/runtime/defaults'
import { maxResRt } from '@/engine/gameData/resonatorMax'
import { runResSmlt } from '@/engine/pipeline'
import { makeRuntimeMap } from '@/engine/runtime/runtimeAdapters'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'

it('keeps every resonator calculation identical with stripped worker details and scoped weapons', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => JSON.parse(await readFile(`public${String(input)}`, 'utf8')),
  } as Response)) as typeof fetch
  try {
    for (const mode of ['beta', 'live'] as const) {
      await initGameData({ mode })
      const enemy = makeEnemy()
      const fixtures = listResSds().map((seed) => {
        const runtime = maxResRt(makeResRuntime(seed), getResDtlsBy()[seed.id], { targetSequence: 6 })
        return { id: seed.id, runtime, expected: runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime, {}), {}) }
      })
      await initGameData({
        mode,
        resonatorIds: fixtures.map((fixture) => fixture.id),
        calculationOnly: true,
        weaponIds: fixtures.flatMap(({ runtime }) => runtime.build.weapon.id ? [runtime.build.weapon.id] : []),
      })
      for (const { id, runtime, expected } of fixtures) {
        const seed = getResSeedBy(id)!
        expect(runResSmlt(runtime, seed, enemy, makeRuntimeMap(runtime, {}), {}), `${mode}:${id}`).toEqual(expected)
      }
    }
  } finally {
    globalThis.fetch = originalFetch
    await initGameData()
  }
}, 60000)

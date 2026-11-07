/*
  Author: Runor Ewhro
  description: checks state prerequisites and controls available during a rotation.
*/

import { describe, expect, it } from 'vitest'
import { listEffectsFor, listSources, listStatesFor } from '@/data/catalog/gameDataService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { makeResRuntime } from '@/engine/runtime/defaults'
import { canStateBeVisible, isStateVisible } from '@/engine/services/sourceStateService'
import { rotationMemberStates } from '@/engine/rotation/openingChoices'

const controlsIn = (value: unknown): Set<string> => {
  const out = new Set<string>()
  JSON.stringify(value ?? null).replace(/state\.controls\.([\w:.-]+?)"/g, (_, key: string) => {
    out.add(key)
    return ''
  })
  return out
}

describe('state dependencies', () => {
  // a rotation can write a state its parent hides (the editor lists it), so an
  // effect must check every control the state depends on, or it would fire
  // with the parent off.
  it('gates every effect on the controls its states depend on', () => {
    const gaps: string[] = []
    for (const type of ['resonator', 'weapon', 'echo', 'echoSet'] as const) {
      for (const source of listSources(type)) {
        const id = String(source.id)
        const effects = listEffectsFor(type, id)
        for (const state of listStatesFor(type, id)) {
          const dependencies = [...(state.requires ?? state.controlDependencies ?? []), ...controlsIn(state.visibleWhen)]
          if (!dependencies.length) continue
          for (const effect of effects) {
            const reads = controlsIn(effect.condition)
            if (!reads.has(state.controlKey)) continue
            const missing = dependencies.filter((key) => !reads.has(key))
            if (missing.length) gaps.push(`${effect.id} reads ${state.controlKey} without ${missing.join(', ')}`)
          }
        }
      }
    }
    expect(gaps).toEqual([])
  })

  it('lists a state hidden by a writable control, never one the build rules out', () => {
    const seed = getResSeedBy('1110')!
    const runtime = makeResRuntime(seed)
    runtime.base.sequence = 0
    runtime.state.controls['team:1110:ceaseless_landscape:active'] = false
    const states = listStatesFor('resonator', '1110')
    const heavensRoam = states.find((state) => state.controlKey === 'team:1110:heavens_roam:active')!
    const s2 = states.find((state) => state.controlKey === 'sequence:1110:s2:active')!
    expect(isStateVisible(runtime, runtime, heavensRoam)).toBe(false)
    expect(canStateBeVisible(runtime, runtime, heavensRoam)).toBe(true)
    expect(canStateBeVisible(runtime, runtime, s2)).toBe(false)
    const listed = rotationMemberStates(runtime, runtime).map((state) => state.controlKey)
    expect(listed).toContain('team:1110:heavens_roam:active')
    expect(listed).not.toContain('sequence:1110:s2:active')
  })
})

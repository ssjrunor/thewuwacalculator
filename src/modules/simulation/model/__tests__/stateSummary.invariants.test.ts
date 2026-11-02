/*
  Author: Runor Ewhro
  description: protects calculated-state summaries that feed rotation-row
               buffs applied inspection.
*/

import { describe, expect, it } from 'vitest'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeResRuntime } from '@/engine/runtime/defaults.ts'
import { makeStateSummary } from '@/modules/simulation/model/stateSummary.ts'

describe('state summary invariants', () => {
  it('traces only the selected modifier scope', () => {
    const seed = getResSeedBy('1209')
    if (!seed) throw new Error('Missing resonator fixture')

    const runtime = makeResRuntime(seed)
    runtime.build.weapon.id = '21020076'
    runtime.build.weapon.rank = 1
    runtime.state.controls['weapon:21020076:passive:active'] = true

    const termsFor = (key: string, scope: { kind: 'top' } | { kind: 'skillType' | 'attribute'; key: string }) =>
      makeStateSummary(runtime, { [runtime.id]: runtime }, null, null, {
        statTarget: { key, scope },
      }).flatMap((group) => group.scopes.flatMap((entry) => entry.nodes.flatMap((node) => node.statTerms ?? [])))

    expect(termsFor('defIgnore', { kind: 'skillType', key: 'resonanceLiberation' }))
      .toEqual(expect.arrayContaining([{ kind: 'add', key: 'defIgnore', value: 32 }]))
    expect(termsFor('defIgnore', { kind: 'skillType', key: 'heavyAtk' })).toEqual([])
    expect(termsFor('defIgnore', { kind: 'top' })).toEqual([])

    runtime.build.weapon.id = '21030026'
    runtime.state.controls['weapon:21030026:passive:aero_shred'] = true
    expect(termsFor('resShred', { kind: 'attribute', key: 'aero' }))
      .toEqual(expect.arrayContaining([{ kind: 'add', key: 'resShred', value: 10 }]))
    expect(termsFor('resShred', { kind: 'attribute', key: 'havoc' })).toEqual([])

    runtime.build.weapon.id = '21030036'
    runtime.state.controls['weapon:21030036:passive:heavy'] = true
    runtime.state.controls['weapon:21030036:passive:echo'] = true
    expect(termsFor('defIgnore', { kind: 'top' }))
      .toEqual(expect.arrayContaining([{ kind: 'add', key: 'defIgnore', value: 8 }]))
    expect(termsFor('defIgnore', { kind: 'skillType', key: 'resonanceLiberation' })).toEqual([])
  })
})

/*
  Author: Runor Ewhro
  Description: protects calculated-state summaries that feed rotation-row
               Buffs Applied inspection.
*/

import { describe, expect, it } from 'vitest'
import { listSkillsFor } from '@/data/catalog/gameDataService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeResRuntime } from '@/engine/runtime/defaults.ts'
import { makeStateSummary } from '@/modules/simulation/model/stateSummary.ts'

describe('state summary invariants', () => {
  it('shows Off-Tune Buildup Rate buffs on DamageList-bearing skills', () => {
    const seed = getResSeedBy('1209')
    if (!seed) throw new Error('Missing Mornye fixture')

    const runtime = makeResRuntime(seed)
    runtime.state.controls['team:1209:syntony_field:active'] = true
    const skill = listSkillsFor('resonator', seed.id).find((candidate) =>
      candidate.damageEntries?.some((entry) => (entry.weakness ?? 0) * entry.count !== 0),
    )
    if (!skill) throw new Error('Mornye has no DamageList-bearing skill fixture')

    const labels = makeStateSummary(
      runtime,
      { [runtime.id]: runtime },
      null,
      null,
      {
        skillTarget: {
          resonatorId: runtime.id,
          skill,
        },
      },
    ).flatMap((group) =>
      group.scopes.flatMap((scope) =>
        scope.nodes.flatMap((node) => node.effectLabels),
      ),
    )

    expect(labels.some((label) =>
      label.includes('Off-Tune Buildup Rate') && label.includes('+50%'),
    )).toBe(true)
    expect(labels.some((label) => label.includes('DEF') && label.includes('+20%'))).toBe(false)
  })

  it('shows Denia Shifting as a direct 19.2 Off-Tune addition', () => {
    const targetSeed = getResSeedBy('1209')
    const deniaSeed = getResSeedBy('1211')
    if (!targetSeed || !deniaSeed) throw new Error('Missing Off-Tune team fixture')

    const target = makeResRuntime(targetSeed)
    const denia = makeResRuntime(deniaSeed)
    target.build.team = [target.id, denia.id, null]
    denia.build.team = target.build.team
    denia.state.controls['resonator:1211:entropy_shift:active'] = true
    denia.state.controls['resonator:1211:mode:value'] = 'tune_strain'
    denia.state.controls['team:1211:tune_strain_shifting:active'] = true
    const skill = listSkillsFor('resonator', target.id).find((candidate) => candidate.tab !== 'tuneBreak')
    if (!skill) throw new Error('Off-Tune target has no skill fixture')

    const labels = makeStateSummary(
      target,
      { [target.id]: target, [denia.id]: denia },
      null,
      null,
      {
        skillTarget: {
          resonatorId: target.id,
          skill,
        },
      },
    ).flatMap((group) =>
      group.scopes.flatMap((scope) =>
        scope.nodes.flatMap((node) => node.effectLabels),
      ),
    )

    expect(labels.some((label) =>
      label.includes('Off-Tune Level') && label.includes('+19.2'),
    )).toBe(true)
    expect(labels.some((label) =>
      label.includes('Off-Tune Buildup Rate') && label.includes('+50%'),
    )).toBe(false)
  })

  it("shows Qingxiao Heaven's Clarity Off-Tune and multiplier on Heaven's Reckoning", () => {
    const seed = getResSeedBy('1413')
    if (!seed) throw new Error('Missing Qingxiao fixture')

    const runtime = makeResRuntime(seed)
    runtime.state.controls['resonator:1413:heavens_clarity:active'] = true
    const skill = listSkillsFor('resonator', seed.id).find((candidate) => candidate.id === '1413406')
    if (!skill) throw new Error("Missing Qingxiao Heaven's Reckoning fixture")

    const labels = makeStateSummary(
      runtime,
      { [runtime.id]: runtime },
      null,
      null,
      {
        skillTarget: {
          resonatorId: runtime.id,
          skill,
        },
      },
    ).flatMap((group) =>
      group.scopes.flatMap((scope) =>
        scope.nodes.flatMap((node) => node.effectLabels),
      ),
    )

    expect(labels.some((label) => label.includes('Off-Tune') && label.includes('+15.2'))).toBe(true)
    expect(labels.some((label) => label.includes('DMG Multiplier') && label.includes('×2'))).toBe(true)
  })
})

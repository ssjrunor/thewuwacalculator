import { describe, expect, it } from 'vitest'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import type { SkillDef } from '@/domain/entities/stats'
import type { SourceState } from '@/domain/gameData/contracts'
import { getNegFfctFf, negEffectsFor } from '@/domain/gameData/negativeEffects'
import { getResonatorById } from '@/domain/services/catalogService'
import { makeResRuntime, makeTeamMember } from '@/domain/state/defaults'
import { isSkllVsbl, resolveSkill } from '@/engine/pipeline/resolveSkill'
import { evalSrcSttOn } from '@/modules/calculator/model/sourceEval.ts'

const CHISA_UNRAVELING_CONTROL_KEY = 'team:1508:team:1508:unraveling_law_zero:active'

function withTeam(
    activeId: string,
    teammateIds: Array<string | null>,
) {
  const active = getResonatorById(activeId)
  if (!active) {
    throw new Error(`missing active resonator ${activeId}`)
  }

  const runtime = makeResRuntime(active)
  runtime.build.team = [activeId, teammateIds[0] ?? null, teammateIds[1] ?? null]
  runtime.teamRuntimes = [
    teammateIds[0] ? makeTeamMember(getResonatorById(teammateIds[0])!) : null,
    teammateIds[1] ? makeTeamMember(getResonatorById(teammateIds[1])!) : null,
  ]

  return runtime
}

describe('team composition context', () => {
  it('exposes teammate presence and metadata to skill visibility conditions', () => {
    const lupa = getResonatorById('1207')
    if (!lupa) {
      throw new Error('missing resonator 1207')
    }

    const runtime = makeResRuntime(lupa)
    runtime.build.team = [lupa.id, '1510', '1506']

    const skill: SkillDef = {
      id: 'team-aware-skill',
      label: 'Team Aware Skill',
      tab: 'resonanceSkill',
      sectionTitle: 'Resonance Skill',
      skillType: ['resonanceSkill'],
      archetype: 'skillDamage',
      aggregationType: 'damage',
      element: 'fusion',
      multiplier: 1,
      flat: 0,
      scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
      visibleWhen: {
        type: 'and',
        values: [
          { type: 'truthy', from: 'context', path: 'team.presenceById.1510' },
          { type: 'eq', from: 'context', path: 'team.membersById.1510.attribute', value: 'spectro' },
          { type: 'eq', from: 'context', path: 'team.membersById.1510.weaponType', value: 4 },
        ],
      },
      hits: [{ count: 1, multiplier: 1 }],
    }

    expect(isSkllVsbl(runtime, skill)).toBe(true)

    const runtimeWithoutRequiredMember = makeResRuntime(lupa)
    runtimeWithoutRequiredMember.build.team = [lupa.id, '1506', null]
    expect(isSkllVsbl(runtimeWithoutRequiredMember, skill)).toBe(false)
  })

  it('exposes team attribute counts to source-state conditions', () => {
    const lupa = getResonatorById('1207')
    if (!lupa) {
      throw new Error('missing resonator 1207')
    }

    const fusionTeamRuntime = makeResRuntime(lupa)
    fusionTeamRuntime.build.team = [lupa.id, '1208', '1209']

    const mixedTeamRuntime = makeResRuntime(lupa)
    mixedTeamRuntime.build.team = [lupa.id, '1510', '1506']

    const state: SourceState = {
      id: 'fusion-team-state',
      label: 'Fusion Team State',
      source: { type: 'resonator', id: lupa.id },
      ownerKey: 'resonator:1207:fusion_team',
      controlKey: 'resonator:1207:fusion_team:active',
      path: 'state.controls.resonator:1207:fusion_team:active',
      kind: 'toggle',
      enabledWhen: {
        type: 'gte',
        from: 'context',
        path: 'team.attributeCounts.fusion',
        value: 3,
      },
    }

    expect(evalSrcSttOn(fusionTeamRuntime, fusionTeamRuntime, state, fusionTeamRuntime)).toBe(true)
    expect(evalSrcSttOn(mixedTeamRuntime, mixedTeamRuntime, state, mixedTeamRuntime)).toBe(false)
  })

  it('resolves visible team negative effects from the resonator catalog, keeps the highest max override, and applies global max increases', () => {
    const runtime = withTeam('1207', ['1507', '1508'])
    runtime.state.controls[CHISA_UNRAVELING_CONTROL_KEY] = true
    const entries = negEffectsFor(runtime)

    expect(entries.map((entry) => entry.key)).toEqual(['spectroFrazzle', 'havocBane'])
    expect(entries.find((entry) => entry.key === 'spectroFrazzle')?.max).toBe(63)
    expect(entries.find((entry) => entry.key === 'havocBane')?.max).toBe(6)
  })

  it('shows electro rage only when electro flare overflows past its default cap', () => {
    const runtime = withTeam('1207', ['1307', '1508'])
    runtime.state.controls[CHISA_UNRAVELING_CONTROL_KEY] = true
    const hiddenEntries = negEffectsFor(runtime)

    expect(hiddenEntries.map((entry) => entry.key)).toEqual(['havocBane', 'electroFlare'])
    expect(hiddenEntries.find((entry) => entry.key === 'electroRage')).toBeUndefined()

    runtime.state.combat.electroFlare = 11
    const visibleEntries = negEffectsFor(runtime)

    expect(visibleEntries.map((entry) => entry.key)).toEqual(['havocBane', 'electroFlare', 'electroRage'])
    expect(visibleEntries.find((entry) => entry.key === 'electroFlare')?.max).toBe(13)
    expect(visibleEntries.find((entry) => entry.key === 'electroRage')?.max).toBe(13)
  })

  it('supports keyed max additions and conditional max rules for specific negative effects', () => {
    const detailsById = getResDtlsBy()
    const originalSources = detailsById['1508']?.negativeEffectSources

    if (!detailsById['1508']) {
      throw new Error('missing resonator details 1508')
    }

    detailsById['1508'].negativeEffectSources = [
      ...(originalSources ?? []),
      { type: 'maxAdd', key: 'electroFlare', value: 2 },
      {
        type: 'globalMaxAdd',
        value: 5,
        enabledWhen: {
          type: 'truthy',
          from: 'sourceRuntime',
          path: 'state.controls.sequence:1508:s6:active',
        },
      },
    ]

    try {
      const runtime = withTeam('1207', ['1307', '1508'])
      runtime.state.controls[CHISA_UNRAVELING_CONTROL_KEY] = true
      const baseEntries = negEffectsFor(runtime)

      expect(baseEntries.find((entry) => entry.key === 'electroFlare')?.max).toBe(15)
      expect(baseEntries.find((entry) => entry.key === 'electroRage')).toBeUndefined()
      expect(baseEntries.find((entry) => entry.key === 'havocBane')?.max).toBe(6)

      runtime.state.combat.electroFlare = 11
      const overflowEntries = negEffectsFor(runtime)

      expect(overflowEntries.find((entry) => entry.key === 'electroRage')?.max).toBe(15)

      runtime.state.controls['team:1508:sequence:1508:s6:active'] = true
      const gatedEntries = negEffectsFor(runtime)

      expect(gatedEntries.find((entry) => entry.key === 'electroFlare')?.max).toBe(20)
      expect(gatedEntries.find((entry) => entry.key === 'electroRage')?.max).toBe(20)
      expect(gatedEntries.find((entry) => entry.key === 'havocBane')?.max).toBe(11)
    } finally {
      detailsById['1508'].negativeEffectSources = originalSources
    }
  })

  it('supports includes conditions against source negative-effect metadata', () => {
    const detailsById = getResDtlsBy()
    const originalSources = detailsById['1508']?.negativeEffectSources

    if (!detailsById['1508']) {
      throw new Error('missing resonator details 1508')
    }

    detailsById['1508'].negativeEffectSources = [
      { key: 'havocBane' },
      {
        type: 'globalMaxAdd',
        value: 5,
        enabledWhen: {
          type: 'includes',
          from: 'context',
          path: 'source.negativeEffectSources',
          itemPath: 'key',
          value: 'fusionBurst',
        },
      },
    ]

    try {
      const withoutFusionBurst = withTeam('1207', ['1508', null])
      const baseEntries = negEffectsFor(withoutFusionBurst)

      expect(baseEntries.find((entry) => entry.key === 'havocBane')?.max).toBe(3)
      expect(baseEntries.find((entry) => entry.key === 'fusionBurst')).toBeUndefined()

      detailsById['1508'].negativeEffectSources = [
        { key: 'havocBane' },
        { key: 'fusionBurst' },
        {
          type: 'globalMaxAdd',
          value: 5,
          enabledWhen: {
            type: 'includes',
            from: 'context',
            path: 'source.negativeEffectSources',
            itemPath: 'key',
            value: 'fusionBurst',
          },
        },
      ]

      const withFusionBurst = withTeam('1207', ['1508', null])
      const boostedEntries = negEffectsFor(withFusionBurst)

      expect(boostedEntries.find((entry) => entry.key === 'havocBane')?.max).toBe(8)
      expect(boostedEntries.find((entry) => entry.key === 'fusionBurst')?.max).toBe(15)
    } finally {
      detailsById['1508'].negativeEffectSources = originalSources
    }
  })

  it('supports includes conditions against target negative-effect metadata', () => {
    const detailsById = getResDtlsBy()
    const originalSources = detailsById['1508']?.negativeEffectSources

    if (!detailsById['1508']) {
      throw new Error('missing resonator details 1508')
    }

    detailsById['1508'].negativeEffectSources = [
      { key: 'havocBane' },
      {
        type: 'globalMaxAdd',
        value: 5,
        enabledWhen: {
          type: 'includes',
          from: 'context',
          path: 'target.negativeEffectSources',
          itemPath: 'key',
          value: 'fusionBurst',
        },
      },
    ]

    try {
      const nonFusionTarget = withTeam('1207', ['1508', null])
      const baseEntries = negEffectsFor(nonFusionTarget)

      expect(baseEntries.find((entry) => entry.key === 'havocBane')?.max).toBe(3)

      const fusionTarget = withTeam('1211', ['1508', null])
      const boostedEntries = negEffectsFor(fusionTarget)

      expect(boostedEntries.find((entry) => entry.key === 'havocBane')?.max).toBe(8)
      expect(boostedEntries.find((entry) => entry.key === 'fusionBurst')?.max).toBe(15)
    } finally {
      detailsById['1508'].negativeEffectSources = originalSources
    }
  })

  it('resolves Hiyuki glacio chafe behavior as fixed-max Glacio Bite', () => {
    const runtime = withTeam('1207', ['1108', null])
    runtime.state.combat.glacioChafe = 2
    const entries = negEffectsFor(runtime)
    const glacioEntry = entries.find((entry) => entry.key === 'glacioChafe')

    expect(glacioEntry).toMatchObject({
      key: 'glacioChafe',
      label: 'Glacio Bite',
      max: 10,
      stackMode: 'fixedMax',
      sliderVisible: false,
    })
    expect(getNegFfctFf(runtime, 'glacioChafe')).toBe(10)

    const resolvedSkill = resolveSkill(runtime, {
      id: 'team-aware-glacio-chafe',
      label: 'Glacio Chafe',
      tab: 'negativeEffect',
      sectionTitle: 'Negative Effects',
      skillType: ['glacioChafe'],
      archetype: 'glacioChafe',
      aggregationType: 'damage',
      element: 'glacio',
      multiplier: 1,
      flat: 0,
      scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
      hits: [{ count: 1, multiplier: 1 }],
    })

    expect(resolvedSkill.label).toBe('Glacio Bite')
  })

  it('shows negative effect skills only when the team catalog supports them', () => {
    const lupa = getResonatorById('1207')
    if (!lupa) {
      throw new Error('missing resonator 1207')
    }

    const runtime = makeResRuntime(lupa)
    const skill: SkillDef = {
      id: 'team-aware-negative-effect',
      label: 'Spectro Frazzle',
      tab: 'negativeEffect',
      sectionTitle: 'Negative Effects',
      skillType: ['spectroFrazzle'],
      archetype: 'spectroFrazzle',
      aggregationType: 'damage',
      element: 'spectro',
      multiplier: 1,
      flat: 0,
      scaling: { atk: 0, hp: 0, def: 0, energyRegen: 0 },
      hits: [{ count: 1, multiplier: 1 }],
    }

    runtime.build.team = [runtime.id, '1506', null]
    runtime.teamRuntimes = [makeTeamMember(getResonatorById('1506')!), null]
    expect(isSkllVsbl(runtime, skill)).toBe(true)

    runtime.build.team = [runtime.id, '1508', null]
    runtime.teamRuntimes = [makeTeamMember(getResonatorById('1508')!), null]
    expect(isSkllVsbl(runtime, skill)).toBe(false)
  })
})

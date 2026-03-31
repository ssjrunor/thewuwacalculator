import { describe, expect, it } from 'vitest'
import type { SkillDefinition } from '@/domain/entities/stats'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import { getResonatorById } from '@/domain/services/catalogService'
import { createDefaultResonatorRuntime } from '@/domain/state/defaults'
import { isSkillVisible } from '@/engine/pipeline/resolveSkill'
import { evaluateSourceStateEnabled } from '@/modules/calculator/model/sourceStateEvaluation'

describe('team composition context', () => {
  it('exposes teammate presence and metadata to skill visibility conditions', () => {
    const lupa = getResonatorById('1207')
    if (!lupa) {
      throw new Error('missing resonator 1207')
    }

    const runtime = createDefaultResonatorRuntime(lupa)
    runtime.build.team = [lupa.id, '1510', '1506']

    const skill: SkillDefinition = {
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

    expect(isSkillVisible(runtime, skill)).toBe(true)

    runtime.build.team = [lupa.id, '1506', null]
    expect(isSkillVisible(runtime, skill)).toBe(false)
  })

  it('exposes team attribute counts to source-state conditions', () => {
    const lupa = getResonatorById('1207')
    if (!lupa) {
      throw new Error('missing resonator 1207')
    }

    const fusionTeamRuntime = createDefaultResonatorRuntime(lupa)
    fusionTeamRuntime.build.team = [lupa.id, '1208', '1209']

    const mixedTeamRuntime = createDefaultResonatorRuntime(lupa)
    mixedTeamRuntime.build.team = [lupa.id, '1510', '1506']

    const state: SourceStateDefinition = {
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

    expect(evaluateSourceStateEnabled(fusionTeamRuntime, fusionTeamRuntime, state, fusionTeamRuntime)).toBe(true)
    expect(evaluateSourceStateEnabled(mixedTeamRuntime, mixedTeamRuntime, state, mixedTeamRuntime)).toBe(false)
  })
})

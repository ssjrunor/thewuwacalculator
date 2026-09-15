/*
  Author: Runor Ewhro
  Description: Protects generated resonator-source invariants that are easy to
               regress during authored override updates.
*/

import { describe, expect, it } from 'vitest'
import type { ResDtls } from '@/domain/entities/resonator'
import type { EffectScope, FormExpr, SrcPkg } from '@/domain/gameData/contracts'
import { applySkllOp } from '@/engine/effects/dataEffects'
import { evalForm } from '@/engine/effects/evaluator'
import resonatorDetailsRaw from '../../../../public/data/beta/resonators/details.json?raw'
import resonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'

const TUNE_STRAIN_RESPONSE_EFFECTS = [
  ['1209', '1209:decoupling', 1],
  ['1211', '1211:shattered-hours', 1],
  ['1413', '1413:draw-and-sunder', 1],
  ['1413', '1413:s6:tune-strain-extra', 0.2],
  ['1509', '1509:spectral-analysis', 1],
  ['1510', '1510:silent-debate', 1],
] as const

function makeTuneStrainScope(tbb: number, tuneStrain: number): EffectScope {
  const runtime = {
    state: {
      combat: {},
    },
  } as unknown as EffectScope['sourceRuntime']
  const finalStats = { tbb } as NonNullable<EffectScope['finalStats']>

  return {
    sourceRuntime: runtime,
    sourceFinalStats: finalStats,
    targetRuntime: runtime,
    finalStats,
    context: {
      source: { type: 'resonator', id: '1209' },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      targetRuntimeId: '1209',
      activeResonatorId: '1209',
      teamMemberIds: ['1209'],
      sourceFinalStats: finalStats,
      finalStats,
      enemy: {
        status: { tuneStrain },
      },
    } as EffectScope['context'],
  }
}

function makeScope(havocBane: number): EffectScope {
  const runtime = {
    state: {
      combat: {
        havocBane,
      },
    },
  } as EffectScope['sourceRuntime']

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
    context: {
      echoSetCounts: {},
      team: {},
      source: { type: 'resonator', id: '1610' },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      targetRuntimeId: '1610',
      activeResonatorId: '1610',
      teamMemberIds: ['1610'],
    } as EffectScope['context'],
  }
}

function makeJinhsiScope(incandescence: number, forteSkillLevel: number): EffectScope {
  const runtime = {
    base: {
      sequence: 6,
      skillLevels: { forteCircuit: forteSkillLevel },
    },
    state: {
      controls: {
        'resonator:1304:incandescence:value': incandescence,
      },
      combat: {},
    },
  } as unknown as EffectScope['sourceRuntime']

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
  } as EffectScope
}

function makeSanhuaScope(stacks: number): EffectScope {
  const runtime = {
    base: { sequence: 6 },
    state: {
      controls: {
        'sequence:1102:s6:stacks': stacks,
      },
      combat: {},
    },
  } as unknown as EffectScope['sourceRuntime']

  return {
    sourceRuntime: runtime,
    targetRuntime: runtime,
  } as EffectScope
}

describe('resonator source invariants', () => {
  it('converts Sanhua Daybreak Radiance stacks to 10% team ATK each', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const sanhua = sources.find((source) => source.source.id === '1102')
    const effect = sanhua?.effects?.find(
      (candidate) => candidate.id === '1102:s6:daybreak-radiance',
    )
    const operation = effect?.operations[0]

    expect(effect).toMatchObject({
      targetScope: 'teamWide',
      operations: [{ type: 'add_base_stat', stat: 'atk', field: 'percent' }],
    })
    if (!operation || !('value' in operation)) {
      throw new Error('Sanhua Daybreak Radiance is missing its ATK formula')
    }

    expect(evalForm(operation.value, makeSanhuaScope(0))).toBe(0)
    expect(evalForm(operation.value, makeSanhuaScope(1))).toBe(10)
    expect(evalForm(operation.value, makeSanhuaScope(2))).toBe(20)
  })

  it('keeps Jinhsi Incandescence on Skill-typed Stella Glamor at its Forte scaling', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const jinhsi = sources.find((source) => source.source.id === '1304')
    const solarFlare = jinhsi?.skills?.find((skill) => skill.id === '1304030')
    const stellaGlamor = jinhsi?.skills?.find((skill) => skill.id === '1304039')
    const s6Base = jinhsi?.effects?.find(
      (effect) => effect.id === '1304:s6:thawing-triumph:skill',
    )
    const incandescence = jinhsi?.effects?.find(
      (effect) => effect.id === '1304:incandescence:stella-glamor',
    )
    const s6Incandescence = jinhsi?.effects?.find(
      (effect) => effect.id === '1304:s6:thawing-triumph:incandescence',
    )

    expect(solarFlare?.skillType).toEqual(['resonanceSkill'])
    expect(stellaGlamor?.skillType).toEqual(['resonanceSkill'])
    expect(s6Base?.operations[0]).toMatchObject({
      type: 'scale_skill_multiplier',
      match: { skillIds: ['1304030', '1304039'] },
    })
    expect(incandescence?.operations[0]).toMatchObject({
      type: 'add_skill_multiplier',
      match: { skillIds: ['1304039'] },
    })

    if (!jinhsi || !stellaGlamor || !s6Base || !incandescence || !s6Incandescence) {
      throw new Error('Jinhsi Illuminous Epiphany source data is incomplete')
    }

    const scope = makeJinhsiScope(50, 10)
    const incandescenceOperation = incandescence.operations[0]
    const s6IncandescenceOperation = s6Incandescence.operations[0]
    if (!('value' in incandescenceOperation) || !('value' in s6IncandescenceOperation)) {
      throw new Error('Jinhsi Incandescence effects are missing their value formulas')
    }

    expect(evalForm(incandescenceOperation.value, scope)).toBeCloseTo(50 * 0.4454)
    expect(evalForm(s6IncandescenceOperation.value, scope)).toBeCloseTo(50 * 0.4454 * 0.45)

    const s6BaseIndex = jinhsi.effects?.indexOf(s6Base) ?? -1
    const incandescenceIndex = jinhsi.effects?.indexOf(incandescence) ?? -1
    expect(s6BaseIndex).toBeGreaterThanOrEqual(0)
    expect(s6BaseIndex).toBeLessThan(incandescenceIndex)

    const levelOneScope = makeJinhsiScope(50, 1)
    const preparedStella = [s6Base, incandescence, s6Incandescence].reduce(
      (skill, effect) => effect.operations.reduce(
        (next, operation) => applySkllOp(next, operation, levelOneScope),
        skill,
      ),
      stellaGlamor,
    )
    expect(preparedStella.multiplier).toBeCloseTo((1.75 + 50 * 0.224) * 1.45)
  })

  it('routes Tune Strain responder damage increases through finalDmg', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]

    for (const [resonatorId, effectId, responseScale] of TUNE_STRAIN_RESPONSE_EFFECTS) {
      const resonator = sources.find((source) => source.source.id === resonatorId)
      const effect = resonator?.effects?.find((candidate) => candidate.id === effectId)
      const operation = effect?.operations[0]

      expect(effect, `${resonatorId} is missing ${effectId}`).toBeDefined()
      expect(effect?.operations).toHaveLength(1)
      expect(operation).toMatchObject({
        type: 'add_top_stat',
        stat: 'finalDmg',
      })
      if (!operation || !('value' in operation)) {
        throw new Error(`${effectId} is missing its value formula`)
      }

      expect(evalForm(operation.value, makeTuneStrainScope(100, 2))).toBeCloseTo(24 * responseScale)
    }
  })

  it('keeps Luuk S6 at a flat two additional Tune Strain stacks', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const luuk = sources.find((source) => source.source.id === '1510')
    const effect = luuk?.effects?.find((candidate) => candidate.id === '1510:s6:tune-strain-extra')
    const operation = effect?.operations[0]

    expect(effect).toBeDefined()
    expect(operation).toMatchObject({
      type: 'add_top_stat',
      stat: 'finalDmg',
    })
    if (!operation || !('value' in operation)) {
      throw new Error('Luuk S6 Tune Strain effect is missing its value formula')
    }

    expect(evalForm(operation.value, makeTuneStrainScope(100, 1))).toBeCloseTo(24)
    expect(evalForm(operation.value, makeTuneStrainScope(100, 4))).toBeCloseTo(24)
  })

  it('keeps Lupa Glory active and makes the S3 Pack Hunt waiver automatic', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const details = JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>
    const lupa = sources.find((source) => source.source.id === '1207')
    const packHuntBonus = lupa?.effects?.find(
      (effect) => effect.id === '1207:pack-hunt:team:bonus',
    )
    const s3Glory = lupa?.effects?.find((effect) => effect.id === '1207:lvl70:s3')
    const stateNodes = details['1207']?.stateGraph?.nodes ?? []
    const glory = stateNodes.find((node) => node.key === 'inherent:1207:lvl70:stacks')

    expect(packHuntBonus?.condition).toEqual({
      type: 'and',
      values: [
        {
          type: 'truthy',
          from: 'sourceRuntime',
          path: 'state.controls.team:1207:pack_hunt:active',
        },
        {
          type: 'or',
          values: [
            {
              type: 'gte',
              from: 'context',
              path: 'team.attributeCounts.fusion',
              value: 3,
            },
            {
              type: 'gte',
              from: 'sourceRuntime',
              path: 'base.sequence',
              value: 3,
            },
          ],
        },
      ],
    })
    expect(glory).toMatchObject({
      kind: 'select',
      options: [
        { id: '0' },
        { id: '1' },
        { id: '2' },
        { id: '3' },
      ],
    })
    expect(glory).not.toHaveProperty('sequenceAwareOptions')
    expect(stateNodes.some((node) => node.key === 'sequence:1207:s3:active')).toBe(false)
    expect(s3Glory).toMatchObject({
      targetScope: 'teamWide',
      condition: {
        type: 'and',
        values: [
          { type: 'gte', from: 'sourceRuntime', path: 'base.level', value: 70 },
          { type: 'gte', from: 'sourceRuntime', path: 'base.sequence', value: 3 },
          {
            type: 'gt',
            from: 'sourceRuntime',
            path: 'state.controls.inherent:1207:lvl70:stacks',
            value: 0,
          },
        ],
      },
      operations: [
        {
          type: 'add_attribute_mod',
          attribute: 'fusion',
          mod: 'resShred',
          value: { type: 'const', value: 15 },
        },
      ],
    })
  })

  it('keeps Aemeath Between the Stars selectable before its mode is materialized', () => {
    const details = JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>
    const stateNodes = details['1210']?.stateGraph?.nodes ?? []
    const betweenTheStars = stateNodes.find(
      (node) => node.key === 'inherent:1210:lvl70:stacks',
    )

    expect(betweenTheStars).toMatchObject({
      kind: 'select',
      defaultValue: '0',
      options: [
        { id: '0' },
        { id: '1' },
        { id: '2' },
        { id: '3' },
      ],
      optionsWhen: [
        {
          options: [
            { id: '0' },
            { id: '1' },
            { id: '2' },
            { id: '3' },
          ],
        },
        {
          options: [
            { id: '0' },
            { id: '1' },
            { id: '2' },
          ],
        },
      ],
    })
  })

  it('gives every conditional select state a static rotation-authoring fallback', () => {
    const details = JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>

    for (const [resonatorId, resonator] of Object.entries(details)) {
      for (const node of resonator.stateGraph?.nodes ?? []) {
        if (node.kind !== 'select' || !node.optionsWhen?.length) {
          continue
        }

        expect(
          node.options?.length,
          `${resonatorId}:${node.key} has conditional options but no static fallback`,
        ).toBeGreaterThan(0)
        expect(
          node.options?.some((option) => String(
            typeof option === 'object' ? option.id : option,
          ) === String(node.defaultValue)),
          `${resonatorId}:${node.key} omits its default from the static fallback`,
        ).toBe(true)
      }
    }
  })

  it('caps Xuanling Unbroken Vow at 66 amplify across six Havoc Bane stacks', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const xuanling = sources.find((source) => source.source.id === '1610')
    expect(xuanling).toBeDefined()

    const expectedByStack = [10, 20, 30, 42, 54, 66]
    const effects = xuanling?.effects?.filter((effect) => effect.id.startsWith('1610:unbroken-vow:')) ?? []

    expect(effects).toHaveLength(2)

    for (const [index, expected] of expectedByStack.entries()) {
      const stack = index + 1
      const effect = effects.find((candidate) => (
        stack < 4
          ? candidate.id === '1610:unbroken-vow:low'
          : candidate.id === '1610:unbroken-vow:high'
      ))
      const operation = effect?.operations[0]
      const value = operation && 'value' in operation ? operation.value : undefined

      expect(value).toBeDefined()
      expect(evalForm(value as FormExpr, makeScope(stack))).toBe(expected)
    }
  })
})

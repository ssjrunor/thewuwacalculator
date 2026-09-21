/*
  Author: Runor Ewhro
  Description: Protects generated resonator-source invariants that are easy to
               regress during authored override updates.
*/

import { describe, expect, it } from 'vitest'
import type { ResDtls } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SkillDamageEntry, SkillDef } from '@/domain/entities/stats'
import type { EffectScope, FormExpr, SrcPkg } from '@/domain/gameData/contracts'
import { mkGameDataRe } from '@/data/gameData/registry'
import { applySkllOp } from '@/engine/effects/dataEffects'
import { evalForm } from '@/engine/effects/evaluator'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import { makeCustomBuff } from '@/engine/runtime/defaults'
import resonatorDamageEntriesRaw from '../../../../public/data/beta/resonators/damage-entries.json?raw'
import resonatorDetailsRaw from '../../../../public/data/beta/resonators/details.json?raw'
import resonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'

const TUNE_STRAIN_RESPONSE_EFFECTS = [
  ['1209', '1209:decoupling', 1],
  ['1211', '1211:shattered-hours', 1],
  ['1413', '1413:draw-and-sunder', 1],
  ['1413', '1413:s6:tune-strain-extra', 0.2],
  ['1509', '1509:spectral-analysis', 1],
  ['1510', '1510:silent-debate', 1],
  ['1510', '1510:s6:tune-strain-extra', 1],
] as const

function makeTuneStrainScope(
  tbb: number,
  tuneStrain: number,
  offTuneBuildupRate = 1,
): EffectScope {
  const runtime = {
    state: {
      combat: {},
    },
  } as unknown as EffectScope['sourceRuntime']
  const finalStats = { tbb, offTuneBuildupRate } as NonNullable<EffectScope['finalStats']>

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
  it('preserves every fully linked base skill coefficient at level 1 and 10', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const allEntries = JSON.parse(resonatorDamageEntriesRaw) as SkillDamageEntry[]
    const entriesByResonator = new Map<string, SkillDamageEntry[]>()
    for (const entry of allEntries) {
      const entries = entriesByResonator.get(entry.resonatorId) ?? []
      entries.push(entry)
      entriesByResonator.set(entry.resonatorId, entries)
    }

    for (const source of sources) {
      const registry = mkGameDataRe([{
        ...source,
        damageEntries: entriesByResonator.get(source.source.id) ?? [],
      }])

      for (const skill of registry.resonatorSkillsById[source.source.id] ?? []) {
        if (!skill.damageEntries?.some((entry) => !entry.replacesEntryId)) {
          continue
        }

        for (const level of [1, 10]) {
          const runtime = {
            id: source.source.id,
            base: {
              sequence: 0,
              skillLevels: {
                normalAttack: level,
                resonanceSkill: level,
                forteCircuit: level,
                resonanceLiberation: level,
                introSkill: level,
                tuneBreak: level,
              },
            },
            build: { team: [], echoes: [] },
            state: {
              controls: {},
              combat: {},
              manualBuffs: makeCustomBuff(),
            },
          } as unknown as ResRuntime
          const withEntries = resolveSkill(runtime, skill)
          const withoutEntries = resolveSkill(runtime, { ...skill, damageEntries: undefined })

          expect(withEntries.multiplier, `${source.source.id}:${skill.id}@${level}`).toBeCloseTo(
            withoutEntries.multiplier,
            10,
          )
          const hitShape = (hits: SkillDef['hits']) => hits.map(({ count, multiplier }) => ({
            count,
            multiplier,
          }))
          expect(hitShape(withEntries.hits), `${source.source.id}:${skill.id}@${level}`).toEqual(
            hitShape(withoutEntries.hits),
          )
        }
      }
    }
  })

  it('links Lynae DamageList packets to hits and resolves authored sequence replacements', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const allEntries = JSON.parse(resonatorDamageEntriesRaw) as SkillDamageEntry[]
    const lynae = sources.find((source) => source.source.id === '1509')
    const entries = allEntries.filter((entry) => entry.resonatorId === '1509')

    expect(entries).toHaveLength(45)
    expect(entries.filter((entry) => entry.provenance === 'matched')).toHaveLength(39)
    expect(entries.filter((entry) => entry.provenance === 'authored')).toHaveLength(6)
    expect(entries.filter((entry) => entry.provenance === 'unlinked')).toHaveLength(0)

    const visualBase = entries.find((entry) => entry.id === '15090270020')
    const visualS3 = entries.find((entry) => entry.id === '15090270021')
    expect(visualBase).toMatchObject({
      skillId: '1509009',
      hitIndex: 0,
      count: 1,
      multiplier: 6.12,
      skillType: ['basicAtk'],
      element: 'spectro',
      scaling: { atk: 1, hp: 0, def: 0, energyRegen: 0 },
      energy: 14.05,
      elementPower: 14.58,
      toughness: 2,
      weakness: 6.096,
    })
    expect(visualBase?.values).toHaveLength(20)
    expect(visualS3).toMatchObject({
      skillId: '1509009',
      replacesEntryId: '15090270020',
      variantWhen: {
        type: 'gte',
        from: 'sourceRuntime',
        path: 'base.sequence',
        value: 3,
      },
    })
    expect(visualS3?.values).toHaveLength(20)

    if (!lynae) {
      throw new Error('Lynae source data is missing')
    }
    const registry = mkGameDataRe([{ ...lynae, damageEntries: entries }])
    const visual = registry.resonatorSkillsById['1509']?.find((skill) => skill.id === '1509009')
    const visualFeature = lynae.features?.find((feature) => feature.damageEntryId === '15090270020')
    expect(registry.damageEntriesByKey['1509:15090270020']).toBeDefined()
    expect(visual?.damageEntries).toHaveLength(2)
    expect(visualFeature).toMatchObject({
      variant: 'subHit',
      hitIndex: 0,
      damageEntryId: '15090270020',
    })
    if (!visual) {
      throw new Error('Visual Impact skill is missing')
    }

    const makeRuntime = (sequence: number): ResRuntime => ({
      id: '1509',
      base: {
        sequence,
        skillLevels: {
          normalAttack: 1,
          resonanceSkill: 1,
          forteCircuit: 1,
          resonanceLiberation: 1,
          introSkill: 1,
          tuneBreak: 1,
        },
      },
      build: { team: [], echoes: [] },
      state: {
        controls: {},
        combat: {},
        manualBuffs: makeCustomBuff(),
      },
    } as unknown as ResRuntime)

    const baseResolved = resolveSkill(makeRuntime(0), visual)
    const s3Resolved = resolveSkill(makeRuntime(3), visual)
    expect(baseResolved.multiplier).toBeCloseTo(6.12)
    expect(baseResolved.damageEntries?.[0]?.id).toBe('15090270020')
    expect(s3Resolved.multiplier).toBeCloseTo(11.628)
    expect(s3Resolved.damageEntries?.[0]).toMatchObject({
      id: '15090270021',
      replacesEntryId: '15090270020',
    })
  })

  it('retains Lynae S1 and S5 multiplier effects through resonator generation', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const lynae = sources.find((source) => source.source.id === '1509')

    expect(lynae?.effects?.find((effect) => effect.id === '1509:s1:polychrome-leap'))
      .toMatchObject({
        condition: {
          type: 'gte',
          from: 'sourceRuntime',
          path: 'base.sequence',
          value: 1,
        },
        operations: [{
          type: 'scale_skill_multiplier',
          match: { skillIds: ['1509020', '1509021', '1509022'] },
          value: { type: 'const', value: 2.2 },
        }],
      })
    expect(lynae?.effects?.find((effect) => effect.id === '1509:s5:prismatic-overblast'))
      .toMatchObject({
        condition: {
          type: 'gte',
          from: 'sourceRuntime',
          path: 'base.sequence',
          value: 5,
        },
        operations: [{
          type: 'scale_skill_multiplier',
          match: { skillIds: ['1509010'] },
          value: { type: 'const', value: 1.7 },
        }],
      })
  })

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
      expect(effect?.stage).toBe('finalStats')
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

  it('authors Mornye buildup rate and Denia Shifting as distinct Off-Tune effects', () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const mornye = sources.find((source) => source.source.id === '1209')
    const denia = sources.find((source) => source.source.id === '1211')
    const mornyeBase = mornye?.effects?.find((effect) => effect.id === '1209:syntony-field')
    const mornyeHigh = mornye?.effects?.find((effect) => effect.id === '1209:high-syntony')
    const mornyeS2 = mornye?.effects?.find((effect) => effect.id === '1209:s2:syntony-off-tune')
    const deniaShifting = denia?.effects?.find(
      (effect) => effect.id === '1211:tune-strain:direct-off-tune',
    )
    const deniaBoost = denia?.effects?.find(
      (effect) => effect.id === '1211:lvl70:tune-break-boost',
    )

    expect(mornyeBase).toMatchObject({
      targetScope: 'teamWide',
      operations: expect.arrayContaining([{
        type: 'add_top_stat',
        stat: 'offTuneBuildupRate',
        value: { type: 'const', value: 0.5 },
      }]),
    })
    expect(mornyeS2).toMatchObject({
      targetScope: 'teamWide',
      operations: [{
        type: 'add_top_stat',
        stat: 'offTuneBuildupRate',
        value: { type: 'const', value: 0.2 },
      }],
    })
    expect(mornyeHigh).toMatchObject({
      targetScope: 'teamWide',
      operations: [{
        type: 'add_base_stat',
        stat: 'def',
        field: 'percent',
        value: { type: 'const', value: 20 },
      }],
    })
    expect(deniaShifting).toMatchObject({
      description: expect.stringContaining('50% of the max (19.2)'),
      trigger: 'skill',
      targetScope: 'teamWide',
      condition: {
        type: 'and',
        values: expect.arrayContaining([{
          type: 'truthy',
          from: 'sourceRuntime',
          path: 'state.controls.team:1211:tune_strain_shifting:active',
        }]),
      },
      operations: [{
        type: 'add_skill_scalar',
        field: 'directOffTune',
        value: { type: 'const', value: 19.2 },
      }],
    })
    expect(mornye?.owners?.find((owner) => owner.id === 'high_syntony_field')?.description)
      .toContain('50%')
    expect(mornye?.owners?.find((owner) => owner.id === 'syntony_field')?.description)
      .toContain('50%')
    expect(mornye?.owners?.find((owner) => owner.id === 'entropic_morning')?.description)
      .toContain('20%')
    expect(deniaBoost?.stage).toBe('postStats')

    const mornyeDetails = (JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>)['1209']
    expect(mornyeDetails?.stateGraph?.nodes).toContainEqual(expect.objectContaining({
      key: 'team:1209:syntony_field:active',
      label: 'Syntony Field',
    }))

    const boostOperation = deniaBoost?.operations[0]
    if (!boostOperation || !('value' in boostOperation)) {
      throw new Error('Denia Etched Colors is missing its Tune Break Boost formula')
    }
    expect(evalForm(boostOperation.value, makeTuneStrainScope(0, 0, 1))).toBe(10)
    expect(evalForm(boostOperation.value, makeTuneStrainScope(0, 0, 1.5))).toBe(50)

    const deniaDetails = (JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>)['1211']
    const deniaStates = deniaDetails?.stateGraph?.nodes ?? []
    expect(deniaStates.some((state) => state.key.includes('off_tune_overcap'))).toBe(false)
    expect(deniaDetails?.statePanels.some((panel) => panel.title === 'Tune Strain - Shifting')).toBe(false)
    expect(deniaStates.find(
      (state) => state.key === 'team:1211:tune_strain_shifting:active',
    )).toMatchObject({
      kind: 'toggle',
      label: 'Tune Strain - Shifting Applied',
    })
  })

  it("adds Qingxiao Heaven's Clarity Off-Tune before buildup rate", () => {
    const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]
    const qingxiao = sources.find((source) => source.source.id === '1413')
    const effect = qingxiao?.effects?.find((candidate) => candidate.id === '1413:heavens-clarity')

    expect(effect).toMatchObject({
      trigger: 'skill',
      targetScope: 'self',
      operations: expect.arrayContaining([
        {
          type: 'scale_skill_multiplier',
          match: { skillIds: ['1413406'] },
          value: { type: 'const', value: 2 },
        },
        {
          type: 'add_skill_scalar',
          field: 'offTune',
          match: { skillIds: ['1413406'] },
          value: { type: 'const', value: 15.2 },
        },
      ]),
    })

    const qingxiaoDetails = (JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>)['1413']
    expect(qingxiaoDetails?.statePanels.find((panel) => panel.title === "Heaven's Clarity")?.body)
      .toBe("When casting Heavy Attack - Stringblade, inflict 3 stacks of Mindlock on nearby targets, and enhance the next Heavy Attack - Heaven's Reckoning: Ephemeral Transcendence: its DMG Multiplier is increased by 100% and it builds additional Off-Tune Level on the target.")
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

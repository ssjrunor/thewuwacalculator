/*
  Author: Runor Ewhro
  description: protects generated resonator-source invariants that are easy to
               regress during authored override updates.
*/

import { describe, expect, it } from 'vitest'
import type { ResDtls } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { SkillDamageEntry, SkillDef } from '@/domain/entities/stats'
import type { EffectScope, SrcPkg } from '@/domain/gameData/contracts'
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
})

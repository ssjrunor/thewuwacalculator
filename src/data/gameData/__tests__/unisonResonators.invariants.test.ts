/*
  Author: Runor Ewhro
  Description: Protects the generated contracts for the first Unison Resonators.
*/

import { describe, expect, it } from 'vitest'
import type { ResDtls } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { EffectDef, EffectScope, SourceState, SrcPkg } from '@/domain/gameData/contracts'
import { getResNumMax } from '@/engine/gameData/controlOptions'
import { evalCond, evalForm } from '@/engine/effects/evaluator'
import { ffctTrgtRt } from '@/engine/effects/targetScope'
import resonatorDetailsRaw from '../../../../public/data/beta/resonators/details.json?raw'
import resonatorSourcesRaw from '../../../../public/data/beta/resonators/sources.json?raw'

const details = JSON.parse(resonatorDetailsRaw) as Record<string, ResDtls>
const sources = JSON.parse(resonatorSourcesRaw) as SrcPkg[]

function sourceFor(resonatorId: string): SrcPkg {
  const source = sources.find((candidate) => candidate.source.id === resonatorId)
  if (!source) {
    throw new Error(`Missing generated source for Resonator ${resonatorId}`)
  }
  return source
}

function skillIdsByType(resonatorId: string): Record<string, string[]> {
  const grouped: Record<string, string[]> = {}

  for (const skill of sourceFor(resonatorId).skills ?? []) {
    const key = skill.skillType.join('+')
    grouped[key] ??= []
    grouped[key].push(skill.id)
  }

  return grouped
}

function unisonEffectApplies(
  effect: EffectDef,
  sourceId: string,
  targetId: string,
  options: {
    sourceMode?: 'unison' | 'electro_flare'
    sourceSequence?: number
    targetMode?: 'unison' | 'electro_flare'
  } = {},
): boolean {
  const makeRuntime = (
    id: string,
    mode: 'unison' | 'electro_flare' = 'unison',
    sequence = 6,
  ) => ({
    id,
    base: { sequence },
    state: {
      controls: id === '1311'
        ? { 'resonator:1311:mode:value': mode }
        : {},
    },
  }) as unknown as EffectScope['sourceRuntime']

  const sourceRuntime = makeRuntime(sourceId, options.sourceMode, options.sourceSequence)
  const targetRuntime = sourceId === targetId
    ? sourceRuntime
    : makeRuntime(targetId, options.targetMode)
  const context = {
    source: effect.source,
    sourceRuntime,
    targetRuntime,
    targetRuntimeId: targetId,
    activeResonatorId: targetId,
    teamMemberIds: ['1311', '1312', '1302'],
  } as EffectScope['context']
  const scope = { sourceRuntime, targetRuntime, context } as EffectScope

  return ffctTrgtRt(effect, context) && evalCond(effect.condition, scope)
}

function unisonEffectValue(effect: EffectDef, sourceId: string, stacks: number): number {
  const operation = effect.operations[0]
  if (!operation || !('value' in operation)) {
    throw new Error(`${effect.id} has no value formula`)
  }

  const runtime = {
    id: sourceId,
    state: {
      controls: {
        [`resonator:${sourceId}:unison_boon:stacks`]: stacks,
      },
    },
  } as unknown as EffectScope['sourceRuntime']
  const scope = {
    sourceRuntime: runtime,
    targetRuntime: runtime,
    context: {
      source: effect.source,
      sourceRuntime: runtime,
      targetRuntime: runtime,
      targetRuntimeId: sourceId,
      activeResonatorId: sourceId,
      teamMemberIds: ['1311', '1312'],
    },
  } as EffectScope

  return evalForm(operation.value, scope)
}

function suomingUnisonBoonMax(
  state: Pick<SourceState, 'max' | 'maxWhen'>,
  hsinSequence: number | null,
  hsinSlot: 0 | 1 = 0,
): number | undefined {
  const hsinRuntime = hsinSequence == null
    ? null
    : { id: '1311', base: { sequence: hsinSequence } }
  const teamRuntimes = [null, null] as [typeof hsinRuntime, typeof hsinRuntime]
  teamRuntimes[hsinSlot] = hsinRuntime

  const runtime = {
    id: '1312',
    base: { sequence: 6 },
    build: {
      team: hsinSequence == null
        ? ['1312', null, null]
        : ['1312', '1311', null],
      echoes: [],
    },
    teamRuntimes,
  } as unknown as ResRuntime

  return getResNumMax(runtime, state)
}

describe('Unison Resonator generated contracts', () => {
  it('authors Hsin from the Simplified Chinese duration and preserves her Electro Flare rows', () => {
    const hsin = sourceFor('1311')
    const inherent = details['1311']?.inherentSkills.find((entry) => entry.unlockLevel === 50)
    const skills = new Map(hsin.skills?.map((skill) => [skill.id, skill]))

    expect(inherent?.desc).toContain('30s')
    expect(inherent?.desc).not.toContain('7s')
    expect(details['1311']?.negativeEffectSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'electroFlare' }),
      expect.objectContaining({ type: 'maxAdd', key: 'electroFlare', value: 6 }),
    ]))
    expect(skills.get('1311:heart-of-thunder:five-stack')).toMatchObject({
      multiplier: 1.75,
      archetype: 'electroFlare',
      skillType: ['electroFlare'],
    })
    expect(skills.get('1311:heart-of-thunder:remaining')).toMatchObject({
      multiplier: 0.35,
      archetype: 'electroFlare',
      skillType: ['electroFlare'],
    })
    expect(skills.get('1311:s3:pillars-electro-flare')).toMatchObject({
      multiplier: 15,
      archetype: 'electroFlare',
      skillType: ['electroFlare'],
    })
  })

  it('keeps each Hsin calculator description scoped to the effect it applies', () => {
    const hsin = details['1311']
    const rawForte = hsin?.skillsByTab.forteCircuit?.desc ?? ''
    const expectedTides = hsin?.inherentSkills.find((entry) => entry.unlockLevel === 50)?.desc
    const rawSequence = hsin?.resonanceChains.find(
      (entry) => entry.name === 'A River of Lanterns, a River of Wishes',
    )?.desc
    const source = sourceFor('1311')
    const owners = new Map((source.owners ?? []).map((owner) => [owner.ownerKey, owner]))
    const authoredEffects = source.effects ?? []
    const effects = new Map(authoredEffects.map((effect) => [effect.id, effect]))
    const states = new Map(hsin?.stateGraph?.nodes.map((state) => [state.key, state]))
    const resonanceModes = hsin?.stateGraph?.groups?.find((group) => group.id === 'mode')?.modes

    expect(expectedTides).toContain('both Hsin and Rover: Electro gain 20% Electro DMG Bonus for 30s.')
    expect(expectedTides).not.toContain('both Hsin and Rover: Electro gain 20% Electro DMG Bonus for 7s.')
    expect(owners.get('team:1311:rover_electro_resonance')?.description).toContain(
      'Rover: Electro casting <span style="color:#ffd12f;" class="font-bold">Intro Skill - Thunderous Fury</span>',
    )
    expect(owners.get('team:1311:rover_electro_resonance')?.description).not.toContain('Manifold Unison')
    expect(owners.get('team:1311:herself_a_thousand_lanterns')?.description).not.toContain(
      'dealing <span style="color:#ebb0ff;">Electro DMG</span>',
    )
    expect(states.get('inherent:1311:lvl50:unison_active')?.description).toContain(
      'increases Hsin\'s ATK by 50% for 8s',
    )
    expect(states.get('inherent:1311:lvl50:unison_active')?.description).not.toContain('stacking up to 2 times')
    expect(states.get('inherent:1311:lvl50:electro_flare_stacks')?.description).toContain(
      'Hsin gains 25% Electro DMG Bonus, stacking up to 2 times',
    )
    expect(states.get('inherent:1311:lvl50:electro_flare_stacks')?.description).not.toContain('Thunderous Fury')
    expect(states.get('team:1311:rover_electro_resonance:active')?.description).toContain(
      'both Hsin and Rover: Electro 20% Electro DMG Bonus for 30s',
    )
    expect(states.get('team:1311:rover_electro_resonance:active')?.description).not.toContain('stacking up to 2 times')
    expect(states.get('sequence:1311:s4:active')?.description).toBe(rawSequence)

    expect(authoredEffects.every((effect) => Boolean(effect.description))).toBe(true)
    expect(effects.get('1311:s6:resonance-skill-vulnerability')?.description).toBe(
      'Targets take 40% more Resonance Skill DMG from Hsin.',
    )
    expect(effects.get('1311:s6:resonance-skill-def-ignore')?.description).toBe(
      'Resonance Skill DMG dealt by Hsin ignores 20% of the target\'s DEF.',
    )
    expect(effects.get('1311:lvl50:unison-intro')).toMatchObject({
      operations: [{
        type: 'add_base_stat',
        stat: 'atk',
        field: 'percent',
        value: { type: 'const', value: 50 },
      }],
    })
    expect(effects.get('1311:s1:heart-of-thunder')).toMatchObject({
      operations: [{
        type: 'scale_skill_multiplier',
        value: { type: 'const', value: 1.2 },
      }],
    })
    expect(effects.get('1311:outro:unison')?.description).not.toContain(
      'Electro DMG dealt by Resonators in the team other than Hsin',
    )
    expect(effects.get('1311:outro:electro-flare')?.description).not.toContain('Shared Light')

    for (const ownerKey of ['resonator:1311:unison_boon']) {
      expect(rawForte).toContain(owners.get(ownerKey)?.description)
    }
    expect(resonanceModes?.find((mode) => mode.id === 'unison')?.body).toContain(
      'the next cast of <span style="color:#ffd12f;" class="font-bold">Resonance Liberation - Formshift</span>',
    )
    expect(resonanceModes?.find((mode) => mode.id === 'electro_flare')?.body).toContain(
      'targets within a certain range do not lose',
    )
  })

  it('routes each resonator Unison Boon contribution to every Unison Response teammate', () => {
    const hsinEffects = sourceFor('1311').effects ?? []
    const suomingEffects = sourceFor('1312').effects ?? []
    const hsinBoon = hsinEffects.find((effect) => effect.id === '1311:unison-boon')
    const suomingBoon = suomingEffects.find((effect) => effect.id === '1312:unison-boon:base')
    const suomingS6 = suomingEffects.find((effect) => effect.id === '1312:s6:unison-boon')

    expect(hsinBoon?.targetScope).toBe('teamWide')
    expect(suomingBoon?.targetScope).toBe('teamWide')
    expect(suomingS6?.targetScope).toBe('teamWide')
    if (!hsinBoon || !suomingBoon || !suomingS6) {
      throw new Error('Missing an authored Unison Boon effect')
    }

    expect(unisonEffectApplies(hsinBoon, '1311', '1311')).toBe(true)
    expect(unisonEffectApplies(hsinBoon, '1311', '1312')).toBe(true)
    expect(unisonEffectApplies(hsinBoon, '1311', '1302')).toBe(false)
    expect(unisonEffectApplies(hsinBoon, '1311', '1312', {
      sourceMode: 'electro_flare',
    })).toBe(false)

    expect(unisonEffectApplies(suomingBoon, '1312', '1312')).toBe(true)
    expect(unisonEffectApplies(suomingBoon, '1312', '1311')).toBe(true)
    expect(unisonEffectApplies(suomingBoon, '1312', '1311', {
      targetMode: 'electro_flare',
    })).toBe(false)
    expect(unisonEffectApplies(suomingBoon, '1312', '1302')).toBe(false)

    expect(unisonEffectApplies(suomingS6, '1312', '1311')).toBe(true)
    expect(unisonEffectApplies(suomingS6, '1312', '1311', {
      sourceSequence: 5,
    })).toBe(false)

    expect(unisonEffectValue(hsinBoon, '1311', 3)).toBe(9)
    expect(unisonEffectValue(suomingBoon, '1312', 2)).toBe(6)
  })

  it('classifies every Hsin damage row by the damage types stated in her descriptions', () => {
    expect(skillIdsByType('1311')).toEqual({
      basicAtk: [
        '1311101',
        '1311102',
        '1311103',
        '1311104',
        '1311106',
        '1311108',
        '1311109',
        '1311110',
        '1311111',
        '1311112',
        '1311113',
        '1311115',
        '1311116',
        '1311117',
        '1311118',
        '1311119',
        '1311120',
        '1311121',
        '1311122',
      ],
      heavyAtk: ['1311105', '1311107', '1311114'],
      resonanceSkill: [
        '1311201',
        '1311202',
        '1311203',
        '1311701',
        '1311702',
        '1311703',
        '1311704',
        '1311302',
        '1311603',
        '1311606',
      ],
      electroFlare: [
        '1311:heart-of-thunder:five-stack',
        '1311:heart-of-thunder:remaining',
        '1311:s3:pillars-electro-flare',
        '1311:negative-effect:electro-flare',
      ],
      coord: ['1311303'],
      introSkill: ['1311601', '1311602', '1311604', '1311605'],
      outroSkill: ['1311:outro'],
      tuneRupture: ['1311:tune-break'],
      spectroFrazzle: ['1311:negative-effect:spectro-frazzle'],
      aeroErosion: ['1311:negative-effect:aero-erosion'],
      fusionBurst: ['1311:negative-effect:fusion-burst'],
      glacioChafe: ['1311:negative-effect:glacio-chafe'],
    })
  })

  it('authors Hsin\'s Source Intent Unison loop without overcounting the Answering setup', () => {
    const rotation = sourceFor('1311').rotations?.find((candidate) => candidate.id === 'default')

    expect(rotation?.items.flatMap((item) => (
      item.type === 'feature' ? [[item.featureId, item.multiplier]] : []
    ))).toEqual([
      ['damage:1311603', 1],
      ['damage:1311201', 1],
      ['damage:1311104', 1],
      ['damage:1311702', 1],
      ['damage:1311:outro', 1],
      ['damage:1311303', 21],
      ['damage:1311606', 1],
      ['damage:1311118', 1],
      ['damage:1311119', 1],
      ['damage:1311120', 1],
      ['damage:1311121', 1],
      ['damage:1311704', 1],
      ['damage:1311302', 1],
      ['damage:1311:outro', 1],
    ])
    expect(rotation?.items).not.toContainEqual(expect.objectContaining({
      featureId: 'damage:1311103',
    }))
  })

  it('authors Suoming\'s two-entry Unison loop and all six Thunder Crests', () => {
    const suoming = sourceFor('1312')
    const rotation = suoming.rotations?.find((candidate) => candidate.id === 'default')
    const skills = new Map(suoming.skills?.map((skill) => [skill.id, skill]))

    expect(rotation?.items.flatMap((item) => (
      item.type === 'feature' ? [[item.featureId, item.multiplier]] : []
    ))).toEqual([
      ['damage:1312026', 1],
      ['damage:1312021', 1],
      ['damage:1312025', 6],
      ['damage:1312027', 1],
      ['damage:1312012', 1],
      ['damage:1312006', 1],
      ['damage:1312007', 1],
      ['damage:1312017', 1],
      ['damage:1312018', 1],
    ])
    expect(rotation?.items).not.toContainEqual(expect.objectContaining({
      featureId: 'damage:1312011',
    }))
    expect(['1312026', '1312027', '1312028', '1312029'].map((id) => skills.get(id)?.skillType)).toEqual([
      ['basicAtk'],
      ['basicAtk'],
      ['basicAtk'],
      ['basicAtk'],
    ])
    expect(skills.get('1312025')?.skillType).toEqual(['coord'])
  })

  it('keeps each Suoming calculator description scoped to its trigger and applied effect', () => {
    const suoming = details['1312']
    const rawForte = suoming?.skillsByTab.forteCircuit?.desc ?? ''
    const rawOutro = suoming?.outroSkills.find((entry) => entry.name === 'Canopy Rumble')?.desc
    const source = sourceFor('1312')
    const owners = new Map((source.owners ?? []).map((owner) => [owner.ownerKey, owner]))
    const authoredEffects = source.effects ?? []
    const effects = new Map(authoredEffects.map((effect) => [effect.id, effect]))
    const states = new Map(suoming?.stateGraph?.nodes.map((state) => [state.key, state]))

    expect(owners.get('team:1312:canopy_rumble')?.description).toBe(rawOutro)
    expect(rawForte).toContain(owners.get('resonator:1312:unison_boon')?.description)
    expect(owners.get('team:1312:incoming_unison_boon')?.description).toContain(
      'Set this to the number of',
    )
    expect(owners.get('team:1312:incoming_unison_boon')?.description).not.toContain(
      'When Suoming has <span style="color:#ffd12f;" class="font-bold">Unison</span> and is switched out',
    )

    expect(states.get('inherent:1312:lvl50:active')?.description).toContain(
      'grants 50% Electro DMG Bonus for 15s',
    )
    expect(states.get('inherent:1312:lvl50:active')?.description).not.toContain('Concerto Energy')
    expect(states.get('inherent:1312:aligned_seals:active')?.description).toContain(
      '30% Electro DMG Bonus, plus an additional 20%',
    )
    expect(states.get('inherent:1312:aligned_seals:active')?.description).toContain(
      'Within 8s after Suoming casts',
    )
    expect(states.get('inherent:1312:aligned_seals:active')?.description).not.toContain('Seal Master')
    expect(states.get('resonator:1312:seal_master:active')?.description).toContain(
      'grants <span style="color:#ffd12f;" class="font-bold">Seal Master</span>',
    )
    expect(states.get('resonator:1312:seal_master:active')?.description).toContain(
      'each stage restores 5 Concerto Energy on hit',
    )
    expect(states.get('resonator:1312:seal_master:active')?.description).not.toContain(
      'chain into <span style="color:#ffd12f;" class="font-bold">Basic Attack - Unfurled Canopy Stage 2</span>',
    )
    expect(states.get('sequence:1312:s3:active')?.description).toContain(
      'Casting <span style="color:#ffd12f;" class="font-bold">Resonance Liberation</span>',
    )
    expect(states.get('sequence:1312:s3:active')?.description).not.toContain('grants 1 stacks')

    expect(authoredEffects.every((effect) => Boolean(effect.description))).toBe(true)
    expect(effects.get('1312:lvl70:seal-master-multiplier')?.description).not.toContain('Crit. DMG')
    expect(effects.get('1312:lvl70:seal-master-crit-dmg')?.description).not.toContain('DMG Multipliers')
    expect(effects.get('1312:lvl70:seal-master-multiplier')).toMatchObject({
      operations: [{
        type: 'add_skill_multiplier',
        value: { type: 'const', value: 1 },
      }],
    })
    expect(effects.get('1312:lvl70:seal-master-crit-dmg')).toMatchObject({
      operations: [{
        type: 'add_top_stat',
        stat: 'critDmg',
        value: { type: 'const', value: 100 },
      }],
    })
    expect(effects.get('1312:s6:seal-master-crit-dmg')).toMatchObject({
      operations: [{
        type: 'add_top_stat',
        stat: 'critDmg',
        value: { type: 'const', value: 200 },
      }],
    })
    expect(effects.get('1312:outro:electro')?.description).not.toContain('Resonance Skill DMG')
    expect(effects.get('1312:outro:resonance-skill')?.description).not.toContain(
      '20% Electro DMG Amplification',
    )
  })

  it('classifies every Suoming damage row by the damage types stated in her descriptions', () => {
    expect(skillIdsByType('1312')).toEqual({
      basicAtk: [
        '1312001',
        '1312002',
        '1312003',
        '1312004',
        '1312005',
        '1312006',
        '1312007',
        '1312008',
        '1312009',
        '1312010',
        '1312011',
        '1312012',
        '1312016',
        '1312017',
        '1312018',
        '1312019',
        '1312026',
        '1312027',
        '1312028',
        '1312029',
      ],
      resonanceSkill: ['1312013', '1312014'],
      resonanceLiberation: ['1312021'],
      coord: ['1312025'],
      tuneRupture: ['1312:tune-break'],
      spectroFrazzle: ['1312:negative-effect:spectro-frazzle'],
      aeroErosion: ['1312:negative-effect:aero-erosion'],
      fusionBurst: ['1312:negative-effect:fusion-burst'],
      glacioChafe: ['1312:negative-effect:glacio-chafe'],
      electroFlare: ['1312:negative-effect:electro-flare'],
    })
  })

  it('keeps Hsin Unison stacks and lets Suoming mirror Hsin\'s private cap', () => {
    const hsinBoon = details['1311']?.stateGraph?.nodes.find(
      (node) => node.key === 'resonator:1311:unison_boon:stacks',
    )
    const suomingBoon = details['1312']?.stateGraph?.nodes.find(
      (node) => node.key === 'resonator:1312:unison_boon:stacks',
    )
    const suoming = sourceFor('1312')

    expect(hsinBoon).toMatchObject({
      kind: 'number',
      max: 2,
      maxWhen: [
        { max: 4 },
        { max: 3 },
      ],
    })
    expect(suomingBoon).toMatchObject({
      kind: 'number',
      max: 2,
      maxWhen: [
        { max: 4 },
        { max: 3 },
      ],
    })
    if (!suomingBoon) {
      throw new Error('Missing Suoming Unison Boon state')
    }
    expect(suomingUnisonBoonMax(suomingBoon, null)).toBe(2)
    expect(suomingUnisonBoonMax(suomingBoon, 0)).toBe(3)
    expect(suomingUnisonBoonMax(suomingBoon, 6)).toBe(4)
    expect(suomingUnisonBoonMax(suomingBoon, 6, 1)).toBe(4)
    expect(details['1312']?.stateGraph?.groups).toContainEqual(expect.objectContaining({
      id: 'aligned-seals-or-seal-master',
      maxKey: 'resonator:1312:seal_master:active',
    }))
    expect(suoming.effects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: '1312:lvl70:aligned-seals', targetScope: 'activeOther' }),
      expect.objectContaining({ id: '1312:outro:electro', targetScope: 'activeOther' }),
      expect.objectContaining({ id: '1312:outro:resonance-skill', targetScope: 'activeOther' }),
      expect.objectContaining({ id: '1312:s2:outro-crit-dmg', targetScope: 'activeOther' }),
    ]))
  })
})

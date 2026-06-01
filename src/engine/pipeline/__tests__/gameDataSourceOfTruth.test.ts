import { describe, expect, it } from 'vitest'
import { getResonatorById, listResonators } from '@/domain/services/catalogService'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { listEffectsFor, listSkillsFor, listSources, listStatesFor } from '@/domain/services/gameDataService'
import { makeResRuntime } from '@/domain/state/defaults'
import { applySkllDat } from '@/engine/effects/dataEffects'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'

describe('game-data source of truth', () => {
  it('hydrates resonator skill catalogs from generated resonator definitions', () => {
    const resonator = getResonatorById('1412')
    const hiyuki = getResonatorById('1108')
    if (!resonator) {
      throw new Error('missing resonator 1412')
    }
    if (!hiyuki) {
      throw new Error('missing resonator 1108')
    }

    const skillLabels = resonator.skills.map((skill) => skill.label)
    expect(skillLabels).toContain('Solsworn Etymology DMG')
    expect(skillLabels).toContain('Basic Attack Stage 3 DMG')
    expect(skillLabels).toContain('BOOMY BOOM! DMG')
    expect(skillLabels).toContain('Where Trust Leads Me! DMG')
    expect(skillLabels).toContain('In This Very Moment DMG')
    expect(skillLabels).toContain('Electro Flare')
    expect(resonator.skills.find((skill) => skill.label === 'Basic Attack Stage 3 DMG')?.hits).toHaveLength(3)
    expect(hiyuki.skills.some((skill) => skill.label === 'Glacio Chafe' && skill.archetype === 'glacioChafe')).toBe(true)
  })

  it('mirrors paired rover skill trees onto the alternate ids and keeps their overrides loadable', () => {
    const aeroRover = getResonatorById('1408')
    const spectroRover = getResonatorById('1502')
    const havocRover = getResonatorById('1605')

    if (!aeroRover || !spectroRover || !havocRover) {
      throw new Error('missing paired rover resonators')
    }

    expect(aeroRover.skills.find((skill) => skill.id === '1406027')?.label).toBe('Unbound Flow Stage 1 DMG')
    expect(aeroRover.states.find((state) => state.controlKey === 'inherent:1408:lvl50:active')?.label).toBe('Sand in the Storm')

    expect(spectroRover.skills.find((skill) => skill.id === '4100020')?.label).toBe('Resonating Spin DMG')
    expect(spectroRover.states.find((state) => state.controlKey === 'sequence:1502:s6:active')?.label).toBe('S6: Echoes of Wanderlust')

    expect(havocRover.skills.find((skill) => skill.id === '1604020')?.skillType).toEqual(['heavyAtk'])
    expect(havocRover.skills.find((skill) => skill.id === '1605:outro')?.label).toBe('Soundweaver DMG')
  })

  it('hydrates generated echo sources as first-class game-data packages', () => {
    const echoSources = listSources('echo')
    const dreamlessStates = listStatesFor('echo', '6000053')
    const crownlessSkills = listSkillsFor('echo', '6000090')
    const twinNovaSkills = listSkillsFor('echo', '6000179')
    const spacetrekSkills = listSkillsFor('echo', '6000184')
    const fallacyEffects = listEffectsFor('echo', '6000060')
    const geocheloneEffects = listEffectsFor('echo', '390080005')
    const impermanenceStates = listStatesFor('echo', '6000052')
    const impermanenceEffects = listEffectsFor('echo', '6000052')
    const hyvatiaStates = listStatesFor('echo', '6000189')
    const hyvatiaEffects = listEffectsFor('echo', '6000189')
    const glommothStates = listStatesFor('echo', '6000195')
    const glommothEffects = listEffectsFor('echo', '6000195')

    expect(echoSources.length).toBeGreaterThan(100)
    expect(crownlessSkills.find((skill) => skill.id === 'echo:6000090:skill:1')?.label).toBe('Nightmare: Crownless')
    expect(crownlessSkills.find((skill) => skill.id === 'echo:6000090:skill:1')?.tab).toBe('echoAttacks')
    expect(dreamlessStates.find((state) => state.controlKey === 'echo:6000053:main:active')?.label).toBe('Enable?')
    expect(twinNovaSkills.find((skill) => skill.id === 'echo:6000179:skill:2')?.visibleWhen).toEqual({
      type: 'or',
      values: [1, 2, 3, 4].map((slotIndex) => ({
        type: 'eq',
        from: 'sourceRuntime',
        path: `build.echoes.${slotIndex}.id`,
        value: '6000180',
      })),
    })
    expect(spacetrekSkills[0]?.archetype).toBe('shield')
    expect(spacetrekSkills[0]?.aggregationType).toBe('shield')
    expect(impermanenceStates.find((state) => state.controlKey === 'echo:6000052:main:active')?.label).toBe('Enable')
    expect(impermanenceEffects.find((effect) => effect.id === 'echo:6000052:effect:toggle:activeOther')?.targetScope).toBe('activeOther')
    expect(hyvatiaStates.find((state) => state.controlKey === 'echo:6000189:main:active')?.label).toBe('Enable')
    expect(hyvatiaEffects.find((effect) => effect.id === 'echo:6000189:effect:toggle:activeOther')?.targetScope).toBe('activeOther')
    expect(glommothStates.find((state) => state.controlKey === 'echo:6000195:main:active')?.label).toBe('Enable')
    expect(glommothEffects.find((effect) => effect.id === 'echo:6000195:effect:toggle:activeOther')?.targetScope).toBe('activeOther')
    expect(fallacyEffects.find((effect) => effect.id === 'echo:6000060:effect:toggle:self')?.targetScope).toBe('self')
    expect(fallacyEffects.find((effect) => effect.id === 'echo:6000060:effect:toggle:teamWide')?.targetScope).toBe('teamWide')
    expect(geocheloneEffects.find((effect) => effect.id === 'echo:390080005:effect:teamwide-buff')?.targetScope).toBe('teamWide')
  })

  it('emits teamwide and incoming-resonator echo-set scopes from the set source definitions', () => {
    const rejuvenatingEffects = listEffectsFor('echoSet', '7')
    const moonlitEffects = listEffectsFor('echoSet', '8')
    const midnightEffects = listEffectsFor('echoSet', '12')
    const empyreanEffects = listEffectsFor('echoSet', '13')
    const gustsEffects = listEffectsFor('echoSet', '16')
    const clawprintEffects = listEffectsFor('echoSet', '18')
    const harmonyEffects = listEffectsFor('echoSet', '21')
    const neonlightEffects = listEffectsFor('echoSet', '24')
    const starryEffects = listEffectsFor('echoSet', '25')
    const chromaticEffects = listEffectsFor('echoSet', '28')

    expect(rejuvenatingEffects.find((effect) => effect.id === 'echoSet:7:rejuvenating5')?.targetScope).toBe('teamWide')
    expect(moonlitEffects.find((effect) => effect.id === 'echoSet:8:moonlit5')?.targetScope).toBe('activeOther')
    expect(midnightEffects.find((effect) => effect.id === 'echoSet:12:midnight5')?.targetScope).toBe('activeOther')
    expect(empyreanEffects.find((effect) => effect.id === 'echoSet:13:empyrean5')?.targetScope).toBe('active')
    expect(gustsEffects.some((effect) => effect.id === 'echoSet:16:welkin5' && effect.targetScope === 'teamWide')).toBe(true)
    expect(gustsEffects.some((effect) => effect.id === 'echoSet:16:welkin5' && effect.targetScope === 'self')).toBe(true)
    expect(clawprintEffects.some((effect) => effect.id === 'echoSet:18:clawprint5' && effect.targetScope === 'teamWide')).toBe(true)
    expect(clawprintEffects.some((effect) => effect.id === 'echoSet:18:clawprint5' && effect.targetScope === 'self')).toBe(true)
    expect(harmonyEffects.some((effect) => effect.id === 'echoSet:21:lawOfHarmony3p' && effect.targetScope === 'teamWide')).toBe(true)
    expect(harmonyEffects.some((effect) => effect.id === 'echoSet:21:lawOfHarmony3p' && effect.targetScope === 'self')).toBe(true)
    expect(neonlightEffects.find((effect) => effect.id === 'echoSet:24:neonlightLeap5')?.targetScope).toBe('activeOther')
    expect(neonlightEffects.find((effect) => effect.id === 'echoSet:24:neonlightLeapOffTune')?.targetScope).toBe('activeOther')
    expect(starryEffects.find((effect) => effect.id === 'echoSet:25:starryRadiance5pc')?.targetScope).toBe('teamWide')
    expect(chromaticEffects.find((effect) => effect.id === 'echoSet:28:chromaticFoamOutro')?.targetScope).toBe('activeOther')
  })

  it('hydrates authored source packages for newly added echo sets', () => {
    const quietSnowfallStates = listStatesFor('echoSet', '30')
    const quietSnowfallEffects = listEffectsFor('echoSet', '30')
    const splicedMemoriesStates = listStatesFor('echoSet', '31')
    const splicedMemoriesEffects = listEffectsFor('echoSet', '31')

    expect(quietSnowfallStates.find((state) => state.controlKey === 'echoSet:30:bonus:snowfall')?.label)
      .toBe('5pc Glacio Buff')
    expect(quietSnowfallStates.find((state) => state.controlKey === 'echoSet:30:bonus:snowfall')?.description)
      .toBe('Inflicting Glacio Chafe on enemies increases Glacio DMG dealt by 10% for 15s.')
    expect(quietSnowfallEffects.find((effect) => effect.id === 'echoSet:30:snowfallOutro')?.targetScope)
      .toBe('activeOther')

    expect(splicedMemoriesStates.find((state) => state.controlKey === 'echoSet:31:bonus:reelOfSplicedMemories5pc')?.label)
      .toBe('5pc Tune Break Boost')
    expect(splicedMemoriesStates.find((state) => state.controlKey === 'echoSet:31:bonus:reelOfSplicedMemories5pc')?.description)
      .toBe('Inflicting Tune Rupture - Shifting or Tune Strain - Shifting on enemies increases the Tune Break Boost of Resonators in the team by 20 for 30s.')
    expect(splicedMemoriesEffects.find((effect) => effect.id === 'echoSet:31:reelOfSplicedMemories5pc')?.targetScope)
      .toBe('teamWide')
  })

  it('hydrates authored weapon passive sources for newly fetched weapons', () => {
    const forgedDwarfStarStates = listStatesFor('weapon', '21050076')
    const forgedDwarfStarEffects = listEffectsFor('weapon', '21050076')
    const frostburnStates = listStatesFor('weapon', '21020086')
    const frostburnEffects = listEffectsFor('weapon', '21020086')

    expect(forgedDwarfStarStates.find((state) => state.controlKey === 'weapon:21050076:passive:ult')?.label)
      .toBe('Res. Liberation DMG')
    expect(forgedDwarfStarEffects.find((effect) => effect.id === 'weapon:21050076:team-atk')?.targetScope)
      .toBe('teamWide')

    expect(frostburnStates.find((state) => state.controlKey === 'weapon:21020086:passive:active')?.label)
      .toBe('Glacio Amp + Res. Liberation DEF Ignore')
    expect(frostburnEffects.find((effect) => effect.id === 'weapon:21020086:glacio-chafe')?.operations[0]).toMatchObject({
      type: 'add_skilltype_mod',
      skillType: 'glacioChafe',
      mod: 'amplify',
    })
  })

  it('hydrates authored resonator negative-effect source metadata from overrides', () => {
    const zani = getResonatorById('1507')
    const chisa = getResonatorById('1508')
    const hiyuki = getResonatorById('1108')

    if (!zani || !chisa || !hiyuki) {
      throw new Error('missing resonator negative-effect metadata fixtures')
    }

    expect(zani.negativeEffectSources).toEqual([{ key: 'spectroFrazzle', max: 60 }])
    expect(chisa.negativeEffectSources).toEqual([
      { key: 'havocBane' },
      {
        type: 'globalMaxAdd',
        value: 3,
        enabledWhen: {
          type: 'truthy',
          from: 'sourceRuntime',
          path: 'state.controls.team:1508:unraveling_law_zero:active',
        },
      },
    ])
    expect(hiyuki.negativeEffectSources).toEqual([
      { key: 'glacioChafe' },
      { type: 'behavior', key: 'glacioChafe', stackMode: 'fixedMax', label: 'Glacio Bite' },
    ])
  })

  it('hydrates Zani Nightfall as nine hits with targeted Blaze multiplier rows', () => {
    const zani = getResonatorById('1507')
    const seed = getResSeedBy('1507')
    if (!zani || !seed) {
      throw new Error('missing Zani data')
    }

    const nightfall = zani.skills.find((skill) => skill.id === '1507023')
    if (!nightfall) {
      throw new Error('missing Zani Nightfall skill')
    }

    expect(nightfall.hits).toHaveLength(9)
    expect(nightfall.hitTable?.[0]?.values).toHaveLength(20)
    expect(nightfall.hitTable?.map((entry) => Number((entry.values[9] * 100).toFixed(2)))).toEqual([
      51.7,
      51.7,
      15.91,
      15.91,
      79.53,
      7.96,
      7.96,
      27.84,
      139.17,
    ])
    expect(nightfall.hitTable?.reduce((total, entry) => total + entry.values[9], 0)).toBeCloseTo(3.9768)
    expect(nightfall.hitTable?.reduce((total, entry) => total + entry.values[19], 0)).toBeCloseTo(7.2563)
    expect(zani.features.filter((feature) => feature.skillId === '1507023' && feature.variant === 'subHit'))
      .toHaveLength(9)

    const blazeEffect = zani.effects.find((effect) => effect.id === '1507:blaze:nightfall')
    expect(blazeEffect?.operations.map((operation) => ({
      type: operation.type,
      hitIndex: operation.type === 'add_skill_hit_multiplier' ? operation.hitIndex : null,
    }))).toEqual([
      { type: 'add_skill_hit_multiplier', hitIndex: 0 },
      { type: 'add_skill_hit_multiplier', hitIndex: 1 },
      { type: 'add_skill_hit_multiplier', hitIndex: 4 },
      { type: 'add_skill_hit_multiplier', hitIndex: 8 },
    ])

    const runtime = makeResRuntime(seed)
    runtime.base.skillLevels.forteCircuit = 10
    runtime.state.controls['resonator:1507:inferno:active'] = true
    runtime.state.controls['resonator:1507:nightfall_blaze:value'] = 40

    const resolved = resolveSkill(runtime, nightfall)
    const boosted = applySkllDat(runtime, resolved)

    expect(boosted.hits.map((hit) => Number((hit.multiplier * 100).toFixed(2)))).toEqual([
      101.45,
      101.45,
      15.91,
      15.91,
      179.03,
      7.96,
      7.96,
      27.84,
      338.17,
    ])
    expect(boosted.multiplier).toBeCloseTo(7.9568)
  })

  it('hydrates Hiyuki resonance chain multipliers and synthetic healing skill', () => {
    const hiyukiStates = listStatesFor('resonator', '1108')
    const hiyukiEffects = listEffectsFor('resonator', '1108')
    const hiyukiSkills = listSkillsFor('resonator', '1108')
    const hiyukiSeed = getResSeedBy('1108')

    expect(hiyukiStates.find((state) => state.controlKey === 'sequence:1108:s4:active')?.label)
      .toBe('S4: Like Reeds on Tides')
    expect(hiyukiStates.find((state) => state.controlKey === 'resonator:1108:snowforged_blade:stacks')).toMatchObject({
      label: 'Snowforged Blade',
      kind: 'select',
    })
    expect(hiyukiEffects.find((effect) => effect.id === '1108:s4:like-reeds-on-tides')?.targetScope)
      .toBe('teamWide')
    expect(hiyukiEffects.find((effect) => effect.id === '1108:s5:vessel-of-thousand-wishes')?.operations[0]).toMatchObject({
      type: 'scale_skill_multiplier',
      match: { skillIds: ['1108019', '1108020', '1108021'] },
      value: { type: 'const', value: 1.8 },
    })
    expect(hiyukiEffects.find((effect) => effect.id === '1108:snowforged-blade:blade-liberation')?.operations[0])
      .toMatchObject({
        type: 'add_skill_multiplier',
        match: { skillIds: ['1108023'] },
      })
    expect(hiyukiEffects.find((effect) => effect.id === '1108:s3:no-self-no-bound:bite-mv')?.operations[0])
      .toMatchObject({
        type: 'add_skill_multiplier',
        match: { skillIds: ['1108:negative-effect:fine:snow:glacio-bite'] },
        value: { type: 'const', value: 4.88 },
      })
    expect(hiyukiSkills.find((skill) => skill.id === '1108:negative-effect:fine:snow:glacio-bite')).toMatchObject({
      label: 'Fine Snow: Glacio Bite',
      fixedMv: 10200,
    })
    expect(hiyukiSkills.find((skill) => skill.id === '1108024')).toBeUndefined()
    expect(hiyukiSkills.find((skill) => skill.id === '1108:s4:frostblight-healing')).toMatchObject({
      aggregationType: 'healing',
      multiplier: 0.18,
      scaling: { atk: 0, hp: 1, def: 0, energyRegen: 0 },
    })

    const bladeLiberation = hiyukiSkills.find((skill) => skill.id === '1108023')
    if (!hiyukiSeed || !bladeLiberation) {
      throw new Error('missing Hiyuki Snowforged Blade test data')
    }

    const runtime = makeResRuntime(hiyukiSeed)
    runtime.base.skillLevels.resonanceLiberation = 10
    runtime.base.level = 50
    runtime.state.controls['inherent:1108:lvl50:stacks'] = 2
    runtime.state.controls['resonator:1108:snowforged_blade:stacks'] = 3

    const resolved = resolveSkill(runtime, bladeLiberation)
    const boosted = applySkllDat(runtime, resolved)
    const glacioBite = hiyukiSkills.find((skill) => skill.id === '1108:negative-effect:fine:snow:glacio-bite')

    expect(resolved.multiplier).toBeCloseTo(9.9405)
    expect(boosted.multiplier).toBeCloseTo(33.7977)
    expect(resolveSkill(runtime, glacioBite!).label).toBe('Fine Snow: Glacio Bite')
  })

  it('hydrates Denia base mode override and skill typing', () => {
    const deniaStates = listStatesFor('resonator', '1211')
    const deniaEffects = listEffectsFor('resonator', '1211')
    const deniaSkills = listSkillsFor('resonator', '1211')
    const denia = getResonatorById('1211')
    if (!denia) {
      throw new Error('missing resonator 1211')
    }
    const deniaBaseRuntime = makeResRuntime(denia)
    const deniaS3Runtime = makeResRuntime(denia)
    deniaS3Runtime.base.sequence = 3
    deniaS3Runtime.state.controls['resonator:1211:dark_cores:value'] = 5

    expect(deniaStates.find((state) => state.controlKey === 'resonator:1211:fusion_burst_mode:active')?.label)
      .toBe('Fusion Burst')
    expect(deniaStates.find((state) => state.controlKey === 'resonator:1211:entropy_shift:active')?.label)
      .toBe('Entropy Shift')
    expect(deniaStates.find((state) => state.controlKey === 'resonator:1211:dark_cores:value')?.label)
      .toBe('Dark Cores Consumed')
    expect(deniaStates.find((state) => state.controlKey === 'resonator:1211:dark_cores:value')?.optionsWhen).toEqual([
      {
        when: { type: 'lt', from: 'sourceRuntime', path: 'base.sequence', value: 3 },
        options: ['0', '1', '2', '3'].map((value) => ({ id: value, label: value })),
      },
      {
        when: { type: 'gte', from: 'sourceRuntime', path: 'base.sequence', value: 3 },
        options: ['0', '1', '2', '3', '4', '5'].map((value) => ({ id: value, label: value })),
      },
    ])
    expect(denia.resonanceChains.find((chain) => chain.index === 2)?.controls?.map((control) => control.key))
      .toEqual(['sequence:1211:s2:active', 'sequence:1211:s2:stacks'])
    expect(denia.inherentSkills.find((skill) => skill.unlockLevel === 70)?.control).toMatchObject({
      key: 'inherent:1211:lvl70:off_tune_overcap',
      kind: 'number',
    })
    expect(deniaStates.find((state) => state.controlKey === 'inherent:1211:lvl70:off_tune_overcap')).toMatchObject({
      label: 'Off-Tune over 100%',
      kind: 'number',
      max: 50,
      controlDependencies: ['resonator:1211:tune_strain_mode:active', 'resonator:1211:entropy_shift:active'],
    })
    expect(deniaStates.find((state) => state.controlKey === 'sequence:1211:s2:stacks')).toMatchObject({
      label: 'Degenerate Voidmatter',
      kind: 'select',
      controlDependencies: ['sequence:1211:s2:active'],
    })

    expect(deniaSkills.find((skill) => skill.id === '1211105')?.skillType)
      .toEqual(['resonanceLiberation'])
    expect(deniaSkills.find((skill) => skill.id === '1211401')?.skillType)
      .toEqual(['resonanceLiberation'])
    expect(resolveSkill(deniaBaseRuntime, deniaSkills.find((skill) => skill.id === '1211101')!).skillType)
      .toEqual(['resonanceSkill'])
    expect(resolveSkill(deniaS3Runtime, deniaSkills.find((skill) => skill.id === '1211101')!).skillType)
      .toEqual(['resonanceLiberation'])
    expect(deniaSkills.find((skill) => skill.id === '1211908')?.visible)
      .toBe(false)

    expect(deniaEffects.find((effect) => effect.id === '1211:banish:dark-cores')?.operations[0]).toMatchObject({
      type: 'scale_skill_multiplier',
      match: { skillIds: ['1211105'] },
    })
    expect(deniaEffects.find((effect) => effect.id === '1211:lvl70:tune-break-boost')?.targetScope)
      .toBe('teamWide')
    expect(deniaEffects.find((effect) => effect.id === '1211:lvl70:tune-break-boost')?.operations[0])
      .toMatchObject({
        type: 'add_top_stat',
        stat: 'tuneBreakBoost',
        value: expect.objectContaining({ type: 'add' }),
      })
    expect(deniaEffects.find((effect) => effect.id === '1211:outro:tune-strain:trigger')?.targetScope)
      .toBe('activeOther')
    expect(deniaEffects.find((effect) => effect.id === '1211:shattered-hours')?.stage)
      .toBe('postStats')
    expect(deniaEffects.find((effect) => effect.id === '1211:s2:degenerate-voidmatter')?.operations[0])
      .toMatchObject({
        type: 'add_attribute_mod',
        attribute: 'fusion',
        mod: 'resShred',
      })
  })

  it('hydrates control dependencies for override-authored source states', () => {
    const aemeathStates = Object.fromEntries(
      listStatesFor('resonator', '1210').map((state) => [state.controlKey, state]),
    )
    const deniaStates = Object.fromEntries(
      listStatesFor('resonator', '1211').map((state) => [state.controlKey, state]),
    )
    const phoebeStates = Object.fromEntries(
      listStatesFor('resonator', '1506').map((state) => [state.controlKey, state]),
    )

    expect(aemeathStates['resonator:1210:fusion_trail:value']?.controlDependencies)
      .toEqual(['resonator:1210:fusion_burst_mode:active'])
    expect(aemeathStates['inherent:1210:lvl70:stacks']?.controlDependencies)
      .toEqual(['resonator:1210:tune_rupture_mode:active', 'resonator:1210:fusion_burst_mode:active'])
    expect(aemeathStates['team:1210:silent_protection_trigger:active']?.controlDependencies)
      .toEqual(['team:1210:silent_protection:active'])
    expect(deniaStates['team:1211:unfinished_lies:active']?.controlDependencies)
      .toEqual(['resonator:1211:fusion_burst_mode:active', 'resonator:1211:tune_strain_mode:active'])
    expect(deniaStates['team:1211:unfinished_lies_trigger:active']?.controlDependencies)
      .toEqual(['team:1211:unfinished_lies:active', 'resonator:1211:tune_strain_mode:active'])
    expect(deniaStates['inherent:1211:lvl70:off_tune_overcap']?.controlDependencies)
      .toEqual(['resonator:1211:tune_strain_mode:active', 'resonator:1211:entropy_shift:active'])
    expect(phoebeStates['sequence:1506:s2:boat_adrift']?.controlDependencies)
      .toEqual(['resonator:1506:confession:active'])
  })

  it('derives resonator base stats from generated resonator data', () => {
    const resonator = getResonatorById('1412')
    if (!resonator) {
      throw new Error('missing resonator 1412')
    }

    expect(resonator.baseStats.critRate).toBe(5)
    expect(resonator.baseStats.critDmg).toBe(150)
    expect(resonator.baseStats.tuneBreakBoost).toBe(0)
  })

  it('keeps generated tune break boost for tune-break resonators', () => {
    const resonator = getResonatorById('1510')
    if (!resonator) {
      throw new Error('missing resonator 1510')
    }

    expect(resonator.baseStats.tuneBreakBoost).toBe(10)
  })

  it('uses authored default rotation data when present', () => {
    const resonator = getResonatorById('1506')
    if (!resonator) {
      throw new Error('missing resonator 1506')
    }

    const labelsByFeatureId = Object.fromEntries(
      resonator.features.map((feature) => [feature.id, feature.label]),
    )

    expect(resonator.rotations[0]?.items.length).toBeGreaterThan(0)
    expect(
      resonator.rotations[0]?.items.map((item) =>
        item.type === 'feature' ? labelsByFeatureId[item.featureId] : null,
      ),
    ).toContain('Golden Grace DMG')
  })

  it('emits final Phoebe skill typing and keyed source-owned state data', () => {
    const resonator = getResonatorById('1506')
    if (!resonator) {
      throw new Error('missing resonator 1506')
    }

    const skillsById = Object.fromEntries(resonator.skills.map((skill) => [skill.id, skill]))
    const statesByKey = Object.fromEntries(resonator.states.map((state) => [state.controlKey, state]))
    expect(skillsById['1506015']?.skillType).toEqual(['basicAtk'])
    expect(skillsById['1506016']?.skillType).toEqual(['basicAtk'])
    expect(skillsById['1506017']?.skillType).toEqual(['basicAtk'])
    expect(skillsById['1506018']?.skillType).toEqual(['basicAtk'])
    expect(skillsById['1506030']?.skillType).toEqual(['heavyAtk'])
    expect(skillsById['1506031']?.skillType).toEqual(['resonanceSkill'])

    expect(statesByKey['resonator:1506:absolution:active']?.ownerKey).toBe('resonator:1506:absolution')
    expect(statesByKey['resonator:1506:confession:active']?.ownerKey).toBe('resonator:1506:confession')
    expect(statesByKey['resonator:1506:attentive_heart:active']?.enabledWhen).toEqual({
      type: 'truthy',
      from: 'sourceRuntime',
      path: 'state.controls.resonator:1506:confession:active',
    })
    expect(statesByKey['sequence:1506:s4:active']?.ownerKey).toBe('sequence:1506:s4')
    expect(statesByKey['sequence:1506:s5:active']?.ownerKey).toBe('sequence:1506:s5')
    expect(statesByKey['sequence:1506:s6:active']?.ownerKey).toBe('sequence:1506:s6')
    expect(statesByKey['sequence:1506:s2:boat_adrift']?.displayScope).toBe('team')
    expect(resonator.inherentSkills.find((entry) => entry.unlockLevel === 50)?.ownerKey).toBe('inherent:1506:lvl50')
    expect(resonator.inherentSkills.find((entry) => entry.unlockLevel === 70)?.ownerKey).toBe('inherent:1506:lvl70')
    expect(resonator.resonanceChains.find((entry) => entry.index === 4)?.ownerKey).toBe('sequence:1506:s4')
    expect(resonator.owners.find((owner) => owner.ownerKey === 'inherent:1506:lvl70')?.unlockWhen).toEqual({
      type: 'gte',
      from: 'sourceRuntime',
      path: 'base.level',
      value: 70,
    })
    expect(resonator.owners.find((owner) => owner.ownerKey === 'sequence:1506:s4')?.unlockWhen).toEqual({
      type: 'gte',
      from: 'sourceRuntime',
      path: 'base.sequence',
      value: 4,
    })

    expect(resonator.states).toHaveLength(7)
    expect(listEffectsFor('resonator', '1506', 'runtime')).not.toEqual([])
    expect(listEffectsFor('resonator', '1506', 'skill')).not.toEqual([])
  })

  it('emits Augusta panel controls as persistable control entries', () => {
    const resonator = getResonatorById('1306')
    if (!resonator) {
      throw new Error('missing resonator 1306')
    }

    const crownPanel = resonator.statePanels.find((panel) => panel.id === 'crown-of-wills')
    const crownControl = crownPanel?.controls[0]

    expect(crownControl).toMatchObject({
      key: 'resonator:1306:crown_of_wills:stacks',
      kind: 'select',
      target: 'controls',
    })
    expect(crownControl).not.toHaveProperty('path')
  })

  it('emits final Lupa skill typing and team-aware state data', () => {
    const resonator = getResonatorById('1207')
    if (!resonator) {
      throw new Error('missing resonator 1207')
    }

    const skillsById = Object.fromEntries(resonator.skills.map((skill) => [skill.id, skill]))
    const statesByKey = Object.fromEntries(resonator.states.map((state) => [state.controlKey, state]))
    const packHuntPanel = resonator.statePanels.find((panel) => panel.id === 'pack-hunt')
    const packHuntControls = Object.fromEntries((packHuntPanel?.controls ?? []).map((control) => [control.key, control]))

    expect(skillsById['1207011']?.skillType).toEqual(['heavyAtk'])
    expect(skillsById['1207024']?.skillType).toEqual(['resonanceLiberation'])
    expect(skillsById['1207025']?.skillType).toEqual(['resonanceLiberation'])
    expect(skillsById['1207026']?.skillType).toEqual(['resonanceSkill'])
    expect(skillsById['1207034']?.skillType).toEqual(['resonanceLiberation'])

    expect(statesByKey['team:1207:pack_hunt:active']?.displayScope).toBe('both')
    expect(statesByKey['team:1207:pack_hunt:stacks']?.displayScope).toBe('both')
    expect(statesByKey['team:1207:pack_hunt:fusion_bonus']).toBeUndefined()
    expect(statesByKey['team:1207:stand_by_me_warrior:active']?.displayScope).toBe('team')
    expect(statesByKey['sequence:1207:s2:stacks']?.displayScope).toBe('team')
    expect(statesByKey['sequence:1207:s3:active']?.displayScope).toBe('team')
    expect(statesByKey['inherent:1207:lvl70:stacks']?.displayScope).toBe('team')
    expect(packHuntControls['team:1207:pack_hunt:active']?.label).toBe('Enable')
    expect(packHuntControls['team:1207:pack_hunt:active']?.enabledWhen).toBeUndefined()
    expect(packHuntControls['team:1207:pack_hunt:stacks']?.disabledWhen).toEqual({
      target: 'controls',
      key: 'team:1207:pack_hunt:active',
      equals: false,
    })
    expect(packHuntControls['team:1207:pack_hunt:stacks']?.disabledReason).toBe(
      'Requires Pack Hunt to be active.',
    )
  })

  it('leaves the default rotation empty when no authored default exists', () => {
    const resonator = getResonatorById('1106')
    if (!resonator) {
      throw new Error('missing resonator 1106')
    }

    expect(resonator.rotations[0]?.items).toEqual([])
  })

  it('hydrates saved default rotations authored by direct skill ids', () => {
    const hiyuki = getResonatorById('1108')
    const denia = getResonatorById('1211')
    const buling = getResonatorById('1307')
    const luuk = getResonatorById('1510')

    if (!hiyuki || !denia || !buling || !luuk) {
      throw new Error('missing authored default rotation resonator')
    }

    expect(hiyuki.rotations[0]?.items.length).toBeGreaterThan(0)
    expect(denia.rotations[0]?.items.length).toBeGreaterThan(0)
    expect(buling.rotations[0]?.items.length).toBeGreaterThan(0)
    expect(luuk.rotations[0]?.items.length).toBeGreaterThan(0)

    expect(hiyuki.rotations[0]?.items.find((item): item is Extract<typeof item, { type: 'feature' }> => item.type === 'feature' && item.featureId === 'damage:1108028')?.multiplier).toBe(3)
    expect(denia.rotations[0]?.items.find((item): item is Extract<typeof item, { type: 'feature' }> => item.type === 'feature' && item.featureId === 'damage:1211401')?.multiplier).toBe(7)
    expect(luuk.rotations[0]?.items.find((item): item is Extract<typeof item, { type: 'feature' }> => item.type === 'feature' && item.featureId === 'damage:1510:outro')?.multiplier).toBe(1)
  })


  it('keeps every generated skill on a hits array and requires hit rows for all damage-family skills', () => {
    for (const resonator of listResonators()) {
      for (const skill of resonator.skills) {
        expect(Array.isArray(skill.hits)).toBe(true)
        if (skill.aggregationType === 'damage') {
          expect(skill.hits.length).toBeGreaterThan(0)
        } else {
          expect(skill.hits.length).toBeGreaterThanOrEqual(0)
        }
      }
    }
  })

  it('generates weapon-specific tune rupture hit distributions', () => {
    for (const resonator of listResonators()) {
      const tuneBreakSkills = resonator.skills.filter((skill) => skill.tab === 'tuneBreak')
      expect(tuneBreakSkills).toHaveLength(1)

      const tuneRupture = tuneBreakSkills[0]
      expect(tuneRupture).toBeTruthy()

      const expected = tuneRupture && !tuneRupture.id.endsWith(':tune-break')
        ? (tuneRupture.hitTable ?? []).map((hit) => ({
            count: hit.count,
            multiplier: hit.values[0] ?? 0,
          }))
        : resonator.weaponType === 1
          ? [
              { count: 1, multiplier: 2.2672 },
              { count: 1, multiplier: 1.7344 },
              { count: 1, multiplier: 12 },
            ]
          : resonator.weaponType === 2
            ? [
                { count: 4, multiplier: 1 },
                { count: 1, multiplier: 12 },
              ]
            : [{ count: 1, multiplier: 16 }]

      expect(tuneRupture?.hits).toHaveLength(expected.length)
      expected.forEach((hit, index) => {
        expect(tuneRupture?.hits[index]?.count).toBe(hit.count)
        expect(tuneRupture?.hits[index]?.multiplier).toBeCloseTo(hit.multiplier, 4)
      })
    }
  })

  it('generates sub-hit features for skills with multiple hit entries', () => {
    const yuanwu = getResonatorById('1303')
    if (!yuanwu) {
      throw new Error('missing resonator 1303')
    }

    const skill = yuanwu.skills.find((entry) => entry.id === '1303003')
    expect(skill?.hits.length).toBeGreaterThan(1)

    const skillFeature = yuanwu.features.find((feature) => feature.skillId === '1303003' && feature.variant !== 'subHit')
    const subHitFeatures = yuanwu.features
      .filter((feature) => feature.skillId === '1303003' && feature.variant === 'subHit')
      .sort((left, right) => (left.hitIndex ?? 0) - (right.hitIndex ?? 0))

    expect(skillFeature?.label).toBe('Stage 3 DMG')
    expect(subHitFeatures.map((feature) => feature.label)).toEqual(['Stage 3 DMG-1', 'Stage 3 DMG-2'])
  })

  it('includes source-side behavior skill additions with runtime visibility rules', () => {
    const carlotta = getResonatorById('1107')
    const yao = getResonatorById('1305')
    const roccia = getResonatorById('1606')

    if (!carlotta || !yao || !roccia) {
      throw new Error('missing generated resonator data for behavior skill additions')
    }

    const kaleidoscope = carlotta.skills.find((skill) => skill.id === '1107:kaleidoscope-sparks')
    const convolution = yao.skills.find((skill) => skill.id === '1305:convolution-matrices')
    const recreation = roccia.skills.find((skill) => skill.id === '1606:reality-recreation')

    expect(kaleidoscope?.label).toContain('Kaleidoscope Sparks DMG')
    expect(convolution?.label).toContain('Prodigy of Proteges: Convolution Matrices DMG')
    expect(recreation?.label).toContain('Reality Recreation DMG')
    expect(convolution?.hitTable?.length).toBeGreaterThan(0)
    expect(recreation?.hitTable?.length).toBeGreaterThan(0)

    const carlottaRuntime = makeResRuntime(carlotta)
    const yaoRuntime = makeResRuntime(yao)
    const rocciaRuntime = makeResRuntime(roccia)

    expect(resolveSkill(carlottaRuntime, kaleidoscope!).visible).toBe(false)
    expect(resolveSkill(yaoRuntime, convolution!).visible).toBe(false)
    expect(resolveSkill(rocciaRuntime, recreation!).visible).toBe(false)

    carlottaRuntime.base.sequence = 3
    yaoRuntime.base.sequence = 1
    rocciaRuntime.base.sequence = 6

    expect(resolveSkill(carlottaRuntime, kaleidoscope!).visible).toBe(true)
    expect(resolveSkill(yaoRuntime, convolution!).visible).toBe(true)
    expect(resolveSkill(rocciaRuntime, recreation!).visible).toBe(true)
  })

  it('includes real synthetic support skill additions from old behavior files', () => {
    const baizhi = getResonatorById('1103')
    const buling = getResonatorById('1307')
    const ciaccona = getResonatorById('1407')
    const verina = getResonatorById('1503')
    const shorekeeper = getResonatorById('1505')
    const taoqi = getResonatorById('1601')
    const yuanwu = getResonatorById('1303')

    if (!baizhi || !buling || !ciaccona || !verina || !shorekeeper || !taoqi || !yuanwu) {
      throw new Error('missing generated resonator data for synthetic support additions')
    }

    const stimulusFeedback = baizhi.skills.find((skill) => skill.id === '1103:stimulus-feedback')
    const hot = baizhi.skills.find((skill) => skill.id === '1103:lightning-manipulation-hot')
    const bulingS3Healing = buling.skills.find((skill) => skill.id === '1307:summoner-of-spirits-seeker-of-fate-healing')
    const bulingOutroHealing = buling.skills.find((skill) => skill.id === '1307:exorcism-spell-healing')
    const interludeTune = ciaccona.skills.find((skill) => skill.id === '1407:interlude-tune')
    const graceOfLifeShield = verina.skills.find((skill) => skill.id === '1503:grace-of-life-shield')
    const blossomHealing = verina.skills.find((skill) => skill.id === '1503:moment-of-emergence-healing')
    const lifeEntwined = shorekeeper.skills.find((skill) => skill.id === '1505:life-entwined-healing')
    const strategicParryHealing = taoqi.skills.find((skill) => skill.id === '1601:strategic-parry-healing')
    const yuanwuShield = yuanwu.skills.find((skill) => skill.id === '1303:retributive-knuckles-shield')

    expect(stimulusFeedback?.archetype).toBe('healing')
    expect(hot?.archetype).toBe('healing')
    expect(bulingS3Healing?.archetype).toBe('healing')
    expect(bulingOutroHealing?.archetype).toBe('healing')
    expect(interludeTune?.archetype).toBe('shield')
    expect(graceOfLifeShield?.archetype).toBe('shield')
    expect(blossomHealing?.archetype).toBe('healing')
    expect(lifeEntwined?.archetype).toBe('healing')
    expect(strategicParryHealing?.archetype).toBe('healing')
    expect(yuanwuShield?.archetype).toBe('shield')

    const baizhiRuntime = makeResRuntime(baizhi)
    const bulingRuntime = makeResRuntime(buling)
    const ciacconaRuntime = makeResRuntime(ciaccona)
    const verinaRuntime = makeResRuntime(verina)
    const shorekeeperRuntime = makeResRuntime(shorekeeper)
    const taoqiRuntime = makeResRuntime(taoqi)
    const yuanwuRuntime = makeResRuntime(yuanwu)

    baizhiRuntime.base.level = 40
    bulingRuntime.base.sequence = 0
    ciacconaRuntime.base.level = 40
    verinaRuntime.base.level = 60
    verinaRuntime.base.sequence = 0
    shorekeeperRuntime.base.level = 40
    taoqiRuntime.base.sequence = 0
    yuanwuRuntime.base.sequence = 0

    expect(resolveSkill(baizhiRuntime, stimulusFeedback!).visible).toBe(false)
    expect(resolveSkill(baizhiRuntime, hot!).visible).toBe(true)
    expect(resolveSkill(bulingRuntime, bulingS3Healing!).visible).toBe(false)
    expect(resolveSkill(bulingRuntime, bulingOutroHealing!).visible).toBe(true)
    expect(resolveSkill(ciacconaRuntime, interludeTune!).visible).toBe(false)
    expect(resolveSkill(verinaRuntime, graceOfLifeShield!).visible).toBe(false)
    expect(resolveSkill(verinaRuntime, blossomHealing!).visible).toBe(false)
    expect(resolveSkill(shorekeeperRuntime, lifeEntwined!).visible).toBe(false)
    expect(resolveSkill(taoqiRuntime, strategicParryHealing!).visible).toBe(false)
    expect(resolveSkill(yuanwuRuntime, yuanwuShield!).visible).toBe(false)

    baizhiRuntime.base.level = 70
    bulingRuntime.base.sequence = 3
    ciacconaRuntime.base.level = 50
    verinaRuntime.base.level = 70
    verinaRuntime.base.sequence = 1
    shorekeeperRuntime.base.level = 50
    taoqiRuntime.base.sequence = 4
    yuanwuRuntime.base.sequence = 4

    expect(resolveSkill(baizhiRuntime, stimulusFeedback!).visible).toBe(true)
    expect(resolveSkill(bulingRuntime, bulingS3Healing!).visible).toBe(true)
    expect(resolveSkill(ciacconaRuntime, interludeTune!).visible).toBe(true)
    expect(resolveSkill(verinaRuntime, graceOfLifeShield!).visible).toBe(true)
    expect(resolveSkill(verinaRuntime, blossomHealing!).visible).toBe(true)
    expect(resolveSkill(shorekeeperRuntime, lifeEntwined!).visible).toBe(true)
    expect(resolveSkill(taoqiRuntime, strategicParryHealing!).visible).toBe(true)
    expect(resolveSkill(yuanwuRuntime, yuanwuShield!).visible).toBe(true)
  })

  it('hydrates Yuanwu and Buling override states and skill typing', () => {
    const yuanwu = getResonatorById('1303')
    const buling = getResonatorById('1307')

    if (!yuanwu || !buling) {
      throw new Error('missing Yuanwu or Buling resonator data')
    }

    expect(yuanwu.states.find((state) => state.controlKey === 'sequence:1303:s6:active')?.label).toBe('S6: Defender of All Realms')
    expect(yuanwu.skills.find((skill) => skill.id === '1303015')?.skillType).toEqual(['resonanceSkill'])
    expect(yuanwu.skills.find((skill) => skill.id === '1303015')?.scaling).toEqual({
      atk: 0,
      hp: 0,
      def: 1,
      energyRegen: 0,
    })

    expect(buling.states.find((state) => state.controlKey === 'team:1307:thunder_spell_yin_and_yang:active')?.label).toBe('Thunder Spell - Yin and Yang')
    expect(buling.states.find((state) => state.controlKey === 'sequence:1307:s6:active')?.enabledWhen).toEqual({
      type: 'truthy',
      from: 'sourceRuntime',
      path: 'state.controls.team:1307:thunder_spell_heaven_earth_mind:active',
    })
    expect(buling.skills.find((skill) => skill.id === '1307023')?.skillType).toEqual(['resonanceLiberation'])
    expect(buling.skills.find((skill) => skill.id === '1307031')?.skillType).toEqual(['resonanceLiberation'])
  })

  it('reclassifies tune rupture response rows outside the tuneBreak tab', () => {
    const lynae = getResonatorById('1509')
    const mornye = getResonatorById('1209')
    const aemeath = getResonatorById('1210')
    const luuk = getResonatorById('1510')

    if (!lynae || !mornye || !aemeath || !luuk) {
      throw new Error('missing generated resonator data for tune rupture response checks')
    }

    const spectralAnalysis = lynae.skills.find((skill) => skill.id === '1509032')
    const particleJet = mornye.skills.find((skill) => skill.id === '1209031')
    const starburst = aemeath.skills.find((skill) => skill.id === '1210603')
    const seraphicDuetBonus = aemeath.skills.find((skill) => skill.id === '1210604')

    expect(spectralAnalysis?.tab).toBe('forteCircuit')
    expect(spectralAnalysis?.archetype).toBe('tuneRupture')
    expect(spectralAnalysis?.skillType).toEqual(['tuneRupture'])
    expect(spectralAnalysis?.element).toBe('spectro')

    expect(particleJet?.tab).toBe('forteCircuit')
    expect(particleJet?.archetype).toBe('tuneRupture')
    expect(particleJet?.skillType).toEqual(['tuneRupture'])
    expect(particleJet?.element).toBe('fusion')

    expect(starburst?.tab).toBe('forteCircuit')
    expect(starburst?.archetype).toBe('tuneRupture')
    expect(starburst?.skillType).toEqual(['tuneRupture'])
    expect(starburst?.element).toBe('fusion')

    expect(seraphicDuetBonus?.tab).toBe('forteCircuit')
    expect(seraphicDuetBonus?.archetype).toBe('tuneRupture')
    expect(seraphicDuetBonus?.skillType).toEqual(['tuneRupture'])
    expect(seraphicDuetBonus?.element).toBe('fusion')

    expect(luuk.skills.find((skill) => skill.id === '1510015')?.archetype).toBe('skillDamage')
    expect(luuk.skills.find((skill) => skill.id === '1510016')?.archetype).toBe('skillDamage')
    expect(luuk.skills.find((skill) => skill.id === '1510017')?.archetype).toBe('skillDamage')
    expect(luuk.skills.find((skill) => skill.id === '1510020')?.archetype).toBe('skillDamage')
  })

  it('emits authored override behavior for 1209, 1210, 1509, and 1510', () => {
    const mornye = getResonatorById('1209')
    const aemeath = getResonatorById('1210')
    const lynae = getResonatorById('1509')
    const luuk = getResonatorById('1510')

    if (!mornye || !aemeath || !lynae || !luuk) {
      throw new Error('missing generated resonator data for focused override checks')
    }

    const mornyeSkills = Object.fromEntries(mornye.skills.map((skill) => [skill.id, skill]))
    const aemeathSkills = Object.fromEntries(aemeath.skills.map((skill) => [skill.id, skill]))
    const lynaeSkills = Object.fromEntries(lynae.skills.map((skill) => [skill.id, skill]))
    const luukSkills = Object.fromEntries(luuk.skills.map((skill) => [skill.id, skill]))

    const mornyeStates = Object.fromEntries(mornye.states.map((state) => [state.controlKey, state]))
    const aemeathStates = Object.fromEntries(aemeath.states.map((state) => [state.controlKey, state]))
    const lynaeStates = Object.fromEntries(lynae.states.map((state) => [state.controlKey, state]))
    const luukStates = Object.fromEntries(luuk.states.map((state) => [state.controlKey, state]))

    const mornyeRuntimeEffects = listEffectsFor('resonator', '1209', 'runtime')
    const mornyeSkillEffects = listEffectsFor('resonator', '1209', 'skill')
    const aemeathRuntimeEffects = listEffectsFor('resonator', '1210', 'runtime')
    const aemeathSkillEffects = listEffectsFor('resonator', '1210', 'skill')
    const lynaeRuntimeEffects = listEffectsFor('resonator', '1509', 'runtime')
    const lynaeSkillEffects = listEffectsFor('resonator', '1509', 'skill')
    const luukRuntimeEffects = listEffectsFor('resonator', '1510', 'runtime')
    const luukSkillEffects = listEffectsFor('resonator', '1510', 'skill')

    expect(mornyeSkills['1209021']?.scaling).toEqual({ atk: 0, hp: 0, def: 1, energyRegen: 0 })
    expect(mornyeSkills['1209028']?.skillType).toEqual(['resonanceLiberation'])
    expect(mornyeSkills['1209:boundedness-healing']?.archetype).toBe('healing')
    expect(mornyeSkills['1209:high-syntony-field-healing']?.archetype).toBe('healing')
    expect(mornyeStates['team:1209:entropic_morning:active']?.enabledWhen).toEqual({
      type: 'truthy',
      from: 'sourceRuntime',
      path: 'state.controls.resonator:1209:interfered_marker:active',
    })
    expect(mornyeRuntimeEffects.some((effect) => effect.id === '1209:interfered-marker')).toBe(true)
    expect(mornyeSkillEffects.some((effect) => effect.id === '1209:s4:high-syntony-field-healing')).toBe(true)

    expect(aemeathSkills['1210005']?.skillType).toEqual(['resonanceLiberation'])
    expect(aemeathSkills['1210006']?.skillType).toEqual(['resonanceLiberation'])
    expect(aemeathSkills['1210107']?.skillType).toEqual(['resonanceLiberation'])
    expect(aemeathSkills['1210108']?.skillType).toEqual(['resonanceLiberation'])
    expect(aemeathSkills['1210601']?.skillType).toEqual(['resonanceLiberation'])
    expect(aemeathSkills['1210602']?.skillType).toEqual(['resonanceLiberation'])
    expect(aemeathStates['resonator:1210:tune_rupture_mode:active']).toBeTruthy()
    expect(aemeathStates['resonator:1210:fusion_burst_mode:active']).toBeTruthy()
    expect(aemeathStates['team:1210:silent_protection:active']).toBeTruthy()
    expect(aemeathStates['team:1210:silent_protection_trigger:active']?.enabledWhen).toEqual({
      type: 'truthy',
      from: 'sourceRuntime',
      path: 'state.controls.team:1210:silent_protection:active',
    })
    expect(aemeathRuntimeEffects.some((effect) => effect.id === '1210:outro:base' && effect.targetScope === 'otherTeammates')).toBe(true)
    expect(aemeathSkillEffects.some((effect) => effect.id === '1210:s6:tune-rupture-crit-dmg')).toBe(true)

    expect(lynaeStates['team:1509:hit_the_road:active']).toBeTruthy()
    expect(lynaeStates['team:1509:vanishing_point:active']?.visibleWhen).toEqual({
      type: 'gte',
      from: 'sourceRuntime',
      path: 'base.sequence',
      value: 2,
    })
    expect(lynaeStates['sequence:1509:s3:premixed_hue']).toBeTruthy()
    expect(lynaeSkills['1509:outro']?.multiplier).toBe(1)
    expect(lynae.skills.filter((skill) => skill.tab === 'tuneBreak').map((skill) => skill.id)).toEqual(['1509026'])
    expect(lynaeRuntimeEffects.some((effect) => effect.id === '1509:hit-the-road' && effect.targetScope === 'activeOther')).toBe(true)
    expect(lynaeSkillEffects.some((effect) => effect.id === '1509:s3:additive-color')).toBe(true)

    expect(luukSkills['1510015']?.skillType).toEqual(['basicAtk'])
    expect(luukSkills['1510016']?.skillType).toEqual(['basicAtk'])
    expect(luukSkills['1510017']?.skillType).toEqual(['basicAtk'])
    expect(luukSkills['1510020']?.skillType).toEqual(['basicAtk'])
    expect(luukSkills['1510025']?.skillType).toEqual(['basicAtk'])
    expect(luukSkills['1510031']?.skillType).toEqual(['basicAtk'])
    expect(luukSkills['1510031']?.fixedDmg).toBe(10)
    expect(getResonatorById('1208')?.skills.find((skill) => skill.id === '1208013')?.skillType).toEqual(['basicAtk'])
    expect(getResonatorById('1208')?.skills.find((skill) => skill.id === '1208013')?.fixedDmg).toBe(666)
    expect(luukSkills['1510:outro']?.label).toBe('Nod to Dying Moment DMG')
    expect(luukSkills['1510:outro']?.multiplier).toBe(5)
    expect(luukStates['resonator:1510:aureate_judge:active']).toBeTruthy()
    expect(luukStates['resonator:1510:aureate_judge_follow_up:active']).toBeTruthy()
    expect(luukStates['resonator:1510:endnotes_on_the_endgame:stacks']).toBeTruthy()
    expect(luukStates['team:1510:pulse_thrumming_under_rime:active']).toBeTruthy()
    expect(luukRuntimeEffects.some((effect) => effect.id === '1510:silent-debate')).toBe(true)
    expect(luukSkillEffects.some((effect) => effect.id === '1510:s6:endnotes')).toBe(true)
  })

  it('registers generated resonators, echoes, weapons, and echo sets as game-data sources', () => {
    expect(listSources('resonator').length).toBeGreaterThan(0)
    expect(listSources('resonator').every((s) => s.type === 'resonator')).toBe(true)
    expect(listSources('weapon').length).toBeGreaterThan(0)
    expect(listSources('weapon').every((s) => s.type === 'weapon')).toBe(true)
    expect(listSources('echo').length).toBeGreaterThan(0)
    expect(listSources('echo').every((s) => s.type === 'echo')).toBe(true)
    expect(listSources('echoSet').length).toBeGreaterThan(0)
    expect(listSources('echoSet').every((s) => s.type === 'echoSet')).toBe(true)
  })

  it('emits authored 1109, 1511, and 1308 override data into generated source', () => {
    const lucilla = getResonatorById('1109')
    const lucy = getResonatorById('1511')
    const rebecca = getResonatorById('1308')
    if (!lucilla || !lucy || !rebecca) {
      throw new Error('missing generated Cyberpunk resonator data')
    }

    const lucillaSkills = Object.fromEntries(lucilla.skills.map((skill) => [skill.id, skill]))
    const lucillaStates = Object.fromEntries(lucilla.states.map((state) => [state.controlKey, state]))
    const lucillaPanels = Object.fromEntries(lucilla.statePanels.map((panel) => [panel.id, panel]))
    const lucillaRuntimeEffects = listEffectsFor('resonator', '1109', 'runtime')
    const lucillaSkillEffects = listEffectsFor('resonator', '1109', 'skill')
    const lucillaGlacioRuntime = {
      ...makeResRuntime(lucilla),
      state: {
        ...makeResRuntime(lucilla).state,
        controls: {
          'resonator:1109:glacio_chafe_mode:active': true,
          'resonator:1109:echo_mode:active': false,
        },
      },
    }
    const lucillaEchoRuntime = {
      ...makeResRuntime(lucilla),
      state: {
        ...makeResRuntime(lucilla).state,
        controls: {
          'resonator:1109:glacio_chafe_mode:active': false,
          'resonator:1109:echo_mode:active': true,
        },
      },
    }

    expect(lucillaStates['resonator:1109:glacio_chafe_mode:active']?.defaultValue).toBe(false)
    expect(lucillaStates['resonator:1109:echo_mode:active']).toBeTruthy()
    expect(lucillaPanels['glacio-chafe-mode']?.controls.map((control) => control.key))
      .toEqual(['resonator:1109:glacio_chafe_mode:active'])
    expect(lucillaPanels['echo-mode']?.controls.map((control) => control.key))
      .toEqual(['resonator:1109:echo_mode:active'])
    expect(lucillaPanels['glacio-chafe-mode']?.body).toContain('Clear As Day')
    expect(lucillaPanels['glacio-chafe-mode']?.body).toContain('Montage')
    expect(lucillaPanels['echo-mode']?.body).toContain('Echo Skill DMG Amplification')
    expect(lucilla.statePanels.some((panel) => panel.id === 'slow-motion')).toBe(false)
    expect(lucilla.inherentSkills.find((skill) => skill.name === 'Slow Motion')?.control?.key)
      .toBe('inherent:1109:lvl50:active')
    expect(lucilla.inherentSkills.find((skill) => skill.name === 'Slow Motion')?.control?.enabledWhen)
      .toMatchObject({ type: 'or' })
    expect(lucillaStates['resonator:1109:clear_as_day:active']?.enabledWhen).toMatchObject({ type: 'or' })
    expect(lucillaStates['team:1109:montage:active']?.enabledWhen).toMatchObject({ type: 'or' })
    expect(lucillaRuntimeEffects.find((effect) => effect.id === '1109:clear-as-day:basic')?.condition)
      .toMatchObject({
        type: 'and',
        values: [
          { type: 'truthy', path: 'state.controls.resonator:1109:clear_as_day:active' },
          {
            type: 'and',
            values: [
              { type: 'truthy', path: 'state.controls.resonator:1109:glacio_chafe_mode:active' },
              { type: 'not', value: { type: 'truthy', path: 'state.controls.resonator:1109:echo_mode:active' } },
            ],
          },
        ],
      })
    expect(resolveSkill(lucillaGlacioRuntime, lucillaSkills['1109013']).skillType).toEqual(['basicAtk'])
    expect(resolveSkill(lucillaEchoRuntime, lucillaSkills['1109013']).skillType).toEqual(['echoSkill'])
    expect(lucillaSkills['1109014']?.skillType).toEqual(['basicAtk'])
    expect(lucillaRuntimeEffects.some((effect) => effect.id === '1109:slow-motion:glacio-res')).toBe(true)
    expect(lucillaRuntimeEffects.some((effect) => effect.id === '1109:montage:echo-amplify' && effect.targetScope === 'activeOther')).toBe(true)
    expect(lucilla.resonanceChains.find((chain) => chain.index === 1)?.controls?.[0]?.key)
      .toBe('sequence:1109:s1:active')
    expect(lucilla.resonanceChains.find((chain) => chain.index === 4)?.controls?.[0]?.key)
      .toBe('sequence:1109:s4:stacks')
    expect(lucilla.resonanceChains.find((chain) => chain.index === 6)?.controls?.[0]?.key)
      .toBe('sequence:1109:s6:stacks')
    expect(lucillaStates['sequence:1109:s1:active']?.visibleWhen).toMatchObject({ type: 'gte', value: 1 })
    expect(lucillaStates['sequence:1109:s4:stacks']?.kind).toBe('select')
    expect(lucillaStates['sequence:1109:s6:stacks']?.kind).toBe('select')
    expect(lucillaRuntimeEffects.find((effect) => effect.id === '1109:montage:glacio-chafe-amp')?.condition)
      .toMatchObject({
        type: 'and',
        values: expect.arrayContaining([
          { type: 'truthy', from: 'sourceRuntime', path: 'state.controls.team:1109:montage:active' },
        ]),
      })
    expect(lucillaRuntimeEffects.find((effect) => effect.id === '1109:s2:montage:echo-amplify')?.operations[0])
      .toMatchObject({ type: 'add_skilltype_mod', skillType: 'echoSkill', mod: 'amplify', value: { value: 40 } })
    expect(lucillaRuntimeEffects.find((effect) => effect.id === '1109:s4:oblivion-atk')?.operations[0])
      .toMatchObject({ type: 'add_base_stat', stat: 'atk', field: 'percent' })
    expect(lucillaSkillEffects.find((effect) => effect.id === '1109:s3:letting-it-go')?.operations[0])
      .toMatchObject({ type: 'scale_skill_multiplier', match: { skillIds: ['1109017'] }, value: { value: 2 } })
    expect(lucillaSkillEffects.find((effect) => effect.id === '1109:s5:oblivion')?.operations[0])
      .toMatchObject({ type: 'scale_skill_multiplier', match: { skillIds: ['1109027'] }, value: { value: 1.5 } })
    expect(lucillaSkillEffects.find((effect) => effect.id === '1109:s6:remembrance')?.operations[0])
      .toMatchObject({ type: 'add_skill_mod', match: { skillIds: ['1109017'] }, mod: 'dmgBonus' })

    const lucySkills = Object.fromEntries(lucy.skills.map((skill) => [skill.id, skill]))
    const lucyStates = Object.fromEntries(lucy.states.map((state) => [state.controlKey, state]))
    const lucyPanels = Object.fromEntries(lucy.statePanels.map((panel) => [panel.id, panel]))
    const lucyRuntimeEffects = listEffectsFor('resonator', '1511', 'runtime')
    const lucySkillEffects = listEffectsFor('resonator', '1511', 'skill')

    expect(lucyStates['resonator:1511:algorithm_compaction:active']).toBeTruthy()
    expect(lucyStates['resonator:1511:sql:active']?.controlDependencies).toEqual(['resonator:1511:algorithm_compaction:active'])
    expect(lucyPanels['algorithm-compaction']?.controls.map((control) => control.key))
      .toEqual(['resonator:1511:algorithm_compaction:active'])
    expect(lucyPanels.sql?.body).toContain('Heavy Attack - Multi-threading')
    expect(lucyPanels.sql?.controls.map((control) => control.key)).toEqual(['resonator:1511:sql:active'])
    expect(lucyPanels['spoofing-program-cyberware-malfunction']?.body)
      .toBe('Requires 4 RAM. Marked targets take 5% increased damage for 30s.')
    expect(lucyStates['team:1511:cyberware_malfunction:active']?.description)
      .toBe('Requires 4 RAM. Marked targets take 5% increased damage for 30s.')
    expect(lucyStates['team:1511:countermeasure_program:active']).toBeTruthy()
    expect(lucyStates['team:1511:countermeasure_program_outgoing:active']).toBeTruthy()
    expect(lucy.statePanels.some((panel) => panel.id === 'network-backdoor')).toBe(false)
    expect(lucy.inherentSkills.find((skill) => skill.name === 'Function Cracking')?.control?.key)
      .toBe('inherent:1511:lvl70:active')
    expect(lucySkills['1511011']?.skillType).toEqual(['heavyAtk'])
    expect(lucySkills['1511028']?.skillType).toEqual(['heavyAtk'])
    expect(lucySkills['1511031'])
      .toMatchObject({ skillType: ['hack'], archetype: 'hack', aggregationType: 'damage' })
    expect(lucySkills['1511038'])
      .toMatchObject({ skillType: ['hack'], archetype: 'hack', aggregationType: 'damage' })
    expect(lucySkills['1511:s2:session-hijack-spectro'])
      .toMatchObject({ multiplier: 3, element: 'spectro', skillType: ['heavyAtk'] })
    expect(lucySkills['1511:s5:ghost-cyberware-shield'])
      .toMatchObject({
        multiplier: 1.5,
        skillType: ['shield'],
        archetype: 'shield',
        aggregationType: 'shield',
      })
    expect(lucySkills['1511:s5:ghost-cyberware-shield']?.visibleWhen)
      .toMatchObject({
        type: 'gte',
        from: 'sourceRuntime',
        path: 'base.sequence',
        value: 5,
      })
    expect(lucy.resonanceChains.find((chain) => chain.index === 1)?.controls?.[0]?.key)
      .toBe('sequence:1511:s1:intro_atk')
    expect(lucy.resonanceChains.find((chain) => chain.index === 3)?.controls?.[0]?.key)
      .toBe('sequence:1511:s3:override_cast')
    expect(lucy.resonanceChains.find((chain) => chain.index === 4)?.controls?.[0]?.key)
      .toBe('sequence:1511:s4:hack_shifting')
    expect(lucy.resonanceChains.find((chain) => chain.index === 5)).toBeTruthy()
    expect(lucy.resonanceChains.find((chain) => chain.index === 6)?.controls?.[0]?.key)
      .toBe('sequence:1511:s6:hack_target')
    const sqlMultiThreading = lucySkillEffects.find((effect) => effect.id === '1511:sql:multi-threading')
    expect(sqlMultiThreading?.operations[0])
      .toMatchObject({
        type: 'scale_skill_multiplier',
        match: { skillIds: ['1511017'] },
      })
    expect(sqlMultiThreading?.condition?.type)
      .toBe('and')
    if (sqlMultiThreading?.condition?.type !== 'and') {
      throw new Error('missing Lucy SQL multi-threading condition')
    }
    expect(sqlMultiThreading.condition.values)
      .toEqual(expect.arrayContaining([expect.objectContaining({ type: 'lt', value: 2 })]))
    expect(lucySkillEffects.find((effect) => effect.id === '1511:s2:sql:multi-threading')?.operations[0])
      .toMatchObject({
        type: 'scale_skill_multiplier',
        match: { skillIds: ['1511017'] },
      })
    expect(lucySkillEffects.find((effect) => effect.id === '1511:s3:override')?.operations[0])
      .toMatchObject({ type: 'scale_skill_multiplier', match: { skillIds: ['1511028', '1511032'] } })
    expect(lucySkillEffects.find((effect) => effect.id === '1511:s3:cripple-movement')?.operations[0])
      .toMatchObject({ type: 'scale_skill_multiplier', match: { skillIds: ['1511031'] }, value: { value: 1.65 } })
    expect(lucySkillEffects.find((effect) => effect.id === '1511:s3:data-crash')?.operations[0])
      .toMatchObject({ type: 'scale_skill_multiplier', match: { skillIds: ['1511038'] }, value: { value: 1.65 } })
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:spoofing-program:cyberware-malfunction'))
      .toMatchObject({
        targetScope: 'teamWide',
        operations: [
          {
            type: 'add_top_stat',
            stat: 'dmgVuln',
            value: { type: 'const', value: 5 },
          },
        ],
      })
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:countermeasure:basic')?.targetScope)
      .toBe('activeOther')
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:countermeasure:triggered')?.targetScope)
      .toBe('otherTeammates')
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:s1:intro-atk')?.operations[0])
      .toMatchObject({ type: 'add_base_stat', stat: 'atk', field: 'percent', value: { value: 20 } })
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:s3:override-stats')?.operations)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'add_top_stat', stat: 'critRate' }),
        expect.objectContaining({ type: 'add_top_stat', stat: 'critDmg' }),
      ]))
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:s4:hack-shifting')?.operations[0])
      .toMatchObject({ type: 'add_attribute_mod', attribute: 'all', mod: 'dmgBonus', value: { value: 20 } })
    expect(lucyRuntimeEffects.find((effect) => effect.id === '1511:s6:heavy-attack-vulnerability')?.operations[0])
      .toMatchObject({ type: 'add_skilltype_mod', skillType: 'heavyAtk', mod: 'dmgVuln', value: { value: 60 } })

    const rebeccaSkills = Object.fromEntries(rebecca.skills.map((skill) => [skill.id, skill]))
    const rebeccaStates = Object.fromEntries(rebecca.states.map((state) => [state.controlKey, state]))
    const rebeccaRuntimeEffects = listEffectsFor('resonator', '1308', 'runtime')
    const rebeccaSkillEffects = listEffectsFor('resonator', '1308', 'skill')
    const switchGearsPanel = rebecca.statePanels.find((panel) => panel.id === 'switch-gears')
    const bothModesPanel = rebecca.statePanels.find((panel) => panel.id === 'a-girl-gets-what-she-wants')

    expect(rebecca.inherentSkills.map((skill) => skill.name)).toEqual(["Tag, You're It!", 'Left an Opening!'])
    expect(rebecca.statePanels.some((panel) => panel.id === 'tag-youre-it')).toBe(false)
    expect(rebecca.statePanels.some((panel) => panel.id === 'left-an-opening')).toBe(false)
    expect(rebecca.inherentSkills.find((skill) => skill.name === "Tag, You're It!")?.control?.key)
      .toBe('inherent:1308:lvl50:stacks')
    expect(rebecca.inherentSkills.find((skill) => skill.name === 'Left an Opening!')?.control?.key)
      .toBe('inherent:1308:lvl70:active')
    expect(rebeccaStates['resonator:1308:huntress:active']?.defaultValue).toBe(true)
    expect(switchGearsPanel?.controls.map((control) => control.key)).toEqual([
      'resonator:1308:huntress:active',
      'resonator:1308:guts:active',
    ])
    expect(bothModesPanel?.controls.map((control) => control.key)).toEqual([
      'resonator:1308:a_girl_gets_what_she_wants:active',
    ])
    expect(rebeccaStates['resonator:1308:huntress:active']?.resets).toEqual([
      'resonator:1308:guts:active',
      'resonator:1308:a_girl_gets_what_she_wants:active',
    ])
    expect(rebeccaStates['resonator:1308:guts:active']?.resets).toEqual([
      'resonator:1308:huntress:active',
      'resonator:1308:a_girl_gets_what_she_wants:active',
    ])
    expect(rebeccaStates['resonator:1308:a_girl_gets_what_she_wants:active']?.resets).toEqual([
      'resonator:1308:huntress:active',
      'resonator:1308:guts:active',
    ])
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:huntress:crit-dmg')?.condition)
      .toMatchObject({
        type: 'and',
        values: [
          { type: 'truthy', path: 'state.controls.resonator:1308:huntress:active' },
          { type: 'not', value: { type: 'truthy', path: 'state.controls.resonator:1308:guts:active' } },
          { type: 'not', value: { type: 'truthy', path: 'state.controls.resonator:1308:a_girl_gets_what_she_wants:active' } },
        ],
      })
    expect(rebeccaStates['team:1308:overlimit:stacks']?.controlDependencies).toEqual(['team:1308:good_choom:active'])
    expect(rebeccaSkills['1411004']?.skillType).toEqual(['basicAtk'])
    expect(rebeccaSkills['1411026']?.skillType).toEqual(['heavyAtk'])
    expect(rebeccaSkills['1411027']?.skillType).toEqual(['heavyAtk'])
    expect(rebeccaSkills['1308:s6:additional-basic-attack'])
      .toMatchObject({ multiplier: 9, skillType: ['basicAtk'] })
    expect(rebecca.resonanceChains.find((chain) => chain.index === 2)?.controls?.map((control) => control.key))
      .toEqual(['sequence:1308:s2:intro_liberation', 'sequence:1308:s2:hack_shifting'])
    expect(rebecca.resonanceChains.find((chain) => chain.index === 5)?.controls?.[0]?.key)
      .toBe('sequence:1308:s5:hack_shifting')
    expect(rebeccaStates['sequence:1308:s2:intro_liberation']?.displayScope).toBe('team')
    expect(rebeccaStates['sequence:1308:s2:hack_shifting']?.displayScope).toBe('team')
    expect(rebecca.statePanels.find((panel) => panel.id === 'good-choom')?.controls[0]?.enabledWhen)
      .toMatchObject({ type: 'truthy', from: 'context', path: 'team.presenceById.1511' })
    expect(rebeccaStates['team:1308:modded_mk31_fortified:active']?.enabledWhen)
      .toMatchObject({
        type: 'and',
        values: expect.arrayContaining([
          { type: 'truthy', from: 'context', path: 'team.presenceById.1511' },
        ]),
      })
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:overlimit:lucy')?.operations[0])
      .toMatchObject({
        type: 'add_skilltype_mod',
        skillType: 'heavyAtk',
        mod: 'amplify',
      })
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:s2:intro-liberation')?.operations[0])
      .toMatchObject({ type: 'add_attribute_mod', attribute: 'all', mod: 'dmgBonus', value: { value: 20 } })
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:s2:hack-shifting')?.operations[0])
      .toMatchObject({ type: 'add_top_stat', stat: 'amplify', value: { value: 15 } })
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:s4:both-modes:crit-dmg')?.operations[0])
      .toMatchObject({ type: 'add_top_stat', stat: 'critDmg', value: { value: 18 } })
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:s4:both-modes:def-ignore')?.operations[0])
      .toMatchObject({ type: 'add_attribute_mod', attribute: 'all', mod: 'defIgnore', value: { value: 9 } })
    expect(rebeccaRuntimeEffects.find((effect) => effect.id === '1308:s5:hack-shifting')?.operations[0])
      .toMatchObject({ type: 'add_skilltype_mod', skillType: 'basicAtk', mod: 'dmgBonus', value: { value: 20 } })
    expect(rebeccaSkillEffects.find((effect) => effect.id === '1308:s1:pistol-heavy-shotgun-basic')?.operations[0])
      .toMatchObject({
        type: 'scale_skill_multiplier',
        match: { skillIds: ['1411004', '1411009', '1411010', '1411011'] },
        value: { value: 1.5 },
      })
    expect(rebeccaSkillEffects.find((effect) => effect.id === '1308:s3:liberation')?.operations[0])
      .toMatchObject({ type: 'scale_skill_multiplier', match: { skillIds: ['1411028', '1411031'] }, value: { value: 1.6 } })
    expect(rebeccaSkillEffects.find((effect) => effect.id === '1308:good-choom:fortified')?.operations[0])
      .toMatchObject({
        type: 'scale_skill_multiplier',
        match: { skillIds: ['1308:outro'] },
      })

    for (const resonator of [lucilla, lucy, rebecca]) {
      expect(resonator.skills.filter((skill) => skill.tab === 'tuneBreak')).toHaveLength(1)
    }
  })

  it('resolves override state description refs from raw resonator data', () => {
    const resonator = getResonatorById('1411')
    if (!resonator) {
      throw new Error('missing resonator 1411')
    }

    const statesByKey = Object.fromEntries(resonator.states.map((state) => [state.controlKey, state]))

    expect(statesByKey['inherent:1411:lvl50:active']?.description).toContain('Qiuyuan obtains')
    expect(statesByKey['inherent:1411:lvl50:active']?.description).toContain('Quietude Within')
    expect(statesByKey['inherent:1411:lvl70:active']?.description).toContain('Flowing Panacea')
  })

  it('emits authored 1412 override data into generated source', () => {
    const resonator = getResonatorById('1412')
    if (!resonator) {
      throw new Error('missing resonator 1412')
    }

    const skillsById = Object.fromEntries(resonator.skills.map((skill) => [skill.id, skill]))
    const statesByKey = Object.fromEntries(resonator.states.map((state) => [state.controlKey, state]))
    const rotationFeatureIds = resonator.rotations[0]?.items
      .map((item) => (item.type === 'feature' ? item.featureId : null))
      .filter(Boolean)
    const runtimeEffects = listEffectsFor('resonator', '1412', 'runtime')
    const skillEffects = listEffectsFor('resonator', '1412', 'skill')

    expect(skillsById['1412001']?.skillType).toEqual(['basicAtk'])
    expect(skillsById['1412011']?.skillType).toEqual(['resonanceSkill'])
    expect(skillsById['1412021']?.skillType).toEqual(['echoSkill'])
    expect(skillsById['1412:outro']?.multiplier).toBe(7.95)
    expect(rotationFeatureIds).toEqual([
      'damage:1412019',
      'damage:1412002',
      'damage:1412003',
      'damage:1412004',
      'damage:1412005',
      'damage:1412023',
      'damage:1412015',
      'damage:1412002',
      'damage:1412003',
      'damage:1412004',
      'damage:1412005',
      'damage:1412022',
      'damage:1412025',
      'damage:1412:outro',
    ])

    expect(statesByKey['resonator:1412:soliskin_vitality:value']?.ownerKey).toBe('resonator:1412:soliskin_vitality')
    expect(statesByKey['resonator:1412:innate_gift:stacks']?.ownerKey).toBe('resonator:1412:innate_gift')
    expect(statesByKey['inherent:1412:lvl70:blessing_of_runes']?.displayScope).toBe('both')
    expect(statesByKey['sequence:1412:s4:active']?.displayScope).toBe('both')
    expect(runtimeEffects.some((effect) => effect.id === '1412:lvl70:blessing-of-runes:base' && effect.targetScope === 'teamWide')).toBe(true)
    expect(
      runtimeEffects.some(
        (effect) => effect.id === '1412:lvl70:blessing-of-runes:self-capstone' && effect.targetScope === 'self',
      ),
    ).toBe(true)

    expect(runtimeEffects.length).toBeGreaterThan(0)
    expect(skillEffects.length).toBeGreaterThan(0)
  })
})

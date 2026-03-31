import { describe, expect, it } from 'vitest'
import { getResonatorById, listResonators } from '@/domain/services/catalogService'
import { listEffectsForSource, listSkillsForSource, listSources, listStatesForSource } from '@/domain/services/gameDataService'
import { createDefaultResonatorRuntime } from '@/domain/state/defaults'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'

describe('game-data source of truth', () => {
  it('hydrates resonator skill catalogs from generated resonator definitions', () => {
    const resonator = getResonatorById('1412')
    if (!resonator) {
      throw new Error('missing resonator 1412')
    }

    const skillLabels = resonator.skills.map((skill) => skill.label)
    expect(skillLabels).toContain('Solsworn Etymology DMG')
    expect(skillLabels).toContain('Basic Attack Stage 3 DMG')
    expect(skillLabels).toContain('BOOMY BOOM! DMG')
    expect(skillLabels).toContain('Where Trust Leads Me! DMG')
    expect(skillLabels).toContain('In This Very Moment DMG')
    expect(resonator.skills.find((skill) => skill.label === 'Basic Attack Stage 3 DMG')?.hits).toHaveLength(3)
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
    const dreamlessStates = listStatesForSource('echo', '6000053')
    const crownlessSkills = listSkillsForSource('echo', '6000090')
    const twinNovaSkills = listSkillsForSource('echo', '6000179')
    const spacetrekSkills = listSkillsForSource('echo', '6000184')
    const fallacyEffects = listEffectsForSource('echo', '6000060')
    const geocheloneEffects = listEffectsForSource('echo', '390080005')
    const impermanenceStates = listStatesForSource('echo', '6000052')
    const impermanenceEffects = listEffectsForSource('echo', '6000052')
    const hyvatiaStates = listStatesForSource('echo', '6000189')
    const hyvatiaEffects = listEffectsForSource('echo', '6000189')

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
    expect(fallacyEffects.find((effect) => effect.id === 'echo:6000060:effect:toggle:self')?.targetScope).toBe('self')
    expect(fallacyEffects.find((effect) => effect.id === 'echo:6000060:effect:toggle:teamWide')?.targetScope).toBe('teamWide')
    expect(geocheloneEffects.find((effect) => effect.id === 'echo:390080005:effect:teamwide-buff')?.targetScope).toBe('teamWide')
  })

  it('emits teamwide and incoming-resonator echo-set scopes from the set source definitions', () => {
    const rejuvenatingEffects = listEffectsForSource('echoSet', '7')
    const moonlitEffects = listEffectsForSource('echoSet', '8')
    const midnightEffects = listEffectsForSource('echoSet', '12')
    const empyreanEffects = listEffectsForSource('echoSet', '13')
    const gustsEffects = listEffectsForSource('echoSet', '16')
    const clawprintEffects = listEffectsForSource('echoSet', '18')
    const harmonyEffects = listEffectsForSource('echoSet', '21')
    const neonlightEffects = listEffectsForSource('echoSet', '24')
    const starryEffects = listEffectsForSource('echoSet', '25')
    const chromaticEffects = listEffectsForSource('echoSet', '28')

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

    expect(resonator.rotations[0]?.items).toHaveLength(9)
    expect(
      resonator.rotations[0]?.items.map((item) =>
        item.type === 'feature' ? labelsByFeatureId[item.featureId] : null,
      ),
    ).toEqual([
      'Golden Grace DMG',
      'To Where Light Shines DMG',
      'Absolution Litany DMG',
      'Dawn of Enlightenment DMG',
      "Chamuel's Star: Stage 1 DMG",
      "Chamuel's Star: Stage 2 DMG",
      "Chamuel's Star: Stage 3 DMG",
      'Heavy Attack: Starflash DMG',
      'Attentive Heart DMG',
    ])
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
    expect(listEffectsForSource('resonator', '1506', 'runtime')).not.toEqual([])
    expect(listEffectsForSource('resonator', '1506', 'skill')).not.toEqual([])
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
    const resonator = getResonatorById('1307')
    if (!resonator) {
      throw new Error('missing resonator 1307')
    }

    expect(resonator.rotations[0]?.items).toEqual([])
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
      const tuneRupture = resonator.skills.find((skill) => skill.tab === 'tuneBreak')
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

    expect(kaleidoscope?.label).toBe('Kaleidoscope Sparks DMG')
    expect(convolution?.label).toBe('Prodigy of Proteges: Convolution Matrices DMG')
    expect(recreation?.label).toBe('Reality Recreation DMG')
    expect(convolution?.hitTable?.length).toBeGreaterThan(0)
    expect(recreation?.hitTable?.length).toBeGreaterThan(0)

    const carlottaRuntime = createDefaultResonatorRuntime(carlotta)
    const yaoRuntime = createDefaultResonatorRuntime(yao)
    const rocciaRuntime = createDefaultResonatorRuntime(roccia)

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
    const ciaccona = getResonatorById('1407')
    const verina = getResonatorById('1503')
    const shorekeeper = getResonatorById('1505')
    const taoqi = getResonatorById('1601')

    if (!baizhi || !ciaccona || !verina || !shorekeeper || !taoqi) {
      throw new Error('missing generated resonator data for synthetic support additions')
    }

    const stimulusFeedback = baizhi.skills.find((skill) => skill.id === '1103:stimulus-feedback')
    const hot = baizhi.skills.find((skill) => skill.id === '1103:lightning-manipulation-hot')
    const interludeTune = ciaccona.skills.find((skill) => skill.id === '1407:interlude-tune')
    const graceOfLifeShield = verina.skills.find((skill) => skill.id === '1503:grace-of-life-shield')
    const blossomHealing = verina.skills.find((skill) => skill.id === '1503:moment-of-emergence-healing')
    const lifeEntwined = shorekeeper.skills.find((skill) => skill.id === '1505:life-entwined-healing')
    const strategicParryHealing = taoqi.skills.find((skill) => skill.id === '1601:strategic-parry-healing')

    expect(stimulusFeedback?.archetype).toBe('healing')
    expect(hot?.archetype).toBe('healing')
    expect(interludeTune?.archetype).toBe('shield')
    expect(graceOfLifeShield?.archetype).toBe('shield')
    expect(blossomHealing?.archetype).toBe('healing')
    expect(lifeEntwined?.archetype).toBe('healing')
    expect(strategicParryHealing?.archetype).toBe('healing')

    const baizhiRuntime = createDefaultResonatorRuntime(baizhi)
    const ciacconaRuntime = createDefaultResonatorRuntime(ciaccona)
    const verinaRuntime = createDefaultResonatorRuntime(verina)
    const shorekeeperRuntime = createDefaultResonatorRuntime(shorekeeper)
    const taoqiRuntime = createDefaultResonatorRuntime(taoqi)

    baizhiRuntime.base.level = 40
    ciacconaRuntime.base.level = 40
    verinaRuntime.base.level = 60
    verinaRuntime.base.sequence = 0
    shorekeeperRuntime.base.level = 40
    taoqiRuntime.base.sequence = 0

    expect(resolveSkill(baizhiRuntime, stimulusFeedback!).visible).toBe(false)
    expect(resolveSkill(baizhiRuntime, hot!).visible).toBe(true)
    expect(resolveSkill(ciacconaRuntime, interludeTune!).visible).toBe(false)
    expect(resolveSkill(verinaRuntime, graceOfLifeShield!).visible).toBe(false)
    expect(resolveSkill(verinaRuntime, blossomHealing!).visible).toBe(false)
    expect(resolveSkill(shorekeeperRuntime, lifeEntwined!).visible).toBe(false)
    expect(resolveSkill(taoqiRuntime, strategicParryHealing!).visible).toBe(false)

    baizhiRuntime.base.level = 70
    ciacconaRuntime.base.level = 50
    verinaRuntime.base.level = 70
    verinaRuntime.base.sequence = 1
    shorekeeperRuntime.base.level = 50
    taoqiRuntime.base.sequence = 4

    expect(resolveSkill(baizhiRuntime, stimulusFeedback!).visible).toBe(true)
    expect(resolveSkill(ciacconaRuntime, interludeTune!).visible).toBe(true)
    expect(resolveSkill(verinaRuntime, graceOfLifeShield!).visible).toBe(true)
    expect(resolveSkill(verinaRuntime, blossomHealing!).visible).toBe(true)
    expect(resolveSkill(shorekeeperRuntime, lifeEntwined!).visible).toBe(true)
    expect(resolveSkill(taoqiRuntime, strategicParryHealing!).visible).toBe(true)
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

    const mornyeRuntimeEffects = listEffectsForSource('resonator', '1209', 'runtime')
    const mornyeSkillEffects = listEffectsForSource('resonator', '1209', 'skill')
    const aemeathRuntimeEffects = listEffectsForSource('resonator', '1210', 'runtime')
    const aemeathSkillEffects = listEffectsForSource('resonator', '1210', 'skill')
    const lynaeRuntimeEffects = listEffectsForSource('resonator', '1509', 'runtime')
    const lynaeSkillEffects = listEffectsForSource('resonator', '1509', 'skill')
    const luukRuntimeEffects = listEffectsForSource('resonator', '1510', 'runtime')
    const luukSkillEffects = listEffectsForSource('resonator', '1510', 'skill')

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
    const runtimeEffects = listEffectsForSource('resonator', '1412', 'runtime')
    const skillEffects = listEffectsForSource('resonator', '1412', 'skill')

    expect(skillsById['1412001']?.skillType).toEqual(['basicAtk'])
    expect(skillsById['1412011']?.skillType).toEqual(['resonanceSkill'])
    expect(skillsById['1412021']?.skillType).toEqual(['echoSkill'])
    expect(skillsById['1412:outro']?.multiplier).toBe(7.95)

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

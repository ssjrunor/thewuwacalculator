import { describe, expect, it } from 'vitest'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext'
import { runCombatGraphSimulation, runResonatorSimulation } from '@/engine/pipeline'
import {
  createDefaultResonatorRuntime,
  createDefaultTeamMemberRuntimeView,
  materializeTeamMemberRuntimeView,
  makeDefaultEnemyProfile,
  makeDefaultWeaponBuildState,
} from '@/domain/state/defaults'
import { createEchoUid } from '@/domain/entities/runtime'
import { buildTransientCombatGraph, findCombatParticipantSlotId } from '@/domain/state/combatGraph'
import { getResonatorById } from '@/domain/services/catalogService'

function withoutWeapon(runtime: ReturnType<typeof createDefaultResonatorRuntime>) {
  runtime.build.weapon = makeDefaultWeaponBuildState()
  return runtime
}

function makeMainEcho(id: string, set = 4) {
  return {
    uid: createEchoUid(),
    id,
    set,
    mainEcho: true,
    mainStats: {
      primary: { key: 'critRate', value: 22 },
      secondary: { key: 'atkFlat', value: 150 },
    },
    substats: {},
  }
}

function makeSetEcho(id: string, set: number, mainEcho = false) {
  return {
    ...makeMainEcho(id, set),
    mainEcho,
  }
}

function makeSetLoadout(set: number) {
  return [
    makeSetEcho('6000038', set, true),
    makeSetEcho('6000039', set),
    makeSetEcho('6000040', set),
    makeSetEcho('6000041', set),
    makeSetEcho('6000042', set),
  ]
}

function buildContextFromRuntimes(options: {
  activeRuntime: ReturnType<typeof createDefaultResonatorRuntime>
  targetRuntime?: ReturnType<typeof createDefaultResonatorRuntime>
  participantRuntimes?: Record<string, ReturnType<typeof createDefaultResonatorRuntime>>
  enemy: ReturnType<typeof makeDefaultEnemyProfile>
  selectedTargetsByResonatorId?: Record<string, Record<string, string | null>>
}) {
  const graph = buildTransientCombatGraph({
    activeRuntime: options.activeRuntime,
    participantRuntimes: options.participantRuntimes,
    selectedTargetsByResonatorId: options.selectedTargetsByResonatorId,
  })
  const targetRuntime = options.targetRuntime ?? options.activeRuntime
  const targetSlotId = findCombatParticipantSlotId(graph, targetRuntime.id)

  if (!targetSlotId) {
    throw new Error(`missing graph participant for ${targetRuntime.id}`)
  }

  return buildCombatContext({
    graph,
    targetSlotId,
    enemy: options.enemy,
  })
}

describe('simulation pipeline', () => {
  it('does not inject non-resonator runtime buffs from weapon or echo build inputs', () => {
    const seed = getResonatorById('1412')
    if (!seed) {
      throw new Error('missing seed resonator 1412')
    }

    const runtime = createDefaultResonatorRuntime(seed)
    runtime.build.weapon.id = 'sunward'
    runtime.build.weapon.rank = 1
    runtime.build.echoes[0] = makeMainEcho('6000038')

    const context = buildContextFromRuntimes({
      activeRuntime: runtime,
      enemy: makeDefaultEnemyProfile(),
    })

    expect(context.buffs.atk.percent).toBe(0)
    expect(context.buffs.skillType.echoSkill.amplify).toBe(0)
    expect(context.buffs.attribute.aero.defIgnore).toBe(0)
    expect(context.buffs.attribute.aero.dmgBonus).toBe(0)
    expect(context.buffs.skillType.echoSkill.dmgBonus).toBe(0)
  })

  it('injects main echo attack skills into the live simulation catalog', () => {
    const seed = getResonatorById('1506')
    if (!seed) {
      throw new Error('missing seed resonator 1506')
    }

    const runtime = withoutWeapon(createDefaultResonatorRuntime(seed))
    runtime.build.echoes[0] = makeMainEcho('6000090')

    const result = runResonatorSimulation(runtime, seed, makeDefaultEnemyProfile())
    const echoSkill = result.allSkills.find((entry) => entry.skill.id === 'echo:6000090:skill:1')

    expect(echoSkill?.feature.source).toEqual({ type: 'echo', id: '6000090' })
    expect(echoSkill?.skill.tab).toBe('echoAttacks')
    expect(echoSkill?.skill.skillType).toEqual(['echoSkill'])
    expect(echoSkill?.avg).toBeGreaterThan(0)
  })

  it('applies main echo toggle states to echo attack damage', () => {
    const seed = getResonatorById('1506')
    if (!seed) {
      throw new Error('missing seed resonator 1506')
    }

    const disabledRuntime = withoutWeapon(createDefaultResonatorRuntime(seed))
    disabledRuntime.build.echoes[0] = makeMainEcho('6000053')

    const enabledRuntime = withoutWeapon(createDefaultResonatorRuntime(seed))
    enabledRuntime.build.echoes[0] = makeMainEcho('6000053')
    enabledRuntime.state.controls['echo:6000053:main:active'] = true

    const disabledResult = runResonatorSimulation(disabledRuntime, seed, makeDefaultEnemyProfile())
    const enabledResult = runResonatorSimulation(enabledRuntime, seed, makeDefaultEnemyProfile())

    const disabledEchoSkill = disabledResult.allSkills.find((entry) => entry.skill.id === 'echo:6000053:skill:1')
    const enabledEchoSkill = enabledResult.allSkills.find((entry) => entry.skill.id === 'echo:6000053:skill:1')

    expect(disabledEchoSkill?.avg).toBeGreaterThan(0)
    expect(enabledEchoSkill?.avg).toBeGreaterThan(disabledEchoSkill?.avg ?? 0)
  })

  it('applies Fallacy of No Return main-echo buffs with mixed self and teamwide scope', () => {
    const sourceSeed = getResonatorById('1506')
    const teammateSeed = getResonatorById('1208')
    if (!sourceSeed || !teammateSeed) {
      throw new Error('missing seed resonators 1506 or 1208')
    }

    const sourceRuntime = withoutWeapon(createDefaultResonatorRuntime(sourceSeed))
    sourceRuntime.build.echoes[0] = makeMainEcho('6000060')
    sourceRuntime.state.controls['echo:6000060:main:active'] = true
    sourceRuntime.build.team[1] = '1208'

    const teammateRuntime = withoutWeapon(createDefaultResonatorRuntime(teammateSeed))

    const sourceContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const teammateContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(sourceContext.buffs.energyRegen).toBe(10)
    expect(sourceContext.buffs.atk.percent).toBe(10)

    expect(teammateContext.buffs.energyRegen).toBe(0)
    expect(teammateContext.buffs.atk.percent).toBe(10)
  })

  it('applies Bell-Borne Geochelone main-echo damage bonus teamwide', () => {
    const sourceSeed = getResonatorById('1506')
    const teammateSeed = getResonatorById('1208')
    if (!sourceSeed || !teammateSeed) {
      throw new Error('missing seed resonators 1506 or 1208')
    }

    const sourceRuntime = withoutWeapon(createDefaultResonatorRuntime(sourceSeed))
    sourceRuntime.build.echoes[0] = makeMainEcho('390080005')
    sourceRuntime.state.controls['echo:390080005:main:active'] = true
    sourceRuntime.build.team[1] = '1208'

    const teammateRuntime = withoutWeapon(createDefaultResonatorRuntime(teammateSeed))

    const sourceContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const teammateContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(sourceContext.buffs.dmgBonus).toBe(10)
    expect(teammateContext.buffs.dmgBonus).toBe(10)
  })

  it('applies incoming-resonator and teamwide echo-set buffs with the expected scopes', () => {
    const sourceSeed = getResonatorById('1506')
    const teammateSeed = getResonatorById('1208')
    if (!sourceSeed || !teammateSeed) {
      throw new Error('missing seed resonators 1506 or 1208')
    }

    const runtime = withoutWeapon(createDefaultResonatorRuntime(sourceSeed))
    runtime.build.team[1] = '1208'
    runtime.build.echoes = makeSetLoadout(8)
    runtime.state.controls['echoSet:8:bonus:moonlit5'] = true

    const teammateRuntime = withoutWeapon(createDefaultResonatorRuntime(teammateSeed))

    const sourceContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const teammateContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(sourceContext.buffs.atk.percent).toBe(0)
    expect(teammateContext.buffs.atk.percent).toBe(22.5)

    runtime.build.echoes = makeSetLoadout(16)
    runtime.state.controls = { 'echoSet:16:bonus:welkin5': true }

    const gustsSourceContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const gustsTeammateContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(gustsSourceContext.buffs.attribute.aero.dmgBonus).toBe(40)
    expect(gustsTeammateContext.buffs.attribute.aero.dmgBonus).toBe(15)

    runtime.build.echoes = makeSetLoadout(21)
    runtime.state.controls = { 'echoSet:21:bonus:lawOfHarmony3p': 4 }

    const harmonySourceContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const harmonyTeammateContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(harmonySourceContext.buffs.skillType.heavyAtk.dmgBonus).toBe(30)
    expect(harmonySourceContext.buffs.skillType.echoSkill.dmgBonus).toBe(16)
    expect(harmonyTeammateContext.buffs.skillType.heavyAtk.dmgBonus).toBe(0)
    expect(harmonyTeammateContext.buffs.skillType.echoSkill.dmgBonus).toBe(16)
  })

  it('applies incoming-resonator main-echo buffs to activeOther targets', () => {
    const sourceSeed = getResonatorById('1506')
    const teammateSeed = getResonatorById('1208')
    if (!sourceSeed || !teammateSeed) {
      throw new Error('missing seed resonators 1506 or 1208')
    }

    const sourceRuntime = withoutWeapon(createDefaultResonatorRuntime(sourceSeed))
    sourceRuntime.build.team[1] = '1208'
    sourceRuntime.build.echoes[0] = makeMainEcho('6000052')
    sourceRuntime.state.controls['echo:6000052:main:active'] = true

    const teammateRuntime = withoutWeapon(createDefaultResonatorRuntime(teammateSeed))

    const sourceContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const teammateContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(sourceContext.buffs.dmgBonus).toBe(0)
    expect(teammateContext.buffs.dmgBonus).toBe(12)

    sourceRuntime.build.echoes[0] = makeMainEcho('6000189')
    sourceRuntime.state.controls = { 'echo:6000189:main:active': true }

    const hyvatiaSourceContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    const hyvatiaTeammateContext = buildContextFromRuntimes({
      activeRuntime: sourceRuntime,
      targetRuntime: teammateRuntime,
      participantRuntimes: { '1208': teammateRuntime },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(hyvatiaSourceContext.buffs.attribute.spectro.dmgBonus).toBe(0)
    expect(hyvatiaTeammateContext.buffs.attribute.spectro.dmgBonus).toBe(10)
    expect(hyvatiaTeammateContext.buffs.attribute.fusion.dmgBonus).toBe(10)
  })

  it("applies Flamewing's Shadow 3pc Fusion synergy only when both triggers are active", () => {
    const seed = getResonatorById('1208')
    if (!seed) {
      throw new Error('missing seed resonator 1208')
    }

    const runtime = withoutWeapon(createDefaultResonatorRuntime(seed))
    runtime.build.echoes[0] = makeMainEcho('6000038', 22)
    runtime.build.echoes[1] = {
      ...makeMainEcho('6000039', 22),
      mainEcho: false,
    }
    runtime.build.echoes[2] = {
      ...makeMainEcho('6000040', 22),
      mainEcho: false,
    }

    const baseContext = buildContextFromRuntimes({
      activeRuntime: runtime,
      enemy: makeDefaultEnemyProfile(),
    })

    const oneTriggerRuntime = {
      ...runtime,
      state: {
        ...runtime.state,
        controls: {
          ...runtime.state.controls,
          'echoSet:22:bonus:flamewingsShadow2pcP1': true,
        },
      },
    }
    const oneTriggerContext = buildContextFromRuntimes({
      activeRuntime: oneTriggerRuntime,
      enemy: makeDefaultEnemyProfile(),
    })

    const bothTriggersRuntime = {
      ...runtime,
      state: {
        ...runtime.state,
        controls: {
          ...runtime.state.controls,
          'echoSet:22:bonus:flamewingsShadow2pcP1': true,
          'echoSet:22:bonus:flamewingsShadow2pcP2': true,
        },
      },
    }
    const bothTriggersContext = buildContextFromRuntimes({
      activeRuntime: bothTriggersRuntime,
      enemy: makeDefaultEnemyProfile(),
    })

    expect(baseContext.buffs.skillType.heavyAtk.critRate).toBe(0)
    expect(baseContext.buffs.skillType.echoSkill.critRate).toBe(0)
    expect(baseContext.buffs.attribute.fusion.dmgBonus).toBe(0)

    expect(oneTriggerContext.buffs.skillType.heavyAtk.critRate).toBe(20)
    expect(oneTriggerContext.buffs.skillType.echoSkill.critRate).toBe(0)
    expect(oneTriggerContext.buffs.attribute.fusion.dmgBonus).toBe(0)

    expect(bothTriggersContext.buffs.skillType.heavyAtk.critRate).toBe(20)
    expect(bothTriggersContext.buffs.skillType.echoSkill.critRate).toBe(20)
    expect(bothTriggersContext.buffs.attribute.fusion.dmgBonus).toBe(16)
  })

  it('keeps rotation totals equal to the sum of all hit results', () => {
    const seed = getResonatorById('1506')
    if (!seed) {
      throw new Error('missing seed resonator 1506')
    }

    const runtime = createDefaultResonatorRuntime(seed)
    const result = runResonatorSimulation(runtime, seed, makeDefaultEnemyProfile())
    const summed = result.perSkill.reduce(
      (total, entry) => {
        total.normal += entry.subHits.reduce((sum, hit) => sum + hit.normal * hit.count, 0)
        total.crit += entry.subHits.reduce((sum, hit) => sum + hit.crit * hit.count, 0)
        total.avg += entry.subHits.reduce((sum, hit) => sum + hit.avg * hit.count, 0)
        return total
      },
      { normal: 0, crit: 0, avg: 0 },
    )

    expect(result.perSkill.length).toBeGreaterThan(0)
    expect(result.total.normal).toBeCloseTo(summed.normal)
    expect(result.total.crit).toBeCloseTo(summed.crit)
    expect(result.total.avg).toBeCloseTo(summed.avg)
  })

  it('applies 1412 generated runtime and skill overrides', () => {
    const seed = getResonatorById('1412')
    if (!seed) {
      throw new Error('missing seed resonator 1412')
    }

    const baseRuntime = withoutWeapon(createDefaultResonatorRuntime(seed))
    const sequence4Runtime = {
      ...baseRuntime,
      base: {
        ...baseRuntime.base,
        sequence: 4,
        traceNodes: baseRuntime.base.traceNodes,
        skillLevels: baseRuntime.base.skillLevels,
      },
      state: {
        ...baseRuntime.state,
        controls: {
          ...baseRuntime.state.controls,
          'sequence:1412:s4:active': true,
        },
      },
    }
    const sequence5Runtime = {
      ...sequence4Runtime,
      base: {
        ...sequence4Runtime.base,
        sequence: 5,
      },
    }
    const sequence6Runtime = {
      ...sequence5Runtime,
      base: {
        ...sequence5Runtime.base,
        sequence: 6,
      },
      state: {
        ...sequence5Runtime.state,
        controls: {
          ...sequence5Runtime.state.controls,
          'resonator:1412:innate_gift:stacks': 4,
        },
      },
    }

    const enemy = makeDefaultEnemyProfile()

    const baseline = runResonatorSimulation(baseRuntime, seed, enemy)
    const sequence4 = runResonatorSimulation(sequence4Runtime, seed, enemy)
    const sequence5 = runResonatorSimulation(sequence5Runtime, seed, enemy)
    const sequence6 = runResonatorSimulation(sequence6Runtime, seed, enemy)

    const sequence4Context = buildContextFromRuntimes({
      activeRuntime: sequence4Runtime,
      enemy,
    })
    const sequence6Context = buildContextFromRuntimes({
      activeRuntime: sequence6Runtime,
      enemy,
    })

    const findSkill = (result: typeof baseline, skillId: string) =>
      result.allSkills.find((entry) => entry.skill.id === skillId)

    const baseUlt = findSkill(baseline, '1412015')
    const seq4Ult = findSkill(sequence4, '1412015')
    const seq5Ult = findSkill(sequence5, '1412015')
    const baseLearnMyTrueName = findSkill(baseline, '1412025')
    const seq6LearnMyTrueName = findSkill(sequence6, '1412025')

    expect(sequence4Context.buffs.atk.percent).toBe(20)
    expect(sequence6Context.buffs.attribute.all.dmgVuln).toBe(30)
    expect(seq4Ult?.avg).toBeGreaterThan(baseUlt?.avg ?? 0)
    expect(seq5Ult?.avg).toBeGreaterThan(seq4Ult?.avg ?? 0)
    expect(seq6LearnMyTrueName?.avg).toBeGreaterThan(baseLearnMyTrueName?.avg ?? 0)
  })

  it('applies Phoebe generated runtime and skill effects without a custom runtime path', () => {
    const seed = getResonatorById('1506')
    if (!seed) {
      throw new Error('missing seed resonator 1506')
    }

    const enemy = {
      id: 'training-dummy',
      level: 90,
      class: 0,
      toa: false,
      res: {
        0: 10,
        1: 10,
        2: 10,
        3: 10,
        4: 10,
        5: 10,
        6: 10,
      },
    }

    const baseline = withoutWeapon(createDefaultResonatorRuntime(seed))
    const absolution = withoutWeapon(createDefaultResonatorRuntime(seed))
    absolution.base.level = 70
    absolution.state.controls['resonator:1506:absolution:active'] = true
    absolution.state.combat.spectroFrazzle = 1

    const confession = withoutWeapon(createDefaultResonatorRuntime(seed))
    confession.state.controls['resonator:1506:confession:active'] = true
    confession.state.controls['resonator:1506:attentive_heart:active'] = true

    const sequence = withoutWeapon(createDefaultResonatorRuntime(seed))
    sequence.base.sequence = 6
    sequence.state.controls['sequence:1506:s4:active'] = true
    sequence.state.controls['sequence:1506:s5:active'] = true
    sequence.state.controls['sequence:1506:s6:active'] = true

    const absolutionContext = buildContextFromRuntimes({
      activeRuntime: absolution,
      enemy,
    })
    const confessionContext = buildContextFromRuntimes({
      activeRuntime: confession,
      enemy,
    })
    const sequenceContext = buildContextFromRuntimes({
      activeRuntime: sequence,
      enemy,
    })

    const baselineResult = runResonatorSimulation(baseline, seed, enemy)
    const absolutionResult = runResonatorSimulation(absolution, seed, enemy)
    const confessionResult = runResonatorSimulation(confession, seed, enemy)

    const findSkill = (result: typeof baselineResult, skillId: string) =>
      result.allSkills.find((entry) => entry.skill.id === skillId)

    expect(absolutionContext.buffs.attribute.spectro.dmgBonus).toBe(12)
    expect(confessionContext.buffs.attribute.spectro.resShred).toBe(10)
    expect(confessionContext.buffs.skillType.spectroFrazzle.resShred).toBe(0)
    expect(confessionContext.buffs.skillType.spectroFrazzle.amplify).toBe(100)
    expect(sequenceContext.buffs.attribute.spectro.resShred).toBe(10)
    expect(sequenceContext.buffs.attribute.spectro.dmgBonus).toBe(12)
    expect(sequenceContext.buffs.atk.percent).toBe(10)

    expect(findSkill(absolutionResult, '1506026')?.avg).toBeGreaterThan(findSkill(baselineResult, '1506026')?.avg ?? 0)
    expect(findSkill(absolutionResult, '1506020')?.avg).toBeGreaterThan(findSkill(baselineResult, '1506020')?.avg ?? 0)
    expect(findSkill(absolutionResult, '1506:outro')?.avg).toBeGreaterThan(findSkill(baselineResult, '1506:outro')?.avg ?? 0)
    expect(findSkill(confessionResult, '1506020')?.avg).toBeGreaterThan(findSkill(baselineResult, '1506020')?.avg ?? 0)
  })

  it('applies Lupa fusion-team and Wolflame team buffs using team composition context', () => {
    const seed = getResonatorById('1207')
    const fusionMate1 = getResonatorById('1208')
    const fusionMate2 = getResonatorById('1209')
    const mixedMate1 = getResonatorById('1510')
    const mixedMate2 = getResonatorById('1506')

    if (!seed || !fusionMate1 || !fusionMate2 || !mixedMate1 || !mixedMate2) {
      throw new Error('missing seed resonator 1207')
    }

    const enemy = makeDefaultEnemyProfile()
    const fusionParticipants = {
      [fusionMate1.id]: withoutWeapon(createDefaultResonatorRuntime(fusionMate1)),
      [fusionMate2.id]: withoutWeapon(createDefaultResonatorRuntime(fusionMate2)),
    }
    const mixedParticipants = {
      [mixedMate1.id]: withoutWeapon(createDefaultResonatorRuntime(mixedMate1)),
      [mixedMate2.id]: withoutWeapon(createDefaultResonatorRuntime(mixedMate2)),
    }

    const fusionTeam = withoutWeapon(createDefaultResonatorRuntime(seed))
    fusionTeam.build.team = [seed.id, '1208', '1209']
    fusionTeam.state.controls['team:1207:pack_hunt:active'] = true
    fusionTeam.state.controls['team:1207:glory:stacks'] = 1

    const mixedTeam = withoutWeapon(createDefaultResonatorRuntime(seed))
    mixedTeam.build.team = [seed.id, '1510', '1506']
    mixedTeam.state.controls['team:1207:pack_hunt:active'] = true
    mixedTeam.state.controls['team:1207:glory:stacks'] = 1

    const wolflameTeam = withoutWeapon(createDefaultResonatorRuntime(seed))
    wolflameTeam.base.sequence = 3
    wolflameTeam.build.team = [seed.id, '1510', '1506']
    wolflameTeam.state.controls['team:1207:pack_hunt:active'] = true
    wolflameTeam.state.controls['team:1207:glory:stacks'] = 1
    wolflameTeam.state.controls['sequence:1207:s3:active'] = true

    const fusionContext = buildContextFromRuntimes({ activeRuntime: fusionTeam, participantRuntimes: fusionParticipants, enemy })
    const mixedContext = buildContextFromRuntimes({ activeRuntime: mixedTeam, participantRuntimes: mixedParticipants, enemy })
    const wolflameContext = buildContextFromRuntimes({ activeRuntime: wolflameTeam, participantRuntimes: mixedParticipants, enemy })

    expect(fusionContext.buffs.attribute.fusion.resShred).toBe(0)
    expect(mixedContext.buffs.attribute.fusion.resShred).toBe(0)
    expect(wolflameContext.buffs.attribute.fusion.resShred).toBe(0)

    expect(fusionContext.buffs.attribute.fusion.dmgBonus).toBe(20)
    expect(mixedContext.buffs.attribute.fusion.dmgBonus).toBe(10)
    expect(wolflameContext.buffs.attribute.fusion.dmgBonus).toBe(20)
  })

  it('applies all modeled 1207 teammate features with 1208 as the active resonator and 1207 as the teammate', () => {
    const activeSeed = getResonatorById('1208')
    const teammateSeed = getResonatorById('1207')

    if (!activeSeed || !teammateSeed) {
      throw new Error('missing required resonator seeds for 1207 teammate validation')
    }

    const enemy = makeDefaultEnemyProfile()
    const activeRuntime = withoutWeapon(createDefaultResonatorRuntime(activeSeed))
    const teammateRuntime = withoutWeapon(createDefaultResonatorRuntime(teammateSeed))

    activeRuntime.build.team = [activeSeed.id, teammateSeed.id, null]

    teammateRuntime.base.level = 70
    teammateRuntime.base.sequence = 6
    teammateRuntime.build.team = [activeSeed.id, teammateSeed.id, null]
    teammateRuntime.state.controls['resonator:1207:wildfire_banner:active'] = true
    teammateRuntime.state.controls['team:1207:pack_hunt:active'] = true
    teammateRuntime.state.controls['team:1207:pack_hunt:stacks'] = 2
    teammateRuntime.state.controls['team:1207:glory:stacks'] = 1
    teammateRuntime.state.controls['team:1207:stand_by_me_warrior:active'] = true
    teammateRuntime.state.controls['inherent:1207:lvl70:stacks'] = 1
    teammateRuntime.state.controls['sequence:1207:s1:active'] = true
    teammateRuntime.state.controls['sequence:1207:s2:stacks'] = 2
    teammateRuntime.state.controls['sequence:1207:s3:active'] = true
    teammateRuntime.state.controls['sequence:1207:s5:active'] = true

    const participantRuntimes = {
      [teammateSeed.id]: teammateRuntime,
    }

    const activeContext = buildContextFromRuntimes({
      activeRuntime,
      participantRuntimes,
      enemy,
    })
    const teammateContext = buildContextFromRuntimes({
      activeRuntime,
      targetRuntime: teammateRuntime,
      participantRuntimes,
      enemy,
    })

    expect(activeContext.buffs.atk.percent).toBe(18)
    expect(activeContext.buffs.attribute.fusion.dmgBonus).toBe(60)
    expect(activeContext.buffs.attribute.fusion.resShred).toBe(15)
    expect(activeContext.buffs.attribute.fusion.amplify).toBe(20)
    expect(activeContext.buffs.skillType.basicAtk.amplify).toBe(25)

    expect(teammateContext.buffs.atk.percent).toBe(30)
    expect(teammateContext.buffs.attribute.fusion.dmgBonus).toBe(60)
    expect(teammateContext.buffs.attribute.fusion.resShred).toBe(15)
    expect(teammateContext.buffs.critRate).toBe(20)
    expect(teammateContext.buffs.skillType.resonanceLiberation.dmgBonus).toBe(15)

    const baselineActiveRuntime = withoutWeapon(createDefaultResonatorRuntime(activeSeed))
    const baselineTeammateRuntime = withoutWeapon(createDefaultResonatorRuntime(teammateSeed))
    baselineActiveRuntime.build.team = [activeSeed.id, teammateSeed.id, null]
    baselineTeammateRuntime.base.level = 70
    baselineTeammateRuntime.build.team = [activeSeed.id, teammateSeed.id, null]

    const baselineGraph = buildTransientCombatGraph({
      activeRuntime: baselineActiveRuntime,
      participantRuntimes: {
        [teammateSeed.id]: baselineTeammateRuntime,
      },
    })
    const buffedGraph = buildTransientCombatGraph({
      activeRuntime,
      participantRuntimes,
    })
    const baselineTargetSlotId = findCombatParticipantSlotId(baselineGraph, teammateSeed.id)
    const buffedTargetSlotId = findCombatParticipantSlotId(buffedGraph, teammateSeed.id)

    if (!baselineTargetSlotId || !buffedTargetSlotId) {
      throw new Error('missing combat graph slot for 1207 teammate simulation')
    }

    const baselineResult = runCombatGraphSimulation(baselineGraph, baselineTargetSlotId, teammateSeed, enemy)
    const buffedResult = runCombatGraphSimulation(buffedGraph, buffedTargetSlotId, teammateSeed, enemy)
    const findSkill = (result: typeof baselineResult, skillId: string) =>
      result.allSkills.find((entry) => entry.skill.id === skillId)

    expect(findSkill(buffedResult, '1207034')?.avg).toBeGreaterThan(findSkill(baselineResult, '1207034')?.avg ?? 0)
    expect(findSkill(buffedResult, '1207025')?.avg).toBeGreaterThan(findSkill(baselineResult, '1207025')?.avg ?? 0)
    expect(findSkill(buffedResult, '1207027')?.avg).toBeGreaterThan(findSkill(baselineResult, '1207027')?.avg ?? 0)
  })

  it('applies all modeled 1207 teammate features with 1208 active and 1207 plus 1209 as teammates', () => {
    const activeSeed = getResonatorById('1208')
    const lupaSeed = getResonatorById('1207')
    const extraTeammateSeed = getResonatorById('1209')

    if (!activeSeed || !lupaSeed || !extraTeammateSeed) {
      throw new Error('missing required resonator seeds for 1207 full-fusion teammate validation')
    }

    const enemy = makeDefaultEnemyProfile()
    const activeRuntime = withoutWeapon(createDefaultResonatorRuntime(activeSeed))
    const lupaRuntime = withoutWeapon(createDefaultResonatorRuntime(lupaSeed))
    const extraTeammateRuntime = withoutWeapon(createDefaultResonatorRuntime(extraTeammateSeed))

    activeRuntime.build.team = [activeSeed.id, lupaSeed.id, extraTeammateSeed.id]

    lupaRuntime.base.level = 70
    lupaRuntime.base.sequence = 2
    lupaRuntime.build.team = [activeSeed.id, lupaSeed.id, extraTeammateSeed.id]
    lupaRuntime.state.controls['team:1207:pack_hunt:active'] = true
    lupaRuntime.state.controls['team:1207:pack_hunt:stacks'] = 2
    lupaRuntime.state.controls['team:1207:glory:stacks'] = 1
    lupaRuntime.state.controls['team:1207:stand_by_me_warrior:active'] = true
    lupaRuntime.state.controls['inherent:1207:lvl70:stacks'] = 1
    lupaRuntime.state.controls['sequence:1207:s2:stacks'] = 2

    extraTeammateRuntime.build.team = [activeSeed.id, lupaSeed.id, extraTeammateSeed.id]

    const participantRuntimes = {
      [lupaSeed.id]: lupaRuntime,
      [extraTeammateSeed.id]: extraTeammateRuntime,
    }

    const activeContext = buildContextFromRuntimes({
      activeRuntime,
      participantRuntimes,
      enemy,
    })
    const lupaContext = buildContextFromRuntimes({
      activeRuntime,
      targetRuntime: lupaRuntime,
      participantRuntimes,
      enemy,
    })
    const extraTeammateContext = buildContextFromRuntimes({
      activeRuntime,
      targetRuntime: extraTeammateRuntime,
      participantRuntimes,
      enemy,
    })

    expect(activeContext.buffs.atk.percent).toBe(18)
    expect(activeContext.buffs.attribute.fusion.dmgBonus).toBe(60)
    expect(activeContext.buffs.attribute.fusion.resShred).toBe(9)
    expect(activeContext.buffs.attribute.fusion.amplify).toBe(20)
    expect(activeContext.buffs.skillType.basicAtk.amplify).toBe(25)

    expect(extraTeammateContext.buffs.atk.percent).toBe(18)
    expect(extraTeammateContext.buffs.attribute.fusion.dmgBonus).toBe(60)
    expect(extraTeammateContext.buffs.attribute.fusion.resShred).toBe(9)
    expect(extraTeammateContext.buffs.attribute.fusion.amplify).toBe(0)
    expect(extraTeammateContext.buffs.skillType.basicAtk.amplify).toBe(0)

    expect(lupaContext.buffs.atk.percent).toBe(18)
    expect(lupaContext.buffs.attribute.fusion.dmgBonus).toBe(60)
    expect(lupaContext.buffs.attribute.fusion.resShred).toBe(9)
  })

  it('applies source-owned teamWide buffs to both the active resonator and teammates', () => {
    const activeSeed = getResonatorById('1412')
    const phoebeSeed = getResonatorById('1506')
    const targetSeed = getResonatorById('1505')

    if (!activeSeed || !phoebeSeed || !targetSeed) {
      throw new Error('missing required resonator seeds')
    }

    const activeRuntime = createDefaultResonatorRuntime(activeSeed)
    const phoebeRuntime = createDefaultResonatorRuntime(phoebeSeed)
    const targetRuntime = createDefaultResonatorRuntime(targetSeed)

    activeRuntime.build.team = [activeSeed.id, phoebeSeed.id, targetSeed.id]
    phoebeRuntime.state.controls['resonator:1506:confession:active'] = true
    phoebeRuntime.state.controls['resonator:1506:attentive_heart:active'] = true
    const runtimesById = {
      [activeSeed.id]: activeRuntime,
      [phoebeSeed.id]: phoebeRuntime,
      [targetSeed.id]: targetRuntime,
    }
    const enemy = makeDefaultEnemyProfile()

    const activeContext = buildContextFromRuntimes({
      activeRuntime,
      participantRuntimes: runtimesById,
      enemy,
      selectedTargetsByResonatorId: {
        [phoebeSeed.id]: {
          'resonator:1506:attentive_heart': targetSeed.id,
        },
      },
    })
    const targetContext = buildContextFromRuntimes({
      activeRuntime,
      targetRuntime,
      participantRuntimes: runtimesById,
      enemy,
      selectedTargetsByResonatorId: {
        [phoebeSeed.id]: {
          'resonator:1506:attentive_heart': targetSeed.id,
        },
      },
    })

    expect(activeContext.buffs.attribute.spectro.resShred).toBe(10)
    expect(activeContext.buffs.skillType.spectroFrazzle.amplify).toBe(100)
    expect(targetContext.buffs.attribute.spectro.resShred).toBe(10)
    expect(targetContext.buffs.skillType.spectroFrazzle.amplify).toBe(100)

    const sourceConfiguredActiveContext = buildContextFromRuntimes({
      activeRuntime,
      participantRuntimes: runtimesById,
      enemy,
      selectedTargetsByResonatorId: {
        [phoebeSeed.id]: {
          'resonator:1506:attentive_heart': targetSeed.id,
        },
      },
    })

    expect(sourceConfiguredActiveContext.buffs.attribute.spectro.resShred).toBe(10)
    expect(sourceConfiguredActiveContext.buffs.skillType.spectroFrazzle.amplify).toBe(100)
  })

  it('applies teamWide teammate buffs to other teammate combat contexts', () => {
    const activeSeed = getResonatorById('1412')
    const shorekeeperSeed = getResonatorById('1505')
    const targetSeed = getResonatorById('1506')

    if (!activeSeed || !shorekeeperSeed || !targetSeed) {
      throw new Error('missing required resonator seeds')
    }

    const activeRuntime = createDefaultResonatorRuntime(activeSeed)
    const shorekeeperRuntime = createDefaultResonatorRuntime(shorekeeperSeed)
    const targetRuntime = createDefaultResonatorRuntime(targetSeed)

    activeRuntime.build.team = [activeSeed.id, shorekeeperSeed.id, targetSeed.id]
    shorekeeperRuntime.state.controls['resonator:1505:inner_stellarealm:active'] = true
    shorekeeperRuntime.state.manualBuffs.quick.energyRegen = 150

    const runtimesById = {
      [activeSeed.id]: activeRuntime,
      [shorekeeperSeed.id]: shorekeeperRuntime,
      [targetSeed.id]: targetRuntime,
    }

    const enemy = makeDefaultEnemyProfile()
    const targetContext = buildContextFromRuntimes({
      activeRuntime,
      targetRuntime,
      participantRuntimes: runtimesById,
      enemy,
    })

    expect(targetContext.buffs.critRate).toBeGreaterThan(0)
  })

  it('keeps keyed state controls isolated per runtime instance', () => {
    const phoebeSeed = getResonatorById('1506')
    const shorekeeperSeed = getResonatorById('1505')

    if (!phoebeSeed || !shorekeeperSeed) {
      throw new Error('missing required resonator seeds')
    }

    const phoebeRuntime = createDefaultResonatorRuntime(phoebeSeed)
    const secondPhoebeRuntime = createDefaultResonatorRuntime(phoebeSeed)
    const shorekeeperRuntime = createDefaultResonatorRuntime(shorekeeperSeed)

    phoebeRuntime.state.controls['resonator:1506:confession:active'] = true
    phoebeRuntime.state.controls['resonator:1506:attentive_heart:active'] = true

    expect(secondPhoebeRuntime.state.controls['resonator:1506:confession:active']).toBe(false)
    expect(secondPhoebeRuntime.state.controls['resonator:1506:attentive_heart:active']).toBe(false)
    expect(shorekeeperRuntime.state.controls['resonator:1506:confession:active']).toBeUndefined()
    expect(shorekeeperRuntime.state.controls['resonator:1505:inner_stellarealm:active']).toBe(false)
  })

  it('materializes team member runtime views with maxed combat defaults and local team member sequence', () => {
    const activeSeed = getResonatorById('1412')
    const teammateSeed = getResonatorById('1506')

    if (!activeSeed || !teammateSeed) {
      throw new Error('missing required teammate runtime seeds')
    }

    const activeRuntime = createDefaultResonatorRuntime(activeSeed)
    activeRuntime.build.team = [activeSeed.id, teammateSeed.id, null]

    const teamMemberRuntimeView = createDefaultTeamMemberRuntimeView(teammateSeed)
    teamMemberRuntimeView.base.sequence = 2
    teamMemberRuntimeView.state.controls['resonator:1506:confession:active'] = true

    const teammateRuntime = materializeTeamMemberRuntimeView(
      teammateSeed,
      teamMemberRuntimeView,
      activeRuntime.build.team,
    )

    expect(teammateRuntime.base.sequence).toBe(2)
    expect(teammateRuntime.base.level).toBe(90)
    expect(teammateRuntime.base.skillLevels.normalAttack).toBe(10)
    expect(teammateRuntime.build.team).toEqual(activeRuntime.build.team)
    expect(teammateRuntime.state.controls['resonator:1506:confession:active']).toBe(true)
  })

  it('applies post-stats formulas from final assembled stats instead of the raw working pool', () => {
    const seed = getResonatorById('1505')
    if (!seed) {
      throw new Error('missing seed resonator 1505')
    }

    const enemy = makeDefaultEnemyProfile()
    const innerOnly = withoutWeapon(createDefaultResonatorRuntime(seed))
    innerOnly.state.controls['resonator:1505:inner_stellarealm:active'] = true

    const gravitation = withoutWeapon(createDefaultResonatorRuntime(seed))
    gravitation.base.level = 70
    gravitation.state.controls['resonator:1505:inner_stellarealm:active'] = true
    gravitation.state.controls['inherent:1505:lvl70:active'] = true

    const innerOnlyContext = buildContextFromRuntimes({
      activeRuntime: innerOnly,
      enemy,
    })
    const gravitationContext = buildContextFromRuntimes({
      activeRuntime: gravitation,
      enemy,
    })

    expect(innerOnlyContext.finalStats.energyRegen).toBe(100)
    expect(innerOnlyContext.finalStats.critRate).toBeCloseTo(10)
    expect(gravitationContext.finalStats.energyRegen).toBe(110)
    expect(gravitationContext.finalStats.critRate).toBeCloseTo(10.5)
  })

  it('uses the teammate source final stats for Shorekeeper teamwide stellarealm buffs', () => {
    const activeSeed = getResonatorById('1412')
    const shorekeeperSeed = getResonatorById('1505')

    if (!activeSeed || !shorekeeperSeed) {
      throw new Error('missing required resonator seeds')
    }

    const activeRuntime = withoutWeapon(createDefaultResonatorRuntime(activeSeed))
    activeRuntime.build.team = [activeSeed.id, shorekeeperSeed.id, null]

    const lowErTeamMember = createDefaultTeamMemberRuntimeView(shorekeeperSeed)
    lowErTeamMember.build.weapon = { id: null, rank: 1, baseAtk: 0 }
    const highErTeamMember = createDefaultTeamMemberRuntimeView(shorekeeperSeed)
    highErTeamMember.build.weapon = { id: null, rank: 1, baseAtk: 0 }
    lowErTeamMember.state.controls['resonator:1505:inner_stellarealm:active'] = true
    highErTeamMember.state.controls['resonator:1505:inner_stellarealm:active'] = true
    highErTeamMember.state.manualBuffs.quick.energyRegen = 100

    const lowParticipantRuntime = materializeTeamMemberRuntimeView(
      shorekeeperSeed,
      lowErTeamMember,
      activeRuntime.build.team,
    )
    const highParticipantRuntime = materializeTeamMemberRuntimeView(
      shorekeeperSeed,
      highErTeamMember,
      activeRuntime.build.team,
    )

    const lowContext = buildContextFromRuntimes({
      activeRuntime,
      participantRuntimes: {
        [shorekeeperSeed.id]: lowParticipantRuntime,
      },
      enemy: makeDefaultEnemyProfile(),
    })
    const highContext = buildContextFromRuntimes({
      activeRuntime,
      participantRuntimes: {
        [shorekeeperSeed.id]: highParticipantRuntime,
      },
      enemy: makeDefaultEnemyProfile(),
    })

    expect(lowContext.finalStats.critRate).toBeCloseTo(10)
    expect(highContext.finalStats.critRate).toBeCloseTo(15)
  })
})

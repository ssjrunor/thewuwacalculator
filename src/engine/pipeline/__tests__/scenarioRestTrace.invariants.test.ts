/*
  Author: Runor Ewhro
  Description: Verifies scenario rest traces preserve effect provenance,
               member routing, target beneficiaries, and environment sources.
*/

import { describe, expect, it } from 'vitest'
import {
  makeScenarioTeam,
  teamMemberId,
  type CombatScenario,
  type ScenarioTeamMember,
} from '@/domain/entities/combatScenario'
import { listResSds } from '@/data/catalog/resonatorSeedService'
import { makeAppState, makeResProfile } from '@/engine/runtime/defaults'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import {
  traceScenarioRestState,
  type ScenarioRestTargetEffect,
} from '@/engine/pipeline/scenarioRestTrace'

function makeMember(resonatorId: string): ScenarioTeamMember {
  const seed = listResSds().find((candidate) => candidate.id === resonatorId)
  if (!seed) throw new Error(`Missing test resonator ${resonatorId}`)
  const profile = makeResProfile(seed)
  return {
    id: teamMemberId(`trace-member:${resonatorId}`),
    resonatorId,
    progression: profile.runtime.progression,
    loadout: profile.runtime.build,
    local: profile.runtime.local,
  }
}

function makeTraceScenario(): CombatScenario {
  const base = selectedCombatScenario(makeAppState().combat)
  const aalto = makeMember('1403')
  const augusta = makeMember('1511')
  const routedOwner = 'team:1403:dissolving_mist'

  return {
    ...base,
    team: makeScenarioTeam([
      {
        ...aalto,
        local: {
          ...aalto.local,
          controls: {
            ...aalto.local.controls,
            'team:1403:dissolving_mist:active': true,
          },
        },
      },
      {
        ...augusta,
        local: {
          ...augusta.local,
          controls: {
            ...augusta.local.controls,
            'team:1511:breach_protocol:active': true,
          },
        },
      },
    ]),
    contextMemberId: aalto.id,
    initialOnFieldMemberId: aalto.id,
    target: {
      ...base.target,
      id: '320000490',
      status: {
        tuneStrain: 0,
        tuneBreakStacks: 2,
      },
    },
    environment: {
      ...base.environment,
      combatState: {
        ...base.environment.combatState,
        havocBane: 2,
      },
      routing: {
        bySourceMemberId: {
          [aalto.id]: { [routedOwner]: augusta.id },
        },
      },
      manualEffects: [{
        id: 'trace:manual:shared',
        label: 'Shared trace buffs',
        enabled: true,
        selector: { kind: 'all' },
        buffs: {
          quick: {
            atk: { flat: 0, percent: 12 },
            hp: { flat: 0, percent: 0 },
            def: { flat: 0, percent: 0 },
            critRate: 0,
            critDmg: 0,
            energyRegen: 0,
            healingBonus: 0,
          },
          modifiers: [{
            id: 'trace:manual:def-shred',
            enabled: true,
            scope: 'topStat',
            stat: 'defShred',
            value: 3,
          }],
        },
      }],
      targetModifiers: {
        defenseReduction: 20,
        resistanceReduction: { aero: 15 },
        damageTakenAmplification: 8,
      },
    },
  }
}

function targetEffect(
  effects: ReturnType<typeof traceScenarioRestState>['effects'],
  effectId: string,
): ScenarioRestTargetEffect | undefined {
  return effects.find((effect): effect is ScenarioRestTargetEffect => (
    effect.destination.kind === 'target' && effect.effectId === effectId
  ))
}

describe('scenario rest-state trace', () => {
  it('builds one bidirectional graph for routed, environment, and target effects', () => {
    const scenario = makeTraceScenario()
    const scenarioBeforeTrace = structuredClone(scenario)
    const aalto = scenario.team.members[0]
    const augusta = scenario.team.members[1]
    if (!augusta) throw new Error('Expected a second test member')
    const trace = traceScenarioRestState(scenario)

    const routed = trace.effects.find((effect) => (
      effect.destination.kind === 'member'
      && effect.effectId === '1403:outro:dissolving-mist'
    ))
    expect(routed).toMatchObject({
      destination: { kind: 'member', memberId: augusta.id },
      resolution: { kind: 'explicitRoute', targetMemberId: augusta.id },
      operations: [{
        path: 'member.buffs.attribute.aero.amplify',
        value: 23,
      }],
    })
    expect(trace.effects.some((effect) => (
      effect.destination.kind === 'member'
      && effect.effectId === '1403:outro:dissolving-mist'
      && effect.destination.memberId === aalto.id
    ))).toBe(false)

    const breach = targetEffect(
      trace.effects,
      '1511:spoofing-program:breach-protocol',
    )
    expect(breach?.beneficiaries.map((beneficiary) => beneficiary.memberId)).toEqual([
      aalto.id,
      augusta.id,
    ])
    expect(breach?.beneficiaries[0]?.operations).toMatchObject([{
      path: 'target.buffs.defShred',
      value: 5,
    }])

    const manualMemberEffects = trace.effects.filter((effect) => (
      effect.destination.kind === 'member'
      && effect.effectId === 'trace:manual:shared'
    ))
    expect(manualMemberEffects).toHaveLength(2)
    expect(manualMemberEffects.map((effect) => effect.destination)).toEqual([
      { kind: 'member', memberId: aalto.id },
      { kind: 'member', memberId: augusta.id },
    ])
    expect(targetEffect(trace.effects, 'trace:manual:shared')?.beneficiaries).toHaveLength(2)

    const targetModifiers = targetEffect(trace.effects, 'target-modifiers')
    expect(targetModifiers?.beneficiaries).toHaveLength(2)
    expect(targetModifiers?.beneficiaries[0]?.operations.map((operation) => [
      operation.path,
      operation.value,
    ])).toEqual([
      ['target.buffs.defShred', 20],
      ['target.buffs.attribute.aero.resShred', 15],
      ['target.buffs.dmgVuln', 8],
    ])

    const havocBane = targetEffect(trace.effects, 'combat-state:havocBane')
    expect(havocBane?.beneficiaries[0]?.operations).toMatchObject([{
      path: 'target.buffs.defShred',
      value: 4,
    }])
    expect(trace.targetStates).toContainEqual(expect.objectContaining({
      source: 'environmentCombat',
      key: 'havocBane',
      value: 2,
    }))
    expect(trace.targetStates).toContainEqual(expect.objectContaining({
      source: 'enemyStatus',
      key: 'tuneBreakStacks',
      label: 'Tune Break Vulnerability',
      value: 2,
    }))

    const enemyVulnerability = targetEffect(
      trace.effects,
      'enemy:320000490:tune-break-vuln',
    )
    expect(enemyVulnerability?.beneficiaries).toHaveLength(2)
    expect(enemyVulnerability?.beneficiaries[0]?.operations).toMatchObject([{
      path: 'target.buffs.dmgVuln',
      value: 40,
    }])

    expect(trace.indexes.members[augusta.id].receivedEffectIds).toContain(routed?.id)
    expect(trace.indexes.members[aalto.id].targetBenefitEffectIds).toContain(breach?.id)
    expect(trace.indexes.members[augusta.id].contributedEffectIds).toContain(breach?.id)
    expect(trace.indexes.target.receivedEffectIds).toContain(targetModifiers?.id)
    expect(trace.indexes.byDestinationNodeId.target).toContain(havocBane?.id)

    const dissolvingMistState = trace.sourceStates.find(
      (state) => state.ownerKey === 'team:1403:dissolving_mist',
    )
    expect(dissolvingMistState).toMatchObject({
      value: true,
      applicableToMemberIds: [aalto.id, augusta.id],
    })
    expect(routed?.stateIds).toContain(dissolvingMistState?.id)
    expect(scenario).toEqual(scenarioBeforeTrace)
  })

  it('does not let context-member selection alter the resolved rest graph', () => {
    const scenario = makeTraceScenario()
    const secondMember = scenario.team.members[1]
    if (!secondMember) throw new Error('Expected a second test member')

    const firstTrace = traceScenarioRestState(scenario)
    const secondTrace = traceScenarioRestState({
      ...scenario,
      contextMemberId: secondMember.id,
    })

    expect(secondTrace.effects).toEqual(firstTrace.effects)
    expect(secondTrace.sourceStates).toEqual(firstTrace.sourceStates)
    expect(secondTrace.targetStates).toEqual(firstTrace.targetStates)
    expect(secondTrace.indexes).toEqual(firstTrace.indexes)
  })
})

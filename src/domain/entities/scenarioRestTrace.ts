/*
  Author: Runor Ewhro
  Description: Defines the UI-independent graph contract for a scenario's
               currently applied member effects, target effects, and states.
*/

import type {
  CombatScenario,
  EnvironmentManualEffect,
  TeamMemberId,
} from './combatScenario'
import type { MnlMod } from './manualBuffs'
import type {
  DataSrcRef,
  EffectDef,
  EffectOp,
  SourceState,
  SrcOwnDef,
} from '@/domain/gameData/contracts'

export type ScenarioRestNodeId = string
export type ScenarioRestEffectId = string
export type ScenarioRestStateId = string

export type ScenarioRestTraceNode =
  | {
    id: ScenarioRestNodeId
    kind: 'member'
    memberId: TeamMemberId
    resonatorId: string
  }
  | {
    id: ScenarioRestNodeId
    kind: 'target'
    targetId: string
    profile: CombatScenario['target']
  }
  | {
    id: ScenarioRestNodeId
    kind: 'memberSource'
    memberId: TeamMemberId
    source: DataSrcRef
  }
  | {
    id: ScenarioRestNodeId
    kind: 'environmentSource'
    sourceType: 'manualEffect' | 'targetModifiers' | 'combatState'
    sourceId: string
    label?: string
    selector?: EnvironmentManualEffect['selector']
  }
  | {
    id: ScenarioRestNodeId
    kind: 'targetSource'
    targetId: string
    source: DataSrcRef
  }

export type ScenarioRestResolution =
  | { kind: 'self' }
  | { kind: 'teamWide' }
  | { kind: 'otherTeammates' }
  | { kind: 'explicitRoute'; targetMemberId: TeamMemberId }
  | { kind: 'initialOnFieldFallback'; targetMemberId: TeamMemberId }
  | { kind: 'environmentSelector'; selector: EnvironmentManualEffect['selector'] }
  | { kind: 'environmentTargetModifier' }
  | { kind: 'targetIntrinsic' }

export type ScenarioRestOperationDefinition =
  | { kind: 'gameData'; operation: EffectOp }
  | {
    kind: 'manualQuick'
    stat: 'atk' | 'hp' | 'def' | 'critRate' | 'critDmg' | 'energyRegen' | 'healingBonus'
    field?: 'flat' | 'percent'
  }
  | { kind: 'manualModifier'; modifier: MnlMod }
  | {
    kind: 'environmentTargetModifier'
    modifier: 'defenseReduction' | 'resistanceReduction' | 'damageTakenAmplification'
    attribute?: string
  }
  | {
    kind: 'combatStateDerived'
    state: 'havocBane'
  }

export interface ScenarioRestOperation {
  id: string
  operationIndex: number
  path: string
  value: number | boolean
  definition: ScenarioRestOperationDefinition
}

interface ScenarioRestEffectBase {
  id: ScenarioRestEffectId
  sourceNodeId: ScenarioRestNodeId
  effectId: string
  label: string
  ownerKey?: string
  owner: SrcOwnDef | null
  definition: EffectDef | null
  stage: 'base' | 'preStats' | 'postStats'
  resolution: ScenarioRestResolution
  stateIds: ScenarioRestStateId[]
}

export interface ScenarioRestMemberEffect extends ScenarioRestEffectBase {
  destination: { kind: 'member'; memberId: TeamMemberId }
  operations: ScenarioRestOperation[]
}

export interface ScenarioRestTargetBenefit {
  memberId: TeamMemberId
  operations: ScenarioRestOperation[]
}

export interface ScenarioRestTargetEffect extends ScenarioRestEffectBase {
  destination: { kind: 'target' }
  beneficiaries: ScenarioRestTargetBenefit[]
}

export type ScenarioRestEffect = ScenarioRestMemberEffect | ScenarioRestTargetEffect

export interface ScenarioRestSourceState {
  id: ScenarioRestStateId
  sourceNodeId: ScenarioRestNodeId
  source: DataSrcRef
  stateId: string
  ownerKey: string
  label: string
  path: string
  value: boolean | number | string
  applicableToMemberIds: TeamMemberId[]
  definition: SourceState
}

export interface ScenarioRestTargetState {
  id: ScenarioRestStateId
  source: 'environmentCombat' | 'enemyStatus'
  key: string
  label: string
  value: boolean | number | string
  definition: SourceState | null
}

export interface ScenarioRestMemberIndex {
  memberId: TeamMemberId
  sourceNodeIds: ScenarioRestNodeId[]
  sourceStateIds: ScenarioRestStateId[]
  receivedEffectIds: ScenarioRestEffectId[]
  contributedEffectIds: ScenarioRestEffectId[]
  targetBenefitEffectIds: ScenarioRestEffectId[]
}

export interface ScenarioRestTraceIndexes {
  bySourceNodeId: Record<ScenarioRestNodeId, ScenarioRestEffectId[]>
  byDestinationNodeId: Record<ScenarioRestNodeId, ScenarioRestEffectId[]>
  members: Record<TeamMemberId, ScenarioRestMemberIndex>
  target: {
    nodeId: ScenarioRestNodeId
    stateIds: ScenarioRestStateId[]
    receivedEffectIds: ScenarioRestEffectId[]
  }
}

export interface ScenarioRestStateTrace {
  scenarioId: CombatScenario['id']
  revision: number
  contextMemberId: TeamMemberId
  initialOnFieldMemberId: TeamMemberId
  nodes: ScenarioRestTraceNode[]
  sourceStates: ScenarioRestSourceState[]
  targetStates: ScenarioRestTargetState[]
  effects: ScenarioRestEffect[]
  indexes: ScenarioRestTraceIndexes
}

/*
  Author: Runor Ewhro
  Description: Defines shared game data contracts for sources, states,
               effects, features, rotations, and runtime evaluation context.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { TeamCompositionInfo } from '@/domain/gameData/teamComposition'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type {
  AttributeKey,
  FinalStats,
  ModBuff,
  NegativeEffectBuff,
  NegativeEffectKey,
  ResonatorBaseStats,
  SkillAggregationType,
  SkillArchetype,
  SkillDefinition,
  SkillSubHitResult,
  SkillTypeKey,
  UnifiedBuffPool,
} from '@/domain/entities/stats'

export type DataSourceType = 'resonator' | 'weapon' | 'echo' | 'echoSet'

export interface DataSourceRef {
  type: DataSourceType
  id: string
}

export type SourceOwnerScope = 'resonator' | 'weapon' | 'echo' | 'team' | 'sequence' | 'inherent'
export type SourceOwnerKind =
    | 'stateGroup'
    | 'inherent'
    | 'sequence'
    | 'teamBuff'
    | 'buffWindow'
    | 'weaponPassive'
    | 'echoPassive'

export interface SourceOwnerDefinition {
  id: string
  label: string
  source: DataSourceRef
  scope: SourceOwnerScope
  kind: SourceOwnerKind
  ownerKey: string
  description?: string
  unlockWhen?: ConditionExpression
  visibleWhen?: ConditionExpression
}

export interface SourceStateOption {
  id: string
  label: string
}

export interface SourceStateConditionalOptions {
  when: ConditionExpression
  options: SourceStateOption[]
}

export interface SourceStateDefinition {
  id: string
  label: string
  source: DataSourceRef
  ownerKey: string
  controlKey: string
  path: string
  resets?: string[]
  controlDependencies?: string[]
  displayScope?: 'self' | 'team' | 'both'
  kind: 'toggle' | 'stack' | 'number' | 'select'
  defaultValue?: boolean | number | string
  min?: number
  max?: number
  options?: SourceStateOption[]
  optionsWhen?: SourceStateConditionalOptions[]
  description?: string
  disabledReason?: string
  visibleWhen?: ConditionExpression
  enabledWhen?: ConditionExpression
}

export type EvalScopeRoot =
    | 'sourceRuntime'
    | 'sourceFinalStats'
    | 'targetRuntime'
    | 'activeRuntime'
    | 'pool'
    | 'baseStats'
    | 'finalStats'
    | 'context'

export type FormulaExpression =
    | {
  type: 'const'
  value: number
}
    | {
  type: 'read'
  from?: EvalScopeRoot
  path: string
  default?: number
}
    | {
  type: 'table'
  from?: EvalScopeRoot
  path: string
  values: number[]
  minIndex?: number
  maxIndex?: number
  defaultIndex?: number
}
    | {
  type: 'add'
  values: FormulaExpression[]
}
    | {
  type: 'mul'
  values: FormulaExpression[]
}
    | {
  type: 'clamp'
  value: FormulaExpression
  min?: number
  max?: number
}

export type ConditionExpression =
    | {
  type: 'always'
}
    | {
  type: 'not'
  value: ConditionExpression
}
    | {
  type: 'truthy'
  from?: EvalScopeRoot
  path: string
}
    | {
  type: 'eq'
  from?: EvalScopeRoot
  path: string
  value: string | number | boolean
}
    | {
  type: 'neq'
  from?: EvalScopeRoot
  path: string
  value: string | number | boolean
}
    | {
  type: 'gt'
  from?: EvalScopeRoot
  path: string
  value: number
}
    | {
  type: 'gte'
  from?: EvalScopeRoot
  path: string
  value: number
}
    | {
  type: 'lt'
  from?: EvalScopeRoot
  path: string
  value: number
}
    | {
  type: 'lte'
  from?: EvalScopeRoot
  path: string
  value: number
}
    | {
  type: 'includes'
  from?: EvalScopeRoot
  path: string
  value: string | number | boolean
  itemPath?: string
}
    | {
  type: 'and'
  values: ConditionExpression[]
}
    | {
  type: 'or'
  values: ConditionExpression[]
}

export interface SkillMatchRule {
  skillIds?: string[]
  tabs?: string[]
  skillTypes?: SkillTypeKey[]
}

export type BaseStatKey = 'atk' | 'hp' | 'def'
export type BaseStatField = 'percent' | 'flat'

export type TopBuffStatKey =
    | 'flatDmg'
    | 'amplify'
    | 'critRate'
    | 'critDmg'
    | 'energyRegen'
    | 'healingBonus'
    | 'defIgnore'
    | 'defShred'
    | 'dmgVuln'
    | 'shieldBonus'
    | 'dmgBonus'
    | 'tuneBreakBoost'
    | 'special'

export type EffectOperation =
    | {
  type: 'add_base_stat'
  stat: BaseStatKey
  field: BaseStatField
  value: FormulaExpression
}
    | {
  type: 'add_top_stat'
  stat: TopBuffStatKey
  value: FormulaExpression
}
    | {
  type: 'add_attribute_mod'
  attribute: (AttributeKey | 'all') | (AttributeKey | 'all')[]
  mod: keyof ModBuff
  value: FormulaExpression
}
    | {
  type: 'add_skilltype_mod'
  skillType: SkillTypeKey | SkillTypeKey[]
  mod: keyof ModBuff
  value: FormulaExpression
}
    | {
  type: 'add_negative_effect_mod'
  negativeEffect: NegativeEffectKey | NegativeEffectKey[]
  mod: keyof NegativeEffectBuff
  value: FormulaExpression
}
    | {
  type: 'add_skill_mod'
  mod: keyof ModBuff
  value: FormulaExpression
  match?: SkillMatchRule
}
    | {
  type: 'add_skill_multiplier'
  value: FormulaExpression
  match?: SkillMatchRule
}
    | {
  type: 'add_skill_scalar'
  field:
      | 'fixedDmg'
      | 'skillHealingBonus'
      | 'skillShieldBonus'
      | 'tuneRuptureCritRate'
      | 'tuneRuptureCritDmg'
      | 'negativeEffectCritRate'
      | 'negativeEffectCritDmg'
  value: FormulaExpression
  match?: SkillMatchRule
}
    | {
  type: 'scale_skill_multiplier'
  value: FormulaExpression
  match?: SkillMatchRule
}

export interface EffectDefinition {
  id: string
  label: string
  source: DataSourceRef
  ownerKey?: string
  trigger: 'runtime' | 'skill'
  stage?: 'preStats' | 'postStats'
  targetScope?: 'self' | 'active' | 'activeOther' | 'teamWide' | 'otherTeammates'
  condition?: ConditionExpression
  operations: EffectOperation[]
  tags?: string[]
}

export interface ConditionDefinition {
  id: string
  label: string
  source: DataSourceRef
  ownerKey?: string
  controlKey?: string
  path: string
  kind: 'toggle' | 'stack' | 'number' | 'select'
  description?: string
  defaultValue?: boolean | number | string
  min?: number
  max?: number
  options?: SourceStateOption[]
  visibleWhen?: ConditionExpression
}

export type RuntimeValue = string | number | boolean

export type RuntimeChange =
    | {
  type: 'set'
  path: string
  value: RuntimeValue
  resonatorId?: string
}
    | {
  type: 'add'
  path: string
  value: number
  resonatorId?: string
}
    | {
  type: 'toggle'
  path: string
  value?: boolean
  resonatorId?: string
}

// shared base for rotation nodes
interface RotationNodeBase {
  id: string
  resonatorId?: string
  enabled?: boolean
}

export interface FeatureDefinition {
  id: string
  label: string
  source: DataSourceRef
  kind: 'skill'
  skillId: string
  variant?: 'skill' | 'subHit'
  hitIndex?: number
  condition?: ConditionExpression
  tags?: string[]
  after?: RotationNode[]
}

export type RotationValue = number | FormulaExpression

export type RotationNode =
    | (RotationNodeBase & {
  type: 'feature'
  featureId: string
  multiplier?: number
  negativeEffectStacks?: number
  negativeEffectInstances?: number
  negativeEffectStableWidth?: number
  condition?: ConditionExpression
})
    | (RotationNodeBase & {
  type: 'condition'
  label?: string
  condition?: ConditionExpression
  changes: RuntimeChange[]
})
    | (RotationNodeBase & {
  type: 'repeat'
  condition?: ConditionExpression
  times: RotationValue
  items: RotationNode[]
})
    | (RotationNodeBase & {
  type: 'uptime'
  condition?: ConditionExpression
  ratio: RotationValue
  setup?: RotationNode[]
  items: RotationNode[]
})

export interface RotationDefinition {
  id: string
  label: string
  description?: string
  source: DataSourceRef
  items: RotationNode[]
}

export interface SourcePackage {
  source: DataSourceRef
  owners?: SourceOwnerDefinition[]
  states?: SourceStateDefinition[]
  conditions?: ConditionDefinition[]
  skills?: SkillDefinition[]
  effects?: EffectDefinition[]
  features?: FeatureDefinition[]
  rotations?: RotationDefinition[]
}

export interface GameDataRegistry {
  sourcesByKey: Record<string, SourcePackage>
  ownersBySourceKey: Record<string, SourceOwnerDefinition[]>
  ownersByKey: Record<string, SourceOwnerDefinition>
  effectsBySourceKey: Record<string, EffectDefinition[]>
  effectsByOwnerKey: Record<string, EffectDefinition[]>
  statesBySourceKey: Record<string, SourceStateDefinition[]>
  statesByOwnerKey: Record<string, SourceStateDefinition[]>
  statesByControlKey: Record<string, SourceStateDefinition>
  conditionsBySourceKey: Record<string, ConditionDefinition[]>
  conditionsByOwnerKey: Record<string, ConditionDefinition[]>
  featuresBySourceKey: Record<string, FeatureDefinition[]>
  rotationsBySourceKey: Record<string, RotationDefinition[]>
  skillsBySourceKey: Record<string, SkillDefinition[]>
  resonatorSkillsById: Record<string, SkillDefinition[]>
  resonatorFeaturesById: Record<string, FeatureDefinition[]>
  resonatorRotationsById: Record<string, RotationDefinition[]>
}

export interface EffectRuntimeContext {
  slotIndex?: number
  echoSetCounts: Record<string, number>
  team: TeamCompositionInfo
  source: DataSourceRef & {
    negativeEffectSources?: Array<Record<string, unknown>>
  }
  target: DataSourceRef & {
    negativeEffectSources?: Array<Record<string, unknown>>
  }
  sourceRuntime: ResonatorRuntimeState
  targetRuntime: ResonatorRuntimeState
  activeRuntime?: ResonatorRuntimeState
  targetRuntimeId: string
  activeResonatorId: string
  teamMemberIds: string[]
  pool?: UnifiedBuffPool
  baseStats?: ResonatorBaseStats
  sourceFinalStats?: FinalStats
  finalStats?: FinalStats
  selectedTargetsByOwnerKey?: Record<string, string | null>
  enemy?: EnemyProfile
}

export interface EffectEvalScope {
  sourceRuntime: ResonatorRuntimeState
  sourceFinalStats?: FinalStats
  targetRuntime: ResonatorRuntimeState
  activeRuntime?: ResonatorRuntimeState
  context: EffectRuntimeContext
  pool?: UnifiedBuffPool
  baseStats?: ResonatorBaseStats
  finalStats?: FinalStats
}

export interface FeatureResult {
  id: string
  nodeId?: string
  resonatorId: string
  resonatorName: string
  feature: FeatureDefinition
  skill: SkillDefinition
  archetype: SkillArchetype
  aggregationType: SkillAggregationType
  multiplier: number
  weight: number
  normal: number
  crit: number
  avg: number
  subHits: SkillSubHitResult[]
}

export type DamageFeatureResult = FeatureResult

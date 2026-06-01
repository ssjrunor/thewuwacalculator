/*
  Author: Runor Ewhro
  Description: Defines shared game data contracts for sources, states,
               effects, features, rotations, and runtime evaluation context.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { TeamCmpsInfo } from '@/domain/gameData/teamComposition'
import type { ResNegFfcthn } from '@/domain/entities/resonator'
import type { ResRuntime } from '@/domain/entities/runtime'
import type {
  AttributeKey,
  FinalStats,
  ModBuff,
  NegEffectBuff,
  NegEffectKey,
  ResBaseStats,
  SkillAggType,
  SkillArch,
  SkillDef,
  SkillSubHit,
  SkillTypeKey,
  UnifiedBuffPool,
} from '@/domain/entities/stats'

export type DataSrcType = 'resonator' | 'weapon' | 'echo' | 'echoSet' | 'enemy'

export interface DataSrcRef {
  type: DataSrcType
  id: string
}

export type SrcOwnScp = 'resonator' | 'weapon' | 'echo' | 'team' | 'sequence' | 'inherent'
export type SrcOwnKind =
    | 'stateGroup'
    | 'inherent'
    | 'sequence'
    | 'teamBuff'
    | 'buffWindow'
    | 'weaponPassive'
    | 'echoPassive'

export interface SrcOwnDef {
  id: string
  label: string
  source: DataSrcRef
  scope: SrcOwnScp
  kind: SrcOwnKind
  ownerKey: string
  description?: string
  unlockWhen?: CondExpr
  visibleWhen?: CondExpr
}

export interface SrcSttPtn {
  id: string
  label: string
}

export interface SrcSttCondPt {
  when: CondExpr
  options: SrcSttPtn[]
}

export interface SourceState {
  id: string
  label: string
  source: DataSrcRef
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
  options?: SrcSttPtn[]
  optionsWhen?: SrcSttCondPt[]
  description?: string
  disabledReason?: string
  visibleWhen?: CondExpr
  enabledWhen?: CondExpr
}

export type EvalScpRoot =
    | 'sourceRuntime'
    | 'sourceFinalStats'
    | 'targetRuntime'
    | 'activeRuntime'
    | 'pool'
    | 'baseStats'
    | 'finalStats'
    | 'context'

export type FormExpr =
    | {
  type: 'const'
  value: number
}
    | {
  type: 'read'
  from?: EvalScpRoot
  path: string
  default?: number
}
    | {
  type: 'table'
  from?: EvalScpRoot
  path: string
  values: number[]
  minIndex?: number
  maxIndex?: number
  defaultIndex?: number
}
    | {
  type: 'add'
  values: FormExpr[]
}
    | {
  type: 'mul'
  values: FormExpr[]
}
    | {
  type: 'clamp'
  value: FormExpr
  min?: number
  max?: number
}

export type CondExpr =
    | {
  type: 'always'
}
    | {
  type: 'not'
  value: CondExpr
}
    | {
  type: 'truthy'
  from?: EvalScpRoot
  path: string
}
    | {
  type: 'eq'
  from?: EvalScpRoot
  path: string
  value: string | number | boolean
}
    | {
  type: 'neq'
  from?: EvalScpRoot
  path: string
  value: string | number | boolean
}
    | {
  type: 'gt'
  from?: EvalScpRoot
  path: string
  value: number
}
    | {
  type: 'gte'
  from?: EvalScpRoot
  path: string
  value: number
}
    | {
  type: 'lt'
  from?: EvalScpRoot
  path: string
  value: number
}
    | {
  type: 'lte'
  from?: EvalScpRoot
  path: string
  value: number
}
    | {
  type: 'includes'
  from?: EvalScpRoot
  path: string
  value: string | number | boolean
  itemPath?: string
}
    | {
  type: 'and'
  values: CondExpr[]
}
    | {
  type: 'or'
  values: CondExpr[]
}

export interface SkllMtchRule {
  skillIds?: string[]
  tabs?: string[]
  skillTypes?: SkillTypeKey[]
}

export type BaseStatKey = 'atk' | 'hp' | 'def'
export type BaseStatFld = 'percent' | 'flat'

export type TopBuffStatK =
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

// scope for a damage immunity (see ImmunitySet). `all` zeroes every attack against the enemy;
// the others zero attacks matching the given element(s), skill type(s), or negative-effect archetype(s).
export type ImmunityScope =
    | { target: 'all' }
    | { target: 'element'; keys: AttributeKey[] }
    | { target: 'skillType'; keys: SkillTypeKey[] }
    | { target: 'negativeEffect'; keys: NegEffectKey[] }

export type EffectOp =
    | {
  type: 'add_base_stat'
  stat: BaseStatKey
  field: BaseStatFld
  value: FormExpr
}
    | {
  type: 'add_immunity'
  scope: ImmunityScope
}
    | {
  type: 'add_top_stat'
  stat: TopBuffStatK
  value: FormExpr
}
    | {
  type: 'add_attribute_mod'
  attribute: (AttributeKey | 'all') | (AttributeKey | 'all')[]
  mod: keyof ModBuff
  value: FormExpr
}
    | {
  type: 'add_skilltype_mod'
  skillType: SkillTypeKey | SkillTypeKey[]
  mod: keyof ModBuff
  value: FormExpr
}
    | {
  type: 'add_negative_effect_mod'
  negativeEffect: NegEffectKey | NegEffectKey[]
  mod: keyof NegEffectBuff
  value: FormExpr
}
    | {
  type: 'add_skill_mod'
  mod: keyof ModBuff
  value: FormExpr
  match?: SkllMtchRule
}
    | {
  type: 'add_skill_multiplier'
  value: FormExpr
  match?: SkllMtchRule
}
    | {
  type: 'add_skill_hit_multiplier'
  hitIndex: number
  value: FormExpr
  match?: SkllMtchRule
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
  value: FormExpr
  match?: SkllMtchRule
}
    | {
  type: 'scale_skill_multiplier'
  value: FormExpr
  match?: SkllMtchRule
}

export interface EffectDef {
  id: string
  label: string
  description?: string
  source: DataSrcRef
  ownerKey?: string
  trigger: 'runtime' | 'skill'
  stage?: 'preStats' | 'postStats'
  targetScope?: 'self' | 'active' | 'activeOther' | 'teamWide' | 'otherTeammates'
  condition?: CondExpr
  operations: EffectOp[]
  tags?: string[]
}

export interface CondDef {
  id: string
  label: string
  source: DataSrcRef
  ownerKey?: string
  controlKey?: string
  path: string
  kind: 'toggle' | 'stack' | 'number' | 'select'
  description?: string
  defaultValue?: boolean | number | string
  min?: number
  max?: number
  options?: SrcSttPtn[]
  visibleWhen?: CondExpr
}

export type RuntimeValue = string | number | boolean

export type RtChng =
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
interface RotNodeBase {
  id: string
  resonatorId?: string
  enabled?: boolean
  when?: RotWhenRule
}

export interface FeatDef {
  id: string
  label: string
  source: DataSrcRef
  kind: 'skill'
  skillId: string
  variant?: 'skill' | 'subHit'
  hitIndex?: number
  condition?: CondExpr
  tags?: string[]
  after?: RotationNode[]
}

export type RotVl = number | FormExpr

export interface RotWhenRule {
  condition?: CondExpr
  loops?: Array<{
    loopId: string
    runs: number[]
  }>
}

export type RotationNode =
    | (RotNodeBase & {
  type: 'feature'
  featureId: string
  multiplier?: number
  negativeEffectStacks?: number
  negativeEffectInstances?: number
  negativeEffectStableWidth?: number
  changes?: RtChng[]
  condition?: CondExpr
})
    | (RotNodeBase & {
  type: 'condition'
  label?: string
  condition?: CondExpr
  changes: RtChng[]
})
    | (RotNodeBase & {
  type: 'repeat'
  condition?: CondExpr
  times: RotVl
  items: RotationNode[]
})
    | (RotNodeBase & {
  type: 'uptime'
  condition?: CondExpr
  ratio: RotVl
  setup?: RotationNode[]
  items: RotationNode[]
})
    | (RotNodeBase & {
  type: 'loop'
  kind: 'start'
  loopId: string
  label?: string
  color?: string
  runs?: number
})
    | ({
  id: string
  type: 'loop'
  kind: 'end'
  loopId: string
  enabled?: boolean
})

export interface RotDef {
  id: string
  label: string
  description?: string
  source: DataSrcRef
  items: RotationNode[]
}

export interface SrcPkg {
  source: DataSrcRef
  owners?: SrcOwnDef[]
  states?: SourceState[]
  conditions?: CondDef[]
  skills?: SkillDef[]
  effects?: EffectDef[]
  features?: FeatDef[]
  rotations?: RotDef[]
}

export interface EffectBuckets {
  all: EffectDef[]
  runtime: EffectDef[]
  runtimePreStats: EffectDef[]
  runtimePostStats: EffectDef[]
  skill: EffectDef[]
}

export interface GameDataReg {
  sourcesByKey: Record<string, SrcPkg>
  ownersBySourceKey: Record<string, SrcOwnDef[]>
  ownersByKey: Record<string, SrcOwnDef>
  effectsBySourceKey: Record<string, EffectDef[]>
  effectBucketsBySourceKey: Record<string, EffectBuckets>
  effectsByOwnerKey: Record<string, EffectDef[]>
  statesBySourceKey: Record<string, SourceState[]>
  statesByOwnerKey: Record<string, SourceState[]>
  statesByControlKey: Record<string, SourceState>
  conditionsBySourceKey: Record<string, CondDef[]>
  conditionsByOwnerKey: Record<string, CondDef[]>
  featuresBySourceKey: Record<string, FeatDef[]>
  rotationsBySourceKey: Record<string, RotDef[]>
  skillsBySourceKey: Record<string, SkillDef[]>
  resonatorSkillsById: Record<string, SkillDef[]>
  resonatorFeaturesById: Record<string, FeatDef[]>
  resonatorRotationsById: Record<string, RotDef[]>
}

export interface EffectContext {
  slotIndex?: number
  echoSetCounts: Record<string, number>
  team: TeamCmpsInfo
  source: DataSrcRef & {
    negativeEffectSources?: ResNegFfcthn[]
  }
  target?: DataSrcRef & {
    negativeEffectSources?: ResNegFfcthn[]
  }
  sourceRuntime: ResRuntime
  targetRuntime: ResRuntime
  activeRuntime?: ResRuntime
  targetRuntimeId: string
  activeResonatorId: string
  teamMemberIds: string[]
  pool?: UnifiedBuffPool
  baseStats?: ResBaseStats
  sourceFinalStats?: FinalStats
  finalStats?: FinalStats
  selectedTargetsByOwnerKey?: Record<string, string | null>
  enemy?: EnemyProfile
}

export interface EffectScope {
  sourceRuntime: ResRuntime
  sourceFinalStats?: FinalStats
  targetRuntime: ResRuntime
  activeRuntime?: ResRuntime
  context: EffectContext
  pool?: UnifiedBuffPool
  baseStats?: ResBaseStats
  finalStats?: FinalStats
}

export interface FeatureResult {
  id: string
  nodeId?: string
  resonatorId: string
  resonatorName: string
  feature: FeatDef
  skill: SkillDef
  archetype: SkillArch
  aggregationType: SkillAggType
  multiplier: number
  weight: number
  normal: number
  crit: number
  avg: number
  subHits: SkillSubHit[]
  loopRuns?: Record<string, number>
  loopRunCounts?: Record<string, number>
}

export type DamageFeature = FeatureResult

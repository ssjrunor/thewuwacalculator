/*
  Author: Runor Ewhro
  Description: Defines shared game data contracts for sources, states,
               effects, features, rotations, and runtime evaluation context.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
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
  OffTuneTrace,
  SkillDamageEntry,
  SkillSubHit,
  SkillTypeKey,
  UnifiedBuffPool,
} from '@/domain/entities/stats'

export interface TeamCmpsMemI {
  id: string
  attribute: AttributeKey
  weaponType: number
}

export interface TeamCmpsInfo {
  ids: string[]
  size: number
  presenceById: Record<string, boolean>
  membersById: Record<string, TeamCmpsMemI>
  attributeCounts: Record<AttributeKey, number>
  weaponTypeCounts: Record<string, number>
}

export type DataSrcType = 'resonator' | 'weapon' | 'echo' | 'echoSet' | 'enemy'

export interface DataSrcRef {
  type: DataSrcType
  id: string
}

export type SrcOwnScp = 'resonator' | 'weapon' | 'echo' | 'team' | 'sequence' | 'inherent' | 'outroSkill' | 'combatState'
export type SrcOwnKind =
    | 'stateGroup'
    | 'inherent'
    | 'sequence'
    | 'outroSkill'
    | 'combatState'
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
  /** Label shown beside the state/enabler control. */
  label: string
  source: DataSrcRef
  ownerKey: string
  controlKey: string
  path: string
  resets?: string[]
  requires?: string[]
  groupId?: string
  controlDependencies?: string[]
  displayScope?: 'self' | 'team' | 'both'
  kind: 'toggle' | 'stack' | 'number' | 'select'
  defaultValue?: boolean | number | string
  maxValue?: boolean | number | string
  min?: number
  max?: number
  options?: SrcSttPtn[]
  optionsWhen?: SrcSttCondPt[]
  maxWhen?: Array<{
    when: CondExpr
    max: number
  }>
  description?: string
  disabledReason?: string
  visibleWhen?: CondExpr
  enabledWhen?: CondExpr
  surface?: 'enemy'
  combatStateType?: 'tuneStrain'
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
  elements?: AttributeKey[]
  labelIncludes?: string[]
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
    | 'offTuneBuildupRate'
    | 'tuneBreakBoost'
    | 'finalDmg'

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
  type: 'set_final_stat'
  stat: BaseStatKey
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
      | 'offTune'
      | 'directOffTune'
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
  /** Human-facing name of the effect, distinct from any state control label. */
  label: string
  description?: string
  source: DataSrcRef
  ownerKey?: string
  trigger: 'runtime' | 'skill'
  stage?: 'preStats' | 'postStats' | 'finalStats'
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
  maxValue?: boolean | number | string
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
export type RotationEditorSection = 'preamble' | 'main'

export interface RotationNoteNode {
  id: string
  type: 'note'
  label?: string
  color?: string
  text: string
  editorSection?: RotationEditorSection
}

interface RotNodeBase {
  id: string
  resonatorId?: string
  enabled?: boolean
  /** display-only section used by the rotation editor; execution stays flat */
  editorSection?: RotationEditorSection
  /** At most one display-only annotation owned by this logical node. */
  note?: RotationNoteNode
}

export interface FeatDef {
  id: string
  label: string
  source: DataSrcRef
  skillId: string
  variant?: 'subHit'
  hitIndex?: number
  /** Concrete DamageList packet selected by this sub-hit feature. */
  damageEntryId?: string
  /** Base packet ids aggregated by the parent feature. */
  damageEntryIds?: string[]
}

export type RotVl = number | FormExpr

/**
 * Nodes a feature can carry with it. Conditions run first and their writes
 * apply to the parent feature and to sibling attached features (local scope).
 * Attached features are full feature hits; parent multiplier scales them.
 * Nested attach on attached features is not allowed.
 */
export interface FeatureAttachments {
  conditions: Array<Extract<RotationNode, { type: 'condition' }>>
  features: Array<Extract<RotationNode, { type: 'feature' }>>
}

export type RotationNode =
    | RotationNoteNode
    | (RotNodeBase & {
  type: 'feature'
  featureId: string
  multiplier?: number
  /**
   * Off-Tune starts counting again on this feature.
   *
   * A Tune Break empties the gauge and the target then refuses Off-Tune for a
   * few seconds. The program has no clock, so the authored mark stands in for
   * the duration: everything between the break and the marked feature is held.
   * Unmarked breaks hold the three features after them, so the fourth counts.
   */
  offTuneResume?: boolean
  negativeEffectStacks?: number
  negativeEffectInstances?: number
  negativeEffectStableWidth?: number
  /**
   * @deprecated Prefer `attached.conditions`. Still accepted on load and
   * normalized into condition nodes before execution.
   */
  changes?: RtChng[]
  /** Child conditions and features authored against this skill hit. */
  attached?: FeatureAttachments
})
    | (RotNodeBase & {
  type: 'condition'
  label?: string
  changes: RtChng[]
})
    | (RotNodeBase & {
  type: 'repeat'
  label?: string
  color?: string
  times: RotVl
  /** Optional uptime share for the same body; omitted means fully active. */
  ratio?: RotVl
  /** Optional full-strength setup which opens the block before its scaled body. */
  setup?: RotationNode[]
  items: RotationNode[]
})
    | (RotNodeBase & {
  type: 'uptime'
  label?: string
  color?: string
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
  /**
   * Lazy divergent run bodies (1-based keys as strings). Each stored body is
   * a transition inherited by later runs until another fork replaces it; the
   * in-document template between markers is the initial body.
   */
  passForks?: Record<string, RotationNode[]>
})
    | ({
  id: string
  type: 'loop'
  kind: 'end'
  loopId: string
  enabled?: boolean
  editorSection?: RotationEditorSection
})

/** Per-run bodies on a loop start; keys are 1-based run numbers as strings. */
export type LoopPassForks = NonNullable<
  Extract<RotationNode, { type: 'loop'; kind: 'start' }>['passForks']
>

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
  damageEntries?: SkillDamageEntry[]
  effects?: EffectDef[]
  features?: FeatDef[]
  rotations?: RotDef[]
}

export interface EffectBuckets {
  all: EffectDef[]
  runtime: EffectDef[]
  runtimePreStats: EffectDef[]
  runtimePostStats: EffectDef[]
  runtimeFinalStats: EffectDef[]
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
  damageEntriesBySourceKey: Record<string, SkillDamageEntry[]>
  /** DamageList ids are only unique within a resonator. */
  damageEntriesByKey: Record<string, SkillDamageEntry>
  resonatorSkillsById: Record<string, SkillDef[]>
  resonatorDamageEntriesById: Record<string, SkillDamageEntry[]>
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
  effectScalesByRuntimePath?: Record<string, Record<string, number>>
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
  /**
   * Register values captured at the exact feature evaluation. Basic and
   * global values are the owner's resolved snapshot; skill-scoped factors are
   * already aggregated for this skill.
   */
  effectiveStats?: {
    atk: number | null
    hp: number | null
    def: number | null
    /** the resolved skill scaling after feature and formula multipliers */
    multiplier: number | null
    critRate: number | null
    critDmg: number | null
    bonus: number | null
    amplify: number | null
    /*
      the rest of what the row was worked out against. the enemy-facing four
      are layered the way crit and bonus are: the sheet's figure is only the
      first of six, with the rest arriving from the attribute, skill type and
      skill buffs in force, so they are resolved per skill rather than read off
      the final stats.
    */
    energyRegen: number | null
    defIgnore: number | null
    defShred: number | null
    dmgVuln: number | null
    /** the enemy's resistance to this element after every shred */
    resistance: number | null
    /** Accumulated enemy Off-Tune after this entry, formatted as current/max. */
    offTune: string | null
    /** The working behind that figure: every hit, every addition, and the rate. */
    offTuneTrace?: OffTuneTrace | null
    tuneBreakBoost: number | null
    finalDmg: number | null
    flatDmg: number | null
  }
  loopRuns?: Record<string, number>
  loopRunCounts?: Record<string, number>
}

export type DamageFeature = FeatureResult

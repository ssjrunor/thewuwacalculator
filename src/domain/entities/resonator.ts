/*
  Author: Runor Ewhro
  Description: Defines resonator catalog entities, including skill tabs,
               state controls, ui panels, metadata, and generated game data.
*/

import type {
  CondExpr,
  CondDef,
  EffectDef,
  FeatDef,
  RotDef,
  SrcOwnDef,
  SourceState,
} from '@/domain/gameData/contracts'
import type { CombatState } from '@/domain/entities/runtime'
import type { AttributeKey, ResBaseStats, SkillDef } from '@/domain/entities/stats'

export type SkillTabKey =
    | 'normalAttack'
    | 'resonanceSkill'
    | 'forteCircuit'
    | 'resonanceLiberation'
    | 'introSkill'
    | 'outroSkill'
    | 'tuneBreak'

export type ResControlOptionValue = string | number

export interface ResControlOption {
  id: ResControlOptionValue
  label: string
}

export interface ResStateControl {
  key: string
  label: string
  kind: 'toggle' | 'number' | 'select'
  target: 'controls'
  defaultValue?: boolean | number | string
  maxValue?: boolean | number | string
  disabledReason?: string
  visibleWhen?: CondExpr
  enabledWhen?: CondExpr
  controlDependencies?: string[]
  displayScope?: 'self' | 'team'
  resets?: string[]
  min?: number
  max?: number
  step?: number
  options?: Array<ResControlOptionValue | ResControlOption>
  optionsWhen?: Array<{
    when: CondExpr
    options: Array<ResControlOptionValue | ResControlOption>
  }>
  sequenceAwareOptions?: {
    threshold: number
    below: number[]
    atOrAbove: number[]
  }
  maxWhen?: Array<{
    when: CondExpr
    max: number
  }>
  displayMultiplier?: number
  inputMax?: number
  disabledWhen?: {
    target: 'controls'
    key: string
    equals: boolean | number | string
  }
}

export interface ResModeOption {
  id: string
  label: string
  icon?: string
  title?: string
  body?: string
  keywords?: string[]
}

export interface ResModeGroup {
  id: string
  label: string
  controlKey: string
  defaultValue: string
  allowNone?: boolean
  modes: ResModeOption[]
}

export interface ResStateNode {
  key: string
  id: string
  label: string
  kind: 'toggle' | 'number' | 'select'
  ownerKey: string
  defaultValue?: boolean | number | string
  maxValue?: boolean | number | string
  disabledReason?: string
  unlockWhen?: CondExpr
  enabledWhen?: CondExpr
  requires?: string[]
  groupId?: string
  displayScope?: 'self' | 'team' | 'both'
  min?: number
  max?: number
  step?: number
  options?: Array<ResControlOptionValue | ResControlOption>
  optionsWhen?: Array<{
    when: CondExpr
    options: Array<ResControlOptionValue | ResControlOption>
  }>
  sequenceAwareOptions?: {
    threshold: number
    below: number[]
    atOrAbove: number[]
  }
  maxWhen?: Array<{
    when: CondExpr
    max: number
  }>
  displayMultiplier?: number
  inputMax?: number
  description?: string
}

export interface ResStateGroup {
  id: string
  label?: string
  type: 'exclusive'
  controlKey?: string
  defaultValue?: string
  maxValue?: string
  maxPriority?: Array<{
    key?: string
    value?: string
    sequenceMin?: number
    sequenceMax?: number
  }>
  allowNone?: boolean
  modes?: ResModeOption[]
  members?: string[]
  defaultKey?: string
  maxKey?: string
}

export interface ResStateGraph {
  nodes: ResStateNode[]
  groups?: ResStateGroup[]
}

export interface ResSttPnl {
  id: string
  title: string
  body: string
  param?: Array<string | number>
  keywords?: string[]
  unlockWhen?: CondExpr
  stateKeys: string[]
  controls: ResStateControl[]
}

export interface ResSkllMltp {
  id: string
  label: string
  values: string[]
}

export interface ResSkllPnl {
  id: string
  type: string
  name: string
  desc: string
  param: string[]
  multipliers: ResSkllMltp[]
  keywords?: string[]
}

export interface ResNegFfctSr {
  key: keyof CombatState
  max?: number
  enabledWhen?: CondExpr
}

export interface ResNegFfctMa {
  type: 'maxAdd'
  key: keyof CombatState
  value: number
  enabledWhen?: CondExpr
}

export interface ResNegFfctGl {
  type: 'globalMaxAdd'
  value: number
  enabledWhen?: CondExpr
}

export interface ResNegFfctBh {
  type: 'behavior'
  key: keyof CombatState
  stackMode?: 'fixedMax'
  label?: string
  enabledWhen?: CondExpr
}

export type ResNegFfcthn =
  | ResNegFfctSr
  | ResNegFfctMa
  | ResNegFfctGl
  | ResNegFfctBh

export interface ResNhrnSkll {
  id: string
  ownerKey?: string
  name: string
  desc: string
  param: string[]
  unlockLevel: number
  control?: ResStateControl
  stateKeys?: string[]
  keywords?: string[]
}

export interface RsnnChn {
  index: number
  ownerKey?: string
  name: string
  desc: string
  param: string[]
  controls?: ResStateControl[]
  control?: ResStateControl
  toggleControl?: ResStateControl
  stateKeys?: string[]
  keywords?: string[]
}

export interface TraceNode {
  id: string
  name: string
  value: number
  desc: string
  param: string[]
  keywords?: string[]
}

export interface ResMenuEnt {
  id: string
  displayName: string
  profile: string
  rarity: 4 | 5
  attribute: AttributeKey
  weaponType: 1 | 2 | 3 | 4 | 5
}

export interface ResDtls {
  skillTabs: SkillTabKey[]
  skillsByTab: Partial<Record<SkillTabKey, ResSkllPnl>>
  stateGraph?: ResStateGraph
  modeGroups?: ResModeGroup[]
  statePanels: ResSttPnl[]
  inherentSkills: ResNhrnSkll[]
  resonanceChains: RsnnChn[]
  traceNodes: TraceNode[]
  descriptionKeywords?: string[]
  negativeEffectSources?: ResNegFfcthn[]
}

export interface Resonator {
  id: string
  name: string
  rarity: 4 | 5
  profile: string
  sprite: string
  spriteFaceX?: number
  spriteFaceY?: number
  spriteFaceScale?: number
  attribute: AttributeKey
  weaponType: 1 | 2 | 3 | 4 | 5
  baseStats: ResBaseStats
  baseStatsByLevel?: Partial<Record<number, { hp: number; atk: number; def: number }>>
  defaultWeaponId: string | null
  skillsByTab: Partial<Record<SkillTabKey, ResSkllPnl>>
  stateGraph?: ResStateGraph
  modeGroups?: ResModeGroup[]
  statePanels: ResSttPnl[]
  inherentSkills: ResNhrnSkll[]
  resonanceChains: RsnnChn[]
  traceNodes: TraceNode[]
  descriptionKeywords?: string[]
  negativeEffectSources?: ResNegFfcthn[]
  owners: SrcOwnDef[]
  states: SourceState[]
  conditions: CondDef[]
  effects: EffectDef[]
  features: FeatDef[]
  rotations: RotDef[]
  skills: SkillDef[]
}

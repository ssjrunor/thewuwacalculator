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

export interface ResStateControl {
  key: string
  label: string
  kind: 'toggle' | 'number' | 'select'
  target: 'controls'
  defaultValue?: boolean | number
  disabledReason?: string
  visibleWhen?: CondExpr
  enabledWhen?: CondExpr
  controlDependencies?: string[]
  displayScope?: 'self' | 'team'
  resets?: string[]
  min?: number
  max?: number
  step?: number
  options?: number[]
  optionsWhen?: Array<{
    when: CondExpr
    options: number[]
  }>
  sequenceAwareOptions?: {
    threshold: number
    below: number[]
    atOrAbove: number[]
  }
  sequenceAwareCap?: {
    threshold: number
    below: number
    atOrAbove: number
  }
  displayMultiplier?: number
  inputMax?: number
  disabledWhen?: {
    target: 'controls'
    key: string
    equals: boolean | number
  }
}

export interface ResSttPnl {
  id: string
  title: string
  body: string
  param?: Array<string | number>
  keywords?: string[]
  visibleWhen?: CondExpr
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

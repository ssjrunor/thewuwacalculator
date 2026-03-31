/*
  Author: Runor Ewhro
  Description: Defines resonator catalog entities, including skill tabs,
               state controls, ui panels, metadata, and generated game data.
*/

import type {
  ConditionExpression,
  ConditionDefinition,
  EffectDefinition,
  FeatureDefinition,
  RotationDefinition,
  SourceOwnerDefinition,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'
import type { AttributeKey, ResonatorBaseStats, SkillDefinition } from '@/domain/entities/stats'

export type ResonatorSkillTabKey =
    | 'normalAttack'
    | 'resonanceSkill'
    | 'forteCircuit'
    | 'resonanceLiberation'
    | 'introSkill'
    | 'outroSkill'
    | 'tuneBreak'

export interface ResonatorStateControl {
  key: string
  label: string
  kind: 'toggle' | 'number' | 'select'
  target: 'controls'
  disabledReason?: string
  enabledWhen?: ConditionExpression
  resets?: string[]
  min?: number
  max?: number
  step?: number
  options?: number[]
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

export interface ResonatorStatePanel {
  id: string
  title: string
  body: string
  param?: Array<string | number>
  keywords?: string[]
  controls: ResonatorStateControl[]
}

export interface ResonatorSkillMultiplier {
  id: string
  label: string
  values: string[]
}

export interface ResonatorSkillPanel {
  id: string
  type: string
  name: string
  desc: string
  param: string[]
  multipliers: ResonatorSkillMultiplier[]
  keywords?: string[]
}

export interface ResonatorInherentSkill {
  id: string
  ownerKey?: string
  name: string
  desc: string
  param: string[]
  unlockLevel: number
  control?: ResonatorStateControl
  keywords?: string[]
}

export interface ResonanceChain {
  index: number
  ownerKey?: string
  name: string
  desc: string
  param: string[]
  control?: ResonatorStateControl
  toggleControl?: ResonatorStateControl
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

export interface ResonatorMenuEntry {
  id: string
  displayName: string
  profile: string
  rarity: 4 | 5
  attribute: AttributeKey
  weaponType: 1 | 2 | 3 | 4 | 5
}

export interface ResonatorDetails {
  skillTabs: ResonatorSkillTabKey[]
  skillsByTab: Partial<Record<ResonatorSkillTabKey, ResonatorSkillPanel>>
  statePanels: ResonatorStatePanel[]
  inherentSkills: ResonatorInherentSkill[]
  resonanceChains: ResonanceChain[]
  traceNodes: TraceNode[]
  descriptionKeywords?: string[]
}

export interface Resonator {
  id: string
  name: string
  rarity: 4 | 5
  profile: string
  sprite: string
  attribute: AttributeKey
  weaponType: 1 | 2 | 3 | 4 | 5
  baseStats: ResonatorBaseStats
  baseStatsByLevel?: Partial<Record<number, { hp: number; atk: number; def: number }>>
  defaultWeaponId: string | null
  skillsByTab: Partial<Record<ResonatorSkillTabKey, ResonatorSkillPanel>>
  statePanels: ResonatorStatePanel[]
  inherentSkills: ResonatorInherentSkill[]
  resonanceChains: ResonanceChain[]
  traceNodes: TraceNode[]
  descriptionKeywords?: string[]
  owners: SourceOwnerDefinition[]
  states: SourceStateDefinition[]
  conditions: ConditionDefinition[]
  effects: EffectDefinition[]
  features: FeatureDefinition[]
  rotations: RotationDefinition[]
  skills: SkillDefinition[]
}
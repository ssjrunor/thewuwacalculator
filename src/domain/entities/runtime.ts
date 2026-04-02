/*
  Author: Runor Ewhro
  Description: Defines shared runtime entities and helper utilities for
               resonators, weapons, echoes, teams, and rotations.
*/

import type { AttributeKey, BaseStatBuff, ModBuff, SkillDefinition } from './stats'
import type { ManualBuffs } from './manualBuffs'
import type {
  FeatureDefinition,
  RotationDefinition,
  RotationNode,
  SourceStateDefinition,
} from '@/domain/gameData/contracts'

export type ResonatorId = string
export const UNSET_WEAPON_ID = '0'

// check whether a weapon id is unset
export function isUnsetWeaponId(weaponId: string | null): weaponId is null | '0' {
  return weaponId === null || weaponId === UNSET_WEAPON_ID
}

// create a unique echo uid
export function createEchoUid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export interface SkillLevels {
  normalAttack: number
  resonanceSkill: number
  forteCircuit: number
  resonanceLiberation: number
  introSkill: number
  tuneBreak: number
}

export interface TraceNodeBuffs {
  atk: BaseStatBuff
  hp: BaseStatBuff
  def: BaseStatBuff
  attribute: Record<AttributeKey, ModBuff>
  critRate: number
  critDmg: number
  healingBonus: number
  activeNodes: Record<string, boolean>
}

export interface CombatState {
  spectroFrazzle: number
  aeroErosion: number
  fusionBurst: number
  havocBane: number
  electroFlare: number
}

export interface EchoInstance {
  uid: string
  id: string
  set: number
  mainEcho: boolean
  mainStats: {
    primary: { key: string; value: number }
    secondary: { key: string; value: number }
  }
  substats: Record<string, number>
}

export type TeamSlots = [ResonatorId | null, ResonatorId | null, ResonatorId | null]

export interface WeaponBuildState {
  id: string | null
  level: number
  rank: number
  baseAtk: number
}

export interface TeamMemberWeaponViewState {
  id: string | null
  rank: number
  baseAtk: number
}

export interface ResonatorBaseState {
  level: number
  sequence: number
  skillLevels: SkillLevels
  traceNodes: TraceNodeBuffs
}

export interface TeamMemberBaseViewState {
  sequence: number
}

export interface ResonatorBuildState {
  weapon: WeaponBuildState
  echoes: Array<EchoInstance | null>
  team: TeamSlots
}

export interface TeamMemberBuildViewState {
  weapon: TeamMemberWeaponViewState
  echoes: Array<EchoInstance | null>
}

export interface ResonatorStateState {
  controls: Record<string, boolean | number | string>
  manualBuffs: ManualBuffs
  combat: CombatState
}

export type RotationView = 'personal' | 'team' | 'saved'

export interface RotationState {
  view: RotationView
  personalItems: RotationNode[]
  teamItems: RotationNode[]
}

export interface TeamMemberRuntime {
  id: ResonatorId
  base: ResonatorBaseState
  build: {
    weapon: WeaponBuildState
    echoes: Array<EchoInstance | null>
  }
  manualBuffs: ManualBuffs
}

export interface ResonatorRuntimeState {
  id: ResonatorId
  base: ResonatorBaseState
  build: ResonatorBuildState
  state: ResonatorStateState
  rotation: RotationState
  teamRuntimes: [TeamMemberRuntime | null, TeamMemberRuntime | null]
}

export interface TeamMemberRuntimeView {
  id: ResonatorId
  base: TeamMemberBaseViewState
  build: TeamMemberBuildViewState
  state: ResonatorStateState
}

export interface ResonatorSeed {
  id: ResonatorId
  name: string
  rarity?: 4 | 5
  profile?: string
  sprite?: string
  attribute: AttributeKey
  weaponType: 1 | 2 | 3 | 4 | 5
  defaultWeaponId: string | null
  baseStats: {
    hp: number
    atk: number
    def: number
    critRate: number
    critDmg: number
    energyRegen: number
    healingBonus: number
    tuneBreakBoost: number
  }
  baseStatsByLevel?: Partial<Record<number, { hp: number; atk: number; def: number }>>
  traceNodes?: Array<{
    id: string
    name: string
    value: number
    desc: string
    param: string[]
    keywords?: string[]
  }>
  skills?: SkillDefinition[]
  states?: SourceStateDefinition[]
  features?: FeatureDefinition[]
  rotations?: RotationDefinition[]
}

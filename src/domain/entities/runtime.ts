/*
  Author: Runor Ewhro
  Description: Defines shared runtime entities and helper utilities for
               resonators, weapons, echoes, teams, and rotations.
*/

import type { AttributeKey, BaseStatBuff, ModBuff, SkillDef } from './stats'
import type { ManualBuffs } from './manualBuffs'
import type {
  FeatDef,
  RotDef,
  RotationNode,
  SourceState,
} from '@/domain/gameData/contracts'

export type ResonatorId = string
export const NONE_WPN_ID = '0'

// check whether a weapon id is unset
export function isNoWeaponId(weaponId: string | null): weaponId is null | '0' {
  return weaponId === null || weaponId === NONE_WPN_ID
}

// create a unique echo uid
export function makeEchoUid(): string {
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
  glacioChafe: number
  electroFlare: number
  electroRage: number
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

export interface WeaponState {
  id: string | null
  level: number
  rank: number
  baseAtk: number
}

export interface TeamMemWpnVi {
  id: string | null
  rank: number
  baseAtk: number
}

export interface ResBaseStt {
  level: number
  sequence: number
  skillLevels: SkillLevels
  traceNodes: TraceNodeBuffs
}

export interface TeamMemBaseV {
  sequence: number
}

export interface ResMkStt {
  weapon: WeaponState
  echoes: Array<EchoInstance | null>
  team: TeamSlots
}

export interface TeamMemMkVie {
  weapon: TeamMemWpnVi
  echoes: Array<EchoInstance | null>
}

export interface ResSttStt {
  controls: Record<string, boolean | number | string>
  manualBuffs: ManualBuffs
  combat: CombatState
}

export interface RotationState {
  sequence: RotationNode[]
  program: RotationNode[]
  /** When the advanced editor last committed this program through Run. */
  lastRanAt: number | null
}

export interface TeamMemRt {
  id: ResonatorId
  base: TeamMemBaseV
  build: {
    weapon: TeamMemWpnVi
    echoes: Array<EchoInstance | null>
  }
  manualBuffs: ManualBuffs
}

export interface ResRuntime {
  /**
   * Materialized adapter for legacy engine and UI consumers. Scenario state is
   * authoritative; team, shared combat state, routing, manual buffs, and the
   * program are projected into this shape and must not become separate owners.
   */
  id: ResonatorId
  base: ResBaseStt
  build: ResMkStt
  state: ResSttStt
  rotation: RotationState
  teamRuntimes: [TeamMemRt | null, TeamMemRt | null]
}

export interface TeamMemRtVie {
  id: ResonatorId
  base: TeamMemBaseV
  build: TeamMemMkVie
  state: ResSttStt
}

export interface ResSeed {
  id: ResonatorId
  name: string
  rarity?: 4 | 5
  profile?: string
  sprite?: string
  spriteFaceX?: number
  spriteFaceY?: number
  spriteFaceScale?: number
  attribute: AttributeKey
  weaponType: 1 | 2 | 3 | 4 | 5
  defaultWeaponId: string | null
  recommendedWeaponIds?: string[]
  tags?: Array<{
    id: string
    name: string
    desc: string
    color: string
  }>
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
  skills?: SkillDef[]
  states?: SourceState[]
  features?: FeatDef[]
  rotations?: RotDef[]
}

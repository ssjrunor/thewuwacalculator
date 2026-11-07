/*
  Author: Runor Ewhro
  description: the handoff between a read card and rotation creation: one
               scenario, fully specified. the scored seat is the card's build
               with the scenario's weapon; the other seats are the fixed
               teammate builds. every member is level 90 with skills, traces
               and weapon maxed (the evaluation assumptions), so only what
               varies is carried. the generator reads nothing else.
*/

import type { EnemyProfile } from '@/domain/entities/appState'
import type { EchoInstance } from '@/domain/entities/runtime'

export interface ScenarioInputMember {
  slot: number
  resonatorId: string
  role: 'scored' | 'teammate'
  mode: string | null
  sequence: number
  /** level 90. */
  weapon: { id: string; rank: number }
  echoes: EchoInstance[]
}

export interface ScenarioInputV1 {
  v: 1
  scenarioId: string
  teamId: string
  scoredSlot: number
  /** seat order, which is the rotation's slot order. */
  members: ScenarioInputMember[]
  /** the scoring enemy: EVALUATION_ENEMY with the team's tune strain limit. */
  enemy: EnemyProfile
}

export type ScenarioInput = ScenarioInputV1

export type ScenarioInputIssue =
  | 'snapshot_version'
  | 'echo_count'
  | 'main_echo'
  | 'echo_slots'
  | 'sequence'
  | 'resonator_mismatch'
  | 'teammate_missing'
  | 'teammate_mismatch'
  | 'teammate_echo'

export type ScenarioInputResult =
  | { ok: true; input: ScenarioInput }
  | { ok: false; issues: ScenarioInputIssue[]; detail: string[] }

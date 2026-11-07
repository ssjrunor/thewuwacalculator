/*
  Author: Runor Ewhro
  description: defines prescribed team actions, authored seats, and optional reference timelines.
*/

export interface ActionTeamMember {
  resonatorId: string
}

export type PrescribedAction = { resonatorId: string; kind: 'equippedEcho' } |
  { resonatorId: string; kind: 'resonator'; sourceName: string }

export type ActionStep = { id: string; type: 'swap'; fromSlot: number; toSlot: number;
  response?: { outro: string; intro: string } } |
  { id: string; type: 'cast'; actorSlot: number; actionId: string; cancel?: string; referenceEchoAction?: string } |
  { id: string; type: 'wait'; frames: number }

/**
 * one event of the reference solve, `[frame, kind, ...]`:
 *  - `section`: index
 *  - `swap`: the seat that takes the field
 *  - `cast`: seat, action name (`#echo` the equipped Echo, `#tuneBreak` the break), hits that landed
 *    (-1: all) and, when only some did, the share of the cast's multiplier they carry
 *  - `state`: owner seat, kit effect name, stacks (0 ends it), target seat (-1 team, -2 enemy)
 *  - `status`: seat, negative status key, stacks
 *  - `tick`: seat, negative status key
 *  - `heal`/`shield`: the seat that heals or shields
 *  - `control`: calculator path, value
 *  - `hitControl`: actor seat, cast name, damage-event ordinal, control owner
 *    seat, editor control path, JSON value; scoped to that hit's features
 */
export type TimelineEvent =
  | [number, 'section', number]
  | [number, 'swap', number]
  | [number, 'cast', number, string, number]
  | [number, 'cast', number, string, number, number | null]
  | [number, 'cast', number, string, number, number | null, number[]]
  | [number, 'state', number, string, number, number]
  | [number, 'status', number, string, number]
  | [number, 'tick', number, string]
  | [number, 'heal' | 'shield', number]
  | [number, 'control', string, number]
  | [number, 'consume', number, string, number, string]
  | [number, 'hitControl', number, string, number, number, string, string]

export interface ActionTimeline {
  seconds: number
  events: TimelineEvent[]
}

/**
 * a timeline as stored: each event is a TimelineEvent whose frame counts from the event before
 * it and whose strings (its kind, names, keys and paths) are indices into `names`.
 */
export interface PackedTimeline {
  seconds: number
  events: number[][]
}

/**
 * the reference solve for each context seat and sequence (`<seat>:<sequence>`; a string
 * names another key with the same timeline). `owns` maps each resonator to effects
 * whose state comes from the timeline; kit rules evaluate other effects.
 */
export interface ActionTimelines {
  owns: Record<string, string[]>
  names: string[]
  runs: Record<string, PackedTimeline | string>
}

export interface ActionPlan {
  schemaVersion: 1
  kind: 'team-actions'
  teamId: string
  initialActiveSlot: number
  team: ActionTeamMember[]
  /** length of the reference rotation the inputs were taken from. */
  referenceTiming: { durationSeconds: number; sectionSeconds: number[] }
  actions: Record<string, PrescribedAction>
  sections: Array<{ id: string; kind: 'opener' | 'loop'; pass: number; steps: ActionStep[] }>
  /** supplied timelines determine the replayed frame order and duration. */
  timelines?: ActionTimelines
}

/*
  Author: Runor Ewhro
  description: packs and reads action timelines with shared strings and frame deltas.
*/

import type { ActionTimeline, ActionTimelines, PackedTimeline, TimelineEvent } from './types'

/** where each kind keeps its strings, after the frame and kind. */
const STRING_FIELDS: Record<string, number[]> = { cast: [3], state: [3], status: [3], tick: [3], control: [2], consume: [3, 5],
  hitControl: [3, 6, 7] }

/** a timeline in the stored form: frames as gaps, strings as indices into one shared table. */
export function packTimeline(timeline: ActionTimeline, names: string[], index: Map<string, number>): PackedTimeline {
  const id = (text: string): number => {
    if (!index.has(text)) { index.set(text, names.length); names.push(text) }
    return index.get(text)!
  }
  // the shared string table is updated in place; each stored frame is a delta from the preceding event.
  let last = 0
  return { seconds: timeline.seconds, events: timeline.events.map((event) => {
    const packed = (event as unknown[]).map((value, position) =>
      position === 0 ? (value as number) - last : position === 1 || STRING_FIELDS[event[1]]?.includes(position) ? id(value as string) : value as number)
    last = event[0]
    return packed
  }) }
}

/** the stored form read back; throws on an index or kind the table does not hold. */
export function unpackTimeline(packed: PackedTimeline, names: readonly string[]): ActionTimeline {
  const name = (index: number): string => {
    const text = names[index]
    if (typeof text !== 'string') throw new Error(`Timeline names no string ${index}`)
    return text
  }
  // restore absolute frames before resolving the event kind and its string-valued tuple fields.
  let frame = 0
  return { seconds: packed.seconds, events: packed.events.map((event) => {
    frame += event[0]
    const kind = name(event[1])
    if (!(kind in STRING_FIELDS) && !['section', 'swap', 'heal', 'shield'].includes(kind)) throw new Error(`Unknown timeline event ${kind}`)
    return event.map((value, position) => position === 0 ? frame : position === 1 ? kind :
      STRING_FIELDS[kind]?.includes(position) ? name(value) : value) as TimelineEvent
  }) }
}

/** the timeline for one context seat and sequence, following a shared key. */
export function readTimeline(timelines: ActionTimelines | undefined, seat: number, sequence: number): ActionTimeline | null {
  if (!timelines) return null
  // a shared timeline key resolves one reference level, matching the serialized action-plan format.
  let run = timelines.runs[`${seat}:${sequence}`]
  if (typeof run === 'string') run = timelines.runs[run]
  return run && typeof run === 'object' ? unpackTimeline(run, timelines.names) : null
}

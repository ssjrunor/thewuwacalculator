/*
  Author: Runor Ewhro
  description: resolves Off-Tune buildup, break actions, and buildup rate modifiers.
*/

import type { RuntimeValue } from '../types.ts'
import { stableId } from '../stableId.ts'
import { getEnemyMaxOffTune } from '../../formulas/tuneRupture.ts'

/** after a break, the target builds no Off-Tune for this long (Tune Break Cooldown). */
export const TUNE_BREAK_LOCKOUT_FRAMES = 180

/** reference animation lengths, time-stop spans, and hit frames for each weapon class's Tune Break. */
const CLASS_BREAKS: Record<number, { duration: number, timeStop: [number, number], hits: number[] }> = {
  1: { duration: 94, timeStop: [0, 94], hits: [4, 26, 66] },
  2: { duration: 90, timeStop: [0, 90], hits: [30, 36, 42, 48, 72] },
  3: { duration: 96, timeStop: [0, 96], hits: [72] },
  4: { duration: 92, timeStop: [0, 92], hits: [72] },
  5: { duration: 90, timeStop: [0, 90], hits: [56] },
}

/**
 * use an existing named Tune Break or add the weapon class's default action
 * to a ruleset copy. response actions such as Starburst and Meltdown can use
 * the same input category, so an existing break must also match the name.
 */
export function withTuneBreak(ruleset: RuntimeValue, weaponType: number): RuntimeValue {
  const own = Object.entries(ruleset.actions as Record<string, RuntimeValue>).find(([, action]) =>
    action.input === 'tuneBreak' && /^Tune Break/.test(action.name) &&
    action.events.some((event: RuntimeValue) => event.damage?.type === ruleset.codes.damage.tuneBreak))
  if (own) return { ...ruleset, tuneBreakAction: Number(own[0]) }
  const shape = CLASS_BREAKS[weaponType]
  if (!shape) throw new Error(`No Tune Break for weapon type ${weaponType}`)
  const resonatorId = String(ruleset.resonatorId)
  const id = stableId('rotation-gen-tune-break', resonatorId)
  const action = { name: 'Tune Break (Auto Generated)', cast: ruleset.codes.cast.tuneBreak, input: 'tuneBreak',
    timing: { duration: shape.duration, timeStop: shape.timeStop },
    events: [{ id: stableId('rotation-gen-tune-break-cast', resonatorId), kind: ruleset.codes.event.cast, at: 0 },
      ...shape.hits.map((at, index) => ({ id: stableId('rotation-gen-tune-break-hit', `${resonatorId}|${index}`),
        kind: ruleset.codes.event.hit, at, index, damage: { type: ruleset.codes.damage.tuneBreak } }))] }
  return { ...ruleset, tuneBreakAction: id, actions: { ...ruleset.actions, [id]: action },
    nodeFeatures: { ...ruleset.nodeFeatures, [id]: `${resonatorId}:tune-break` } }
}

/**
 * each damage hit's Off-Tune, before the buildup rate: the calculator's own
 * figures (a skill's damage entries, weakness x count, plus its flat
 * Off-Tune), so the replay's bar fills where the editor's gauge does. a
 * skill's total is shared evenly over the hits of an action bound to it.
 */
export function offTuneByAction(ruleset: RuntimeValue, source: RuntimeValue, damageEntries: RuntimeValue[]): RuntimeValue {
  const bySkill = new Map<string, number>()
  for (const entry of damageEntries) {
    if (String(entry.resonatorId) !== String(ruleset.resonatorId) || !entry.skillId) continue
    bySkill.set(entry.skillId, (bySkill.get(entry.skillId) ?? 0) + (entry.weakness ?? 0) * (entry.count ?? 1))
  }
  for (const skill of source.skills ?? []) if (skill.offTune) bySkill.set(skill.id, (bySkill.get(skill.id) ?? 0) + skill.offTune)
  const skillOfFeature = new Map<string, string>((source.features ?? []).map((feature: RuntimeValue) => [feature.id, feature.skillId]))
  const table: RuntimeValue = {}
  for (const [actionId, action] of Object.entries(ruleset.actions as Record<string, RuntimeValue>)) {
    if (action.cast === ruleset.codes.cast.tuneBreak) continue
    const binding = ruleset.nodeFeatures?.[actionId]
    if (binding == null) continue
    const hits = action.events.filter((event: RuntimeValue) => event.damage)
    const bindings = Array.isArray(binding) ? binding : [binding]
    const skillFor = (event: RuntimeValue, index: number): string | null => {
      if (typeof bindings[0] === 'object') {
        const found = bindings.find((entry: RuntimeValue) => String(entry.event) === String(event.id))
        return found ? skillOfFeature.get(found.feature) ?? null : null
      }
      return bindings.length === 1 ? bindings[0] : bindings[index] ?? null
    }
    // divide each calculator skill's total buildup over the replay hits bound to that skill.
    const groups = new Map<string, RuntimeValue[]>()
    hits.forEach((event: RuntimeValue, index: number) => {
      const skill = skillFor(event, index)
      if (skill) groups.set(skill, [...groups.get(skill) ?? [], event])
    })
    const events: RuntimeValue = {}
    for (const [skill, members] of groups) {
      const total = bySkill.get(skill) ?? 0
      if (total) for (const event of members) events[event.id] = total / members.length
    }
    if (Object.keys(events).length) table[actionId] = events
  }
  return table
}

/** a member's own effects that raise the Off-Tune Buildup Rate, with whom they reach. */
export function buildupRateEffects(source: RuntimeValue): RuntimeValue[] {
  return (source.effects ?? []).flatMap((effect: RuntimeValue) => effect.operations
    .filter((operation: RuntimeValue) => operation.type === 'add_top_stat' && operation.stat === 'offTuneBuildupRate' &&
      operation.value?.type === 'const')
    .map((operation: RuntimeValue) => ({ id: effect.id, value: operation.value.value,
      teamWide: effect.targetScope === 'teamWide', condition: effect.condition })))
}

export function maxOffTune(target: RuntimeValue): number {
  return getEnemyMaxOffTune(Number(target?.class ?? 1))
}

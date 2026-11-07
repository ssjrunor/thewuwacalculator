/*
  Author: Runor Ewhro
  description: replays reference timeline events through team kit and effect rules.
*/

import type { RuntimeValue } from '../types.ts'
import type { ActionPlan, ActionTimeline } from '../../../domain/rotationActions/types'
import { PlanTranslationError } from '../planCoverage'
import { advanceEffectState, createEffectState, findAction, holdEffect, holdStatus,
  playCast, playSupport, playSwap, playTick } from './execute.ts'
import { echoAction } from '../gear/echo.ts'
import { readTimeline } from '../../../domain/rotationActions/timelines.ts'

/** the statuses whose damage the calculator has a feature for. */
const TICKED = new Set(['spectroFrazzle', 'aeroErosion', 'fusionBurst', 'glacioChafe', 'electroFlare'])
/** negative statuses whose stacks come from the reference timeline. */
const HELD = new Set([...TICKED, 'havocBane', 'electroRage', 'heliacalEmber'])
/**
 * the reference timeline keeps Shifting active until the break. equipment
 * responds to each reapplication, including Glint of Clouds, as a separate event.
 */
const SHIFTING = new Set(['tuneStrainShifting', 'tuneRuptureShifting', 'tuneHackShifting'])
const shiftingOf = (name?: string): string | undefined => {
  const match = /^Tune (Strain|Rupture|Hack) - Shifting$/.exec(name ?? '')
  return match ? `tune${match[1]}Shifting` : undefined
}

/** kit operations the timeline already accounts for: what was cast, inflicted, healed or shared. */
const TIMELINE_OPS = new Set(['queueAction', 'cancelPendingAction', 'heal', 'shield', 'applyStatus', 'emitHit',
  'grantUnisonBoon', 'takeUnisonBoon', 'sendOthersOff', 'translationGap'])
/** kit operations on one effect: kept only for effects the timeline does not govern. */
const EFFECT_OPS = new Set(['grantEffect', 'removeEffect', 'setEffectStacks', 'decrementEffectStacks', 'consumeEffect',
  'increaseEffectCap', 'endEffectOnSwap', 'extendEffect', 'queueHandoffEffect'])

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')

/** the timeline for this scenario's scored seat and sequence, if the plan has one. */
export function timelineFor(plan: ActionPlan, seat: number, sequence: number): ActionTimeline | null {
  return readTimeline(plan.timelines, seat, sequence)
}

/**
 * each kit as the timeline replays it: effects the timeline governs (and every negative status)
 * become plain holders the timeline sets, and only rules on the rest keep running.
 */
export function timelineKits(rulesets: RuntimeValue, plan: ActionPlan): RuntimeValue {
  return Object.fromEntries(Object.entries(rulesets as Record<string, RuntimeValue>).map(([id, rules]) => {
    const owned = new Set(plan.timelines?.owns[id] ?? [])
    const governed = new Set(Object.entries(rules.effects as Record<string, RuntimeValue>)
      .filter(([, effect]) => !effect.replayLifecycle && (effect.name && owned.has(effect.name) || effect.status ||
        [...HELD].some(status => normalizeName(status) === normalizeName(effect.name ?? '')) || /^Tune (?:Strain|Rupture|Hack) - /.test(effect.name)))
      .map(([effectId]) => Number(effectId)))
    const refreshableEffect = (effectId: string): boolean => {
      const effect = rules.effects[effectId]
      return governed.has(Number(effectId)) && effect?.maxStacks === 1 && effect?.duration != null &&
        !effect?.status && !effect?.stackDurationIndividually && !effect?.responseKind
    }
    const effects = Object.fromEntries(Object.entries(rules.effects as Record<string, RuntimeValue>).map(([effectId, effect]) =>
      [effectId, governed.has(Number(effectId)) ? { name: effect.name, recipient: effect.recipient,
        // retain trigger modifiers for timeline-governed stacks; equipment
        // reads source values such as Pact of Neonlight Leap's Tune Break Boost.
        triggerModifiers: effect.triggerModifiers,
        triggerModifiersPerStack: effect.triggerModifiersPerStack,
        triggerModifiersAtMax: effect.triggerModifiersAtMax,
        maxStacks: effect.maxStacks, ...(refreshableEffect(effectId) ? { duration: effect.duration } : {}) } : effect]))
    // the timeline sets a status's stacks, but only the kit knows each time it is applied (a
    // reapplication at the cap changes no stacks): an inflicting operation stays as a signal
    const inflicts = new Set<string>()
    const statusOf = (operation: RuntimeValue): string | undefined => operation.op === 'applyStatus' ? operation.status
      : operation.op === 'grantEffect' ? rules.effects[operation.effect]?.status?.key ??
        (rules.effects[operation.effect]?.name === 'Heliacal Ember' ? 'heliacalEmber' : shiftingOf(rules.effects[operation.effect]?.name)) : undefined
    const signal = (operation: RuntimeValue): RuntimeValue => {
      const status = statusOf(operation)
      if (!status || !HELD.has(status) && !SHIFTING.has(status)) return operation
      if (HELD.has(status)) inflicts.add(status)
      return { op: 'signalStatus', status, ...SHIFTING.has(status) ? { negative: false } : {},
        ...operation.op === 'grantEffect' ? { effect: operation.effect, stacks: operation.stacks ?? 1 } : {} }
    }
    // a single-stack buff can be granted again without changing its snapshot.
    // retain the kit trigger for duration refreshes; timeline snapshots set stacks.
    const refreshable = (operation: RuntimeValue): boolean => operation.op === 'grantEffect' &&
      refreshableEffect(String(operation.effect))
    const kept = (operation: RuntimeValue) => operation.op === 'signalStatus' || operation.refreshOnly === true ||
      operation.op === 'grantEffect' && rules.effects[operation.effect]?.replayGrants === true || !TIMELINE_OPS.has(operation.op) &&
      !(EFFECT_OPS.has(operation.op) && governed.has(Number(operation.effect)))
    const ruleList = (rules.rules as RuntimeValue[]).map((rule) => ({ ...rule, operations: rule.operations
      .map((operation: RuntimeValue) => {
        const signaled = signal(operation)
        return signaled !== operation ? signaled : refreshable(operation) && !rules.effects[operation.effect]?.replayGrants
          ? { ...operation, refreshOnly: true } : operation
      }).filter(kept) }))
      .filter((rule) => rule.operations.length)
    return [id, { ...rules, effects, sourceEffects: rules.effects, rules: ruleList, clockRules: [], enemyStatuses: {}, statusConversions: {}, governed, inflicts }]
  }))
}

// resolve special Tune Break and Echo markers first; ambiguous named actions prefer a variant containing every landed hit.
function resolveActionId(member: RuntimeValue, name: string, landed: number): number {
  if (name === '#tuneBreak') return member.ruleset.tuneBreakAction
  if (name === '#echo') {
    const id = member.source.echoes.main.actionId ?? member.source.echoes.main.action?.id
    if (id == null || !echoAction(member.source.echoes.main, id)) throw new PlanTranslationError({ code: 'missing-action-binding',
      resonatorId: String(member.ruleset.resonatorId), action: 'equipped Echo', message: 'The equipped Echo has no action' })
    return id
  }
  const found = Object.entries(member.ruleset.actions as Record<string, RuntimeValue>)
    .filter(([, action]) => normalizeName(action.name) === normalizeName(name))
  // a name two forms share: the one with room for every hit that landed
  if (found.length > 1) {
    const fits = found.filter(([, action]) => action.events.filter((event: RuntimeValue) => event.damage).length >= landed)
    return Number((fits[0] ?? found[0])[0])
  }
  return findAction(member, name)[0]
}

/**
 * replays the reference's solve: its casts, landed hits, swaps, breaks and the kit states it held,
 * frame for frame. Equipment rules and the effects the timeline does not govern still run.
 * `writable` names the enemy and team paths the rotation editor can write.
 */
export function playTimeline(kits: RuntimeValue, combat: RuntimeValue, timeline: ActionTimeline, writable: Set<string>, fixedStatuses: Set<string>): RuntimeValue {
  const seat = (slot: number): number => combat.members[slot].resonatorId
  const first = (timeline.events as RuntimeValue[]).find((event) => event[1] === 'swap')
  if (first) combat.initialOnFieldResonatorId = seat(first[2])
  const tail = Math.max(0, ...(Object.values(kits) as RuntimeValue[]).flatMap((rules) =>
    (Object.values(rules.actions) as RuntimeValue[]).flatMap((action) => action.events.map((event: RuntimeValue) => event.at ?? 0))))
  combat.maxFrames = (timeline.events.at(-1)?.[0] ?? 0) + tail + 60
  for (const member of combat.members) {
    const governed = kits[member.resonatorId].governed
    member.initialEffectGrants = (member.initialEffectGrants ?? []).filter((grant: RuntimeValue) => !governed.has(Number(grant.effect)))
  }
  const fight = createEffectState(kits, combat)
  // the reference records one heal event for an ongoing field or regeneration;
  // effects granted by that event remain active through the fight.
  for (const member of combat.members) {
    const governed = kits[member.resonatorId].governed
    for (const rule of [...kits[member.resonatorId].rules, ...member.weapon.rules, ...(member.echoes.main.rules ?? []), ...member.sonata.rules]) {
      if (rule.when !== 'heal') continue
      for (const operation of rule.operations) if (operation.op === 'grantEffect' && !governed.has(Number(operation.effect))) {
        const definition = fight.effectDefinitions[operation.effect]
        if (definition && !definition.status) fight.effectDefinitions[operation.effect] = { ...definition, duration: null }
      }
    }
  }
  const effectIds = (owner: number): Map<string, number> => new Map(Object.entries(kits[owner].effects as Record<string, RuntimeValue>)
    .map(([id, effect]) => [effect.name, Number(id)]))
  const ids = Object.fromEntries(combat.members.map((member: RuntimeValue) => [member.resonatorId, effectIds(member.resonatorId)]))
  const responseKinds = (owner: number, effectId: number): string | undefined => kits[owner].sourceEffects?.[effectId]?.responseKind
  const skipped: RuntimeValue[] = []
  const events = timeline.events as RuntimeValue[]
  // index per-cast consumption and hit-control records before replay; later casts can then restore the correct local inputs.
  const consumptions = new Map<string, RuntimeValue[]>()
  const hitControls = new Map<string, RuntimeValue[]>()
  for (const event of events) if (event[1] === 'hitControl') {
    const key = `${event[0]}|${event[2]}|${event[3]}`
    const changes = hitControls.get(key) ?? []
    changes.push({ hit: event[4], owner: seat(event[5]), path: event[6], value: JSON.parse(event[7]) })
    hitControls.set(key, changes)
  }
  for (const event of events) if (event[1] === 'consume') {
    const holder = combat.members.find((member: RuntimeValue) => ids[member.resonatorId].has(event[3]))
    if (!holder) continue
    const key = `${event[0]}|${event[2]}|${event[5]}`
    const values = consumptions.get(key) ?? []
    values.push({ owner: holder.resonatorId, effectId: ids[holder.resonatorId].get(event[3]),
      consumed: event[4], stacks: event[4] })
    consumptions.set(key, values)
  }
  // the reference reads a cast's held state at its hits, so a state its own cast spends (Unison,
  // spent by the Unison Outro) comes just ahead of the cast. the condition stays there, but the
  // cast's own rules still see what it spent: `spentBy[cast index]` restores it around the cast.
  const spentBy = new Map<number, RuntimeValue[]>()
  const ownCast = (index: number): number | undefined => {
    const [frame, , slot] = events[index]
    for (let next = index + 1; next < events.length && events[next][0] === frame; next++) {
      if (events[next][1] === 'cast') return events[next][2] === slot ? next : undefined
    }
  }
  const held = (effectId: number, target: RuntimeValue): RuntimeValue => fight.effects.find((effect: RuntimeValue) =>
    effect.id === effectId && effect.target === target && effect.until > fight.frame)
  for (const [index, event] of events.entries()) {
    const [frame, kind] = event
    advanceEffectState(fight, Math.min(Math.max(frame, fight.frame), fight.frameLimit))
    switch (kind) {
      case 'section': fight.trace.push({ type: 'section', index: event[2], frame: fight.frame }); break
      case 'swap': playSwap(fight, seat(event[2])); break
      case 'cast': {
        const owner = seat(event[2]), member = fight.members[owner]
        const landed = event[4] < 0 ? Infinity : event[4]
        const spent = (spentBy.get(index) ?? []).map((prior: RuntimeValue) => {
          const now = held(prior.id, prior.target)
          const restored = now ?? { ...prior, until: Infinity }
          if (!now) fight.effects.push(restored)
          const stacks = restored.stacks
          restored.stacks = prior.stacks
          return { restored, now, stacks }
        })
        // the cast trace stores consumed inputs and sparse hit controls used when building the final editor features.
        const castTraceAt = fight.trace.length
        const castId = resolveActionId(member, event[3], landed)
        let incoming: number | undefined
        // an Outro recipient comes from the current incoming member or a later swap in this same frame.
        if (member.ruleset.actions[castId]?.cast === member.ruleset.codes.cast.outro) {
          if (fight.active !== owner) incoming = fight.active
          else for (let next = index + 1; next < events.length && events[next][0] === frame; next++) {
            if (events[next][1] === 'swap') { incoming = seat(events[next][2]); break }
          }
        }
        playCast(fight, owner, castId, landed, event[5], index, event[6], incoming)
        const changes = hitControls.get(`${event[0]}|${event[2]}|${event[3]}`)
        if (changes?.length) fight.trace[castTraceAt].hitControls = changes
        if (spent.length) fight.trace[castTraceAt].spentEffects = (spentBy.get(index) ?? []).map((prior: RuntimeValue, at: number) =>
          ({ owner: prior.owner, effectId: prior.id, stacks: prior.stacks,
            consumed: Math.max(0, prior.stacks - spent[at].stacks) }))
        const consumptionKey = `${event[0]}|${event[2]}|${event[3]}`
        for (const recorded of consumptions.get(consumptionKey) ?? []) {
          const effects = fight.trace[castTraceAt].spentEffects ??= []
          const prior = effects.find((effect: RuntimeValue) => effect.owner === recorded.owner && effect.effectId === recorded.effectId)
          if (prior) prior.consumed = recorded.consumed
          else effects.push(recorded)
        }
        consumptions.delete(consumptionKey)
        // temporary pre-consumption stacks apply only during this cast; restore the timeline snapshot immediately afterward.
        for (const { restored, now, stacks } of spent) {
          if (now) now.stacks = stacks
          else fight.effects = fight.effects.filter((effect: RuntimeValue) => effect !== restored)
        }
        break
      }
      case 'state': {
        const owner = seat(event[2]), name = event[3], target = event[5]
        // a nameless state names no kit effect (older captures matched it to an arbitrary marker)
        if (!name) { skipped.push(event); break }
        // a shared effect, such as a break debuff, resolves through the kit defining it.
        const holder = ids[owner].has(name) ? owner : combat.members.map((member: RuntimeValue) => member.resonatorId)
          .find((id: number) => ids[id].has(name))
        if (holder == null) { skipped.push(event); break }
        const effectId = ids[holder].get(name)!
        // a reviewed native lifecycle is authoritative over an intermediate
        // held snapshot. its original cast triggers and expiry remain active.
        if (kits[holder].effects[effectId]?.replayLifecycle) break
        const where = target === -1 ? 'team' : target === -2 ? 'enemy' : seat(target)
        const prior = held(effectId, where)
        const spender = prior && event[4] < prior.stacks ? ownCast(index) : undefined
        if (spender != null) spentBy.set(spender, [...(spentBy.get(spender) ?? []), { ...prior }])
        // the reference reads a state its seat's cast changed in that same frame as that cast's
        // outcome; a long cast (a field) is not held back for
        const cast = fight.members[seat(event[2])].timelineCast
        holdEffect(fight, holder, effectId, where, event[4],
          responseKinds(holder, effectId), cast?.frame === fight.frame && cast.span <= 60 ? cast : undefined)
        break
      }
      case 'status': {
        const key = event[3], path = `enemy.combat.${key}`
        // a kit that signals its own applications is their only source; a rise here would count one twice
        holdStatus(fight, seat(event[2]), key, event[4], writable.has(path) || fixedStatuses.has(key), !kits[seat(event[2])].inflicts?.has(key))
        // some status damage inputs use resonator controls, including Zani's
        // Heliacal Ember count.
        for (const member of combat.members) for (const [effectId, definition] of Object.entries(kits[member.resonatorId].effects) as [string, RuntimeValue][]) {
          if (normalizeName(definition.name ?? '') !== normalizeName(key)) continue
          if (!kits[member.resonatorId].effectControls?.[effectId]?.length) continue
          holdEffect(fight, member.resonatorId, Number(effectId), 'enemy', event[4])
        }
        break
      }
      case 'tick': if (TICKED.has(event[3])) playTick(fight, seat(event[2]), event[3]); break
      case 'heal': case 'shield': playSupport(fight, seat(event[2]), kind); break
      case 'control': {
        if (event[2] === 'teamEffects.unisonBoon') fight.unisonBoon.stacks = event[3]
        if (writable.has(event[2])) fight.trace.push({ type: 'control', frame: fight.frame, path: event[2], value: event[3] })
        else skipped.push(event)
        break
      }
    }
  }
  // every hit still owed lands (the reference credits a field's ticks past its end), but the
  // rotation lasts as long as the reference's; a long field's closing marker is not a hit
  const end = Math.max(fight.frame, Math.round(timeline.seconds * 60),
    ...fight.pending.filter((pending: RuntimeValue) => pending.event?.damage).map((pending: RuntimeValue) => pending.frame))
  advanceEffectState(fight, Math.min(end, fight.frameLimit))
  return { state: fight, skipped, seconds: timeline.seconds }
}

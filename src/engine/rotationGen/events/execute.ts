/*
  Author: Runor Ewhro
  description: applies replayed actions, effect operations, and equipment triggers
               to a team fight state.
*/

import type { RuntimeValue } from '../types.ts'
import { sourceTuneBreakBoost } from './sourceValues.ts'
import { SPECTRO_FRAZZLE } from './rules.ts'
import { emitResponse, eventCause } from './responses.ts'
import { echoAction, eventAppliesToOwner } from '../gear/echo.ts'
import { assertActionCoverage, PlanTranslationError } from '../planCoverage'
import { maxOffTune, TUNE_BREAK_LOCKOUT_FRAMES } from './offTune.ts'

const EPS = 1e-8
const readPath = (root?: RuntimeValue, path?: RuntimeValue): RuntimeValue => path == null ? undefined : path.split('.').reduce((value?: RuntimeValue, key?: RuntimeValue): RuntimeValue => value?.[key], root)
// writes require the parent path to exist; authored rule validation and member initialization establish those containers.
function writePath(root?: RuntimeValue, path?: RuntimeValue, value?: RuntimeValue): RuntimeValue {
  const keys: RuntimeValue = path.split('.')
  const last: RuntimeValue = keys.pop()
  const parent: RuntimeValue = keys.reduce((value?: RuntimeValue, key?: RuntimeValue): RuntimeValue => value[key], root)
  parent[last] = value
}
// rule comparisons read the current event and member state; EPS only adjusts inclusive numeric boundaries.
function matchesRule(condition?: RuntimeValue, context?: RuntimeValue): RuntimeValue {
  if (condition.all) return condition.all.every((part?: RuntimeValue): RuntimeValue => matchesRule(part, context))
  if (condition.any) return condition.any.some((part?: RuntimeValue): RuntimeValue => matchesRule(part, context))
  const a: RuntimeValue = Object.hasOwn(condition, 'left') ? resolveValue(condition.left, context)
    : readPath(context, condition.path) ?? (condition.path?.startsWith('effects.') ? 0 : undefined)
  const b: RuntimeValue = resolveValue(condition.value, context)
  if (condition.path === 'event.cast' && Array.isArray(context.event.casts)) {
    if (condition.operator === 'eq') return context.event.casts.includes(b)
    if (condition.operator === 'ne') return !context.event.casts.includes(b)
  }
  switch (condition.operator) {
    case 'eq': return a === b
    case 'ne': return a !== b
    case 'gt': return a > b
    case 'gte': return a + EPS >= b
    case 'lt': return a < b
    case 'lte': return a <= b + EPS
    case 'within': return Number.isFinite(a) && context.frame >= a &&
      context.frame - a <= b
    case 'includes': return Array.isArray(a) && a.includes(b)
    default: throw new Error(`Unknown condition ${condition.operator}`)
  }
}
// authored expressions combine path reads, defaults, conditional values, arithmetic, and bit-mask operations.
function resolveValue(value?: RuntimeValue, context?: RuntimeValue): RuntimeValue {
  if (value === 'targetCap') return SPECTRO_FRAZZLE.maxStacks
  if (value?.path) return readPath(context, value.path) ?? value.default ?? 0
  if (value?.condition) return matchesRule(value.condition, context)
  if (value?.min) return Math.min(...value.min.map((part: RuntimeValue) => resolveValue(part, context)))
  if (value?.max) return Math.max(...value.max.map((part: RuntimeValue) => resolveValue(part, context)))
  if (value?.subtract) return resolveValue(value.subtract[0], context) - resolveValue(value.subtract[1], context)
  if (value?.modulo) return resolveValue(value.modulo[0], context) % resolveValue(value.modulo[1], context)
  if (value?.divide) return resolveValue(value.divide[0], context) / resolveValue(value.divide[1], context)
  if (value?.floor != null) return Math.floor(resolveValue(value.floor, context))
  if (value?.bitAnd) return resolveValue(value.bitAnd[0], context) & resolveValue(value.bitAnd[1], context)
  if (value?.bitOr) return resolveValue(value.bitOr[0], context) | resolveValue(value.bitOr[1], context)
  if (value?.shiftLeft) return resolveValue(value.shiftLeft[0], context) << resolveValue(value.shiftLeft[1], context)
  if (value?.shiftRight) return resolveValue(value.shiftRight[0], context) >> resolveValue(value.shiftRight[1], context)
  if (value?.bitNot != null) return ~resolveValue(value.bitNot, context)
  if (value?.index) return resolveValue(value.index[0], context)?.[resolveValue(value.index[1], context)] ?? 0
  if (value?.if) return resolveValue(matchesRule(value.if, context) ? value.then : value.else, context)
  if (value?.add) return value.add.reduce((sum?: RuntimeValue, part?: RuntimeValue): RuntimeValue => sum +
    (part === 'frame' ? context.frame : Number(resolveValue(part, context))), 0)
  if (value?.multiply) return value.multiply.reduce((product?: RuntimeValue, part?: RuntimeValue): RuntimeValue => product *
    (typeof part === 'string' ? readPath(context, part) : resolveValue(part, context)), 1)
  return value
}
// time-stop spans consume animation frames without advancing the shared fight clock.
function worldFrame(local?: RuntimeValue, timeStop?: RuntimeValue): RuntimeValue {
  if (!timeStop) return local
  return local - Math.max(0, Math.min(local, timeStop[1]) - timeStop[0])
}
// clone declared initial values recursively; fields without an initial value are omitted.
function initialState(definition?: RuntimeValue): RuntimeValue {
  if (definition && typeof definition === 'object' && 'initial' in definition) {
    return structuredClone(definition.initial)
  }
  if (!definition || typeof definition !== 'object') return undefined
  return Object.fromEntries((Object.entries(definition) as [string, RuntimeValue][]).flatMap(([key, value]: RuntimeValue): RuntimeValue => {
    const initial: RuntimeValue = initialState(value)
    return initial === undefined ? [] : [[key, initial]]
  }))
}

// initialize independent member state and shared effects from the scenario before dispatching combat-start rules.
export function createEffectState(rulesets?: RuntimeValue, combat?: RuntimeValue): RuntimeValue {
  if (!combat.members.some((member?: RuntimeValue): RuntimeValue => member.resonatorId === combat.initialOnFieldResonatorId)) {
    throw new Error('Team fight requires a selected initial member')
  }
  const members: RuntimeValue = {}
  const effects: RuntimeValue = {}
  const enemyStatuses: RuntimeValue = Object.assign({}, ...combat.members.map((source?: RuntimeValue): RuntimeValue =>
    rulesets[source.resonatorId]?.enemyStatuses ?? {}))
  const statusState: RuntimeValue = Object.fromEntries((Object.entries(enemyStatuses) as [string, RuntimeValue][]).flatMap(([status, definition]: RuntimeValue): RuntimeValue => [
    [status, false], ...(definition.onTuneBreak ? [
      [definition.onTuneBreak.state, false], [definition.onTuneBreak.until, 0],
    ] : []),
  ]))
  for (const source of combat.members) {
    const ruleset = rulesets[source.resonatorId]
    if (!ruleset || ruleset.mode !== combat.mode) throw new Error(`Missing ruleset ${source.resonatorId}`)
    if (!Number.isFinite(source.initialHpRatio ?? 1) ||
      (source.initialHpRatio ?? 1) <= 0 || (source.initialHpRatio ?? 1) > 1) {
      throw new Error(`Invalid initial HP ratio for ${source.resonatorId}`)
    }
    for (const definitions of [ruleset.effects, source.weapon.effects,
      source.echoes.main.effects, source.sonata.effects]) {
      for (const [id, definition] of (Object.entries(definitions ?? {}) as [string, RuntimeValue][])) effects[id] = definition
    }
    members[source.resonatorId] = {
      ruleset, source: { ...source, target: combat.target },
      hasWeaponClock: source.weapon.rules.some((rule?: RuntimeValue): RuntimeValue => rule.when === 'clock'),
      hasEchoClock: (source.echoes.main.rules ?? []).some((rule?: RuntimeValue): RuntimeValue => rule.when === 'clock'),
      hasSonataClock: source.sonata.rules.some((rule?: RuntimeValue): RuntimeValue => rule.when === 'clock'),
      state: { ...Object.fromEntries((Object.entries(ruleset.state) as [string, RuntimeValue][]).map(([key, value]: RuntimeValue): RuntimeValue =>
        [key, initialState(value)])), lastLiberationAt: null },
      gearFlags: { ...source.weapon.initialGearFlags,
        ...source.echoes.main.initialGearFlags },
      hpRatio: source.initialHpRatio ?? 1,
      lastDamageTakenAt: 0,
      progression: { level: source.build.level, sequence: source.build.sequence,
        inherentPresence: true },
      clockSources: {}, lastBasicAt: null, lastHeavyAt: null,
      lastIntroAt: null, lastSkillAt: null,
      onFieldSince: source.resonatorId === combat.initialOnFieldResonatorId ? 0 : null,
    }
    for (const [path, value] of Object.entries(source.initialState ?? {})) {
      writePath(members[source.resonatorId].state, path, structuredClone(value))
    }
  }
  const fight: RuntimeValue = { frame: 0, frameLimit: combat.maxFrames,
    framesPerSecond: combat.framesPerSecond,
    readyAt: 0, active: combat.initialOnFieldResonatorId,
    members, memberOrder: combat.members.map((source: RuntimeValue) => source.resonatorId), effectDefinitions: effects, enemyStatuses, target: combat.target,
    enemy: { spectroFrazzle: 0,
      ...statusState, ...combat.initialEnemy },
    offTune: { value: 0, max: maxOffTune(combat.target), blockedUntil: 0 },
    memberEffectControls: combat.memberEffectControls ?? {},
    pending: [], nextFrazzleTickAt: null, frazzleOwner: null, frazzleCause: null,
    effects: [], trace: [], handoffActions: [], statusOwners: {},
    statusConversions: Object.assign({}, ...combat.members.map((source: RuntimeValue) => rulesets[source.resonatorId].statusConversions ?? {})),
    unisonBoon: { stacks: combat.unisonBoon?.stacks ?? 0, max: combat.unisonBoon?.max ?? 4,
      until: Infinity, granters: new Set() },
    castInstance: 0, responseInstance: 0,
    order: 0, triggerReadyAt: {}, handoffEffects: [], capGrants: {}, actionConsumptions: {},
    effectCaps: Object.fromEntries(Object.entries(effects).map(([id, definition]: RuntimeValue) => [id, definition.maxStacks ?? 1])),
    castListeners: (Object.values(members) as RuntimeValue[]).filter((member?: RuntimeValue): RuntimeValue =>
      [...member.ruleset.rules, ...member.source.weapon.rules,
        ...(member.source.echoes.main.rules ?? []), ...member.source.sonata.rules]
        .some((rule?: RuntimeValue): RuntimeValue => rule.when === member.ruleset.codes.event.cast && rule.listenTeam))
      .map((member?: RuntimeValue): RuntimeValue => member.ruleset.resonatorId),
    hitListeners: (Object.values(members) as RuntimeValue[]).filter((member?: RuntimeValue): RuntimeValue =>
      [...member.ruleset.rules, ...member.source.weapon.rules,
        ...(member.source.echoes.main.rules ?? []), ...member.source.sonata.rules]
        .some((rule?: RuntimeValue): RuntimeValue => rule.when === member.ruleset.codes.event.hit && rule.listenTeam))
      .map((member?: RuntimeValue): RuntimeValue => member.ruleset.resonatorId),
  }
  const allRules = (Object.values(members) as RuntimeValue[]).flatMap((member?: RuntimeValue): RuntimeValue[] => [...member.ruleset.rules,
    ...member.source.weapon.rules, ...(member.source.echoes.main.rules ?? []), ...member.source.sonata.rules])
  fight.hasLateRules = allRules.some((rule?: RuntimeValue): RuntimeValue => rule.late)
  // a team that lays a Shifting only breaks a shifted target (the reference's Tune Shiftable)
  const shiftings = new Set(Object.entries(effects).filter(([, definition]: RuntimeValue) => /^Tune (?:Strain|Rupture|Hack) - Shifting$/.test(definition.name)).map(([id]) => Number(id)))
  fight.shiftingEffects = shiftings
  fight.shiftable = allRules.some((rule?: RuntimeValue): RuntimeValue => rule.operations.some((operation?: RuntimeValue): RuntimeValue =>
    operation.op === 'grantEffect' && shiftings.has(Number(operation.effect))))
  fight.memberViews = combat.members.map((source: RuntimeValue, index: number) => {
    const member = members[source.resonatorId]
    return Object.defineProperty({ index, resonator: { id: source.resonatorId, name: member.ruleset.name, element: source.element },
      progression: member.progression }, 'effects', { enumerable: true, get: () => projectedEffects(fight, member) })
  })
  const initial = members[combat.initialOnFieldResonatorId]
  if (initial.source.weapon.onFieldEntryEffect) grant(fight, initial,
    { effect: initial.source.weapon.onFieldEntryEffect,
      stacks: initial.source.weapon.onFieldEntryStacks })
  for (const effect of initial.source.sonata.onFieldEntryEffects ?? []) grant(fight, initial, { effect })
  for (const member of Object.values(members) as RuntimeValue[]) {
    for (const operation of member.source.initialEffectGrants ?? []) {
      const definition = effects[operation.effect]
      if (definition?.recipient === 'incomingMember' && member.ruleset.resonatorId === fight.active) {
        throw new Error('An initial incoming-member effect needs a different active recipient')
      }
      grant(fight, member, operation, fight.active)
    }
  }
  for (const [status, definition] of Object.entries(enemyStatuses) as [string, RuntimeValue][]) {
    if (!combat.initialEnemy?.[status]) continue
    const owner = (Object.values(members) as RuntimeValue[]).find(member => member.ruleset.effects[definition.effect])
    if (owner) grant(fight, owner, { effect: definition.effect }, fight.active)
  }
  for (const member of Object.values(members) as RuntimeValue[]) dispatch(fight, member, 'combatStart')
  return fight
}

function enterField(fight?: RuntimeValue, member?: RuntimeValue): RuntimeValue {
  member.onFieldSince = fight.frame
  if (member.source.weapon.onFieldEntryEffect) grant(fight, member,
    { effect: member.source.weapon.onFieldEntryEffect,
      stacks: member.source.weapon.onFieldEntryStacks })
  for (const effect of member.source.sonata.onFieldEntryEffects ?? []) grant(fight, member, { effect })
}

// build a read context for one source member while exposing the actual active member, event actor, and shared enemy state.
function ruleContext(fight?: RuntimeValue, member?: RuntimeValue, event: RuntimeValue = {}): RuntimeValue {
  const teamMembers = fight.memberViews
  const actorIndex = teamMembers.findIndex((source: RuntimeValue) => source.resonator.id === event.actor)
  const negativeStatus = ['spectroFrazzle', 'aeroErosion', 'fusionBurst', 'havocBane', 'glacioChafe', 'electroFlare']
    .some(status => fight.enemy[status] > 0) ||
    Object.keys(fight.enemyStatuses).some((status?: RuntimeValue): RuntimeValue => Boolean(fight.enemy[status])) ||
    (Object.values(fight.enemyStatuses) as RuntimeValue[]).some((status?: RuntimeValue): RuntimeValue =>
      Boolean(status.onTuneBreak && fight.enemy[status.onTuneBreak.state]))
  return { frame: fight.frame, ownerId: member.ruleset.resonatorId,
    state: member.state,
    controls: member.source.initialControls,
    effectCaps: fight.effectCaps, statusOwners: fight.statusOwners,
    gearFlags: member.gearFlags, hpRatio: member.hpRatio,
    lastDamageTakenAt: member.lastDamageTakenAt,
    lastBasicAt: member.lastBasicAt, lastIntroAt: member.lastIntroAt,
    lastSkillAt: member.lastSkillAt, onFieldSince: member.onFieldSince,
    progression: member.progression,
    enemy: { ...fight.enemy, negativeStatus }, target: fight.target,
    team: { handoff: member.handoff, activeResonatorId: fight.active, members: teamMembers, actorIndex,
      queuedEffectIds: fight.handoffEffects.filter((pending: RuntimeValue) => pending.until >= fight.frame).map((pending: RuntimeValue) => pending.effect) },
    incomingMember: teamMembers.find((source: RuntimeValue) => source.resonator.id === event.nextOwner),
    activeMember: teamMembers.find((source: RuntimeValue) => source.resonator.id === fight.active),
    actorMember: teamMembers[actorIndex], ownerMember: teamMembers.find((source: RuntimeValue) => source.resonator.id === member.ruleset.resonatorId),
    effects: projectedEffects(fight, member),
    actorEffects: fight.members[event.actor] ? projectedEffects(fight, fight.members[event.actor]) : {}, event }
}
// only unexpired effects applicable to this member are visible to its rule expressions.
function projectedEffects(fight?: RuntimeValue, member?: RuntimeValue): RuntimeValue {
  const result: RuntimeValue = {}
  for (const effect of fight.effects) {
    if (effect.until <= fight.frame) continue
    if (effect.recipient === 'team' || effect.recipient === 'enemy' ||
      effect.recipient === 'target' || effect.recipient === 'hitTarget' ||
      effect.recipient === 'nearbyEnemies' || effect.target === member.ruleset.resonatorId) {
      result[effect.id] = effect
    }
  }
  return result
}
// resolve the activation recipient and lifetime once, then update stacks and record the exact affected target.
function grant(fight?: RuntimeValue, member?: RuntimeValue, operation?: RuntimeValue, next?: RuntimeValue, sourceEvent: RuntimeValue = {}): RuntimeValue {
  const definition = fight.effectDefinitions[operation.effect]
  if (!definition) throw new Error(`Missing effect ${operation.effect}`)
  if (definition.exclusiveWith != null) removeEffect(fight, member, definition.exclusiveWith)
  const recipient = operation.recipient ?? definition.recipient
  const context: RuntimeValue = ruleContext(fight, member, sourceEvent)
  const target = definition.status ? 'enemy' : operation.targetOwner != null ? resolveValue(operation.targetOwner, context) :
    recipient === 'actorMember' ? sourceEvent.actor : recipient === 'incomingMember' ? next : member.ruleset.resonatorId
  const maxStacks = context.effectCaps[operation.effect]
  const grantedStacks = resolveValue(operation.stacks ?? 1, context)
  context.effects[operation.effect] = { ...context.effects[operation.effect],
    stacks: Math.min(maxStacks, (context.effects[operation.effect]?.stacks ?? 0) + grantedStacks) }
  const duration = operation.durationFrames ?? resolveValue(definition.duration, context)
  const parent = definition.expiresWith == null ? null : fight.effects.find((effect?: RuntimeValue): RuntimeValue =>
    effect.id === definition.expiresWith && effect.owner === member.ruleset.resonatorId &&
    effect.until > fight.frame)
  // a child cannot outlive a parent that was already removed by this action's earlier phase.
  if (definition.expiresWith != null && !parent) return
  const until = parent ? parent.until : duration == null ? Infinity : fight.frame + duration
  let active: RuntimeValue = fight.effects.find((effect?: RuntimeValue): RuntimeValue => effect.id === operation.effect && effect.target === target && effect.until > fight.frame)
  if (!active && operation.refreshOnly) active = fight.effects.find((effect?: RuntimeValue): RuntimeValue =>
    effect.id === operation.effect && effect.owner === member.ruleset.resonatorId && effect.until > fight.frame)
  // governed effects are activated by the saved timeline. a retained grant rule
  // may refresh a live effect, but must not invent an earlier activation.
  if (operation.refreshOnly && !active) return
  const wasActive = Boolean(active)
  if (active && definition.status) active.stacks = fight.enemy[definition.status.key] ?? 0
  const beforeStacks = active?.stacks ?? (definition.status ? fight.enemy[definition.status.key] ?? 0 : 0)
  sourceEvent.applied ??= {}
  sourceEvent.applied[operation.effect] = (sourceEvent.applied[operation.effect] ?? 0) + grantedStacks
  sourceEvent.appliedByOwner ??= {}
  const appliedOwners = sourceEvent.appliedByOwner[definition.status?.key ?? operation.effect] ??= {}
  appliedOwners[member.ruleset.resonatorId] = (appliedOwners[member.ruleset.resonatorId] ?? 0) + grantedStacks
  if (!active) {
    active = { id: operation.effect, recipient, target, owner: member.ruleset.resonatorId,
      stacks: definition.status ? fight.enemy[definition.status.key] ?? 0 : 0, until, grantedAt: fight.frame, sourceInstance: sourceEvent.instance ?? null,
      extendedCount: 0 }
    fight.effects.push(active)
    if (definition.tick) { active.lastTickFrame = fight.frame; active.tickElapsed = 0 }
    if (definition.status?.intervalFrames) { active.lastStatusTickFrame = fight.frame; active.statusElapsed = 0 }
  }
  if (operation.distinctByAction) {
    if (sourceEvent.actionId == null) throw new Error(`Effect ${operation.effect} needs an action source`)
    if (active.sources?.includes(sourceEvent.actionId)) return
    active.sources = [...active.sources ?? [], sourceEvent.actionId]
  }
  // refreshing a capped stack list replaces the earliest expiry; shared-duration effects follow their own refresh rule.
  if (definition.stackDurationIndividually) {
    active.stackExpires = (active.stackExpires ?? []).filter((expiry?: RuntimeValue): RuntimeValue => expiry > fight.frame)
    const cap = maxStacks
    for (let index = 0; index < grantedStacks; index++) {
      if (active.stackExpires.length >= cap) active.stackExpires.shift()
      active.stackExpires.push(until)
    }
    active.stackExpires.sort((a?: RuntimeValue, b?: RuntimeValue): RuntimeValue => a - b)
    active.stacks = active.stackExpires.length
    active.until = active.stackExpires.at(-1) ?? fight.frame
  } else {
    active.stacks = operation.refreshOnly && wasActive ? active.stacks : Math.min(maxStacks,
      active.stacks + grantedStacks)
    if (definition.refreshOnGrant !== false || beforeStacks < definition.maxStacks) {
      active.until = until
    }
    active.grantedAt = fight.frame
    active.sourceInstance = sourceEvent.instance ?? null
    active.extendedCount = 0
  }
  if (definition.maxStackLifetimeFrames != null) {
    if (beforeStacks < definition.maxStacks && active.stacks >= definition.maxStacks) {
      active.maxedAt = fight.frame
    }
    active.until = active.maxedAt == null ? Infinity :
      active.maxedAt + definition.maxStackLifetimeFrames
  }
  for (const dependent of fight.effects) if (fight.effectDefinitions[dependent.id]?.expiresWith ===
    operation.effect && dependent.owner === member.ruleset.resonatorId && dependent.until !== active.until) {
    dependent.until = active.until
    traceEffect(fight, dependent)
  }
  if (definition.sourceValue?.stat === 'tuneBreakBoost') {
    active.conditionalSourceValue = sourceTuneBreakBoost(fight, member)
  }
  fight.trace.push({ frame: fight.frame, type: 'effect', owner: member.ruleset.resonatorId,
    // a refresh-only grant may find a timeline-held team/enemy/other-member
    // effect through the owner fallback. Refresh that same holder in the
    // trace too; a new target would survive when the real holder is cleared.
    target: active.target, effectId: operation.effect, recipient: active.recipient, effect: definition.name,
    stacks: active.stacks, until: active.until,
    ...(sourceEvent.actionId == null ? {} : { sourceActionId: sourceEvent.actionId }),
    ...(sourceEvent.instance == null ? {} : { sourceInstance: sourceEvent.instance }),
    ...(sourceEvent.eventId == null ? {} : { sourceEventId: sourceEvent.eventId }),
    ...(sourceEvent.responseId == null ? {} : { responseId: sourceEvent.responseId }),
    ...(active.conditionalSourceValue == null ? {} : {
      conditionalSourceValue: active.conditionalSourceValue }) })
  if (definition.responseKind && active.stacks > beforeStacks) {
    const detail = { ...sourceEvent, responseKind: definition.responseKind, actor: target, sourceOwner: member.ruleset.resonatorId }
    for (const other of Object.values(fight.members) as RuntimeValue[]) {
      dispatch(fight, other, 'responseEvent', sourceEvent.actionId, null, 'cast', detail)
      dispatch(fight, other, 'unison', sourceEvent.actionId, null, 'cast', detail)
    }
  }
  if (definition.status) {
    const status = definition.status
    fight.statusOwners[status.key] = member.ruleset.resonatorId
    active.owner = member.ruleset.resonatorId
    if (status.key === 'spectroFrazzle') {
      runOperation(fight, member, { op: 'applyStatus', status: status.key, stacks: grantedStacks }, { event: sourceEvent }, next)
      active.stacks = fight.enemy.spectroFrazzle
    } else {
      sourceEvent.applied ??= {}; sourceEvent.applied[status.key] = (sourceEvent.applied[status.key] ?? 0) + grantedStacks
      sourceEvent.negativeInflicted = true
      sourceEvent.negativeInflictedByOwner ??= {}
      sourceEvent.negativeInflictedByOwner[member.ruleset.resonatorId] = true
      if (status.hitOnGain && !fight.statusConversions[status.key]) for (let stacks = beforeStacks + 1; stacks <= active.stacks; stacks++) {
        recordStatus(fight, member.ruleset.resonatorId, status.key, stacks)
        statusHit(fight, member, status.key)
      }
      recordStatus(fight, member.ruleset.resonatorId, status.key, active.stacks)
      for (const other of Object.values(fight.members) as RuntimeValue[]) dispatch(fight, other, 'statusApplied', sourceEvent.actionId, null, 'cast',
        { ...sourceEvent, status: status.key, sourceOwner: member.ruleset.resonatorId, actor: member.ruleset.resonatorId })
      if (status.burstAtCap && active.stacks >= maxStacks) {
        statusHit(fight, member, status.key)
        active.stacks = 0; active.until = fight.frame
        recordStatus(fight, member.ruleset.resonatorId, status.key, 0)
      }
    }
  }
}
function recordStatus(fight: RuntimeValue, owner: number, status: string, stacks: number): void {
  fight.enemy[status] = stacks
  fight.trace.push({ type: 'status', frame: fight.frame, owner, status, stacks })
}
function statusHit(fight: RuntimeValue, member: RuntimeValue, status: string, responseId?: number): void {
  const response = responseId ?? emitResponse(fight, { kind: 'tick', owner: member.ruleset.resonatorId,
    cause: { type: 'status', owner: member.ruleset.resonatorId, status }, status }).id
  const element = ({ spectroFrazzle: 320, aeroErosion: 64, fusionBurst: 192, glacioChafe: 256, electroFlare: 128 } as Record<string, number>)[status]
  const event = { kind: member.ruleset.codes.event.hit, index: 0, damage: { type: member.ruleset.codes.damage.status }, element, status }
  const before = dispatch(fight, member, event.kind, null, event, 'beforeHit', { responseId: response })
  dispatch(fight, member, event.kind, null, event, 'afterDebuffs', { ...before.event, sharedDetail: before.event })
  dispatch(fight, member, event.kind, null, event, 'beforeDamage', { ...before.event, sharedDetail: before.event })
  fight.trace.push({ type: 'hit', frame: fight.frame, owner: member.ruleset.resonatorId, hitKind: status,
    negativeEffectStacks: fight.enemy[status] ?? 0, responseId: response })
  dispatch(fight, member, event.kind, null, event, 'afterHit', { ...before.event, responseId: response })
  dispatch(fight, member, 'afterAction', null, null, 'cast', { ...before.event, responseId: response })
}
function traceEffect(fight: RuntimeValue, effect: RuntimeValue): void {
  fight.trace.push({ type: 'effect', frame: fight.frame, owner: effect.owner, effectId: effect.id,
    target: effect.target, recipient: effect.recipient, stacks: effect.stacks, until: effect.until,
    ...(effect.endsOnSwap ? { endsOnSwap: true } : {}) })
}
// remove dependent effects transitively for the same source and synchronize any associated enemy counters.
function removeEffect(fight: RuntimeValue, member: RuntimeValue, id: number, target?: number): void {
  const removed = new Set([id])
  let previous
  do {
    previous = removed.size
    for (const effect of fight.effects) if (effect.owner === member.ruleset.resonatorId &&
      removed.has(fight.effectDefinitions[effect.id]?.expiresWith)) removed.add(effect.id)
  } while (previous !== removed.size)
  for (const effect of fight.effects) if ((target == null || effect.target === target) &&
    (effect.owner === member.ruleset.resonatorId || fight.effectDefinitions[effect.id]?.status) && removed.has(effect.id)) {
    effect.stacks = 0; effect.until = fight.frame; traceEffect(fight, effect)
    const status = fight.effectDefinitions[effect.id]?.status
    if (status) {
      recordStatus(fight, member.ruleset.resonatorId, status.key, 0)
      if (status.key === 'spectroFrazzle') fight.nextFrazzleTickAt = null
    }
  }
  fight.effects = fight.effects.filter((effect: RuntimeValue) => effect.until > fight.frame)
}
// convert event offsets to fight frames and preserve insertion order when multiple events share a frame.
function schedule(fight?: RuntimeValue, member?: RuntimeValue, actionId?: RuntimeValue, at?: RuntimeValue, instance: RuntimeValue = fight.castInstance, responseId: RuntimeValue = null, keep?: (event: RuntimeValue) => boolean): RuntimeValue {
  const action = member.ruleset.actions[actionId] ??
    echoAction(member.source.echoes.main, actionId)
  if (!action) throw new Error(`Unknown action ${actionId}`)
  for (const event of action.events) {
    if (event.kind === member.ruleset.codes.event.cast) continue
    if (!eventAppliesToOwner(event, member.ruleset.resonatorId)) continue
    if (keep && !keep(event)) continue
    fight.pending.push({ frame: at + worldFrame(event.at, action.timing.timeStop),
      order: fight.order++, owner: member.ruleset.resonatorId, actionId,
      instance, event, stepId: fight.currentStepId, ...(responseId == null ? {} : { responseId }) })
  }
  fight.pending.push({ frame: at + worldFrame(action.timing.duration ?? 0, action.timing.timeStop),
    order: fight.order++, owner: member.ruleset.resonatorId, actionId, instance,
    event: { kind: 'afterAction' }, stepId: fight.currentStepId, ...(responseId == null ? {} : { responseId }) })
  fight.pending.sort((a?: RuntimeValue, b?: RuntimeValue): RuntimeValue => a.frame - b.frame || a.order - b.order)
}
// triggered actions receive a new cast instance and retain the response id that caused them.
function triggerAction(fight?: RuntimeValue, member?: RuntimeValue, actionId?: RuntimeValue, response?: RuntimeValue): RuntimeValue {
  const action = member.ruleset.actions[actionId] ??
    echoAction(member.source.echoes.main, actionId)
  if (!action) throw new Error(`Unknown triggered action ${actionId}`)
  assertActionCoverage(member, actionId, fight.currentStepId)
  const instance = ++fight.castInstance
  fight.trace.push({ frame: fight.frame, type: 'cast', owner: member.ruleset.resonatorId,
    action: action.name, actionId, instance, cut: 'triggered',
    responseId: response.id, stepId: fight.currentStepId })
  const cast: RuntimeValue = action.events.find((event?: RuntimeValue): RuntimeValue => event.kind === member.ruleset.codes.event.cast)
  if (cast) {
    dispatch(fight, member, cast.kind, actionId, cast, 'cast',
      { instance, responseId: response.id })
    dispatch(fight, member, 'afterCast', actionId, cast, 'cast', { instance, responseId: response.id })
  }
  schedule(fight, member, actionId, fight.frame, instance, response.id)
}
// apply one authored state transition using a shared event record and operation-local snapshots.
function runOperation(fight?: RuntimeValue, member?: RuntimeValue, operation?: RuntimeValue, local?: RuntimeValue, next?: RuntimeValue): RuntimeValue {
  const context: RuntimeValue = { ...ruleContext(fight, member, local.event), locals: local.locals ??= {} }
  if (operation.repeat != null) {
    const count = resolveValue(operation.repeat, context)
    if (!Number.isSafeInteger(count) || count < 0) throw new Error(`Invalid repeated action count ${count}`)
    for (let index = 0; index < count; index++) runOperation(fight, member, { ...operation, repeat: undefined }, local, next)
    return
  }
  switch (operation.op) {
    case 'sendOthersOff': {
      const others = (Object.values(fight.members) as RuntimeValue[]).filter(other => other !== member)
      for (const other of others) dispatch(fight, other, 'sentOff', null, null, 'cast', { responseId: local.event.responseId })
      fight.pending = fight.pending.filter((pending: RuntimeValue) => pending.owner === member.ruleset.resonatorId || pending.responseId == null)
      break
    }
    case 'setIndexedState': member.state[operation.key][resolveValue(operation.index, context)] = resolveValue(operation.value, context); break
    // record consumption by cast instance and source member so later hits and after-action rules read the same consumed amount.
    case 'consumeEffect': {
      const definition = fight.effectDefinitions[operation.effect]
      const status = definition?.status?.key
      const active = fight.effects.find((effect: RuntimeValue) => effect.id === operation.effect && effect.until > fight.frame)
      const before = active?.stacks ?? (status ? fight.enemy[status] ?? 0 : 0)
      const stacks = Math.min(before, resolveValue(operation.stacks, context))
      if (active) {
        active.stacks -= stacks; traceEffect(fight, active)
        if (!active.stacks) active.until = fight.frame
      }
      if (status) recordStatus(fight, member.ruleset.resonatorId, status, before - stacks)
      {
        const key = status ?? operation.effect
        local.event.consumed ??= {}; local.event.consumed[key] = (local.event.consumed[key] ?? 0) + stacks
        local.event.consumedByOwner ??= {}
        const owners = local.event.consumedByOwner[key] ??= {}
        owners[member.ruleset.resonatorId] = (owners[member.ruleset.resonatorId] ?? 0) + stacks
        local.event.statusConsumedTotal = (local.event.statusConsumedTotal ?? 0) + stacks
        if (local.event.instance != null) {
          const record = fight.actionConsumptions[local.event.instance] ??= { consumed: {}, statusConsumedTotal: 0 }
          record.consumed[key] = (record.consumed[key] ?? 0) + stacks
          record.statusConsumedTotal += stacks
        }
      }
      break
    }
    case 'snapshot': local.locals[operation.key] = resolveValue(operation.value, context); break
    case 'overrideDamageType': local.event.damageType = operation.type; break
    case 'dropCast': {
      local.event.casts = (local.event.casts ?? []).filter((cast: number) => cast !== operation.cast)
      break
    }
    // each source marker contributes once to the cap; repeated updates replace that source's previous contribution.
    case 'increaseEffectCap': {
      const grants = fight.capGrants[operation.effect] ??= {}
      grants[`${member.ruleset.resonatorId}:${operation.source}`] = resolveValue(operation.amount, context)
      fight.effectCaps[operation.effect] = (fight.effectDefinitions[operation.effect].maxStacks ?? 1) +
        Object.values(grants).reduce((sum: number, value: RuntimeValue) => sum + value, 0)
      break
    }
    case 'endEffectOnSwap': {
      for (const active of fight.effects.filter((effect: RuntimeValue) => effect.owner === member.ruleset.resonatorId && effect.id === operation.effect)) {
        active.endsOnSwap = true
        if (local.event.nextOwner != null && active.target === local.event.actor) removeEffect(fight, member, operation.effect, active.target)
        else traceEffect(fight, active)
      }
      break
    }
    case 'translationGap': throw new PlanTranslationError({ code: 'missing-action-transition',
      resonatorId: String(member.ruleset.resonatorId), actionId: local.event.actionId,
      stepId: fight.currentStepId, message: operation.message })
    case 'setEffectStacks': {
      removeEffect(fight, member, operation.effect)
      const stacks = resolveValue(operation.stacks, context)
      if (stacks > 0) grant(fight, member, { ...operation, stacks }, next, local.event)
      break
    }
    case 'shield': {
      local.event.shields = (local.event.shields ?? 0) + 1
      dispatch(fight, member, 'shield', local.event.actionId, null, 'afterHit', local.event)
      fight.trace.push({ frame: fight.frame, type: 'shield', owner: member.ruleset.resonatorId })
      break
    }
    case 'add': {
      const value = readPath(context, operation.path) + resolveValue(operation.value, context)
      const bounded = operation.cap == null ? value : Math.min(operation.cap, value)
      writePath(member, operation.path, operation.floor == null ? bounded : Math.max(operation.floor, bounded))
      break
    }
    case 'set': {
      const value: RuntimeValue = resolveValue(operation.value, context)
      writePath(member, operation.path, value)
      for (const clock of member.ruleset.clockRules ?? []) {
        if (clock.kind === 'periodicStatus' && clock.nextAt === operation.path) {
          member.clockSources[clock.nextAt] = eventCause(local.event)
        }
      }
      break
    }
    case 'grantEffect': grant(fight, member, { ...operation,
      stacks: resolveValue(operation.stacks ?? 1, context),
      ...(operation.targetOwner == null ? {} : { targetOwner: resolveValue(operation.targetOwner, context) }),
    }, next, local.event); break
    // `from` names whose Outro hands it over (a teammate's, for a held team effect such as
    // Suisui's Undulating Mist); the effect stays the queuing member's own.
    case 'queueHandoffEffect': fight.handoffEffects.push({ owner: member.ruleset.resonatorId,
      from: operation.from == null ? member.ruleset.resonatorId : Number(resolveValue(operation.from, context)),
      effect: operation.effect, until: fight.frame + operation.frameLimit }); break
    case 'removeEffect': {
      removeEffect(fight, member, operation.effect, operation.targetOwner == null ? undefined : resolveValue(operation.targetOwner, context))
      break
    }
    case 'cancelPendingAction': fight.pending = fight.pending.filter((item?: RuntimeValue): RuntimeValue =>
      item.owner !== member.ruleset.resonatorId || item.actionId !== operation.action); break
    case 'decrementEffectStacks': {
      const active: RuntimeValue = fight.effects.find((effect?: RuntimeValue): RuntimeValue => effect.id === operation.effect &&
        (effect.owner === member.ruleset.resonatorId || fight.effectDefinitions[effect.id]?.status) && effect.until > fight.frame)
      const stacks = resolveValue(operation.stacks, context)
      if (!active || active.stacks < stacks) break
      active.stacks -= stacks
      if (!active.stacks) removeEffect(fight, member, operation.effect)
      else traceEffect(fight, active)
      const status = fight.effectDefinitions[operation.effect]?.status
      if (status) recordStatus(fight, member.ruleset.resonatorId, status.key, active.stacks)
      break
    }
    // signal a replayed application; the timeline supplies the stack count.
    case 'signalStatus': {
      if (operation.negative !== false) {
        local.event.negativeInflicted = true
        local.event.negativeInflictedByOwner ??= {}
        local.event.negativeInflictedByOwner[member.ruleset.resonatorId] = true
      }
      // what a grant would have recorded, so a rule asking whether this hit laid it still sees it
      if (operation.effect != null) {
        const owner = member.ruleset.resonatorId
        local.event.applied ??= {}
        local.event.applied[operation.effect] = (local.event.applied[operation.effect] ?? 0) + operation.stacks
        local.event.appliedByOwner ??= {}
        const owners = local.event.appliedByOwner[operation.effect] ??= {}
        owners[owner] = (owners[owner] ?? 0) + operation.stacks
      }
      fight.statusOwners[operation.status] = member.ruleset.resonatorId
      for (const other of Object.values(fight.members) as RuntimeValue[]) dispatch(fight, other, 'statusApplied', local.event.actionId, null, 'cast',
        { ...local.event, status: operation.status, sourceOwner: member.ruleset.resonatorId, actor: member.ruleset.resonatorId })
      break
    }
    case 'applyStatus': {
      if (operation.status === 'spectroFrazzle') {
        const before = fight.enemy.spectroFrazzle
        const definition = Object.entries(fight.effectDefinitions).find(([, value]: RuntimeValue) => value.status?.key === 'spectroFrazzle')
        fight.enemy.spectroFrazzle = Math.min(definition ? fight.effectCaps[definition[0]] : SPECTRO_FRAZZLE.maxStacks,
          before + resolveValue(operation.stacks, context))
        local.event.negativeInflicted = true
        local.event.negativeInflictedByOwner ??= {}
        local.event.negativeInflictedByOwner[member.ruleset.resonatorId] = true
        fight.statusOwners.spectroFrazzle = member.ruleset.resonatorId
        fight.frazzleOwner = member.ruleset.resonatorId
        fight.frazzleCause = eventCause(local.event)
        // opening counters have no authored source/tick phase. the first infliction
        // establishes both, even when the supplied opening counter was already positive.
        if (fight.nextFrazzleTickAt == null && fight.enemy.spectroFrazzle) fight.nextFrazzleTickAt = fight.frame +
          frazzleInterval(fight)
        fight.trace.push({ frame: fight.frame, type: 'status', owner: member.ruleset.resonatorId,
          status: 'spectroFrazzle', stacks: fight.enemy.spectroFrazzle,
          ...(local.event.actionId == null ? {} : { sourceActionId: local.event.actionId }),
          ...(local.event.instance == null ? {} : { sourceInstance: local.event.instance }),
          ...(local.event.eventId == null ? {} : { sourceEventId: local.event.eventId }),
          ...(local.event.responseId == null ? {} : { responseId: local.event.responseId }) })
        for (const other of (Object.values(fight.members) as RuntimeValue[])) {
          dispatch(fight, other, 'statusApplied', local.event.actionId, null, 'cast',
            { ...local.event, status: operation.status,
              sourceOwner: member.ruleset.resonatorId, actor: member.ruleset.resonatorId })
        }
      } else if (fight.enemyStatuses[operation.status]) {
        const definition = fight.enemyStatuses[operation.status]
        fight.enemy[operation.status] = true
        for (const other of definition.exclusiveWith ?? []) fight.enemy[other] = false
        fight.trace.push({ frame: fight.frame, type: 'status', owner: member.ruleset.resonatorId,
          status: operation.status, active: true,
          ...(local.event.source == null ? {} : { source: local.event.source }),
          ...(local.event.actionId == null ? {} : { sourceActionId: local.event.actionId }),
          ...(local.event.instance == null ? {} : { sourceInstance: local.event.instance }),
          ...(local.event.eventId == null ? {} : { sourceEventId: local.event.eventId }),
          ...(local.event.responseId == null ? {} : { responseId: local.event.responseId }) })
        for (const other of (Object.values(fight.members) as RuntimeValue[])) {
          dispatch(fight, other, 'statusApplied', local.event.actionId, null, 'cast',
            { ...local.event, status: operation.status,
              sourceOwner: member.ruleset.resonatorId, actor: member.ruleset.resonatorId })
        }
      } else throw new Error(`Unsupported status ${operation.status}`)
      break
    }
    case 'extendEffect': {
      const active: RuntimeValue = fight.effects.find((effect?: RuntimeValue): RuntimeValue => effect.id === operation.effect &&
        effect.owner === member.ruleset.resonatorId && effect.until > fight.frame)
      if (!active || active.grantedAt === fight.frame ||
        operation.sameInstance && active.sourceInstance !== local.event.instance ||
        (active.extendedCount ?? 0) >= operation.maxExtensions) break
      active.until = Math.min(active.until + operation.frames,
        active.grantedAt + operation.maxTotalFrames)
      active.extendedCount = (active.extendedCount ?? 0) + 1
      // the program reads an effect's end from the trace, so a later end must be traced too
      traceEffect(fight, active)
      for (const dependent of fight.effects) if (fight.effectDefinitions[dependent.id]?.expiresWith ===
        operation.effect && dependent.owner === active.owner && dependent.until !== active.until) {
        dependent.until = active.until
        traceEffect(fight, dependent)
      }
      break
    }
    case 'emitHit': {
      const response: RuntimeValue = emitResponse(fight, { kind: 'action', owner: member.ruleset.resonatorId,
        cause: local.event.responseId == null ? eventCause(local.event) :
          { type: 'response', responseId: local.event.responseId },
        actionId: operation.eventId })
      const action: RuntimeValue = { name: operation.name }
      emitHit(fight, member,
      { action: action.name, actionId: operation.eventId, eventId: operation.eventId,
        responseId: response.id })
      break
    }
    case 'queueAction': {
      if (operation.afterHandoff) {
        fight.handoffActions.push({ member, operation: { ...operation, afterHandoff: false }, event: { ...local.event } })
        break
      }
      const until = fight.triggerReadyAt[operation.action] ?? 0
      if (fight.frame < until) break
      let selected = operation.action
      for (const choice of operation.select ?? []) {
        if (choice.when.every((part?: RuntimeValue): RuntimeValue => matchesRule(part, context))) { selected = choice.action; break }
      }
      const target = operation.targetOwner == null ? member : fight.members[resolveValue(operation.targetOwner, context)]
      if (!target) throw new Error('Queued action has no team recipient')
      if (target !== member && !target.ruleset.actions[selected]) {
        target.ruleset.actions[selected] = structuredClone(member.ruleset.actions[selected])
        const binding = member.ruleset.nodeFeatures[selected]
        if (typeof binding === 'string' && binding.includes(':negative-effect:')) {
          target.ruleset.nodeFeatures[selected] = binding.replace(/^\d+:/, `${target.ruleset.resonatorId}:`)
        }
      }
      const response: RuntimeValue = emitResponse(fight, { kind: 'action', owner: target.ruleset.resonatorId,
        cause: local.event.responseId == null ? eventCause(local.event) : { type: 'response', responseId: local.event.responseId }, actionId: selected })
      const delay = resolveValue(operation.delayFrames ?? 0, context)
      if (delay > 0) {
        fight.pending.push({ frame: fight.frame + delay, order: fight.order++, owner: target.ruleset.resonatorId,
          actionId: selected, event: { kind: 'triggerAction' }, response, stepId: fight.currentStepId })
        fight.pending.sort((a: RuntimeValue, b: RuntimeValue) => a.frame - b.frame || a.order - b.order)
      } else triggerAction(fight, target, selected, response)
      if (operation.internalCooldown) fight.triggerReadyAt[operation.action] =
        fight.frame + operation.internalCooldown
      break
    }
    case 'grantUnisonBoon':
    case 'takeUnisonBoon': {
      const boon = fight.unisonBoon
      if (operation.op === 'takeUnisonBoon') boon.stacks = Math.max(0, boon.stacks - 1)
      else {
        const granter = `${member.ruleset.resonatorId}:${operation.marker}`
        if (!boon.granters.has(granter)) boon.stacks = Math.min(boon.max, boon.stacks + 1)
        boon.granters.add(granter); boon.until = fight.frame + 1800
      }
      fight.trace.push({ type: 'control', frame: fight.frame, path: 'teamEffects.unisonBoon', value: boon.stacks })
      break
    }
    case 'heal': {
      if (operation.overTimeFrames && operation.intervalFrames) {
        for (let offset = operation.intervalFrames; offset <= operation.overTimeFrames;
          offset += operation.intervalFrames) {
          fight.pending.push({ frame: fight.frame + offset, order: fight.order++,
            owner: member.ruleset.resonatorId, actionId: local.event.actionId,
            instance: local.event.instance,
            event: { id: `${local.event.eventId}:heal:${offset}`, kind: 'heal' } })
        }
        fight.pending.sort((a?: RuntimeValue, b?: RuntimeValue): RuntimeValue => a.frame - b.frame || a.order - b.order)
      } else {
        local.event.heals = (local.event.heals ?? 0) + 1
        dispatch(fight, member, 'heal', null, null, 'cast',
          { ...local.event, actor: member.ruleset.resonatorId }, next)
      }
      break
    }
    case 'setControl': {
      const key = operation.path.replace(/^runtime\.state\.controls\./, '')
      const value = resolveValue(operation.value, context)
      member.source.initialControls[key] = value
      fight.trace.push({ type: 'control', frame: fight.frame, owner: member.ruleset.resonatorId, path: operation.path, value })
      break
    }
    default: throw new Error(`Unsupported operation ${operation.op}`)
  }
}
// source and team listeners share event details across phases; the late pass runs after ordinary rules.
function dispatch(fight?: RuntimeValue, member?: RuntimeValue, when?: RuntimeValue, actionId?: RuntimeValue, event?: RuntimeValue, phase: RuntimeValue = 'cast', extra: RuntimeValue = {}, next: RuntimeValue = null): RuntimeValue {
  const action = member.ruleset.actions[actionId] ??
    echoAction(member.source.echoes.main, actionId)
  const detail: RuntimeValue = extra.sharedDetail ?? { owner: member.ruleset.resonatorId, actor: member.ruleset.resonatorId,
    actionId, eventId: event?.id,
    index: event?.index, damageType: event?.damage?.type,
    cast: action?.cast, node: action?.node, nativeCast: action?.cast == null ? null : [1, 2, 3, 4, 5, 6, 7, 0, 8, 9, 10][action.cast],
    casts: [action?.cast, ...action?.additionalCasts ?? []], element: event?.element ?? member.source.element,
    positiveHitCounters: action?.positiveHitCounters ?? {}, hitCounterTotals: action?.hitCounterTotals ?? {},
    triggered: extra.responseId != null, counterChanges: event?.counterChanges ?? action?.counterChanges ?? {},
    hasField: Boolean(action?.hasField), hasDamage: Boolean(event?.damage), coordinated: Boolean(event?.coordinated), status: event?.status,
    isHit: event?.index != null,
    elapsed: action?.timing.duration ?? 0, hitCount: action?.events.filter((event: RuntimeValue) => event.damage).length ?? 0,
    isLastHit: event?.index != null && !action?.events.some((candidate: RuntimeValue) => candidate.damage && candidate.index > event.index),
    sourceSkillIds: [member.ruleset.nodeFeatures[actionId]].flat().flatMap(binding => {
      const id = typeof binding === 'string' ? binding : /^damage:(\d{6,})/.exec(binding?.feature ?? '')?.[1]
      return /^\d{6,}$/.test(id ?? '') ? [Number(id)] : []
    }),
    concertoSpent: event?.concertoSpent ?? 0,
    ...(when === 'afterAction' ? fight.actionConsumptions[extra.instance] : {}), ...extra }
  const local: RuntimeValue = { event: detail, locals: {} }
  for (const rule of [...member.ruleset.rules, ...member.source.weapon.rules,
    ...(member.source.echoes.main.rules ?? []), ...member.source.sonata.rules]) {
    if (rule.when !== when || (rule.phase ?? 'cast') !== phase) continue
    // a late rule (a break's Shifting resolving) runs after every member's own rules of the phase
    if (Boolean(rule.late) !== Boolean(extra.latePass)) continue
    if (extra.sourceOwner != null &&
      extra.sourceOwner !== member.ruleset.resonatorId && !rule.listenTeam) continue
    const cooldownKey = `${member.ruleset.resonatorId}:${rule.cooldownGroup ?? rule.id}`
    if (rule.cooldownFrames && fight.frame <
      (fight.triggerReadyAt[cooldownKey] ?? 0)) continue
    if (rule.actions && !rule.actions.includes(actionId)) continue
    if (rule.conditions) {
      const context = { ...ruleContext(fight, member, detail), locals: local.locals }
      if (!rule.conditions.every((part: RuntimeValue) => matchesRule(part, context))) continue
    }
    for (const operation of rule.operations) runOperation(fight, member, operation, local, next)
    if (rule.cooldownFrames) fight.triggerReadyAt[cooldownKey] =
      fight.frame + rule.cooldownFrames
  }
  if (when === member.ruleset.codes.event.cast && phase === 'cast' &&
    extra.sourceOwner == null) {
    for (const owner of fight.castListeners) if (owner !== member.ruleset.resonatorId) {
      dispatch(fight, fight.members[owner], when, actionId, event, phase,
        { ...detail, sharedDetail: detail, sourceOwner: member.ruleset.resonatorId, latePass: extra.latePass }, next)
    }
  }
  if (when === member.ruleset.codes.event.hit &&
    extra.sourceOwner == null) {
    for (const owner of fight.hitListeners) if (owner !== member.ruleset.resonatorId) {
      dispatch(fight, fight.members[owner], when, actionId, event, phase,
        { ...detail, sharedDetail: detail, sourceOwner: member.ruleset.resonatorId, latePass: extra.latePass }, next)
    }
  }
  if (when === 'afterAction' && extra.sourceOwner == null) {
    for (const other of Object.values(fight.members) as RuntimeValue[]) if (other !== member) {
      dispatch(fight, other, when, actionId, event, phase, { ...detail, sourceOwner: member.ruleset.resonatorId, latePass: extra.latePass }, next)
    }
  }
  if (extra.sourceOwner == null && !extra.latePass && fight.hasLateRules) {
    dispatch(fight, member, when, actionId, event, phase, { ...extra, sharedDetail: detail, latePass: true }, next)
  }
  return local
}
function frazzleInterval(fight?: RuntimeValue): RuntimeValue {
  let factor = 1
  for (const effect of fight.effects) {
    if (effect.until <= fight.frame) continue
    for (const modifier of fight.effectDefinitions[effect.id]?.statusRules ?? []) {
      if (modifier.op === 'spectroFrazzleTickIntervalMultiplier') factor *= modifier.value
    }
  }
  return Math.round(SPECTRO_FRAZZLE.tickFrames * factor)
}
function emitHit(fight?: RuntimeValue, member?: RuntimeValue, data?: RuntimeValue): RuntimeValue {
  fight.trace.push({ frame: fight.frame, type: 'hit', owner: member.ruleset.resonatorId, ...data })
}
// resolve debuffs and pre-damage rules before tracing the hit, then apply post-hit transitions.
function processHit(fight?: RuntimeValue, item?: RuntimeValue): RuntimeValue {
  const member = fight.members[item.owner]
  const action = member.ruleset.actions[item.actionId] ??
    echoAction(member.source.echoes.main, item.actionId)
  const event = item.event
  if (event.kind === 'triggerAction') { triggerAction(fight, member, item.actionId, item.response); return }
  if (event.kind === 'afterAction') {
    dispatch(fight, member, 'afterAction', item.actionId, null, 'cast',
      { instance: item.instance, ...(item.responseId == null ? {} : { responseId: item.responseId }) })
    return
  }
  if (event.kind === 'heal') {
    dispatch(fight, member, 'heal', item.actionId, event, 'cast', { instance: item.instance })
    fight.trace.push({ frame: fight.frame, type: 'heal', owner: item.owner,
      sourceActionId: item.actionId, sourceInstance: item.instance,
      ...(event.healing ? { healing: event.healing } : {}) })
    return
  }
  const targetStateBeforeHit: RuntimeValue = { ...fight.enemy }
  const hitContext: RuntimeValue = { targetStateBeforeHit, instance: item.instance,
    ...(item.responseId == null ? {} : { responseId: item.responseId }) }
  if (event.damage) buildOffTune(fight, member, item.actionId, event.id)
  // one event record retains debuff applications and consumptions across all pre-damage phases.
  const beforeHit = dispatch(fight, member, event.kind, item.actionId, event, 'beforeHit', hitContext)
  dispatch(fight, member, event.kind, item.actionId, event, 'afterDebuffs', { ...beforeHit.event, sharedDetail: beforeHit.event })
  dispatch(fight, member, event.kind, item.actionId, event, 'beforeDamage', { ...beforeHit.event, sharedDetail: beforeHit.event })
  if (event.damage) {
    emitHit(fight, member,
      { action: action.name, actionId: item.actionId, eventId: event.id,
        instance: item.instance,
        ...(action.damageStatus ? { damageStatus: { key: action.damageStatus.key,
          stacks: resolveValue(action.damageStatus.stacks, ruleContext(fight, member)) } } : {}),
        ...(item.responseId == null ? {} : { responseId: item.responseId }) })
  }
  dispatch(fight, member, event.kind, item.actionId, event, 'afterHit', { ...hitContext,
    damageType: beforeHit.event.damageType, applied: beforeHit.event.applied, shields: beforeHit.event.shields,
    appliedByOwner: beforeHit.event.appliedByOwner, consumedByOwner: beforeHit.event.consumedByOwner,
    consumed: beforeHit.event.consumed, statusConsumedTotal: beforeHit.event.statusConsumedTotal,
    heals: beforeHit.event.heals, negativeInflicted: beforeHit.event.negativeInflicted,
    negativeInflictedByOwner: beforeHit.event.negativeInflictedByOwner })
  if (event.kind === 'shield') {
    const recipients = event.shield?.recipient === 'team'
      ? (Object.values(fight.members) as RuntimeValue[]) : [member]
    for (const other of recipients) if (other !== member) {
      dispatch(fight, other, 'shield', item.actionId, event, 'afterHit',
        { ...hitContext, sourceOwner: item.owner })
    }
    fight.trace.push({ frame: fight.frame, type: 'shield', owner: item.owner,
      recipients: recipients.map((other?: RuntimeValue): RuntimeValue => other.ruleset.resonatorId),
      sourceActionId: item.actionId,
      sourceInstance: item.instance, sourceEventId: event.id })
  }
  if (event.damage?.type === member.ruleset.codes.damage.tuneBreak && event.index === 0) {
    const statusEvents: RuntimeValue = {}
    for (const [status, definition] of (Object.entries(fight.enemyStatuses) as [string, RuntimeValue][])) {
      const result = definition.onTuneBreak
      if (!result) continue
      statusEvents[result.eventFlag] = fight.enemy[status]
      if (fight.enemy[status]) {
        fight.enemy[result.state] = true
        fight.enemy[result.until] = fight.frame + result.duration
      }
    }
    for (const other of (Object.values(fight.members) as RuntimeValue[])) {
      dispatch(fight, other, 'tuneBreakResolved', item.actionId, null, 'cast',
        { sourceOwner: item.owner, sourceActionId: item.actionId,
          sourceInstance: item.instance, sourceEventId: event.id, ...statusEvents })
    }
  }
}
// the latest credited inflictor receives the tick; decay updates both the enemy counter and active effect stacks.
function tickFrazzle(fight?: RuntimeValue): RuntimeValue {
  const owner = fight.members[fight.frazzleOwner]
  if (!owner || !fight.enemy.spectroFrazzle) { fight.nextFrazzleTickAt = null; return }
  const response: RuntimeValue = emitResponse(fight, { kind: 'tick', owner: owner.ruleset.resonatorId,
    cause: fight.frazzleCause ?? { type: 'status', owner: owner.ruleset.resonatorId,
      status: 'spectroFrazzle' }, status: 'spectroFrazzle' })
  statusHit(fight, owner, 'spectroFrazzle', response.id)
  const stagnated: RuntimeValue = fight.effects.some((effect?: RuntimeValue): RuntimeValue => effect.until > fight.frame &&
    fight.effectDefinitions[effect.id]?.statusRules?.some((modifier?: RuntimeValue): RuntimeValue =>
      modifier.op === 'preventSpectroFrazzleDecay'))
  if (!stagnated) fight.enemy.spectroFrazzle--
  for (const effect of fight.effects) if (fight.effectDefinitions[effect.id]?.status?.key === 'spectroFrazzle') {
    effect.stacks = fight.enemy.spectroFrazzle
    if (!effect.stacks) effect.until = fight.frame
  }
  fight.trace.push({ frame: fight.frame, type: 'status', owner: owner.ruleset.resonatorId,
    status: 'spectroFrazzle', stacks: fight.enemy.spectroFrazzle,
    responseId: response.id })
  fight.frazzleCause = { type: 'response', responseId: response.id }
  fight.nextFrazzleTickAt = fight.enemy.spectroFrazzle
    ? fight.frame + frazzleInterval(fight) : null
}
// individually timed stacks expire independently, and the final stack determines the effect lifetime.
function expireIndividualStacks(fight?: RuntimeValue): RuntimeValue {
  for (const effect of fight.effects) {
    if (!effect.stackExpires) continue
    const before = effect.stacks
    effect.stackExpires = effect.stackExpires.filter((expiry?: RuntimeValue): RuntimeValue => expiry > fight.frame)
    effect.stacks = effect.stackExpires.length
    effect.until = effect.stackExpires.at(-1) ?? fight.frame
    if (effect.stacks !== before) fight.trace.push({ frame: fight.frame, type: 'effect',
      owner: effect.owner, target: effect.target, effectId: effect.id,
      recipient: effect.recipient, effect: fight.effectDefinitions[effect.id]?.name,
      stacks: effect.stacks, until: effect.until, expiredStacks: before - effect.stacks })
  }
}
// each periodic application records its source clock or preceding response before applying the status.
function pulsePeriodicStatus(fight?: RuntimeValue, member?: RuntimeValue, clock?: RuntimeValue): RuntimeValue {
  const mode: RuntimeValue = readPath(member, clock.mode)
  const variant = clock.variants[mode]
  if (!variant) throw new Error(`Missing periodic status variant ${mode}`)
  const instance = ++fight.castInstance
  const response: RuntimeValue = emitResponse(fight, { kind: 'status', owner: member.ruleset.resonatorId,
    cause: member.clockSources[clock.nextAt] ?? { type: 'clock', owner: member.ruleset.resonatorId,
      actionId: clock.sourceAction, eventId: clock.sourceEvent },
    status: variant.status })
  member.clockSources[clock.nextAt] = { type: 'response', responseId: response.id }
  const sourceEvent: RuntimeValue = { actionId: clock.sourceAction, instance,
    eventId: clock.sourceEvent, source: clock.source, responseId: response.id }
  grant(fight, member, { effect: variant.effect, recipient: 'enemy' }, null, sourceEvent)
  runOperation(fight, member, { op: 'applyStatus', status: variant.status },
    { event: sourceEvent }, null)
}
// clock rules have source-qualified cooldowns and create a response occurrence for every executed tick.
function applyClockRules(fight?: RuntimeValue, member?: RuntimeValue, rules?: RuntimeValue): RuntimeValue {
  for (const rule of rules) {
    if (rule.when !== 'clock') continue
    const cooldownKey = `${member.ruleset.resonatorId}:${rule.cooldownGroup ?? rule.id}`
    if (rule.cooldownFrames && fight.frame <
      (fight.triggerReadyAt[cooldownKey] ?? 0)) continue
    if (rule.conditions && !rule.conditions.every((part?: RuntimeValue): RuntimeValue => matchesRule(part, ruleContext(fight, member)))) continue
    const response =
      emitResponse(fight, { kind: 'tick', owner: member.ruleset.resonatorId,
        cause: { type: 'status', owner: member.ruleset.resonatorId,
          status: rule.id }, status: rule.id })
    for (const op of rule.operations) {
      runOperation(fight, member, op,
        { event: { owner: member.ruleset.resonatorId,
          responseId: response.id } }, null)
    }
    if (rule.cooldownFrames) fight.triggerReadyAt[cooldownKey] =
      fight.frame + rule.cooldownFrames
  }
}
// advance monotonically through bounded frames; clock ticks precede expiry cleanup and queued hits at the same frame.
export function advanceEffectState(fight?: RuntimeValue, targetFrame?: RuntimeValue): RuntimeValue {
  if (!Number.isInteger(targetFrame) || targetFrame < fight.frame ||
    targetFrame > fight.frameLimit) throw new Error(`Invalid target frame ${targetFrame} (current ${fight.frame}, limit ${fight.frameLimit})`)
  while (fight.frame <= targetFrame) {
    if (fight.unisonBoon.until <= fight.frame) {
      fight.unisonBoon = { ...fight.unisonBoon, stacks: 0, until: Infinity, granters: new Set() }
      fight.trace.push({ type: 'control', frame: fight.frame, path: 'teamEffects.unisonBoon', value: 0 })
    }
    for (const member of (Object.values(fight.members) as RuntimeValue[])) {
      applyClockRules(fight, member, member.ruleset.rules)
      if (member.hasWeaponClock) applyClockRules(fight, member, member.source.weapon.rules)
      if (member.hasEchoClock) applyClockRules(fight, member, member.source.echoes.main.rules)
      if (member.hasSonataClock) applyClockRules(fight, member, member.source.sonata.rules)
      for (const clock of member.ruleset.clockRules ?? []) {
        if (clock.kind === 'periodicStatus') {
          const next: RuntimeValue = readPath(member, clock.nextAt)
          const until: RuntimeValue = readPath(member, clock.until)
          if (next >= 0 && next <= fight.frame && next <= until) {
            pulsePeriodicStatus(fight, member, clock)
            writePath(member, clock.nextAt, next + clock.intervalFrames)
          }
        }
      }
    }
    for (const effect of [...fight.effects]) {
      const status = fight.effectDefinitions[effect.id]?.status
      if (status?.intervalFrames && status.key !== 'spectroFrazzle' && effect.until >= fight.frame) {
        let factor = 1, retain = false
        for (const modifierEffect of fight.effects) if (modifierEffect.until > fight.frame) {
          for (const rule of fight.effectDefinitions[modifierEffect.id]?.statusRules ?? []) {
            if (rule.op === `${status.key}TickIntervalMultiplier`) factor *= rule.value
            if (status.key === 'electroFlare' && rule.op === 'preventElectroFlareDecay') retain = true
          }
        }
        effect.statusElapsed += fight.frame - effect.lastStatusTickFrame
        effect.lastStatusTickFrame = fight.frame
        const interval = Math.round(status.intervalFrames * factor)
        if (effect.statusElapsed < interval) continue
        effect.statusElapsed -= interval
        statusHit(fight, fight.members[effect.owner], status.key)
        if (status.key === 'electroFlare' && fight.enemy.electroRage) {
          for (const rage of fight.effects) if (fight.effectDefinitions[rage.id]?.status?.key === 'electroRage') { rage.stacks = 0; rage.until = fight.frame }
          recordStatus(fight, effect.owner, 'electroRage', 0)
        }
        effect.stacks = status.halveOnTick && !retain ? Math.floor(effect.stacks / 2) : Math.max(0, effect.stacks - (status.decay ?? 0))
        recordStatus(fight, effect.owner, status.key, effect.stacks)
        if (!effect.stacks) effect.until = fight.frame
      }
      const tick = fight.effectDefinitions[effect.id]?.tick
      if (!tick || effect.until < fight.frame) continue
      const member = fight.members[effect.owner]
      const interval = typeof tick.intervalFrames === 'number' ? tick.intervalFrames : resolveValue(tick.intervalFrames, ruleContext(fight, member)), elapsed = fight.frame - effect.lastTickFrame
      effect.lastTickFrame = fight.frame
      if (!interval) continue
      effect.tickElapsed += elapsed
      if (effect.tickElapsed < interval) continue
      effect.tickElapsed -= interval
      const response = emitResponse(fight, { kind: 'tick', owner: effect.owner,
        cause: { type: 'status', owner: effect.owner, status: effect.id }, status: effect.id })
      for (const operation of tick.operations) runOperation(fight, member, operation,
        { event: { owner: effect.owner, actor: effect.owner, effectId: effect.id, responseId: response.id } }, null)
      effect.tickIndex = (effect.tickIndex ?? 0) + 1
      dispatch(fight, member, 'effectTick', null, null, 'cast', { effectId: effect.id, tickIndex: effect.tickIndex, responseId: response.id })
      if (tick.consumesStack) {
        effect.stacks--
        traceEffect(fight, effect)
        if (!effect.stacks) effect.until = fight.frame
      }
    }
    for (const effect of fight.effects) if (effect.until <= fight.frame && fight.effectDefinitions[effect.id]?.status) {
      recordStatus(fight, effect.owner, fight.effectDefinitions[effect.id].status.key, 0)
    }
    expireIndividualStacks(fight)
    fight.effects = fight.effects.filter((effect?: RuntimeValue): RuntimeValue => effect.until > fight.frame)
    for (const effect of fight.effects) {
      const definition = fight.effectDefinitions[effect.id]
      if (!definition?.fieldDecayFrames || effect.target !== fight.active ||
        fight.frame <= effect.grantedAt ||
        (fight.frame - effect.grantedAt) % definition.fieldDecayFrames !== 0) continue
      effect.stacks = Math.max(0, effect.stacks - (definition.fieldDecayAmount ?? 1))
      traceEffect(fight, effect)
      emitResponse(fight, { kind: 'tick', owner: effect.owner,
        cause: { type: 'status', owner: effect.owner, status: effect.id },
        status: effect.id })
      if (!effect.stacks) effect.until = fight.frame
    }
    fight.effects = fight.effects.filter((effect?: RuntimeValue): RuntimeValue => effect.until > fight.frame)
    for (const [status, definition] of (Object.entries(fight.enemyStatuses) as [string, RuntimeValue][])) {
      fight.enemy[status] = fight.effects.some((effect?: RuntimeValue): RuntimeValue =>
        effect.id === definition.effect && effect.until > fight.frame)
      if (definition.onTuneBreak &&
        fight.enemy[definition.onTuneBreak.until] <= fight.frame) {
        fight.enemy[definition.onTuneBreak.state] = false
      }
    }
    if (fight.nextFrazzleTickAt === fight.frame) tickFrazzle(fight)
    // queued events temporarily restore their originating step id; finally restores the outer step even when an event fails.
    while (fight.pending[0]?.frame === fight.frame) {
      const item = fight.pending.shift(), stepId = fight.currentStepId
      fight.currentStepId = item.stepId ?? stepId
      try { processHit(fight, item) } finally { fight.currentStepId = stepId }
    }
    if (fight.frame === targetFrame) break
    fight.frame++
  }
  return fight
}
/** an unknown binding is an output gap, never a resource/animation legality failure. */
export function findAction(member: RuntimeValue, reference: string | number, stepId?: string): [number, RuntimeValue] {
  const direct = member.ruleset.actions[reference] ?? echoAction(member.source.echoes.main, reference)
  if (direct) return [Number(reference), direct]
  const normal = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
  const aliases = Object.entries(member.ruleset.inputAliases ?? {}).find(([name]) => normal(name) === normal(String(reference)))?.[1] as RuntimeValue
  if (aliases) {
    const choice = aliases.find((candidate: RuntimeValue) => member.source.build.sequence >= (candidate.minimumSequence ?? 0) &&
      Object.entries(candidate.state ?? {}).every(([key, value]) => member.state[key] === value))
    if (choice && member.ruleset.actions[choice.action]) return [choice.action, member.ruleset.actions[choice.action]]
  }
  const found = Object.entries(member.ruleset.actions).filter(([, action]: RuntimeValue) => normal(action.name) === normal(String(reference)))
  if (found.length !== 1) throw new PlanTranslationError({ code: 'missing-action-binding', stepId,
    resonatorId: String(member.ruleset.resonatorId), action: reference,
    message: `No unique action binding for ${member.ruleset.name}: ${reference}` })
  return [Number(found[0][0]), found[0][1]]
}
// input timestamps are shared by prescribed casts and saved-timeline casts.
function recordInputTime(member: RuntimeValue, action: RuntimeValue, frame: number): void {
  if (action.cast === member.ruleset.codes.cast.intro) member.lastIntroAt = frame
  if (action.input === 'basic') member.lastBasicAt = frame
  if (action.input === 'heavy') member.lastHeavyAt = frame
  if (action.input === 'skill') member.lastSkillAt = frame
}

// validate one prescribed input, dispatch its cast phases, and schedule its delayed events under a new cast instance.
export function resolveAction(fight: RuntimeValue, owner: number, reference: string | number, options: RuntimeValue = {}): RuntimeValue {
  const member = fight.members[owner]
  const [id, action] = findAction(member, reference, fight.currentStepId)
  // missing Echo hit timing blocks only builds with a rule that can react to those hits.
  if (action.input === 'echo' && member.source.echoes.main.hitEventsUnavailable) {
    const classification = { event: { cast: member.ruleset.codes.cast.echo, damageType: member.ruleset.codes.damage.echo } }
    const possible = (condition: RuntimeValue): boolean => condition.all ? condition.all.every(possible) :
      condition.any ? condition.any.some(possible) :
      ['event.cast', 'event.damageType'].includes(condition.path) && typeof condition.value !== 'object'
        ? matchesRule(condition, classification) : true
    const needed = (Object.values(fight.members) as RuntimeValue[]).some(other =>
      [...other.ruleset.rules, ...other.source.weapon.rules, ...other.source.sonata.rules, ...other.source.echoes.main.rules]
        .some(rule => rule.when === other.ruleset.codes.event.hit &&
          (other === member || rule.listenTeam) && (!rule.actions || rule.actions.includes(id)) &&
          (!rule.conditions || rule.conditions.every(possible))))
    if (needed) throw new PlanTranslationError({ code: 'missing-echo-hit-events', stepId: fight.currentStepId,
      resonatorId: String(owner), echoId: String(member.source.echoes.main.id),
      message: 'This build reacts to equipped Echo hits, but their event timing/count has not been translated.' })
  }
  assertActionCoverage(member, id, fight.currentStepId)
  if (fight.active !== owner && !options.triggered) throw new Error(`Action actor disagrees with the plan: ${owner}`)
  const instance = ++fight.castInstance
  fight.trace.push({ frame: fight.frame, type: 'cast', owner, action: action.name, actionId: id, instance, stepId: fight.currentStepId,
    ...(options.next == null ? {} : { next: options.next }) })
  recordInputTime(member, action, fight.frame)
  if (id === member.ruleset.tuneBreakAction) {
    // the break takes the whole bar and starts the Tune Break Cooldown
    fight.offTune.value = 0
    fight.offTune.blockedUntil = fight.frame + TUNE_BREAK_LOCKOUT_FRAMES
  }
  const cast = action.events.find((event: RuntimeValue) => event.kind === member.ruleset.codes.event.cast)
  if (cast) dispatch(fight, member, cast.kind, id, cast, 'cast', { instance, nextOwner: options.next }, options.next)
  if (cast) dispatch(fight, member, 'afterCast', id, cast, 'cast', { instance }, options.next)
  schedule(fight, member, id, fight.frame, instance)
  if (action.input !== 'echo') fight.readyAt = fight.frame + worldFrame(action.timing.duration ?? 0, action.timing.timeStop)
  return fight
}

/** whether a control is on: what the replay's own effects say, else the scenario's value. */
function controlOn(fight: RuntimeValue, member: RuntimeValue, key: string): boolean {
  const path = `runtime.state.controls.${key}`
  const bindings = fight.memberEffectControls[member.ruleset.resonatorId] ?? {}
  const bound = Object.entries(bindings as Record<string, [string, unknown][]>)
    .filter(([, specs]) => specs.some(([candidate]) => candidate === path))
  if (!bound.length) return Boolean(member.source.initialControls?.[key])
  return bound.some(([effectId, specs]) => specs.some(([candidate, value]) => candidate === path && value === true) &&
    fight.effects.some((effect: RuntimeValue) => String(effect.id) === effectId &&
      effect.owner === member.ruleset.resonatorId && effect.until > fight.frame && effect.stacks > 0))
}

/** a calculator effect condition, read against the replay: controls and the build. */
function matchesSource(fight: RuntimeValue, member: RuntimeValue, condition: RuntimeValue): boolean {
  if (!condition || condition.type === 'always') return true
  if (condition.type === 'and') return condition.values.every((part: RuntimeValue) => matchesSource(fight, member, part))
  if (condition.type === 'or') return condition.values.some((part: RuntimeValue) => matchesSource(fight, member, part))
  if (condition.type === 'not') return !matchesSource(fight, member, condition.value)
  const path = String(condition.path ?? '')
  if (condition.type === 'truthy' && path.startsWith('state.controls.')) return controlOn(fight, member, path.slice('state.controls.'.length))
  const base = path === 'base.sequence' ? member.source.build.sequence : path === 'base.level' ? member.source.build.level : null
  if (base == null) return false
  return condition.type === 'gte' ? base >= condition.value : condition.type === 'lte' ? base <= condition.value :
    condition.type === 'eq' ? base === condition.value : false
}

/** the hitter's Off-Tune Buildup Rate: 1, plus every buildup effect that reaches them. */
function buildupRate(fight: RuntimeValue, hitter: RuntimeValue): number {
  let rate = 1
  for (const member of Object.values(fight.members) as RuntimeValue[]) {
    for (const effect of member.source.buildupRateEffects ?? []) {
      if (!effect.teamWide && member !== hitter) continue
      if (matchesSource(fight, member, effect.condition)) rate += effect.value
    }
  }
  return Math.max(0, rate)
}

// the buildup lockout rejects all hit contributions until the previous Tune Break cooldown ends.
function buildOffTune(fight: RuntimeValue, member: RuntimeValue, actionId: RuntimeValue, eventId: RuntimeValue): void {
  const base = member.source.offTuneByAction?.[actionId]?.[eventId]
  if (!base || fight.frame < fight.offTune.blockedUntil) return
  fight.offTune.value = Math.min(fight.offTune.max, fight.offTune.value + base * buildupRate(fight, member))
}

/** cuts a break may come out behind (the reference's): none, a plain, instant, on-hit or mash
 *  cancel, or a dodge cut whose dodge the break takes the place of. */
const BREAK_AFTER = new Set([undefined, 'cancel', 'instant cancel', 'cancel on hit', 'mash cancel',
  'dodge cancel', 'instant dodge', 'dodge on hit'])

/**
 * the reference's automatic Tune Break: once a press played on field leaves the bar full, the
 * on-field member breaks before the next input. never behind an Intro or a Liberation, a hold,
 * jump or swap cut, nor while the last break's Rupture/Hack Interfered window stands, nor (on a
 * team that lays a Shifting) before one is on the target; the bar stays full for the next press
 * that qualifies.
 */
export function maybeTuneBreak(fight: RuntimeValue, actor: number, actionId: number, cut?: string): boolean {
  const member = fight.members[actor]
  if (fight.active !== actor || member.ruleset.tuneBreakAction == null) return false
  if (fight.offTune.value + EPS < fight.offTune.max) return false
  const action = member.ruleset.actions[actionId]
  const codes = member.ruleset.codes.cast
  if (action && (action.cast === codes.intro || action.cast === codes.liberation || action.cast === codes.tuneBreak)) return false
  if (!BREAK_AFTER.has(cut)) return false
  const standing = (pattern: RegExp) => fight.effects.some((effect?: RuntimeValue): RuntimeValue =>
    effect.until > fight.frame && pattern.test(fight.effectDefinitions[effect.id]?.name ?? ''))
  if (fight.shiftable && !standing(/^Tune (?:Strain|Rupture|Hack) - Shifting$/)) return false
  if (standing(/^Tune (?:Rupture|Hack) - Interfered$/)) return false
  resolveAction(fight, actor, member.ruleset.tuneBreakAction)
  return true
}

/** handoffs are prescribed by the solved plan; no Concerto threshold is inferred here. */
export function resolveSwap(fight: RuntimeValue, to: number, response?: { outro: string; intro: string }): RuntimeValue {
  const from = fight.active
  if (!fight.members[to] || to === from) throw new Error('Invalid prescribed swap')
  expireSwapEffects(fight, from)
  if (response) {
    resolveAction(fight, from, response.outro, { next: to })
    advanceEffectState(fight, Math.max(fight.frame, fight.readyAt))
    for (const pending of fight.handoffEffects) if (pending.from === from && pending.until >= fight.frame) {
      grant(fight, fight.members[pending.owner], { effect: pending.effect, recipient: 'incomingMember' }, to)
    }
    fight.handoffEffects = fight.handoffEffects.filter((pending: RuntimeValue) => pending.from !== from)
  }
  expireSwapEffects(fight, from)
  fight.effects = fight.effects.filter((effect: RuntimeValue) => effect.until > fight.frame)
  fight.members[from].onFieldSince = null
  fight.active = to
  enterField(fight, fight.members[to])
  fight.trace.push({ type: 'swap', frame: fight.frame, from, to })
  if (response) resolveAction(fight, to, response.intro)
  for (const pending of fight.handoffActions.splice(0)) runOperation(fight, pending.member,
    pending.operation, { event: pending.event }, to)
  return fight
}

// recipient-bound effects expire when that recipient leaves the field, including effects granted by another member.
function expireSwapEffects(fight: RuntimeValue, recipient: number): void {
  for (const active of [...fight.effects]) if (active.target === recipient && active.until > fight.frame &&
    (active.endsOnSwap || fight.effectDefinitions[active.id]?.endsOn?.recipientSwap)) {
    removeEffect(fight, fight.members[active.owner], active.id, recipient)
  }
}

// replay timeline casts and landed hits through weapon, echo, and sonata effects.

/** a timeline cast resolves its landed hit count or a matched sparse set of event ordinals. */
export function playCast(fight: RuntimeValue, owner: number, actionId: number, landed: number, share?: number,
  timelineEvent?: number, landedIndices?: number[], incomingOwner?: number): void {
  const member = fight.members[owner]
  const action = member.ruleset.actions[actionId] ?? echoAction(member.source.echoes.main, actionId)
  if (!action) throw new Error(`Unknown timeline action ${owner}:${actionId}`)
  const instance = ++fight.castInstance
  fight.trace.push({ frame: fight.frame, type: 'cast', owner, action: action.name, actionId, instance, stepId: fight.currentStepId,
    ...(share == null ? {} : { share }), ...(timelineEvent == null ? {} : { timelineEvent }),
    ...(landedIndices == null ? {} : { landedIndices }) })
  // what the timeline inflicts next, it inflicts with this cast
  const span = Math.max(0, ...action.events.filter((event: RuntimeValue) => event.damage).map((event: RuntimeValue) => event.at ?? 0))
  member.timelineCast = { owner, actionId, instance, frame: fight.frame, span }
  fight.timelineCast = member.timelineCast
  recordInputTime(member, action, fight.frame)
  const cast = action.events.find((event: RuntimeValue) => event.kind === member.ruleset.codes.event.cast)
  // a recorded Outro can precede or follow its same-frame swap. Equipment
  // needs the actual recipient so swap-off expiry follows that teammate.
  const next = incomingOwner ?? (action.cast === member.ruleset.codes.cast.outro && fight.active !== owner ? fight.active : null)
  const detail = { instance, ...(next == null ? {} : { nextOwner: next }) }
  if (cast) dispatch(fight, member, cast.kind, actionId, cast, 'cast', detail, next)
  if (cast) dispatch(fight, member, 'afterCast', actionId, cast, 'cast', detail, next)
  const damageHits = action.events.filter((event: RuntimeValue) => event.damage && eventAppliesToOwner(event, owner))
    .sort((a: RuntimeValue, b: RuntimeValue) => (a.index ?? 0) - (b.index ?? 0))
  const hits = new Set(landedIndices
    ? damageHits.filter((_: RuntimeValue, index: number) => landedIndices.includes(index))
    : damageHits.slice(0, landed))
  schedule(fight, member, actionId, fight.frame, instance, null, (event) => !event.damage || hits.has(event))
}

/** the field changes hands; equipment's swap and field-entry effects follow. */
export function playSwap(fight: RuntimeValue, to: number): void {
  const from = fight.active
  if (to === from) return
  expireSwapEffects(fight, from)
  for (const pending of fight.handoffEffects) if (pending.from === from && pending.until >= fight.frame) {
    grant(fight, fight.members[pending.owner], { effect: pending.effect, recipient: 'incomingMember' }, to)
  }
  fight.handoffEffects = fight.handoffEffects.filter((pending: RuntimeValue) => pending.from !== from)
  fight.effects = fight.effects.filter((effect: RuntimeValue) => effect.until > fight.frame)
  fight.members[from].onFieldSince = null
  fight.active = to
  enterField(fight, fight.members[to])
  fight.trace.push({ type: 'swap', frame: fight.frame, from, to })
  for (const pending of fight.handoffActions.splice(0)) runOperation(fight, pending.member, pending.operation, { event: pending.event }, to)
}

const BREAK_DEBUFF = /^Tune (Strain|Rupture|Hack) - (Shifting|Interfered)$/

/**
 * apply a kit effect at the reference timeline's stack count; zero ends it.
 * `target` identifies a member, the team, or the enemy. `responseKind` identifies
 * a kit response when the stack count increases.
 */
export function holdEffect(fight: RuntimeValue, owner: number, effectId: number, target: number | 'team' | 'enemy',
  stacks: number, responseKind?: string, cast?: RuntimeValue): void {
  // a change the cast before it made, in its frame: written after that cast's hits
  const source = cast ? { sourceActionId: cast.actionId, sourceInstance: cast.instance } : {}
  const recipient = target === 'team' ? 'team' : target === 'enemy' ? 'enemy' : 'self'
  const targetId = target
  const until = Infinity
  let active = fight.effects.find((effect: RuntimeValue) => effect.id === effectId && effect.target === targetId && effect.until > fight.frame)
  const before = active?.stacks ?? 0
  // an ownership change closes the previous traced activation before the new source writes its stacks.
  if (active && (!stacks || active.owner !== owner)) {
    active.stacks = 0; active.until = fight.frame
    fight.trace.push({ type: 'effect', frame: fight.frame, owner: active.owner, effectId: active.id,
      target: active.target, recipient: active.recipient, stacks: 0, until: active.until, ...source })
    fight.effects = fight.effects.filter((effect: RuntimeValue) => effect !== active)
    active = undefined
  }
  const name: string = fight.effectDefinitions[effectId]?.name ?? ''
  const debuff = BREAK_DEBUFF.exec(name)
  // timeline-governed break effects also update the interpreter flags read by automatic Tune Break eligibility.
  if (debuff) {
    fight.enemy[`tune${debuff[1]}${debuff[2]}`] = stacks > 0
    if (debuff[1] === 'Strain' && debuff[2] === 'Interfered') fight.enemy.tuneStrainInterferedStacks = stacks
  }
  if (!stacks) return
  if (!active) {
    active = { id: effectId, recipient, target: targetId, owner, stacks, until, grantedAt: fight.frame,
      sourceInstance: null, extendedCount: 0 }
    fight.effects.push(active)
  }
  active.stacks = stacks
  active.until = until
  fight.trace.push({ frame: fight.frame, type: 'effect', owner, target: targetId, effectId, recipient, effect: name, ...source,
    stacks, until })
  if (responseKind && stacks > before) {
    const detail = { owner, responseKind, actor: owner, sourceOwner: owner }
    for (const other of Object.values(fight.members) as RuntimeValue[]) {
      dispatch(fight, other, 'responseEvent', null, null, 'cast', detail)
      dispatch(fight, other, 'unison', null, null, 'cast', detail)
    }
  }
}

/** a negative status at the timeline's stacks; a rise is an infliction equipment can answer. */
export function holdStatus(fight: RuntimeValue, owner: number, status: string, stacks: number, traced: boolean, applies = true): void {
  const before = fight.enemy[status] ?? 0
  if (before === stacks) return
  fight.statusOwners[status] = owner
  if (traced) recordStatus(fight, owner, status, stacks)
  else fight.enemy[status] = stacks
  if (stacks <= before || !applies) return
  // the reference names who inflicted it, not with what: that seat's latest cast (or the latest at all)
  const source = fight.members[owner]?.timelineCast ?? fight.timelineCast
  for (const other of Object.values(fight.members) as RuntimeValue[]) {
    dispatch(fight, other, 'statusApplied', source?.actionId ?? null, null, 'cast',
      { ...source, status, sourceOwner: owner, actor: owner, negativeInflicted: true, negativeInflictedByOwner: { [owner]: true } })
  }
}

/** a negative status dealing its damage. */
export function playTick(fight: RuntimeValue, owner: number, status: string): void {
  statusHit(fight, fight.members[owner], status)
}

/** a heal or a shield the timeline's kit gave. */
export function playSupport(fight: RuntimeValue, owner: number, kind: 'heal' | 'shield'): void {
  const member = fight.members[owner]
  // the reference names who healed, not with what: equipment reads that seat's running cast
  // (Stellar Symphony answers a heal its wielder's Resonance Skill gives)
  const cast = member.timelineCast
  if (kind === 'heal') dispatch(fight, member, 'heal', cast?.actionId ?? null, null, 'cast', { ...cast, actor: owner, heals: 1 })
  else dispatch(fight, member, 'shield', cast?.actionId ?? null, null, 'afterHit', { ...cast, actor: owner, shields: 1 })
  fight.trace.push({ frame: fight.frame, type: kind, owner })
}

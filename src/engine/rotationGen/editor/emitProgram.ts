/*
  Author: Runor Ewhro
  description: converts replayed actions and state changes into rotation editor nodes.
*/

import type { RuntimeValue } from '../types.ts'
import { buildTeamPreamble } from './preamble.ts'
import { foldHitRuns, foldRepeats } from './foldHits.ts'
import { settleConsumedWindows } from './consumedWindows'
import { echoAction, eventAppliesToOwner } from '../gear/echo.ts'
import { OFF_TUNE_LOCKOUT_FRAMES } from '../events/rules'
import { mergeControlValues, projectControlStacks } from '../controlProjection'

// timeline effects provide current stacks. "consumed" controls represent the
// stacks spent by one cast and apply to that cast's feature nodes.

/** the replay needs a write the rotation editor does not offer. */
export class UnauthorablePath extends Error {
  readonly path: string
  constructor(path: string) {
    super(`Condition is not editor-authorable: ${path}`)
    this.path = path
  }
}

const freshId = (type?: RuntimeValue, index?: RuntimeValue): RuntimeValue => `kit:team:${type}:${index}`
// control namespaces identify the source resonator; equipment paths resolve through the member's actual loadout.
function resolvePathOwner(path?: RuntimeValue, members?: RuntimeValue): RuntimeValue {
  const match: RuntimeValue = path.match(/(?:resonator|sequence|inherent|team):(\d+):/)
  if (match && members.some((member?: RuntimeValue): RuntimeValue => String(member.resonatorId) === match[1])) return match[1]
  for (const member of members) {
    if (path.includes(`weapon:${member.weapon.id}:`) ||
      path.includes(`echo:${member.echoes.main.id}:`) ||
      (member.sonata.sets ?? [member.sonata]).some((set?: RuntimeValue): RuntimeValue =>
        path.includes(`echoSet:${set.id}:`))) return String(member.resonatorId)
  }
  return null
}
function findFeature(features?: RuntimeValue, skillId?: RuntimeValue): RuntimeValue {
  return features.find((entry?: RuntimeValue): RuntimeValue => entry.skillId === skillId && entry.variant !== 'subHit')?.id
}
// map the landed event ordinal to a sub-hit feature after filtering out events assigned to another owner.
function findHitFeature(features?: RuntimeValue, skillId?: RuntimeValue, action?: RuntimeValue, eventId?: RuntimeValue, owner?: RuntimeValue, skill?: RuntimeValue): RuntimeValue {
  const hits: RuntimeValue = action.events.filter((event?: RuntimeValue): RuntimeValue => event.damage &&
    eventAppliesToOwner(event, owner))
  const index: RuntimeValue = hits.findIndex((event?: RuntimeValue): RuntimeValue => String(event.id) === String(eventId))
  if (index < 0) return null
  const variants: RuntimeValue = features.filter((entry?: RuntimeValue): RuntimeValue => entry.skillId === skillId &&
    entry.variant === 'subHit').sort((a?: RuntimeValue, b?: RuntimeValue): RuntimeValue => a.hitIndex - b.hitIndex)
  // a hit-table row can repeat one hit `count` times, so expand rows into one ordinal per hit; when the expanded count
  // matches the action's damage events, each event maps to the row at its ordinal
  const rows = skill?.hitTable ?? skill?.hits ?? []
  const ordinals = rows.flatMap((row: RuntimeValue, hitIndex: number) =>
    Array.from({ length: Math.max(1, row.count ?? 1) }, () => hitIndex))
  if (ordinals.length === hits.length) return variants.find((entry: RuntimeValue) => entry.hitIndex === ordinals[index])?.id ?? null
  if (variants.length === 1) return variants[0].id
  const row: RuntimeValue = variants.find((entry?: RuntimeValue): RuntimeValue => entry.hitIndex === index)
  return row?.id ?? null
}
function findAction(rulesets?: RuntimeValue, combat?: RuntimeValue, owner?: RuntimeValue, actionId?: RuntimeValue): RuntimeValue {
  const ruleset = rulesets[owner]
  const member: RuntimeValue = combat.members.find((entry?: RuntimeValue): RuntimeValue => entry.resonatorId === owner)
  return ruleset.actions[actionId] ??
    echoAction(member.echoes.main, actionId)
}
function readSkillBindings(action?: RuntimeValue, member?: RuntimeValue, ruleset?: RuntimeValue): RuntimeValue {
  if (echoAction(member.echoes.main, action.id)) return []
  const bindings = ruleset.nodeFeatures?.[action.id]
  return bindings == null ? [] : Array.isArray(bindings) ? bindings : [bindings]
}

// translate an ordered replay trace into editor-authorable controls and features, reporting any incomplete bindings.
export function emitEditorProgram(rulesets?: RuntimeValue, combat?: RuntimeValue, report?: RuntimeValue, editor?: RuntimeValue): RuntimeValue {
  // a consumed count can describe a held buff's captured input in place of stacks spent by the next attack; such
  // counts follow the binding's lifetime
  const heldStackPaths = new Set(Object.values(rulesets).flatMap((kit: RuntimeValue) =>
    Object.values(kit.effectControls ?? {}).flatMap((specs: RuntimeValue) =>
      specs.filter(([, kind]: RuntimeValue) => kind?.held).map(([path]: RuntimeValue) => path))))
  const consumedPaths = new Set<string>((Object.values(editor.resonators) as RuntimeValue[]).flatMap(bundle =>
    (bundle.details?.stateGraph?.nodes ?? []).filter((node: RuntimeValue) =>
      node.kind !== 'toggle' && /\bconsumed\b/i.test(node.label ?? '') && !heldStackPaths.has(`runtime.state.controls.${node.key}`))
      .map((node: RuntimeValue) => `runtime.state.controls.${node.key}`)))
  const isConsumedStackControl = (path: string): boolean => /:consumed$/i.test(path) || consumedPaths.has(path)
  if (report.frame !== combat.maxFrames || report.failure) {
    throw new Error('Team replay did not reach the requested window legally')
  }
  if (!Array.isArray(report.trace)) throw new Error('Team report lacks ordered event trace')
  const effectControls = editor.effectControls ?? {}
  const specsFor = (active?: RuntimeValue): RuntimeValue => editor.memberEffectControls?.[active.owner]?.[active.effectId] ??
    effectControls[active.effectId]
  const definitions = new Map<string, RuntimeValue>()
  const dependents = new Map<string, string[]>()
  for (const member of combat.members) {
    const owner = member.resonatorId
    const effects = { ...rulesets[owner].effects, ...member.weapon.effects, ...member.echoes.main.effects, ...member.sonata.effects }
    for (const [id, definition] of Object.entries(effects) as [string, RuntimeValue][]) {
      definitions.set(`${owner}|${id}`, definition)
      for (const prerequisite of definition.requiresOwnerEffects ?? []) {
        const key = `${owner}|${prerequisite}`
        dependents.set(key, [...dependents.get(key) ?? [], id])
      }
    }
  }
  const definitionFor = (active: RuntimeValue): RuntimeValue => definitions.get(`${active.owner}|${active.effectId}`)
  const affectedPaths = (active: RuntimeValue): string[] => [...new Set([
    ...specsFor(active) ?? [],
    ...(dependents.get(`${active.owner}|${active.effectId}`) ?? [])
      .flatMap(effectId => specsFor({ owner: active.owner, effectId }) ?? []),
  ].map(([path]: RuntimeValue) => path))]
  const valueKey = (path?: RuntimeValue, owner?: RuntimeValue): RuntimeValue => path.startsWith('runtime.state.controls.')
    ? `${owner ?? resolvePathOwner(path, combat.members)}|${path}` : path
  // use the reference's opening value for controls without a named buff,
  // including Shattered Hours in Tune Strain mode.
  const opening = (choice?: RuntimeValue): RuntimeValue => editor.preambleValues?.(choice)
  const standingValue = (choice?: RuntimeValue): RuntimeValue => {
    const standing = (rulesets[choice.resonatorId]?.standingControls ?? [] as RuntimeValue[])
      .find((control?: RuntimeValue): RuntimeValue => control.path === choice.state.controlKey)
    if (!standing) return opening(choice)
    if (!standing.when) return standing.value
    const [path, expected] = standing.when
    const anchor = (editor.preambleChoices ?? []).find((other?: RuntimeValue): RuntimeValue =>
      String(other.resonatorId) === String(choice.resonatorId) && other.state.controlKey === path)
    return anchor && (opening(anchor) ?? anchor.state.defaultValue) === expected ? standing.value : opening(choice)
  }
  const preamble: RuntimeValue = buildTeamPreamble(editor.preambleChoices,
    report.startOwner ?? combat.initialOnFieldResonatorId, standingValue)
  // reject replay writes to paths unavailable in the rotation editor.
  const authorablePaths: RuntimeValue = new Set(preamble.flatMap((node?: RuntimeValue): RuntimeValue =>
    node.changes.map((change?: RuntimeValue): RuntimeValue => valueKey(change.path, change.resonatorId))))
  const features: RuntimeValue = Object.fromEntries(combat.members.map((member?: RuntimeValue): RuntimeValue => {
    const id: RuntimeValue = String(member.resonatorId)
    if (!editor.resonators[id]) throw new Error(`Missing editor features for ${id}`)
    return [id, [...editor.resonators[id].source.features, ...(editor.equipmentFeatures?.[id] ?? [])]]
  }))
  const allFeatureIds: RuntimeValue = new Set((Object.values(features) as RuntimeValue[]).flat().map((item?: RuntimeValue): RuntimeValue => item.id))
  // attach each consumed stack count to damage features whose formulas read it.
  // timeline stack counts remain separate from cast consumption.
  const consumedFeatureIdsByPath = new Map<string, Set<string>>()
  const readsPath = (value: RuntimeValue, path: string): boolean => {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some((item) => readsPath(item, path))
    if (value.from === 'sourceRuntime' && value.path === path) return true
    return Object.values(value).some((item) => readsPath(item, path))
  }
  for (const member of combat.members) {
    const owner = String(member.resonatorId)
    const source = editor.resonators[owner]?.source
    const bindings = rulesets[owner]?.effectControls ?? {}
    for (const specs of Object.values(bindings) as RuntimeValue[]) for (const [controlPath] of specs) {
      if (!isConsumedStackControl(controlPath)) continue
      const sourcePath = controlPath.replace(/^runtime\./, '')
      const skillIds = new Set<string>()
      for (const effect of source?.effects ?? []) for (const operation of effect.operations ?? []) {
        if (readsPath(operation, sourcePath)) {
          for (const skillId of operation.match?.skillIds ?? []) skillIds.add(String(skillId))
        }
      }
      const featureIds = new Set<string>((source?.features ?? [])
        .filter((feature: RuntimeValue): boolean => skillIds.has(String(feature.skillId)))
        .map((feature: RuntimeValue): string => String(feature.id)))
      if (featureIds.size) consumedFeatureIdsByPath.set(`${owner}|${controlPath}`, featureIds)
    }
  }
  const items: RuntimeValue = structuredClone(preamble)
  const values: RuntimeValue = new Map(preamble.flatMap((node?: RuntimeValue): RuntimeValue => node.changes.map((change?: RuntimeValue): RuntimeValue =>
    [valueKey(change.path, change.resonatorId), change.value])))
  const activeMemberCondition: RuntimeValue = items.flatMap((node?: RuntimeValue): RuntimeValue => node.changes)
    .find((change?: RuntimeValue): RuntimeValue => change.path === 'runtime.rotation.activeResonatorId')
  if (!activeMemberCondition) throw new Error('Generated preamble lacks its active-member control')
  activeMemberCondition.value = String(report.startOwner ?? combat.initialOnFieldResonatorId)
  values.set(activeMemberCondition.path, activeMemberCondition.value)
  const unobservedOpeningControls = new Set([...values.entries()]
    .filter(([, value]) => value === true).map(([key]) => key))
  const castFeatureNodes: RuntimeValue = new Map()
  const castConditionTails: RuntimeValue = new Map()
  // post-cast condition updates are inserted after that cast's last feature and after its previously inserted updates.
  const insertForCast = (node?: RuntimeValue, sourceKey?: RuntimeValue): RuntimeValue => {
    const featureNodes: RuntimeValue = castFeatureNodes.get(sourceKey)
    if (!featureNodes?.length) {
      items.push(node)
      return
    }
    const anchorId = castConditionTails.get(sourceKey) ?? featureNodes.at(-1)
    let anchorIndex: RuntimeValue = items.findIndex((item?: RuntimeValue): RuntimeValue => item.id === anchorId)
    if (anchorIndex < 0) {
      items.push(node)
      return
    }
    // the source's whole feature group may already include its future tail, so a later hit's grant goes after any
    // intervening cast's damage
    if (items.slice(anchorIndex + 1).some((item: RuntimeValue) => item.type === 'feature')) {
      anchorIndex = items.length - 1
    }
    // a later grant can belong to an earlier cast: move the anchor past any enabled condition already writing one of the
    // same controls, which keeps an expired window's old clear from overwriting its renewed activation
    const writes = new Set((node.changes ?? []).map((change: RuntimeValue) =>
      valueKey(change.path, change.resonatorId ?? node.resonatorId)))
    for (let index = anchorIndex + 1; index < items.length; index++) {
      const item = items[index]
      if (item.type === 'condition' && item.enabled !== false && item.changes?.some((change: RuntimeValue) =>
        writes.has(valueKey(change.path, change.resonatorId ?? item.resonatorId)))) anchorIndex = index
    }
    items.splice(anchorIndex + 1, 0, node)
    castConditionTails.set(sourceKey, node.id)
  }
  // an Active Other buff turning on pins whoever is active as it is written, so one that turns on
  // at a handoff waits for the swap in its frame and is written just after it
  const heldForSwap: RuntimeValue = new Map()
  // a recipient snapshot can precede the actual handoff when an overlapping action is reported at its press frame, so
  // incoming-only buffs stay queued across frame boundaries without pinning them to the outgoing member
  const heldForRecipient = new Map<string, { target: string, path: string, value: RuntimeValue, owner: RuntimeValue }>()
  const releaseRecipients = (): void => {
    const active = String(values.get('runtime.rotation.activeResonatorId'))
    for (const [key, held] of heldForRecipient) {
      if (held.target !== active) continue
      heldForRecipient.delete(key)
      writeCondition(held.path, held.value, null, null, held.owner)
    }
  }
  // frames with a swap or a cast handing off to the next member; only controls written in these frames wait for the swap
  const handoffFrames = new Set(report.trace.filter((entry: RuntimeValue) =>
    entry.type === 'swap' || entry.type === 'cast' && entry.next != null).map((entry: RuntimeValue) => entry.frame))
  let entryFrame = -1
  let swappedThisFrame = false
  const releaseHeld = (): void => {
    const held = [...heldForSwap.values()]
    heldForSwap.clear()
    for (const args of held) writeCondition(...args)
  }
  // a control the calculator reads off one feature: attached to the hit that spends its effect,
  // never written on the timeline (Denia's Shifting Applied, on the team's first Shifting hit)
  const attachedControls = new Set<string>(combat.members.flatMap((member: RuntimeValue) =>
    (rulesets[member.resonatorId]?.attachedControls ?? []).map((path: string) => `${member.resonatorId}|runtime.state.controls.${path}`)))
  const emitCondition = (path?: RuntimeValue, value?: RuntimeValue, section?: RuntimeValue, sourceKey: RuntimeValue = null, sourceOwner: RuntimeValue = null, recipient: RuntimeValue = null): RuntimeValue => {
    if (!section && isConsumedStackControl(path)) return
    const owner = sourceOwner == null ? resolvePathOwner(path, combat.members) : String(sourceOwner)
    // some sequences have timed editor windows written by effect holds; derived sequence flags without an authorable
    // control are skipped
    if (!section && /^runtime\.state\.controls\.sequence:\d+:s\d+:active$/.test(path) &&
      !authorablePaths.has(valueKey(path, owner))) return
    const key: RuntimeValue = `${owner}|${path}`
    if (!section && attachedControls.has(key)) return
    const activating = Boolean(value) && value !== '0'
    if (!activating) heldForRecipient.delete(key)
    if (!section && activating && recipient != null && editor.activeOtherControls?.has(key) &&
      String(values.get('runtime.rotation.activeResonatorId')) !== String(recipient) && values.get(valueKey(path, owner)) !== value) {
      heldForRecipient.set(key, { target: String(recipient), path, value, owner: sourceOwner })
      return
    }
    if (!section && handoffFrames.has(entryFrame) && !swappedThisFrame && value && editor.activeOtherControls?.has(key) && values.get(valueKey(path, owner)) !== value) {
      // repeated observations before the same handoff update the pending write without releasing it while the outgoing
      // member is active
      heldForSwap.set(key, [path, value, section, null, sourceOwner])
      return
    }
    if (heldForSwap.has(key)) releaseHeld()
    writeCondition(path, value, section, sourceKey, sourceOwner)
  }
  const syncStrainResponses = (active: boolean): void => {
    for (const member of combat.members) for (const path of rulesets[member.resonatorId].strainPayoutControls ?? []) {
      const qualified = `runtime.state.controls.${path}`
      if (authorablePaths.has(valueKey(qualified, member.resonatorId)))
        emitCondition(qualified, active, null, null, member.resonatorId)
    }
  }
  // deduplicate writes by source-qualified path and reject any path missing from the editor's opening controls.
  const uncertainStatusInputs = new Set<string>()
  const writeCondition = (path?: RuntimeValue, value?: RuntimeValue, section?: RuntimeValue, sourceKey: RuntimeValue = null, sourceOwner: RuntimeValue = null): RuntimeValue => {
    const owner = sourceOwner == null ? resolvePathOwner(path, combat.members) : String(sourceOwner)
    const key: RuntimeValue = valueKey(path, owner)
    if (path.startsWith('enemy.combat.') && editor.fixedStatuses?.has(path.slice('enemy.combat.'.length))) return
    if (!authorablePaths.has(key)) throw new UnauthorablePath(path)
    if (value === true && owner) {
      const control = path.replace(/^runtime\.state\.controls\./, '')
      const graph = editor.resonators[owner]?.details?.stateGraph
      for (const group of graph?.groups ?? []) {
        if (group.type !== 'exclusive' || !group.members?.includes(control) || group.maxKey === control) continue
        for (const sibling of group.members) {
          const siblingPath = `runtime.state.controls.${sibling}`
          if (sibling !== control && sibling !== group.maxKey && unobservedOpeningControls.has(valueKey(siblingPath, owner)) && authorablePaths.has(valueKey(siblingPath, owner)))
            writeCondition(siblingPath, false, section, sourceKey, owner)
        }
      }
    }
    unobservedOpeningControls.delete(key)
    if (values.get(key) === value && !uncertainStatusInputs.has(key)) return
    uncertainStatusInputs.delete(key)
    // a cap change can clamp the executor's stored stacks without a separate setter, so the next recorded status
    // observation restores that input even when its last emitted source value is unchanged
    if (editor.negativeCapControls?.has(key)) {
      for (const candidate of authorablePaths as Set<string>) if (candidate.startsWith('enemy.combat.')) uncertainStatusInputs.add(candidate)
    }
    values.set(key, value)
    const node: RuntimeValue = { id: freshId('condition', items.length + 1), type: 'condition',
      ...(owner ? { resonatorId: owner } : {}), enabled: true,
      changes: [{ type: 'set', path, value, ...(owner ? { resonatorId: owner } : {}) }],
      ...(section ? { editorSection: section } : {}) }
    if (sourceKey) insertForCast(node, sourceKey)
    else items.push(node)
  }
  const resolved: RuntimeValue = new Map()
  // fight frame of each resolved hit, keyed by cast key and event id
  const castKey = (entry?: RuntimeValue): RuntimeValue => `${entry.owner}|${entry.actionId}|${entry.instance}`
  // cast instance ids separate repeated uses of the same action and connect their landed hits to one feature group.
  const castsByKey: RuntimeValue = new Map(report.trace.filter((entry?: RuntimeValue): RuntimeValue => entry.type === 'cast')
    .map((entry?: RuntimeValue): RuntimeValue => [castKey(entry), entry]))
  const castControlSnapshots = new Map<string, Map<string, RuntimeValue>>()
  const resolvedHitFrames = new Map<string, number>()
  for (const entry of report.trace) {
    if (entry.type === 'hit' && entry.actionId != null) {
      const key: RuntimeValue = castKey(entry)
      if (!resolved.has(key)) resolved.set(key, new Set())
      resolved.get(key).add(String(entry.eventId))
      resolvedHitFrames.set(`${key}|${entry.eventId}`, entry.frame)
    }
  }
  const activeEffects: RuntimeValue = new Map()
  const recipientControls: RuntimeValue[] = []
  for (const member of combat.members) {
    const owner = member.resonatorId, rules = rulesets[owner], source = editor.resonators[String(owner)]?.source
    // source stances can enable team effects such as Denia's Entropy Shift.
    // reviewed recipient markers determine which members receive those effects.
    for (const condition of rules.recipientConditions ?? []) recipientControls.push({ owner,
      path: condition.path, effects: [condition.effect], whenControl: condition.whenControl,
      includeOwner: condition.includeOwner,
      appEffects: (source?.effects ?? []).filter((effect: RuntimeValue) =>
        readsPath(effect.condition, condition.path.replace(/^runtime\./, ''))) })
  }
  const effectValue = (path?: RuntimeValue, owner?: RuntimeValue, holders = activeEffects, recipient: RuntimeValue = null,
    activeOwner = values.get('runtime.rotation.activeResonatorId')): RuntimeValue => {
    let result = null
    for (const active of holders.values()) {
      if (owner != null && String(active.owner) !== String(owner)) continue
      const definition = definitionFor(active)
      if (definition?.exclusiveGroup) {
        const winner = [...holders.values()].filter((holder: RuntimeValue) => holder.stacks > 0 &&
          definitionFor(holder)?.exclusiveGroup === definition.exclusiveGroup)
          .sort((left: RuntimeValue, right: RuntimeValue) =>
            (definitionFor(right)?.exclusivePriority ?? 0) - (definitionFor(left)?.exclusivePriority ?? 0) ||
            String(left.owner).localeCompare(String(right.owner)))[0]
        if (winner && String(winner.owner) !== String(active.owner)) continue
      }
      const onField = definition?.ownerOnField
      if (typeof onField === 'boolean' && (String(active.owner) === String(activeOwner)) !== onField) continue
      if (recipient != null && definitionFor(active)?.recipient === 'actorMember' &&
        String(active.target) !== String(recipient)) continue
      if (definitionFor(active)?.requiresOwnerEffects?.some((id: RuntimeValue) =>
        ![...holders.values()].some((holder: RuntimeValue) => String(holder.owner) === String(active.owner) &&
          String(holder.effectId) === String(id) && holder.stacks > 0))) continue
      for (const [candidate, kind] of specsFor(active) ?? []) {
        if (candidate !== path) continue
        if (isConsumedStackControl(candidate)) continue
        const value = kind === 'conditionalSourceValue' ? active.conditionalSourceValue : projectControlStacks(kind, active.stacks)
        result = mergeControlValues(result, value)
      }
    }
    const opening = values.get(valueKey(path, owner))
    result ??= typeof opening === 'boolean' ? false : 0
    // a count held in a select (Dark Cores) is written as the option id the editor stores
    return typeof opening === 'string' && typeof result === 'number' ? String(result) : result
  }
  // equipment uses its actual state at every hit, including overlapping short attacks; attach those states locally
  // without importing reference gear stats
  const resolvedHitControls = new Map<string, RuntimeValue[]>()
  const replayEffects = new Set<string>(), replayPaths = new Map<string, RuntimeValue>()
  for (const member of combat.members) {
    const owner = member.resonatorId
    const gearEffects = { ...member.weapon.effects, ...member.echoes.main.effects, ...member.sonata.effects }
    // controls of effects that go to another seat (outro/intro handoffs);
    // these are excluded from per-hit replay controls
    const handoffPaths = new Set(Object.entries({ ...rulesets[owner].effects, ...gearEffects })
      .filter(([, effect]: RuntimeValue) => !['self', 'team', 'enemy'].includes(effect.recipient ?? 'self') &&
        effect.recipient !== 'actorMember')
      .flatMap(([effectId]) => (specsFor({ owner, effectId }) ?? [])
        .map(([path]: RuntimeValue) => valueKey(path, owner))))
    const effects = { ...gearEffects, ...Object.fromEntries(Object.entries(rulesets[owner].effects)
      .filter(([, effect]: RuntimeValue) => effect.replayLifecycle || effect.duration != null && effect.maxStacks === 1)) }
    for (const effectId of Object.keys(effects)) {
      // handoff toggles select a recipient when activated. keep later hits on
      // the existing handoff path to preserve that recipient.
      const recipientOnly = effects[effectId].recipient === 'actorMember'
      const handoffClearOnly = effects[effectId].recipient === 'incomingMember' &&
        (effects[effectId].replayLifecycle === true || Boolean(gearEffects[effectId]))
      if (!['self', 'team', 'enemy'].includes(effects[effectId].recipient ?? 'self') && !recipientOnly && !handoffClearOnly) continue
      replayEffects.add(`${owner}|${effectId}`)
      for (const [path] of specsFor({ owner, effectId }) ?? []) if (!isConsumedStackControl(path) &&
        (!handoffPaths.has(valueKey(path, owner)) || handoffClearOnly) && authorablePaths.has(valueKey(path, owner))) {
        const previous = replayPaths.get(valueKey(path, owner))
        replayPaths.set(valueKey(path, owner), { owner, path,
          fieldState: previous?.fieldState || typeof effects[effectId].ownerOnField === 'boolean',
          equipment: previous?.equipment || Boolean(gearEffects[effectId]),
          recipientOnly: previous?.recipientOnly || recipientOnly,
          handoffClearOnly: previous?.handoffClearOnly || handoffClearOnly,
          clearOnly: (previous?.clearOnly ?? true) && !gearEffects[effectId] && !effects[effectId].replayLifecycle,
          selfOnly: (previous?.selfOnly ?? true) && effects[effectId].recipient === 'self' })
      }
    }
  }
  // capture equipment and timed-field state at each hit so long follow-ups can use their hit-time conditions.
  const replayHolders = new Map<string, RuntimeValue>()
  const castHandoffPaths = new Map<string, Set<string>>()
  let replayActiveOwner = report.startOwner ?? combat.initialOnFieldResonatorId
  const replayCastFrames = new Map<string, number>(report.casts.map((cast: RuntimeValue) => [castKey(cast), cast.frame]))
  for (const entry of report.trace) {
    if (entry.type === 'swap') replayActiveOwner = entry.to
    if (entry.type === 'cast' && entry.next != null) replayActiveOwner = entry.next
    for (const [key, holder] of replayHolders) if (holder.until <= entry.frame) replayHolders.delete(key)
    if (entry.type === 'effect' && replayEffects.has(`${entry.owner}|${entry.effectId}`)) {
      const key = `${entry.owner}|${entry.effectId}|${entry.target}`
      if (entry.stacks <= 0 || entry.until <= entry.frame) replayHolders.delete(key)
      else replayHolders.set(key, entry)
    }
    if (entry.type === 'cast' || entry.type === 'hit' && entry.actionId != null) {
      const key = castKey(entry), held = castHandoffPaths.get(key) ?? new Set<string>()
      for (const { owner, path, handoffClearOnly } of replayPaths.values()) {
        if (handoffClearOnly && effectValue(path, owner, replayHolders, entry.owner, replayActiveOwner)) {
          held.add(valueKey(path, owner))
        }
      }
      castHandoffPaths.set(key, held)
    }
    if (entry.type === 'hit' && entry.actionId != null) {
      // a cast's own earlier hits can enable its later hits without borrowing a future cast's activation, even when the
      // attack has a short tail
      const activatedByCast = new Set([...replayHolders.values()].filter((holder: RuntimeValue) =>
        (holder.sourceOwner ?? holder.owner) === entry.owner && holder.sourceActionId === entry.actionId &&
        holder.sourceInstance === entry.instance && (holder.sourceSupport || findAction(rulesets, combat, entry.owner, entry.actionId)
          ?.events.some((event: RuntimeValue) => event.damage && String(event.id) === String(holder.sourceEventId))))
        .flatMap((holder: RuntimeValue) => (specsFor(holder) ?? []).map(([path]: RuntimeValue) => valueKey(path, holder.owner))))
      // another real cast can enable a buff while this attack's remaining hits are pending; skip activations inferred from
      // an unrelated event id on the current cast or from a later native-field projection
      const activatedByOtherCast = new Set([...replayHolders.values()].filter((holder: RuntimeValue) => {
        if (holder.sourceActionId == null || holder.sourceInstance == null) return false
        const sourceKey = castKey({ owner: holder.sourceOwner ?? holder.owner, actionId: holder.sourceActionId, instance: holder.sourceInstance })
        const sourceFrame = replayCastFrames.get(sourceKey)
        return sourceKey !== castKey(entry) && sourceFrame != null && sourceFrame <= entry.frame
      }).flatMap((holder: RuntimeValue) => (specsFor(holder) ?? []).map(([path]: RuntimeValue) => valueKey(path, holder.owner))))
      resolvedHitControls.set(`${castKey(entry)}|${entry.eventId}`,
        [...[...replayPaths.values()].filter(({ owner, path, handoffClearOnly }) =>
          !handoffClearOnly || castHandoffPaths.get(castKey(entry))?.has(valueKey(path, owner)))
          .map(({ owner, path, selfOnly, clearOnly, recipientOnly, handoffClearOnly, equipment, fieldState }) => ({ owner, path, selfOnly, clearOnly, recipientOnly, handoffClearOnly, equipment, fieldState,
          fromCast: activatedByCast.has(valueKey(path, owner)),
          fromOtherCast: activatedByOtherCast.has(valueKey(path, owner)), value: effectValue(path, owner, replayHolders, entry.owner, replayActiveOwner) })),
        { owner: entry.owner, path: 'runtime.rotation.activeResonatorId', value: String(replayActiveOwner), fieldState: true }])
    }
  }
  const refresh = (paths?: RuntimeValue, sourceKey: RuntimeValue = null, owner: RuntimeValue = null, recipient: RuntimeValue = null): RuntimeValue => {
    for (const path of paths) {
      if (isConsumedStackControl(path)) continue
      emitCondition(path, effectValue(path, owner), null, sourceKey, owner, recipient)
    }
  }
  const refreshFieldConditions = (): void => {
    for (const active of activeEffects.values()) if (typeof definitionFor(active)?.ownerOnField === 'boolean') {
      refresh(affectedPaths(active), null, active.owner)
    }
  }
  const omittedEffects: RuntimeValue = new Set()
  const emittedCasts: RuntimeValue = new Set()
  const tuneBreakSourceKey = (owner?: RuntimeValue, actionId?: RuntimeValue, instance?: RuntimeValue): RuntimeValue =>
    `${owner}|${actionId}|${instance}`
  const responses: RuntimeValue = new Map(report.trace.filter((entry?: RuntimeValue): RuntimeValue => entry.type === 'response')
    .map((entry?: RuntimeValue): RuntimeValue => [entry.id, entry]))
  // triggered responses attach to their originating Tune Break when its action and cast instance are known.
  const tuneBreakResponses: RuntimeValue = new Map()
  const attachedResponseCasts: RuntimeValue = new Set()
  for (const entry of report.trace) {
    if (entry.type !== 'cast' || entry.responseId == null) continue
    const cause = responses.get(entry.responseId)?.cause
    if (cause?.type !== 'event' || cause.instance == null) continue
    const source: RuntimeValue = combat.members.find((member?: RuntimeValue): RuntimeValue => member.resonatorId === cause.owner)
    if (source == null || !rulesets[cause.owner].actions[cause.actionId]?.events.some((event: RuntimeValue) =>
      event.damage?.type === rulesets[cause.owner].codes.damage.tuneBreak)) continue
    const key: RuntimeValue = tuneBreakSourceKey(cause.owner, cause.actionId, cause.instance)
    tuneBreakResponses.set(key, [...(tuneBreakResponses.get(key) ?? []), entry])
    attachedResponseCasts.add(castKey(entry))
  }
  const diagnostics: RuntimeValue = { frameWindow: report.frame, actions: report.casts.length,
    emittedFeatures: 0, foldedHits: 0, partialHitFeatures: 0, scaledPartialFeatures: 0,
    unattachedConsumedEffects: [],
    // the replay frame each feature node was cast at, for audits that line the program up with it
    featureFrames: {} as Record<string, number>,
    // and, on a reference timeline, the index of the cast event it came from
    featureCasts: {} as Record<string, number>,
    omittedEffects: [], unmappedActions: [], omittedMechanics: ['world frames',
      'simultaneous hit timing', 'outgoing hit tails'] }
  let offTuneResumeAt: number | null = null
  const addFeature = (owner?: RuntimeValue, id?: RuntimeValue, frame?: RuntimeValue, multiplier: RuntimeValue = 1, attachment: RuntimeValue = null): RuntimeValue => {
    // a generated feature node plays a whole number of times, with fractional shares resolved before this point
    if (!Number.isSafeInteger(multiplier) || multiplier < 1) {
      throw new Error(`A generated feature requires an integer play count: ${owner} ${id} x${multiplier}`)
    }
    if (!allFeatureIds.has(id) || !features[String(owner)].some((entry?: RuntimeValue): RuntimeValue => entry.id === id)) {
      throw new Error(`Feature is not editor-authorable for ${owner}: ${id}`)
    }
    const node: RuntimeValue = { id: freshId(attachment ? 'attached-feature' : 'feature',
      attachment ? diagnostics.emittedFeatures + 1 : items.length + 1), type: 'feature',
      resonatorId: String(owner), enabled: true, featureId: id, multiplier }
    const source = editor.resonators[String(owner)]?.source
    const feature = source?.features.find((feature: RuntimeValue) => feature.id === id)
    const skill = source?.skills.find((skill: RuntimeValue) => skill.id === feature?.skillId)
    for (const control of recipientControls) {
      if (String(control.owner) === String(owner) && !control.includeOwner || values.get(valueKey(control.path, control.owner)) !== true) continue
      if (control.whenControl && values.get(valueKey(`runtime.state.controls.${control.whenControl[0]}`, control.owner)) !== control.whenControl[1]) continue
      if (['healing', 'shield'].includes(skill?.archetype)) continue
      if (!control.appEffects.some((effect: RuntimeValue) => effect.operations.some((operation: RuntimeValue) =>
        (!operation.attribute || operation.attribute === 'all' || !skill || operation.attribute === skill.element) &&
        (!operation.match?.skillIds || operation.match.skillIds.includes(feature?.skillId)) &&
        // negative Status, Tune Rupture, and Hack ignore general amplification.
        // resistance changes still require recipient checks.
        !(operation.type === 'add_top_stat' && operation.stat === 'amplify' &&
          (skill?.tab === 'negativeEffect' || ['tuneRupture', 'hack'].includes(skill?.archetype))) &&
        !(operation.type === 'add_attribute_mod' && operation.mod === 'amplify' &&
          (skill?.tab === 'negativeEffect' || ['tuneRupture', 'hack'].includes(skill?.archetype)))))) continue
      const eligible = [...activeEffects.values()].some((effect: RuntimeValue) =>
        effect.owner === control.owner && control.effects.includes(effect.effectId) &&
        String(effect.target) === String(owner) && effect.stacks > 0 && effect.until > frame)
      if (eligible) continue
      node.attached ??= { conditions: [], features: [] }
      if (node.attached.conditions.some((condition: RuntimeValue) => condition.changes.some((change: RuntimeValue) =>
        change.path === control.path && String(change.resonatorId) === String(control.owner)))) continue
      node.attached.conditions.push({ id: `${node.id}:recipient:${node.attached.conditions.length}`,
        type: 'condition', enabled: true, resonatorId: String(control.owner),
        changes: [{ type: 'set', path: control.path, value: false, resonatorId: String(control.owner) }] })
    }
    if (attachment) {
      attachment.attached ??= { conditions: [], features: [] }
      attachment.attached.features.push(node)
    } else {
      if (id === `damage:${owner}:tune-break`) offTuneResumeAt = frame +
        OFF_TUNE_LOCKOUT_FRAMES
      else if (offTuneResumeAt != null && frame >= offTuneResumeAt) {
        node.offTuneResume = true
        offTuneResumeAt = null
      }
      items.push(node)
    }
    diagnostics.emittedFeatures++
    diagnostics.featureFrames[node.id] = frame
    return node
  }
  // emit only landed damage events; complete runs use a parent feature and partial runs retain hit-level bindings.
  const addCastFeatures = (entry?: RuntimeValue, attachment: RuntimeValue = null, frame = entry.frame): RuntimeValue => {
    const owner = entry.owner
    const action: RuntimeValue = findAction(rulesets, combat, owner, entry.actionId)
    if (!action) throw new Error(`Unknown replay action ${owner}:${entry.actionId}`)
    const member: RuntimeValue = combat.members.find((candidate?: RuntimeValue): RuntimeValue => candidate.resonatorId === owner)
    const ids: RuntimeValue = readSkillBindings({ ...action, id: entry.actionId }, member, rulesets[owner])
    const damageEvents: RuntimeValue = action.events.filter((event?: RuntimeValue): RuntimeValue => event.damage)
    if (!damageEvents.length || action.equippedEchoReplacement || echoAction(member.echoes.main, entry.actionId)) return
    if (!ids.length) throw new Error(`No feature binding for ${owner} ${action.name}`)

    const key: RuntimeValue = castKey(entry)
    const featureNodeIds: RuntimeValue = []
    const hitControlsFor = (eventId: RuntimeValue): RuntimeValue[] => {
      const hitIndex = damageEvents.findIndex((event: RuntimeValue) => String(event.id) === String(eventId))
      const resolvedFrame = resolvedHitFrames.get(`${key}|${eventId}`)
      const hitOffset = resolvedFrame == null ? Math.min(...damageEvents.map((event: RuntimeValue) => event.at ?? 0))
        : resolvedFrame - entry.frame
      const longFollowup = hitOffset > LATE_HIT_FRAMES
      // outro trace markers precede their swap while editor damage follows the handoff, so use the resulting standing
      // state over a pre-swap buff that the handoff or incoming Intro just ended
      const handoffHit = action.cast === rulesets[owner].codes.cast.outro &&
        (resolvedFrame ?? entry.frame) <= entry.frame
      const replayControls = handoffHit ? [] :
        resolvedHitControls.get(`${key}|${eventId}`) ?? []
      const changes = [...replayControls.filter((change: RuntimeValue) =>
        change.fieldState || change.recipientOnly || change.fromCast || change.fromOtherCast || longFollowup && !change.clearOnly || change.value === false || change.value === 0 || change.value === '0'),
        ...(entry.hitControls ?? []).filter((change: RuntimeValue) => change.hit === hitIndex)]
        // Outros execute after the handoff. The trace's pre-swap hit marker
        // must not reactivate the departing member's active-only bonuses.
        .filter((change: RuntimeValue) => action.cast !== rulesets[owner].codes.cast.outro ||
          change.path !== 'runtime.rotation.activeResonatorId')
        .filter((change: RuntimeValue) => (!change.selfOnly || String(change.owner) === String(owner)) &&
          (!change.handoffClearOnly || change.value === false || change.value === 0 || change.value === '0') &&
          !isConsumedStackControl(change.path) && authorablePaths.has(valueKey(change.path, change.owner)))
      // exact authored hit observations override the replay's coarse same-frame ordering; keep one write per
      // source-qualified control, with the last value
      return [...new Map(changes.map((change: RuntimeValue) =>
        [valueKey(change.path, change.owner), change])).values()]
    }
    const controlValue = (change: RuntimeValue): RuntimeValue =>
      typeof values.get(valueKey(change.path, change.owner)) === 'string' && typeof change.value === 'number'
        ? String(change.value) : change.value
    const hitStatesVary = (hits: RuntimeValue[], skillId: string): boolean => {
      if (hits.length < 2) return false
      const skill = editor.resonators[String(owner)]?.source.skills?.find((skill: RuntimeValue) => skill.id === skillId)
      // some atomic app features summarize several source events without individual hit rows and remain one editor action
      if ((skill?.hitTable ?? skill?.hits ?? []).reduce((count: number, row: RuntimeValue) => count + (row.count ?? 1), 0) <= 1) return false
      const states = hits.map(hit => new Map(hitControlsFor(hit.id).map(change =>
        [valueKey(change.path, change.owner), controlValue(change)])))
      const paths = new Set(states.flatMap(state => [...state.keys()]))
      return [...paths].some(path => new Set(states.map(state => state.has(path) ? state.get(path) : values.get(path))).size > 1)
    }
    // a finisher can consume its stance before its hit snapshot; attach the
    // pre-cast stance only to features whose availability reads it.
    const addBoundFeature = (id: string, multiplier = 1, eventId: RuntimeValue = null): RuntimeValue => {
      const node = addFeature(owner, id, frame, multiplier, attachment)
      const source = editor.resonators[String(owner)]?.source
      const feature = source?.features.find((candidate: RuntimeValue) => candidate.id === id)
      const skill = source?.skills?.find((candidate: RuntimeValue) => candidate.id === feature?.skillId)
      const gates = new Set<string>()
      const availabilityGates = new Set<string>()
      // controls read by this skill's own trigger-skill modifiers, collected apart from the boolean feature gates
      const modifierReads = new Set<string>()
      const visit = (condition: RuntimeValue, reads = gates): void => {
        if (!condition || typeof condition !== 'object') return
        if (condition.from === 'sourceRuntime' && condition.path?.startsWith('state.controls.')) {
          reads.add(`runtime.${condition.path}`)
        }
        for (const child of Object.values(condition)) {
          if (Array.isArray(child)) child.forEach(value => visit(value, reads))
          else if (child && typeof child === 'object') visit(child, reads)
        }
      }
      visit(skill?.visibleWhen)
      visit(skill?.skillTypeWhen)
      for (const path of gates) availabilityGates.add(path)
      // cast-scoped bonuses can read a consumed stance without a feature gate,
      // including Denia's Banish.
      for (const effect of source?.effects ?? []) {
        const operations = (effect.operations ?? []).filter((operation: RuntimeValue) =>
          operation.match?.skillIds?.includes(feature?.skillId))
        if (!operations.length) continue
        visit(effect.condition)
        // a cast can spend the resource its skill modifier reads, even when that
        // resource is not a boolean availability gate
        if (effect.trigger === 'skill') for (const operation of operations) visit(operation.value, modifierReads)
      }
      for (const spent of entry.spentEffects ?? []) for (const [path, kind] of specsFor(spent) ?? []) {
        const consumedInput = isConsumedStackControl(path) &&
          consumedFeatureIdsByPath.get(`${spent.owner}|${path}`)?.has(id)
        const spentModifier = spent.observedSpend === true && modifierReads.has(path)
        if ((!gates.has(path) && !spentModifier && !consumedInput) || !authorablePaths.has(valueKey(path, spent.owner))) continue
        const value = consumedInput ? spent.consumed : projectControlStacks(kind, spent.stacks)
        node.attached ??= { conditions: [], features: [] }
        node.attached.conditions.push({ id: `${node.id}:availability:${node.attached.conditions.length}`,
          type: 'condition', enabled: true, resonatorId: String(spent.owner),
          changes: [{ type: 'set', path, value, resonatorId: String(spent.owner) }] })
      }
      // a timed numerical bonus is not a cast availability requirement: only actual consumption above preserves it past
      // its lifetime, and each other hit uses its current state, including natural expiry mid-cast
      for (const path of availabilityGates) {
        const pathKey = valueKey(path, owner)
        const snapshot = castControlSnapshots.get(key)
        if (!snapshot?.has(pathKey) || !authorablePaths.has(pathKey)) continue
        const value = snapshot.get(pathKey)
        // attach a consumed enabling stance when it was active at cast time.
        // leave false cast-time values unset because hit-time effects can enable
        // the control before damage, as with Qingxiao's Ephemeral multiplier.
        if (value === false) continue
        if (value === values.get(pathKey) || node.attached?.conditions.some((condition: RuntimeValue) =>
          condition.changes?.some((change: RuntimeValue) => change.path === path))) continue
        node.attached ??= { conditions: [], features: [] }
        node.attached.conditions.push({ id: `${node.id}:cast-state:${node.attached.conditions.length}`,
          type: 'condition', enabled: true, resonatorId: String(owner),
          changes: [{ type: 'set', path, value, resonatorId: String(owner) }] })
      }
      for (const change of hitControlsFor(eventId)) {
        // cast-time availability remains valid when a finisher consumes its stance.
        if (node.attached?.conditions.some((condition: RuntimeValue) => condition.changes?.some((prior: RuntimeValue) =>
          prior.path === change.path && String(prior.resonatorId ?? condition.resonatorId) === String(change.owner)))) continue
        const current = values.get(valueKey(change.path, change.owner))
        const value = controlValue(change)
        if (value === current) continue
        node.attached ??= { conditions: [], features: [] }
        node.attached.conditions.push({ id: `${node.id}:hit-state:${node.attached.conditions.length}`,
          type: 'condition', enabled: true, resonatorId: String(change.owner),
          changes: [{ type: 'set', path: change.path, value, resonatorId: String(change.owner) }] })
      }
      return node
    }
    if (typeof ids[0] === 'object') {
      for (const binding of ids) if (resolved.get(key)?.has(String(binding.event))) {
        featureNodeIds.push(addBoundFeature(binding.feature, binding.multiplier ?? 1, binding.event).id)
      }
      castFeatureNodes.set(key, featureNodeIds)
      if (entry.timelineEvent != null) for (const id of featureNodeIds) diagnostics.featureCasts[id] = entry.timelineEvent
      emittedCasts.add(key)
      return
    }
    // a split press lists one skill per hit, so each skill is written once over its own hits
    for (const skillId of new Set<string>(ids)) {
      const expected: RuntimeValue = damageEvents.filter((event?: RuntimeValue): RuntimeValue =>
        ids.length === 1 || ids[damageEvents.indexOf(event)] === skillId)
      const resolvedHits: RuntimeValue = expected.filter((event?: RuntimeValue): RuntimeValue =>
        resolved.get(key)?.has(String(event.id)))
      if (!resolvedHits.length) continue
      const parent: RuntimeValue = findFeature(features[String(owner)], skillId)
      if (!parent) throw new Error(`No parent feature for ${owner} ${skillId}`)
      // all hits landed: emit the parent feature once, unless per-hit controls
      // on a multi-hit cast need the hits emitted one by one
      if (resolvedHits.length === expected.length && !hitStatesVary(resolvedHits, skillId)) {
        // uniform hits still need their shared hit-time state, including a bonus enabled by an earlier skill group in the
        // same press
        featureNodeIds.push(addBoundFeature(parent, 1, expected[0].id).id)
        diagnostics.foldedHits += Math.max(0, resolvedHits.length - 1)
      } else {
        const partials: RuntimeValue = resolvedHits.map((hit?: RuntimeValue): RuntimeValue =>
          findHitFeature(features[String(owner)], skillId, action, hit.id, Number(owner),
            editor.resonators[String(owner)]?.source.skills?.find((skill: RuntimeValue) => skill.id === skillId)))
        if (partials.every(Boolean)) {
          for (const [index, partial] of partials.entries()) {
            featureNodeIds.push(addBoundFeature(partial, 1, resolvedHits[index].id).id)
            diagnostics.partialHitFeatures++
          }
        } else {
          // the reference's share of a cut-short cast covers the whole action, so only one skill
          const share = ids.length === 1 ? entry.share : undefined
          if (share == null && (partials.some(Boolean) || !action.uniformHits)) {
            throw new Error(`No partial hit feature for ${owner} ${skillId}`)
          }
          // a sparse selection lists landed action events, so an aggregate parent feature is scaled by the share or the landed
          // fraction of its hits
          featureNodeIds.push(addBoundFeature(parent,
            share ?? resolvedHits.length / expected.length).id)
          diagnostics.scaledPartialFeatures++
        }
      }
    }
    if (featureNodeIds.length) castFeatureNodes.set(key, featureNodeIds)
    if (entry.timelineEvent != null) for (const id of featureNodeIds) diagnostics.featureCasts[id] = entry.timelineEvent
    emittedCasts.add(key)
  }

  const emitCast = (cast: RuntimeValue, frame: number): void => {
    const key = castKey(cast)
    // an Outro is the visit's last press: what its owner pressed before it comes first
    if (findAction(rulesets, combat, cast.owner, cast.actionId)?.cast === rulesets[cast.owner].codes.cast.outro) flushOutgoing(cast.owner, frame, cast)
    addCastFeatures(cast, null, frame)
    const sourceNode = items.find((node: RuntimeValue) => node.id === castFeatureNodes.get(key)?.[0])
    for (const response of tuneBreakResponses.get(key) ?? []) addCastFeatures(response, sourceNode, frame)
    tuneBreakResponses.delete(key)
  }
  // a short outgoing tail is written ahead of the Outro, after the handoff's active-member change, and a long follow-up
  // at its own hit frame
  const LATE_HIT_FRAMES = 120
  const castsSoFar: RuntimeValue[] = []
  const handoffOutros = new Map<string, { cast: RuntimeValue, frame: number }>()
  const flushHandoffOutros = (): void => {
    const pending = [...handoffOutros.values()]
    handoffOutros.clear()
    for (const { cast, frame } of pending) if (!emittedCasts.has(castKey(cast))) emitCast(cast, frame)
  }
  const flushOutgoing = (owner: RuntimeValue, frame: number, before: RuntimeValue = null): void => {
    for (const cast of castsSoFar) {
      if (cast === before) break
      const key = castKey(cast)
      if (cast.owner !== owner || emittedCasts.has(key) || handoffOutros.has(key) || attachedResponseCasts.has(key) || !resolved.get(key)?.size) continue
      const action: RuntimeValue = findAction(rulesets, combat, cast.owner, cast.actionId)
      // Outro damage is written at its own hit after the incoming Intro's changes, so skip it when flushing cancelled
      // outgoing Skills
      if (action?.cast === rulesets[owner].codes.cast.outro) continue
      const first = Math.min(...(cast.hitFrames ?? (action?.events ?? []).filter((event: RuntimeValue) => event.damage).map((event: RuntimeValue) => event.at ?? 0)))
      if (!Number.isFinite(first) || first > LATE_HIT_FRAMES) continue
      emitCast(cast, frame)
    }
  }
  const prescribedCastsByFrame = new Map<number, Set<number>>()
  for (const entry of report.trace) if (entry.type === 'cast' && entry.timelineEvent != null) {
    const cast = findAction(rulesets, combat, entry.owner, entry.actionId)?.cast
    // process outgoing tails after a handoff swap.
    if ([rulesets[entry.owner].codes.cast.outro, rulesets[entry.owner].codes.cast.intro].includes(cast)) continue
    const owners = prescribedCastsByFrame.get(entry.frame) ?? new Set<number>()
    owners.add(entry.owner)
    prescribedCastsByFrame.set(entry.frame, owners)
  }
  // a rule that resets a control and decides it again ahead of the same hit (a catalog condition
  // read on every hit) leaves only its net value: the reset never reaches any damage
  // within one frame, control writes before the next hit collapse to their final value; a hit ends that collapse window.
  const superseded = new Set<RuntimeValue>()
  const lastControl = new Map<string, RuntimeValue>()
  for (const entry of report.trace) {
    if (entry.type === 'hit') { lastControl.clear(); continue }
    if (entry.type !== 'control') continue
    const key = `${entry.owner}|${entry.path}`
    const before = lastControl.get(key)
    if (before?.frame === entry.frame) superseded.add(before)
    lastControl.set(key, entry)
  }
  let lastHit: RuntimeValue = null
  // delay local control attachments until hit folding has selected the final feature node.
  const pendingAttachments: Array<{ nodeId: string, path: string, owner: string, value: RuntimeValue }> = []
  const attachToHit = (hit: RuntimeValue, path: string, owner: RuntimeValue): void => {
    const nodeId = castFeatureNodes.get(castKey(hit))?.[0]
    if (nodeId) pendingAttachments.push({ nodeId, path, owner: String(owner), value: true })
  }
  const attachConsumedToHit = (hit: RuntimeValue, path: string, owner: RuntimeValue, value: number,
    featureIds: Set<string>): boolean => {
    const nodeIds = castFeatureNodes.get(castKey(hit)) ?? []
    const matching = nodeIds.filter((nodeId: string): boolean => {
      const node = items.find((candidate: RuntimeValue): boolean => candidate.id === nodeId)
      return node?.type === 'feature' && featureIds.has(String(node.featureId))
    })
    if (!matching.length) return false
    for (const nodeId of matching) pendingAttachments.push({ nodeId, path, owner: String(owner), value })
    return true
  }
  for (const entry of report.trace) {
    if (entry.frame !== entryFrame) {
      releaseHeld()
      flushHandoffOutros()
      entryFrame = entry.frame
      swappedThisFrame = false
      // emit a short damage tail before the same member's next press and effects.
      for (const owner of prescribedCastsByFrame.get(entry.frame) ?? []) flushOutgoing(owner, entry.frame)
    }
    const expired: RuntimeValue = new Set()
    if (entry.type === 'section') {
      items.push({ id: freshId('section', entry.index), type: 'note',
        text: `__plan_section_${entry.index}__` })
      continue
    }
    for (const [key, active] of activeEffects) {
      if (active.until > entry.frame) continue
      activeEffects.delete(key)
      for (const path of affectedPaths(active)) expired.add(`${active.owner}|${path}`)
    }
    for (const item of expired) {
      const [owner, ...path] = item.split('|')
      refresh([path.join('|')], null, owner)
    }
    if (entry.type === 'swap') {
      emitCondition('runtime.rotation.activeResonatorId', String(entry.to))
      refreshFieldConditions()
      releaseHeld()
      releaseRecipients()
      // write Active Other now; later effects in this frame use the incoming member.
      swappedThisFrame = true
      // write handoff field changes before resolving late outgoing hits.
      if (entry.from != null) flushOutgoing(entry.from, entry.frame)
      continue
    }
    if (entry.type === 'control') {
      // catalog-backed sequence conditions can depend on each hit's target state, and emitCondition filters flags without
      // an authorable control; standing source flags describe sequence ownership, separate from the catalog's conditional
      // activation (for example Sanhua's enemy HP threshold)
      if (/^runtime\.state\.controls\.sequence:\d+:s\d+:active$/.test(entry.path) &&
        (entry.sourceWhen == null || entry.sourceWhen === 'combatStart')) continue
      if (!superseded.has(entry)) {
        emitCondition(entry.path, entry.value, null, null, entry.owner)
        if (entry.path === 'enemy.status.tuneStrain') syncStrainResponses(Number(entry.value) > 0)
      }
      continue
    }
    if (entry.type === 'cast') {
      for (const binding of rulesets[entry.owner].statControls ?? []) {
        if (binding.actionName !== entry.action) continue
        const path = `runtime.state.controls.${binding.controlKey}`
        if (!authorablePaths.has(valueKey(path, entry.owner))) throw new UnauthorablePath(path)
        items.push({ id: `${freshId('cast-stat', items.length + 1)}:stat-snapshot`, type: 'condition', enabled: true,
          resonatorId: String(entry.owner), changes: [{ type: 'set', path,
            value: values.get(valueKey(path, entry.owner)), resonatorId: String(entry.owner) }] })
      }
      castControlSnapshots.set(castKey(entry), new Map(values))
      castsSoFar.push(entry)
      for (const change of editor.castControls?.[entry.actionId] ?? []) {
        emitCondition(change.path, change.value)
      }
      // emit damage at the first resolved hit after cast-time state changes.
      // attach Tune Break response features to the break node.
      if (entry.next != null) {
        const removed: RuntimeValue = new Set()
        for (const [key, active] of activeEffects) {
          if (active.target !== entry.owner || !active.endsOnSwap) continue
          activeEffects.delete(key)
          for (const path of affectedPaths(active)) removed.add(`${active.owner}|${path}`)
        }
        for (const item of removed) {
          const [owner, ...path] = item.split('|')
          refresh([path.join('|')], null, owner)
        }
        emitCondition('runtime.rotation.activeResonatorId', String(entry.next))
        refreshFieldConditions()
        releaseHeld()
        releaseRecipients()
        // resolve the outgoing action's remaining hit after the handoff.
        flushOutgoing(entry.owner, entry.frame)
      }
      continue
    }
    if (entry.type === 'status' && entry.stacks != null) {
      const sourceKey = entry.sourceActionId != null && entry.sourceInstance != null
        ? castKey({ owner: entry.owner, actionId: entry.sourceActionId,
          instance: entry.sourceInstance }) : null
      emitCondition(`enemy.combat.${entry.status}`, entry.stacks, null, sourceKey)
      continue
    }
    if (entry.type === 'effect') {
      const definition = combat.members.flatMap((member?: RuntimeValue): RuntimeValue => [
        ...(Object.entries(rulesets[member.resonatorId].effects) as [string, RuntimeValue][]),
        ...(Object.entries(member.weapon.effects) as [string, RuntimeValue][]),
        ...(Object.entries(member.echoes.main.effects ?? {}) as [string, RuntimeValue][]),
        ...(Object.entries(member.sonata.effects) as [string, RuntimeValue][]),
      ]).find(([id]: RuntimeValue): RuntimeValue => id === String(entry.effectId))?.[1]
      // apply the Tune Strain payout to every member with an Interfered response.
      if (definition?.name === 'Tune Strain - Interfered') {
        const interfered = entry.stacks > 0 && entry.until > entry.frame
        syncStrainResponses(interfered)
      }
      const specs: RuntimeValue = specsFor(entry)
      if (!specs) { omittedEffects.add(entry.effectId); continue }
      const effectKey = `${entry.owner}|${entry.effectId}|${entry.target}`
      const previous = activeEffects.get(effectKey)
      // a consumption event sets the current holder to zero and stamps its
      // `until` at this frame. Natural expiry is removed from activeEffects
      // above before this branch, so the previous holder is the lifetime check.
      const consumed = previous
        ? Math.max(0, previous.stacks - entry.stacks) : 0
      if (consumed > 0) {
        const hit = entry.sourceActionId != null && entry.sourceInstance != null
          ? { owner: entry.owner, actionId: entry.sourceActionId, instance: entry.sourceInstance }
          : lastHit && String(lastHit.owner) === String(entry.owner) ? lastHit : null
        for (const [path] of specs) {
          if (!isConsumedStackControl(path)) continue
          const featureIds = consumedFeatureIdsByPath.get(`${entry.owner}|${path}`)
          // a stack can be spent by unrelated teammate mechanics too. Attach
          // the delta only when this source hit emitted a feature whose
          // authored formula reads the control. a nonmatching hit must not
          // block the whole plan: the corresponding damage feature may be a
          // separate delayed action in the supplied timeline.
          if (featureIds && hit) attachConsumedToHit(hit, path, entry.owner, consumed, featureIds)
        }
      }
      if ((entry.stacks === 0 || entry.until <= entry.frame) && lastHit?.frame === entry.frame) {
        for (const [path] of specs) if (attachedControls.has(`${entry.owner}|${path}`)) attachToHit(lastHit, path, entry.owner)
      }
      if (entry.stacks === 0 || entry.until <= entry.frame) activeEffects.delete(effectKey)
      else activeEffects.set(effectKey, {
        ...entry, endsOnSwap: Boolean(entry.endsOnSwap || definition?.endsOn?.recipientSwap) })
      const sourceKey = entry.sourceActionId != null && entry.sourceInstance != null
        ? castKey({ owner: entry.owner, actionId: entry.sourceActionId,
          instance: entry.sourceInstance }) : null
      refresh(affectedPaths(entry).filter(path => !isConsumedStackControl(path)), sourceKey, entry.owner,
        definition?.recipient === 'incomingMember' && typeof entry.target === 'number' ? entry.target : null)
      continue
    }
    if (entry.type !== 'hit') continue
    if (entry.featureId) {
      flushHandoffOutros()
      addFeature(entry.owner, entry.featureId, entry.frame)
      continue
    }
    lastHit = entry
    const owner = entry.owner
    if (entry.hitKind) {
      const name = entry.hitKind.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`)
      const node = addFeature(owner, `damage:${owner}:negative-effect:${name}`, entry.frame)
      if (Number.isFinite(entry.negativeEffectStacks)) node.negativeEffectStacks = entry.negativeEffectStacks
      // Rage is an input of the existing Flare feature: keep the recorded component local and require a real
      // editor control
      const ragePath = 'enemy.combat.electroRage'
      if (entry.hitKind === 'electroFlare' && authorablePaths.has(ragePath)) {
        const rage = Number.isFinite(entry.negativeEffectAdditionalStacks) ? entry.negativeEffectAdditionalStacks : 0
        // stored status stacks are not a payout: only the paired Rage row belongs to this tick, and an unpaired tick skips
        // the persistent stacks
        if (rage !== (values.get(ragePath) ?? 0)) pendingAttachments.push({ nodeId: node.id, path: ragePath, owner: String(owner), value: rage })
      }
      continue
    }
    const key = castKey(entry)
    const sourceCast = castsByKey.get(key)
    if (findAction(rulesets, combat, owner, entry.actionId)?.cast === rulesets[owner].codes.cast.outro && sourceCast) {
      // apply incoming Intro field changes and active-member switching before
      // outgoing Outro damage; Discernment can end Stellarealm in this frame.
      if (!emittedCasts.has(key) && !handoffOutros.has(key)) {
        handoffOutros.set(key, { cast: sourceCast, frame: entry.frame })
      }
      continue
    }
    flushHandoffOutros()
    const damageStatusPath = entry.damageStatus ? `enemy.combat.${entry.damageStatus.key}` : null
    const previousStacks = damageStatusPath ? values.get(damageStatusPath) ?? 0 : null
    if (damageStatusPath) emitCondition(damageStatusPath, entry.damageStatus.stacks)
    if (!emittedCasts.has(key) && !attachedResponseCasts.has(key)) {
      const cast = castsByKey.get(key)
      if (!cast) throw new Error(`Hit has no source cast: ${key}`)
      emitCast(cast, entry.frame)
    }
    if (damageStatusPath) emitCondition(damageStatusPath, previousStacks)
  }
  releaseHeld()
  flushHandoffOutros()
  diagnostics.castCoverage = [...castsByKey].map(([key, cast]: [string, RuntimeValue]) => ({
    owner: cast.owner, action: cast.action, frame: cast.frame,
    resolvedHits: resolved.get(key)?.size ?? 0,
    emittedFeatures: castFeatureNodes.get(key)?.length ?? 0,
  }))
  diagnostics.omittedEffects = [...omittedEffects].sort()
  pendingAttachments.forEach(({ nodeId, path, owner, value }, index) => {
    const node = items.find((candidate: RuntimeValue) => candidate.id === nodeId)
    if (!node) return
    node.attached ??= { conditions: [], features: [] }
    if (node.attached.conditions.some((condition: RuntimeValue) => condition.changes?.some((change: RuntimeValue) =>
      change.path === path && String(change.resonatorId ?? condition.resonatorId) === String(owner)))) return
    node.attached.conditions.push({ id: freshId('attached-condition', index + 1), type: 'condition',
      resonatorId: owner, enabled: true, changes: [{ type: 'set', path, value, resonatorId: owner }] })
  })
  const compact = foldHitRuns(settleConsumedWindows(items, editor.activeOtherControls), editor.resonators)
  const repeats = foldRepeats(compact.items)
  diagnostics.foldedHits += compact.folded
  diagnostics.foldedRepeats = repeats.folded
  return { items: repeats.items, diagnostics }
}

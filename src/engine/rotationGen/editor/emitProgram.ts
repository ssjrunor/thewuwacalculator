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
function findHitFeature(features?: RuntimeValue, skillId?: RuntimeValue, action?: RuntimeValue, eventId?: RuntimeValue, owner?: RuntimeValue): RuntimeValue {
  const hits: RuntimeValue = action.events.filter((event?: RuntimeValue): RuntimeValue => event.damage &&
    eventAppliesToOwner(event, owner))
  const index: RuntimeValue = hits.findIndex((event?: RuntimeValue): RuntimeValue => String(event.id) === String(eventId))
  if (index < 0) return null
  const variants: RuntimeValue = features.filter((entry?: RuntimeValue): RuntimeValue => entry.skillId === skillId &&
    entry.variant === 'subHit').sort((a?: RuntimeValue, b?: RuntimeValue): RuntimeValue => a.hitIndex - b.hitIndex)
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
  const consumedPaths = new Set<string>((Object.values(editor.resonators) as RuntimeValue[]).flatMap(bundle =>
    (bundle.details?.stateGraph?.nodes ?? []).filter((node: RuntimeValue) =>
      node.kind !== 'toggle' && /\bconsumed\b/i.test(node.label ?? ''))
      .map((node: RuntimeValue) => `runtime.state.controls.${node.key}`)))
  const isConsumedStackControl = (path: string): boolean => /:consumed$/i.test(path) || consumedPaths.has(path)
  if (report.frame !== combat.maxFrames || report.failure) {
    throw new Error('Team replay did not reach the requested window legally')
  }
  if (!Array.isArray(report.trace)) throw new Error('Team report lacks ordered event trace')
  const effectControls = editor.effectControls ?? {}
  const specsFor = (active?: RuntimeValue): RuntimeValue => editor.memberEffectControls?.[active.owner]?.[active.effectId] ??
    effectControls[active.effectId]
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
    return [id, editor.resonators[id].source.features]
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
    const anchorIndex: RuntimeValue = items.findIndex((item?: RuntimeValue): RuntimeValue => item.id === anchorId)
    if (anchorIndex < 0) {
      items.push(node)
      return
    }
    items.splice(anchorIndex + 1, 0, node)
    castConditionTails.set(sourceKey, node.id)
  }
  // an Active Other buff turning on pins whoever is active as it is written, so one that turns on
  // at a handoff waits for the swap in its frame and is written just after it
  const heldForSwap: RuntimeValue = new Map()
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
  const emitCondition = (path?: RuntimeValue, value?: RuntimeValue, section?: RuntimeValue, sourceKey: RuntimeValue = null, sourceOwner: RuntimeValue = null): RuntimeValue => {
    if (!section && isConsumedStackControl(path)) return
    // sequence activation comes from the member build and has no editor control.
    // ignore derived sequence-control changes observed during replay.
    if (!section && /^runtime\.state\.controls\.sequence:\d+:s\d+:active$/.test(path)) return
    const owner = sourceOwner == null ? resolvePathOwner(path, combat.members) : String(sourceOwner)
    const key: RuntimeValue = `${owner}|${path}`
    if (!section && attachedControls.has(key)) return
    if (heldForSwap.has(key)) releaseHeld()
    if (!section && entryFrame >= 0 && !swappedThisFrame && value && editor.activeOtherControls?.has(key) && values.get(valueKey(path, owner)) !== value) {
      heldForSwap.set(key, [path, value, section, null, sourceOwner])
      return
    }
    writeCondition(path, value, section, sourceKey, sourceOwner)
  }
  // deduplicate writes by source-qualified path and reject any path missing from the editor's opening controls.
  const writeCondition = (path?: RuntimeValue, value?: RuntimeValue, section?: RuntimeValue, sourceKey: RuntimeValue = null, sourceOwner: RuntimeValue = null): RuntimeValue => {
    const owner = sourceOwner == null ? resolvePathOwner(path, combat.members) : String(sourceOwner)
    const key: RuntimeValue = valueKey(path, owner)
    if (path.startsWith('enemy.combat.') && editor.fixedStatuses?.has(path.slice('enemy.combat.'.length))) return
    if (!authorablePaths.has(key)) throw new UnauthorablePath(path)
    if (values.get(key) === value) return
    values.set(key, value)
    const node: RuntimeValue = { id: freshId('condition', items.length + 1), type: 'condition',
      ...(owner ? { resonatorId: owner } : {}), enabled: true,
      changes: [{ type: 'set', path, value, ...(owner ? { resonatorId: owner } : {}) }],
      ...(section ? { editorSection: section } : {}) }
    if (sourceKey) insertForCast(node, sourceKey)
    else items.push(node)
  }
  const resolved: RuntimeValue = new Map()
  const castKey = (entry?: RuntimeValue): RuntimeValue => `${entry.owner}|${entry.actionId}|${entry.instance}`
  // cast instance ids separate repeated uses of the same action and connect their landed hits to one feature group.
  const castsByKey: RuntimeValue = new Map(report.trace.filter((entry?: RuntimeValue): RuntimeValue => entry.type === 'cast')
    .map((entry?: RuntimeValue): RuntimeValue => [castKey(entry), entry]))
  const castControlSnapshots = new Map<string, Map<string, RuntimeValue>>()
  for (const entry of report.trace) {
    if (entry.type === 'hit' && entry.actionId != null) {
      const key: RuntimeValue = castKey(entry)
      if (!resolved.has(key)) resolved.set(key, new Set())
      resolved.get(key).add(String(entry.eventId))
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
  const effectValue = (path?: RuntimeValue, owner?: RuntimeValue, holders = activeEffects): RuntimeValue => {
    let result = null
    for (const active of holders.values()) {
      if (owner != null && String(active.owner) !== String(owner)) continue
      for (const [candidate, kind] of specsFor(active) ?? []) {
        if (candidate !== path) continue
        if (isConsumedStackControl(candidate)) continue
        const value = kind?.bitCount ? Math.min(kind.bitCount, [...(active.stacks >>> 0).toString(2)].filter(bit => bit === '1').length) :
          kind?.per ? Math.floor(active.stacks / kind.per) : kind === 'stacks' ? active.stacks :
          kind === 'conditionalSourceValue' ? active.conditionalSourceValue : kind
        result = result == null ? value :
          typeof value === 'boolean' ? Boolean(result) || value : Math.max(result, value)
      }
    }
    const opening = values.get(valueKey(path, owner))
    result ??= typeof opening === 'boolean' ? false : 0
    // a count held in a select (Dark Cores) is written as the option id the editor stores
    return typeof opening === 'string' && typeof result === 'number' ? String(result) : result
  }
  // long follow-up hits use equipment and native field state at each hit.
  // attach those states locally; reference gear stats are not imported.
  const resolvedHitControls = new Map<string, RuntimeValue[]>()
  const replayEffects = new Set<string>(), replayPaths = new Map<string, RuntimeValue>()
  for (const member of combat.members) {
    const owner = member.resonatorId
    const gearEffects = { ...member.weapon.effects, ...member.echoes.main.effects, ...member.sonata.effects }
    const effects = { ...gearEffects, ...Object.fromEntries(Object.entries(rulesets[owner].effects)
      .filter(([, effect]: RuntimeValue) => effect.replayLifecycle || effect.duration != null && effect.maxStacks === 1)) }
    for (const effectId of Object.keys(effects)) {
      // handoff toggles select a recipient when activated. keep later hits on
      // the existing handoff path to preserve that recipient.
      if (!['self', 'team', 'enemy'].includes(effects[effectId].recipient ?? 'self')) continue
      replayEffects.add(`${owner}|${effectId}`)
      for (const [path] of specsFor({ owner, effectId }) ?? []) if (!isConsumedStackControl(path) && authorablePaths.has(valueKey(path, owner))) {
        const previous = replayPaths.get(valueKey(path, owner))
        replayPaths.set(valueKey(path, owner), { owner, path,
          clearOnly: (previous?.clearOnly ?? true) && !gearEffects[effectId] && !effects[effectId].replayLifecycle,
          selfOnly: (previous?.selfOnly ?? true) && effects[effectId].recipient === 'self' })
      }
    }
  }
  // capture equipment and timed-field state at each hit so long follow-ups can use their hit-time conditions.
  const replayHolders = new Map<string, RuntimeValue>()
  for (const entry of report.trace) {
    for (const [key, holder] of replayHolders) if (holder.until <= entry.frame) replayHolders.delete(key)
    if (entry.type === 'effect' && replayEffects.has(`${entry.owner}|${entry.effectId}`)) {
      const key = `${entry.owner}|${entry.effectId}|${entry.target}`
      if (entry.stacks <= 0 || entry.until <= entry.frame) replayHolders.delete(key)
      else replayHolders.set(key, entry)
    }
    if (entry.type === 'hit' && entry.actionId != null) resolvedHitControls.set(`${castKey(entry)}|${entry.eventId}`,
      [...replayPaths.values()].map(({ owner, path, selfOnly, clearOnly }) => ({ owner, path, selfOnly, clearOnly,
        value: effectValue(path, owner, replayHolders) })))
  }
  const refresh = (paths?: RuntimeValue, sourceKey: RuntimeValue = null, owner: RuntimeValue = null): RuntimeValue => {
    for (const path of paths) {
      if (isConsumedStackControl(path)) continue
      emitCondition(path, effectValue(path, owner), null, sourceKey, owner)
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
    // a finisher can consume its stance before its hit snapshot; attach the
    // pre-cast stance only to features whose availability reads it.
    const addBoundFeature = (id: string, multiplier = 1, eventId: RuntimeValue = null): RuntimeValue => {
      const node = addFeature(owner, id, frame, multiplier, attachment)
      const source = editor.resonators[String(owner)]?.source
      const feature = source?.features.find((candidate: RuntimeValue) => candidate.id === id)
      const skill = source?.skills?.find((candidate: RuntimeValue) => candidate.id === feature?.skillId)
      const gates = new Set<string>()
      const visit = (condition: RuntimeValue): void => {
        if (!condition || typeof condition !== 'object') return
        if (condition.from === 'sourceRuntime' && condition.path?.startsWith('state.controls.')) {
          gates.add(`runtime.${condition.path}`)
        }
        for (const child of Object.values(condition)) {
          if (Array.isArray(child)) child.forEach(visit)
          else if (child && typeof child === 'object') visit(child)
        }
      }
      visit(skill?.visibleWhen)
      visit(skill?.skillTypeWhen)
      // cast-scoped bonuses can read a consumed stance without a feature gate,
      // including Denia's Banish.
      for (const effect of source?.effects ?? []) if ((effect.operations ?? []).some((operation: RuntimeValue) =>
        operation.match?.skillIds?.includes(feature?.skillId))) visit(effect.condition)
      for (const spent of entry.spentEffects ?? []) for (const [path, kind] of specsFor(spent) ?? []) {
        const consumedInput = isConsumedStackControl(path) &&
          consumedFeatureIdsByPath.get(`${spent.owner}|${path}`)?.has(id)
        if ((!gates.has(path) && !consumedInput) || !authorablePaths.has(valueKey(path, spent.owner))) continue
        const value = consumedInput ? spent.consumed :
          kind?.per ? Math.floor(spent.stacks / kind.per) : kind === 'stacks' ? spent.stacks : kind
        node.attached ??= { conditions: [], features: [] }
        node.attached.conditions.push({ id: `${node.id}:availability:${node.attached.conditions.length}`,
          type: 'condition', enabled: true, resonatorId: String(spent.owner),
          changes: [{ type: 'set', path, value, resonatorId: String(spent.owner) }] })
      }
      for (const path of gates) {
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
      const hitIndex = damageEvents.findIndex((event: RuntimeValue) => String(event.id) === String(eventId))
      const longFollowup = Math.min(...damageEvents.map((event: RuntimeValue) => event.at ?? 0)) > LATE_HIT_FRAMES
      // short tails keep prescribed cast order. clear timed fields and gear at
      // the first hit after expiry without applying buffs from later casts.
      const replayControls = resolvedHitControls.get(`${key}|${eventId}`) ?? []
      const hitControls = [...replayControls.filter((change: RuntimeValue) =>
        longFollowup && !change.clearOnly || change.value === false || change.value === 0 || change.value === '0'),
        ...(entry.hitControls ?? []).filter((change: RuntimeValue) => change.hit === hitIndex)]
      for (const change of hitControls) {
        if (change.selfOnly && String(change.owner) !== String(owner) || isConsumedStackControl(change.path) ||
          !authorablePaths.has(valueKey(change.path, change.owner))) continue
        // cast-time availability remains valid when a finisher consumes its stance.
        if (node.attached?.conditions.some((condition: RuntimeValue) => condition.changes?.some((prior: RuntimeValue) =>
          prior.path === change.path && String(prior.resonatorId ?? condition.resonatorId) === String(change.owner)))) continue
        const current = values.get(valueKey(change.path, change.owner))
        const value = typeof current === 'string' && typeof change.value === 'number' ? String(change.value) : change.value
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
      if (resolvedHits.length === expected.length) {
        featureNodeIds.push(addBoundFeature(parent).id)
        diagnostics.foldedHits += Math.max(0, resolvedHits.length - 1)
      } else {
        const partials: RuntimeValue = resolvedHits.map((hit?: RuntimeValue): RuntimeValue =>
          findHitFeature(features[String(owner)], skillId, action, hit.id, Number(owner)))
        if (partials.every(Boolean)) {
          for (const partial of partials) {
            featureNodeIds.push(addBoundFeature(partial).id)
            diagnostics.partialHitFeatures++
          }
        } else {
          // the reference's share of a cut-short cast covers the whole action, so only one skill
          const share = ids.length === 1 ? entry.share : undefined
          const exactSelection = Array.isArray(entry.landedIndices)
          if (share == null && !exactSelection && (partials.some(Boolean) || !action.uniformHits)) {
            throw new Error(`No partial hit feature for ${owner} ${skillId}`)
          }
          // some authored actions expose only an aggregate editor feature. Scale it by the
          // multiplier share that landed, or (every hit alike) by the resolved hit fraction. An
          // exact sparse event selection already restricts the feature to the landed events.
          featureNodeIds.push(addBoundFeature(parent,
            share ?? (exactSelection ? 1 : resolvedHits.length / expected.length)).id)
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
  // a member's own cast whose hits land just after they swap out (a skill the Outro cancels) keeps
  // its place in the rotation: it is written before the swap, as the reference reads it. a long
  // follow-up (a field, a coordinated attack) still lands where it lands.
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
      const first = Math.min(...(action?.events ?? []).filter((event: RuntimeValue) => event.damage).map((event: RuntimeValue) => event.at ?? 0))
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
      for (const [path] of specsFor(active) ?? []) expired.add(`${active.owner}|${path}`)
    }
    for (const item of expired) {
      const [owner, ...path] = item.split('|')
      refresh([path.join('|')], null, owner)
    }
    if (entry.type === 'swap') {
      emitCondition('runtime.rotation.activeResonatorId', String(entry.to))
      releaseHeld()
      // write Active Other now; later effects in this frame use the incoming member.
      swappedThisFrame = true
      // write handoff field changes before resolving late outgoing hits.
      if (entry.from != null) flushOutgoing(entry.from, entry.frame)
      continue
    }
    if (entry.type === 'control') {
      if (!superseded.has(entry)) emitCondition(entry.path, entry.value, null, null, entry.owner)
      continue
    }
    if (entry.type === 'cast') {
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
          for (const [path] of specsFor(active) ?? []) removed.add(`${active.owner}|${path}`)
        }
        for (const item of removed) {
          const [owner, ...path] = item.split('|')
          refresh([path.join('|')], null, owner)
        }
        emitCondition('runtime.rotation.activeResonatorId', String(entry.next))
        releaseHeld()
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
        for (const member of combat.members) for (const path of rulesets[member.resonatorId].strainPayoutControls ?? []) {
          emitCondition(`runtime.state.controls.${path}`, interfered, null, null, member.resonatorId)
        }
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
      refresh(specs.filter(([path]: RuntimeValue): RuntimeValue => !isConsumedStackControl(path))
        .map(([path]: RuntimeValue): RuntimeValue => path), sourceKey, entry.owner)
      continue
    }
    if (entry.type !== 'hit') continue
    lastHit = entry
    const owner = entry.owner
    if (entry.hitKind) {
      const name = entry.hitKind.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`)
      const node = addFeature(owner, `damage:${owner}:negative-effect:${name}`, entry.frame)
      if (Number.isFinite(entry.negativeEffectStacks)) node.negativeEffectStacks = entry.negativeEffectStacks
      continue
    }
    const key = castKey(entry)
    const sourceCast = castsByKey.get(key)
    if (findAction(rulesets, combat, owner, entry.actionId)?.cast === rulesets[owner].codes.cast.outro && sourceCast) {
      // apply incoming Intro field changes and active-member switching before
      // outgoing Outro damage; Discernment can end Stellarealm in this frame.
      if (!emittedCasts.has(key) && !handoffOutros.has(key)) {
        flushOutgoing(owner, entry.frame, sourceCast)
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

/*
  Author: Runor Ewhro
  description: constructs and edits the advanced editor's working node model.
*/

import type {
  RotationNode,
  RtChng,
  RuntimeValue,
  SourceState,
} from '@/domain/gameData/contracts.ts'
import { openingConditionChoices } from '@/domain/gameData/rotationPreambleDefaults.ts'
import type { SkillAggType } from '@/domain/entities/stats.ts'
import type { PaletteSpec } from './paletteSpec.ts'
import { writesFromChanges } from './conditionWrites.ts'
import type {
  ConditionWriteAction,
  EditorCondition,
  EditorHandoff,
  EditorNode,
  EditorSection,
  EditorStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { changeFromRegValue } from '@/modules/simulation/surfaces/rotation/program-editor/model/toRotationNodes.ts'
import {
  findNode,
  makeCondition,
  makeStep,
  nextNodeId,
  removeNode,
  replaceNodeWith,
  updateStep,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/treeEdit.ts'
import {
  condActionFromChange,
  getCondChoice,
  makeCondChange,
  makeCondValue,
  makeRawCondition,
  normFeatCond,
} from '@/modules/simulation/surfaces/rotation/shared/conditions.ts'
import type {
  CondChoice,
  RotationMember,
  RotationConditionValue,
  SkillMenuEntry,
} from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import { getSubHitLbl } from '@/modules/simulation/surfaces/rotation/shared/nodeTools.ts'
import { skillDisplayColor } from '@/modules/simulation/surfaces/rotation/shared/skillDisplay.ts'
import {
  ACTIVE_RESONATOR_PATH,
} from '@/domain/gameData/rotationPaths.ts'
import { regTextValue } from '@/modules/simulation/surfaces/rotation/program-editor/model/registerValues.ts'

function regChangeValue(change: RtChng): string {
  return regTextValue(change.value)
}

export function makeFeatureNode(entry: {
  label: string
  resonatorId?: string
  featureId: string
  tab: string
  color?: string
  aggregationType?: SkillAggType
  echoId?: string
}, focusedId: string, members: readonly RotationMember[] = []): EditorStep {
  const memberId = entry.resonatorId || focusedId
  return withTeamTuneBreakResponses({
    ...makeStep(entry.label, memberId),
    owner: entry.echoId
      ? { kind: 'echo', echoId: entry.echoId }
      : { kind: 'member', memberId },
    featureId: entry.featureId,
    memberId,
    kindLabel: entry.tab,
    color: entry.color,
    aggregationType: entry.aggregationType,
    // palette entries carry the skill tab, so a negative-effect add shows the
    // series section before the next run re-projects the step
    negEffect: entry.tab === 'negativeEffect',
  }, members)
}

/**
 * responses remain ordinary editable attachments. do not filter visibleWhen
 * here: a mode condition earlier in the program can differ from the build's
 * current mode, and the executor checks the response at the actual break.
 */
function withTeamTuneBreakResponses(
  step: EditorStep,
  members: readonly RotationMember[],
): EditorStep {
  if (step.kindLabel !== 'tuneBreak') return step

  const attached = [...(step.attached ?? [])]
  const existing = new Set(attached.map((child) => `${child.memberId}:${child.featureId}`))
  for (const member of members) {
    for (const feature of member.features) {
      if (feature.variant === 'subHit' || feature.source.type !== 'resonator') continue
      const skill = member.skills.find((candidate) => candidate.id === feature.skillId)
      if (skill?.triggeredBy !== 'teamTuneBreak') continue
      const key = `${member.id}:${feature.id}`
      if (existing.has(key)) continue
      existing.add(key)
      attached.push({
        ...makeFeatureNode({
          label: skill.label,
          resonatorId: member.id,
          featureId: feature.id,
          tab: skill.tab,
          color: skillDisplayColor(skill),
          aggregationType: skill.aggregationType,
        }, member.id),
        element: skill.element,
      })
    }
  }
  return attached.length === (step.attached?.length ?? 0)
    ? step
    : { ...step, attached, attachedEdited: true }
}

function isTeamTuneBreakResponse(step: EditorStep, members: readonly RotationMember[]): boolean {
  const member = members.find((candidate) => candidate.id === step.memberId)
  const feature = member?.features.find((candidate) => candidate.id === step.featureId)
  return member?.skills.some((skill) => skill.id === feature?.skillId && skill.triggeredBy === 'teamTuneBreak') ?? false
}

export function makeConditionNode(
  choice: CondChoice,
  focusedId = choice.resonatorId,
  seedValue?: RotationConditionValue,
  previousValue?: RuntimeValue,
): EditorCondition | EditorHandoff {
  const node = makeConditionFromChange(
    makeCondChange(choice, 'set', seedValue ?? makeCondValue(choice.state)),
    {
      condChoices: [choice],
      focusedId,
    },
  )

  return node.type === 'swap' && previousValue !== undefined
    ? { ...node, from: String(previousValue) }
    : node
}

/**
 * states worth writing before the rotation starts. three kinds are left out:
 * the active resonator, which the generated handoff sets at the end; the
 * per-state target routing, which belongs to routing; and
 * the rotation formula modifiers, which are one pseudo-state standing for a
 * whole group.
 */
function isActiveResonatorNode(
  node: EditorNode,
): boolean {
  return node.type === 'swap'
    || (node.type === 'condition' && node.path === ACTIVE_RESONATOR_PATH)
}

function lastActiveResonatorNode(nodes: EditorNode[]): EditorCondition | EditorHandoff | undefined {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index]
    if (node && isActiveResonatorNode(node)) {
      return node.type === 'condition' || node.type === 'swap' ? node : undefined
    }
  }
  return undefined
}

/** one state the preamble will write, already read for display. */
export interface OpeningState {
  key: string
  resonatorId: string
  label: string
  sourceName: string
  /** the value the generated condition sets, as the register rows spell it */
  value: string
}

/**
 * the opening states in the order the preamble writes them, one per state a
 * resonator has. shares the key the generator dedupes on so a preview and the
 * written block can never disagree about how many there are.
 */
export function openingStates(condChoices: CondChoice[]): OpeningState[] {
  const states: OpeningState[] = []

  for (const choice of openingConditionChoices(condChoices)) {
    const key = `${choice.resonatorId}:${choice.state.path}`
    states.push({
      key,
      resonatorId: choice.resonatorId,
      label: choice.label,
      sourceName: choice.sourceName,
      value: regTextValue(makeCondValue(choice.state)),
    })
  }

  return states
}

export function countOpeningStates(condChoices: CondChoice[]): number {
  return openingStates(condChoices).length
}

/**
 * every opening state at its default value, then a handoff to whoever starts.
 * paths the preamble already writes are skipped and a trailing handoff is
 * replaced, so running this twice does not double what it produced.
 */
export function buildPreambleEntries({
  condChoices,
  existing,
  activeId,
  startId,
}: {
  condChoices: CondChoice[]
  existing: EditorNode[]
  activeId: string
  startId: string
}): EditorNode[] {
  const previousHandoff = lastActiveResonatorNode(existing)
  const kept = existing.filter((node) => !isActiveResonatorNode(node))

  const written = new Set(
    kept.flatMap((node) => (
      node.type === 'condition' && node.path
        ? [`${node.owner.kind === 'member' ? node.owner.memberId : ''}:${node.path}`]
        : []
    )),
  )

  const added: EditorCondition[] = []
  for (const choice of openingConditionChoices(condChoices)) {
    const key = `${choice.resonatorId}:${choice.state.path}`
    if (written.has(key)) {
      continue
    }
    written.add(key)
    const node = makeConditionNode(choice)
    if (node.type === 'condition') added.push(node)
  }

  const sourceNode = previousHandoff?.sourceNode?.type === 'condition'
    ? previousHandoff.sourceNode
    : undefined
  const sourceTo = sourceNode?.changes.find(
    (change) => change.path === ACTIVE_RESONATOR_PATH,
  )?.value
  const handoff: EditorHandoff = {
    type: 'swap',
    id: previousHandoff?.id ?? nextNodeId('swap'),
    from: activeId,
    to: startId,
    ...(sourceNode ? { sourceNode } : {}),
    ...(sourceNode && String(sourceTo ?? '') !== startId ? { toEdited: true } : {}),
    ...(previousHandoff?.attachedNote
      ? { attachedNote: previousHandoff.attachedNote }
      : {}),
    ...(previousHandoff?.noteEdited !== undefined
      ? { noteEdited: previousHandoff.noteEdited }
      : {}),
  }

  return [...kept, ...added, handoff]
}

export function makePaletteNode(
  payload: PaletteSpec,
  focusedId: string,
  condChoices: CondChoice[],
  seedValue?: (choice: CondChoice) => RotationConditionValue,
  previousValue?: (choice: CondChoice) => RuntimeValue | undefined,
  members: readonly RotationMember[] = [],
): EditorStep | EditorCondition | EditorHandoff | null {
  if (payload.kind === 'step') {
    return makeFeatureNode(payload, focusedId, members)
  }

  const choice = condChoices.find((entry) => entry.id === payload.choiceId)
  return choice
    ? makeConditionNode(choice, focusedId, seedValue?.(choice), previousValue?.(choice))
    : null
}

function makeConditionFromChange(
  change: RtChng,
  options: {
    condChoices: CondChoice[]
    focusedId: string
    id?: string
    changeIndex?: number
    previous?: EditorCondition | EditorHandoff | null
    fallbackResId?: string
  },
): EditorCondition | EditorHandoff {
  const rotationNode = makeRawCondition(change, options.condChoices, nextNodeId, {
    id: options.id,
    enabled: !(options.previous?.disabled ?? false),
    fallbackResId: options.fallbackResId,
  })
  const nodeChange = rotationNode.changes[0] ?? change
  const choice = getCondChoice(options.condChoices, nodeChange, options.fallbackResId)
  const previousCondition = options.previous?.type === 'condition'
    ? options.previous
    : null
  const memberId = rotationNode.resonatorId
    ?? nodeChange.resonatorId
    ?? choice?.resonatorId
    ?? (previousCondition?.owner.kind === 'member'
      ? previousCondition.owner.memberId
      : options.focusedId)
  const value = regChangeValue(nodeChange)
  const from = previousCondition?.from
  const previousSource = options.previous?.sourceNode?.type === 'condition'
    ? options.previous.sourceNode
    : null
  const samePath = previousSource?.changes[0]?.path === nodeChange.path
  const authoredLabel = samePath && previousSource?.label !== choice?.label
    ? previousSource?.label
    : undefined
  const label = authoredLabel
    ?? choice?.label
    ?? (previousCondition?.path === nodeChange.path ? previousCondition.label : undefined)
    ?? nodeChange.path.split('.').pop()
    ?? 'Condition'
  const base = makeCondition(label, memberId)
  const sourceNode: Extract<RotationNode, { type: 'condition' }> = previousSource
    ? {
      ...previousSource,
      id: rotationNode.id,
      resonatorId: rotationNode.resonatorId,
      changes: [nodeChange],
    }
    : rotationNode
  if (previousSource && !samePath) delete sourceNode.label

  if (nodeChange.path === ACTIVE_RESONATOR_PATH) {
    return {
      type: 'swap',
      id: rotationNode.id,
      from: options.previous?.type === 'swap' ? options.previous.from : options.focusedId,
      to: String(nodeChange.value ?? ''),
      sourceNode,
      disabled: options.previous?.disabled,
      ...(options.previous?.attachedNote
        ? { attachedNote: options.previous.attachedNote }
        : {}),
      ...(options.previous?.noteEdited !== undefined
        ? { noteEdited: options.previous.noteEdited }
        : {}),
    }
  }

  return {
    ...base,
    id: rotationNode.id,
    sourceNode,
    owner: { kind: 'member', memberId },
    label,
    path: nodeChange.path,
    sourceName: choice?.sourceName,
    effectName: choice?.effectName,
    state: choice?.state,
    description: choice?.description,
    descriptionParams: choice?.dscrPrms,
    ...(from !== undefined ? { from } : {}),
    to: value,
    writeValue: nodeChange.value,
    writeAction: condActionFromChange(nodeChange),
    rising: from !== undefined && (
      value === 'on' || (from !== '' && value !== '' && Number(value) > Number(from))
    ),
    disabled: options.previous?.disabled,
    change: nodeChange,
  }
}

export function applyConditionChanges(
  sections: EditorSection[],
  nodeId: string,
  changes: RtChng[],
  options: {
    condChoices: CondChoice[]
    focusedId: string
    fallbackResId: string
  },
): { sections: EditorSection[]; selectedId: string | null } {
  const previous = findNode(sections, nodeId)
  const previousCondition = previous?.type === 'condition' || previous?.type === 'swap'
    ? previous
    : null
  if (changes.length === 0) {
    return { sections: removeNode(sections, nodeId), selectedId: null }
  }

  const nodes = changes.map((change, index) => makeConditionFromChange(change, {
    condChoices: options.condChoices,
    focusedId: options.focusedId,
    id: index === 0 ? nodeId : undefined,
    changeIndex: index,
    previous: previousCondition,
    fallbackResId: options.fallbackResId,
  }))

  return {
    sections: replaceNodeWith(sections, nodeId, nodes),
    selectedId: nodes[0]?.id ?? null,
  }
}

export function applyFeatureSelection(
  sections: EditorSection[],
  nodeId: string,
  entry: SkillMenuEntry,
  members: readonly RotationMember[] = [],
): EditorSection[] {
  return updateStep(sections, nodeId, (step) => {
    const leavingTuneBreak = step.kindLabel === 'tuneBreak' && entry.skill.tab !== 'tuneBreak'
    const attached = leavingTuneBreak
      ? step.attached?.filter((child) => !isTeamTuneBreakResponse(child, members))
      : step.attached
    return withTeamTuneBreakResponses({
      ...step,
      owner: { kind: 'member', memberId: entry.resonatorId },
      ownerEdited: true,
      memberId: entry.resonatorId,
      featureId: entry.featureId,
      label: entry.variant === 'subHit' ? getSubHitLbl(entry) : entry.skill.label,
      kindLabel: entry.skill.tab,
      element: entry.skill.element,
      color: skillDisplayColor(entry.skill),
      aggregationType: entry.skill.aggregationType,
      damageByRun: {},
      statsByRun: {},
      writesByRun: undefined,
      gate: undefined,
      ...(attached !== step.attached ? { attached, attachedEdited: true } : {}),
    }, members)
  })
}

export function applyFeatureConditionChanges(
  sections: EditorSection[],
  nodeId: string,
  changes: RtChng[],
  condChoices: CondChoice[],
): EditorSection[] {
  return updateStep(sections, nodeId, (step) => {
    const {
      changes: _removed,
      attachedChangesByRun: _attachedChangesByRun,
      ...feature
    } = step
    void _removed
    void _attachedChangesByRun
    return {
      ...feature,
      // editor keeps a flat working list; serialize folds it into attached.conditions
      ...(changes.length > 0 ? { changes } : {}),
      changesEdited: true,
      /*
        the per-run writes belonged to the changes being replaced. the new ones
        have not been run, so they are held aside as authored until a run
        produces the real thing.
      */
      writesByRun: undefined,
      pendingWrites: writesFromChanges(changes, condChoices, nodeId, step.memberId),
    }
  })
}

/** one state write attached to a step, in the terms the inspector edits it */
export interface AttachedWrite {
  /** position in the step's authored changes, which is what an edit addresses */
  index: number
  label: string
  sourceName?: string
  /** absent when nothing in the catalog claims the path this change writes */
  state?: SourceState
  /** the authored value in display form, which is what the controls speak */
  value: string
  action: ConditionWriteAction
  rising: boolean
}

function attachedChanges(step: EditorStep | null | undefined): RtChng[] {
  if (!step) {
    return []
  }

  return step.changes ?? []
}

export function attachedWritesOf(
  step: EditorStep | null | undefined,
  condChoices: CondChoice[],
): AttachedWrite[] {
  return attachedChanges(step).map((change, index) => {
    const choice = getCondChoice(condChoices, change, step?.memberId)
    const value = regChangeValue(change)
    return {
      index,
      label: choice?.label ?? change.path.split('.').pop() ?? 'State',
      sourceName: choice?.sourceName,
      state: choice?.state,
      value,
      action: condActionFromChange(change) ?? 'set',
      rising: value === 'on' || Number(value) > 0,
    }
  })
}

function editAttachedWrites(
  sections: EditorSection[],
  nodeId: string,
  condChoices: CondChoice[],
  edit: (changes: RtChng[], step: EditorStep) => RtChng[],
): EditorSection[] {
  const step = findNode(sections, nodeId)
  if (step?.type !== 'step') {
    return sections
  }

  const changes = edit(attachedChanges(step), step)
  return applyFeatureConditionChanges(sections, nodeId, changes, condChoices)
}

export function setAttachedWriteValue(
  sections: EditorSection[],
  nodeId: string,
  index: number,
  value: string,
  condChoices: CondChoice[],
): EditorSection[] {
  return editAttachedWrites(sections, nodeId, condChoices, (changes, step) =>
    changes.map((change, at) => (
      at === index
        ? changeFromRegValue(
          change,
          getCondChoice(condChoices, change, step.memberId)?.state,
          value,
        )
        : change
    )))
}

export function setAttachedWriteAction(
  sections: EditorSection[],
  nodeId: string,
  index: number,
  action: ConditionWriteAction,
  condChoices: CondChoice[],
): EditorSection[] {
  return editAttachedWrites(sections, nodeId, condChoices, (changes, step) =>
    changes.map((change, at) => {
      if (at !== index) {
        return change
      }

      const choice = getCondChoice(condChoices, change, step.memberId)
      return changeFromRegValue(
        change,
        choice?.state,
        regChangeValue(change),
        normFeatCond(action, choice),
      )
    }))
}

export function removeAttachedWrite(
  sections: EditorSection[],
  nodeId: string,
  index: number,
  condChoices: CondChoice[],
): EditorSection[] {
  return editAttachedWrites(sections, nodeId, condChoices, (changes) =>
    changes.filter((_change, at) => at !== index))
}

/*
  Author: Runor Ewhro
  Description: Materializes compact resonator state graph nodes into UI controls
               and source states used by the calculator runtime.
*/

import type {
  ResDtls,
  ResModeGroup,
  ResStateControl,
  ResStateGroup,
  ResStateNode,
} from '@/domain/entities/resonator'
import type { SourceState } from '@/domain/gameData/contracts'

const EMPTY_CONTROLS: ResStateControl[] = []
const EMPTY_STATES: SourceState[] = []

function getNodeMap(details?: ResDtls | null): Map<string, ResStateNode> {
  return new Map((details?.stateGraph?.nodes ?? []).map((node) => [node.key, node]))
}

export function getResStateGroups(details?: ResDtls | null): ResStateGroup[] {
  return details?.stateGraph?.groups ?? []
}

export function getResModeGroups(details?: ResDtls | null): ResModeGroup[] {
  const graphGroups = getResStateGroups(details)
    .filter((group) => group.controlKey && group.modes?.length)
    .map((group) => ({
      id: group.id,
      label: group.label ?? 'Mode',
      controlKey: String(group.controlKey),
      defaultValue: String(group.defaultValue ?? group.modes?.[0]?.id ?? ''),
      ...(group.allowNone === undefined ? {} : { allowNone: group.allowNone }),
      modes: group.modes ?? [],
    }))

  return graphGroups.length > 0 ? graphGroups : details?.modeGroups ?? []
}

export function getResStateResetKeys(details: ResDtls | null | undefined, controlKey: string): string[] {
  const group = getResStateGroups(details)
    .find((entry) => entry.members?.includes(controlKey))

  return group?.members?.filter((key) => key !== controlKey) ?? []
}

function nodeToControl(details: ResDtls, node: ResStateNode): ResStateControl {
  const resets = getResStateResetKeys(details, node.key)

  return {
    key: node.key,
    label: node.label,
    kind: node.kind,
    target: 'controls',
    ...(node.defaultValue === undefined ? {} : { defaultValue: node.defaultValue }),
    ...(node.maxValue === undefined ? {} : { maxValue: node.maxValue }),
    ...(node.disabledReason ? { disabledReason: node.disabledReason } : {}),
    ...(node.unlockWhen ? { visibleWhen: node.unlockWhen } : {}),
    ...(node.enabledWhen ? { enabledWhen: node.enabledWhen } : {}),
    ...(node.requires?.length ? { controlDependencies: node.requires } : {}),
    ...(node.displayScope === 'both' ? { displayScope: 'team' as const } : node.displayScope ? { displayScope: node.displayScope } : {}),
    ...(resets.length ? { resets } : {}),
    ...(node.min === undefined ? {} : { min: node.min }),
    ...(node.max === undefined ? {} : { max: node.max }),
    ...(node.step === undefined ? {} : { step: node.step }),
    ...(node.options ? { options: node.options } : {}),
    ...(node.optionsWhen ? { optionsWhen: node.optionsWhen } : {}),
    ...(node.sequenceAwareOptions ? { sequenceAwareOptions: node.sequenceAwareOptions } : {}),
    ...(node.maxWhen ? { maxWhen: node.maxWhen } : {}),
    ...(node.displayMultiplier === undefined ? {} : { displayMultiplier: node.displayMultiplier }),
    ...(node.inputMax === undefined ? {} : { inputMax: node.inputMax }),
  }
}

export function getResStateControls(
  details: ResDtls | null | undefined,
  stateKeys?: string[],
): ResStateControl[] {
  if (!details) {
    return EMPTY_CONTROLS
  }

  if (!details.stateGraph) {
    if (!stateKeys) {
      return [
        ...(details.modeGroups ?? []).map((group) => ({
          key: group.controlKey,
          label: group.label,
          kind: 'select' as const,
          target: 'controls' as const,
          defaultValue: group.defaultValue,
          options: group.modes.map((mode) => ({ id: mode.id, label: mode.label })),
        })),
        ...details.inherentSkills.flatMap((entry) => entry.control ? [entry.control] : []),
        ...details.statePanels.flatMap((panel) => panel.controls ?? []),
        ...details.resonanceChains.flatMap((entry) => entry.controls ?? []),
      ]
    }

    const allControls = getResStateControls(details)
    const ctrlsByKey = new Map(allControls.map((control) => [control.key, control]))
    return stateKeys.map((key) => ctrlsByKey.get(key)).filter((control): control is ResStateControl => Boolean(control))
  }

  const nodesByKey = getNodeMap(details)
  const keys = stateKeys ?? details.stateGraph.nodes.map((node) => node.key)

  return keys
    .map((key) => nodesByKey.get(key))
    .filter((node): node is ResStateNode => Boolean(node))
    .map((node) => nodeToControl(details, node))
}

export function getResPanelControls(details: ResDtls | null | undefined, panel: ResDtls['statePanels'][number]): ResStateControl[] {
  return getResStateControls(details, panel.stateKeys ?? panel.controls?.map((control) => control.key) ?? [])
}

function getAttachedKeys(details: ResDtls): Set<string> {
  const keys = new Set<string>()

  for (const group of getResModeGroups(details)) {
    keys.add(group.controlKey)
  }

  for (const panel of details.statePanels) {
    for (const key of panel.stateKeys ?? panel.controls?.map((control) => control.key) ?? []) {
      keys.add(key)
    }
  }

  for (const inherent of details.inherentSkills) {
    for (const key of inherent.stateKeys ?? (inherent.control ? [inherent.control.key] : [])) {
      keys.add(key)
    }
  }

  for (const chain of details.resonanceChains) {
    for (const key of chain.stateKeys ?? chain.controls?.map((control) => control.key) ?? []) {
      keys.add(key)
    }
  }

  return keys
}

export function getLooseResCtrls(details: ResDtls | null | undefined): ResStateControl[] {
  if (!details) {
    return EMPTY_CONTROLS
  }

  const attachedKeys = getAttachedKeys(details)

  return getResStateControls(details)
    .filter((control) =>
      !attachedKeys.has(control.key)
      && control.displayScope !== 'team',
    )
}

export function getResInherentControls(details: ResDtls | null | undefined, inherent: ResDtls['inherentSkills'][number]): ResStateControl[] {
  return getResStateControls(details, inherent.stateKeys ?? (inherent.control ? [inherent.control.key] : []))
}

export function getResChainControls(details: ResDtls | null | undefined, chain: ResDtls['resonanceChains'][number]): ResStateControl[] {
  return getResStateControls(details, chain.stateKeys ?? chain.controls?.map((control) => control.key) ?? [])
}

export function getResStateNodes(details: ResDtls | null | undefined): ResStateNode[] {
  return details?.stateGraph?.nodes ?? []
}

function nodeToState(resonatorId: string, details: ResDtls, node: ResStateNode): SourceState {
  const resets = getResStateResetKeys(details, node.key)

  return {
    id: node.id,
    label: node.label,
    source: {
      type: 'resonator',
      id: resonatorId,
    },
    ownerKey: node.ownerKey,
    controlKey: node.key,
    path: `runtime.state.controls.${node.key}`,
    ...(resets.length ? { resets } : {}),
    ...(node.requires?.length ? { requires: node.requires, controlDependencies: node.requires } : {}),
    ...(node.groupId ? { groupId: node.groupId } : {}),
    ...(node.displayScope ? { displayScope: node.displayScope } : {}),
    kind: node.kind,
    ...(node.defaultValue === undefined ? {} : { defaultValue: node.defaultValue }),
    ...(node.maxValue === undefined ? {} : { maxValue: node.maxValue }),
    ...(node.min === undefined ? {} : { min: node.min }),
    ...(node.max === undefined ? {} : { max: node.max }),
    ...(node.options ? { options: node.options.map((option) => {
      if (typeof option === 'object') {
        return { id: String(option.id), label: option.label }
      }

      return { id: String(option), label: String(option) }
    }) } : {}),
    ...(node.optionsWhen ? { optionsWhen: node.optionsWhen.map((optionSet) => ({
      when: optionSet.when,
      options: optionSet.options.map((option) => {
        if (typeof option === 'object') {
          return { id: String(option.id), label: option.label }
        }

        return { id: String(option), label: String(option) }
      }),
    })) } : {}),
    ...(node.maxWhen ? { maxWhen: node.maxWhen } : {}),
    ...(node.description ? { description: node.description } : {}),
    ...(node.disabledReason ? { disabledReason: node.disabledReason } : {}),
    ...(node.unlockWhen ? { visibleWhen: node.unlockWhen } : {}),
    ...(node.enabledWhen ? { enabledWhen: node.enabledWhen } : {}),
  }
}

export function materializeResonatorStates(
  resonatorId: string,
  details: ResDtls | null | undefined,
): SourceState[] {
  if (!details?.stateGraph) {
    return EMPTY_STATES
  }

  return details.stateGraph.nodes.map((node) => nodeToState(resonatorId, details, node))
}

export function materializeResonatorStatesById(
  detailsById: Record<string, ResDtls>,
): Record<string, SourceState[]> {
  return Object.fromEntries(
    Object.entries(detailsById).map(([resonatorId, details]) => [
      resonatorId,
      materializeResonatorStates(resonatorId, details),
    ]),
  )
}

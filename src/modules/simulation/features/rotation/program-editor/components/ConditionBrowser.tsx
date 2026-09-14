/*
  Author: Runor Ewhro
  Description: Owns condition browser behavior and state transitions for the components module.
*/

import { Hash, Layers, List, ToggleRight, type LucideIcon } from 'lucide-react'
import type { CondChoice } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import {
  conditionChoiceLabel,
  isFormulaChoice,
} from '@/modules/simulation/features/rotation/shared/conditions.tsx'

export type CondTarget = 'resonator' | 'enemy' | 'rotation'
export type CondKind = 'toggle' | 'select' | 'stack' | 'number'

export const COND_KIND_META: Record<CondKind, { label: string; Icon: LucideIcon }> = {
  toggle: { label: 'Toggle', Icon: ToggleRight },
  stack: { label: 'Stacks', Icon: Layers },
  number: { label: 'Value', Icon: Hash },
  select: { label: 'Option', Icon: List },
}

export const COND_KIND_ORDER: CondKind[] = ['toggle', 'stack', 'number', 'select']

export function getCondTarget(choice: CondChoice): CondTarget {
  if (choice.changeTarget === 'enemy') {
    return 'enemy'
  }
  if (choice.changeTarget === 'rotation') {
    return 'rotation'
  }
  return 'resonator'
}

// Group conditions by effect source beneath their owner identity.
export function getCondGroupKey(choice: CondChoice): string {
  if (choice.changeTarget === 'rotation') {
    return `rotation:${choice.sourceName || 'Rotation'}`
  }

  return `${choice.resonatorId}:${choice.sourceName}`
}

export function getCondGroupLabel(choice: CondChoice): string {
  if (choice.changeTarget === 'rotation') {
    return choice.sourceName || 'Rotation Setup'
  }

  return choice.sourceName === choice.resName
    ? choice.resName
    : `${choice.resName} · ${choice.sourceName}`
}

// the owner rail is one level coarser: a teammate, the enemy, or the rotation.
export function getCondOwnerKey(choice: CondChoice): string {
  const target = getCondTarget(choice)
  if (target === 'enemy') {
    return 'enemy'
  }
  if (target === 'rotation') {
    return 'rotation'
  }
  return choice.resonatorId
}

export function getCondOwnerLabel(choice: CondChoice): string {
  const target = getCondTarget(choice)
  if (target === 'enemy') {
    return 'Enemy'
  }
  if (target === 'rotation') {
    return 'Rotation'
  }
  return choice.resName
}

export function getBrowserChoiceLabel(choice: CondChoice): string {
  return isFormulaChoice(choice) ? 'Modifiers' : conditionChoiceLabel(choice)
}

interface CondGroup {
  key: string
  label: string
  choices: CondChoice[]
}

// preserve first-seen order while collecting states under their source heading
export function groupCondChoices(choices: CondChoice[]): CondGroup[] {
  const groups: CondGroup[] = []
  const byKey = new Map<string, CondGroup>()

  for (const choice of choices) {
    const key = getCondGroupKey(choice)
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: getCondGroupLabel(choice), choices: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.choices.push(choice)
  }

  return groups
}

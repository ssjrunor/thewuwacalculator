/*
  Author: Runor Ewhro
  Description: pure resonator-panel helpers for labels, slider display,
               control options, and image preloading.
*/

import type { AttributeKey } from '@/domain/entities/stats'
import type { ResonatorSkillTabKey, ResonatorStateControl } from '@/modules/calculator/model/resonator'

export const skillLabelMap: Record<ResonatorSkillTabKey, string> = {
  normalAttack: 'Normal Attack',
  resonanceSkill: 'Resonance Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Resonance Liberation',
  introSkill: 'Intro Skill',
  outroSkill: 'Outro Skill',
  tuneBreak: 'Tune Break',
}

export const attributeSliderColors: Partial<Record<AttributeKey, string>> = {
  glacio: 'rgb(62,189,227)',
  spectro: 'rgb(202,179,63)',
  havoc: 'rgb(172,9,96)',
  electro: 'rgb(167,13,209)',
  aero: 'rgb(15,205,160)',
  fusion: 'rgb(197,52,79)',
}

// format a skill key into title-cased ui copy
export function formatSkillKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (text) => text.toUpperCase())
}

// check whether a control should visually count as active in badges and chips
export function isControlVisiblyActive(
  control: ResonatorStateControl,
  value: boolean | number | string | undefined,
): boolean {
  if (control.kind === 'toggle') {
    return Boolean(value)
  }

  const numericValue = typeof value === 'number' ? value : Number(value ?? control.min ?? 0)
  const minimum = control.min ?? 0
  return numericValue > minimum
}

// merge keyword lists without duplicates for description rendering
export function mergeDescriptionKeywords(...lists: Array<string[] | undefined>): string[] {
  const merged = new Set<string>()
  for (const list of lists) {
    for (const keyword of list ?? []) {
      merged.add(keyword)
    }
  }

  return Array.from(merged)
}

// preload an image asset without failing the ui flow
export function preloadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => resolve()
    image.src = src
  })
}

// resolve select options that change once the resonator reaches a threshold sequence
export function getControlOptions(
  control: ResonatorStateControl,
  sequence: number,
): number[] {
  if (control.sequenceAwareOptions) {
    return sequence >= control.sequenceAwareOptions.threshold
      ? control.sequenceAwareOptions.atOrAbove
      : control.sequenceAwareOptions.below
  }

  return control.options ?? []
}

// scale a stored control value into its user-facing display value
export function getScaledValue(control: ResonatorStateControl, storedValue: number): number {
  if (!control.displayMultiplier) {
    return storedValue
  }

  return storedValue * control.displayMultiplier
}

// convert a displayed control value back into the stored representation
export function toStoredControlValue(control: ResonatorStateControl, rawValue: number): number {
  if (!control.displayMultiplier) {
    return rawValue
  }

  return Math.floor(rawValue / control.displayMultiplier)
}

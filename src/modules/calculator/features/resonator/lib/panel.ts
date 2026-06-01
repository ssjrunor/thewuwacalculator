/*
  Author: Runor Ewhro
  Description: pure resonator-panel helpers for labels, slider display,
               control options, and image preloading.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { resResCntrPt } from '@/domain/gameData/controlOptions.ts'
import type { ResonatorSkillTabKey as SkillTabKey, ResonatorStateControl as ResStateControl } from '@/modules/calculator/features/resonator/lib/resonator.ts'

export const skllLblMap: Record<SkillTabKey, string> = {
  normalAttack: 'Normal Attack',
  resonanceSkill: 'Resonance Skill',
  forteCircuit: 'Forte Circuit',
  resonanceLiberation: 'Resonance Liberation',
  introSkill: 'Intro Skill',
  outroSkill: 'Outro Skill',
  tuneBreak: 'Tune Break',
}

// format a skill key into title-cased ui copy
export function fmtSkllKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (text) => text.toUpperCase())
}

export function isCntrVsblAc(
  control: ResStateControl,
  value: boolean | number | string | undefined,
): boolean {
  if (control.kind === 'toggle') {
    return Boolean(value ?? control.defaultValue)
  }

  const numericValue = typeof value === 'number' ? value : Number(value ?? control.defaultValue ?? control.min ?? 0)
  const nctvVl = typeof control.defaultValue === 'number' ? control.defaultValue : control.min ?? 0
  return numericValue > nctvVl
}

// merge keyword lists without duplicates for description rendering
export function mrgDscrKywr(...lists: Array<string[] | undefined>): string[] {
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
export function getCntrPtns(
  control: ResStateControl,
  runtime: ResRuntime,
): number[] {
  return resResCntrPt(runtime, control)
}

// scale a stored control value into its user-facing display value
export function getScldVl(control: ResStateControl, storedValue: number): number {
  if (!control.displayMultiplier) {
    return storedValue
  }

  return storedValue * control.displayMultiplier
}

// convert a displayed control value back into the stored representation
export function toStrdCntrVl(control: ResStateControl, rawValue: number): number {
  if (!control.displayMultiplier) {
    return rawValue
  }

  return Math.floor(rawValue / control.displayMultiplier)
}

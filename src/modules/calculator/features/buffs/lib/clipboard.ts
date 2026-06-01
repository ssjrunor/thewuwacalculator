/*
  Author: Runor Ewhro
  Description: Serializes, parses, and clones advanced manual buff modifiers
               for cross-surface clipboard copy and paste workflows.
*/

import type { ManualBuffs, MnlMod } from '@/domain/entities/manualBuffs.ts'
import { mnlBffsSchm } from '@/domain/state/manualBuffsSchema.ts'
import {
  makeModId,
  cleanBuffs,
} from '@/modules/calculator/features/buffs/lib/helpers.ts'

export const MOD_CLIP_KIND = 'manual-modifier-clipboard'
export const MOD_CLIP_VER = 1

export interface MnlModClpbPa {
  kind: typeof MOD_CLIP_KIND
  version: typeof MOD_CLIP_VER
  modifiers: MnlMod[]
}

let cchdMnlModCl: MnlModClpbPa | null = null

const EMPTY_QUICK: ManualBuffs['quick'] = {
  atk: { flat: 0, percent: 0 },
  hp: { flat: 0, percent: 0 },
  def: { flat: 0, percent: 0 },
  critRate: 0,
  critDmg: 0,
  energyRegen: 0,
  healingBonus: 0,
}

function cloneMnlMod(modifier: MnlMod): MnlMod {
  return { ...modifier }
}

export function cloneMnlMdfr(modifiers: MnlMod[]): MnlMod[] {
  return modifiers.map(cloneMnlMod)
}

export function cloneManualMods(modifiers: MnlMod[]): MnlMod[] {
  return modifiers.map((modifier) => ({
    ...cloneMnlMod(modifier),
    id: makeModId(),
  }))
}

export function makeModClip(
    modifiers: MnlMod[],
): MnlModClpbPa {
  return {
    kind: MOD_CLIP_KIND,
    version: MOD_CLIP_VER,
    modifiers: cloneMnlMdfr(modifiers),
  }
}

export function serMnlModClp(
    payload: MnlModClpbPa,
): string {
  return JSON.stringify({
    ...payload,
    modifiers: cloneMnlMdfr(payload.modifiers),
  })
}

export function prsMnlModClp(raw: string): MnlModClpbPa | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>

    if (
      parsed.kind !== MOD_CLIP_KIND ||
      parsed.version !== MOD_CLIP_VER ||
      !Array.isArray(parsed.modifiers)
    ) {
      return null
    }

    const prsdMnlBffs = mnlBffsSchm.safeParse({
      quick: EMPTY_QUICK,
      modifiers: parsed.modifiers,
    })

    if (!prsdMnlBffs.success || prsdMnlBffs.data.modifiers.length === 0) {
      return null
    }

    const sntzMnlBffs = cleanBuffs(prsdMnlBffs.data)

    return {
      kind: MOD_CLIP_KIND,
      version: MOD_CLIP_VER,
      modifiers: cloneMnlMdfr(sntzMnlBffs.modifiers),
    }
  } catch {
    return null
  }
}

export async function writeMnlModC(
    payload: MnlModClpbPa,
): Promise<boolean> {
  const nrmlPay = makeModClip(payload.modifiers)
  cchdMnlModCl = nrmlPay

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return true
  }

  try {
    await navigator.clipboard.writeText(serMnlModClp(nrmlPay))
    return true
  } catch {
    return false
  }
}

export async function readMnlModCl(): Promise<MnlModClpbPa | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return cchdMnlModCl
      ? makeModClip(cchdMnlModCl.modifiers)
      : null
  }

  try {
    const text = await navigator.clipboard.readText()
    const parsed = prsMnlModClp(text)
    cchdMnlModCl = parsed
      ? makeModClip(parsed.modifiers)
      : null
    return parsed
  } catch {
    return cchdMnlModCl
      ? makeModClip(cchdMnlModCl.modifiers)
      : null
  }
}

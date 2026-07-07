/*
  Author: Runor Ewhro
  Description: builds manual-buff editor labels, defaults, and normalization
               helpers used by the calculator buff controls.
*/

import type { ManualBuffs, MnlMod } from '@/domain/entities/manualBuffs.ts'
import {
  DVNCBASESTuv,
  DVNCTOPSTATP,
  NEG_EFFECT_MODS,
  SKLLSCLRPTNS,
  SKLLMODPTNS,
} from '@/modules/calculator/features/buffs/lib/options.ts'

// treat unknown json as a plain object only when it is safe to inspect keys.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clampQuickBuff(isFlat: boolean, rawValue: number): number {
  const maximum = isFlat ? 9999 : 999
  return Math.max(-maximum, Math.min(maximum, rawValue))
}

export function clmpMnlModVl(modifier: MnlMod, rawValue: number): number {
  const max = (() => {
    if (modifier.scope === 'baseStat') {
      return DVNCBASESTuv.find((option) => option.value === modifier.field)?.max ?? 999
    }

    if (modifier.scope === 'topStat') {
      return DVNCTOPSTATP.find((option) => option.value === modifier.stat)?.max ?? 999
    }

    if (modifier.scope === 'skill') {
      const skllPtnVl = modifier.effect === 'mod' ? modifier.mod : modifier.effect
      if (modifier.effect === 'scalar') {
        return SKLLSCLRPTNS.find((option) => option.value === modifier.field)?.max ?? 999
      }
      return SKLLMODPTNS.find((option) => option.value === skllPtnVl)?.max ?? 999
    }

    if (modifier.scope === 'negativeEffect') {
      return NEG_EFFECT_MODS.find((option) => option.value === modifier.mod)?.max ?? 999
    }

    return 999
  })()

  return Math.max(-max, Math.min(max, rawValue))
}

export function makeModId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// support either the raw manual buffs object or the wrapped export payload.
export function mprtPay(input: unknown): unknown {
  if (
    isRecord(input)
    && input.type === 'manual-buffs'
    && 'manualBuffs' in input
  ) {
    return input.manualBuffs
  }

  return input
}

// clamp imported values and repair duplicate or missing modifier ids.
export function cleanBuffs(manualBuffs: ManualBuffs): ManualBuffs {
  const seenIds = new Set<string>()

  const normModId = (rawId: string) => {
    const trimmedId = rawId.trim()
    if (trimmedId !== '' && !seenIds.has(trimmedId)) {
      seenIds.add(trimmedId)
      return trimmedId
    }

    const fallbackId = makeModId()
    seenIds.add(fallbackId)
    return fallbackId
  }

  return {
    quick: {
      atk: {
        flat: clampQuickBuff(true, manualBuffs.quick.atk.flat),
        percent: clampQuickBuff(false, manualBuffs.quick.atk.percent),
      },
      hp: {
        flat: clampQuickBuff(true, manualBuffs.quick.hp.flat),
        percent: clampQuickBuff(false, manualBuffs.quick.hp.percent),
      },
      def: {
        flat: clampQuickBuff(true, manualBuffs.quick.def.flat),
        percent: clampQuickBuff(false, manualBuffs.quick.def.percent),
      },
      critRate: clampQuickBuff(false, manualBuffs.quick.critRate),
      critDmg: clampQuickBuff(false, manualBuffs.quick.critDmg),
      energyRegen: clampQuickBuff(false, manualBuffs.quick.energyRegen),
      healingBonus: clampQuickBuff(false, manualBuffs.quick.healingBonus),
    },
    modifiers: manualBuffs.modifiers.map((modifier) => {
      const nextModifier = {
        ...modifier,
        id: normModId(modifier.id),
      }

      return {
        ...nextModifier,
        value: clmpMnlModVl(nextModifier, nextModifier.value),
      }
    }),
  }
}

/*
  Author: Runor Ewhro
  Description: Export/import for showcase card customization. Each panel group can
               be exported on its own (JSON, or a raw .css file for Custom CSS), the
               whole card can be exported together (JSON, custom CSS inlined as a
               string), and one importer ingests any of them by detecting the kind
               from the file so the right slice is applied.
*/

import { DEF_BENCH_CARD_STYLE, DEF_BENCH_HIDE } from '@/domain/entities/preferences'
import type { BenchmarkCardStyle, BenchmarkCardHidden } from '@/domain/entities/preferences'

const APP_TAG = 'thewuwacalculator'

export type CardExportTarget = 'show' | 'portrait' | 'backdrop' | 'color' | 'type' | 'text' | 'css' | 'all'

const STYLE_KEYS = Object.keys(DEF_BENCH_CARD_STYLE) as (keyof BenchmarkCardStyle)[]
const HIDDEN_KEYS = Object.keys(DEF_BENCH_HIDE) as (keyof BenchmarkCardHidden)[]

// The style fields each group owns. 'show' maps to the hidden flags instead.
const GROUP_STYLE_KEYS: Record<'portrait' | 'backdrop' | 'color' | 'type' | 'text', (keyof BenchmarkCardStyle)[]> = {
  portrait: ['portraitX', 'portraitY', 'portraitScale', 'maskTop', 'maskRight', 'maskBottom', 'maskLeft', 'maskTopSharp', 'maskRightSharp', 'maskBottomSharp', 'maskLeftSharp', 'portraitImage', 'portraitCredit'],
  backdrop: ['backdropX', 'backdropY', 'backdropScale', 'backdropBlur', 'backdropOpacity', 'backdropImage', 'backdropCredit'],
  color: ['accent', 'surface', 'opacity'],
  type: ['displayFont', 'monoFont', 'text'],
  text: ['textSlots'],
}

export const CARD_GROUP_LABEL: Record<CardExportTarget, string> = {
  show: 'Show',
  portrait: 'Portrait',
  backdrop: 'Backdrop',
  color: 'Color',
  type: 'Base type',
  text: 'Per-text styles',
  css: 'Custom CSS',
  all: 'card settings',
}

export interface CardExportFile {
  raw: string
  filename: string
  mime: string
}

function pick<T extends object>(source: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}

export function buildCardExport(
  target: CardExportTarget,
  style: BenchmarkCardStyle,
  hidden: BenchmarkCardHidden,
): CardExportFile {
  if (target === 'css') {
    return { raw: style.customCss ?? '', filename: 'wwcalc-card-custom.css', mime: 'text/css' }
  }
  if (target === 'all') {
    const payload = { app: APP_TAG, kind: 'card-all', style, hidden }
    return { raw: JSON.stringify(payload, null, 2), filename: 'wwcalc-card-all.json', mime: 'application/json' }
  }
  const data = target === 'show' ? { hidden } : pick(style, GROUP_STYLE_KEYS[target])
  const payload = { app: APP_TAG, kind: 'card-group', group: target, data }
  return { raw: JSON.stringify(payload, null, 2), filename: `wwcalc-card-${target}.json`, mime: 'application/json' }
}

export interface CardImportResult {
  stylePatch?: Partial<BenchmarkCardStyle>
  hiddenPatch?: Partial<BenchmarkCardHidden>
  label: string
}

// Detects a card file and returns the patch(es) to apply. A .css file (or any
// non-JSON text) is treated as Custom CSS; JSON is matched by its `kind`/`group`.
export function parseCardImport(filename: string, raw: string): CardImportResult {
  const looksJson = raw.trimStart().startsWith('{')
  const isCss = filename.toLowerCase().endsWith('.css') || !looksJson
  if (isCss) {
    return { stylePatch: { customCss: raw.trim() ? raw : null }, label: 'Custom CSS' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error("That file isn't valid JSON or CSS.")
  }
  if (!parsed || typeof parsed !== 'object') throw new Error("That isn't a card settings file.")
  const record = parsed as Record<string, unknown>
  if (record.app !== APP_TAG) throw new Error("That isn't a thewuwacalculator card file.")

  if (record.kind === 'card-all') {
    return {
      stylePatch: pick((record.style ?? {}) as BenchmarkCardStyle, STYLE_KEYS),
      hiddenPatch: pick((record.hidden ?? {}) as BenchmarkCardHidden, HIDDEN_KEYS),
      label: CARD_GROUP_LABEL.all,
    }
  }

  if (record.kind === 'card-group') {
    const group = record.group as CardExportTarget
    const data = (record.data ?? {}) as Record<string, unknown>
    if (group === 'show') {
      return { hiddenPatch: pick((data.hidden ?? {}) as BenchmarkCardHidden, HIDDEN_KEYS), label: CARD_GROUP_LABEL.show }
    }
    const keys = GROUP_STYLE_KEYS[group as 'portrait' | 'backdrop' | 'color' | 'type' | 'text']
    if (!keys) throw new Error('That card file uses an unknown group.')
    return { stylePatch: pick(data as unknown as BenchmarkCardStyle, keys), label: CARD_GROUP_LABEL[group] ?? 'card settings' }
  }

  throw new Error("That card file's format wasn't recognized.")
}

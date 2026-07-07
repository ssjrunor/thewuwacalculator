/*
  Author: Runor Ewhro
  Description: Single source of truth for turning a persisted showcase card style
               into CSS custom properties. The card is themed entirely through
               these variables, so new overrides become a matter of adding a field
               here plus a control in the panel, and the same map feeds the live
               card and the PNG capture. Per-slot text typography lives here today;
               mask/backdrop/colour vars can migrate in over time.
*/

import { TEXT_SLOTS } from '@/domain/entities/preferences'
import type { TextSlot, TextSlotStyle } from '@/domain/entities/preferences'

export type CardVarMap = Record<string, string | number>

// Each text slot exposes the same six knobs as `--ss-<slot>-<prop>`. Only set
// fields are emitted, so the CSS fallbacks (the slot's built-in styling) win when
// a knob is untouched.
function emitSlotVars(slot: TextSlot, style: TextSlotStyle, out: CardVarMap): void {
  if (style.color) out[`--ss-${slot}-color`] = style.color
  if (style.font) out[`--ss-${slot}-font`] = style.font
  if (style.size != null) out[`--ss-${slot}-scale`] = style.size / 100
  if (style.weight != null) out[`--ss-${slot}-weight`] = style.weight
  if (style.spacing != null) out[`--ss-${slot}-ls`] = `${style.spacing / 100}em`
  if (style.transform) out[`--ss-${slot}-tt`] = style.transform
}

export function buildTextSlotVars(slots: Partial<Record<TextSlot, TextSlotStyle>>): CardVarMap {
  const out: CardVarMap = {}
  for (const slot of TEXT_SLOTS) {
    const style = slots[slot]
    if (style) emitSlotVars(slot, style, out)
  }
  return out
}

// Pulls the family name out of a stored stack like `'Onest', sans-serif`.
export function familyFromStack(stack: string | null | undefined): string | null {
  if (!stack) return null
  const match = stack.match(/^\s*['"]?([^'",]+)/)
  return match ? match[1].trim() : null
}

// Every user-chosen font family on a card (global display/mono + each text slot),
// as plain family names, used to re-inject the Google Fonts links after a reload,
// since only the resolved stacks are persisted, not the original links.
export function collectCardFontFamilies(style: {
  displayFont: string | null
  monoFont: string | null
  textSlots: Partial<Record<TextSlot, TextSlotStyle>>
}): string[] {
  const families = new Set<string>()
  for (const stack of [style.displayFont, style.monoFont]) {
    const family = familyFromStack(stack)
    if (family) families.add(family)
  }
  for (const slot of TEXT_SLOTS) {
    const family = familyFromStack(style.textSlots[slot]?.font)
    if (family) families.add(family)
  }
  return Array.from(families)
}

export const EMPTY_TEXT_SLOT: TextSlotStyle = {
  color: null,
  font: null,
  size: null,
  weight: null,
  spacing: null,
  transform: null,
}

// Custom card CSS is injected inside an `@scope` block, but a handful of at-rules
// (`@import`, `@font-face`, `@keyframes`, …) are invalid nested in @scope. Pull
// those to the top level so users can import fonts / define faces and animations,
// while everything else stays scoped to the card. `@import` is emitted first, as
// the spec requires it precede all other rules.
const HOIST_STATEMENT = new Set(['import', 'charset', 'namespace'])
const HOIST_BLOCK = new Set(['font-face', 'keyframes', '-webkit-keyframes', 'property'])

// Index just past the next top-level `;` (or `{` block), skipping any that sit
// inside a string or url()/parentheses because `@import` URLs routinely contain `;`
// (e.g. multi-axis Google Fonts), which a naive search would split on.
function scanTo(css: string, start: number, stopChar: ';' | '{'): number {
  let depth = 0
  let quote = ''
  for (let i = start; i < css.length; i++) {
    const c = css[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === stopChar && depth === 0) return i
  }
  return -1
}

function scanBlockEnd(css: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < css.length; i++) {
    const c = css[i]
    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = ''
      continue
    }
    if (c === '"' || c === "'") quote = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i + 1
  }
  return css.length
}

export function splitHoistedCss(css: string): { hoisted: string; scoped: string } {
  const imports: string[] = []
  const blocks: string[] = []
  let scoped = ''
  let i = 0
  while (i < css.length) {
    if (css[i] === '@') {
      const name = (/^@(-?[a-zA-Z][\w-]*)/.exec(css.slice(i))?.[1] ?? '').toLowerCase()
      if (HOIST_STATEMENT.has(name)) {
        const semi = scanTo(css, i, ';')
        const stop = semi === -1 ? css.length : semi + 1
        ;(name === 'import' ? imports : blocks).push(css.slice(i, stop).trim())
        i = stop
        continue
      }
      if (HOIST_BLOCK.has(name)) {
        const open = scanTo(css, i, '{')
        if (open !== -1) {
          const end = scanBlockEnd(css, open)
          blocks.push(css.slice(i, end).trim())
          i = end
          continue
        }
      }
    }
    scoped += css[i]
    i++
  }
  return { hoisted: [...imports, ...blocks].join('\n'), scoped }
}

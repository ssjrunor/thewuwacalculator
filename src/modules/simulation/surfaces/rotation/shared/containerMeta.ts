/*
  Author: Runor Ewhro
  Description: Resolves authored container names, colors, ownership, and scope labels.
*/

type RotScopeKind = 'loop' | 'repeat' | 'uptime'

const SCOPE_LABELS: Record<RotScopeKind, string> = {
  loop: 'Loop',
  repeat: 'Repeat',
  uptime: 'Uptime',
}

/** The palette that identifies flow-control loops. */
export const ROT_LOOP_COLORS: readonly string[] = [
  '#f59e0b',
  '#22c55e',
  '#38bdf8',
  '#f472b6',
  '#a78bfa',
  '#f97316',
]

/**
 * Containers are not loop markers, so their defaults deliberately read from a
 * different family. The first two retain the page's existing teal repeat and
 * warm uptime language while later blocks still remain distinguishable.
 */
export const ROT_BLOCK_COLORS: readonly string[] = [
  'rgb(255 63 101 / 0.81)',
  '#467aff',
  '#913dc3',
  'rgb(237 208 62 / 0.9)',
  'rgb(166 166 166)',
  'rgb(32 191 185 / 0.89)',
]

export const DEFAULT_ROT_BLOCK_COLOR = ROT_BLOCK_COLORS[0]

export function makePaletteColor(
  palette: readonly string[],
  colors: Iterable<string | null | undefined>,
): () => string {
  const used = new Set<string>()
  for (const color of colors) {
    if (color) {
      used.add(color)
    }
  }
  let cursor = 0

  return () => {
    const free = palette.find((color) => !used.has(color))
    if (free) {
      used.add(free)
      return free
    }

    const next = palette[cursor % palette.length]
    cursor += 1
    return next
  }
}

export function makeBlockColor(colors: Iterable<string | null | undefined>): () => string {
  return makePaletteColor(ROT_BLOCK_COLORS, colors)
}

export function scopeLabelAt(kind: RotScopeKind, index: number): string {
  const base = SCOPE_LABELS[kind]
  return index <= 1 ? base : `${base} ${index}`
}

function collectUsedScopeLabels(
  kind: RotScopeKind,
  labels: Iterable<string | null | undefined>,
): Set<number> {
  const used = new Set<number>()
  const base = SCOPE_LABELS[kind]
  const numbered = new RegExp(`^${base}\\s+(\\d+)$`)

  for (const label of labels) {
    const trimmed = label?.trim()
    if (!trimmed) {
      continue
    }

    if (trimmed === base) {
      used.add(1)
      continue
    }

    const match = numbered.exec(trimmed)
    const index = match ? Number(match[1]) : 0
    if (Number.isInteger(index) && index > 1) {
      used.add(index)
    }
  }

  return used
}

/** The next automatic label for one kind of authored rotation container. */
export function makeScopeLabel(
  kind: RotScopeKind,
  labels: Iterable<string | null | undefined>,
): () => string {
  const used = collectUsedScopeLabels(kind, labels)

  return () => {
    let index = 1
    while (used.has(index)) {
      index += 1
    }
    used.add(index)
    return scopeLabelAt(kind, index)
  }
}

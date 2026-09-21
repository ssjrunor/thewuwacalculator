/*
  Author: Runor Ewhro
  Description: Reads and writes authored rotation-note metadata without changing executable node identity.
*/

export const ROT_NOTE_COLORS: readonly string[] = [
  '#b7d437',
  '#d45137',
  '#37c1d4',
  '#d4cc5b',
  '#65ed55',
  '#ed55ed',
]

/** The first note is Note, then Note 2, Note 3, and so on. */
export function makeNoteLabel(labels: Iterable<string | null | undefined>): () => string {
  const used = new Set<number>()
  for (const label of labels) {
    const trimmed = label?.trim()
    if (trimmed === 'Note') {
      used.add(1)
      continue
    }
    const match = /^Note\s+(\d+)$/.exec(trimmed ?? '')
    const index = match ? Number(match[1]) : 0
    if (Number.isInteger(index) && index > 1) {
      used.add(index)
    }
  }

  return () => {
    let index = 1
    while (used.has(index)) {
      index += 1
    }
    used.add(index)
    return index === 1 ? 'Note' : `Note ${index}`
  }
}

/** Choose the first unused note colour, cycling only after the palette fills. */
export function makeNoteColor(colors: Iterable<string | null | undefined>): () => string {
  const used = new Set([...colors].filter((color): color is string => Boolean(color)))
  let cursor = 0

  return () => {
    for (let offset = 0; offset < ROT_NOTE_COLORS.length; offset += 1) {
      const color = ROT_NOTE_COLORS[(cursor + offset) % ROT_NOTE_COLORS.length]
      if (!used.has(color)) {
        used.add(color)
        cursor = (cursor + offset + 1) % ROT_NOTE_COLORS.length
        return color
      }
    }
    const color = ROT_NOTE_COLORS[cursor % ROT_NOTE_COLORS.length]
    cursor = (cursor + 1) % ROT_NOTE_COLORS.length
    return color
  }
}

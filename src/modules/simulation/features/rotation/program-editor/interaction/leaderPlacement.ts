/*
  Author: Runor Ewhro
  Description: Owns leader placement behavior and state transitions for the interaction module.
*/

interface LeaderBox {
  top: number
  left: number
  height: number
}

interface LeaderPlacement {

  noteTop: number
  /** where the pip sits on the note's edge, in the body's own content */
  pipTop: number
  pipLeft: number

  shown: boolean
}

/** the note keeps this much clear of the body's ends */
const EDGE = 13
/** and the pip stops this far inside the note's own ends */
const PIP_EDGE = 14

const HEAD_SHARE = 0.28
/** the pip straddles the note's left edge rather than sitting beside it */
const STRADDLE = 1.6

export function placeLeader({
  body,
  row,
  note,
  noteHeight,
  scrollTop,
  scrollLeft,
  bodyHeight,
}: {
  body: LeaderBox
  row: LeaderBox
  note: LeaderBox
  noteHeight: number
  scrollTop: number
  scrollLeft: number
  bodyHeight: number
}): LeaderPlacement {
  const seenAt = row.top - body.top + row.height / 2
  const mid = seenAt + scrollTop
  const noteTop = Math.max(
    scrollTop + EDGE,
    Math.min(mid - noteHeight * HEAD_SHARE, scrollTop + bodyHeight - noteHeight - EDGE),
  )

  return {
    noteTop,
    pipTop: Math.max(noteTop + PIP_EDGE, Math.min(mid, noteTop + noteHeight - PIP_EDGE)),
    pipLeft: note.left - body.left + scrollLeft - STRADDLE,
    shown: seenAt > 12 && seenAt < bodyHeight - 12,
  }
}

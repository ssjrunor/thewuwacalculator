/*
  Author: Runor Ewhro
  description: packs a build's scores on one ruleset into one blob (s<rs>.cells)
               with a slot per cell at its cell number, which makes a build's
               scores one row to read and write for any number of scenarios.
               each slot is 23 bytes:
                 0      0 empty, else status + 1 (1 ok, 2 unsupported,
                        3 error) with the score flags above (bits 2-7)
                 1-2    reason code (store.ts reasons), 0 for none
                 3-6    q (int32), MIN_Q for none
                 7-14   damage (float64), NaN for none
                 15-22  dpr (float64), NaN for none
               numbers are stored in their row types (doubles stay doubles).
*/

export const SLOT_BYTES = 23
const NO_Q = -0x80000000

/** one cell's score, as the store's rows have it. */
export interface PackedScore {
  cell: number
  status: number
  q: number | null
  damage: number | null
  dpr: number | null
  flags: number
  reason: number | null
}

/** a blob with room for every cell of a ruleset numbered below `cells`. */
export function emptyScores(cells: number): Uint8Array {
  return new Uint8Array(cells * SLOT_BYTES)
}

/** grows a blob to fit `cell`, preserving its contents. */
function withRoom(bytes: Uint8Array, cell: number): Uint8Array {
  const need = (cell + 1) * SLOT_BYTES
  if (bytes.length >= need) return bytes
  const grown = new Uint8Array(need)
  grown.set(bytes)
  return grown
}

/** the score in a cell's slot, or null when it has none. */
export function readScore(bytes: Uint8Array, cell: number): PackedScore | null {
  const at = cell * SLOT_BYTES
  if (at + SLOT_BYTES > bytes.length || bytes[at] === 0) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset + at, SLOT_BYTES)
  const head = view.getUint8(0)
  const reason = view.getUint16(1, true)
  const q = view.getInt32(3, true)
  const damage = view.getFloat64(7, true)
  const dpr = view.getFloat64(15, true)
  return { cell, status: (head & 3) - 1, flags: head >> 2, reason: reason === 0 ? null : reason, q: q === NO_Q ? null : q,
    damage: Number.isNaN(damage) ? null : damage, dpr: Number.isNaN(dpr) ? null : dpr }
}

/** writes a cell's score into its slot and returns the blob, grown when the cell is past its end. */
export function writeScore(bytes: Uint8Array, score: PackedScore): Uint8Array {
  if (score.status < 0 || score.status > 2) throw new Error(`scores: status ${score.status}`)
  if (score.flags < 0 || score.flags > 63) throw new Error(`scores: flags ${score.flags}`)
  if (score.reason != null && (score.reason < 1 || score.reason > 0xffff)) throw new Error(`scores: reason code ${score.reason}`)
  if (score.q != null && (!Number.isInteger(score.q) || score.q <= NO_Q || score.q > 0x7fffffff)) throw new Error(`scores: q ${score.q}`)
  const out = withRoom(bytes, score.cell)
  const view = new DataView(out.buffer, out.byteOffset + score.cell * SLOT_BYTES, SLOT_BYTES)
  view.setUint8(0, (score.status + 1) | (score.flags << 2))
  view.setUint16(1, score.reason ?? 0, true)
  view.setInt32(3, score.q ?? NO_Q, true)
  view.setFloat64(7, score.damage ?? Number.NaN, true)
  view.setFloat64(15, score.dpr ?? Number.NaN, true)
  return out
}

/** every score in a blob, by cell. */
export function readScores(bytes: Uint8Array | null): PackedScore[] {
  const out: PackedScore[] = []
  if (!bytes) return out
  for (let cell = 0; cell * SLOT_BYTES < bytes.length; cell += 1) {
    const score = readScore(bytes, cell)
    if (score) out.push(score)
  }
  return out
}

/** cells with a score in a blob. */
export function scoredCells(bytes: Uint8Array | null): number[] {
  const out: number[] = []
  if (!bytes) return out
  for (let cell = 0; cell * SLOT_BYTES < bytes.length; cell += 1) if (bytes[cell * SLOT_BYTES] !== 0) out.push(cell)
  return out
}

/*
  Author: Runor Ewhro
  Description: Verifies the leaderPlacement.test behavior and its compatibility invariants.
*/

import { describe, expect, it } from 'vitest'
import { placeLeader } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/leaderPlacement.ts'

const body = { top: 0, left: 0, height: 800 }
const note = { top: 0, left: 600, height: 300 }

function place(rowTop: number, scrollTop = 0, scrollLeft = 0) {
  return placeLeader({
    body,
    row: { top: rowTop, left: 20, height: 30 },
    note,
    noteHeight: 300,
    scrollTop,
    scrollLeft,
    bodyHeight: body.height,
  })
}

describe('leader placement', () => {
  it('hangs the note against the row and puts the pip on its edge', () => {
    const spot = place(400)

    expect(spot.noteTop).toBeCloseTo(415 - 300 * 0.28)
    expect(spot.pipTop).toBeCloseTo(415)
    expect(spot.pipLeft).toBeCloseTo(600 - 1.6)
    expect(spot.shown).toBe(true)
  })

  it('reads the same row the same way once the body itself has scrolled', () => {

    const still = place(400)
    const scrolled = place(400, 500)

    expect(scrolled.noteTop - still.noteTop).toBe(500)
    expect(scrolled.pipTop - still.pipTop).toBe(500)
    expect(scrolled.shown).toBe(true)
  })

  it('keeps the note inside the body it is drawn over, scrolled or not', () => {
    expect(place(0).noteTop).toBe(13)
    expect(place(0, 500).noteTop).toBe(513)

    expect(place(780).noteTop).toBe(800 - 300 - 13)
    expect(place(780, 500).noteTop).toBe(500 + 800 - 300 - 13)
  })

  it('stops the pip at the note\'s own ends rather than leaving it', () => {

    const high = place(0)
    const low = place(770)

    expect(high.pipTop).toBe(high.noteTop + 14)
    expect(low.pipTop).toBe(low.noteTop + 300 - 14)
  })

  it('drops the line when the row has scrolled out of the body', () => {
    expect(place(-40).shown).toBe(false)
    expect(place(795).shown).toBe(false)
    expect(place(-40, 500).shown).toBe(false)
  })

  it('measures the pip onto the note edge across a sideways scroll', () => {
    expect(place(400, 0, 120).pipLeft).toBeCloseTo(600 + 120 - 1.6)
  })
})

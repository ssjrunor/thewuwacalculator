/*
  Author: Runor Ewhro
  Description: Holds the level badge's plate scan against the shipped sample
               card, so the name band and the badge never drift apart again.
*/

import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  BUILD_REGIONS,
  LEVEL_BADGE_BAND,
  LEVEL_BADGE_PLATE,
  NAME_BADGE_GAP,
} from '@/engine/echoParser/cardRegions'
import { fndLvlPlate } from '@/engine/echoParser/ocrParsing'
import { splitNameLvl } from '@/engine/echoParser/buildMetadata'

const SAMPLE_CARD = 'public/assets/app/samples/sample-import-image.png'

async function scanSample() {
  const data = await sharp(SAMPLE_CARD)
      .extract({
        left: LEVEL_BADGE_BAND.x,
        top: LEVEL_BADGE_BAND.y,
        width: LEVEL_BADGE_BAND.width,
        height: LEVEL_BADGE_BAND.height,
      })
      .ensureAlpha()
      .raw()
      .toBuffer()
  return fndLvlPlate(
    new Uint8ClampedArray(data),
    LEVEL_BADGE_BAND.width,
    LEVEL_BADGE_BAND.height,
  )
}

describe('level badge', () => {
  it('finds the gold plate on the sample card', async () => {
    const plate = await scanSample()

    expect(plate).not.toBeNull()
    expect(plate!.width).toBeGreaterThanOrEqual(LEVEL_BADGE_PLATE.minWidth)
    // the badge is one plate, not the run of hatch marks trailing it
    expect(plate!.width).toBeLessThan(120)
    expect(plate!.height).toBeGreaterThan(14)
  })

  it('leaves the name room to its left', async () => {
    const plate = await scanSample()
    const badgeX = LEVEL_BADGE_BAND.x + plate!.x - LEVEL_BADGE_PLATE.pad.x
    const nameWidth = badgeX - NAME_BADGE_GAP - BUILD_REGIONS.resonatorName.x

    expect(nameWidth).toBeGreaterThan(80)
    expect(nameWidth).toBeLessThan(BUILD_REGIONS.resonatorName.width)
  })
})

describe('name line', () => {
  it('cuts the level off the end of the line', () => {
    expect(splitNameLvl('Yangyang: Xuanling LV.90')).toEqual({
      name: 'Yangyang: Xuanling',
      level: 90,
    })
  })

  it('keeps a line that carries no badge', () => {
    expect(splitNameLvl('Hiyuki')).toEqual({ name: 'Hiyuki', level: null })
  })
})

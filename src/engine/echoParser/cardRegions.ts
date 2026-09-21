/*
  Author: Runor Ewhro
  Description: Owns the fixed build-card geometry so the parser and the import
               surface read the same coordinates.
*/

import type { ImageRegion } from '@/engine/echoParser/imageMatching'

export const CARD_WIDTH = 1920
export const CARD_HEIGHT = 1080

// a card is read at the bot's own size; anything else of the same shape is scaled to it
export const MAX_ASPECT_SKEW = 0.01
// measured on the bench cards: 1120 wide still reads 99.6%, 960 wide falls to 70%
export const MIN_CARD_WIDTH = 1120
export const MIN_CARD_HEIGHT = Math.round((MIN_CARD_WIDTH * CARD_HEIGHT) / CARD_WIDTH)

// the QR code's white plate: on every card, high contrast, and its edges are sharp
export const QR_PLATE = {
  left: 1459,
  top: 53,
  width: 237,
  /** rows and columns that cross the plate however the card has drifted */
  rows: [120, 170, 220],
  columns: [1500, 1580, 1660],
} as const

// how far off its own coordinates a card may sit and still be pulled back
export const MAX_DRIFT = 40

// horizontal step between the five echo panels
export const SLOT_SPACING = 374

export const BUILD_REGIONS = {
  // the name and the level badge share one line, so the band holds both
  resonatorName: { x: 68, y: 18, width: 700, height: 62 },
  // clear of the name's descenders, which the reader used to take for a letter
  playerId: { x: 18, y: 88, width: 200, height: 25 },
  uid: { x: 18, y: 113, width: 200, height: 25 },
  weaponName: { x: 1600, y: 444, width: 284, height: 46 },
  weaponLevel: { x: 1635, y: 499, width: 90, height: 48 },
  skillLevels: {
    normalAttack: { x: 1038, y: 180, width: 145, height: 44 },
    resonanceLiberation: { x: 1238, y: 334, width: 150, height: 46 },
    forteCircuit: { x: 1158, y: 579, width: 150, height: 46 },
    introSkill: { x: 898, y: 579, width: 150, height: 46 },
    resonanceSkill: { x: 812, y: 334, width: 150, height: 46 },
  },
} as const satisfies Record<string, ImageRegion | Record<string, ImageRegion>>

export const SEQUENCE_CENTERS = [189, 268, 347, 426, 505, 585] as const
export const SEQUENCE_SAMPLE = { y: 570, size: 11 } as const
export const ATTRIBUTE_REGION = { x: 15, y: 25, width: 50, height: 47 } as const

// the level badge slides with the name, so it is found by its gold plate in here
export const LEVEL_BADGE_BAND = { x: 120, y: 24, width: 648, height: 52 } as const

// the badge is the one wide gold plate on the name line
export const LEVEL_BADGE_PLATE = {
  /** a column counts once this many of its pixels are plate gold */
  minRows: 8,
  /** the glyphs break the plate, so columns this far apart still join */
  maxGap: 16,
  /** narrower than this is a stray, not a badge */
  minWidth: 24,
  /** rows this full of gold are the plate's own */
  rowFill: 0.35,
  /** breathing room around the crop, which the reader wants */
  pad: { x: 2, y: 3 },
} as const

// the level's digits sit at a fixed offset from the plate's left edge, clear of
// the "LV." before them and the hatching after
export const LEVEL_BADGE_DIGITS = { from: 27, width: 26 } as const

// where the name has to stop when the badge sits beside it
export const NAME_BADGE_GAP = 6

export interface EchoSlotRegions {
  /** the secondary stat row ("ATK 150", "HP 2280"), printed on every filled panel */
  sideStat: ImageRegion
  cost: ImageRegion
  mainStatLabel: ImageRegion
  /** the label half of each substat row, wrapped second line included */
  substats: ImageRegion[]
  /** the number half of each substat row */
  substatValues: ImageRegion[]
  echoImage: ImageRegion
  set: ImageRegion
}

// a filled panel's secondary stat row lights 230+ pixels even through a 960px JPEG,
// an empty one none; brightness, not gold, because compression washes the colour out
export const FILLED_PANEL_MIN_INK = 80

// substat rows sit on a fixed pitch, measured from their bullets
export const SUBSTAT_ROW_CENTERS = [892, 926, 960, 994, 1028] as const

// a row keeps its own wrapped second line and stops short of the next row's caps
const SUBSTAT_ROW = { above: 10, height: 35 } as const

// labels end by x 282 and values start at 319 on every card, so the two are read
// apart: letters for the name, digits for the number
const SUBSTAT_LABEL = { x: 64, width: 232 } as const
const SUBSTAT_VALUE = { x: 296, width: 88, above: 12, height: 24 } as const

export function getEchoSlotRgns(): EchoSlotRegions[] {
  return Array.from({ length: 5 }, (_, index) => {
    const o = index * SLOT_SPACING
    return {
      sideStat: { x: 36 + o, y: 842, width: 88, height: 28 },
      cost: { x: 336 + o, y: 674, width: 18, height: 24 },
      // the value line sits right under the label, so the box stops above it
      mainStatLabel: { x: 215 + o, y: 722, width: 173, height: 28 },
      substats: SUBSTAT_ROW_CENTERS.map((center) => ({
        x: SUBSTAT_LABEL.x + o,
        y: center - SUBSTAT_ROW.above,
        width: SUBSTAT_LABEL.width,
        height: SUBSTAT_ROW.height,
      })),
      substatValues: SUBSTAT_ROW_CENTERS.map((center) => ({
        x: SUBSTAT_VALUE.x + o,
        y: center - SUBSTAT_VALUE.above,
        width: SUBSTAT_VALUE.width,
        height: SUBSTAT_VALUE.height,
      })),
      echoImage: { x: 22 + o, y: 650, width: 192, height: 182 },
      set: { x: 264 + o, y: 660, width: 56, height: 56 },
    }
  })
}

export type CardReadGroup = 'resonator' | 'echoes' | 'weapon' | 'player'

export interface CardReadArea {
  group: CardReadGroup
  region: ImageRegion
  /** what the reader is looking at, in the parser's own words */
  label: string
  /** 1-based echo slot for panel areas */
  slot?: number
}

export const SLOT_AREA_COUNT = 9
export const HEAD_AREA_BASE = 5 * SLOT_AREA_COUNT

// offsets into the head block, one per area the head stage samples
export const HEAD_AREA = {
  resonatorName: 0,
  playerId: 1,
  weaponName: 2,
  resonatorLevel: 3,
  uid: 4,
  weaponLevel: 5,
  normalAttack: 6,
  resonanceLiberation: 7,
  forteCircuit: 8,
  introSkill: 9,
  resonanceSkill: 10,
  attribute: 11,
  sequence: 12,
} as const

const SLOT_LABELS = [
  'cost',
  'main stat',
  'substat 1',
  'substat 2',
  'substat 3',
  'substat 4',
  'substat 5',
  'sonata mark',
  'echo art',
]

function pipRegion(centerX: number): ImageRegion {
  const half = Math.floor(SEQUENCE_SAMPLE.size / 2)
  return {
    x: centerX - half,
    y: SEQUENCE_SAMPLE.y,
    width: SEQUENCE_SAMPLE.size,
    height: SEQUENCE_SAMPLE.size,
  }
}

// every area the parser samples, in the order it samples them
export function getCardReadAreas(): CardReadArea[] {
  const areas: CardReadArea[] = []

  getEchoSlotRgns().forEach((slot, index) => {
    const regions = [
      slot.cost,
      slot.mainStatLabel,
      ...slot.substats,
      slot.set,
      slot.echoImage,
    ]
    regions.forEach((region, part) => {
      areas.push({
        group: 'echoes',
        region,
        label: SLOT_LABELS[part],
        slot: index + 1,
      })
    })
  })

  areas.push({ group: 'resonator', region: BUILD_REGIONS.resonatorName, label: 'resonator name' })
  areas.push({ group: 'player', region: BUILD_REGIONS.playerId, label: 'player ID' })
  areas.push({ group: 'weapon', region: BUILD_REGIONS.weaponName, label: 'weapon name' })
  areas.push({ group: 'resonator', region: LEVEL_BADGE_BAND, label: 'level badge' })
  areas.push({ group: 'player', region: BUILD_REGIONS.uid, label: 'UID' })
  areas.push({ group: 'weapon', region: BUILD_REGIONS.weaponLevel, label: 'weapon level' })
  areas.push({ group: 'resonator', region: BUILD_REGIONS.skillLevels.normalAttack, label: 'normal attack' })
  areas.push({ group: 'resonator', region: BUILD_REGIONS.skillLevels.resonanceLiberation, label: 'resonance liberation' })
  areas.push({ group: 'resonator', region: BUILD_REGIONS.skillLevels.forteCircuit, label: 'forte circuit' })
  areas.push({ group: 'resonator', region: BUILD_REGIONS.skillLevels.introSkill, label: 'intro skill' })
  areas.push({ group: 'resonator', region: BUILD_REGIONS.skillLevels.resonanceSkill, label: 'resonance skill' })
  areas.push({ group: 'resonator', region: ATTRIBUTE_REGION, label: 'attribute' })

  SEQUENCE_CENTERS.forEach((centerX, index) => {
    areas.push({ group: 'resonator', region: pipRegion(centerX), label: `sequence ${index + 1}` })
  })

  return areas
}

export const HEAD_SAMPLE_COUNT = getCardReadAreas().length - HEAD_AREA_BASE

export const SLOT_SAMPLE_COUNT = 5 * SLOT_AREA_COUNT

/*
  Author: Runor Ewhro
  description: defines build-card coordinates shared by parsing and import UI.
*/

import type { ImageRegion } from '@/engine/echoParser/imageMatching'

export const CARD_WIDTH = 1920
export const CARD_HEIGHT = 1080

// a card is read at the bot's own size; anything else of the same shape is scaled to it
export const MAX_ASPECT_SKEW = 0.01
// measured on the bench cards: 1120 wide still reads 99.6%, 960 wide falls to 70%
export const MIN_CARD_WIDTH = 1120
export const MIN_CARD_HEIGHT = Math.round((MIN_CARD_WIDTH * CARD_HEIGHT) / CARD_WIDTH)

// the qr code's white plate: on every card, high contrast, and its edges are sharp
export const QR_PLATE = {
  left: 1459,
  top: 53,
  width: 237,
  /** rows and columns that cross the plate however the card has drifted */
  rows: [120, 170, 220],
  columns: [1500, 1580, 1660],
} as const

// quarter-size median of fixed card elements; alpha marks unchanged pixels.
// reference cards score 0.4-6.6, including 1120-wide jpeg copies; other game
// screenshots score at least 42. scripts/analysis/cardFrameTemplate.cjs rebuilds it.
export const CARD_FRAME = {
  src: '/assets/app/import/card-frame.png',
  width: 480,
  height: 270,
  maxScore: 15,
} as const

// maximum image offset accepted when aligning a card to its reference regions.
export const MAX_DRIFT = 40

// horizontal step between the five echo panels
export const SLOT_SPACING = 374

export const BUILD_REGIONS = {
  // the name region includes the level badge on the same line.
  resonatorName: { x: 68, y: 18, width: 700, height: 62 },
  // begin below the name glyphs to exclude adjacent letters.
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

// catalog weapon icon bounds measured from reference cards.
export const WEAPON_ICON = { x: 1468, y: 454, size: 116 } as const

export const SEQUENCE_CENTERS = [189, 268, 347, 426, 505, 585] as const
export const SEQUENCE_SAMPLE = { y: 570, size: 11 } as const
export const ATTRIBUTE_REGION = { x: 15, y: 25, width: 50, height: 47 } as const

// find the level badge by its gold plate within the name band.
export const LEVEL_BADGE_BAND = { x: 120, y: 24, width: 648, height: 52 } as const

// locate the level badge using the wide gold region on the name line.
export const LEVEL_BADGE_PLATE = {
  /** a column counts once this many of its pixels are plate gold */
  minRows: 8,
  /** the glyphs break the plate, so columns this far apart still join */
  maxGap: 16,
  /** minimum badge width in pixels. */
  minWidth: 24,
  /** minimum share of gold pixels in a badge row. */
  rowFill: 0.35,
  /** crop padding */
  pad: { x: 2, y: 3 },
} as const

// digit region starts after "LV." and ends before the plate hatching.
export const LEVEL_BADGE_DIGITS = { from: 27, width: 26 } as const

// gap between the name and badge regions.
export const NAME_BADGE_GAP = 6

export interface EchoSlotRegions {
  /** the secondary stat row ("ATK 150", "HP 2280"), printed on every filled panel */
  sideStat: ImageRegion
  cost: ImageRegion
  mainStatLabel: ImageRegion
  /** the band holding the main stat's printed value, star mark included */
  mainStatValue: ImageRegion
  /** the label half of each substat row, wrapped second line included */
  substats: ImageRegion[]
  /** the number half of each substat row */
  substatValues: ImageRegion[]
  echoImage: ImageRegion
  set: ImageRegion
}

// filled panels have at least 230 bright side-stat pixels in 960px jpeg copies;
// brightness detects the row after compression changes its colour.
export const FILLED_PANEL_MIN_INK = 80

// substat rows sit on a fixed pitch, measured from their bullets
export const SUBSTAT_ROW_CENTERS = [892, 926, 960, 994, 1028] as const

// measured row bounds include the first line and any wrapped second line.
const SUBSTAT_ROW = { above: 6, height: 34 } as const

// labels end by x 282 and values start at 319 on every card, so the two are read
// apart: letters for the name, digits for the number
const SUBSTAT_LABEL = { x: 64, width: 232 } as const
const SUBSTAT_VALUE = { x: 296, width: 88, above: 12, height: 24 } as const

// classify short labels by first-line ink width on native and 1120px jpeg cards:
// HP spans 20-21 pixels, ATK and DEF span 24-31, and other labels span at least 70.
// DEF begins with a 10-13 pixel stem; ATK begins with a 3-7 pixel stroke.
export const SHORT_LABEL = {
  band: 15,
  minInk: 2,
  hpMaxWidth: 21,
  minWidth: 24,
  maxWidth: 40,
  defMinStem: 9,
} as const

export function getEchoSlotRgns(): EchoSlotRegions[] {
  return Array.from({ length: 5 }, (_, index) => {
    const o = index * SLOT_SPACING
    return {
      sideStat: { x: 36 + o, y: 842, width: 88, height: 28 },
      cost: { x: 336 + o, y: 674, width: 18, height: 24 },
      // the value region begins below the label region.
      mainStatLabel: { x: 215 + o, y: 722, width: 173, height: 28 },
      // the value's ink spans y 759-778 and x 268-369 (star from 268 or 291, digits from 295 or 317)
      mainStatValue: { x: 250 + o, y: 755, width: 145, height: 28 },
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

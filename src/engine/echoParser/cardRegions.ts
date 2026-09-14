/*
  Author: Runor Ewhro
  Description: Owns the fixed build-card geometry so the parser and the import
               surface read the same coordinates.
*/

import type { ImageRegion } from '@/engine/echoParser/imageMatching'

export const CARD_WIDTH = 1920
export const CARD_HEIGHT = 1080

// horizontal step between the five echo panels
export const SLOT_SPACING = 374

export const BUILD_REGIONS = {
  resonatorName: { x: 68, y: 18, width: 620, height: 62 },
  playerId: { x: 18, y: 84, width: 230, height: 29 },
  uid: { x: 18, y: 111, width: 230, height: 29 },
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

// the level badge slides with the name, so seven overlapping samples chase it
export const RESONATOR_LEVEL_REGIONS: ImageRegion[] = Array.from(
  { length: 7 },
  (_, index) => ({ x: 180 + index * 60, y: 32, width: 120, height: 38 }),
)

export interface EchoSlotRegions {
  cost: ImageRegion
  mainStatLabel: ImageRegion
  substats: ImageRegion[]
  echoImage: ImageRegion
  set: ImageRegion
}

export function getEchoSlotRgns(): EchoSlotRegions[] {
  return Array.from({ length: 5 }, (_, index) => {
    const o = index * SLOT_SPACING
    return {
      cost: { x: 336 + o, y: 674, width: 18, height: 24 },
      mainStatLabel: { x: 215 + o, y: 720, width: 173, height: 40 },
      substats: [
        { x: 64 + o, y: 880, width: 320, height: 38 },
        { x: 64 + o, y: 918, width: 320, height: 38 },
        { x: 64 + o, y: 950, width: 320, height: 38 },
        { x: 64 + o, y: 984, width: 320, height: 38 },
        { x: 64 + o, y: 1019, width: 320, height: 38 },
      ],
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
  /** reads behind this area; the level badge is chased by seven samples */
  samples?: number
}

export const SLOT_AREA_COUNT = 9
export const HEAD_AREA_BASE = 5 * SLOT_AREA_COUNT

// offsets into the head block, in the order extractBuildMetadata walks it
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

function levelBandRegion(): ImageRegion {
  const first = RESONATOR_LEVEL_REGIONS[0]
  const last = RESONATOR_LEVEL_REGIONS[RESONATOR_LEVEL_REGIONS.length - 1]
  return {
    x: first.x,
    y: first.y,
    width: last.x + last.width - first.x,
    height: first.height,
  }
}

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
  areas.push({
    group: 'resonator',
    region: levelBandRegion(),
    label: 'level badge',
    samples: RESONATOR_LEVEL_REGIONS.length,
  })
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

export const HEAD_SAMPLE_COUNT = getCardReadAreas()
    .slice(HEAD_AREA_BASE)
    .reduce((total, area) => total + (area.samples ?? 1), 0)

export const SLOT_SAMPLE_COUNT = 5 * SLOT_AREA_COUNT

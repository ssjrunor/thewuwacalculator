/*
  Author: Runor Ewhro
  Description: Turns a read build card into one runtime patch, band by band, so
               the receipt writes exactly what its switches say it will.
*/

import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { ParsedBuildScreenshot } from '@/engine/echoParser/ocrParsing.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { normResRtCnt } from '@/domain/gameData/controlOptions.ts'
import { clampNumber } from '@/shared/lib/number.ts'
import {
  setResLvl,
  setSkllLvl,
  setWpnLvl,
} from '@/modules/simulation/features/resonator/lib/buildEdits.ts'
import { applyWpnSel, setWpnRank } from '@/modules/simulation/features/weapons/lib/weaponSlotOps.ts'
import type { CoreSkillLevels } from '@/engine/echoParser/buildMetadata.ts'

type CardSkill = keyof CoreSkillLevels

export interface ImportBands {
  resonator: boolean
  weapon: boolean
  echoes: boolean
}

const CARD_SKILLS: CardSkill[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
]

// values the card carries but the build does not have yet
export function cntImprtVls(read: ParsedBuildScreenshot, bands: ImportBands): number {
  let count = 0
  if (bands.resonator) {
    if (read.resonator.level !== null) count += 1
    count += 1
    count += CARD_SKILLS.filter((key) => read.resonator.skillLevels[key] !== null).length
  }
  if (bands.weapon) {
    if (read.weapon.id) count += 1
    if (read.weapon.level !== null) count += 1
  }
  if (bands.echoes) count += 5
  return count
}

function applyResonator(prev: ResRuntime, read: ParsedBuildScreenshot): ResRuntime {
  let next = prev

  if (read.resonator.level !== null) {
    next = setResLvl(next, read.resonator.level)
  }

  const sequence = clampNumber(Math.round(read.resonator.sequence), 0, 6)
  if (sequence !== next.base.sequence) {
    next = { ...next, base: { ...next.base, sequence } }
  }

  for (const key of CARD_SKILLS) {
    const level = read.resonator.skillLevels[key]
    if (level !== null) next = setSkllLvl(next, key, level)
  }

  // sequence and skill moves can unlock or retire controls
  return { ...next, state: { ...next.state, controls: normResRtCnt(next) } }
}

function applyWeapon(prev: ResRuntime, read: ParsedBuildScreenshot): ResRuntime {
  const weaponDef = read.weapon.id ? getWpnById(read.weapon.id) : null
  const resonatorSeed = getResSeedBy(prev.id)
  if (!weaponDef || !resonatorSeed || weaponDef.weaponType !== resonatorSeed.weaponType) return prev

  const level = read.weapon.level ?? prev.build.weapon.level

  if (weaponDef.id === prev.build.weapon.id) {
    return setWpnLvl(prev, level, weaponDef)
  }

  // the card cannot see synthesis, so the rank the build already has is kept
  const rank = prev.build.weapon.rank
  return setWpnRank(applyWpnSel(prev, weaponDef, { maxOnInit: false, level }), rank)
}

export function applyImprtRd(
    prev: ResRuntime,
    read: ParsedBuildScreenshot,
    echoes: Array<EchoInstance | null>,
    bands: ImportBands,
): ResRuntime {
  let next = prev
  if (bands.resonator) next = applyResonator(next, read)
  if (bands.weapon) next = applyWeapon(next, read)
  if (bands.echoes) next = { ...next, build: { ...next.build, echoes } }
  return next
}

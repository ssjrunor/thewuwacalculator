/*
  Author: Runor Ewhro
  Description: the edits a resonator build accepts, kept in one
               place so the resonator pane, the weapon pane, and the member
               console all move level, skill, trace, and weapon state the same
               way instead of each holding its own copy of the updater.
*/

import type { ResRuntime, ResSeed } from '@/domain/entities/runtime.ts'
import { cmptTrcNodeB } from '@/domain/state/traceNodes.ts'
import { clampNumber } from '@/shared/lib/number.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import { weaponStatsAt } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import type { ResSldrSkllT } from '@/modules/simulation/features/resonator/lib/resonator.ts'

export const RES_LVL_MIN = 1
export const RES_LVL_MAX = 90
export const SKILL_LVL_MIN = 1
export const SKILL_LVL_MAX = 10

/* the levels the game gates an ascension on, used as rail detents */
export const ASCENSION_STOPS = [20, 40, 50, 60, 70, 80, 90] as const

export function setResLvl(prev: ResRuntime, level: number): ResRuntime {
  const nextLevel = clampNumber(Math.round(level), RES_LVL_MIN, RES_LVL_MAX)
  if (prev.base.level === nextLevel) {
    return prev
  }

  return {
    ...prev,
    base: {
      ...prev.base,
      level: nextLevel,
    },
  }
}

export function setSkllLvl(prev: ResRuntime, key: ResSldrSkllT, value: number): ResRuntime {
  const nextValue = clampNumber(Math.round(value), SKILL_LVL_MIN, SKILL_LVL_MAX)
  if (prev.base.skillLevels[key] === nextValue) {
    return prev
  }

  return {
    ...prev,
    base: {
      ...prev.base,
      skillLevels: {
        ...prev.base.skillLevels,
        [key]: nextValue,
      },
    },
  }
}

// trace buffs are recomputed from the whole active set rather than added and
// subtracted, so a toggle can never drift the totals out of step.
export function tglTrcNd(
  prev: ResRuntime,
  nodeId: string,
  seed: Pick<ResSeed, 'traceNodes'> | null,
): ResRuntime {
  const nextActNds = {
    ...prev.base.traceNodes.activeNodes,
    [nodeId]: !prev.base.traceNodes.activeNodes[nodeId],
  }

  return {
    ...prev,
    base: {
      ...prev.base,
      traceNodes: seed ? cmptTrcNodeB(seed, nextActNds) : prev.base.traceNodes,
    },
  }
}

// base atk is cached on the build, so a level change has to carry the weapon's
// stats at that level with it or the sheet reads the old curve.
export function setWpnLvl(prev: ResRuntime, level: number, weaponDef: GenWpn | null): ResRuntime {
  const nextLevel = clampNumber(Math.round(level), RES_LVL_MIN, RES_LVL_MAX)
  if (prev.build.weapon.level === nextLevel) {
    return prev
  }

  const nextWeapon = weaponDef
    ? { ...prev.build.weapon, level: nextLevel, baseAtk: weaponStatsAt(weaponDef, nextLevel).atk }
    : { ...prev.build.weapon, level: nextLevel }

  return {
    ...prev,
    build: {
      ...prev.build,
      weapon: nextWeapon,
    },
  }
}

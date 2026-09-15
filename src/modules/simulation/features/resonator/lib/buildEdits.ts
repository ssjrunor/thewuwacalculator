/*
  Author: Runor Ewhro
  Description: Applies canonical resonator level, skill, trace-node, sequence,
               and weapon-level mutations shared by build-editing surfaces.
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

/** Legal ascension level boundaries used by progression controls. */
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

// Recompute trace buffs from the complete active set instead of applying deltas.
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

// Weapon level and cached base ATK must advance together.
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

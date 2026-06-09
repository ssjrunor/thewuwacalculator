/*
  Author: Runor Ewhro
  Description: Collects presentational optimizer helpers for labels, icons,
               formatting, and small derived values used across the ui.
*/

import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import {
  apWpnStts,
  clrSrcCtrls,
  type RtCtlMap,
} from '@/domain/state/sourceStateInit.ts'
import { makeTeamMember } from '@/domain/state/defaults.ts'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import type { OptDisplayRow, OptDsplSetEn } from '../Row.tsx'
import type { EchoPlan } from './teammateEchoPlan.ts'

export type PrvwTgt =
  | { kind: 'base' }
  | { kind: 'result'; index: number }

export type OpSlot = 'active' | 0 | 1
export type OpEchoTarget = 'filter' | 0 | 1

// keep the idle progress object in one place so the stage can reset consistently.
export function mkMptyPrgr(): import('@/engine/optimizer/types').OptPrgr {
  return {
    progress: 0,
    elapsedMs: 0,
    remainingMs: Infinity,
    processed: 0,
    speed: 0,
    total: 0,
    phase: 'evaluating',
    discovered: 0,
  }
}

// translate ui-facing stat filter keys into echo stat keys.
export function mapMainStatF(filterKey: string, selectedBonus: string | null): string | null {
  if (filterKey === 'atk%') return 'atkPercent'
  if (filterKey === 'hp%') return 'hpPercent'
  if (filterKey === 'def%') return 'defPercent'
  if (filterKey === 'er') return 'energyRegen'
  if (filterKey === 'cr') return 'critRate'
  if (filterKey === 'cd') return 'critDmg'
  if (filterKey === 'healing') return 'healingBonus'
  if (filterKey === 'bonus') return selectedBonus
  return null
}

// derive the compact preview summary shown in result rows and preview cards.
export function smmrEchoLdt(
  echoes: Array<EchoInstance | null>,
): Pick<OptDisplayRow, 'costs' | 'sets' | 'mainEchoIcon'> {
  const setCounts = new Map<number, number>()
  // capture every echo's individual cost so the row can show the layout
  // (e.g. 4·3·3·1·1) instead of the redundant sum.
  const costs: number[] = []

  for (const echo of echoes) {
    if (!echo) {
      continue
    }

    setCounts.set(echo.set, (setCounts.get(echo.set) ?? 0) + 1)
    const echoCost = getEchoById(echo.id)?.cost ?? 0
    if (echoCost > 0) {
      costs.push(echoCost)
    }
  }

  costs.sort((a, b) => b - a)

  const sets: OptDsplSetEn[] = Array.from(setCounts.entries())
    .flatMap(([id, count]) => {
      const setDef = getEchoSetDe(id)
      if (!setDef) {
        return []
      }

      const cmpsCnt =
        setDef.setMax === 1
          ? count >= 1 ? 1 : null
          : setDef.setMax === 3
            ? count >= 3 ? 3 : null
            : count >= 5
              ? 5
              : count >= 2
                ? 2
                : null

      if (cmpsCnt == null) {
        return []
      }

      return [{
        id,
        count: cmpsCnt,
        icon: getSntSetIco(id),
      }]
    })
    .sort((left, right) => right.count - left.count || left.id - right.id)

  return {
    costs: costs.length > 0 ? costs : null,
    sets,
    mainEchoIcon: echoes[0] ? getEchoById(echoes[0].id)?.icon ?? null : null,
  }
}

// creates an empty echo plan
export function mkMptyEchoPl(): [EchoPlan | null, EchoPlan | null] {
  return [null, null]
}

// whether a rotation node list contains at least one damage feature node.
// combo (rotation) optimizer mode is only meaningful when such a node exists,
// so this gates the combo target-mode toggle. only repeat/uptime nodes nest
// further items; condition/loop markers cannot contain features.
export function rotHasFeats(items: ReadonlyArray<RotationNode>): boolean {
  for (const node of items) {
    if (node.type === 'feature') {
      return true
    }
    if (node.type === 'repeat' && rotHasFeats(node.items)) {
      return true
    }
    if (node.type === 'uptime') {
      if (rotHasFeats(node.items)) {
        return true
      }
      if (node.setup && rotHasFeats(node.setup)) {
        return true
      }
    }
  }
  return false
}

// normalize every loadout to the fixed 5-slot shape expected by the ui.
export function normEchoLdt(
  echoes: ReadonlyArray<EchoInstance | null | undefined>,
): Array<EchoInstance | null> {
  const out: Array<EchoInstance | null> = [null, null, null, null, null]
  for (let index = 0; index < out.length; index += 1) {
    out[index] = echoes[index] ?? null
  }
  return out
}

// resolve the active runtime or one teammate runtime from the compact optimizer state.
export function makeOpSlot(
  runtime: ResRuntime,
  slot: OpSlot,
): ResRuntime | null {
  if (slot === 'active') {
    return runtime
  }

  const memberId = runtime.build.team[slot + 1]
  if (!memberId) {
    return null
  }

  const seed = seedRsntById[memberId] ?? null
  if (!seed) {
    return null
  }

  const compactRuntime = runtime.teamRuntimes[slot]
  const resolvedRuntime = compactRuntime?.id === memberId
    ? compactRuntime
    : makeTeamMember(seed)

  return matTeamMemFr(
    seed,
    resolvedRuntime,
    runtime.state.controls,
    runtime.state.combat,
    runtime.build.team,
  )
}

// remove any persisted weapon state keys tied to a weapon before swapping it out.
export function clrWpnSttCnt(
  controls: RtCtlMap,
  weaponId: string | null,
  prefix = '',
) {
  clrSrcCtrls(controls, { type: 'weapon', id: weaponId }, prefix)
}

// seed default state values for a freshly selected weapon.
export function applyWpnSttD(
  controls: RtCtlMap,
  weaponId: string,
  prefix = '',
  runtime?: ResRuntime,
  maxed = false,
) {
  if (!runtime) return
  apWpnStts(controls, runtime, weaponId, { prefix, maxed })
}

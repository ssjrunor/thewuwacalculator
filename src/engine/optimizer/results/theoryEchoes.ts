/*
  Author: Runor Ewhro
  Description: Validates compact theory rows and materializes their catalog,
               set, main-stat, and slot-locked substat choices as Echoes.
*/

import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import type { OptBagResult, OptRawResult, PrepTheoryRot, PrepTheoryTarget, TheoryResultRow } from '@/engine/optimizer/types.ts'
import { fillOptBagRs } from './collector.ts'

type ThryPay = PrepTheoryTarget | PrepTheoryRot

export function matThryEcho(
    payload: ThryPay,
    result: TheoryResultRow,
): EchoInstance[] | null {
  const size = payload.profs.length
  if (
      result.ids.length !== size ||
      result.sets.length !== size ||
      result.mains.length !== size ||
      result.main < 0 ||
      result.main >= size
  ) {
    return null
  }

  if (new Set(result.ids).size !== result.ids.length) {
    return null
  }

  const catById = new Map(payload.cats.map((cat) => [cat.id, cat] as const))
  const echoes: EchoInstance[] = []

  for (let index = 0; index < size; index += 1) {
    const id = result.ids[index]
    const cat = catById.get(id)
    const setId = result.sets[index]
    const mainKey = result.mains[index]
    const prof = payload.profs[index]
    if (!id || !cat || !prof || setId == null || !mainKey || !cat.sets.includes(setId)) {
      return null
    }

    const primaryValue = ECHO_MAIN_STATS[cat.cost]?.[mainKey]
    const secondary = ECHO_SIDE_STATS[cat.cost]
    if (primaryValue == null || !secondary) {
      return null
    }

    echoes.push({
      uid: `theory:${prof.uid}:${id}:${setId}:${mainKey}:${index}`,
      id,
      set: setId,
      mainEcho: index === result.main,
      mainStats: {
        primary: {
          key: mainKey,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    })
  }

  return echoes
}


function matThryBagEcho(
    payload: ThryPay,
    result: OptBagResult,
): EchoInstance[] | null {
  const rowIds = fillOptBagRs(new Int32Array(5), result)
  const out: EchoInstance[] = new Array(payload.profs.length)
  const used = new Set<string>()
  const mainSlot = payload.theoryRows[result.i0]?.slot ?? -1

  for (let index = 0; index < rowIds.length; index += 1) {
    const row = payload.theoryRows[rowIds[index] ?? -1]
    if (!row) {
      return null
    }

    let id = row.id
    if (!id) {
      for (const candId of row.ids) {
        if (!used.has(candId)) {
          id = candId
          break
        }
      }
    }

    const prof = payload.profs[row.slot]
    const primaryValue = ECHO_MAIN_STATS[row.cost]?.[row.main]
    const secondary = ECHO_SIDE_STATS[row.cost]
    if (!id || !prof || primaryValue == null || !secondary || used.has(id)) {
      return null
    }

    used.add(id)
    out[row.slot] = {
      uid: `theory:${prof.uid}:${id}:${row.set}:${row.main}:${row.slot}`,
      id,
      set: row.set,
      mainEcho: row.slot === mainSlot,
      mainStats: {
        primary: {
          key: row.main,
          value: primaryValue,
        },
        secondary: {
          key: secondary.key,
          value: secondary.value,
        },
      },
      substats: { ...prof.substats },
    }
  }

  return out.every(Boolean) ? out : null
}

export function matThryRsltCh(
    payload: ThryPay,
    result: OptRawResult,
): EchoInstance[] | null {
  return 'ids' in result
      ? matThryEcho(payload, result)
      : matThryBagEcho(payload, result)
}

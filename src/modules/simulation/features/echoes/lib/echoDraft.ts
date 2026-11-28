/*
  Author: Runor Ewhro
  description: updates unsaved echo identity, main stat, sonata, and legal substats before commit.
*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EchoDef } from '@/domain/entities/catalog.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import { makeEchoUid } from '@/domain/entities/runtime.ts'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import {
  ECHO_MAIN_STATS,
  ECHO_SIDE_STATS,
  getSbstStepP,
  snapToNrstSb,
} from '@/data/gameData/catalog/echoStats.ts'
import { truncTo } from '@/shared/lib/number.ts'

export const MAX_SUBSTATS = 5

export function fmtStatValue(key: string, value: number): string {
  if (key.endsWith('Flat')) {
    return String(truncTo(value))
  }

  if (key === 'tuneBreakBoost') {
    const truncated = truncTo(value, 2)
    return Number.isInteger(truncated) ? String(truncated) : truncated.toFixed(2).replace(/\.?0+$/, '')
  }

  return `${value}%`
}

// map an arbitrary stored value to its nearest legal roll index
export function stepIndex(key: string, value: number): number {
  const steps = getSbstStepP(key)
  let best = 0
  steps.forEach((step, index) => {
    if (Math.abs(step - value) < Math.abs(steps[best] - value)) best = index
  })
  return best
}

// preserve relative roll quality when stat families have different tier counts
export function carryTier(fromKey: string, fromValue: number, toKey: string): number {
  const to = getSbstStepP(toKey)
  if (!to.length) return 0

  const from = getSbstStepP(fromKey)
  if (from.length < 2) return to[0]

  const fraction = stepIndex(fromKey, fromValue) / (from.length - 1)
  return to[Math.round(fraction * (to.length - 1))]
}

export function useEchoDraft(echo: EchoInstance, echoes: EchoDef[]) {
  // catalog replacement stays local until the caller receives the saved draft
  const [echoId, setEchoId] = useState(echo.id)
  const [mainStatKey, setMainStatK] = useState(echo.mainStats.primary.key)
  const [selectedSet, setSelSet] = useState(echo.set)
  const [lclSbst, setLclSbst] = useState<Array<[string, number]>>(
    Object.entries(echo.substats),
  )

  useEffect(() => {
    setEchoId(echo.id)
    setMainStatK(echo.mainStats.primary.key)
    setSelSet(echo.set)
    setLclSbst(Object.entries(echo.substats))
  }, [echo])

  const definition = getEchoById(echoId)
  const canRecast = echoes.length > 0
  const cost = definition?.cost ?? 0
  const primaryOptions = useMemo(() => ECHO_MAIN_STATS[cost] ?? {}, [cost])
  const primaryKeys = useMemo(() => Object.keys(primaryOptions), [primaryOptions])
  const secondaryStat = ECHO_SIDE_STATS[cost]
  const setOptions = definition?.sets ?? []
  const usedKeys = useMemo(() => new Set(lclSbst.map(([key]) => key)), [lclSbst])

  // retain only stats legal for the replacement piece, matching slot initialization
  const recast = useCallback((nextId: string): boolean => {
    const nextDef = getEchoById(nextId)
    if (!nextDef) return false

    const nextPrimary = ECHO_MAIN_STATS[nextDef.cost] ?? {}
    const nextKeys = Object.keys(nextPrimary)

    setEchoId(nextId)
    setSelSet((prev) => (nextDef.sets.includes(prev) ? prev : nextDef.sets[0] ?? 0))
    setMainStatK((prev) => (nextKeys.includes(prev) ? prev : nextKeys[0] ?? ''))
    return true
  }, [])

  const setSubValue = useCallback((index: number, next: number) => {
    setLclSbst((prev) => prev.map((entry, position) => (
      position === index ? [entry[0], next] as [string, number] : entry
    )))
  }, [])

  // empty slots append a stat; occupied slots replace it while retaining roll quality
  const pickSubstat = useCallback((index: number, key: string) => {
    setLclSbst((prev) => {
      if (prev.some(([used], position) => used === key && position !== index)) return prev

      const steps = getSbstStepP(key)
      if (index >= prev.length) {
        return prev.length >= MAX_SUBSTATS ? prev : [...prev, [key, steps[0] ?? 0]]
      }

      const [fromKey, fromValue] = prev[index]
      return prev.map((entry, position) => (
        position === index ? [key, carryTier(fromKey, fromValue, key)] as [string, number] : entry
      ))
    })
  }, [])

  const removeSubstat = useCallback((index: number) => {
    setLclSbst((prev) => prev.filter((_, position) => position !== index))
  }, [])

  const critValue = lclSbst.reduce((total, [key, value]) => {
    if (key === 'critRate') return total + value * 2
    if (key === 'critDmg') return total + value
    return total
  }, 0)

  const topRolls = lclSbst.filter(([key, value]) => {
    const steps = getSbstStepP(key)
    return steps.length > 0 && value === steps[steps.length - 1]
  }).length

  // a draft without a legal main stat cannot be committed
  const build = (): EchoInstance | null => {
    if (!mainStatKey || !definition) return null

    const primaryValue = primaryOptions[mainStatKey] ?? 0
    const vldtSbst = lclSbst.map(([key, value]) => [key, snapToNrstSb(key, value)] as [string, number])

    return {
      ...echo,
      uid: makeEchoUid(),
      id: definition.id,
      set: selectedSet,
      mainStats: {
        primary: { key: mainStatKey, value: primaryValue },
        secondary: secondaryStat
          ? { key: secondaryStat.key, value: secondaryStat.value }
          : echo.mainStats.secondary,
      },
      substats: Object.fromEntries(vldtSbst),
    }
  }

  return {
    echoId,
    definition,
    canRecast,
    cost,
    mainStatKey,
    setMainStatK,
    selectedSet,
    setSelSet,
    lclSbst,
    primaryOptions,
    primaryKeys,
    setOptions,
    usedKeys,
    recast,
    setSubValue,
    pickSubstat,
    removeSubstat,
    critValue,
    topRolls,
    build,
  }
}

export type EchoDraft = ReturnType<typeof useEchoDraft>

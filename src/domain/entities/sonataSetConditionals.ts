/*
  Author: Runor Ewhro
  Description: Stores Sonata set-conditional disabled overrides used by
               Suggestions and Optimizer.
*/

export interface OvrSntSetCo {
  version: 1
  encoding: 'off-v1'
  off: Record<string, string[]>
}

export type SntSetConds = OvrSntSetCo

const OVERRIDE_CODE = 'off-v1'
const SET_COND_VER = 1 as const

export const DEF_SET_COND =
  makeOffSet()

export function isOvrSntSet(value: unknown): value is OvrSntSetCo {
  return !!value
    && typeof value === 'object'
    && (value as { encoding?: unknown }).encoding === OVERRIDE_CODE
    && (value as { version?: unknown }).version === SET_COND_VER
    && !!(value as { off?: unknown }).off
    && typeof (value as { off?: unknown }).off === 'object'
    && !Array.isArray((value as { off?: unknown }).off)
}

export function isSntSetCon(value: unknown): value is SntSetConds {
  return isOvrSntSet(value)
}

function cleanOff(
    off: Record<string, string[]> = {},
): Record<string, string[]> {
  const next: Record<string, string[]> = {}

  for (const [rawSetId, rawParts] of Object.entries(off)) {
    const setId = Number(rawSetId)
    if (!Number.isFinite(setId) || !Array.isArray(rawParts)) {
      continue
    }

    const parts = [...new Set(
        rawParts.filter((partKey) => typeof partKey === 'string' && partKey.length > 0),
    )].sort((left, right) => left.localeCompare(right))

    if (parts.length > 0) {
      next[String(setId)] = parts
    }
  }

  return next
}

function makeOffSet(
    off: Record<string, string[]> = {},
): OvrSntSetCo {
  return {
    version: SET_COND_VER,
    encoding: OVERRIDE_CODE,
    off: cleanOff(off),
  }
}

export function getSntSetOn(
    setConds: SntSetConds,
    setId: number,
    partKey: string,
): boolean {
  if (!isOvrSntSet(setConds)) {
    return true
  }

  const parts = setConds.off[String(Number(setId))]
  if (!Array.isArray(parts)) {
    return true
  }

  return !parts.includes(partKey)
}

export function cloneSntSet(
    setConds: SntSetConds,
): OvrSntSetCo {
  if (isOvrSntSet(setConds)) {
    return makeOffSet(setConds.off)
  }

  return makeOffSet()
}

export function withSntSet(
    setConds: SntSetConds,
    updates: Array<{ setId: number; partKey: string; checked: boolean }> = [],
): OvrSntSetCo {
  if (!Array.isArray(updates) || updates.length === 0) {
    return cloneSntSet(setConds)
  }

  const base = cloneSntSet(setConds)
  const off: Record<string, string[]> = Object.fromEntries(
      Object.entries(base.off).map(([setId, parts]) => [setId, [...parts]]),
  )

  for (const update of updates) {
    const setId = Number(update.setId)
    if (!Number.isFinite(setId) || !update.partKey) {
      continue
    }

    const key = String(setId)
    const parts = off[key] ? [...off[key]] : []
    const hasPart = parts.includes(update.partKey)

    if (update.checked && hasPart) {
      off[key] = parts.filter((partKey) => partKey !== update.partKey)
    } else if (!update.checked && !hasPart) {
      off[key] = [...parts, update.partKey]
    }

    if (Array.isArray(off[key]) && off[key].length === 0) {
      delete off[key]
    }
  }

  return makeOffSet(off)
}

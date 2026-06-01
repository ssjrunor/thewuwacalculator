/*
  Author: Runor Ewhro
  Description: Loads, normalizes, filters, and resolves enemy catalog data
               from the client-side enemy json source.
*/

import type { EnemyCatEnt, EnemyClassId, EnemyElemId } from '@/domain/entities/enemy'
import { isEnemyClssI, normEnemyRes } from '@/domain/entities/enemy'

const ENEMY_DATA_URL = '/data/enemies.json'

interface RawEnemyCatE {
  Id?: number | string
  Name?: string
  Desc?: string
  DescOpen?: string
  Class?: number
  Element?: number | null
  ElementArray?: number[]
  Icon?: string
  baseData?: {
    res?: Partial<Record<string, number>>
  }
}

let enemyCatPrms: Promise<EnemyCatEnt[]> | null = null

// normalize a raw numeric element into a valid enemy element id
function toEnemyElemI(value: number | null | undefined): EnemyElemId | null {
  if (value == null) {
    return null
  }

  if (value >= 0 && value <= 6) {
    return value as EnemyElemId
  }

  return null
}

// normalize one raw enemy catalog entry into the app shape
function normEnemyCat(entry: RawEnemyCatE): EnemyCatEnt | null {
  const enemyId = String(entry.Id ?? '').trim()
  const enemyName = String(entry.Name ?? '').trim()
  const enemyClass = Number(entry.Class ?? 0)

  if (!enemyId || !enemyName || !isEnemyClssI(enemyClass)) {
    return null
  }

  return {
    id: enemyId,
    name: enemyName,
    description: String(entry.Desc ?? '').trim(),
    descriptionOpen: String(entry.DescOpen ?? '').trim(),
    class: enemyClass as EnemyClassId,
    element: toEnemyElemI(entry.Element),
    elementArray: Array.isArray(entry.ElementArray)
        ? entry.ElementArray
            .map((value) => toEnemyElemI(value))
            .filter((value): value is EnemyElemId => value !== null)
        : [],
    icon: typeof entry.Icon === 'string' && entry.Icon.trim().length > 0 ? entry.Icon : null,
    resistances: normEnemyRes(entry.baseData?.res),
  }
}

// load and cache the enemy catalog from json
export async function loadEnemyCat(): Promise<EnemyCatEnt[]> {
  if (enemyCatPrms) {
    return enemyCatPrms
  }

  enemyCatPrms = fetch(ENEMY_DATA_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Enemy catalog request failed with ${response.status}`)
        }

        const payload = (await response.json()) as RawEnemyCatE[]
        if (!Array.isArray(payload)) {
          throw new Error('Enemy catalog payload is not an array')
        }

        return payload
            .map((entry) => normEnemyCat(entry))
            .filter((entry): entry is EnemyCatEnt => entry !== null)
            .sort((left, right) => left.name.localeCompare(right.name))
      })
      .catch((error) => {
        enemyCatPrms = null
        throw error
      })

  return enemyCatPrms
}

// filter enemy catalog entries by search, element, and class
export function fltrEnemyCat(
    entries: EnemyCatEnt[],
    options?: {
      search?: string
      element?: EnemyElemId | null
      enemyClass?: EnemyClassId | null
    },
): EnemyCatEnt[] {
  const search = options?.search?.trim().toLowerCase() ?? ''

  return entries.filter((entry) => {
    const mtchSrch =
        search.length === 0 ||
        entry.name.toLowerCase().includes(search) ||
        entry.id.includes(search)
    const mtchElem = options?.element == null || entry.element === options.element
    const matchesClass = options?.enemyClass == null || entry.class === options.enemyClass

    return mtchSrch && mtchElem && matchesClass
  })
}

// get one enemy catalog entry by id
export function getEnemyCatE(
    entries: EnemyCatEnt[],
    enemyId: string | null | undefined,
): EnemyCatEnt | null {
  if (!enemyId) {
    return null
  }

  return entries.find((entry) => entry.id === enemyId) ?? null
}
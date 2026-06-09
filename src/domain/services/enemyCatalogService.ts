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
  id?: number | string
  Name?: string
  name?: string
  Desc?: string
  desc?: string
  DescOpen?: string
  descOpen?: string
  Class?: number
  class?: number
  Element?: RawEnemyElem
  element?: RawEnemyElem
  ElementArray?: RawEnemyElem[]
  elementArray?: RawEnemyElem[]
  ElementIdArray?: RawEnemyElem[]
  elementIdArray?: RawEnemyElem[]
  Icon?: string
  icon?: string
  baseData?: {
    res?: Partial<Record<string, number>>
  }
}

type RawEnemyElem =
    | number
    | string
    | null
    | undefined
    | {
      Id?: number | string | null
      id?: number | string | null
    }

let enemyCatPrms: Promise<EnemyCatEnt[]> | null = null

// normalize a raw numeric element into a valid enemy element id
function toEnemyElemI(value: RawEnemyElem): EnemyElemId | null {
  if (value == null) {
    return null
  }

  const rawValue =
      typeof value === 'object'
        ? value.Id ?? value.id
        : value
  if (rawValue == null || (typeof rawValue === 'string' && rawValue.trim().length === 0)) {
    return null
  }

  const elemId = Number(rawValue)

  if (Number.isInteger(elemId) && elemId >= 0 && elemId <= 6) {
    return elemId as EnemyElemId
  }

  return null
}

function toEnemyElemArr(values: RawEnemyElem[] | undefined): EnemyElemId[] {
  if (!Array.isArray(values)) {
    return []
  }

  return values
      .map((value) => toEnemyElemI(value))
      .filter((value): value is EnemyElemId => value !== null)
}

// normalize one raw enemy catalog entry into the app shape
function normEnemyCat(entry: RawEnemyCatE): EnemyCatEnt | null {
  const enemyId = String(entry.Id ?? entry.id ?? '').trim()
  const enemyName = String(entry.Name ?? entry.name ?? '').trim()
  const enemyClass = Number(entry.Class ?? entry.class ?? 0)

  if (!enemyId || !enemyName || !isEnemyClssI(enemyClass)) {
    return null
  }

  const element = toEnemyElemI(entry.Element ?? entry.element)
  const elementArray = toEnemyElemArr(
    entry.ElementArray ??
        entry.elementArray ??
        entry.ElementIdArray ??
        entry.elementIdArray,
  )
  const icon = entry.Icon ?? entry.icon

  return {
    id: enemyId,
    name: enemyName,
    description: String(entry.Desc ?? entry.desc ?? '').trim(),
    descriptionOpen: String(entry.DescOpen ?? entry.descOpen ?? '').trim(),
    class: enemyClass as EnemyClassId,
    element,
    elementArray: elementArray.length > 0
      ? elementArray
      : element == null
        ? []
        : [element],
    icon: typeof icon === 'string' && icon.trim().length > 0
      ? icon.trim()
      : null,
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
    const mtchElem =
        options?.element == null ||
        entry.element === options.element ||
        entry.elementArray.includes(options.element)
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

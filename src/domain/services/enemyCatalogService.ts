/*
  Author: Runor Ewhro
  Description: Loads, normalizes, filters, and resolves enemy catalog data
               from the client-side enemy json source.
*/

import type { EnemyCatalogEntry, EnemyClassId, EnemyElementId } from '@/domain/entities/enemy'
import { isEnemyClassId, normalizeEnemyResistanceTable } from '@/domain/entities/enemy'

const ENEMY_DATA_URL = '/data/enemies.json'

interface RawEnemyCatalogEntry {
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

let enemyCatalogPromise: Promise<EnemyCatalogEntry[]> | null = null

// normalize a raw numeric element into a valid enemy element id
function toEnemyElementId(value: number | null | undefined): EnemyElementId | null {
  if (value == null) {
    return null
  }

  if (value >= 0 && value <= 6) {
    return value as EnemyElementId
  }

  return null
}

// normalize one raw enemy catalog entry into the app shape
function normalizeEnemyCatalogEntry(entry: RawEnemyCatalogEntry): EnemyCatalogEntry | null {
  const enemyId = String(entry.Id ?? '').trim()
  const enemyName = String(entry.Name ?? '').trim()
  const enemyClass = Number(entry.Class ?? 0)

  if (!enemyId || !enemyName || !isEnemyClassId(enemyClass)) {
    return null
  }

  return {
    id: enemyId,
    name: enemyName,
    description: String(entry.Desc ?? '').trim(),
    descriptionOpen: String(entry.DescOpen ?? '').trim(),
    class: enemyClass as EnemyClassId,
    element: toEnemyElementId(entry.Element),
    elementArray: Array.isArray(entry.ElementArray)
        ? entry.ElementArray
            .map((value) => toEnemyElementId(value))
            .filter((value): value is EnemyElementId => value !== null)
        : [],
    icon: typeof entry.Icon === 'string' && entry.Icon.trim().length > 0 ? entry.Icon : null,
    resistances: normalizeEnemyResistanceTable(entry.baseData?.res),
  }
}

// load and cache the enemy catalog from json
export async function loadEnemyCatalog(): Promise<EnemyCatalogEntry[]> {
  if (enemyCatalogPromise) {
    return enemyCatalogPromise
  }

  enemyCatalogPromise = fetch(ENEMY_DATA_URL)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Enemy catalog request failed with ${response.status}`)
        }

        const payload = (await response.json()) as RawEnemyCatalogEntry[]
        if (!Array.isArray(payload)) {
          throw new Error('Enemy catalog payload is not an array')
        }

        return payload
            .map((entry) => normalizeEnemyCatalogEntry(entry))
            .filter((entry): entry is EnemyCatalogEntry => entry !== null)
            .sort((left, right) => left.name.localeCompare(right.name))
      })
      .catch((error) => {
        enemyCatalogPromise = null
        throw error
      })

  return enemyCatalogPromise
}

// filter enemy catalog entries by search, element, and class
export function filterEnemyCatalog(
    entries: EnemyCatalogEntry[],
    options?: {
      search?: string
      element?: EnemyElementId | null
      enemyClass?: EnemyClassId | null
    },
): EnemyCatalogEntry[] {
  const search = options?.search?.trim().toLowerCase() ?? ''

  return entries.filter((entry) => {
    const matchesSearch =
        search.length === 0 ||
        entry.name.toLowerCase().includes(search) ||
        entry.id.includes(search)
    const matchesElement = options?.element == null || entry.element === options.element
    const matchesClass = options?.enemyClass == null || entry.class === options.enemyClass

    return matchesSearch && matchesElement && matchesClass
  })
}

// get one enemy catalog entry by id
export function getEnemyCatalogEntryById(
    entries: EnemyCatalogEntry[],
    enemyId: string | null | undefined,
): EnemyCatalogEntry | null {
  if (!enemyId) {
    return null
  }

  return entries.find((entry) => entry.id === enemyId) ?? null
}
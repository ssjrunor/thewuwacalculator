/*
  Author: Runor Ewhro
  Description: Cached Sonata set metadata loaded from JSON during
               calculator bootstrap.
*/

export interface SntSetDef {
  id: number
  name: string
  icon: string
}

export let SONATA_SETS: SntSetDef[] = []

let sntSetsById: Record<number, SntSetDef> = {}

export function initSntSets(sets: SntSetDef[]): void {
  SONATA_SETS = sets
  sntSetsById = Object.fromEntries(
      sets.map((set) => [set.id, set]),
  ) as Record<number, SntSetDef>
}

// get the display name for a Sonata set id
export function getSntSetNam(id: number): string {
  return sntSetsById[id]?.name ?? `Set ${id}`
}

// get the icon path for a Sonata set id
export function getSntSetIco(id: number): string | null {
  return sntSetsById[id]?.icon ?? null
}

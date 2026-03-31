/*
  Author: Runor Ewhro
  Description: Cached Sonata set metadata loaded from JSON during
               calculator bootstrap.
*/

export interface SonataSetDefinition {
  id: number
  name: string
  icon: string
}

export let SONATA_SETS: SonataSetDefinition[] = []

let sonataSetsById: Record<number, SonataSetDefinition> = {}

export function initSonataSets(sets: SonataSetDefinition[]): void {
  SONATA_SETS = sets
  sonataSetsById = Object.fromEntries(
      sets.map((set) => [set.id, set]),
  ) as Record<number, SonataSetDefinition>
}

// get the display name for a Sonata set id
export function getSonataSetName(id: number): string {
  return sonataSetsById[id]?.name ?? `Set ${id}`
}

// get the icon path for a Sonata set id
export function getSonataSetIcon(id: number): string | null {
  return sonataSetsById[id]?.icon ?? null
}

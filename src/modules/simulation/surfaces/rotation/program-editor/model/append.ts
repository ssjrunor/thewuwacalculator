/*
  Author: Runor Ewhro
  Description: What a rotation program can be appended from, and what
               appending does, so rotation surfaces offer the same
               sources and land the same nodes.
*/

import type { RotDef, RotationNode } from '@/domain/gameData/contracts.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { listResRttn } from '@/data/catalog/gameDataService.ts'
import { seedRsntById } from '@/modules/simulation/features/resonator/lib/seedData.ts'
import { currentTeamIds } from '@/modules/simulation/surfaces/rotation/shared/catalog.ts'
import {
  cloneRotationNodes,
  savedRotationItems,
  savedRotationResonatorId,
} from '@/domain/entities/inventoryStorage.ts'
import { isRotationSequence } from '@/domain/gameData/rotationSequence.ts'

/** one rotation source that can be appended to a program */
export interface AppendSource {
  value: string
  label: string
  items: RotationNode[]
}

function listPrstRots(resonatorId: string): RotDef[] {
  const seed = seedRsntById[resonatorId]
  const rotations = new Map<string, RotDef>()

  // preset rotations can arrive on either the seed or the game-data registry,
  // depending on which catalog path built the resonator object.
  for (const rotation of seed?.rotations ?? []) {
    rotations.set(rotation.id, rotation)
  }
  for (const rotation of listResRttn(resonatorId)) {
    rotations.set(rotation.id, rotation)
  }

  return Array.from(rotations.values()).filter((rotation) => rotation.items.length > 0)
}

export function makeAppendSource({
  runtime,
  saved,
}: {
  runtime: ResRuntime
  /** every saved rotation held, filtered here to compatible team members */
  saved: readonly SavedRotation[]
}): AppendSource[] {
  const options: AppendSource[] = []
  const teamIds = currentTeamIds(runtime)
  const seedName = seedRsntById[runtime.id]?.name ?? runtime.id

  if (runtime.rotation.sequence.length > 0) {
    options.push({
      value: `live:${runtime.id}`,
      label: `${seedName} · Current Rotation · Live`,
      items: runtime.rotation.sequence,
    })
  }

  // append should not require teammates to be saved first; their
  // authored presets are valid sources alongside live and saved rotations.
  for (const resonatorId of teamIds) {
    const memberSeed = seedRsntById[resonatorId]
    if (!memberSeed) {
      continue
    }

    for (const rotation of listPrstRots(resonatorId)) {
      options.push({
        value: `preset:${resonatorId}:${rotation.id}`,
        label: `${memberSeed.name} · ${rotation.label} · Preset`,
        items: rotation.items,
      })
    }
  }

  for (const entry of saved) {
    const resonatorId = savedRotationResonatorId(entry)
    const items = savedRotationItems(entry)
    if (!isRotationSequence(items, resonatorId) || !teamIds.includes(resonatorId)) {
      continue
    }

    options.push({
      value: `saved:${entry.id}`,
      label: `${seedRsntById[resonatorId]?.name ?? resonatorId} · ${entry.name} · Saved`,
      items,
    })
  }

  return options
}

/*
  the appended rotation is taken as a copy: the source keeps its own node
  identities, so appending the same rotation twice gives two of it rather than
  one rotation named twice.
*/
export function appendRotationCopies(items: readonly RotationNode[]): RotationNode[] {
  return cloneRotationNodes([...items], { freshIds: true })
}

/*
  Author: Runor Ewhro
  Description: Collects small rotation-ui helpers for labels, formatting,
               member lookups, and display-ready node metadata.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { InvRotEnt } from '@/domain/entities/inventoryStorage.ts'
import { cloneRotNds } from '@/domain/entities/inventoryStorage.ts'
import type { ResonatorId, TeamSlots } from '@/domain/entities/runtime.ts'
import { rmLoopMrkr } from './loops.ts'

export const ROT_CLIP_KIND = 'rotation-clipboard'
export const ROT_CLIP_VER = 1

type RotClpbSrc = 'personal' | 'team' | 'saved'

export interface RotClpbPay {
  kind: typeof ROT_CLIP_KIND
  version: typeof ROT_CLIP_VER
  source: RotClpbSrc
  mode: 'personal' | 'team'
  resonatorId: ResonatorId
  resName: string
  team?: TeamSlots
  items: RotationNode[]
  name?: string
  duration?: number
  note?: string
  savedEntries?: InvRotEnt[]
}

export function serRotClpbPa(payload: RotClpbPay): string {
  return JSON.stringify({
    ...payload,
    items: cloneRotNds(payload.items),
    ...(payload.team ? { team: [...payload.team] as TeamSlots } : {}),
    ...(payload.savedEntries
      ? {
          savedEntries: payload.savedEntries.map((entry) => ({
            ...structuredClone(entry),
            items: cloneRotNds(entry.items),
          })),
        }
      : {}),
  })
}

export function prsRotClpbPa(raw: string): RotClpbPay | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const source = parsed.source
    const mode = parsed.mode
    const items = parsed.items
    const resonatorId = parsed.resonatorId
    const resName = parsed.resName ?? parsed.resonatorName

    if (
      parsed.kind !== ROT_CLIP_KIND ||
      parsed.version !== ROT_CLIP_VER ||
      (source !== 'personal' && source !== 'team' && source !== 'saved') ||
      (mode !== 'personal' && mode !== 'team') ||
      typeof resonatorId !== 'string' ||
      typeof resName !== 'string' ||
      !Array.isArray(items)
    ) {
      return null
    }

    const team = Array.isArray(parsed.team)
      ? parsed.team.filter((entry): entry is string => typeof entry === 'string') as TeamSlots
      : undefined
    const prsSvdEnt = (rawEntry: unknown): InvRotEnt | null => {
      if (!rawEntry || typeof rawEntry !== 'object') {
        return null
      }

      const value = rawEntry as Record<string, unknown>
      if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        (value.mode !== 'personal' && value.mode !== 'team') ||
        typeof value.resonatorId !== 'string' ||
        typeof value.resonatorName !== 'string' ||
        !Array.isArray(value.items) ||
        typeof value.createdAt !== 'number' ||
        typeof value.updatedAt !== 'number'
      ) {
        return null
      }

      return {
        ...structuredClone(value),
        items: cloneRotNds(value.items as RotationNode[]),
      } as InvRotEnt
    }
    const savedEntries = Array.isArray(parsed.savedEntries)
      ? parsed.savedEntries
          .map((entry) => prsSvdEnt(entry))
          .filter((entry): entry is InvRotEnt => Boolean(entry))
      : parsed.savedEntry
        ? (() => {
            const savedEntry = prsSvdEnt(parsed.savedEntry)
            return savedEntry ? [savedEntry] : []
          })()
        : undefined

    return {
      kind: ROT_CLIP_KIND,
      version: ROT_CLIP_VER,
      source,
      mode,
      resonatorId,
      resName: resName,
      ...(team ? { team } : {}),
      items: cloneRotNds(items as RotationNode[]),
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.duration === 'number' ? { duration: parsed.duration } : {}),
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
      ...(savedEntries && savedEntries.length > 0 ? { savedEntries } : {}),
    }
  } catch {
    return null
  }
}

export function rmRotNds(items: RotationNode[], nodeIds: ReadonlySet<string>): RotationNode[] {
  const rmvdLoopIds = new Set<string>()
  for (const node of cllcRotNdsBy(items).values()) {
    if (nodeIds.has(node.id) && node.type === 'loop' && node.kind === 'start') {
      rmvdLoopIds.add(node.loopId)
    }
  }

  const nextItems = items
    .filter((item) => !nodeIds.has(item.id))
    .map((item) => {
      if (item.type === 'repeat') {
        return {
          ...item,
          items: rmRotNds(item.items, nodeIds),
        }
      }

      if (item.type === 'uptime') {
        return {
          ...item,
          setup: item.setup ? rmRotNds(item.setup, nodeIds) : item.setup,
          items: rmRotNds(item.items, nodeIds),
        }
      }

      return item
    })

  return rmLoopMrkr(nextItems, rmvdLoopIds)
}

export function cllcVsblRotN(items: RotationNode[], collapsedIds: Record<string, boolean>): string[] {
  const ids: string[] = []

  const visit = (node: RotationNode) => {
    ids.push(node.id)

    if (node.type === 'repeat') {
      if (collapsedIds[node.id]) {
        return
      }

      node.items.forEach(visit)
      return
    }

    if (node.type === 'uptime') {
      if (collapsedIds[node.id]) {
        return
      }

      ;(node.setup ?? []).forEach(visit)
      node.items.forEach(visit)
    }
  }

  items.forEach(visit)
  return ids
}

export function cllcRotNdsBy(items: RotationNode[]): Map<string, RotationNode> {
  const nodesById = new Map<string, RotationNode>()

  const visit = (node: RotationNode) => {
    nodesById.set(node.id, node)

    if (node.type === 'repeat') {
      node.items.forEach(visit)
      return
    }

    if (node.type === 'uptime') {
      ;(node.setup ?? []).forEach(visit)
      node.items.forEach(visit)
    }
  }

  items.forEach(visit)
  return nodesById
}

export function cllcSelRotNd(items: RotationNode[], selectedIds: ReadonlySet<string>): RotationNode[] {
  return Array.from(cllcRotNdsBy(items).values())
    .filter((node) => selectedIds.has(node.id))
}

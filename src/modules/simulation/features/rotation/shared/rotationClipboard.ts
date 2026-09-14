/*
  Author: Runor Ewhro
  Description: Owns rotation clipboard behavior and state transitions for the shared module.
*/

import { decShareText, encShareText } from '@/shared/lib/shareCodec.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import {
  cloneRotationNodes,
  savedRotationItems,
  savedRotationResonatorId,
  savedRotationTeam,
} from '@/domain/entities/inventoryStorage.ts'
import type { ResonatorId, TeamSlots } from '@/domain/entities/runtime.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { normalizeImportedRotationEntries } from '@/infra/imports/rotationPayload.ts'

export const ROT_CLIP_KIND = 'rotation-clipboard'
export const ROT_CLIP_VER = 1

type RotClipSource = 'rotation' | 'saved'

export interface RotClipPayload {
  kind: typeof ROT_CLIP_KIND
  version: typeof ROT_CLIP_VER
  source: RotClipSource
  resonatorId: ResonatorId
  resName: string
  team?: TeamSlots
  items: RotationNode[]
  name?: string
  duration?: number
  note?: string
  savedEntries?: SavedRotation[]
}

let rotClipCache: RotClipPayload | null = null

function cloneSavedEntry(entry: SavedRotation): SavedRotation {
  return structuredClone({
    id: entry.id,
    name: entry.name,
    duration: entry.duration,
    note: entry.note,
    scenario: entry.scenario,
    ...(entry.migration ? { migration: entry.migration } : {}),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  })
}

function cloneRotClip(payload: RotClipPayload): RotClipPayload {
  return {
    ...payload,
    items: cloneRotationNodes(payload.items),
    ...(payload.team ? { team: [...payload.team] as TeamSlots } : {}),
    ...(payload.savedEntries
      ? {
          savedEntries: payload.savedEntries.map(cloneSavedEntry),
        }
      : {}),
  }
}

export function makeSavedRotClip(entries: readonly SavedRotation[]): RotClipPayload | null {
  const first = entries[0]
  if (!first) return null

  return {
    kind: ROT_CLIP_KIND,
    version: ROT_CLIP_VER,
    source: 'saved',
    resonatorId: savedRotationResonatorId(first),
    resName: getResSeedBy(savedRotationResonatorId(first))?.name
      ?? savedRotationResonatorId(first),
    team: savedRotationTeam(first),
    items: cloneRotationNodes(entries.flatMap(savedRotationItems)),
    name: first.name,
    duration: first.duration,
    note: first.note,
    savedEntries: entries.map(cloneSavedEntry),
  }
}

export async function writeRotClip(payload: RotClipPayload): Promise<boolean> {
  const normalized = cloneRotClip(payload)
  rotClipCache = normalized

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return true
  }

  try {
    await navigator.clipboard.writeText(serializeRotClip(normalized))
    return true
  } catch {
    return false
  }
}

export async function readRotClip(): Promise<RotClipPayload | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return rotClipCache ? cloneRotClip(rotClipCache) : null
  }

  try {
    const parsed = parseRotClip(await navigator.clipboard.readText())
    rotClipCache = parsed ? cloneRotClip(parsed) : null
    return parsed
  } catch {
    return rotClipCache ? cloneRotClip(rotClipCache) : null
  }
}

export function serializeRotClip(payload: RotClipPayload): string {
  return encShareText(cloneRotClip(payload))
}

export function parseRotClip(raw: string): RotClipPayload | null {
  if (!raw) {
    return null
  }

  // share tokens decompress back to json; plain json from older copies still
  // parses unchanged.
  const jsonText = decShareText(raw)
  if (!jsonText) {
    return null
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const source = parsed.source
    const items = parsed.items
    const resonatorId = parsed.resonatorId
    const resName = parsed.resName ?? parsed.resonatorName

    if (
      parsed.kind !== ROT_CLIP_KIND ||
      parsed.version !== ROT_CLIP_VER ||
      (source !== 'personal' && source !== 'team' && source !== 'rotation' && source !== 'saved') ||
      typeof resonatorId !== 'string' ||
      typeof resName !== 'string' ||
      !Array.isArray(items)
    ) {
      return null
    }

    const team = Array.isArray(parsed.team)
      ? parsed.team.filter((entry): entry is string => typeof entry === 'string') as TeamSlots
      : undefined
    const prsSvdEnt = (rawEntry: unknown): SavedRotation | null => {
      if (!rawEntry || typeof rawEntry !== 'object') {
        return null
      }

      const value = rawEntry as Record<string, unknown>
      if (
        typeof value.id !== 'string' ||
        typeof value.name !== 'string' ||
        typeof value.createdAt !== 'number' ||
        typeof value.updatedAt !== 'number'
      ) {
        return null
      }
      const normalized = normalizeImportedRotationEntries(value)[0]
      if (!normalized) return null

      return {
        id: value.id,
        name: normalized.name,
        duration: normalized.duration ?? 0,
        note: normalized.note ?? '',
        scenario: normalized.scenario,
        createdAt: value.createdAt,
        updatedAt: value.updatedAt,
      }
    }
    const savedEntries = Array.isArray(parsed.savedEntries)
      ? parsed.savedEntries
          .map((entry) => prsSvdEnt(entry))
          .filter((entry): entry is SavedRotation => Boolean(entry))
      : parsed.savedEntry
        ? (() => {
            const savedEntry = prsSvdEnt(parsed.savedEntry)
            return savedEntry ? [savedEntry] : []
          })()
        : undefined

    return {
      kind: ROT_CLIP_KIND,
      version: ROT_CLIP_VER,
      source: source === 'saved' ? 'saved' : 'rotation',
      resonatorId,
      resName: resName,
      ...(team ? { team } : {}),
      items: cloneRotationNodes(items as RotationNode[]),
      ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}),
      ...(typeof parsed.duration === 'number' ? { duration: parsed.duration } : {}),
      ...(typeof parsed.note === 'string' ? { note: parsed.note } : {}),
      ...(savedEntries && savedEntries.length > 0 ? { savedEntries } : {}),
    }
  } catch {
    return null
  }
}

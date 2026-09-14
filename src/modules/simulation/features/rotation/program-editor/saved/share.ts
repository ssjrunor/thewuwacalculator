/*
  Author: Runor Ewhro
  Description: Implements the share logic for the saved module.
*/

import type { SavedRotation } from '@/domain/entities/inventoryStorage.ts'
import { createRemoteShare, encShareLink, encShareText } from '@/shared/lib/shareCodec.ts'

export function slugifyRotationFileName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function makeRotationExportPayload(entry: SavedRotation) {
  return {
    source: 'wuwa-calculator',
    kind: 'rotation-export',
    version: 2,
    exportedAt: new Date().toISOString(),
    rotation: {
      name: entry.name,
      duration: entry.duration,
      note: entry.note,
      scenario: structuredClone(entry.scenario),
    },
  }
}

export interface RotationShare {
  token: string
  link: string
  remote: boolean
}

export async function makeRotationShare(entry: SavedRotation): Promise<RotationShare> {
  const payload = makeRotationExportPayload(entry)
  const remote = await createRemoteShare(payload)
  if (remote) {
    return { token: remote.token, link: remote.url, remote: true }
  }
  return {
    token: encShareText(payload),
    link: encShareLink(payload),
    remote: false,
  }
}

/*
  Author: Runor Ewhro
  Description: Shared saved-build clipboard helpers for config and inventory surfaces.
*/

import { decShareText, encShareText } from '@/shared/lib/shareCodec.ts'
import type { SavedBuild } from '@/domain/entities/inventoryStorage.ts'
import { cloneBuildSnapshot } from '@/domain/entities/inventoryStorage.ts'

export const BUILD_CLIP_KIND = 'build-clipboard'
export const BUILD_CLIP_VER = 1

export interface BuildClipPayload {
  kind: typeof BUILD_CLIP_KIND
  version: typeof BUILD_CLIP_VER
  builds: SavedBuild[]
}

let cchdBuildClpb: BuildClipPayload | null = null

function cloneBuildEntry(entry: SavedBuild): SavedBuild {
  return {
    ...entry,
    build: cloneBuildSnapshot(entry.build),
  }
}

export function mkBuildClpbPa(builds: SavedBuild[]): BuildClipPayload {
  return {
    kind: BUILD_CLIP_KIND,
    version: BUILD_CLIP_VER,
    builds: builds.map(cloneBuildEntry),
  }
}

export function serBuildClpb(payload: BuildClipPayload): string {
  return encShareText({
    ...payload,
    builds: payload.builds.map(cloneBuildEntry),
  })
}

export function prsBuildClpbP(raw: string): BuildClipPayload | null {
  if (!raw) {
    return null
  }

  try {
    const jsonText = decShareText(raw)
    if (!jsonText) {
      return null
    }
    const parsed = JSON.parse(jsonText) as Record<string, unknown>
    const wrapped =
      parsed.kind === BUILD_CLIP_KIND
      && parsed.version === BUILD_CLIP_VER
    // Accept the current wrapped payload plus older ad hoc shapes used by local
    // copy/paste experiments: raw arrays, single entries, or wrapped aliases.
    const builds = wrapped
      ? parsed.builds ?? parsed.entries ?? parsed.items
      : Array.isArray(parsed)
        ? parsed
        : [parsed]

    if (!Array.isArray(builds)) {
      return null
    }

    const nrmlBlds = builds
      .filter((entry): entry is SavedBuild => Boolean(entry && typeof entry === 'object'))
      .filter((entry) =>
        typeof entry.id === 'string'
        && typeof entry.name === 'string'
        && typeof entry.resonatorId === 'string'
        && typeof entry.resonatorName === 'string'
        && Boolean(entry.build)
        && typeof entry.build === 'object'
        && Array.isArray(entry.build.echoes)
        && Boolean(entry.build.weapon)
        && typeof entry.build.weapon === 'object',
      )
      .map(cloneBuildEntry)

    return nrmlBlds.length > 0
      ? {
        kind: BUILD_CLIP_KIND,
        version: BUILD_CLIP_VER,
        builds: nrmlBlds,
      }
      : null
  } catch {
    return null
  }
}

export async function writeBuildClpb(payload: BuildClipPayload): Promise<boolean> {
  const nrmlPay = mkBuildClpbPa(payload.builds)
  cchdBuildClpb = nrmlPay

  // The in-memory cache keeps same-session paste working when Clipboard API
  // access is unavailable or denied by the browser.
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return true
  }

  try {
    await navigator.clipboard.writeText(serBuildClpb(nrmlPay))
    return true
  } catch {
    return false
  }
}

export async function readBuildClpb(): Promise<BuildClipPayload | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return cchdBuildClpb ? mkBuildClpbPa(cchdBuildClpb.builds) : null
  }

  try {
    const text = await navigator.clipboard.readText()
    const parsed = prsBuildClpbP(text)
    cchdBuildClpb = parsed ? mkBuildClpbPa(parsed.builds) : null
    return parsed
  } catch {
    return cchdBuildClpb ? mkBuildClpbPa(cchdBuildClpb.builds) : null
  }
}

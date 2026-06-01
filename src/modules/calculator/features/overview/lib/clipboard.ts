/*
  Author: Runor Ewhro
  Description: Serializes and parses overview resonator profile clipboard
               payloads so overview menus can copy, cut, and paste full
               calculator profiles with overwrite semantics by resonator id.
*/

import type { ResProf } from '@/domain/entities/profile.ts'
import type { ResonatorId } from '@/domain/entities/runtime.ts'
import { cloneResProf } from '@/domain/state/runtimeCloning.ts'

export const PROF_CLIP_KEY = 'overview-profile-clipboard'
export const PROF_CLIP_VER = 1

export interface ProfileClip {
  resonatorId: ResonatorId
  resonatorName: string
  profile: ResProf
}

export interface ProfileClipPay {
  kind: typeof PROF_CLIP_KEY
  version: typeof PROF_CLIP_VER
  profiles: ProfileClip[]
}

let cachedProfile: ProfileClipPay | null = null

function cloneClipEntry(entry: ProfileClip): ProfileClip {
  return {
    resonatorId: entry.resonatorId,
    resonatorName: entry.resonatorName,
    profile: cloneResProf(entry.profile),
  }
}

export function cloneProfiles(
  profiles: ProfileClip[],
): ProfileClip[] {
  return profiles.map((entry) => cloneClipEntry(entry))
}

export function makeProfileClip(
  profiles: ProfileClip[],
): ProfileClipPay {
  return {
    kind: PROF_CLIP_KEY,
    version: PROF_CLIP_VER,
    profiles: cloneProfiles(profiles),
  }
}

export function serializeClip(
  payload: ProfileClipPay,
): string {
  return JSON.stringify({
    ...payload,
    profiles: cloneProfiles(payload.profiles),
  })
}

export function parseProfClip(raw: string): ProfileClipPay | null {
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const profiles = parsed.profiles

    if (
      parsed.kind !== PROF_CLIP_KEY
      || parsed.version !== PROF_CLIP_VER
      || !Array.isArray(profiles)
    ) {
      return null
    }

    const validProfiles = profiles.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const candidate = entry as Record<string, unknown>
      if (
        typeof candidate.resonatorId !== 'string'
        || typeof candidate.resonatorName !== 'string'
        || !candidate.profile
        || typeof candidate.profile !== 'object'
      ) {
        return []
      }

      const profile = candidate.profile as ResProf
      if (typeof profile.resonatorId !== 'string' || profile.resonatorId !== candidate.resonatorId) {
        return []
      }

      return [{
        resonatorId: candidate.resonatorId,
        resonatorName: candidate.resonatorName,
        profile: cloneResProf(profile),
      }]
    })

    if (validProfiles.length === 0) {
      return null
    }

    return {
      kind: PROF_CLIP_KEY,
      version: PROF_CLIP_VER,
      profiles: validProfiles,
    }
  } catch {
    return null
  }
}

export async function writeProfClip(
  payload: ProfileClipPay,
): Promise<boolean> {
  const nrmlPay = {
    ...payload,
    profiles: cloneProfiles(payload.profiles),
  }

  cachedProfile = nrmlPay

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return true
  }

  try {
    await navigator.clipboard.writeText(serializeClip(nrmlPay))
    return true
  } catch {
    return false
  }
}

export async function readProfClip(): Promise<ProfileClipPay | null> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
    return cachedProfile
      ? {
        ...cachedProfile,
        profiles: cloneProfiles(cachedProfile.profiles),
      }
      : null
  }

  try {
    const text = await navigator.clipboard.readText()
    const parsed = parseProfClip(text)
    cachedProfile = parsed
      ? {
        ...parsed,
        profiles: cloneProfiles(parsed.profiles),
      }
      : null
    return parsed
  } catch {
    return cachedProfile
      ? {
        ...cachedProfile,
        profiles: cloneProfiles(cachedProfile.profiles),
      }
      : null
  }
}

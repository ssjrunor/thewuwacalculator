/*
  Author: Runor Ewhro
  Description: Keeps build-import destinations explicit. A resonator can own a
               standalone context build and also appear as a teammate in the
               active team, so its id alone is not enough to choose a runtime.
*/

import type { ResProf } from '@/domain/entities/profile.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'

export type EchoImportDestination =
  | { kind: 'context'; resonatorId: string }
  | { kind: 'team'; resonatorId: string; slotIndex: number }

export function resolveEchoImportRuntime(
  destination: EchoImportDestination | null,
  contextRuntimes: Record<string, ResRuntime>,
  teamRuntimes: Record<string, ResRuntime>,
): ResRuntime | null {
  if (!destination) return null

  return destination.kind === 'context'
    ? contextRuntimes[destination.resonatorId] ?? null
    : teamRuntimes[destination.resonatorId] ?? null
}

export function mergeEchoImportIntoProfile(
  profile: ResProf,
  runtime: ResRuntime,
): ResProf {
  return {
    ...profile,
    runtime: {
      ...profile.runtime,
      progression: {
        ...profile.runtime.progression,
        level: runtime.base.level,
        sequence: runtime.base.sequence,
        skillLevels: { ...runtime.base.skillLevels },
      },
      build: {
        weapon: { ...runtime.build.weapon },
        echoes: [...runtime.build.echoes],
      },
      local: {
        ...profile.runtime.local,
        controls: { ...runtime.state.controls },
      },
    },
  }
}

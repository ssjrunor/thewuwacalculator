/*
  Author: Runor Ewhro
  Description: Builds stable signatures for materialized resonator runtimes.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'

// serialize the runtime fields that change calculator and optimizer behavior.
export function runtimeSig(runtime: ResRuntime): string {
  return JSON.stringify({
    id: runtime.id,
    base: runtime.base,
    build: {
      weapon: runtime.build.weapon,
      team: runtime.build.team,
      echoes: runtime.build.echoes.map((echo) => (
        echo
          ? {
            uid: echo.uid,
            id: echo.id,
            set: echo.set,
            mainEcho: echo.mainEcho,
            mainStats: echo.mainStats,
            substats: Object.entries(echo.substats).sort(([left], [right]) => left.localeCompare(right)),
          }
          : null
      )),
    },
    state: {
      controls: Object.entries(runtime.state.controls).sort(([left], [right]) => left.localeCompare(right)),
      manualBuffs: runtime.state.manualBuffs,
      combat: runtime.state.combat,
    },
    rotation: runtime.rotation,
    teamRuntimes: runtime.teamRuntimes,
  })
}

/*
  Author: Runor Ewhro
  description: builds the cleanup source context for the editor: the sources the
               current team, gear and enemy provide, and the control paths whose
               recipient depends on local activation.
*/

import { makeSourceKey } from '@/data/gameData/registry.ts'
import { rotationTeamStates } from '@/engine/rotation/openingChoices.ts'
import type { RotationMember } from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import type { CleanupSourceContext } from './cleanup.ts'
import { listEffectsFor } from '@/data/catalog/gameDataService.ts'
import { activeOtherTargetGroups } from '@/engine/effects/activeOtherTargets.ts'
import { listRtSrcRef } from '@/engine/services/runtimeSourceService.ts'

/*
  collect cleanup sources for the visible members.
  - available: each member, its weapon, echoes and echo sets, shared team
    states, and both enemy identities
  - recipient sensitive: `state.controls.*` paths of effects that target the
    active other member, keyed as member NUL runtime path
  a weapon id of '0' means no weapon is equipped.
*/
export function rotationCleanupSources(members: readonly RotationMember[], enemyId: string): CleanupSourceContext & { availableSources: ReadonlySet<string> } {
  const availableSources = new Set<string>()
  const recipientSensitivePaths = new Set<string>()
  for (const member of members) {
    availableSources.add(makeSourceKey({ type: 'resonator', id: member.id }))
    const weaponId = member.runtime.build.weapon.id
    if (weaponId && weaponId !== '0') availableSources.add(makeSourceKey({ type: 'weapon', id: weaponId }))
    for (const echo of member.runtime.build.echoes) if (echo) {
      availableSources.add(makeSourceKey({ type: 'echo', id: echo.id }))
      availableSources.add(makeSourceKey({ type: 'echoSet', id: String(echo.set) }))
    }
    const sources = [...listRtSrcRef(member.runtime),
      ...weaponId && weaponId !== '0' ? [{ type: 'weapon' as const, id: weaponId }] : [],
      ...[...new Set(member.runtime.build.echoes.flatMap(echo => echo ? [echo.set] : []))]
        .map(set => ({ type: 'echoSet' as const, id: String(set) }))]
    for (const group of activeOtherTargetGroups(sources.flatMap(source => listEffectsFor(source.type, source.id)))) {
      for (const path of group.paths) if (path.startsWith('state.controls.')) {
        recipientSensitivePaths.add(`${member.id}\u0000runtime.${path}`)
      }
    }
  }
  for (const state of rotationTeamStates(members.map(member => member.runtime))) {
    availableSources.add(makeSourceKey(state.source))
  }
  // enemy controls use the synthetic 'target' id; authored enemy packages use the enemy id
  availableSources.add(makeSourceKey({ type: 'enemy', id: 'target' }))
  availableSources.add(makeSourceKey({ type: 'enemy', id: enemyId }))
  return { availableSources, recipientSensitivePaths }
}

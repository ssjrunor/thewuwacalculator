/*
  Author: Runor Ewhro
  description: collects editor controls, opening values, and recipient activation paths.
*/

import type { RuntimeValue } from '../types.ts'
import type { CombatScenario } from '../../../domain/entities/combatScenario'
import { initEchoSetD } from '../../../data/gameData/echoSets/effects.ts'
import { mkActRt, mkPartRtLkp } from '../../runtime/runtimeAdapters.ts'
import { negEffectsFor } from '../../gameData/negativeEffects.ts'
import { rotationStateChoices, scenarioOpeningValues } from '../../rotation/openingChoices.ts'
import { listEffectsFor } from '../../../data/catalog/gameDataService.ts'
import { activeOtherTargetGroups } from '../../effects/activeOtherTargets.ts'
import { listRtSrcRef } from '../../services/runtimeSourceService.ts'

/**
 * the states the rotation editor offers for this scenario, and the values its
 * Generate Preamble opens them at. the scenario's own values (a seat's
 * resonance mode) carry into the opening; nothing else is written that the
 * editor could not add by hand.
 */
export function prepareEditorSources({ scenario, resonators, echoes, sonataDefinitions }: {
  scenario: CombatScenario
  resonators: RuntimeValue
  echoes: RuntimeValue
  sonataDefinitions: RuntimeValue
}): RuntimeValue {
  initEchoSetD(sonataDefinitions)
  const actRt = mkActRt(scenario)
  if (!actRt) throw new Error('Scenario has no active member runtime')
  const runtimesById = { ...mkPartRtLkp(scenario), [actRt.id]: actRt }
  const preambleChoices = rotationStateChoices(actRt, runtimesById, scenario.target.id)
  // an enemy effect the team resolves at a fixed stack count (Glacio Bite)
  // has no stacks to write; its status updates are left to the resolver.
  const fixedStatuses = new Set(negEffectsFor(actRt, runtimesById)
    .filter((effect) => !effect.sliderVisible).map((effect) => effect.key))
  // a control behind an Active Other buff: the app pins the buff to whoever is active when it turns on
  // activation paths are source-qualified because separate members can expose the same equipment control.
  const activeOtherControls = new Set<string>()
  for (const runtime of Object.values(runtimesById) as RuntimeValue[]) {
    const sources = [...listRtSrcRef(runtime), ...(runtime.build.weapon.id ? [{ type: 'weapon' as const, id: runtime.build.weapon.id }] : []),
      ...[...new Set((runtime.build.echoes as RuntimeValue[]).flatMap((echo) => echo ? [echo.set] : []))]
        .map((set) => ({ type: 'echoSet' as const, id: String(set) }))]
    for (const group of activeOtherTargetGroups(sources.flatMap((source) => listEffectsFor(source.type, source.id)))) {
      for (const path of group.paths) if (path.startsWith('state.controls.')) activeOtherControls.add(`${runtime.id}|runtime.${path}`)
    }
  }
  return { resonators, echoes, preambleChoices, preambleValues: scenarioOpeningValues(runtimesById),
    fixedStatuses, activeOtherControls, effectControls: {}, castControls: {} }
}

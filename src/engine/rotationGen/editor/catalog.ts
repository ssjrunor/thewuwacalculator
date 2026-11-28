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
import { listRtSrcRef, makeSourceCat } from '../../services/runtimeSourceService.ts'

// the states the rotation editor offers for this scenario, and the values its Generate Preamble opens them at; the
// scenario's own values (a seat's resonance mode) are applied to the opening, and nothing else is written that the
// editor could not add by hand
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
  // an enemy effect the team resolves at a fixed stack count (Glacio Bite) has no stacks to write; its status updates
  // are left to the resolver
  const fixedStatuses = new Set(negEffectsFor(actRt, runtimesById)
    .filter((effect) => !effect.sliderVisible).map((effect) => effect.key))
  // a control behind an Active Other buff: the app pins the buff to whoever is active when it turns on; activation
  // paths are source-qualified because separate members can expose the same equipment control
  const activeOtherControls = new Set<string>()
  const equipmentEffects: RuntimeValue = {}
  const negativeCapControls = new Set<string>()
  const capDependencies = (condition: RuntimeValue, sourceId: string): void => {
    if (!condition || typeof condition !== 'object') return
    if (typeof condition.path === 'string') {
      const path = condition.path.replace(/^(sourceRuntime|runtime)\./, '')
      if (path.startsWith('state.')) {
        const owners = condition.from === 'sourceRuntime' || condition.path.startsWith('sourceRuntime.')
          ? [sourceId] : Object.keys(runtimesById)
        for (const owner of owners) negativeCapControls.add(`${owner}|runtime.${path}`)
      }
    }
    for (const value of Object.values(condition)) {
      if (Array.isArray(value)) value.forEach(part => capDependencies(part, sourceId))
      else if (value && typeof value === 'object') capDependencies(value, sourceId)
    }
  }
  for (const runtime of Object.values(runtimesById) as RuntimeValue[]) {
    for (const source of resonators[runtime.id]?.details?.negativeEffectSources ?? []) {
      capDependencies(source.enabledWhen, runtime.id)
    }
    const sources = [...listRtSrcRef(runtime), ...(runtime.build.weapon.id ? [{ type: 'weapon' as const, id: runtime.build.weapon.id }] : []),
      ...[...new Set((runtime.build.echoes as RuntimeValue[]).flatMap((echo) => echo ? [echo.set] : []))]
        .map((set) => ({ type: 'echoSet' as const, id: String(set) }))]
    equipmentEffects[runtime.id] = sources.filter(source => source.type !== 'resonator')
      .flatMap(source => listEffectsFor(source.type, source.id))
    for (const group of activeOtherTargetGroups(sources.flatMap((source) => listEffectsFor(source.type, source.id)))) {
      for (const path of group.paths) if (path.startsWith('state.controls.')) activeOtherControls.add(`${runtime.id}|runtime.${path}`)
    }
  }
  const equipmentFeatures = Object.fromEntries(Object.values(runtimesById).map(runtime => [runtime.id,
    makeSourceCat(runtime).features.filter(feature => feature.source.type === 'echoSet')]))
  return { resonators, echoes, equipmentFeatures, equipmentEffects, preambleChoices, preambleValues: scenarioOpeningValues(runtimesById),
    fixedStatuses, activeOtherControls, negativeCapControls, effectControls: {}, castControls: {} }
}

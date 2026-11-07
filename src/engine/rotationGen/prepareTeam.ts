/*
  Author: Runor Ewhro
  description: builds interpreter members and initial enemy state from a scenario.
*/

import type { RuntimeValue } from './types'
import { prepareEquipment } from './gear/index'
import { initialCharacterState } from './initialState'
import { unisonBoonMax } from '../../domain/gameData/unisonBoon'
import { buildupRateEffects, offTuneByAction } from './events/offTune'

/** prepare trigger inputs, not an independently simulated build or resource budget. */
export function prepareInterpreterState({ scenario, mode, weaponBundles, resonatorBundles,
  echoCatalog, gearLibrary, rulesets, damageEntries = [], maxFrames = 7200 }: RuntimeValue): RuntimeValue {
  // member order is the authored replay order; scenario progression, controls, and equipment supply all trigger inputs.
  const members = scenario.team.members.map((source: RuntimeValue) => ({
    resonatorId: Number(source.resonatorId),
    element: ({ aero: 64, electro: 128, fusion: 192, glacio: 256, spectro: 320, havoc: 384, physical: 448 } as Record<string, number>)[resonatorBundles?.[source.resonatorId]?.seed.attribute],
    build: { level: source.progression.level, sequence: source.progression.sequence },
    baseTuneBreakBoost: resonatorBundles?.[source.resonatorId]?.seed.baseStats.tuneBreakBoost ?? 0,
    offTuneByAction: resonatorBundles?.[source.resonatorId]
      ? offTuneByAction(rulesets[source.resonatorId], resonatorBundles[source.resonatorId].source, damageEntries) : {},
    buildupRateEffects: buildupRateEffects(resonatorBundles?.[source.resonatorId]?.source ?? {}),
    initialState: initialCharacterState(rulesets[source.resonatorId], source),
    initialControls: { ...Object.fromEntries((resonatorBundles?.[source.resonatorId]?.details.stateGraph?.nodes ?? [])
      .map((node: RuntimeValue) => [node.key, node.defaultValue])), ...structuredClone(source.local.controls) }, initialHpRatio: source.initialHpRatio ?? 1,
    ...prepareEquipment({ loadout: source.loadout, weaponBundle: weaponBundles[source.loadout.weapon.id],
      echoCatalog, gearLibrary }),
  }))
  // clone enemy state because replay writes counters and shifting flags without changing the supplied scenario.
  return { mode, framesPerSecond: 60, maxFrames, members,
    unisonBoon: { stacks: scenario.environment.teamEffects?.unisonBoon ?? 0, max: unisonBoonMax(scenario.team.members) },
    initialEnemy: { ...structuredClone(scenario.environment.combatState),
      tuneStrainInterferedStacks: scenario.target.status?.tuneStrain ?? 0,
      tuneRuptureShifting: scenario.target.status?.tuneRuptureShifting ?? false,
      tuneStrainShifting: scenario.target.status?.tuneStrainShifting ?? false },
    target: structuredClone(scenario.target) }
}

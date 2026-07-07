/*
  Author: Runor Ewhro
  Description: compiles the optimizer payload for single target-skill mode
               by building the target context, encoding inventory echoes,
               and attaching the shared optimizer data needed for execution.
*/

import type { OptStartPay, PrepTargetSkill } from '@/engine/optimizer/types.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import { encStatCstrs } from '@/engine/optimizer/constraints/statConstraints.ts'
import { mkMainEchoRo, encEchoRows } from '@/engine/optimizer/encode/echoes.ts'
import { buildSetRows, makeSetMask } from '@/engine/optimizer/encode/sets.ts'
import { compOptTgtCt } from '@/engine/optimizer/target/context.ts'
import { mkShrdPay, stripEchoes } from '@/engine/optimizer/compiler/shared.ts'

// compile the optimizer for a single selected target skill
// this is the main bridge from editable runtime state into the packed payload
// that later cpu and gpu execution paths consume
export function compTgtRun(input: OptStartPay): PrepTargetSkill {
  // remove currently equipped echoes so the optimizer evaluates only inventory echoes
  const runtime = stripEchoes(input.runtime)

  // rebuild participant runtimes from the stripped runtime so target context
  // generation has the correct team-wide state available
  const participants = makeRuntimeMap(runtime)

  // compile the selected skill into the packed target context inputs
  const target = compOptTgtCt({
    runtime,
    resonatorId: input.resonatorId,
    resSeed: input.resSeed,
    skillId: input.settings.targetSkillId!,
    enemy: input.enemyProfile,
    runtimesById: participants,
    selectedTargets: input.selectedTargets,
  })

  // encode stat-floor and stat-cap style optimizer constraints from settings
  const constraints = encStatCstrs(input.settings)

  // encode the inventory echoes using the selected target skill shape
  const encoded = encEchoRows(input.invChs, target.selectedSkill, 'self')

  // build the shared payload used by both target and rotation optimizer modes
  const shared = mkShrdPay(encoded, input, constraints)

  // capture the current runtime set state so evaluation can merge runtime sets correctly
  const setRtMask = makeSetMask(runtime, input.setConds)
  const setConstLut = buildSetRows(runtime, input.setConds)

  // precompute main-echo buff rows for all inventory echoes against this selected skill
  const mainEchoBuffs = mkMainEchoRo({
    echoes: input.invChs,
    runtime,
    sourceBaseStats: target.combat.baseStats,
    sourceFinals: target.combat.finalStats,
    selectedSkill: target.selectedSkill,
    mode: 'self',
  })

  return {
    mode: 'targetSkill',
    ...shared,
    runtime,
    skill: target.skill,
    selectedSkill: target.selectedSkill,
    sourceBaseStats: target.combat.baseStats,
    sourceFinals: target.combat.finalStats,
    compiled: target.compiled,
    setRtMask: setRtMask,
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
  }
}

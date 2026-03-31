/*
  author: Runor Ewhro
  description: compiles the optimizer payload for single target-skill mode
               by building the target context, encoding inventory echoes,
               and attaching the shared optimizer data needed for execution.
*/

import type { OptimizerStartPayload, PreparedTargetSkillRun } from '@/engine/optimizer/types'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters'
import { encodeStatConstraints } from '@/engine/optimizer/rebuild/encode/constraints'
import { buildMainEchoRows, encodeEchoRows } from '@/engine/optimizer/rebuild/encode/echoes'
import { buildSetRows, buildSetRuntimeMask } from '@/engine/optimizer/rebuild/encode/sets'
import { compileOptimizerTargetContext } from '@/engine/optimizer/rebuild/target/context'
import { buildSharedPayload, stripEchoes } from '@/engine/optimizer/rebuild/compiler/shared'

// compile the optimizer for a single selected target skill
export function compileTargetRun(input: OptimizerStartPayload): PreparedTargetSkillRun {
  // remove currently equipped echoes so the optimizer evaluates only inventory echoes
  const runtime = stripEchoes(input.runtime)

  // rebuild participant runtimes from the stripped runtime so target context
  // generation has the correct team-wide state available
  const participants = buildRuntimeParticipantLookup(runtime)

  // compile the selected skill into the packed target context inputs
  const target = compileOptimizerTargetContext({
    runtime,
    resonatorId: input.resonatorId,
    skillId: input.settings.targetSkillId!,
    enemy: input.enemyProfile,
    runtimesById: participants,
    selectedTargetsByOwnerKey: input.selectedTargetsByOwnerKey,
  })

  // encode stat-floor and stat-cap style optimizer constraints from settings
  const constraints = encodeStatConstraints(input.settings)

  // encode the inventory echoes using the selected target skill shape
  const encoded = encodeEchoRows(input.inventoryEchoes, target.selectedSkill, 'self')

  // build the shared payload used by both target and rotation optimizer modes
  const shared = buildSharedPayload(encoded, input, constraints)

  // capture the current runtime set state so evaluation can merge runtime sets correctly
  const setRuntimeMask = buildSetRuntimeMask(runtime)
  const setConstLut = buildSetRows(runtime)

  // precompute main-echo buff rows for all inventory echoes against this selected skill
  const mainEchoBuffs = buildMainEchoRows({
    echoes: input.inventoryEchoes,
    runtime,
    sourceBaseStats: target.combat.baseStats,
    sourceFinalStats: target.combat.finalStats,
    selectedSkill: target.selectedSkill,
    mode: 'self',
  })

  return {
    mode: 'targetSkill',
    ...shared,
    runtime,
    skill: target.skill,
    compiled: target.compiled,
    setRuntimeMask,
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs,
  }
}
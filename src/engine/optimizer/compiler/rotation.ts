/*
  Author: Runor Ewhro
  Description: Compiles an optimizer payload for rotation mode by building
               combat contexts for all relevant rotation targets, packing
               per-target execution contexts, and attaching the shared
               encoded echo/set data required by the optimizer runtime.
*/

import type { ResonatorRuntimeState } from '@/domain/entities/runtime.ts'
import type { SkillDefinition } from '@/domain/entities/stats.ts'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService.ts'
import { buildTransientCombatGraph, findCombatParticipantSlotId } from '@/domain/state/combatGraph.ts'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters.ts'
import type { OptimizerTargetSkill } from '@/engine/optimizer/target/selectedSkill.ts'
import { selectOptimizerTargetSkill } from '@/engine/optimizer/target/selectedSkill.ts'
import type { CompiledTargetSkillContext, OptimizerStartPayload, PreparedRotationRun } from '@/engine/optimizer/types.ts'
import { buildCombatContext } from '@/engine/pipeline/buildCombatContext.ts'
import { buildPreparedRotationEnvironment, runFeatureSimulation } from '@/engine/rotation/system.ts'
import { encodeStatConstraints } from '@/engine/optimizer/constraints/statConstraints.ts'
import { buildGenericMainEchoRows, encodeEchoRows } from '@/engine/optimizer/encode/echoes.ts'
import { buildSetRows, buildSetRuntimeMask } from '@/engine/optimizer/encode/sets.ts'
import { buildSharedPayload, stripEchoes } from '@/engine/optimizer/compiler/shared.ts'
import { applyPersonalRotationItems } from '@/engine/optimizer/rotation/runtime.ts'
import { packTargetContext } from '@/engine/optimizer/context/pack.ts'
import { buildCompiledOptimizerContext } from '@/engine/optimizer/context/compiled.ts'
import { isOptimizerRotationTarget } from '@/engine/optimizer/rules/eligibility.ts'
import {
  OPTIMIZER_CONTEXT_FLOATS,
} from '@/engine/optimizer/config/constants.ts'

// Fallback synthetic target used only when the rotation simulation
// produces no eligible target entries for the active resonator.
function createFallbackTarget(seedId: string): OptimizerTargetSkill {
  return {
    id: `rotation:${seedId}`,
    tab: 'rotation',
    element: 'physical',
    skillType: [],
    archetype: 'skillDamage',
  }
}

// Build the fully compiled scalar context for one rotation target.
// This strips away most object lookups and prepares the numeric values
// that will later be packed into the optimizer context float array.
function buildCompiledContext(options: {
  resonatorId: string
  runtime: ResonatorRuntimeState
  skill: SkillDefinition
  combat: ReturnType<typeof buildCombatContext>
  enemy: OptimizerStartPayload['enemyProfile']
}): CompiledTargetSkillContext {
  const { resonatorId, runtime, skill, combat, enemy } = options

  return buildCompiledOptimizerContext({
    resonatorId,
    runtime,
    skill,
    finalStats: combat.finalStats,
    enemy,
    combatState: runtime.state.combat,
  })
}

// Main rotation compiler entrypoint.
// This prepares everything needed for optimizer execution in rotation mode:
// - stripped runtime
// - rotation-applied runtime
// - team combat graph
// - target list
// - packed target contexts
// - encoded inventory echo rows
// - set LUT and main-echo buff rows
export function compileRotationRun(input: OptimizerStartPayload): PreparedRotationRun {
  const seed = input.resonatorSeed ?? getResonatorSeedById(input.resonatorId)
  if (!seed) {
    throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  }

  // The optimizer should evaluate inventory echoes independently of any currently
  // equipped echoes, so we strip echoes from the runtime before building contexts.
  const runtime = stripEchoes(input.runtime)

  // Apply personal rotation setup items so the runtime reflects the actual
  // rotation state we want to optimize against.
  const rotationRuntime: ResonatorRuntimeState = applyPersonalRotationItems(runtime, input.rotationItems)

  // Build participant runtimes for the full active team.
  const participants = buildRuntimeParticipantLookup(rotationRuntime)

  // Build a transient combat graph so we can evaluate all involved teammates
  // under the same combat snapshot.
  const graph = buildTransientCombatGraph({
    activeRuntime: rotationRuntime,
    activeSeed: seed,
    participantRuntimes: participants,
    selectedTargetsByResonatorId: {
      [rotationRuntime.id]: input.selectedTargetsByOwnerKey ?? {},
    },
  })

  // Build the active resonator's combat context first. This is reused often.
  const activeContext = buildCombatContext({
    graph,
    targetSlotId: 'active',
    enemy: input.enemyProfile,
  })

  // Run the feature simulation so we can discover which rotation entries are
  // valid optimizer targets.
  const rotationEnvironment = buildPreparedRotationEnvironment(activeContext, seed)
  const simulated = runFeatureSimulation(activeContext, seed, participants, rotationEnvironment)

  // Keep only optimizer-eligible rotation targets for the active resonator.
  const targets = simulated.rotations.personal.entries.filter((entry) =>
      isOptimizerRotationTarget(entry, input.resonatorId),
  )

  // Encode the optimizer constraints from UI settings such as stat floors, etc.
  const constraints = encodeStatConstraints(input.settings)

  // Use the first real target if available. Otherwise synthesize a fallback
  // target so the generic echo encoders still have a stable skill shape to use.
  const fallbackTarget = targets[0]
      ? selectOptimizerTargetSkill(targets[0].skill)
      : createFallbackTarget(seed.id)

  // Encode all inventory echoes once using the fallback target shape.
  // The actual per-target differences are handled later in packed contexts.
  const encoded = encodeEchoRows(input.inventoryEchoes, fallbackTarget, 'self')

  // Build shared optimizer payload pieces such as costs, sets, kinds, combo maps, etc.
  const shared = buildSharedPayload(encoded, input, constraints)

  // Runtime mask describing already-active set state in the stripped runtime.
  const setRuntimeMask = buildSetRuntimeMask(rotationRuntime, input.setConditionals)

  // Constant set rows used during evaluation for set logic.
  const setConstLut = buildSetRows(rotationRuntime, input.setConditionals)

  // Precompute generic main-echo buff rows for all inventory echoes.
  // In rotation mode these are not tied to one single selected skill shape.
  const mainEchoBuffs = buildGenericMainEchoRows({
    echoes: input.inventoryEchoes,
    runtime: rotationRuntime,
    sourceBaseStats: activeContext.baseStats,
    sourceFinalStats: activeContext.finalStats,
    mode: 'self',
  })

  // If there are no optimizer targets, return a structurally valid empty rotation run.
  if (targets.length === 0) {
    return {
      mode: 'rotation',
      ...shared,
      contextStride: OPTIMIZER_CONTEXT_FLOATS,
      contextCount: 0,
      contexts: new Float32Array(0),
      contextWeights: new Float32Array(0),
      displayContext: new Float32Array(OPTIMIZER_CONTEXT_FLOATS),
      stats: encoded.stats,
      setConstLut,
      mainEchoBuffs,
    }
  }

  // Cache combat contexts by resonator id so each teammate's combat context
  // is only built once even if multiple rotation entries belong to them.
  const combatByResonatorId: Record<string, ReturnType<typeof buildCombatContext>> = {
    [rotationRuntime.id]: activeContext,
  }

  for (const target of targets) {
    if (combatByResonatorId[target.resonatorId]) {
      continue
    }

    const slotId = findCombatParticipantSlotId(graph, target.resonatorId)
    if (!slotId) {
      continue
    }

    combatByResonatorId[target.resonatorId] = buildCombatContext({
      graph,
      targetSlotId: slotId,
      enemy: input.enemyProfile,
    })
  }

  const contextCount = targets.length

  // Flat packed buffer storing one optimizer context after another.
  const contexts = new Float32Array(contextCount * OPTIMIZER_CONTEXT_FLOATS)

  // Weight for each rotation entry, used later when aggregating total rotation value.
  const contextWeights = new Float32Array(contextCount)

  // One representative display context is kept for showing derived stats in the UI.
  // The implementation chooses the target with the lowest crit sum as the display baseline.
  let displayContext = new Float32Array(OPTIMIZER_CONTEXT_FLOATS)
  let displayLowestCritSum = Number.POSITIVE_INFINITY

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]

    // Use the owning resonator's combat context when the target belongs to a teammate.
    const ownerCombat = combatByResonatorId[target.resonatorId] ?? activeContext
    const ownerRuntime = ownerCombat.runtime

    // Compile the numeric context for this one target.
    const compiled = buildCompiledContext({
      resonatorId: target.resonatorId,
      runtime: ownerRuntime,
      skill: target.skill,
      combat: ownerCombat,
      enemy: input.enemyProfile,
    })

    // Pack the compiled scalar context into the fixed float layout expected
    // by the optimizer backend.
    const packedContext = packTargetContext({
      compiled,
      skill: target.skill,
      runtime: ownerRuntime,
      comboN: shared.comboN,
      comboK: shared.comboK,
      comboCount: shared.comboTotalCombos,
      comboBaseIndex: 0,
      lockedEchoIndex: -1,
      setRuntimeMask,
    })

    // Store this context into its fixed slice of the big contexts buffer.
    contexts.set(packedContext, index * OPTIMIZER_CONTEXT_FLOATS)

    // Preserve the target's weight for later weighted aggregation.
    contextWeights[index] = target.weight ?? 1

    // Choose a display context heuristically. The current rule picks the one
    // with the lowest crit-rate + crit-damage sum.
    const critSum = compiled.staticCritRate + compiled.staticCritDmg
    if (critSum < displayLowestCritSum) {
      displayLowestCritSum = critSum
      displayContext = new Float32Array(packedContext)
    }
  }

  return {
    mode: 'rotation',
    ...shared,
    contextStride: OPTIMIZER_CONTEXT_FLOATS,
    contextCount,
    contexts,
    contextWeights,
    displayContext,
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs,
  }
}

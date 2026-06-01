/*
  Author: Runor Ewhro
  Description: Compiles an optimizer payload for rotation mode by building
               combat contexts for all relevant rotation targets, packing
               per-target execution contexts, and attaching the shared
               encoded echo/set data required by the optimizer runtime.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeCombatGraph, findCombatPart } from '@/domain/state/combatGraph.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import type { OptTargetSkill } from '@/engine/optimizer/target/selectedSkill.ts'
import { selOptTgtSkl } from '@/engine/optimizer/target/selectedSkill.ts'
import type { CompTargetSkill, OptStartPay, PrepRotRun } from '@/engine/optimizer/types.ts'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext.ts'
import { mkPrepRotNvr, runFeatSmlt } from '@/engine/rotation/system.ts'
import { encStatCstrs } from '@/engine/optimizer/constraints/statConstraints.ts'
import { mkGnrcMainEc, encEchoRows } from '@/engine/optimizer/encode/echoes.ts'
import { buildSetRows, makeSetMask } from '@/engine/optimizer/encode/sets.ts'
import { mkShrdPay, stripEchoes } from '@/engine/optimizer/compiler/shared.ts'
import { applyPersRot } from '@/engine/optimizer/rotation/runtime.ts'
import { packTargetCtx } from '@/engine/optimizer/context/pack.ts'
import { makeOptContext } from '@/engine/optimizer/context/compiled.ts'
import { isOptRotTgt } from '@/engine/optimizer/rules/eligibility.ts'
import {
  CTX_FLOATS,
} from '@/engine/optimizer/config/constants.ts'

// Fallback synthetic target used only when the rotation simulation
// produces no eligible target entries for the active resonator.
function mkFllbTgt(seedId: string): OptTargetSkill {
  return {
    id: `rotation:${seedId}`,
    tab: 'rotation',
    element: 'physical',
    skillType: [],
    archetype: 'skillDamage',
  }
}

// Only normal skill-damage targets should drive the representative display stats.
// Tune rupture and negative-effect entries still contribute damage, but they
// should not become the one context shown in the optimizer UI.
function isDsplCtxTgt(target: Pick<SkillDef, 'archetype'>): boolean {
  return target.archetype === 'skillDamage'
}

// Build the fully compiled scalar context for one rotation target.
// This strips away most object lookups and prepares the numeric values
// that will later be packed into the optimizer context float array.
function mkCompCtx(options: {
  resonatorId: string
  runtime: ResRuntime
  skill: SkillDef
  combat: ReturnType<typeof makeCombatEnv>
  enemy: OptStartPay['enemyProfile']
}): CompTargetSkill {
  const { resonatorId, runtime, skill, combat, enemy } = options

  return makeOptContext({
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
export function compRotRun(input: OptStartPay): PrepRotRun {
  const seed = input.resSeed ?? getResSeedBy(input.resonatorId)
  if (!seed) {
    throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  }

  // The optimizer should evaluate inventory echoes independently of any currently
  // equipped echoes, so we strip echoes from the runtime before building contexts.
  const runtime = stripEchoes(input.runtime)

  // Apply personal rotation setup items so the runtime reflects the actual
  // rotation state we want to optimize against.
  const rotRt: ResRuntime = applyPersRot(runtime, input.rotTms, { ignoreLoops: true })

  // Build participant runtimes for the full active team.
  const participants = makeRuntimeMap(rotRt)

  // Build a transient combat graph so we can evaluate all involved teammates
  // under the same combat snapshot.
  const graph = makeCombatGraph({
    actRt: rotRt,
    activeSeed: seed,
    partRts: participants,
    targetsByRes: {
      [rotRt.id]: input.selectedTargets ?? {},
    },
  })

  // Build the active resonator's combat context first. This is reused often.
  const activeContext = makeCombatEnv({
    graph,
    targetSlotId: 'active',
    enemy: input.enemyProfile,
  })

  // Run the feature simulation so we can discover which rotation entries are
  // valid optimizer targets.
  const rotNvrn = mkPrepRotNvr(activeContext, seed)
  const simulated = runFeatSmlt(activeContext, seed, participants, rotNvrn)

  // Keep only optimizer-eligible rotation targets for the active resonator.
  const targets = simulated.rotations.personal.entries.filter((entry) =>
      isOptRotTgt(entry, input.resonatorId),
  )

  // Encode the optimizer constraints from UI settings such as stat floors, etc.
  const constraints = encStatCstrs(input.settings)

  // Use the first real target if available. Otherwise synthesize a fallback
  // target so the generic echo encoders still have a stable skill shape to use.
  const fllbTgt = targets[0]
      ? selOptTgtSkl(targets[0].skill)
      : mkFllbTgt(seed.id)

  // Encode all inventory echoes once using the fallback target shape.
  // The actual per-target differences are handled later in packed contexts.
  const encoded = encEchoRows(input.invChs, fllbTgt, 'self')

  // Build shared optimizer payload pieces such as costs, sets, kinds, combo maps, etc.
  const shared = mkShrdPay(encoded, input, constraints)

  // Runtime mask describing already-active set state in the stripped runtime.
  const setRtMask = makeSetMask(rotRt, input.setConds)

  // Constant set rows used during evaluation for set logic.
  const setConstLut = buildSetRows(rotRt, input.setConds)

  // Precompute generic main-echo buff rows for all inventory echoes.
  // In rotation mode these are not tied to one single selected skill shape.
  const mainEchoBuffs = mkGnrcMainEc({
    echoes: input.invChs,
    runtime: rotRt,
    sourceBaseStats: activeContext.baseStats,
    sourceFinals: activeContext.finalStats,
    mode: 'self',
  })

  // If there are no optimizer targets, return a structurally valid empty rotation run.
  if (targets.length === 0) {
    return {
      mode: 'rotation',
      ...shared,
      runtime: rotRt,
      sourceBaseStats: activeContext.baseStats,
      sourceFinals: activeContext.finalStats,
      contextStride: CTX_FLOATS,
      contextCount: 0,
      contexts: new Float32Array(0),
      contextWeight: new Float32Array(0),
      displayContext: new Float32Array(CTX_FLOATS),
      stats: encoded.stats,
      setConstLut,
      mainEchoBuffs: mainEchoBuffs,
    }
  }

  // Cache combat contexts by resonator id so each teammate's combat context
  // is only built once even if multiple rotation entries belong to them.
  const cmbtByResId: Record<string, ReturnType<typeof makeCombatEnv>> = {
    [rotRt.id]: activeContext,
  }

  for (const target of targets) {
    if (cmbtByResId[target.resonatorId]) {
      continue
    }

    const slotId = findCombatPart(graph, target.resonatorId)
    if (!slotId) {
      continue
    }

    cmbtByResId[target.resonatorId] = makeCombatEnv({
      graph,
      targetSlotId: slotId,
      enemy: input.enemyProfile,
    })
  }

  const contextCount = targets.length

  // Flat packed buffer storing one optimizer context after another.
  const contexts = new Float32Array(contextCount * CTX_FLOATS)

  // Weight for each rotation entry, used later when aggregating total rotation value.
  const contextWeight = new Float32Array(contextCount)

  // One representative display context is kept for showing derived stats in the UI.
  // In rotation mode this should come from the lowest positive rotation value.
  // If no target has a positive value, fall back to a zero-value target.
  let dsplCtx = new Float32Array(CTX_FLOATS)
  let dsplLwstPstv = Number.POSITIVE_INFINITY
  let displayLowCrit = Number.POSITIVE_INFINITY
  let dsplLwstZero = Number.POSITIVE_INFINITY

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]

    // Use the owning resonator's combat context when the target belongs to a teammate.
    const ownerCombat = cmbtByResId[target.resonatorId] ?? activeContext
    const ownerRuntime = ownerCombat.runtime

    // Compile the numeric context for this one target.
    const compiled = mkCompCtx({
      resonatorId: target.resonatorId,
      runtime: ownerRuntime,
      skill: target.skill,
      combat: ownerCombat,
      enemy: input.enemyProfile,
    })

    // Pack the compiled scalar context into the fixed float layout expected
    // by the optimizer backend.
    const pckdCtx = packTargetCtx({
      compiled,
      skill: target.skill,
      runtime: ownerRuntime,
      comboN: shared.comboN,
      comboK: shared.comboK,
      comboCount: shared.totalCombos,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: setRtMask,
    })

    // Store this context into its fixed slice of the big contexts buffer.
    contexts.set(pckdCtx, index * CTX_FLOATS)

    // Preserve the target's weight for later weighted aggregation.
    contextWeight[index] = target.weight ?? 1

    // Choose a representative display context from the smallest positive
    // rotation value. If there are no positive values at all, use a zero-value one.
    if (!isDsplCtxTgt(target.skill)) {
      continue
    }

    const critSum = compiled.statCritRate + compiled.statCritDmg
    const displayValue = Number.isFinite(target.weight) ? target.weight : 1
    if (
      displayValue > 0 &&
      (
        displayValue < dsplLwstPstv ||
        (displayValue === dsplLwstPstv && critSum < displayLowCrit)
      )
    ) {
      dsplLwstPstv = displayValue
      displayLowCrit = critSum
      dsplCtx = new Float32Array(pckdCtx)
      continue
    }

    if (
      dsplLwstPstv === Number.POSITIVE_INFINITY &&
      displayValue === 0 &&
      critSum < dsplLwstZero
    ) {
      dsplLwstZero = critSum
      dsplCtx = new Float32Array(pckdCtx)
    }
  }

  return {
    mode: 'rotation',
    ...shared,
    runtime: rotRt,
    sourceBaseStats: activeContext.baseStats,
    sourceFinals: activeContext.finalStats,
    contextStride: CTX_FLOATS,
    contextCount,
    contexts,
    contextWeight: contextWeight,
    displayContext: dsplCtx,
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
  }
}

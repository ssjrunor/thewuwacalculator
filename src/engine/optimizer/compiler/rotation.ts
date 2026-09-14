/*
  Author: Runor Ewhro
  Description: compiles an optimizer payload for rotation mode by building
               combat contexts for all relevant rotation targets, packing
               per-target execution contexts, and attaching the shared
               encoded echo/set data required by the optimizer runtime.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import type { OptTargetSkill } from '@/engine/optimizer/target/selectedSkill.ts'
import { selOptTgtSkl } from '@/engine/optimizer/target/selectedSkill.ts'
import type { OptStartPay, PrepRotRun } from '@/engine/optimizer/types.ts'
import { materializeResRotation } from '@/engine/pipeline/index.ts'
import { encStatCstrs } from '@/engine/optimizer/constraints/statConstraints.ts'
import { mkGnrcMainEc, encEchoRows } from '@/engine/optimizer/encode/echoes.ts'
import { buildSetRows, makeSetMask } from '@/engine/optimizer/encode/sets.ts'
import { mkShrdPay, stripEchoes } from '@/engine/optimizer/compiler/shared.ts'
import { stripRotLoops } from '@/engine/optimizer/rotation/runtime.ts'
import { isOptDmgSkll } from '@/engine/optimizer/rules/eligibility.ts'
import {
  buildRotationCombatContexts,
  packRotationTargetContexts,
  type RotationContextShape,
  type RotationTargetContext,
} from '@/engine/optimizer/rotation/targetContexts.ts'
import type { DamageInvocation } from '@/engine/rotation/execute.ts'
import { materializeFinalPlane } from '@/engine/rotation/numericLayout.ts'
import {
  resolveWeaponCandidates,
  stripWeaponControls,
  withCandidateWeapon,
} from '@/engine/optimizer/context/weaponOverlays.ts'
import {
  CTX_FLOATS,
} from '@/engine/optimizer/config/constants.ts'

interface CapturedRotationTarget extends RotationTargetContext {
  runtime: ResRuntime
  finalStats: ReturnType<typeof materializeFinalPlane>
  combat: DamageInvocation['combat']
  nodeMultiplier: number
}

function captureInvocation(
    output: CapturedRotationTarget[],
    invocation: DamageInvocation,
    resonatorId: string,
): void {
  if (invocation.resonatorId !== resonatorId || !isOptDmgSkll(invocation.skill)) return
  output.push({
    resonatorId: invocation.resonatorId,
    skill: invocation.skill,
    weight: invocation.weight,
    runtime: invocation.runtime,
    finalStats: materializeFinalPlane(invocation.finalPlane, invocation.finalOffset),
    combat: { ...invocation.combat },
    nodeMultiplier: invocation.nodeMultiplier,
  })
}

function rotTargetSig(target: RotationTargetContext): string {
  return `${target.resonatorId}|${target.skill.id}|${target.weight ?? 1}|${target.nodeMultiplier ?? 1}`
}

// Fallback synthetic target used only when the rotation simulation
// produces no eligible target entries for the active resonator.
function mkFllbTgt(seedId: string): OptTargetSkill {
  return {
    id: `rotation:${seedId}`,
    label: 'Rotation',
    tab: 'rotation',
    element: 'physical',
    skillType: [],
    archetype: 'skillDamage',
  }
}

// Weapon search recompiles the full rotation context set per candidate weapon.
// The echo combo space is weapon-independent, but simulated skill rows are not:
// some effects bake runtime stats into per-node multipliers, so a compact weapon
// overlay would miss context-specific damage changes.
export function buildRotWeaponContexts(options: {
  input: OptStartPay
  seed: ReturnType<typeof getResSeedBy>
  rotRt: ResRuntime
  targets: CapturedRotationTarget[]
  rotationItems: RotationNode[]
  shape: RotationContextShape
}): {
  weaponContexts: Float32Array
  weaponDisplayContexts: Float32Array
  weaponIds: string[]
  count: number
} | null {
  const { input, seed, rotRt, targets, rotationItems, shape } = options
  if (!seed || targets.length === 0) {
    return null
  }

  const candidateSet = resolveWeaponCandidates(input)
  if (!candidateSet) {
    return null
  }

  const { candidates, level, plan } = candidateSet
  const contextCount = targets.length
  const targetSig = targets.map(rotTargetSig).join('\n')

  // strip the equipped weapon's passive controls so they do not leak into every
  // candidate. echoes are already stripped on rotRt.
  const baseRuntime = stripWeaponControls(rotRt)

  const weaponContexts = new Float32Array(candidates.length * contextCount * CTX_FLOATS)
  const weaponDisplayContexts = new Float32Array(candidates.length * CTX_FLOATS)
  const weaponIds: string[] = []
  let weaponCursor = 0

  for (let w = 0; w < candidates.length; w += 1) {
    const wpn = candidates[w]!
    const rt = withCandidateWeapon(baseRuntime, wpn, level, plan)

    const participants = makeRuntimeMap(rt)
    const weaponTargets: CapturedRotationTarget[] = []
    const materialized = materializeResRotation({
      runtime: rt,
      seed,
      enemy: input.enemyProfile,
      items: rotationItems,
      runtimesById: participants,
      selectedTargets: input.selectedTargets ?? {},
      detail: 'summary',
      captureEntries: false,
      onDamageInvocation: (invocation) => captureInvocation(weaponTargets, invocation, input.resonatorId),
    })
    const { graph, context: activeContext } = materialized
    if (weaponTargets.length !== contextCount || weaponTargets.map(rotTargetSig).join('\n') !== targetSig) {
      continue
    }

    const cmbtByResId = buildRotationCombatContexts(
      graph,
      activeContext,
      rt.id,
      weaponTargets,
      input.enemyProfile,
    )
    const packed = packRotationTargetContexts({
      targets: weaponTargets,
      combatByResonatorId: cmbtByResId,
      activeContext,
      enemy: input.enemyProfile,
      shape,
    })

    weaponContexts.set(packed.contexts, weaponCursor * contextCount * CTX_FLOATS)
    weaponDisplayContexts.set(packed.displayContext ?? new Float32Array(CTX_FLOATS), weaponCursor * CTX_FLOATS)
    weaponIds.push(wpn.id)
    weaponCursor += 1
  }

  if (weaponCursor === 0) {
    return null
  }

  return {
    weaponContexts: weaponContexts.slice(0, weaponCursor * contextCount * CTX_FLOATS),
    weaponDisplayContexts: weaponDisplayContexts.slice(0, weaponCursor * CTX_FLOATS),
    weaponIds,
    count: weaponCursor,
  }
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
export function compRotRun(
    input: OptStartPay,
    opts: { weaponSearch?: boolean } = {},
): PrepRotRun {
  const seed = input.resSeed ?? getResSeedBy(input.resonatorId)
  if (!seed) {
    throw new Error(`Missing resonator seed for optimizer id ${input.resonatorId}`)
  }

  // The optimizer should evaluate inventory echoes independently of any currently
  // equipped echoes, so we strip echoes from the runtime before building contexts.
  const runtime = stripEchoes(input.runtime)

  // Apply rotation setup items so the runtime reflects the actual program.
  const rotationItems = stripRotLoops(input.rotTms ?? runtime.rotation.sequence)
  const rotRt: ResRuntime = runtime

  const participants = makeRuntimeMap(rotRt)
  const targets: CapturedRotationTarget[] = []
  const materialized = materializeResRotation({
    runtime: rotRt,
    seed,
    enemy: input.enemyProfile,
    items: rotationItems,
    runtimesById: participants,
    selectedTargets: input.selectedTargets ?? {},
    detail: 'summary',
    captureEntries: false,
    onDamageInvocation: (invocation) => captureInvocation(targets, invocation, input.resonatorId),
  })
  const { graph, context: activeContext } = materialized

  // Simulation is the source of optimizer targets because authored rotation
  // nodes can expand, skip, or reroute before producing damage rows.
  const constraints = encStatCstrs(input.settings)

  // Use the first real target if available. Otherwise synthesize a fallback
  // target so the generic echo encoders still have a stable skill shape to use.
  const fllbTgt = targets[0]
      ? selOptTgtSkl(targets[0].skill)
      : mkFllbTgt(seed.id)

  // Encode all inventory echoes once using the fallback target shape.
  // The actual per-target differences are handled later in packed contexts.
  const encoded = encEchoRows(input.invChs, fllbTgt, 'self')

  const shared = mkShrdPay(encoded, input, constraints)

  const setRtMask = makeSetMask(rotRt, input.setConds)

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
  const cmbtByResId = buildRotationCombatContexts(
    graph,
    activeContext,
    rotRt.id,
    targets,
    input.enemyProfile,
  )

  const shape: RotationContextShape = {
    comboN: shared.comboN,
    comboK: shared.comboK,
    comboCount: shared.totalCombos,
    setRtMask,
  }

  const { contexts, contextWeight, displayContext } = packRotationTargetContexts({
    targets,
    combatByResonatorId: cmbtByResId,
    activeContext,
    enemy: input.enemyProfile,
    shape,
  })

  // Weapon search (theory rotation only): recompile the whole context set once
  // per searchable weapon so evaluation can pick the best weapon per build.
  const weapons = opts.weaponSearch && input.settings.includeWeapons
      ? buildRotWeaponContexts({ input, seed, rotRt, targets, rotationItems, shape })
      : null

  return {
    mode: 'rotation',
    ...shared,
    runtime: rotRt,
    sourceBaseStats: activeContext.baseStats,
    sourceFinals: activeContext.finalStats,
    contextStride: CTX_FLOATS,
    contextCount: targets.length,
    contexts,
    contextWeight: contextWeight,
    displayContext: displayContext ?? new Float32Array(CTX_FLOATS),
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
    weaponContexts: weapons?.weaponContexts,
    weaponDisplayContexts: weapons?.weaponDisplayContexts,
    weaponCount: weapons?.count,
    weaponIds: weapons?.weaponIds,
  }
}

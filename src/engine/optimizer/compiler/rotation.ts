/*
  Author: Runor Ewhro
  Description: compiles an optimizer payload for rotation mode by building
               combat contexts for all relevant rotation targets, packing
               per-target execution contexts, and attaching the shared
               encoded echo/set data required by the optimizer runtime.
*/

import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { SkillDef } from '@/domain/entities/stats.ts'
import type { DamageFeature } from '@/domain/gameData/contracts.ts'
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
  resolveWeaponCandidates,
  stripWeaponControls,
  withCandidateWeapon,
} from '@/engine/optimizer/context/weaponOverlays.ts'
import {
  CTX_FLOATS,
} from '@/engine/optimizer/config/constants.ts'

type CombatEnv = ReturnType<typeof makeCombatEnv>

// shared combo-shape inputs needed to pack any rotation target context.
interface RotShapeInputs {
  comboN: number
  comboK: number
  totalCombos: number
  setRtMask: number
}

// one rotation context set: the packed per-target contexts, their weights, and a
// representative display context (lowest positive skill-damage target).
interface RotCtxPack {
  contexts: Float32Array
  contextWeight: Float32Array
  displayContext: Float32Array
}

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

// Build the per-resonator combat context map for one runtime/graph. The active
// resonator's context is supplied (it is reused elsewhere); teammate contexts
// that own a rotation target are built on demand and cached by resonator id.
function buildCmbtByResId(
    graph: ReturnType<typeof makeCombatGraph>,
    activeContext: CombatEnv,
    activeId: string,
    targets: DamageFeature[],
    enemy: OptStartPay['enemyProfile'],
): Record<string, CombatEnv> {
  const cmbtByResId: Record<string, CombatEnv> = { [activeId]: activeContext }

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
      enemy,
    })
  }

  return cmbtByResId
}

// Pack one context per rotation target into a flat buffer, capturing per-target
// weights and a representative display context. This is the weapon-invariant
// core shared by the base run and each per-weapon recompile.
function packRotContexts(opts: {
  targets: DamageFeature[]
  cmbtByResId: Record<string, CombatEnv>
  activeContext: CombatEnv
  enemy: OptStartPay['enemyProfile']
  shape: RotShapeInputs
}): RotCtxPack {
  const { targets, cmbtByResId, activeContext, enemy, shape } = opts
  const contextCount = targets.length

  const contexts = new Float32Array(contextCount * CTX_FLOATS)
  const contextWeight = new Float32Array(contextCount)

  let dsplCtx = new Float32Array(CTX_FLOATS)
  let dsplLwstPstv = Number.POSITIVE_INFINITY
  let displayLowCrit = Number.POSITIVE_INFINITY
  let dsplLwstZero = Number.POSITIVE_INFINITY

  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index]

    const ownerCombat = cmbtByResId[target.resonatorId] ?? activeContext
    const ownerRuntime = ownerCombat.runtime

    const compiled = mkCompCtx({
      resonatorId: target.resonatorId,
      runtime: ownerRuntime,
      skill: target.skill,
      combat: ownerCombat,
      enemy,
    })

    const pckdCtx = packTargetCtx({
      compiled,
      skill: target.skill,
      runtime: ownerRuntime,
      comboN: shape.comboN,
      comboK: shape.comboK,
      comboCount: shape.totalCombos,
      comboBaseIndex: 0,
      lockEchoIdx: -1,
      setRtMask: shape.setRtMask,
    })

    contexts.set(pckdCtx, index * CTX_FLOATS)
    contextWeight[index] = target.weight ?? 1

    if (!isDsplCtxTgt(target.skill)) {
      continue
    }

    const critSum = compiled.statCritRate + compiled.statCritDmg
    const displayValue = Number.isFinite(target.weight) ? (target.weight as number) : 1
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

  return { contexts, contextWeight, displayContext: dsplCtx }
}

// Recompile the full rotation context set once per searchable weapon, reusing
// the base run's target list (the combo space and which rotation entries exist
// are weapon-independent; only the numeric context values change). Returns the
// flattened per-weapon contexts + display contexts, or null when there are no
// searchable weapons. Each weapon needs a full context set rather than a single
// compact overlay, because weapon-affected slots such as the per-node move
// multiplier vary across the rotation's contexts.
export function buildRotWeaponContexts(options: {
  input: OptStartPay
  seed: ReturnType<typeof getResSeedBy>
  rotRt: ResRuntime
  targets: DamageFeature[]
  shape: RotShapeInputs
}): {
  weaponContexts: Float32Array
  weaponDisplayContexts: Float32Array
  weaponIds: string[]
  count: number
} | null {
  const { input, seed, rotRt, targets, shape } = options
  if (!seed || targets.length === 0) {
    return null
  }

  const candidateSet = resolveWeaponCandidates(input)
  if (!candidateSet) {
    return null
  }

  const { candidates, level, plan } = candidateSet
  const contextCount = targets.length

  // strip the equipped weapon's passive controls so they do not leak into every
  // candidate. echoes are already stripped on rotRt.
  const baseRuntime = stripWeaponControls(rotRt)

  const weaponContexts = new Float32Array(candidates.length * contextCount * CTX_FLOATS)
  const weaponDisplayContexts = new Float32Array(candidates.length * CTX_FLOATS)
  const weaponIds: string[] = []

  for (let w = 0; w < candidates.length; w += 1) {
    const wpn = candidates[w]!
    const rt = withCandidateWeapon(baseRuntime, wpn, level, plan)

    const participants = makeRuntimeMap(rt)
    const graph = makeCombatGraph({
      actRt: rt,
      activeSeed: seed,
      partRts: participants,
      targetsByRes: {
        [rt.id]: input.selectedTargets ?? {},
      },
    })

    const activeContext = makeCombatEnv({
      graph,
      targetSlotId: 'active',
      enemy: input.enemyProfile,
    })

    const cmbtByResId = buildCmbtByResId(graph, activeContext, rt.id, targets, input.enemyProfile)
    const packed = packRotContexts({
      targets,
      cmbtByResId,
      activeContext,
      enemy: input.enemyProfile,
      shape,
    })

    weaponContexts.set(packed.contexts, w * contextCount * CTX_FLOATS)
    weaponDisplayContexts.set(packed.displayContext, w * CTX_FLOATS)
    weaponIds.push(wpn.id)
  }

  return {
    weaponContexts,
    weaponDisplayContexts,
    weaponIds,
    count: candidates.length,
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
  const simulated = runFeatSmlt(activeContext, seed, participants, rotNvrn, undefined, {
    mode: 'personal',
    detail: 'summary',
  })

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
  const cmbtByResId = buildCmbtByResId(graph, activeContext, rotRt.id, targets, input.enemyProfile)

  const shape: RotShapeInputs = {
    comboN: shared.comboN,
    comboK: shared.comboK,
    totalCombos: shared.totalCombos,
    setRtMask,
  }

  const { contexts, contextWeight, displayContext } = packRotContexts({
    targets,
    cmbtByResId,
    activeContext,
    enemy: input.enemyProfile,
    shape,
  })

  // Weapon search (theory rotation only): recompile the whole context set once
  // per searchable weapon so evaluation can pick the best weapon per build.
  const weapons = opts.weaponSearch && input.settings.includeWeapons
      ? buildRotWeaponContexts({ input, seed, rotRt, targets, shape })
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
    displayContext: displayContext,
    stats: encoded.stats,
    setConstLut,
    mainEchoBuffs: mainEchoBuffs,
    weaponContexts: weapons?.weaponContexts,
    weaponDisplayContexts: weapons?.weaponDisplayContexts,
    weaponCount: weapons?.count,
    weaponIds: weapons?.weaponIds,
  }
}

/*
  Author: Runor Ewhro
  Description: builds a detailed debug log for target-mode optimizer runs
               by comparing the packed optimizer view of the chosen result
               against a real runtime recomputation of the same ordered echoes.
*/

import { getEchoById } from '@/domain/services/echoCatalogService'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { cloneEchoForSlot } from '@/domain/entities/inventoryStorage'
import { buildRuntimeParticipantLookup } from '@/domain/state/runtimeAdapters'
import type { EchoInstance } from '@/domain/entities/runtime'
import type {
  OptimizerResultEntry,
  OptimizerStartPayload,
  PreparedTargetSkillRun,
} from '@/engine/optimizer/types'
import {
  OPTIMIZER_CTX_BASE_ATK,
  OPTIMIZER_CTX_BASE_DEF,
  OPTIMIZER_CTX_BASE_ER,
  OPTIMIZER_CTX_BASE_HP,
  OPTIMIZER_CTX_COMBAT_0,
  OPTIMIZER_CTX_COMBO_N,
  OPTIMIZER_CTX_CRIT_DMG,
  OPTIMIZER_CTX_CRIT_RATE,
  OPTIMIZER_CTX_DEF_MULT,
  OPTIMIZER_CTX_DMG_AMPLIFY,
  OPTIMIZER_CTX_DMG_BONUS,
  OPTIMIZER_CTX_DMG_REDUCTION,
  OPTIMIZER_CTX_FINAL_ATK,
  OPTIMIZER_CTX_FINAL_DEF,
  OPTIMIZER_CTX_FINAL_HP,
  OPTIMIZER_CTX_FLAT_DMG,
  OPTIMIZER_CTX_LOCKED_PACKED,
  OPTIMIZER_CTX_META0,
  OPTIMIZER_CTX_META1,
  OPTIMIZER_CTX_MULTIPLIER,
  OPTIMIZER_CTX_RES_MULT,
  OPTIMIZER_CTX_SCALING_ATK,
  OPTIMIZER_CTX_SCALING_DEF,
  OPTIMIZER_CTX_SCALING_ER,
  OPTIMIZER_CTX_SCALING_HP,
  OPTIMIZER_CTX_SET_RUNTIME_MASK,
  OPTIMIZER_CTX_SKILL_ID,
  OPTIMIZER_CTX_SPECIAL,
  OPTIMIZER_CTX_TOGGLES,
} from '@/engine/optimizer/constants'
import { compileOptimizerTargetContext } from '@/engine/optimizer/rebuild/target/context'
import { createPackedTargetSkillExecution } from '@/engine/optimizer/rebuild/target/execution'
import { buildPreparedRuntimeSkill } from '@/engine/pipeline/prepareRuntimeSkill'
import { computeSkillDamage } from '@/engine/formulas/damage'

// human-readable ordering for packed constraint decoding
const CONSTRAINT_KEYS = ['atk', 'hp', 'def', 'critRate', 'critDmg', 'energyRegen', 'dmgBonus', 'damage'] as const

interface EchoSummary {
  index: number | null
  uid: string | null
  id: string | null
  name: string | null
  set: number | null
  cost: number | null
  mainStats: EchoInstance['mainStats'] | null
  substats: EchoInstance['substats'] | null
}

// collapse an echo instance into a smaller log-friendly object
function summarizeEcho(echo: EchoInstance | null, index: number | null): EchoSummary | null {
  if (!echo) {
    return null
  }

  const def = getEchoById(echo.id)

  return {
    index,
    uid: echo.uid,
    id: echo.id,
    name: def?.name ?? null,
    set: echo.set,
    cost: def?.cost ?? null,
    mainStats: echo.mainStats,
    substats: echo.substats,
  }
}

// rebuild ordered echo summaries from optimizer result uids
function summarizeOrderedResultEchoes(
    inventoryEchoes: EchoInstance[],
    result: OptimizerResultEntry,
): EchoSummary[] {
  const byUid = new Map<string, { echo: EchoInstance; index: number }>()

  for (let index = 0; index < inventoryEchoes.length; index += 1) {
    const echo = inventoryEchoes[index]
    if (echo?.uid) {
      byUid.set(echo.uid, { echo, index })
    }
  }

  return result.uids
      .map((uid) => {
        const match = byUid.get(uid)
        return summarizeEcho(match?.echo ?? null, match?.index ?? null)
      })
      .filter((entry): entry is EchoSummary => Boolean(entry))
}

// decode the packed execution context back into readable fields
function decodeTargetContext(context: Float32Array) {
  const words = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = words[OPTIMIZER_CTX_SKILL_ID] >>> 0
  const meta0 = words[OPTIMIZER_CTX_META0] >>> 0
  const meta1 = words[OPTIMIZER_CTX_META1] >>> 0
  const lockedPacked = words[OPTIMIZER_CTX_LOCKED_PACKED] >>> 0

  return {
    skillId,
    skillIdHex: `0x${skillId.toString(16)}`,
    skillMask: skillId & 0x7fff,
    elementId: (skillId >>> 15) & 0x7,
    skillHash: (skillId >>> 18) & 0x3fff,
    charId: meta0 & 0xfff,
    sequence: (meta0 >>> 12) & 0xf,
    comboMode: (meta0 >>> 16) & 0x3,
    comboK: (meta0 >>> 18) & 0x7,
    comboMaxCost: (meta0 >>> 21) & 0x3f,
    comboCount: meta1,
    comboN: words[OPTIMIZER_CTX_COMBO_N] >>> 0,
    lockedEchoIndex: lockedPacked === 0 ? -1 : lockedPacked - 1,
    toggles: words[OPTIMIZER_CTX_TOGGLES] >>> 0,
    setRuntimeMask: words[OPTIMIZER_CTX_SET_RUNTIME_MASK] >>> 0,
    combat0: words[OPTIMIZER_CTX_COMBAT_0] >>> 0,
    baseAtk: context[OPTIMIZER_CTX_BASE_ATK],
    baseHp: context[OPTIMIZER_CTX_BASE_HP],
    baseDef: context[OPTIMIZER_CTX_BASE_DEF],
    baseEr: context[OPTIMIZER_CTX_BASE_ER],
    finalAtk: context[OPTIMIZER_CTX_FINAL_ATK],
    finalHp: context[OPTIMIZER_CTX_FINAL_HP],
    finalDef: context[OPTIMIZER_CTX_FINAL_DEF],
    scalingAtk: context[OPTIMIZER_CTX_SCALING_ATK],
    scalingHp: context[OPTIMIZER_CTX_SCALING_HP],
    scalingDef: context[OPTIMIZER_CTX_SCALING_DEF],
    scalingEr: context[OPTIMIZER_CTX_SCALING_ER],
    multiplier: context[OPTIMIZER_CTX_MULTIPLIER],
    flatDmg: context[OPTIMIZER_CTX_FLAT_DMG],
    resMult: context[OPTIMIZER_CTX_RES_MULT],
    defMult: context[OPTIMIZER_CTX_DEF_MULT],
    dmgReduction: context[OPTIMIZER_CTX_DMG_REDUCTION],
    dmgBonus: context[OPTIMIZER_CTX_DMG_BONUS],
    dmgAmplify: context[OPTIMIZER_CTX_DMG_AMPLIFY],
    special: context[OPTIMIZER_CTX_SPECIAL],
    critRate: context[OPTIMIZER_CTX_CRIT_RATE],
    critDmg: context[OPTIMIZER_CTX_CRIT_DMG],
  }
}

// decode the flat min/max constraint array into named entries
function decodeConstraints(constraints: Float32Array) {
  return CONSTRAINT_KEYS.map((key, index) => ({
    key,
    min: constraints[index * 2],
    max: constraints[(index * 2) + 1],
  }))
}

// compare two skill snapshots by subtracting base from top
function buildSnapshotDelta(
    left: ReturnType<typeof buildSkillSnapshot> | null,
    right: ReturnType<typeof buildSkillSnapshot> | null,
) {
  if (!left || !right) {
    return null
  }

  return {
    damageAvg: right.damage.avg - left.damage.avg,
    damageNormal: right.damage.normal - left.damage.normal,
    damageCrit: right.damage.crit - left.damage.crit,
    atkFinal: right.finalStats.atkFinal - left.finalStats.atkFinal,
    hpFinal: right.finalStats.hpFinal - left.finalStats.hpFinal,
    defFinal: right.finalStats.defFinal - left.finalStats.defFinal,
    energyRegen: right.finalStats.energyRegen - left.finalStats.energyRegen,
    critRate: right.finalStats.critRate - left.finalStats.critRate,
    critDmg: right.finalStats.critDmg - left.finalStats.critDmg,
    dmgBonus: right.finalStats.dmgBonus - left.finalStats.dmgBonus,
    amplify: right.finalStats.amplify - left.finalStats.amplify,
    flatDmg: right.finalStats.flatDmg - left.finalStats.flatDmg,
    special: right.finalStats.special - left.finalStats.special,
    resShred: right.finalStats.resShred - left.finalStats.resShred,
    defIgnore: right.finalStats.defIgnore - left.finalStats.defIgnore,
    defShred: right.finalStats.defShred - left.finalStats.defShred,
    dmgVuln: right.finalStats.dmgVuln - left.finalStats.dmgVuln,
  }
}

// compare the optimizer row values against the fully recomputed top snapshot
function buildOptimizerRowDelta(
    top: OptimizerResultEntry | null,
    topActual: ReturnType<typeof buildSkillSnapshot> | null,
) {
  if (!top || !topActual || !top.stats) {
    return null
  }

  return {
    damage: top.damage - topActual.damage.avg,
    atk: top.stats.atk - topActual.finalStats.atkFinal,
    hp: top.stats.hp - topActual.finalStats.hpFinal,
    def: top.stats.def - topActual.finalStats.defFinal,
    er: top.stats.er - topActual.finalStats.energyRegen,
    cr: top.stats.cr - topActual.finalStats.critRate,
    cd: top.stats.cd - topActual.finalStats.critDmg,
    bonus: top.stats.bonus - topActual.finalStats.dmgBonus,
    amp: top.stats.amp - topActual.finalStats.amplify,
  }
}

// build a runtime copy where the first five equipped slots are replaced
// with the ordered optimizer result echoes
function buildRuntimeWithOrderedEchoes(
    runtime: OptimizerStartPayload['runtime'],
    echoes: EchoInstance[],
): OptimizerStartPayload['runtime'] {
  const nextEchoes = [null, null, null, null, null] as Array<EchoInstance | null>

  for (let index = 0; index < Math.min(5, echoes.length); index += 1) {
    nextEchoes[index] = cloneEchoForSlot(echoes[index], index)
  }

  return {
    ...runtime,
    build: {
      ...runtime.build,
      echoes: nextEchoes,
    },
  }
}

// turn optimizer result uids back into concrete echo instances in result order
function buildOrderedResultEchoes(
    inventoryEchoes: EchoInstance[],
    result: OptimizerResultEntry,
): EchoInstance[] {
  const byUid = new Map<string, EchoInstance>()

  for (const echo of inventoryEchoes) {
    if (echo?.uid) {
      byUid.set(echo.uid, echo)
    }
  }

  return result.uids
      .map((uid) => byUid.get(uid) ?? null)
      .filter((echo): echo is EchoInstance => Boolean(echo))
}

// compute a full real runtime snapshot for the selected target skill
// this is used for debug comparison against optimizer-packed data
function buildSkillSnapshot(
    input: OptimizerStartPayload,
    runtime: OptimizerStartPayload['runtime'],
    label: string,
) {
  const seed = getResonatorSeedById(input.resonatorId)
  if (!seed || !input.settings.targetSkillId) {
    return null
  }

  const runtimesById = buildRuntimeParticipantLookup(runtime)

  const prepared = buildPreparedRuntimeSkill({
    runtime,
    seed,
    enemy: input.enemyProfile,
    skillId: input.settings.targetSkillId,
    runtimesById,
    selectedTargetsByOwnerKey: input.selectedTargetsByOwnerKey,
  })

  if (!prepared) {
    return null
  }

  // real damage recomputation from final stats and runtime state
  const direct = computeSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      input.enemyProfile,
      runtime.base.level,
      runtime.state.combat,
  )

  // optimizer-facing context recomputation for side-by-side inspection
  const compiled = compileOptimizerTargetContext({
    runtime,
    resonatorId: input.resonatorId,
    skillId: input.settings.targetSkillId,
    enemy: input.enemyProfile,
    runtimesById,
    selectedTargetsByOwnerKey: input.selectedTargetsByOwnerKey,
  })

  return {
    label,
    identity: {
      id: prepared.skill.id,
      label: prepared.skill.label,
      tab: prepared.skill.tab,
      archetype: prepared.skill.archetype,
      aggregationType: prepared.skill.aggregationType,
      element: prepared.skill.element,
      skillType: prepared.skill.skillType,
    },
    formula: {
      totalMultiplier: compiled.compiled.hitScale > 0 ? compiled.compiled.hitScale : compiled.compiled.multiplier,
      flatApplications: Math.max(1, compiled.compiled.hitCount || 1),
      flat: compiled.compiled.flat,
      fixedDmg: compiled.compiled.fixedDmg,
      scaling: prepared.skill.scaling,
    },
    damage: direct,
    finalStats: {
      atkBase: prepared.context.finalStats.atk.base,
      atkFinal: prepared.context.finalStats.atk.final,
      hpBase: prepared.context.finalStats.hp.base,
      hpFinal: prepared.context.finalStats.hp.final,
      defBase: prepared.context.finalStats.def.base,
      defFinal: prepared.context.finalStats.def.final,
      critRate: prepared.context.finalStats.critRate,
      critDmg: prepared.context.finalStats.critDmg,
      energyRegen: prepared.context.finalStats.energyRegen,
      dmgBonus: prepared.context.finalStats.dmgBonus,
      amplify: prepared.context.finalStats.amplify,
      flatDmg: prepared.context.finalStats.flatDmg,
      special: prepared.context.finalStats.special,
      resShred:
          prepared.context.finalStats.attribute.all.resShred +
          prepared.context.finalStats.attribute[prepared.skill.element].resShred,
      defIgnore: prepared.context.finalStats.defIgnore,
      defShred: prepared.context.finalStats.defShred,
      dmgVuln: prepared.context.finalStats.dmgVuln,
    },
    equippedEchoes: runtime.build.echoes.map((echo, index) => summarizeEcho(echo, index)),
    optimizerTarget: {
      selectedSkill: compiled.selectedSkill,
      compiled: compiled.compiled,
    },
  }
}

// build and emit a detailed grouped log for one target-run result set
export function logTargetRun(
    input: OptimizerStartPayload,
    payload: PreparedTargetSkillRun,
    results: OptimizerResultEntry[],
): void {
  // packed execution form used by the optimizer backend
  const execution = createPackedTargetSkillExecution(payload)

  // base snapshot from the current live runtime
  const base = buildSkillSnapshot(input, input.runtime, 'base')

  // first optimizer result is the best candidate
  const top = results[0] ?? null

  // recover the ordered real echoes used by the top row
  const topOrderedEchoes = top ? buildOrderedResultEchoes(input.inventoryEchoes, top) : []
  const topEchoes = top ? summarizeOrderedResultEchoes(input.inventoryEchoes, top) : []

  // rebuild a runtime containing those ordered echoes for a real recomputation pass
  const topRuntime = top && topOrderedEchoes.length === top.uids.length
      ? buildRuntimeWithOrderedEchoes(input.runtime, topOrderedEchoes)
      : null

  // recompute the actual top snapshot from the rebuilt runtime
  const topActual = topRuntime ? buildSkillSnapshot(input, topRuntime, 'top') : null

  // compare base -> actual top, then compare optimizer row -> actual top
  const actualDelta = buildSnapshotDelta(base, topActual)
  const optimizerDelta = buildOptimizerRowDelta(top, topActual)

  const header =
      `${input.resonatorId}:${input.settings.targetSkillId ?? 'none'} ` +
      `backend=${input.settings.enableGpu ? 'gpu' : 'cpu'} ` +
      `base=${base?.damage.avg ?? 'n/a'} top=${top?.damage ?? 'none'}`

  console.groupCollapsed(`[optimizer][target-run] ${header}`)

  console.log('run', {
    resonatorId: input.resonatorId,
    settings: input.settings,
    enemy: input.enemyProfile,
    selectedTargetsByOwnerKey: input.selectedTargetsByOwnerKey ?? {},
    inventoryEchoCount: input.inventoryEchoes.length,
    resultsLimit: payload.resultsLimit,
    comboN: payload.comboN,
    comboK: payload.comboK,
    comboTotalCombos: payload.comboTotalCombos,
    lockedMainRequested: payload.lockedMainRequested,
    lockedMainCandidateIndices: Array.from(payload.lockedMainCandidateIndices),
  })

  console.log('base snapshot', base)
  console.log('top snapshot', topActual)
  console.log('actual delta', actualDelta)
  console.log('packed target context', decodeTargetContext(execution.context))
  console.log('packed constraints', decodeConstraints(payload.constraints))

  console.log('top result', top ? {
    damage: top.damage,
    stats: top.stats,
    orderedUids: top.uids,
    orderedEchoes: topEchoes,
  } : null)

  console.log('optimizer vs top snapshot delta', optimizerDelta)

  console.groupEnd()
}
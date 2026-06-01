/*
  Author: Runor Ewhro
  Description: builds a detailed debug log for target-mode optimizer runs
               by comparing the packed optimizer view of the chosen result
               against a real runtime recomputation of the same ordered echoes.
*/

import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { cloneEchoFor } from '@/domain/entities/inventoryStorage.ts'
import { makeRuntimeMap } from '@/domain/state/runtimeAdapters.ts'
import type { EchoInstance } from '@/domain/entities/runtime.ts'
import type {
  OptResultEntry,
  OptStartPay,
  PrepTargetSkill,
} from '@/engine/optimizer/types.ts'
import {
  BASE_ATK,
  BASE_DEF,
  BASE_ER,
  BASE_HP,
  OPT_COMBAT_AUX,
  COMBO_N,
  CRIT_DMG,
  CRIT_RATE,
  DEF_MUL,
  DMG_AMP,
  DMG_BNS,
  DMG_RED,
  FINAL_ATK,
  FINAL_DEF,
  FINAL_HP,
  FLAT_DMG,
  LOCKED_PACKED,
  META0,
  META1,
  MV,
  RES_MUL,
  SCALING_ATK,
  SCALING_DEF,
  SCALING_ER,
  SCALING_HP,
  SET_MASK,
  SKILL_ID,
  OPT_CTX_SPEC,
  TOGGLES,
} from '@/engine/optimizer/config/constants.ts'
import { compOptTgtCt } from '@/engine/optimizer/target/context.ts'
import { packTargetSkill } from '@/engine/optimizer/payloads/targetPayload.ts'
import { prepSkill } from '@/engine/pipeline/prepareRuntimeSkill.ts'
import { calcSkillDamage } from '@/engine/formulas/damage.ts'

// human-readable ordering for packed constraint decoding
const CSTR_KEYS = ['atk', 'hp', 'def', 'critRate', 'critDmg', 'energyRegen', 'dmgBonus', 'damage'] as const

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
function smmrEcho(echo: EchoInstance | null, index: number | null): EchoSummary | null {
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
function smmrRdrdRslt(
    invChs: EchoInstance[],
    result: OptResultEntry,
): EchoSummary[] {
  const byUid = new Map<string, { echo: EchoInstance; index: number }>()

  for (let index = 0; index < invChs.length; index += 1) {
    const echo = invChs[index]
    if (echo?.uid) {
      byUid.set(echo.uid, { echo, index })
    }
  }

  return result.uids
      .map((uid) => {
        const match = byUid.get(uid)
        return smmrEcho(match?.echo ?? null, match?.index ?? null)
      })
      .filter((entry): entry is EchoSummary => Boolean(entry))
}

// decode the packed execution context back into readable fields
function decodeTargetCtx(context: Float32Array) {
  const words = new Uint32Array(context.buffer, context.byteOffset, context.length)
  const skillId = words[SKILL_ID] >>> 0
  const meta0 = words[META0] >>> 0
  const meta1 = words[META1] >>> 0
  const lockedPacked = words[LOCKED_PACKED] >>> 0

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
    comboN: words[COMBO_N] >>> 0,
    lockedEchoIndex: lockedPacked === 0 ? -1 : lockedPacked - 1,
    toggles: words[TOGGLES] >>> 0,
    setRuntimeMask: words[SET_MASK] >>> 0,
    combat0: words[OPT_COMBAT_AUX] >>> 0,
    baseAtk: context[BASE_ATK],
    baseHp: context[BASE_HP],
    baseDef: context[BASE_DEF],
    baseEr: context[BASE_ER],
    finalAtk: context[FINAL_ATK],
    finalHp: context[FINAL_HP],
    finalDef: context[FINAL_DEF],
    scalingAtk: context[SCALING_ATK],
    scalingHp: context[SCALING_HP],
    scalingDef: context[SCALING_DEF],
    scalingEr: context[SCALING_ER],
    multiplier: context[MV],
    flatDmg: context[FLAT_DMG],
    resMult: context[RES_MUL],
    defMult: context[DEF_MUL],
    dmgReduction: context[DMG_RED],
    dmgBonus: context[DMG_BNS],
    dmgAmplify: context[DMG_AMP],
    special: context[OPT_CTX_SPEC],
    critRate: context[CRIT_RATE],
    critDmg: context[CRIT_DMG],
  }
}

// decode the flat min/max constraint array into named entries
function decodeRules(constraints: Float32Array) {
  return CSTR_KEYS.map((key, index) => ({
    key,
    min: constraints[index * 2],
    max: constraints[(index * 2) + 1],
  }))
}

// compare two skill snapshots by subtracting base from top
function mkSnapDlt(
    left: ReturnType<typeof mkSkllSnap> | null,
    right: ReturnType<typeof mkSkllSnap> | null,
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
function mkOptRowDlt(
    top: OptResultEntry | null,
    topActual: ReturnType<typeof mkSkllSnap> | null,
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
function mkRtWithRdrd(
    runtime: OptStartPay['runtime'],
    echoes: EchoInstance[],
): OptStartPay['runtime'] {
  const nextEchoes = [null, null, null, null, null] as Array<EchoInstance | null>

  for (let index = 0; index < Math.min(5, echoes.length); index += 1) {
    nextEchoes[index] = cloneEchoFor(echoes[index], index)
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
function mkRdrdRsltCh(
    invChs: EchoInstance[],
    result: OptResultEntry,
): EchoInstance[] {
  const byUid = new Map<string, EchoInstance>()

  for (const echo of invChs) {
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
function mkSkllSnap(
    input: OptStartPay,
    runtime: OptStartPay['runtime'],
    label: string,
) {
  const seed = getResSeedBy(input.resonatorId)
  if (!seed || !input.settings.targetSkillId) {
    return null
  }

  const runtimesById = makeRuntimeMap(runtime)

  const prepared = prepSkill({
    runtime,
    seed,
    enemy: input.enemyProfile,
    skillId: input.settings.targetSkillId,
    runtimesById,
    selectedTargets: input.selectedTargets,
  })

  if (!prepared) {
    return null
  }

  // real damage recomputation from final stats and runtime state
  const direct = calcSkillDamage(
      prepared.context.finalStats,
      prepared.skill,
      input.enemyProfile,
      runtime.base.level,
      runtime.state.combat,
  )

  // optimizer-facing context recomputation for side-by-side inspection
  const compiled = compOptTgtCt({
    runtime,
    resonatorId: input.resonatorId,
    skillId: input.settings.targetSkillId,
    enemy: input.enemyProfile,
    runtimesById,
    selectedTargets: input.selectedTargets,
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
    equippedEchoes: runtime.build.echoes.map((echo, index) => smmrEcho(echo, index)),
    optimizerTarget: {
      selectedSkill: compiled.selectedSkill,
      compiled: compiled.compiled,
    },
  }
}

// build and emit a detailed grouped log for one target-run result set
export function logTargetRun(
    input: OptStartPay,
    payload: PrepTargetSkill,
    results: OptResultEntry[],
): void {
  // packed execution form used by the optimizer backend
  const execution = packTargetSkill(payload)

  // base snapshot from the current live runtime
  const base = mkSkllSnap(input, input.runtime, 'base')

  // first optimizer result is the best candidate
  const top = results[0] ?? null

  // recover the ordered real echoes used by the top row
  const topRdrdChs = top ? mkRdrdRsltCh(input.invChs, top) : []
  const topEchoes = top ? smmrRdrdRslt(input.invChs, top) : []

  // rebuild a runtime containing those ordered echoes for a real recomputation pass
  const topRuntime = top && topRdrdChs.length === top.uids.length
      ? mkRtWithRdrd(input.runtime, topRdrdChs)
      : null

  // recompute the actual top snapshot from the rebuilt runtime
  const topActual = topRuntime ? mkSkllSnap(input, topRuntime, 'top') : null

  // compare base -> actual top, then compare optimizer row -> actual top
  const actualDelta = mkSnapDlt(base, topActual)
  const optDlt = mkOptRowDlt(top, topActual)

  const header =
      `${input.resonatorId}:${input.settings.targetSkillId ?? 'none'} ` +
      `backend=${input.settings.enableGpu ? 'gpu' : 'cpu'} ` +
      `base=${base?.damage.avg ?? 'n/a'} top=${top?.damage ?? 'none'}`

  console.groupCollapsed(`[optimizer][target-run] ${header}`)

  console.log('run', {
    resonatorId: input.resonatorId,
    settings: input.settings,
    enemy: input.enemyProfile,
    selectedTargetsByOwnerKey: input.selectedTargets ?? {},
    inventoryEchoCount: input.invChs.length,
    resultsLimit: payload.resultsLimit,
    comboN: payload.comboN,
    comboK: payload.comboK,
    totalCombos: payload.totalCombos,
    lockedMainRequested: payload.lockMainReq,
    lockMainCands: Array.from(payload.lockMainCands),
  })

  console.log('base snapshot', base)
  console.log('top snapshot', topActual)
  console.log('actual delta', actualDelta)
  console.log('packed target context', decodeTargetCtx(execution.context))
  console.log('packed constraints', decodeRules(payload.constraints))

  console.log('top result', top ? {
    damage: top.damage,
    stats: top.stats,
    orderedUids: top.uids,
    orderedEchoes: topEchoes,
  } : null)

  console.log('optimizer vs top snapshot delta', optDlt)

  console.groupEnd()
}

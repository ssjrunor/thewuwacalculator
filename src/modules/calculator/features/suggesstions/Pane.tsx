/*
  Author: Runor Ewhro
  Description: Renders the pane surface for the calculator suggesstions flow.
*/

import { cloneElement, isValidElement as isVldElem, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes as HtmlAttrs } from 'react'
import type { EnemyProfile, PickFreqWeapon } from '@/domain/entities/appState.ts'
import type { RandGnrtSets, RandGnrtSetP, WeaponPlanSet, WpnStCfg } from '@/domain/entities/suggestions.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import { cloneEchoLdt } from '@/domain/entities/inventoryStorage.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { getWpnById, listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { isStdWpn } from '@/domain/entities/weapon.ts'
import { selActTgtSlc } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { applySetPlan, mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import { runMainStatS, runRandSuggs, runSetPlanSu, runWpnSuggs } from '@/engine/suggestions/client.ts'
import { readSuggsSss, writeSuggsSs } from '@/engine/suggestions/sessionCache.ts'
import {
  mkPrepMainSt,
  mkPrepRandSu,
  mkPrepSetPla,
  mkPrepWpnSu,
  mkSuggVltnCt,
  evalSuggChs,
} from '@/engine/suggestions/shared.ts'
import type {
  MainStatSugg,
  RandomEntry,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { fmtCmpcNmbr, fmtStatKeyLb, fmtStatKeyVl } from '@/modules/calculator/features/overview/lib/stats.ts'
import {
  DEFRANDSETS,
  DEFWPNSETS,
  DEFAULT_SUGG,
  ROT_TGT_VL,
  mkCostSig,
  mkEchoFullSi,
  mkGrpdSbst,
  costSig,
  recipeSig,
  randomSig,
  wpnSig,
  setsSig,
  inputSig,
  percentDiff,
  formatDamage,
  getDiffArrow,
  getDiffLabel,
  getDiffTone,
  getRandSetCn,
  normSetCount,
  setPlnsQl,
  sortChsForDs,
  sortRecipes,
  smmrCurSetPl,
  trimRandSetP,
} from '@/modules/calculator/features/suggesstions/lib/suggestions.ts'
import { getQppdEchoC } from '@/modules/calculator/features/echoes/lib/echoes.ts'
import { WPNTYPETOKEY } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { resPssvPrms, weaponStatsAt, withDefWpnMg } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { EchoPicker } from '@/modules/calculator/features/echoes/Picker.tsx'
import { SetCond } from '@/modules/calculator/features/controls/SetConditional.tsx'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { isSourceVisible } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { resolveSourceStateOptions as sourceOptions } from '@/modules/calculator/model/sourceEval.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { EchoGrid, mkEchoGridTm } from '@/shared/ui/EchoGrid.tsx'
import { SuggsMdl } from '@/modules/calculator/features/suggesstions/Parts.tsx'
import {
  targetOpts,
  type SuggTgtPtn,
} from '@/modules/calculator/features/suggesstions/lib/helpers.ts'
import { runCchdSuggJ } from '@/modules/calculator/features/suggesstions/lib/runs.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/calculator/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/calculator/features/echoes/lib/equip.ts'
import { Copy, Search } from 'lucide-react'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import AppLdrVrly from "@/shared/ui/AppLoaderOverlay.tsx";
import { RichDscr } from '@/shared/ui/RichDescription.tsx'

interface CalcSuggsPan {
  runtime: ResRuntime
  simulation: SimResult | null
  enemyProfile: EnemyProfile
  prtcRntmById: Record<string, ResRuntime>
}

interface WpnCard {
  id: string
  plans: WeaponEntry[]
}

const WPN_RARS = [5, 4, 3, 2, 1] as const

type WpnCfgView = 'search' | 'states'

interface WpnStRow {
  wpn: GenWpn
  rt: ResRuntime
  states: SourceState[]
}

// resolve the rank used for a visible weapon candidate
// standard weapon rank overrides rarity rank, matching the suggestion engine.
function getWpnRank(wpn: GenWpn, settings: WeaponPlanSet): number {
  const def = wpn.rarity === 5 ? 1 : 5
  const raw = isStdWpn(wpn.id)
    ? settings.stdRank ?? def
    : settings.ranks[String(wpn.rarity)] ?? def
  return Math.max(1, Math.min(5, Math.round(raw)))
}

// keep passive-state config scoped to weapons that are actually in the search space.
function canUseWpn(wpn: GenWpn, settings: WeaponPlanSet): boolean {
  return settings.visible[String(wpn.rarity)] ?? false
}

// resolve the normal max for a state control
// sparse config only stores values that differ from this authored max.
function stDefMax(
    state: SourceState,
    opts: Array<{ id: string }> = state.options ?? [],
): boolean | number | string {
  if (state.kind === 'toggle') return true
  if (state.kind === 'stack' || state.kind === 'number') return state.max ?? state.defaultValue ?? state.min ?? 0
  return state.defaultValue ?? opts[0]?.id ?? ''
}

// coerce a user-edited max value back into the source state's valid range.
function clnStMax(
    state: SourceState,
    value: boolean | number | string,
    opts: Array<{ id: string }> = state.options ?? [],
): boolean | number | string {
  if (state.kind === 'toggle') return true
  if (state.kind === 'stack' || state.kind === 'number') {
    const num = Number(value)
    if (!Number.isFinite(num)) return stDefMax(state, opts)
    const min = state.min ?? 0
    const max = state.max ?? num
    return Math.max(min, Math.min(max, num))
  }

  const str = String(value)
  return opts.some((option) => option.id === str) ? str : stDefMax(state, opts)
}

// detect whether a sparse state config still has any meaningful override.
function hasStCfg(config?: WpnStCfg): boolean {
  return config?.off === true || config?.max !== undefined
}

// clear equipped weapon controls before applying a suggestion result
// the selected candidate will write back only the controls it actually uses.
function clrWpnCtrls(
    controls: Record<string, boolean | number | string>,
): Record<string, boolean | number | string> {
  return Object.fromEntries(
      Object.entries(controls).filter(([key]) => !key.startsWith('weapon:')),
  )
}

export function Suggestions({
  runtime,
  simulation,
  enemyProfile,
  prtcRntmById: partRntmById,
}: CalcSuggsPan) {
  const [mainStatRslt, setMainStatR] = useState<MainStatSugg[]>([])
  const [setPlanRslt, setSetPlanRs] = useState<SetPlanSuggest[]>([])
  const [wpnRslt, setWpnRslt] = useState<WeaponEntry[]>([])
  const [randRslt, setRandRslt] = useState<RandomEntry[]>([])
  const [selMainStatN, setSelMainSt] = useState(0)
  const [selSetPlanNd, setSelSetPla] = useState(0)
  const [selWpnNdx, setSelWpnNd] = useState(0)
  const [selRandNdx, setSelRandNd] = useState(0)
  const [rnnnMainStat, setRnnnMainS] = useState(false)
  const [rnnnSetPlns, setRnnnSetPl] = useState(false)
  const [rnnnWpns, setRnnnWpns] = useState(false)
  const [rnnnRand, setRnnnRand] = useState(false)
  const [wpnCfgView, setWpnCfgVw] = useState<WpnCfgView>('search')
  const [wpnStQuery, setWpnStQuery] = useState('')
  const [wpnStRarFlt, setWpnStRarFlt] = useState<number | 'all'>('all')

  const inspectModal = useAppModal()
  const setCnfgMdl = useAppModal()
  const wpnCnfgMdl = useAppModal()
  const randCnfgMdl = useAppModal()
  const randMainEcho = useAppModal()

  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const viewMode = useAppStore((state) => state.ui.suggsViewMode)
  const setSugView = useAppStore((state) => state.setSugView)
  const weaponSuggests = useAppStore((state) => state.calculator.weaponSuggests)
  const suggsMap = useAppStore((state) => state.calculator.suggestionsByResonatorId)
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const updWpnSuggs = useAppStore((state) => state.updWpnSuggs)
  const updActResRt = useAppStore((state) => state.updActRt)
  const updActResSet = useAppStore((state) => state.updActConds)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const setConds = useAppStore((state) => (
    state.calculator.profiles[runtime.id]?.runtime.local.setConditionals ?? DEF_SET_COND
  ))
  const showToast = useTstStr((state) => state.show)

  const suggsStt = suggsMap[runtime.id] ?? DEFAULT_SUGG
  const wpnSets = useMemo<WeaponPlanSet>(() => ({
    ...DEFWPNSETS,
    ...(weaponSuggests ?? {}),
    stdRank: weaponSuggests?.stdRank ?? DEFWPNSETS.stdRank,
    ranks: {
      ...DEFWPNSETS.ranks,
      ...(weaponSuggests?.ranks ?? {}),
    },
    visible: {
      ...DEFWPNSETS.visible,
      ...(weaponSuggests?.visible ?? {}),
    },
    states: weaponSuggests?.states ?? DEFWPNSETS.states,
  }), [weaponSuggests])
  const tgtSqncRef = useRef({ main: 0, set: 0, weapon: 0, random: 0 })
  const didHydrSetCo = useRef(false)
  const portalTarget = mainPortal()
  const activeSeed = useMemo(() => getResSeedBy(runtime.id), [runtime.id])
  const stdWpns = useMemo(
    () => activeSeed ? listWpnsByTy(activeSeed.weaponType).filter((wpn) => isStdWpn(wpn.id)) : [],
    [activeSeed],
  )
  const wpnStRows = useMemo<WpnStRow[]>(() => {
    if (!activeSeed) {
      return []
    }

    return listWpnsByTy(activeSeed.weaponType)
        .filter((wpn) => canUseWpn(wpn, wpnSets))
        .map((wpn) => {
          const rank = getWpnRank(wpn, wpnSets)
          const stats = weaponStatsAt(wpn, runtime.build.weapon.level)
          const candRt: ResRuntime = {
            ...runtime,
            build: {
              ...runtime.build,
              weapon: {
                id: wpn.id,
                level: runtime.build.weapon.level,
                rank,
                baseAtk: stats.atk,
              },
            },
          }
          const states = listStatesFor('weapon', wpn.id).filter((state) =>
            isSourceVisible(candRt, candRt, state),
          )

          return { wpn, rt: candRt, states }
        })
        .filter((row) => row.states.length > 0)
  }, [activeSeed, runtime, wpnSets])

  const filteredWpnStRows = useMemo(() => {
    const term = wpnStQuery.trim().toLowerCase()
    return wpnStRows.filter((row) => {
      if (wpnStRarFlt !== 'all' && row.wpn.rarity !== wpnStRarFlt) return false
      if (term && !row.wpn.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [wpnStRows, wpnStQuery, wpnStRarFlt])

  const wpnStToggleStats = useMemo(() => {
    let total = 0
    let checked = 0
    for (const row of filteredWpnStRows) {
      for (const state of row.states) {
        total += 1
        if (wpnSets.states[row.wpn.id]?.[state.controlKey]?.off !== true) {
          checked += 1
        }
      }
    }
    return {
      total,
      checked,
      allChecked: total > 0 && checked === total,
      someChecked: checked > 0 && checked < total,
    }
  }, [filteredWpnStRows, wpnSets.states])

  const wpnStGlobalRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (wpnStGlobalRef.current) {
      wpnStGlobalRef.current.indeterminate = wpnStToggleStats.someChecked
    }
  }, [wpnStToggleStats.someChecked])

  const applyAllVisibleStates = useCallback((checked: boolean) => {
    updWpnSuggs((state) => {
      const prev = {
        ...DEFWPNSETS,
        ...state,
        ranks: { ...DEFWPNSETS.ranks, ...(state.ranks ?? {}) },
        visible: { ...DEFWPNSETS.visible, ...(state.visible ?? {}) },
        stdRank: state.stdRank ?? DEFWPNSETS.stdRank,
        states: state.states ?? DEFWPNSETS.states,
      }
      const states = structuredClone(prev.states)
      for (const row of filteredWpnStRows) {
        const wpnCfg = { ...(states[row.wpn.id] ?? {}) }
        for (const stateDef of row.states) {
          const cur = { ...(wpnCfg[stateDef.controlKey] ?? {}) }
          if (checked) {
            delete cur.off
          } else {
            cur.off = true
          }
          if (Object.keys(cur).length > 0) {
            wpnCfg[stateDef.controlKey] = cur
          } else {
            delete wpnCfg[stateDef.controlKey]
          }
        }
        if (Object.keys(wpnCfg).length > 0) {
          states[row.wpn.id] = wpnCfg
        } else {
          delete states[row.wpn.id]
        }
      }
      return { ...prev, states }
    })
  }, [filteredWpnStRows, updWpnSuggs])

  const wpnStProgressPct = wpnStToggleStats.total > 0
    ? `${(wpnStToggleStats.checked / wpnStToggleStats.total) * 100}%`
    : '0%'
  const resName = activeSeed?.name ?? runtime.id
  const allEchoes = useMemo(() => listEchoes(), [])
  const setCondsSig = useMemo(
    () => setsSig(setConds),
    [setConds],
  )

  const updRandSets = useCallback((patch: Partial<RandGnrtSets>) => {
    // random settings are stored per resonator so switching characters preserves generator preferences without
    // affecting the rest of the calculator state.
    updActResSug((state) => ({
      ...state,
      random: {
        ...state.random,
        ...patch,
      },
    }))
  }, [updActResSug])

  const updRandSetPr = useCallback((
    updater: (preferences: RandGnrtSetP[]) => RandGnrtSetP[],
  ) => {
    // set preferences are trimmed at the write boundary because several controls can add, replace, or recount sets.
    updActResSug((state) => ({
      ...state,
      random: {
        ...state.random,
        setPreferences: trimRandSetP(updater(state.random.setPreferences)),
      },
    }))
  }, [updActResSug])

  const updWpnSets = useCallback((patch: Partial<WeaponPlanSet>) => {
    // weapon suggestion settings are global because weapon ranks and visibility should carry across resonators.
    updWpnSuggs((state) => {
      const prev = {
        ...DEFWPNSETS,
        ...state,
        ranks: {
          ...DEFWPNSETS.ranks,
          ...(state.ranks ?? {}),
        },
        visible: {
          ...DEFWPNSETS.visible,
          ...(state.visible ?? {}),
        },
        stdRank: state.stdRank ?? DEFWPNSETS.stdRank,
        states: state.states ?? DEFWPNSETS.states,
      }

      return {
        ...prev,
        ...patch,
        ranks: {
          ...prev.ranks,
          ...(patch.ranks ?? {}),
        },
        visible: {
          ...prev.visible,
          ...(patch.visible ?? {}),
        },
        states: patch.states ?? prev.states,
      }
    })
  }, [updWpnSuggs])

  const updWpnSt = useCallback((
      wpnId: string,
      cntrKey: string,
      mkNext: (config: WpnStCfg) => WpnStCfg,
  ) => {
    updWpnSuggs((state) => {
      const prev = {
        ...DEFWPNSETS,
        ...state,
        ranks: {
          ...DEFWPNSETS.ranks,
          ...(state.ranks ?? {}),
        },
        visible: {
          ...DEFWPNSETS.visible,
          ...(state.visible ?? {}),
        },
        stdRank: state.stdRank ?? DEFWPNSETS.stdRank,
        states: state.states ?? DEFWPNSETS.states,
      }
      const states = structuredClone(prev.states)
      const wpnCfg = { ...(states[wpnId] ?? {}) }
      const nextCfg = mkNext({ ...(wpnCfg[cntrKey] ?? {}) })

      if (hasStCfg(nextCfg)) {
        wpnCfg[cntrKey] = nextCfg
      } else {
        delete wpnCfg[cntrKey]
      }

      if (Object.keys(wpnCfg).length > 0) {
        states[wpnId] = wpnCfg
      } else {
        delete states[wpnId]
      }

      return {
        ...prev,
        states,
      }
    })
  }, [updWpnSuggs])

  const targetOptions = useMemo<SuggTgtPtn[]>(
    () => targetOpts(runtime.id, simulation),
    [runtime.id, simulation],
  )

  const selTgtVl = suggsStt.settings.rotationMode
    ? ROT_TGT_VL
    : (suggsStt.settings.targetFeatureId ?? '')

  useEffect(() => {
    // keep the selected target valid after feature lists change, preferring rotation mode when it is still available.
    if (targetOptions.length === 0) {
      return
    }

    if (suggsStt.settings.rotationMode) {
      const hasRotPtn = targetOptions.some((option) => option.value === ROT_TGT_VL)
      if (hasRotPtn) {
        return
      }
    } else if (
      suggsStt.settings.targetFeatureId &&
      targetOptions.some((option) => option.value === suggsStt.settings.targetFeatureId)
    ) {
      return
    }

    const fallback = targetOptions[0]
    updActResSug((state) => ({
      ...state,
      settings: {
        ...state.settings,
        rotationMode: fallback.value === ROT_TGT_VL,
        targetFeatureId: fallback.value === ROT_TGT_VL ? state.settings.targetFeatureId : fallback.value,
      },
    }))
  }, [
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
    targetOptions,
    updActResSug,
  ])

  const suggVltnCtx = useMemo(() => {
    // all suggestion modes score candidate echo loadouts through the same evaluation context so their damage deltas
    // compare against the same target feature or rotation total.
    if (
      !simulation ||
      !activeSeed ||
      (!suggsStt.settings.rotationMode && targetOptions.length === 0)
    ) {
      return null
    }

    return mkSuggVltnCt({
      runtime,
      seed: activeSeed,
      enemy: enemyProfile,
      runtimesById: partRntmById,
      selectedTargets: selTrgtByOwn,
      setConds: setConds,
      tgtFeatId: suggsStt.settings.targetFeatureId,
      rotationMode: suggsStt.settings.rotationMode,
    }, simulation)
  }, [
    activeSeed,
    enemyProfile,
    partRntmById,
    runtime,
    selTrgtByOwn,
    setConds,
    simulation,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
    targetOptions.length,
  ])

  const baseDamage = useMemo(() => {
    if (!suggVltnCtx) {
      return 0
    }

    return evalSuggChs(suggVltnCtx, runtime.build.echoes)
  }, [runtime.build.echoes, suggVltnCtx])

  const curMainStatS = useMemo(
    () => mkEchoMainSt(runtime.build.echoes),
    [runtime.build.echoes],
  )
  const curEchoSig = useMemo(
    () => mkEchoFullSi(runtime.build.echoes),
    [runtime.build.echoes],
  )
  const curSetPlan = useMemo(
    () => smmrCurSetPl(runtime.build.echoes),
    [runtime.build.echoes],
  )

  const canRunDrctSu = Boolean(activeSeed) && targetOptions.length > 0 && (
    suggsStt.settings.rotationMode ||
    suggsStt.settings.targetFeatureId != null
  )
  // base signatures intentionally exclude mode-specific generator knobs; each job appends its own settings so caches
  // invalidate only for the inputs that affect that search space.
  const baseSuggNptS = useMemo(() => inputSig({
    runtime,
    enemyProfile,
    prtcRntmById: partRntmById,
    selectedTargets: selTrgtByOwn,
    setConds: setConds,
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
  }), [
    enemyProfile,
    partRntmById,
    runtime,
    selTrgtByOwn,
    setConds,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])
  const mainSttsCchK = useMemo(
    () => `main:${runtime.id}:${baseSuggNptS}`,
    [baseSuggNptS, runtime.id],
  )
  const setPlnsCchKe = useMemo(
    () => `sets:${runtime.id}:${baseSuggNptS}`,
    [baseSuggNptS, runtime.id],
  )
  const wpnCchKey = useMemo(
    () => `weapon:${runtime.id}:${baseSuggNptS}:${wpnSig(wpnSets)}`,
    [baseSuggNptS, runtime.id, wpnSets],
  )
  const randCchKey = useMemo(
    () => `random:${runtime.id}:${baseSuggNptS}:${randomSig(suggsStt.random)}`,
    [baseSuggNptS, runtime.id, suggsStt.random],
  )

  const runMainStats = useCallback(async (force = false) => {
    // main-stat suggestions are cached by combat input and target because their search space is deterministic.
    await runCchdSuggJ({
      force,
      canRun: canRunDrctSu,
      enabled: Boolean(activeSeed),
      cacheKey: mainSttsCchK,
      logLabel: 'main stat',
      readCached: (cacheKey) => readSuggsSss<MainStatSugg[]>(cacheKey),
      writeCached: (cacheKey, results) => writeSuggsSs(cacheKey, results),
      nextSequence: () => {
        const seq = tgtSqncRef.current.main + 1
        tgtSqncRef.current.main = seq
        return seq
      },
      isCurSqnc: (seq) => tgtSqncRef.current.main === seq,
      setRunning: setRnnnMainS,
      resetResults: () => {
        setMainStatR([])
      },
      applyResults: (results) => {
        setMainStatR(results)
        setSelMainSt(0)
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepMainSt({
              runtime,
              seed: activeSeed,
              enemy: enemyProfile,
              runtimesById: partRntmById,
              selectedTargets: selTrgtByOwn,
              setConds: setConds,
              tgtFeatId: suggsStt.settings.targetFeatureId,
              rotationMode: suggsStt.settings.rotationMode,
            }, simulation)
          : null
      ),
      run: runMainStatS,
    })
  }, [
    canRunDrctSu,
    enemyProfile,
    activeSeed,
    partRntmById,
    runtime,
    simulation,
    setConds,
    selTrgtByOwn,
    mainSttsCchK,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  const runSetPlans = useCallback(async (force = false) => {
    // set-plan jobs share the same combat cache shape as main-stat jobs but mutate set distribution instead of main
    // stat recipes.
    await runCchdSuggJ({
      force,
      canRun: canRunDrctSu,
      enabled: Boolean(activeSeed),
      cacheKey: setPlnsCchKe,
      logLabel: 'set plan',
      readCached: (cacheKey) => readSuggsSss<SetPlanSuggest[]>(cacheKey),
      writeCached: (cacheKey, results) => writeSuggsSs(cacheKey, results),
      nextSequence: () => {
        const seq = tgtSqncRef.current.set + 1
        tgtSqncRef.current.set = seq
        return seq
      },
      isCurSqnc: (seq) => tgtSqncRef.current.set === seq,
      setRunning: setRnnnSetPl,
      resetResults: () => {
        setSetPlanRs([])
      },
      applyResults: (results) => {
        setSetPlanRs(results)
        setSelSetPla(0)
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepSetPla({
              runtime,
              seed: activeSeed,
              enemy: enemyProfile,
              runtimesById: partRntmById,
              selectedTargets: selTrgtByOwn,
              setConds: setConds,
              tgtFeatId: suggsStt.settings.targetFeatureId,
              rotationMode: suggsStt.settings.rotationMode,
            }, simulation)
          : null
      ),
      run: runSetPlanSu,
    })
  }, [
    canRunDrctSu,
    enemyProfile,
    activeSeed,
    partRntmById,
    runtime,
    simulation,
    setConds,
    selTrgtByOwn,
    setPlnsCchKe,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  const runWeapons = useCallback(async (force = false) => {
    // weapon suggestions use the same target cache shape, but each result scores a weapon passive variant.
    await runCchdSuggJ({
      force,
      canRun: canRunDrctSu,
      enabled: Boolean(activeSeed),
      cacheKey: wpnCchKey,
      logLabel: 'weapon',
      readCached: (cacheKey) => readSuggsSss<WeaponEntry[]>(cacheKey),
      writeCached: (cacheKey, results) => writeSuggsSs(cacheKey, results),
      nextSequence: () => {
        const seq = tgtSqncRef.current.weapon + 1
        tgtSqncRef.current.weapon = seq
        return seq
      },
      isCurSqnc: (seq) => tgtSqncRef.current.weapon === seq,
      setRunning: setRnnnWpns,
      resetResults: () => {
        setWpnRslt([])
      },
      applyResults: (results) => {
        setWpnRslt(results)
        setSelWpnNd(0)
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepWpnSu({
              runtime,
              seed: activeSeed,
              enemy: enemyProfile,
              runtimesById: partRntmById,
              selectedTargets: selTrgtByOwn,
              setConds: setConds,
              tgtFeatId: suggsStt.settings.targetFeatureId,
              rotationMode: suggsStt.settings.rotationMode,
              weapon: wpnSets,
              topK: 30,
            }, simulation)
          : null
      ),
      run: runWpnSuggs,
    })
  }, [
    canRunDrctSu,
    enemyProfile,
    activeSeed,
    partRntmById,
    runtime,
    simulation,
    setConds,
    selTrgtByOwn,
    wpnCchKey,
    wpnSets,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  const runRandom = useCallback(async (force = false) => {
    // random generation includes user settings in its cache key because count caps, required sets, and main echo choice
    // all change the candidate pool.
    await runCchdSuggJ({
      force,
      canRun: canRunDrctSu,
      enabled: Boolean(activeSeed),
      cacheKey: randCchKey,
      logLabel: 'random',
      readCached: (cacheKey) => readSuggsSss<RandomEntry[]>(cacheKey),
      writeCached: (cacheKey, results) => writeSuggsSs(cacheKey, results),
      nextSequence: () => {
        const seq = tgtSqncRef.current.random + 1
        tgtSqncRef.current.random = seq
        return seq
      },
      isCurSqnc: (seq) => tgtSqncRef.current.random === seq,
      setRunning: setRnnnRand,
      resetResults: () => {
        setRandRslt([])
      },
      applyResults: (results) => {
        setRandRslt(results)
        setSelRandNd(0)
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepRandSu({
              runtime,
              seed: activeSeed,
              enemy: enemyProfile,
              runtimesById: partRntmById,
              selectedTargets: selTrgtByOwn,
              setConds: setConds,
              tgtFeatId: suggsStt.settings.targetFeatureId,
              rotationMode: suggsStt.settings.rotationMode,
              settings: suggsStt.random,
            }, simulation)
          : null
      ),
      run: runRandSuggs,
    })
  }, [
    canRunDrctSu,
    enemyProfile,
    activeSeed,
    partRntmById,
    runtime,
    simulation,
    setConds,
    selTrgtByOwn,
    randCchKey,
    suggsStt.random,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  useEffect(() => {
    // target/runtime changes refresh deterministic suggestion modes immediately and clear random results, which are
    // generated lazily only when the random tab is opened.
    setRandRslt([])
    setSelRandNd(0)
    void runMainStats()
    void runSetPlans()
    void runWeapons()
  }, [runMainStats, runSetPlans, runWeapons])

  useEffect(() => {
    // set conditionals hydrate from persisted runtime state on mount; skip the first pass so loading saved conditionals
    // does not force-refresh the initial cache.
    if (!didHydrSetCo.current) {
      didHydrSetCo.current = true
      return
    }

    setRandRslt([])
    setSelRandNd(0)
    void runMainStats(true)
    void runSetPlans(true)
    void runWeapons(true)
  }, [setCondsSig, runMainStats, runSetPlans, runWeapons])

  useEffect(() => {
    // random suggestions are the expensive path, so run them on demand rather than every time the user changes target
    // or conditionals while viewing another tab.
    if (viewMode === 'random' && randRslt.length === 0 && !rnnnRand && canRunDrctSu) {
      void runRandom()
    }
  }, [canRunDrctSu, randRslt.length, runRandom, rnnnRand, viewMode])

  const onTgtChng = useCallback((value: string) => {
    updActResSug((state) => ({
      ...state,
      settings: {
        ...state.settings,
        rotationMode: value === ROT_TGT_VL,
        targetFeatureId: value === ROT_TGT_VL ? state.settings.targetFeatureId : value,
      },
    }))
  }, [updActResSug])

  const applyEchoes = useCallback((echoes: Array<EchoInstance | null>) => {
    // clone suggested loadouts before writing them so cached results cannot be mutated through runtime state.
    updActResRt((curRt) => ({
      ...curRt,
      build: {
        ...curRt.build,
        echoes: cloneEchoLdt(echoes),
      },
    }))
  }, [updActResRt])

  const applyWeapon = useCallback((plan: WeaponEntry) => {
    const wpnKey = (
      WPNTYPETOKEY[activeSeed?.weaponType ?? 4] ?? 'gauntlets'
    ) as PickFreqWeapon

    updActResRt((curRt) => ({
      ...curRt,
      build: {
        ...curRt.build,
        weapon: {
          ...curRt.build.weapon,
          id: plan.weaponId,
          level: plan.level,
          rank: plan.rank,
          baseAtk: plan.baseAtk,
        },
      },
      state: {
        ...curRt.state,
        controls: {
          ...clrWpnCtrls(curRt.state.controls),
          ...plan.controls,
        },
      },
    }))

    bumpPickerFreq({
      bucket: 'weapon',
      weaponType: wpnKey,
      ids: [plan.weaponId],
    })
  }, [activeSeed?.weaponType, bumpPickerFreq, updActResRt])

  const echoSrfcMenu = useEchoSrfcM({
    clpbSrcResId: runtime.id,
    clipSourceName: resName,
    curChs: runtime.build.echoes,
    onQpEchoAtjg: (echo, slotIndex) => {
      updActResRt((curRt) => ({
        ...curRt,
        build: {
          ...curRt.build,
          echoes: qpEchoAtSlot(curRt.build.echoes, echo, slotIndex),
        },
      }))
    },
  })

  const selMainStatP = mainStatRslt[selMainStatN] ?? null
  const selMainStatC = useMemo(
    // main-stat entries store recipes instead of full echoes; materialize them against the current loadout so echo ids,
    // levels, and substats stay untouched.
    () => selMainStatP
      ? applyMainSta(selMainStatP.recipes, runtime.build.echoes)
      : [],
    [runtime.build.echoes, selMainStatP],
  )
  const selSetPlan = setPlanRslt[selSetPlanNd] ?? null
  const selSetPlanCh = useMemo(
    () => selSetPlan
      ? applySetPlan(selSetPlan.setPlan, runtime.build.echoes)
      : [],
    [runtime.build.echoes, selSetPlan],
  )
  const wpnCards = useMemo<WpnCard[]>(() => {
    const cards: WpnCard[] = []

    for (const plan of wpnRslt) {
      const prev = cards[cards.length - 1]
      if (prev && prev.id === plan.weaponId) {
        prev.plans.push(plan)
      } else {
        cards.push({ id: plan.weaponId, plans: [plan] })
      }
    }

    return cards
  }, [wpnRslt])
  const selWpnCard = wpnCards[selWpnNdx] ?? null
  const selWpnPlan = selWpnCard?.plans[0] ?? null
  const selRandPlan = randRslt[selRandNdx] ?? null
  const nspcChs = useMemo(
    // the inspect modal always reads from the currently selected tab so one selection surface can serve all suggestion
    // result types.
    () => (
      viewMode === 'setPlans'
        ? selSetPlanCh
        : viewMode === 'random'
          ? (selRandPlan?.echoes ?? [])
          : viewMode === 'weapons'
            ? []
            : selMainStatC
    ),
    [selMainStatC, selRandPlan?.echoes, selSetPlanCh, viewMode],
  )
  const nspcGridTms = useMemo(() => mkEchoGridTm({
    echoes: nspcChs,
  }), [nspcChs])
  const nspcSelTms = useMemo(
    // ids include the rendered index because suggested echoes can legitimately reuse the same uid across empty or
    // transformed loadout slots.
    () => nspcGridTms
      .filter((item): item is typeof item & { echo: EchoInstance } => Boolean(item.echo))
      .map((item) => ({
        id: `suggestions:${viewMode}:${item.echo.uid}:${item.rndrIdx}`,
        val: item.echo,
      })),
    [nspcGridTms, viewMode],
  )
  const nspcSelCtns = useMemo(() => [{
    id: 'suggestions:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size={14} />,
    label: ({ count }: { count: number }) => `Copy (${count})`,
    title: 'Copy selected echoes (Ctrl/Cmd+C)',
    run: async ({ vals }: { vals: EchoInstance[] }) => {
      const wrote = await echoSrfcMenu.copyEchoesToClipboard(vals)
      if (wrote) {
        showToast({
          content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
          variant: 'success',
          duration: 2200,
        })
      }
    },
  }], [echoSrfcMenu, showToast])
  const nspcSel = useSel({
    active: inspectModal.visible,
    surfaceId: `suggestions:${viewMode}`,
    ariaLabel: 'Suggestion echo selection actions',
    items: nspcSelTms,
    acts: nspcSelCtns,
  })
  const randSbst = useMemo(
    () => mkGrpdSbst(selRandPlan?.echoes ?? []),
    [selRandPlan],
  )
  const selRandMainE = suggsStt.random.mainEchoId ?? runtime.build.echoes[0]?.id ?? null
  const selRandMaiel = useMemo(
    () => selRandMainE ? getEchoById(selRandMainE) : null,
    [selRandMainE],
  )
  const ttlRandSetPc = useMemo(
    () => suggsStt.random.setPreferences.reduce((sum, entry) => sum + entry.count, 0),
    [suggsStt.random.setPreferences],
  )
  // the random generator can either be unconstrained, or constrained by up to two set preferences covering the four
  // non-main echo slots.
  const canAddRandSe = ttlRandSetPc === 0 || (
    ttlRandSetPc < 4 &&
    suggsStt.random.setPreferences.length < 2
  )
  const vlblRandSetP = useMemo(() => (
    ECHO_SET_DEFS
      .filter((entry) => !suggsStt.random.setPreferences.some((selected) => selected.setId === entry.id))
      .map((entry) => ({
        value: String(entry.id),
        label: entry.name,
        icon: getSntSetIco(entry.id) ?? undefined,
      }))
  ), [suggsStt.random.setPreferences])

  const onAddRandSet = useCallback((value: string) => {
    const setId = Number(value)
    if (!Number.isFinite(setId)) {
      return
    }

    const defaultCount = getRandSetCn(setId)[0]
    if (!defaultCount) {
      return
    }

    // newest set preference is placed first so the configuration summary follows the user's last explicit choice.
    updRandSetPr((preferences) => [
      { setId, count: defaultCount },
      ...preferences.filter((entry) => entry.setId !== setId),
    ])
  }, [updRandSetPr])

  const onRandSetCnt = useCallback((setId: number, nextCount: number) => {
    updRandSetPr((preferences) => {
      const current = preferences.find((entry) => entry.setId === setId)
      if (!current) {
        return preferences
      }

      return [
        {
          setId,
          count: normSetCount(setId, nextCount),
        },
        ...preferences.filter((entry) => entry.setId !== setId),
      ]
    })
  }, [updRandSetPr])

  const onRmRandSet = useCallback((setId: number) => {
    updRandSetPr((preferences) => preferences.filter((entry) => entry.setId !== setId))
  }, [updRandSetPr])

  return (
    <div className="suggestions-pane">
      <div className="echoes-pane-header suggestions-pane-header">
        <div className="echoes-pane-title weapon-effect__bar">
          <span className="weapon-effect__sigil" aria-hidden="true" />
          <span className="weapon-effect__titles">
            <span className="weapon-effect__tag">Optimizer</span>
            <span className="weapon-effect__name">Suggestions</span>
          </span>
        </div>

        <div className="echoes-pane-summary">
          <div className="echo-toolbar pane-view-toggle" role="group" aria-label="Suggestion view">
            <button
              type="button"
              className={`echo-tool pane-view-toggle__button${viewMode === 'mainStats' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'mainStats'}
              onClick={() => setSugView('mainStats')}
            >
              Main Stats
            </button>
            <button
              type="button"
              className={`echo-tool pane-view-toggle__button${viewMode === 'setPlans' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'setPlans'}
              onClick={() => setSugView('setPlans')}
            >
              Sonata Sets
            </button>
            <button
              type="button"
              className={`echo-tool pane-view-toggle__button${viewMode === 'weapons' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'weapons'}
              onClick={() => setSugView('weapons')}
            >
              Weapons
            </button>
            <button
              type="button"
              className={`echo-tool pane-view-toggle__button${viewMode === 'random' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'random'}
              onClick={() => setSugView('random')}
            >
              Random Echoes
            </button>
          </div>
        </div>
      </div>

      {viewMode === 'mainStats' && (
        <div className="suggestions-list main-stats">
          {rnnnMainStat && null}
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selTgtVl}
                    options={targetOptions}
                    onChange={(value) => onTgtChng(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selMainStatP && applyEchoes(selMainStatC)}
                  disabled={!selMainStatP}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selMainStatP}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelMainSt(0)}
                >
                  Reset Selection
                </button>
              </div>
            </div>
          </div>

          {mainStatRslt.length === 0 ? (
            <div className="suggestions-empty-state">
              {rnnnMainStat ?
                <AppLdrVrly text="Generating Main Stat suggestions…"/> :
                "Select a target above to see main stat suggestions... Make sure you've got echoes equipped~!"
              }
            </div>
          ) : (
            mainStatRslt.map((plan, index) => {
              const diff = percentDiff(plan.damage, baseDamage)
              const isCurrent = recipeSig(plan.recipes) === curMainStatS

              return (
                <div
                  key={`main-${index}`}
                  className={`main-stat-card${selMainStatN === index ? ' selected' : ''}`}
                  onClick={() => setSelMainSt(index)}
                >
                  <div className="main-stat-rows">
                    <div className="main-stat-header">
                      <div className="main-stat-title-row">
                        <span className="main-stat-rank">#{index + 1}</span>
                        <div className="main-stat-details-container">
                          <div className="cost-signature">{costSig(plan.recipes)}</div>
                          <div className="main-stat-details">
                            <div className="set-plan-damage-container" style={{ marginLeft: 'unset' }}>
                              <span className="set-plan-damage-main avg">{formatDamage(plan.damage)}</span>
                            </div>
                            <span className="main-stat-row-echo">
                              <span className={`set-plan-damage-diff ${getDiffTone(diff)}`}>
                                {getDiffLabel(diff, isCurrent)}
                                {getDiffArrow(diff)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {sortRecipes(plan.recipes).map((recipe, recipeIndex) => (
                      <div key={`${recipe.cost}-${recipe.primaryKey}-${recipeIndex}`} className="echo-buff main-stat-row">
                        <div className="main-stat-row-left">
                          <span className="main-stat-row-slot">Cost {recipe.cost}</span>
                        </div>
                        <div className="main-stat-row-pills">
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{fmtStatKeyLb(recipe.primaryKey)}</span>
                            <span className="main-stat-pill-value highlight">{fmtStatKeyVl(recipe.primaryKey, ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0)}</span>
                          </span>
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{fmtStatKeyLb(ECHO_SIDE_STATS[recipe.cost]?.key ?? 'atkFlat')}</span>
                            <span className="main-stat-pill-value highlight">{fmtStatKeyVl(ECHO_SIDE_STATS[recipe.cost]?.key ?? 'atkFlat', ECHO_SIDE_STATS[recipe.cost]?.value ?? 0)}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {viewMode === 'setPlans' && (
        <div className="suggestions-list set-plan-ssg">
          {rnnnSetPlns && null}
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selTgtVl}
                    options={targetOptions}
                    onChange={(value) => onTgtChng(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button type="button" className="rotation-button" onClick={setCnfgMdl.show}>
                  Config
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selSetPlan && applyEchoes(selSetPlanCh)}
                  disabled={!selSetPlan}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selSetPlan}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelSetPla(0)}
                >
                  Reset Selection
                </button>
              </div>
            </div>
          </div>

          {setPlanRslt.length === 0 ? (
            <div className="suggestions-empty-state">
              {rnnnSetPlns ?
                <AppLdrVrly text="Generating Sonata set suggestions…"/> :
                "Select a target above to see Sonata set suggestions... Make sure you've got echoes equipped~!"
              }
            </div>
          ) : (
            setPlanRslt.map((plan, index) => {
              const diff = percentDiff(plan.avgDamage, baseDamage)
              const isCurrent = setPlnsQl(plan.setPlan, curSetPlan)

              return (
                <button
                  key={`set-${index}`}
                  type="button"
                  className={`set-plan-card${selSetPlanNd === index ? ' selected' : ''}`}
                  onClick={() => setSelSetPla(index)}
                >
                  <span className="set-plan-rank">#{index + 1}</span>
                  <span className="set-plan-sets">
                    {plan.setPlan.map((entry) => {
                      const setIcon = getSntSetIco(entry.setId)
                      const setName = ECHO_SET_DEFS.find((set) => set.id === entry.setId)?.name ?? `Set ${entry.setId}`
                      return (
                        <span
                          key={`${entry.setId}-${entry.pieces}`}
                          className="set-plan-chip"
                          title={`${entry.pieces}pc · ${setName}`}
                        >
                          {setIcon ? (
                            <img src={setIcon} alt="" className="set-plan-chip__icon" loading="lazy" onError={withDefIconM} />
                          ) : null}
                          <span className="set-plan-chip__name">{setName}</span>
                          <span className="set-plan-chip__pc">{entry.pieces}pc</span>
                        </span>
                      )
                    })}
                  </span>
                  <span className="set-plan-damage-container">
                    <span className="set-plan-damage-main">{fmtCmpcNmbr(plan.avgDamage)}</span>
                    <span className={`set-plan-damage-diff ${getDiffTone(diff)}`}>
                      {getDiffLabel(diff, isCurrent)}
                      {getDiffArrow(diff)}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      )}

      {viewMode === 'weapons' && (
        <div className="suggestions-list main-stats">
          {rnnnWpns && null}
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selTgtVl}
                    options={targetOptions}
                    onChange={(value) => onTgtChng(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button type="button" className="rotation-button" onClick={wpnCnfgMdl.show}>
                  Config
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selWpnPlan && applyWeapon(selWpnPlan)}
                  disabled={!selWpnCard}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selWpnCard}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelWpnNd(0)}
                >
                  Reset Selection
                </button>
              </div>
            </div>
          </div>

          {wpnCards.length === 0 ? (
            <div className="suggestions-empty-state">
              {rnnnWpns ?
                <AppLdrVrly text="Generating weapon suggestions…"/> :
                'Select a target above to see weapon suggestions.'
              }
            </div>
          ) : (
            wpnCards.map((card, index) => {
              const targetMode = wpnSets.mode === 'both' ? wpnSets.target : wpnSets.mode
              const targetPlan = card.plans.find((p) => p.mode === targetMode) ?? card.plans[0]
              if (!targetPlan) return null
              const altPlan = card.plans.find((p) => p !== targetPlan) ?? null
              const isSolo = !altPlan
              const targetDiff = percentDiff(targetPlan.damage, baseDamage)
              const altDiff = altPlan ? percentDiff(altPlan.damage, baseDamage) : 0
              const isCurrent = targetPlan.weaponId === runtime.build.weapon.id

              return (
                <div
                  key={`weapon-${card.id}`}
                  className={`weapon-sugg-card${isSolo ? ' weapon-sugg-card--solo' : ' weapon-sugg-card--dual'}${selWpnNdx === index ? ' selected' : ''} rarity-${targetPlan.rarity}`}
                  onClick={() => setSelWpnNd(index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setSelWpnNd(index)
                    }
                  }}
                >
                  <div className="weapon-sugg-meta">
                    <span className="main-stat-rank weapon-sugg-rank">#{index + 1}</span>
                    <span className="weapon-sugg-frame">
                      <img
                        src={targetPlan.icon}
                        alt={targetPlan.name}
                        className="weapon-sugg-icon"
                        onError={withDefWpnMg}
                      />
                    </span>
                    <div className="weapon-sugg-info">
                      <span className="weapon-sugg-name">{targetPlan.name}</span>
                      <div className="weapon-sugg-stats">
                        <span className="weapon-sugg-pill">
                          <span className="weapon-sugg-pill-k">ATK</span>
                          <span className="weapon-sugg-pill-v">{Math.round(targetPlan.baseAtk)}</span>
                        </span>
                        <span className="weapon-sugg-pill">
                          <span className="weapon-sugg-pill-k">{fmtStatKeyLb(targetPlan.statKey)}</span>
                          <span className="weapon-sugg-pill-v">{fmtStatKeyVl(targetPlan.statKey, targetPlan.statValue)}</span>
                        </span>
                        <span className="weapon-sugg-pill weapon-sugg-pill--rank">
                          <span className="weapon-sugg-pill-v">R{targetPlan.rank}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="weapon-sugg-results">
                    <div className="weapon-sugg-result weapon-sugg-result--target">
                      {!isSolo ? (
                        <span className="weapon-sugg-mode-tag">{targetPlan.mode === 'max' ? 'MAX' : 'DEF'}</span>
                      ) : null}
                      <span className="weapon-sugg-damage">{formatDamage(targetPlan.damage)}</span>
                      <span className={`set-plan-damage-diff weapon-sugg-diff ${getDiffTone(targetDiff)}`}>
                        {getDiffLabel(targetDiff, isCurrent)}
                        {getDiffArrow(targetDiff)}
                      </span>
                    </div>
                    {!isSolo && altPlan ? (
                      <div className="weapon-sugg-result weapon-sugg-result--alt">
                        <span className="weapon-sugg-mode-tag">{altPlan.mode === 'max' ? 'MAX' : 'DEF'}</span>
                        <span className="weapon-sugg-damage">{formatDamage(altPlan.damage)}</span>
                        <span className={`set-plan-damage-diff weapon-sugg-diff ${getDiffTone(altDiff)}`}>
                          {getDiffLabel(altDiff, false)}
                          {getDiffArrow(altDiff)}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {viewMode === 'random' && (
        <div className="suggestions-list random-view">
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selTgtVl}
                    options={targetOptions}
                    onChange={(value) => onTgtChng(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="rotation-toolbar-group">
                <button type="button" className="rotation-button" onClick={randCnfgMdl.show}>
                  Config
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={() => selRandPlan && applyEchoes(selRandPlan.echoes)}
                  disabled={!selRandPlan}
                >
                  Apply
                </button>
                <button
                  type="button"
                  className="rotation-button"
                  onClick={inspectModal.show}
                  disabled={!selRandPlan}
                >
                  Inspect
                </button>
                <button type="button" className="rotation-button" onClick={() => void runRandom(true)}>
                  {rnnnRand ? 'Running...': 'Regenerate'}
                </button>
                <button
                  type="button"
                  className="rotation-button clear"
                  onClick={() => setSelRandNd(0)}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>

          {(randRslt.length === 0 || rnnnRand) ? (
            <div className="suggestions-empty-state">
              <AppLdrVrly text="Generating random echo builds…"/>
            </div>
          ) : (
            randRslt.map((plan, index) => {
              const diff = percentDiff(plan.damage, baseDamage)
              const isCurrent = mkEchoFullSi(plan.echoes) === curEchoSig
              const grpdSbst = mkGrpdSbst(plan.echoes).slice(0, 6)

              return (
                <div
                  key={`random-${index}`}
                  className={`main-stat-card${selRandNdx === index ? ' selected' : ''}`}
                  onClick={() => setSelRandNd(index)}
                >
                  <div className="main-stat-rows">
                    <div className="main-stat-header">
                      <div className="main-stat-title-row">
                        <span className="main-stat-rank">#{index + 1}</span>
                        <div className="main-stat-details-container">
                          <div className="cost-signature">{mkCostSig(plan.echoes)}</div>
                          <div className="main-stat-details">
                            <div className="set-plan-damage-container" style={{ marginLeft: 'unset' }}>
                              <span className="set-plan-damage-main avg">{formatDamage(plan.damage)}</span>
                            </div>
                            <span className="main-stat-row-echo">
                              <span className={`set-plan-damage-diff ${getDiffTone(diff)}`}>
                                {getDiffLabel(diff, isCurrent)}
                                {getDiffArrow(diff)}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {sortChsForDs(plan.echoes).map((echo) => (
                      <div key={echo.uid} className="echo-buff main-stat-row">
                        <div className="main-stat-row-left">
                          <span className="main-stat-row-slot">Cost {getQppdEchoC(echo)}</span>
                        </div>
                        <div className="main-stat-row-pills random">
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{fmtStatKeyLb(echo.mainStats.primary.key)}</span>
                            <span className="main-stat-pill-value highlight">{fmtStatKeyVl(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
                          </span>
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{fmtStatKeyLb(echo.mainStats.secondary.key)}</span>
                            <span className="main-stat-pill-value highlight">{fmtStatKeyVl(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {grpdSbst.length > 0 && (
                    <div className="sub-stat-row-pills">
                      {grpdSbst.map((entry) => (
                        <span key={entry.key} className="echo-buff main-stat-pill subs">
                          <span className="main-stat-pill-stat">∑{entry.label}</span>
                          <span className="main-stat-pill-value highlight">{entry.value}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      <SuggsMdl
        {...inspectModal}
        title={
          viewMode === 'setPlans'
            ? 'Inspect — Suggested Sonata Sets'
            : viewMode === 'random'
              ? 'Inspect — Random Echo Build'
              : viewMode === 'weapons'
                ? 'Inspect — Suggested Weapon'
                : 'Inspect — Suggested Main Stats'
        }
        onClose={() => {
          nspcSel.exitSelectionMode()
          inspectModal.hide()
        }}
        onApply={
          viewMode === 'mainStats' && selMainStatP
            ? () => applyEchoes(selMainStatC)
            : viewMode === 'setPlans' && selSetPlan
              ? () => applyEchoes(selSetPlanCh)
              : viewMode === 'random' && selRandPlan
                ? () => applyEchoes(selRandPlan.echoes)
                : undefined
        }
      >
        {viewMode === 'weapons' && selWpnPlan && selWpnCard && (() => {
          const inspectTargetMode = wpnSets.mode === 'both' ? wpnSets.target : wpnSets.mode
          const inspectTarget = selWpnCard.plans.find((p) => p.mode === inspectTargetMode) ?? selWpnPlan
          const inspectAlt = selWpnCard.plans.find((p) => p !== inspectTarget) ?? null
          const inspectTargetDiff = percentDiff(inspectTarget.damage, baseDamage)
          const inspectAltDiff = inspectAlt ? percentDiff(inspectAlt.damage, baseDamage) : 0
          const inspectIsCurrent = inspectTarget.weaponId === runtime.build.weapon.id
          const inspectIsDual = !!inspectAlt
          const equippedWpnId = runtime.build.weapon.id
          const equippedDef = equippedWpnId ? getWpnById(equippedWpnId) : null
          const equippedLevel = runtime.build.weapon.level
          const equippedRank = runtime.build.weapon.rank
          const equippedStats = equippedDef ? weaponStatsAt(equippedDef, equippedLevel) : null
          const equippedParams = equippedDef ? resPssvPrms(equippedDef.passive.params, equippedRank) : []
          const showCompare = !!equippedDef && equippedWpnId !== inspectTarget.weaponId

          const renderColumn = (
            kind: 'equipped' | 'inspected',
            opts: {
              cap: string
              icon: string
              name: string
              rarity: number
              level: number
              rank: number
              baseAtk: number
              statKey: string
              statValue: number
              damage: number
              diff: number
              diffLabelIsCurrent: boolean
              showAlt: boolean
              altMode?: 'default' | 'max'
              altDamage?: number
              altDiff?: number
              targetMode?: 'default' | 'max'
              passiveName?: string
              passiveDesc?: string
              passiveParams: string[]
            },
          ) => (
            <div className={`weapon-inspect__col weapon-inspect__col--${kind} rarity-${opts.rarity}`}>
              <header className="weapon-inspect__col-head">
                <span className="weapon-inspect__col-cap">{opts.cap}</span>
              </header>
              <div className="weapon-inspect__identity">
                <span className="weapon-inspect__frame">
                  <img src={opts.icon} alt={opts.name} className="weapon-inspect__icon" onError={withDefWpnMg} />
                </span>
                <div className="weapon-inspect__title">
                  <h3 className="weapon-inspect__name">{opts.name}</h3>
                  <div className="weapon-inspect__tags">
                    <span className="weapon-inspect__rarity" aria-label={`${opts.rarity}-star`}>
                      {'★'.repeat(opts.rarity)}
                    </span>
                    <span className="weapon-inspect__sep" aria-hidden />
                    <span>Lv. {opts.level}</span>
                    <span className="weapon-inspect__sep" aria-hidden />
                    <span>R{opts.rank}</span>
                  </div>
                </div>
              </div>

              <div className="weapon-inspect__specs">
                <div className="weapon-inspect__spec">
                  <span className="weapon-inspect__spec-k">Base ATK</span>
                  <span className="weapon-inspect__spec-v">{Math.round(opts.baseAtk)}</span>
                </div>
                <div className="weapon-inspect__spec">
                  <span className="weapon-inspect__spec-k">{fmtStatKeyLb(opts.statKey)}</span>
                  <span className="weapon-inspect__spec-v">{fmtStatKeyVl(opts.statKey, opts.statValue)}</span>
                </div>
              </div>

              <div className="weapon-inspect__block">
                <div className="weapon-inspect__block-label">Damage</div>
                <div className="weapon-inspect__output">
                  <div className={`weapon-inspect__output-row${kind === 'inspected' ? ' weapon-inspect__output-row--target' : ''}${opts.targetMode ? ' weapon-inspect__output-row--withtag' : ''}`}>
                    {opts.targetMode ? (
                      <span className="weapon-inspect__mode-tag">{opts.targetMode === 'max' ? 'MAX' : 'DEF'}</span>
                    ) : null}
                    <span className="weapon-inspect__output-damage">{formatDamage(opts.damage)}</span>
                    {kind === 'equipped' ? (
                      <span className="set-plan-damage-diff weapon-inspect__diff zero">base</span>
                    ) : (
                      <span className={`set-plan-damage-diff weapon-inspect__diff ${getDiffTone(opts.diff)}`}>
                        {getDiffLabel(opts.diff, opts.diffLabelIsCurrent)}
                        {getDiffArrow(opts.diff)}
                      </span>
                    )}
                  </div>
                  {opts.showAlt && opts.altDamage !== undefined && opts.altDiff !== undefined && opts.altMode ? (
                    <div className="weapon-inspect__output-row weapon-inspect__output-row--alt weapon-inspect__output-row--withtag">
                      <span className="weapon-inspect__mode-tag">{opts.altMode === 'max' ? 'MAX' : 'DEF'}</span>
                      <span className="weapon-inspect__output-damage">{formatDamage(opts.altDamage)}</span>
                      <span className={`set-plan-damage-diff weapon-inspect__diff ${getDiffTone(opts.altDiff)}`}>
                        {getDiffLabel(opts.altDiff, false)}
                        {getDiffArrow(opts.altDiff)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="weapon-inspect__block">
                <div className="weapon-inspect__block-label">
                  Passive{opts.passiveName ? ` · ${opts.passiveName}` : ''}
                </div>
                {opts.passiveDesc ? (
                  <RichDscr
                    description={opts.passiveDesc}
                    params={opts.passiveParams}
                    className="weapon-inspect-desc"
                  />
                ) : (
                  <p className="suggestions-modal-hint">No passive description.</p>
                )}
              </div>
            </div>
          )

          return (
            <div className={`weapon-inspect ${showCompare ? 'weapon-inspect--compare' : 'weapon-inspect--solo'}`}>
              {showCompare && equippedDef && equippedStats
                ? renderColumn('equipped', {
                    cap: 'Equipped',
                    icon: equippedDef.icon,
                    name: equippedDef.name,
                    rarity: equippedDef.rarity,
                    level: equippedLevel,
                    rank: equippedRank,
                    baseAtk: equippedStats.atk,
                    statKey: equippedDef.statKey,
                    statValue: equippedStats.scndStatVl,
                    damage: baseDamage,
                    diff: 0,
                    diffLabelIsCurrent: true,
                    showAlt: false,
                    passiveName: equippedDef.passive.name,
                    passiveDesc: equippedDef.passive.desc,
                    passiveParams: equippedParams,
                  })
                : null}
              {renderColumn('inspected', {
                cap: showCompare ? 'Inspected' : 'Weapon',
                icon: inspectTarget.icon,
                name: inspectTarget.name,
                rarity: inspectTarget.rarity,
                level: inspectTarget.level,
                rank: inspectTarget.rank,
                baseAtk: inspectTarget.baseAtk,
                statKey: inspectTarget.statKey,
                statValue: inspectTarget.statValue,
                damage: inspectTarget.damage,
                diff: inspectTargetDiff,
                diffLabelIsCurrent: inspectIsCurrent,
                showAlt: !!inspectAlt,
                altMode: inspectAlt?.mode,
                altDamage: inspectAlt?.damage,
                altDiff: inspectAlt ? inspectAltDiff : undefined,
                targetMode: inspectIsDual ? inspectTarget.mode : undefined,
                passiveName: inspectTarget.pssvName,
                passiveDesc: inspectTarget.pssvDesc,
                passiveParams: inspectTarget.params,
              })}
            </div>
          )
        })()}
        {viewMode === 'random' && selRandPlan && (
          <div className="suggestions-inspect-score-row">
            <span className="suggestions-config-label">Build Score</span>
            <span className={`set-plan-damage-diff echo-buff ${getDiffTone(percentDiff(selRandPlan.damage, baseDamage))}`}>
              {Math.abs(percentDiff(selRandPlan.damage, baseDamage)).toFixed(1)}%
              {getDiffArrow(percentDiff(selRandPlan.damage, baseDamage))}
            </span>
          </div>
        )}
        {viewMode !== 'weapons' && (
          <div className="suggestions-modal-echo-grid">
            <EchoGrid
              echoes={nspcChs}
              variant="full"
              showSubstats
              showImage
              interactive
              selection={nspcSel}
              getCardClskn={(item) => {
                if (!item.echo) {
                  return ''
                }

                const itemId = `suggestions:${viewMode}:${item.echo.uid}:${item.rndrIdx}`
                return nspcSel.selectionMode
                  ? `selection-mode${nspcSel.isSelected(itemId) ? ' focus-selected' : ''}`
                  : ''
              }}
              wrapCard={(card, item) => {
                if (!item.echo) {
                  return <div key={item.key}>{card}</div>
                }

                const itemId = `suggestions:${viewMode}:${item.echo.uid}:${item.rndrIdx}`
                const cardElement = isVldElem<HtmlAttrs<HTMLElement>>(card)
                  ? cloneElement(card, {
                      'data-selection-focus-item': 'true',
                      onClickCapture: nspcSel.buildClickCapture(itemId),
                    } as HtmlAttrs<HTMLElement> & { 'data-selection-focus-item': string })
                  : (
                      <div data-selection-focus-item="true" onClickCapture={nspcSel.buildClickCapture(itemId)}>
                        {card}
                      </div>
                    )

                return (
                  <ContextTrigger
                    key={item.key}
                    asChild
                    ariaLabel={`${item.echo.mainEcho ? 'Main echo' : 'Echo'} actions`}
                    items={echoSrfcMenu.buildReadOnlyMenu({
                      id: itemId,
                      echo: item.echo,
                      onSelect: () => {
                        nspcSel.focusSurface()
                        nspcSel.addToSelection(itemId)
                      },
                    })}
                  >
                    {cardElement}
                  </ContextTrigger>
                )
              }}
            />
          </div>
        )}
        {viewMode === 'setPlans' && selSetPlan && (
          <div className="suggestions-set-detail">
            {selSetPlan.setPlan.map((entry) => {
              const definition = ECHO_SET_DEFS.find((set) => set.id === entry.setId)
              const desc = entry.pieces === 2
                ? definition?.desc.twoPiece
                : entry.pieces === 3
                  ? definition?.desc.threePiece
                  : definition?.desc.fivePiece
              const name = definition?.name ?? `Set ${entry.setId}`
              const icon = getSntSetIco(entry.setId)

              return (
                <div key={`${entry.setId}-${entry.pieces}`} className="echo-set-bonus">
                  <div className="echo-set-bonus-header">
                    <div className="echo-set-bonus-icon-wrap">
                      {icon ? (
                        <img src={icon} alt={name} className="echo-set-bonus-icon" loading="lazy" onError={withDefIconM} />
                      ) : (
                        <span className="echo-set-bonus-icon-fallback" />
                      )}
                    </div>
                    <div className="echo-set-bonus-info">
                      <span className="echo-set-bonus-name">{name}</span>
                      <div className="echo-set-bonus-pips">
                        {Array.from({ length: entry.pieces }, (_, pip) => (
                          <span key={`${entry.setId}-pip-${pip}`} className="echo-set-pip echo-set-pip--filled" />
                        ))}
                        <span className="echo-set-bonus-count">{entry.pieces}pc</span>
                      </div>
                    </div>
                  </div>

                  <div className="echo-set-bonus-tiers">
                    <div className="echo-set-tier">
                      <span className="echo-set-tier-tag">{entry.pieces}pc</span>
                      <RichDscr description={desc ?? 'Active set bonus.'} className="echo-set-tier-desc" unstyled />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {viewMode === 'random' && randSbst.length > 0 && (
          <div>
            <span className="suggestions-config-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
              Combined Substats
            </span>
            <div className="sub-stat-row-pills" style={{ flexWrap: 'wrap' }}>
              {randSbst.map((entry) => (
                <span key={entry.key} className="echo-buff main-stat-pill subs">
                  <span className="main-stat-pill-stat">∑{entry.label}</span>
                  <span className="main-stat-pill-value highlight">{entry.value}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </SuggsMdl>

      <SetCond
        {...setCnfgMdl}
        portalTarget={portalTarget}
        onClose={setCnfgMdl.hide}
        title="Sonata Set Config"
        setConds={setConds}
        onSetCondsrx={updActResSet}
      />

      <SuggsMdl
        {...wpnCnfgMdl}
        title="Config - Weapon Suggestions"
        onClose={wpnCnfgMdl.hide}
        xtrClssName="suggestions-modal--mid"
      >
        <div className="wpncfg">
          <header className="wpncfg__header">
            <div className="wpncfg__tabs" role="tablist" aria-label="Weapon config view">
              <button
                type="button"
                role="tab"
                aria-selected={wpnCfgView === 'search'}
                className={`wpncfg__tab${wpnCfgView === 'search' ? ' is-active' : ''}`}
                onClick={() => setWpnCfgVw('search')}
              >
                <span className="wpncfg__tab-cap">01</span>
                <span className="wpncfg__tab-label">Search</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={wpnCfgView === 'states'}
                className={`wpncfg__tab${wpnCfgView === 'states' ? ' is-active' : ''}`}
                onClick={() => setWpnCfgVw('states')}
              >
                <span className="wpncfg__tab-cap">02</span>
                <span className="wpncfg__tab-label">Passives</span>
              </button>
            </div>
            {wpnCfgView === 'search' ? (
              <div className="wpncfg__header-meta">
                {wpnSets.mode === 'both'
                  ? `Both · ranked by ${wpnSets.target}`
                  : wpnSets.mode}
              </div>
            ) : (
              <label className="ssc-global-row wpncfg__global">
                <input
                  ref={wpnStGlobalRef}
                  type="checkbox"
                  className="ssc-native-checkbox"
                  checked={wpnStToggleStats.allChecked}
                  disabled={wpnStToggleStats.total === 0}
                  onChange={(event) => applyAllVisibleStates(event.target.checked)}
                />
                <span className="ssc-checkmark">
                  <svg className="ssc-checkmark-icon" width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <svg className="ssc-dash-icon" width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true">
                    <path d="M1 1H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </span>
                <span className="ssc-toggle-label">Toggle all visible</span>
                <span className="ssc-count-display">{wpnStToggleStats.checked} / {wpnStToggleStats.total}</span>
                <span className="ssc-progress-track" aria-hidden="true">
                  <span className="ssc-progress-fill" style={{ width: wpnStProgressPct }} />
                </span>
              </label>
            )}
          </header>

          {wpnCfgView === 'search' ? (
            <div className="wpncfg__body" key="search">
              <section className="wpncfg__card">
                <div className="wpncfg__card-head">
                  <span className="wpncfg__card-cap">Mode</span>
                </div>
                <div className="wpncfg__seg-row">
                  <span className="wpncfg__seg-label">Search for…</span>
                  <div className="wpncfg__seg">
                    <button
                      type="button"
                      className={`wpncfg__seg-btn${wpnSets.mode === 'default' ? ' is-active' : ''}`}
                      onClick={() => updWpnSets({ mode: 'default', target: 'default' })}
                    >
                      Default
                    </button>
                    <button
                      type="button"
                      className={`wpncfg__seg-btn${wpnSets.mode === 'max' ? ' is-active' : ''}`}
                      onClick={() => updWpnSets({ mode: 'max', target: 'max' })}
                    >
                      Max
                    </button>
                    <button
                      type="button"
                      className={`wpncfg__seg-btn${wpnSets.mode === 'both' ? ' is-active' : ''}`}
                      onClick={() => updWpnSets({ mode: 'both' })}
                    >
                      Both
                    </button>
                  </div>
                </div>
                {wpnSets.mode === 'both' && (
                  <div className="wpncfg__seg-row">
                    <span className="wpncfg__seg-label">Rank by…</span>
                    <div className="wpncfg__seg">
                      <button
                        type="button"
                        className={`wpncfg__seg-btn${wpnSets.target === 'default' ? ' is-active' : ''}`}
                        onClick={() => updWpnSets({ target: 'default' })}
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        className={`wpncfg__seg-btn${wpnSets.target === 'max' ? ' is-active' : ''}`}
                        onClick={() => updWpnSets({ target: 'max' })}
                      >
                        Max
                      </button>
                    </div>
                  </div>
                )}
              </section>

              {stdWpns.length > 0 && (
                <section className="wpncfg__card">
                  <div className="wpncfg__card-head">
                    <span className="wpncfg__card-cap">Standard Weapons</span>
                    <span className="wpncfg__card-sub">{stdWpns.map((wpn) => wpn.name).join(' · ')}</span>
                  </div>
                  <div className="wpncfg__rank-strip">
                    {[1, 2, 3, 4, 5].map((rank) => (
                      <button
                        key={`std-rank-${rank}`}
                        type="button"
                        className={`wpncfg__rank-btn${wpnSets.stdRank === rank ? ' is-active' : ''}`}
                        onClick={() => updWpnSets({ stdRank: rank })}
                      >
                        R{rank}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <section className="wpncfg__card">
                <div className="wpncfg__card-head">
                  <span className="wpncfg__card-cap">Rarity Rules</span>
                </div>
                <div className="wpncfg__rarity-grid">
                  {WPN_RARS.map((rarity) => {
                    const rarKey = String(rarity)
                    const showWpn = wpnSets.visible[rarKey] ?? false
                    const rankVal = wpnSets.ranks[rarKey] ?? (rarity === 5 ? 1 : 5)
                    return (
                      <div
                        key={`wpn-rar-${rarity}`}
                        className={`wpncfg__rarity-cell rarity-${rarity}${showWpn ? '' : ' is-off'}`}
                      >
                        <header className="wpncfg__rarity-head">
                          <span className="wpncfg__rarity-stars">{'★'.repeat(rarity)}</span>
                          <button
                            type="button"
                            className={`wpncfg__pill${showWpn ? ' is-active' : ''}`}
                            onClick={() => updWpnSets({ visible: { [rarKey]: !showWpn } })}
                          >
                            {showWpn ? 'On' : 'Off'}
                          </button>
                        </header>
                        <div className="wpncfg__rank-strip">
                          {[1, 2, 3, 4, 5].map((rank) => (
                            <button
                              key={`wpn-rank-${rarity}-${rank}`}
                              type="button"
                              className={`wpncfg__rank-btn${rankVal === rank ? ' is-active' : ''}`}
                              disabled={!showWpn}
                              onClick={() => updWpnSets({ ranks: { [rarKey]: rank } })}
                            >
                              R{rank}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <footer className="wpncfg__footer">
                <button
                  type="button"
                  className="wpncfg__reset"
                  onClick={() => updWpnSets(DEFWPNSETS)}
                >
                  ↺ Reset to defaults
                </button>
              </footer>
            </div>
          ) : (
            <div className="wpncfg__body" key="states">
              {wpnStRows.length === 0 ? (
                <div className="wpncfg__empty">No configurable weapon passives in the current search space.</div>
              ) : (
                <>
                  <div className="ssc-toolbar wpncfg__toolbar">
                    <div className="ssc-tabs">
                      <button
                        type="button"
                        className={`ssc-tab${wpnStRarFlt === 'all' ? ' active' : ''}`}
                        onClick={() => setWpnStRarFlt('all')}
                      >
                        All
                      </button>
                      {WPN_RARS.map((rar) => (
                        <button
                          key={`chip-${rar}`}
                          type="button"
                          className={`ssc-tab${wpnStRarFlt === rar ? ' active' : ''}`}
                          onClick={() => setWpnStRarFlt(rar)}
                        >
                          {rar}★
                        </button>
                      ))}
                    </div>
                    <div className="rotation-saved-filters__search">
                      <Search size={13} className="rotation-saved-filters__search-icon" />
                      <input
                        type="text"
                        value={wpnStQuery}
                        onChange={(event) => setWpnStQuery(event.target.value)}
                        placeholder="Search weapons…"
                        className="rotation-saved-filters__search-input"
                        aria-label="Filter weapons"
                      />
                    </div>
                  </div>

                  {filteredWpnStRows.length === 0 ? (
                    <div className="wpncfg__empty">No matching weapons.</div>
                  ) : (
                    <div className="wpncfg__weapons">
                      {filteredWpnStRows.map(({ wpn, rt, states }) => {
                        const rank = getWpnRank(wpn, wpnSets)
                        const params = resPssvPrms(wpn.passive.params, rank)
                        const onCount = states.filter((state) => {
                          const cfg = wpnSets.states[wpn.id]?.[state.controlKey]
                          return cfg?.off !== true
                        }).length
                        const counterClass = onCount === 0
                          ? 'wpncfg__weapon-counter'
                          : onCount === states.length
                            ? 'wpncfg__weapon-counter is-full'
                            : 'wpncfg__weapon-counter is-partial'
                        return (
                          <article
                            key={`wpn-state-${wpn.id}`}
                            className={`wpncfg__weapon rarity-${wpn.rarity}`}
                          >
                            <header className="wpncfg__weapon-head">
                              <span className="wpncfg__weapon-frame">
                                <img
                                  src={wpn.icon}
                                  alt={wpn.name}
                                  className="wpncfg__weapon-icon"
                                  onError={withDefWpnMg}
                                />
                              </span>
                              <div className="wpncfg__weapon-title">
                                <span className="wpncfg__weapon-name">{wpn.name}</span>
                                <span className="wpncfg__weapon-sub">
                                  {wpn.passive.name || 'Passive'} · R{rank}
                                </span>
                              </div>
                              <span className={counterClass}>
                                {onCount}/{states.length}
                              </span>
                            </header>
                            <ul className="wpncfg__states">
                              {states.map((state) => {
                                const cfg = wpnSets.states[wpn.id]?.[state.controlKey]
                                const isOn = cfg?.off !== true
                                const opts = state.kind === 'select'
                                  ? sourceOptions(rt, rt, state)
                                  : []
                                const defMax = stDefMax(state, opts)
                                const maxVal = cfg?.max === undefined
                                  ? defMax
                                  : clnStMax(state, cfg.max, opts)

                                const toggleStateOff = () => {
                                  updWpnSt(wpn.id, state.controlKey, (cur) => {
                                    const next = { ...cur }
                                    if (isOn) {
                                      next.off = true
                                    } else {
                                      delete next.off
                                    }
                                    return next
                                  })
                                }

                                return (
                                  <li
                                    key={state.controlKey}
                                    className={`wpncfg__state${isOn ? ' is-on' : ''}`}
                                  >
                                    <div
                                      className="wpncfg__state-row"
                                      role="checkbox"
                                      aria-checked={isOn}
                                      tabIndex={0}
                                      onClick={toggleStateOff}
                                      onKeyDown={(event) => {
                                        if (event.key === ' ' || event.key === 'Enter') {
                                          event.preventDefault()
                                          toggleStateOff()
                                        }
                                      }}
                                    >
                                      <span className="wpncfg__checkmark">
                                        <svg className="wpncfg__checkmark-icon" width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden="true">
                                          <path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                      </span>
                                      <div className="wpncfg__state-body">
                                        {state.description ? (
                                          <RichDscr
                                            description={state.description}
                                            params={params}
                                            className="wpncfg__state-desc"
                                          />
                                        ) : (
                                          <span className="wpncfg__state-desc">{state.label}</span>
                                        )}
                                      </div>
                                      {isOn && state.kind !== 'toggle' ? (
                                        <span
                                          className="wpncfg__state-input"
                                          onClick={(event) => event.stopPropagation()}
                                          onKeyDown={(event) => event.stopPropagation()}
                                        >
                                          {state.kind === 'select' ? (
                                            <LiquidSelect
                                              value={String(maxVal)}
                                              options={opts.map((option) => ({
                                                value: option.id,
                                                label: option.label,
                                              }))}
                                              onChange={(nextValue) => {
                                                updWpnSt(wpn.id, state.controlKey, (cur) => {
                                                  const next = { ...cur }
                                                  const clean = clnStMax(state, String(nextValue), opts)
                                                  if (clean === defMax) delete next.max
                                                  else next.max = clean
                                                  return next
                                                })
                                              }}
                                            />
                                          ) : (
                                            <NumberInput
                                              value={Number(maxVal)}
                                              min={state.min ?? 0}
                                              max={state.max}
                                              step={state.kind === 'stack' ? 1 : 0.1}
                                              onChange={(nextValue) => {
                                                updWpnSt(wpn.id, state.controlKey, (cur) => {
                                                  const next = { ...cur }
                                                  const clean = clnStMax(state, nextValue, opts)
                                                  if (clean === defMax) delete next.max
                                                  else next.max = clean
                                                  return next
                                                })
                                              }}
                                            />
                                          )}
                                        </span>
                                      ) : null}
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          </article>
                        )
                      })}
                    </div>
                  )}
                </>
              )}

              <footer className="wpncfg__footer">
                <button
                  type="button"
                  className="wpncfg__reset"
                  onClick={() => updWpnSets({ states: {} })}
                >
                  ↺ Reset passive states
                </button>
              </footer>
            </div>
          )}
        </div>
      </SuggsMdl>

      <SuggsMdl
        {...randCnfgMdl}
        title="Config - Random Echoes"
        onClose={randCnfgMdl.hide}
        xtrClssName="suggestions-modal--narrow"
      >
        <div className="rc-panel">
          <div className="rc-section">
            <div className="rc-row-pair">
              <div className="rc-row">
                <span className="rc-label">Main Echo</span>
                <button type="button" className="rc-echo-btn" onClick={randMainEcho.show}>
                  {selRandMaiel?.icon ? (
                    <img
                      src={selRandMaiel.icon}
                      alt={selRandMaiel.name}
                      className="rc-echo-img"
                      loading="lazy"
                      onError={withDefEchoMg}
                    />
                  ) : (
                    <span className="rc-echo-empty">?</span>
                  )}
                  <span className="rc-echo-name">
                    {selRandMaiel?.name ?? 'Any echo'}
                  </span>
                </button>
              </div>

              <div className="rc-row">
                <span className="rc-label">Target</span>
                <LiquidSelect
                  value={selTgtVl}
                  options={targetOptions}
                  onChange={(value) => onTgtChng(String(value))}
                  placeholder="Target Skill"
                />
              </div>
            </div>

            <div className="rc-row">
              <span className="rc-label">Energy</span>
              <input
                type="number"
                min={0}
                max={200}
                step={100}
                value={suggsStt.random.targetEnergyRegen}
                onChange={(event) => updRandSets({
                  targetEnergyRegen: Math.max(0, Math.min(200, Number(event.target.value) || 0)),
                })}
                className="rc-number"
              />
            </div>
          </div>

          <div className="rc-sep" />

          <div className="rc-section">
            <div className="rc-sliders-grid">
              <div className="rc-slider-row">
                <div className="rc-slider-meta">
                  <span className="rc-label">Bias</span>
                  <div className="rc-slider-ends">
                    <span>Balanced</span>
                    <span>Focused</span>
                  </div>
                </div>
                <div className="rc-slider-track">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={suggsStt.random.bias}
                    onChange={(event) => updRandSets({ bias: Number(event.target.value) })}
                  />
                  <span className="rc-slider-value">{suggsStt.random.bias.toFixed(1)}</span>
                </div>
              </div>

              <div className="rc-slider-row">
                <div className="rc-slider-meta">
                  <span className="rc-label">Quality</span>
                  <div className="rc-slider-ends">
                    <span>Lower</span>
                    <span>Higher</span>
                  </div>
                </div>
                <div className="rc-slider-track">
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={suggsStt.random.rollQuality}
                    onChange={(event) => updRandSets({ rollQuality: Number(event.target.value) })}
                  />
                  <span className="rc-slider-value">{suggsStt.random.rollQuality.toFixed(1)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="rc-sep" />

          <div className="rc-section">
            <div className="rc-section-head">
              <span className="rc-label">Sonata Sets</span>
              {canAddRandSe && vlblRandSetP.length > 0 && (
                <LiquidSelect
                  value=""
                  options={vlblRandSetP}
                  onChange={(value) => onAddRandSet(String(value))}
                  placeholder="+ Add set"
                />
              )}
            </div>

            {suggsStt.random.setPreferences.length === 0 ? (
              <span className="rc-empty">No constraint — generator picks freely.</span>
            ) : (
              suggsStt.random.setPreferences.map((entry) => {
                const definition = ECHO_SET_DEFS.find((set) => set.id === entry.setId)
                if (!definition) return null
                const setIcon = getSntSetIco(entry.setId)
                const countOptions = getRandSetCn(entry.setId)

                return (
                  <div key={`rc-set-${entry.setId}`} className="rc-set-row">
                    {setIcon && (
                      <img src={setIcon} alt={definition.name} className="rc-set-icon" loading="lazy" onError={withDefIconM} />
                    )}
                    <span className="rc-set-name">{definition.name}</span>
                    <div className="rc-set-counts">
                      {countOptions.map((option) => (
                        <button
                          key={option}
                          type="button"
                          className={`rc-count-btn${entry.count === option ? ' active' : ''}`}
                          onClick={() => onRandSetCnt(entry.setId, option)}
                        >
                          {option}pc
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="rc-remove-btn"
                      onClick={() => onRmRandSet(entry.setId)}
                      aria-label={`Remove ${definition.name}`}
                    >
                      ×
                    </button>
                  </div>
                )
              })
            )}
          </div>

          <div className="rc-footer">
            <button
              type="button"
              className="rc-reset-btn"
              onClick={() => updRandSets({ ...DEFRANDSETS, setPreferences: [] })}
            >
              ↺ Reset to defaults
            </button>
          </div>
        </div>
      </SuggsMdl>

      <EchoPicker
        visible={randMainEcho.visible}
        open={randMainEcho.open}
        closing={randMainEcho.closing}
        portalTarget={portalTarget}
        echoes={allEchoes}
        selEchoId={selRandMainE}
        slotIndex={0}
        onSelect={(echoId: string) => {
          updRandSets({ mainEchoId: echoId })
          bumpPickerFreq({
            bucket: 'echo',
            ids: [echoId],
          })
        }}
        onClear={() => updRandSets({ mainEchoId: null })}
        onClose={randMainEcho.hide}
      />
    </div>
  )
}

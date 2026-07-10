/*
  Author: Runor Ewhro
  Description: renders the pane surface for the calculator suggesstions flow.
*/

import { cloneElement, isValidElement as isVldElem, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes as HtmlAttrs } from 'react'
import type { EnemyProfile, PickFreqWeapon } from '@/domain/entities/appState.ts'
import type { RandGnrtSets, RandGnrtSetP, WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { cloneEchoLdt } from '@/domain/entities/inventoryStorage.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService.ts'
import { selActTgtSlc } from '@/domain/state/selectors.ts'
import { initWpnStts } from '@/domain/state/sourceStateInit.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { applySetPlan, mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import { mkCostPlns } from '@/engine/suggestions/randomEchoes/lib/combinations.ts'
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
import { calcSubPrio, type SubstatEntry } from '@/engine/suggestions/substat-priority/compute.ts'
import { calcSubBench, type SubstatBenchmark } from '@/data/scoring/substatBenchmark.ts'
import { SubstatPriorityTables as SubPrioTables, type SubstatViewRow } from '@/modules/calculator/features/suggesstions/SubstatPriorityTables.tsx'
import type {
  MainStatSugg,
  RandomEntry,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
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
import { canMainEchoFitSetPlan as canMainFitSet } from '@/modules/calculator/features/echoes/lib/quickSetup.ts'
import { WPNTYPETOKEY } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { resPssvPrms, weaponStatsAt, withDefWpnMg } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { EchoPicker } from '@/modules/calculator/features/echoes/Picker.tsx'
import { SetCond } from '@/modules/calculator/features/controls/SetConditional.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { useBenchPreview } from '@/modules/calculator/model/useBuildBenchmark.ts'
import {
  formatBuildBenchmarkScore as fmtBenchScore,
  getBuildBenchmarkBadgeClass as getBenchBadgeCls,
  getBuildBenchmarkBadgeStyle as getBenchBadgeStyle,
} from '@/modules/calculator/model/buildBenchmarkDisplay.ts'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { EchoGrid, mkEchoGridTm } from '@/shared/ui/EchoGrid.tsx'
import { SuggsMdl } from '@/modules/calculator/features/suggesstions/Parts.tsx'
import { WeaponConfig } from '@/modules/calculator/features/suggesstions/WeaponConfig.tsx'
import {
  targetOpts,
  targetGroups,
  type SuggTgtPtn,
} from '@/modules/calculator/features/suggesstions/lib/helpers.ts'
import { runCchdSuggJ } from '@/modules/calculator/features/suggesstions/lib/runs.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/calculator/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/calculator/features/echoes/lib/equip.ts'
import { Copy, Minus, Plus, TriangleAlert } from 'lucide-react'
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

const SUGG_RERUN_MS = 300

function randMainFitsPlan(
  mainEchoId: string | null | undefined,
  setPreferences: RandGnrtSetP[],
): boolean {
  if (!mainEchoId) {
    return true
  }

  const mainEcho = getEchoById(mainEchoId)
  if (!mainEcho) {
    return false
  }

  return mkCostPlns(mainEcho.cost).some((plan) => {
    const rest = [...plan]
    const costIndex = rest.indexOf(mainEcho.cost)
    if (costIndex < 0) {
      return false
    }

    rest.splice(costIndex, 1)
    return canMainFitSet(mainEcho.id, setPreferences, [mainEcho.cost, ...rest])
  })
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
  // how many tuning steps the substat add / remove columns simulate at once (1..88)
  const [substatSteps, setSubstatSteps] = useState(1)

  const setSubSteps = useCallback((value: number) => {
    setSubstatSteps(Math.max(1, Math.min(88, Math.round(value) || 1)))
  }, [])

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
  const updActResRt = useAppStore((state) => state.updActRt)
  const updActResSet = useAppStore((state) => state.updActConds)
  const maxWpnOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
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
  const rerunTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const randomRerunTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rerunForce = useRef(false)
  const randomRerunForce = useRef(false)
  const portalTarget = mainPortal()
  const activeSeed = useMemo(() => getResSeedBy(runtime.id), [runtime.id])
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



  const mutableTargetOptions = useMemo<SuggTgtPtn[]>(
    () => targetOpts(runtime.id, simulation),
    [runtime.id, simulation],
  )
  const fixedTargetOptions = useMemo<SuggTgtPtn[]>(
    () => targetOpts(runtime.id, simulation, { includeEchoAttacks: true }),
    [runtime.id, simulation],
  )
  const usesFixedTargets = viewMode === 'substats' || viewMode === 'weapons'
  const targetOptions = usesFixedTargets ? fixedTargetOptions : mutableTargetOptions

  const targetSkillGroups = useMemo(
    () => targetGroups(targetOptions),
    [targetOptions],
  )

  const selTgtVl = suggsStt.settings.rotationMode
    ? ROT_TGT_VL
    : (suggsStt.settings.targetFeatureId ?? '')
  const hasMutableTarget = suggsStt.settings.rotationMode
    ? mutableTargetOptions.some((option) => option.value === ROT_TGT_VL)
    : Boolean(
      suggsStt.settings.targetFeatureId &&
      mutableTargetOptions.some((option) => option.value === suggsStt.settings.targetFeatureId),
    )
  const hasFixedTarget = suggsStt.settings.rotationMode
    ? fixedTargetOptions.some((option) => option.value === ROT_TGT_VL)
    : Boolean(
      suggsStt.settings.targetFeatureId &&
      fixedTargetOptions.some((option) => option.value === suggsStt.settings.targetFeatureId),
    )

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
      !hasMutableTarget
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
    hasMutableTarget,
  ])

  const mainSuggVltnCtx = useMemo(() => {
    if (
      !simulation ||
      !activeSeed ||
      !hasMutableTarget
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
      setStateMode: 'resolved',
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
    hasMutableTarget,
  ])

  const fixedSuggVltnCtx = useMemo(() => {
    if (
      !simulation ||
      !activeSeed ||
      !hasFixedTarget
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
      setStateMode: 'resolved',
      tgtFeatId: suggsStt.settings.targetFeatureId,
      rotationMode: suggsStt.settings.rotationMode,
      includeEchoAttacks: true,
    }, simulation)
  }, [
    activeSeed,
    enemyProfile,
    hasFixedTarget,
    partRntmById,
    runtime,
    selTrgtByOwn,
    setConds,
    simulation,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  const mutableBaseDamage = useMemo(() => {
    if (!suggVltnCtx) {
      return 0
    }

    return evalSuggChs(suggVltnCtx, runtime.build.echoes)
  }, [runtime.build.echoes, suggVltnCtx])

  const mainBaseDamage = useMemo(() => {
    if (!mainSuggVltnCtx) {
      return 0
    }

    return evalSuggChs(mainSuggVltnCtx, runtime.build.echoes)
  }, [mainSuggVltnCtx, runtime.build.echoes])

  const fixedBaseDamage = useMemo(() => {
    if (!fixedSuggVltnCtx) {
      return 0
    }

    return evalSuggChs(fixedSuggVltnCtx, runtime.build.echoes)
  }, [fixedSuggVltnCtx, runtime.build.echoes])

  const baseDamage = viewMode === 'mainStats'
    ? mainBaseDamage
    : usesFixedTargets ? fixedBaseDamage : mutableBaseDamage

  const substatRows = useMemo<SubstatEntry[]>(() => {
    // substat priority is cheap (~30 evals) so it runs inline against the shared
    // evaluation context and recomputes live whenever the build or target changes.
    if (!fixedSuggVltnCtx) {
      return []
    }

    return calcSubPrio(fixedSuggVltnCtx, runtime.build.echoes, substatSteps)
  }, [fixedSuggVltnCtx, runtime.build.echoes, substatSteps])

  const substatView = useMemo<SubstatViewRow[]>(() => {
    // contribution share is relative to substats only, never the full damage total
    const sumContribution = substatRows.reduce(
      (sum, row) => sum + (row.present ? row.contribution : 0),
      0,
    )

    return substatRows.map((row) => ({
      ...row,
      contributionShare: row.present && sumContribution > 0
        ? (row.contribution / sumContribution) * 100
        : 0,
    }))
  }, [substatRows])

  const substatBenchmark = useMemo<SubstatBenchmark | null>(() => {
    if (!fixedSuggVltnCtx) {
      return null
    }

    return calcSubBench(fixedSuggVltnCtx, runtime.build.echoes)
  }, [fixedSuggVltnCtx, runtime.build.echoes])

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

  const canRunDrctSu = Boolean(activeSeed) && hasMutableTarget
  const canRunFixedSu = Boolean(activeSeed) && hasFixedTarget
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
  const mainSuggNptS = useMemo(() => inputSig({
    runtime,
    enemyProfile,
    prtcRntmById: partRntmById,
    selectedTargets: selTrgtByOwn,
    setConds: setConds,
    setStateMode: 'resolved',
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
    () => `main:${runtime.id}:${mainSuggNptS}`,
    [mainSuggNptS, runtime.id],
  )
  const setPlnsCchKe = useMemo(
    () => `sets:${runtime.id}:${baseSuggNptS}`,
    [baseSuggNptS, runtime.id],
  )
  const fixedSuggNptS = useMemo(() => inputSig({
    runtime,
    enemyProfile,
    prtcRntmById: partRntmById,
    selectedTargets: selTrgtByOwn,
    setConds: setConds,
    setStateMode: 'resolved',
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
    includeEchoAttacks: true,
  }), [
    enemyProfile,
    partRntmById,
    runtime,
    selTrgtByOwn,
    setConds,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])
  const wpnCchKey = useMemo(
    () => `weapon:${runtime.id}:${fixedSuggNptS}:${wpnSig(wpnSets)}`,
    [fixedSuggNptS, runtime.id, wpnSets],
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
              setStateMode: 'resolved',
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
      canRun: canRunFixedSu,
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
              includeEchoAttacks: true,
              weapon: wpnSets,
              topK: 30,
            }, simulation)
          : null
      ),
      run: runWpnSuggs,
    })
  }, [
    canRunFixedSu,
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

  const latestSuggestionRuns = useRef({
    runMainStats,
    runSetPlans,
    runWeapons,
    runRandom,
  })

  useEffect(() => {
    latestSuggestionRuns.current = {
      runMainStats,
      runSetPlans,
      runWeapons,
      runRandom,
    }
  }, [runMainStats, runRandom, runSetPlans, runWeapons])

  const schedRerun = useCallback((force = false) => {
    rerunForce.current = rerunForce.current || force
    if (rerunTimer.current) {
      clearTimeout(rerunTimer.current)
    }

    rerunTimer.current = setTimeout(() => {
      rerunTimer.current = null
      const runForce = rerunForce.current
      rerunForce.current = false

      setRandRslt([])
      setSelRandNd(0)
      void latestSuggestionRuns.current.runMainStats(runForce)
      void latestSuggestionRuns.current.runSetPlans(runForce)
      void latestSuggestionRuns.current.runWeapons(runForce)
    }, SUGG_RERUN_MS)
  }, [])

  const scheduleRandomRerun = useCallback((force = false) => {
    randomRerunForce.current = randomRerunForce.current || force
    if (randomRerunTimer.current) {
      clearTimeout(randomRerunTimer.current)
    }

    randomRerunTimer.current = setTimeout(() => {
      randomRerunTimer.current = null
      const runForce = randomRerunForce.current
      randomRerunForce.current = false

      void latestSuggestionRuns.current.runRandom(runForce)
    }, SUGG_RERUN_MS)
  }, [])

  useEffect(() => () => {
    if (rerunTimer.current) {
      clearTimeout(rerunTimer.current)
      rerunTimer.current = null
    }
    if (randomRerunTimer.current) {
      clearTimeout(randomRerunTimer.current)
      randomRerunTimer.current = null
    }
  }, [])

  useEffect(() => {
    // target/runtime changes refresh deterministic suggestion modes after a short coalescing delay and clear random results, which are
    // generated lazily only when the random tab is opened.
    schedRerun()
  }, [
    mainSttsCchK,
    setPlnsCchKe,
    wpnCchKey,
    schedRerun,
  ])

  useEffect(() => {
    // set conditionals hydrate from persisted runtime state on mount; skip the first pass so loading saved conditionals
    // does not force-refresh the initial cache.
    if (!didHydrSetCo.current) {
      didHydrSetCo.current = true
      return
    }

    schedRerun(true)
  }, [setCondsSig, schedRerun])

  useEffect(() => {
    // random suggestions are the expensive path, so run them on demand rather than every time the user changes target
    // or conditionals while viewing another tab.
    if (viewMode === 'random' && randRslt.length === 0 && !rnnnRand && canRunDrctSu) {
      scheduleRandomRerun()
    }
  }, [canRunDrctSu, randCchKey, randRslt.length, rnnnRand, scheduleRandomRerun, viewMode])

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

    updActResRt((curRt) => {
      const nextRuntime = {
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
      }
      const initialized = initWpnStts(nextRuntime, {
        weaponId: plan.weaponId,
        prevWpnId: curRt.build.weapon.id,
        maxed: maxWpnOnInit,
      })

      return {
        ...initialized,
        state: {
          ...initialized.state,
          controls: {
            ...initialized.state.controls,
            ...plan.controls,
          },
        },
      }
    })

    bumpPickerFreq({
      bucket: 'weapon',
      weaponType: wpnKey,
      ids: [plan.weaponId],
    })
  }, [activeSeed?.weaponType, bumpPickerFreq, maxWpnOnInit, updActResRt])

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
  const { score: randomBuildScore } = useBenchPreview({
    runtime: viewMode === 'random' && selRandPlan ? runtime : null,
    echoes: selRandPlan?.echoes ?? [],
    runtimesById: partRntmById,
    targetSelections: selTrgtByOwn,
  })
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
  const randMainInvalid = useMemo(
    () => Boolean(
      suggsStt.random.mainEchoId &&
      !randMainFitsPlan(suggsStt.random.mainEchoId, suggsStt.random.setPreferences),
    ),
    [suggsStt.random.mainEchoId, suggsStt.random.setPreferences],
  )
  const ttlRandSetPc = useMemo(
    () => suggsStt.random.setPreferences.reduce((sum, entry) => sum + entry.count, 0),
    [suggsStt.random.setPreferences],
  )
  // the random generator can either be unconstrained, or constrained by up to three set preferences across five slots.
  const canAddRandSe = ttlRandSetPc < 5 && suggsStt.random.setPreferences.length < 3
  const vlblRandSetP = useMemo(() => (
    ECHO_SET_DEFS
      .filter((entry) => (
        !suggsStt.random.setPreferences.some((selected) => selected.setId === entry.id) &&
        getRandSetCn(entry.id).some((count) => count <= 5 - ttlRandSetPc)
      ))
      .map((entry) => ({
        value: String(entry.id),
        label: entry.name,
        icon: getSntSetIco(entry.id) ?? undefined,
      }))
  ), [suggsStt.random.setPreferences, ttlRandSetPc])

  const onAddRandSet = useCallback((value: string) => {
    const setId = Number(value)
    if (!Number.isFinite(setId)) {
      return
    }

    const remaining = 5 - ttlRandSetPc
    const defaultCount = getRandSetCn(setId).find((count) => count <= remaining)
    if (!defaultCount) {
      return
    }

    // newest set preference is placed first so the configuration summary follows the user's last explicit choice.
    updRandSetPr((preferences) => [
      { setId, count: defaultCount },
      ...preferences.filter((entry) => entry.setId !== setId),
    ])
  }, [ttlRandSetPc, updRandSetPr])

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
              className={`echo-tool pane-view-toggle__button${viewMode === 'substats' ? ' is-active' : ''}`}
              aria-pressed={viewMode === 'substats'}
              onClick={() => setSugView('substats')}
            >
              Sub Stats
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
                    groups={targetSkillGroups}
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
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(recipe.primaryKey)}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(recipe.primaryKey, ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0)}</span>
                          </span>
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(ECHO_SIDE_STATS[recipe.cost]?.key ?? 'atkFlat')}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(ECHO_SIDE_STATS[recipe.cost]?.key ?? 'atkFlat', ECHO_SIDE_STATS[recipe.cost]?.value ?? 0)}</span>
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
                    groups={targetSkillGroups}
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
                    <span className="set-plan-damage-main">{formatCompactNum(plan.avgDamage)}</span>
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
                    groups={targetSkillGroups}
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
                          <span className="weapon-sugg-pill-k">{formatStatKeyLabel(targetPlan.statKey)}</span>
                          <span className="weapon-sugg-pill-v">{formatStatKeyValue(targetPlan.statKey, targetPlan.statValue)}</span>
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
                    groups={targetSkillGroups}
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
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(echo.mainStats.primary.key)}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
                          </span>
                          <span className="echo-buff main-stat-pill">
                            <span className="main-stat-pill-stat">{formatStatKeyLabel(echo.mainStats.secondary.key)}</span>
                            <span className="main-stat-pill-value highlight">{formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
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

      {viewMode === 'substats' && (
        <div className="suggestions-list substat-view">
          <div className="pane-section suggestions-controls rotation-pane-controls">
            <div className="rotation-toolbar">
              <div className="rotation-toolbar-group">
                <div className="rotation-toolbar-field ui-inline-field ui-inline-field--wide">
                  <LiquidSelect
                    value={selTgtVl}
                    options={targetOptions}
                    groups={targetSkillGroups}
                    onChange={(value) => onTgtChng(String(value))}
                    placeholder="Target Skill"
                  />
                </div>
              </div>
              <div className="subx-rolls">
                <span className="subx-rolls__lbl">Steps</span>
                <div className="subx-rolls__stepper" role="group" aria-label="Number of steps to add or remove">
                  <button
                    type="button"
                    className="subx-rolls__btn"
                    onClick={() => setSubSteps(substatSteps - 1)}
                    disabled={substatSteps <= 1}
                    aria-label="Fewer steps"
                  >
                    <Minus size={14} aria-hidden="true" />
                  </button>
                  <input
                    type="number"
                    className="subx-rolls__val"
                    min={1}
                    max={88}
                    value={substatSteps}
                    onChange={(event) => setSubSteps(Number(event.target.value))}
                    aria-label="Steps to add or remove"
                  />
                  <button
                    type="button"
                    className="subx-rolls__btn"
                    onClick={() => setSubSteps(substatSteps + 1)}
                    disabled={substatSteps >= 88}
                    aria-label="More steps"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <SubPrioTables rows={substatView} benchmark={substatBenchmark} steps={substatSteps} />
        </div>
      )}

      <SuggsMdl
        {...inspectModal}
        title={
          viewMode === 'setPlans'
            ? 'Inspect Suggested Sonata Sets'
            : viewMode === 'random'
              ? 'Inspect Random Echo Build'
              : viewMode === 'weapons'
                ? 'Inspect Suggested Weapon'
                : 'Inspect Suggested Main Stats'
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
                  <span className="weapon-inspect__spec-k">{formatStatKeyLabel(opts.statKey)}</span>
                  <span className="weapon-inspect__spec-v">{formatStatKeyValue(opts.statKey, opts.statValue)}</span>
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
            {randomBuildScore !== null ? (
              <span
                className={getBenchBadgeCls(randomBuildScore)}
                style={getBenchBadgeStyle(randomBuildScore)}
              >
                {fmtBenchScore(randomBuildScore)}
              </span>
            ) : (
              <span className="suggestions-config-value">-</span>
            )}
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
        <WeaponConfig runtime={runtime} seed={activeSeed} />
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
                <button
                  type="button"
                  className={`rc-echo-btn${randMainInvalid ? ' is-invalid' : ''}`}
                  onClick={randMainEcho.show}
                  aria-invalid={randMainInvalid || undefined}
                  title={randMainInvalid ? 'This echo cannot be generated with the selected Sonata plan.' : undefined}
                >
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
                  {randMainInvalid ? (
                    <span className="rc-echo-invalid" aria-hidden>
                      <TriangleAlert size={11} strokeWidth={2.6} />
                    </span>
                  ) : null}
                </button>
              </div>

              <div className="rc-row">
                <span className="rc-label">Target</span>
                <LiquidSelect
                  value={selTgtVl}
                  options={targetOptions}
                  groups={targetSkillGroups}
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
                  <span className="rc-slider-value">{formatTruncCompact(suggsStt.random.bias, 1)}</span>
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
                  <span className="rc-slider-value">{formatTruncCompact(suggsStt.random.rollQuality, 1)}</span>
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
              <span className="rc-empty">No constraints.</span>
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

/*
  Author: Runor Ewhro
  Description: Coordinates suggestion runs, target routing, result selection,
               and preview materialization across main-stat, set, weapon, and random modes.
*/

import { cloneElement, isValidElement as isVldElem, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties as CssProps, HTMLAttributes as HtmlAttrs } from 'react'
import type { EnemyProfile, PickFreqWeapon } from '@/domain/entities/appState.ts'
import type { RandGnrtSets, RandGnrtSetP, WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import { cloneEchoLoadout } from '@/domain/entities/inventoryStorage.ts'
import { DEF_SET_COND } from '@/domain/entities/sonataSetConditionals.ts'
import { getEchoById, listEchoes } from '@/data/catalog/echoCatalogService.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { getWpnById } from '@/data/catalog/weaponCatalogService.ts'
import { selActTgtSlc } from '@/application/state'
import { initWpnStts } from '@/engine/runtime/sourceStateInit.ts'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats.ts'
import { getSntSetClr, getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets.ts'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects.ts'
import { applySetPlan, mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import { applyMainSta } from '@/engine/suggestions/mainStat-suggestion/utils.ts'
import { runMainStatS, runSetPlanSu, runWpnSuggs } from '@/engine/suggestions/client.ts'
import { readSuggsSss, writeSuggsSs } from '@/engine/suggestions/sessionCache.ts'
import {
  mkPrepMainSt,
  mkPrepSetPla,
  mkPrepWpnSu,
  mkSuggVltnCt,
  evalSuggChs,
  resSuggDmg,
} from '@/engine/suggestions/shared.ts'
import {
  calcSubPrio,
  type SubstatEntry,
} from '@/modules/simulation/surfaces/suggestions/surfaceAlgorithms/substatPriority.ts'
import { runRandomEchoSuggestions } from '@/modules/simulation/surfaces/suggestions/surfaceAlgorithms/randomEchoes/client.ts'
import { makeRandomEchoCostPlans } from '@/modules/simulation/surfaces/suggestions/surfaceAlgorithms/randomEchoes/combinations.ts'
import { prepareRandomEchoGeneration } from '@/modules/simulation/surfaces/suggestions/surfaceAlgorithms/randomEchoes/prepare.ts'
import type { RandomEchoEntry } from '@/modules/simulation/surfaces/suggestions/surfaceAlgorithms/randomEchoes/types.ts'
import { calcSubEvaluation, type SubstatEvaluation } from '@/engine/evaluation/substatEvaluation.ts'
import { SubstatPriorityTables as SubPrioTables, type SubstatViewRow } from '@/modules/simulation/surfaces/suggestions/SubstatPriorityTables.tsx'
import type {
  MainStatSugg,
  SetPlanSuggest,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { formatCompactNum, formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { rarityVars } from '@/modules/simulation/model/display.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import {
  DEFRANDSETS,
  DEFWPNSETS,
  DEFAULT_SUGG,
  ROT_TGT_VL,
  mkEchoFullSi,
  mkGrpdSbst,
  recipeSig,
  randomSig,
  wpnSig,
  setsSig,
  inputSig,
  percentDiff,
  getDiffLabel,
  getDiffTone,
  getRandSetCn,
  normSetCount,
  sortChsForDs,
  sortRecipes,
  smmrCurSetPl,
  trimRandSetP,
} from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'
import { getQppdEchoC } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { canMainEchoFitSetPlan as canMainFitSet } from '@/modules/simulation/features/echoes/lib/quickSetup.ts'
import { WPNTYPETOKEY } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { withDefWpnMg } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { EchoPicker } from '@/modules/simulation/features/echoes/Picker.tsx'
import { SetCond } from '@/modules/simulation/features/controls/SetConditional.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { LiquidSelect } from '@/application/ui/LiquidSelect.tsx'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { statIconSrc } from '@/modules/simulation/workspace/ui.tsx'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { EchoRows, EchoRowsFoot, makeEchoRows } from '@/modules/simulation/features/echoes/ui/EchoRows.tsx'
import {
  ResultBlock,
  SgcBtn,
  SpxRank,
  SpxResult,
  StatTray,
  SubStrip,
  SuggEmpty,
  SuggsMdl,
  SuggToolbar,
  selectableProps,
} from '@/modules/simulation/surfaces/suggestions/Parts.tsx'
import { WpnCfgMdl } from '@/modules/simulation/surfaces/suggestions/WeaponConfig.tsx'
import { WeaponInspect } from '@/modules/simulation/surfaces/suggestions/WeaponInspect.tsx'
import {
  targetOpts,
  targetGroups,
  type SuggTgtPtn,
} from '@/modules/simulation/surfaces/suggestions/lib/helpers.ts'
import { getSetPlanDisplay, groupWeaponSuggestions, sameSetPlanCandidate } from './lib/results.ts'
import { runCchdSuggJ } from '@/modules/simulation/surfaces/suggestions/lib/runs.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { Check, Copy, Minus, Plus, RefreshCw, RotateCcw, Search, SlidersHorizontal, TriangleAlert } from 'lucide-react'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'

interface SuggestionsPaneProps {
  runtime: ResRuntime
  simulation: SimResult | null
  enemyProfile: EnemyProfile
  prtcRntmById: Record<string, ResRuntime>
}

function statIconStyle(key: string): CssProps | undefined {
  const src = statIconSrc(key)
  return src
    ? ({ WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` } as CssProps)
    : undefined
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

  return makeRandomEchoCostPlans(mainEcho.cost).some((plan) => {
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
}: SuggestionsPaneProps) {
  const [mainStatRslt, setMainStatR] = useState<MainStatSugg[]>([])
  const [setPlanRslt, setSetPlanRs] = useState<SetPlanSuggest[]>([])
  const [wpnRslt, setWpnRslt] = useState<WeaponEntry[]>([])
  const [randRslt, setRandRslt] = useState<RandomEchoEntry[]>([])
  const [selMainStatN, setSelMainSt] = useState(0)
  const [selSetPlanNd, setSelSetPla] = useState(0)
  const [selWpnNdx, setSelWpnNd] = useState(0)
  const [selRandNdx, setSelRandNd] = useState(0)
  const [rnnnMainStat, setRnnnMainS] = useState(false)
  const [rnnnSetPlns, setRnnnSetPl] = useState(false)
  const [rnnnWpns, setRnnnWpns] = useState(false)
  const [rnnnRand, setRnnnRand] = useState(false)
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
  const scenarioId = useAppStore((state) => selectedCombatScenario(state.combat).id)
  const memberId = useAppStore((state) => selectedCombatScenario(state.combat).team.members[0].id)
  const scenarioIdentity = useMemo(
    () => ({ scenarioId, memberId }),
    [memberId, scenarioId],
  )
  const viewMode = useAppStore((state) => state.ui.suggsViewMode)
  const setSugView = useAppStore((state) => state.setSugView)
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const suggsMap = useAppStore((state) => state.simulation.suggestionsByResonatorId)
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const updActResRt = useAppStore((state) => state.updActRt)
  const updActResSet = useAppStore((state) => state.updActConds)
  const maxWpnOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const setConds = useAppStore((state) => (
    selectedCombatScenario(state.combat).team.members.find(
      (member) => member.resonatorId === runtime.id,
    )?.local.setConditionals ?? DEF_SET_COND
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
    // affecting the rest of the scenario state.
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
      ...scenarioIdentity,
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
    scenarioIdentity,
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
      ...scenarioIdentity,
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
    scenarioIdentity,
  ])

  const mutableBaseDamage = useMemo(() => {
    if (!suggVltnCtx) {
      return 0
    }

    return evalSuggChs(suggVltnCtx, runtime.build.echoes)
  }, [runtime.build.echoes, suggVltnCtx])

  const mainBaseDamage = useMemo(() => {
    if (!simulation || !activeSeed || !hasMutableTarget) return 0
    return resSuggDmg(simulation, {
      ...scenarioIdentity,
      runtime,
      seed: activeSeed,
      enemy: enemyProfile,
      runtimesById: partRntmById,
      selectedTargets: selTrgtByOwn,
      setConds,
      setStateMode: 'resolved',
      tgtFeatId: suggsStt.settings.targetFeatureId,
      rotationMode: suggsStt.settings.rotationMode,
      includeEchoAttacks: true,
    })
  }, [activeSeed, enemyProfile, hasMutableTarget, partRntmById, runtime, scenarioIdentity,
    selTrgtByOwn, setConds, simulation, suggsStt.settings.rotationMode, suggsStt.settings.targetFeatureId])
  const setPlanBaseDamage = mainBaseDamage

  const fixedBaseDamage = useMemo(() => {
    if (!fixedSuggVltnCtx) {
      return 0
    }

    return evalSuggChs(fixedSuggVltnCtx, runtime.build.echoes)
  }, [fixedSuggVltnCtx, runtime.build.echoes])
  const weaponBaseDamage = useMemo(() => {
    if (!simulation || !activeSeed || !hasFixedTarget) {
      return 0
    }

    return resSuggDmg(simulation, {
      ...scenarioIdentity,
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
    })
  }, [
    activeSeed,
    enemyProfile,
    hasFixedTarget,
    partRntmById,
    runtime,
    scenarioIdentity,
    selTrgtByOwn,
    setConds,
    simulation,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  const baseDamage = viewMode === 'mainStats'
    ? mainBaseDamage
    : viewMode === 'setPlans'
      ? setPlanBaseDamage
      : viewMode === 'weapons'
        ? weaponBaseDamage
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

  const substatEvaluation = useMemo<SubstatEvaluation | null>(() => {
    if (!fixedSuggVltnCtx) {
      return null
    }

    return calcSubEvaluation(fixedSuggVltnCtx, runtime.build.echoes)
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
    includeEchoAttacks: true,
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
    () => `main:v2:${runtime.id}:${mainSuggNptS}`,
    [mainSuggNptS, runtime.id],
  )
  const setPlnsCchKe = useMemo(
    () => `sets:v3:${runtime.id}:${baseSuggNptS}`,
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
              ...scenarioIdentity,
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
    scenarioIdentity,
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
              ...scenarioIdentity,
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
    scenarioIdentity,
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
              ...scenarioIdentity,
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
    scenarioIdentity,
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
      readCached: (cacheKey) => readSuggsSss<RandomEchoEntry[]>(cacheKey),
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
          ? prepareRandomEchoGeneration({
              ...scenarioIdentity,
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
      run: runRandomEchoSuggestions,
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
    scenarioIdentity,
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
        echoes: cloneEchoLoadout(echoes),
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
    currentEchoes: runtime.build.echoes,
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
  const setPlanListRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const list = setPlanListRef.current
    if (!list) {
      return
    }
    const measure = () => {
      const trays = Array.from(list.querySelectorAll<HTMLElement>('.spx-trays'))
      list.classList.add('spx-measuring')
      const fits = trays.map((tray) => tray.scrollWidth <= tray.clientWidth + 0.5)
      list.classList.remove('spx-measuring')
      trays.forEach((tray, index) => tray.classList.toggle('spx-trays--named', fits[index]))
    }
    measure()
    document.fonts?.ready.then(measure).catch(() => {})
    let lastWidth = -1
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      if (Math.abs(width - lastWidth) < 0.5) {
        return
      }
      lastWidth = width
      measure()
    })
    observer.observe(list)
    return () => observer.disconnect()
  }, [setPlanRslt, viewMode])
  const selSetPlanCh = useMemo(
    () => selSetPlan
      ? applySetPlan(selSetPlan.setPlan, runtime.build.echoes)
      : [],
    [runtime.build.echoes, selSetPlan],
  )
  const wpnCards = useMemo(() => groupWeaponSuggestions(wpnRslt), [wpnRslt])
  const selWpnCard = wpnCards[selWpnNdx] ?? null
  const selWpnPlan = selWpnCard?.plans[0] ?? null
  const maxWpnDmg = useMemo(
    () => wpnCards.reduce((max, card) => card.plans.reduce((m, p) => Math.max(m, p.damage), max), 0),
    [wpnCards],
  )
  const selRandPlan = randRslt[selRandNdx] ?? null
  const nspcChs = useMemo(
    // Derive inspection data from the active result family rather than retaining a second selection.
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
  const nspcGridTms = useMemo(() => makeEchoRows({
    echoes: nspcChs,
  }), [nspcChs])
  const nspcSelTms = useMemo(
    // Suggested loadouts may reuse a uid, so slot position completes the selection identity.
    () => nspcGridTms
      .filter((item): item is typeof item & { echo: EchoInstance } => Boolean(item.echo))
      .map((item) => ({
        id: `suggestions:${viewMode}:${item.echo.uid}:${item.renderIndex}`,
        val: item.echo,
      })),
    [nspcGridTms, viewMode],
  )
  const nspcSelCtns = useMemo(() => [{
    id: 'suggestions:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size="1em" />,
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

  const targetSelect = (
    <div className="sgc__target">
      <LiquidSelect
        value={selTgtVl}
        options={targetOptions}
        groups={targetSkillGroups}
        onChange={(value) => onTgtChng(String(value))}
        placeholder="Target Skill"
      />
    </div>
  )

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
        <div className="suggestions-list">
          {rnnnMainStat && null}
          <SuggToolbar target={targetSelect}>
            <SgcBtn variant="ghost" icon={Search} label="Inspect" onClick={inspectModal.show} disabled={!selMainStatP} />
            <SgcBtn variant="primary" icon={Check} label="Apply" onClick={() => selMainStatP && applyEchoes(selMainStatC)} disabled={!selMainStatP} />
            <SgcBtn variant="danger" icon={RotateCcw} label="Reset" onClick={() => setSelMainSt(0)} />
          </SuggToolbar>

          {mainStatRslt.length === 0 ? (
            <SuggEmpty
              running={rnnnMainStat}
              loadingText="Generating Main Stat suggestions…"
              idleText="Select a target above to see main stat suggestions... Make sure you've got echoes equipped~!"
            />
          ) : (
            <ResultBlock name="Main stats" count={mainStatRslt.length}>
              <div className="spx-list" style={{ gap: '.5rem'}}>
                {mainStatRslt.map((plan, index) => {
                  const isCurrent = recipeSig(plan.recipes) === curMainStatS

                  return (
                    <div
                      key={`main-${index}`}
                      className={`spx-row${selMainStatN === index ? ' is-selected' : ''}${isCurrent ? ' spx-row--equipped' : ''}`}
                      style={{ '--row': index } as CssProps}
                      data-mode={viewMode}
                      {...selectableProps(selMainStatN === index, () => setSelMainSt(index))}
                    >
                      <SpxRank n={index + 1} />
                      <div className="spx-trays">
                        {sortRecipes(plan.recipes).map((recipe, recipeIndex) => {
                          const value = formatStatKeyValue(recipe.primaryKey, ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey] ?? 0)
                          const side = ECHO_SIDE_STATS[recipe.cost]
                          const sideValue = side ? formatStatKeyValue(side.key, side.value) : null
                          return (
                            <StatTray
                              key={`${recipe.cost}-${recipe.primaryKey}-${recipeIndex}`}
                              cost={recipe.cost}
                              title={`Cost ${recipe.cost} · ${formatStatKeyLabel(recipe.primaryKey)} ${value}${side ? ` + ${formatStatKeyLabel(side.key)} ${sideValue}` : ''}`}
                              primaryVal={value}
                              primaryIcon={statIconStyle(recipe.primaryKey)}
                              subVal={sideValue}
                              subIcon={side ? statIconStyle(side.key) : undefined}
                            />
                          )
                        })}
                      </div>
                      <SpxResult value={formatCompactNum(plan.damage)} isCurrent={isCurrent} diff={percentDiff(plan.damage, baseDamage)} />
                    </div>
                  )
                })}
              </div>
            </ResultBlock>
          )}
        </div>
      )}

      {viewMode === 'setPlans' && (
        <div className="suggestions-list">
          {rnnnSetPlns && null}
          <SuggToolbar target={targetSelect}>
            <SgcBtn variant="ghost" icon={SlidersHorizontal} label="Config" onClick={setCnfgMdl.show} />
            <SgcBtn variant="ghost" icon={Search} label="Inspect" onClick={inspectModal.show} disabled={!selSetPlan} />
            <SgcBtn variant="primary" icon={Check} label="Apply" onClick={() => selSetPlan && applyEchoes(selSetPlanCh)} disabled={!selSetPlan} />
            <SgcBtn variant="danger" icon={RotateCcw} label="Reset" onClick={() => setSelSetPla(0)} />
          </SuggToolbar>

          {setPlanRslt.length === 0 ? (
            <SuggEmpty
              running={rnnnSetPlns}
              loadingText="Generating Sonata set suggestions…"
              idleText="Select a target above to see Sonata set suggestions... Make sure you've got echoes equipped~!"
            />
          ) : (
            <ResultBlock name="Set plan" count={setPlanRslt.length}>
              <div className="spx-list" ref={setPlanListRef}>
                {setPlanRslt.map((plan, index) => {
                  const isCurrent = sameSetPlanCandidate(plan, curSetPlan, baseDamage)
                  const displayPlan = getSetPlanDisplay(plan)

                  return (
                    <div
                      key={`set-${index}`}
                      className={`spx-row${selSetPlanNd === index ? ' is-selected' : ''}${isCurrent ? ' spx-row--equipped' : ''}`}
                      style={{ '--row': index } as CssProps}
                      data-mode={viewMode}
                      {...selectableProps(selSetPlanNd === index, () => setSelSetPla(index))}
                    >
                      <SpxRank n={index + 1} />
                      <div className="spx-trays">
                        {displayPlan.map((entry, entryIndex) => {
                          const primaryColor = getSntSetClr(entry.setIds[0])
                          const setNames = entry.setIds.map(getSntSetNam)
                          return (
                            <div
                              key={`${entry.setIds.join('-')}-${entry.pieces}-${entryIndex}`} className="spx-tray"
                              style={primaryColor ? { '--spx-set-clr': primaryColor } as CssProps : undefined}
                              title={`${entry.pieces}pc · ${setNames.join(' / ')}`}
                            >
                              <span className="spx-tray__pc">{entry.pieces}<small>pc</small></span>
                              <span className="spx-tray__coins">
                                {entry.setIds.map((setId) => {
                                  const icon = getSntSetIco(setId)
                                  return icon ? (
                                    <img key={setId} src={icon} alt="" className="spx-tray__coin" loading="lazy" onError={withDefIconM} />
                                  ) : null
                                })}
                              </span>

                              <span className="spx-tray__name">{setNames[0]}</span>
                              {entry.setIds.length > 1 ? (<span className="spx-tray__sup">{entry.setIds.length}</span>) : null}

                            </div>
                          )
                        })}
                      </div>
                      <SpxResult value={formatCompactNum(plan.avgDamage)} isCurrent={isCurrent} diff={percentDiff(plan.avgDamage, baseDamage)} />
                    </div>
                  )
                })}
              </div>
            </ResultBlock>
          )}
        </div>
      )}

      {viewMode === 'weapons' && (
        <div className="suggestions-list" wpsgg-mode={weaponSuggests.mode}>
          {rnnnWpns && null}
          <SuggToolbar target={targetSelect}>
            <SgcBtn variant="ghost" icon={SlidersHorizontal} label="Config" onClick={wpnCnfgMdl.show} />
            <SgcBtn variant="ghost" icon={Search} label="Inspect" onClick={inspectModal.show} disabled={!selWpnCard} />
            <SgcBtn variant="primary" icon={Check} label="Apply" onClick={() => selWpnPlan && applyWeapon(selWpnPlan)} disabled={!selWpnCard} />
            <SgcBtn variant="danger" icon={RotateCcw} label="Reset" onClick={() => setSelWpnNd(0)} />
          </SuggToolbar>

          {wpnCards.length === 0 ? (
            <SuggEmpty
              running={rnnnWpns}
              loadingText="Generating weapon suggestions…"
              idleText="Select a target above to see weapon suggestions."
            />
          ) : (
            <ResultBlock name="Weapon suggestions" count={wpnCards.length} note="ranked by target dmg">

              <div className="ws-list">
                {wpnCards.map((card, index) => {
                  const targetMode = wpnSets.mode === 'both' ? wpnSets.target : wpnSets.mode
                  const targetPlan = card.plans.find((p) => p.mode === targetMode) ?? card.plans[0]
                  if (!targetPlan) return null
                  const altPlan = card.plans.find((p) => p !== targetPlan) ?? null
                  const targetDiff = percentDiff(targetPlan.damage, baseDamage)
                  const altDiff = altPlan ? percentDiff(altPlan.damage, baseDamage) : 0
                  const isCurrent = targetPlan.weaponId === runtime.build.weapon.id
                  const targetTone = isCurrent ? 'zero' : getDiffTone(targetDiff)
                  const weaponType = getWpnById(targetPlan.weaponId)?.weaponType ?? 0
                  const typeSlug = WPNTYPETOKEY[weaponType as keyof typeof WPNTYPETOKEY]
                  const typeMask = typeSlug
                    ? ({
                        WebkitMaskImage: `url("/assets/game/weapons/types/${typeSlug}.webp")`,
                        maskImage: `url("/assets/game/weapons/types/${typeSlug}.webp")`,
                      } as CssProps)
                    : undefined
                  const targetPct = maxWpnDmg > 0 ? (targetPlan.damage / maxWpnDmg) * 100 : 0
                  const altPct = altPlan && maxWpnDmg > 0 ? (altPlan.damage / maxWpnDmg) * 100 : 0
                  const atkIconStyle = statIconStyle('atk')
                  const subIconStyle = statIconStyle(targetPlan.statKey)

                  return (
                    <div
                      key={`weapon-${card.id}`}
                      className={`ws-card${selWpnNdx === index ? ' sel' : ''}`}
                      style={{ ...(rarityVars(targetPlan.rarity, false, '--rar') ?? {}), '--row': index } as CssProps}
                      {...selectableProps(selWpnNdx === index, () => setSelWpnNd(index))}
                    >
                      <div className="ws-art-slice">
                        <img src={targetPlan.icon} alt={targetPlan.name} className="ws-art" loading="lazy" onError={withDefWpnMg} />
                        {typeMask ? <span className="ws-wm" style={typeMask} aria-hidden="true" /> : null}
                        <span className="ws-ref">R{targetPlan.rank}</span>
                      </div>
                      <span className="ws-seam" aria-hidden="true" />
                      <div className="ws-spec">
                        <div className="ws-info">
                          <div className="ws-top">
                            <span className="ws-rank">{index + 1}</span>
                            <span className="ws-name">{targetPlan.name}</span>
                          </div>
                          <div className="ws-specrow">
                            <span className="ws-stat" title={`ATK ${Math.round(targetPlan.baseAtk)}`}>
                              {atkIconStyle ? <span className="ws-stat__ico" style={atkIconStyle} aria-hidden="true" /> : null}
                              <b>{Math.round(targetPlan.baseAtk)}</b>
                            </span>
                            <span className="ws-stat" title={`${formatStatKeyLabel(targetPlan.statKey)} ${formatStatKeyValue(targetPlan.statKey, targetPlan.statValue)}`}>
                              {subIconStyle ? <span className="ws-stat__ico" style={subIconStyle} aria-hidden="true" /> : null}
                              <b>{formatStatKeyValue(targetPlan.statKey, targetPlan.statValue)}</b>
                            </span>
                          </div>
                        </div>
                        <div className="ws-modes">
                          <div className={`ws-mode${altPlan ? '' : ' ws-mode--solo'}`}>
                            <div className="ws-mode__hd">
                              <span className="ws-mode__tag">{altPlan ? (targetPlan.mode === 'max' ? 'MAX' : 'DEF') : 'DMG'}</span>
                              <span className={`ws-diff ${targetTone}`}>
                                {isCurrent ? 'base' : `${targetDiff > 0 ? '+' : targetDiff < 0 ? '−' : ''}${getDiffLabel(targetDiff, false)}`}
                              </span>
                              <span className="ws-dmg">{formatCompactNum(targetPlan.damage)}</span>
                            </div>
                            <div className="ws-bar"><i style={{ width: `${targetPct}%` }} /></div>
                            {!altPlan ? (
                              <div className="ws-gauge" aria-hidden="true">
                                <span className="ws-gauge__track">
                                  <i className="ws-gauge__fill" style={{ width: `${targetPct}%` }} />
                                </span>
                                <span className="ws-gauge__legend">
                                  <span className="ws-gauge__pct">{Math.round(targetPct)}%<small>of best</small></span>
                                  <span className="ws-gauge__cap">best {formatCompactNum(maxWpnDmg)}</span>
                                </span>
                              </div>
                            ) : null}
                          </div>
                          {altPlan ? (
                            <div className="ws-mode">
                              <div className="ws-mode__hd">
                                <span className="ws-mode__tag">{altPlan.mode === 'max' ? 'MAX' : 'DEF'}</span>
                                <span className={`ws-diff ${getDiffTone(altDiff)}`}>
                                  {`${altDiff > 0 ? '+' : altDiff < 0 ? '−' : ''}${getDiffLabel(altDiff, false)}`}
                                </span>
                                <span className="ws-dmg">{formatCompactNum(altPlan.damage)}</span>
                              </div>
                              <div className="ws-bar"><i style={{ width: `${altPct}%` }} /></div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ResultBlock>
          )}
        </div>
      )}

      {viewMode === 'random' && (
        <div className="suggestions-list">
          <SuggToolbar target={targetSelect} dense>
            <SgcBtn variant="ghost" icon={SlidersHorizontal} label="Config" onClick={randCnfgMdl.show} />
            <SgcBtn variant="ghost" icon={Search} label="Inspect" onClick={inspectModal.show} disabled={!selRandPlan} />
            <SgcBtn variant="ghost" icon={RefreshCw} label={rnnnRand ? 'Running' : 'Regenerate'} onClick={() => void runRandom(true)} disabled={rnnnRand} />
            <SgcBtn variant="primary" icon={Check} label="Apply" onClick={() => selRandPlan && applyEchoes(selRandPlan.echoes)} disabled={!selRandPlan} />
            <SgcBtn variant="danger" icon={RotateCcw} label="Reset" onClick={() => setSelRandNd(0)} />
          </SuggToolbar>

          {(randRslt.length === 0 || rnnnRand) ? (
            <SuggEmpty running loadingText="Generating random echo builds…" />
          ) : (
            <ResultBlock name="Random builds" count={randRslt.length}>
              <div className="spx-list">
                {randRslt.map((plan, index) => {
                  const isCurrent = mkEchoFullSi(plan.echoes) === curEchoSig
                  const grpdSbst = mkGrpdSbst(plan.echoes).slice(0, 6)

                  return (
                    <div
                      key={`random-${index}`}
                      className={`spx-row${selRandNdx === index ? ' is-selected' : ''}${isCurrent ? ' spx-row--equipped' : ''}`}
                      style={{ '--row': index } as CssProps}
                      data-mode={viewMode}
                      {...selectableProps(selRandNdx === index, () => setSelRandNd(index))}
                    >
                      <div className="sst-main">
                        <div className="sst-lead">
                          <SpxRank n={index + 1} />
                          <div className="spx-trays">
                            {sortChsForDs(plan.echoes).map((echo) => {
                              const cost = getQppdEchoC(echo)
                              const key = echo.mainStats.primary.key
                              const value = formatStatKeyValue(key, echo.mainStats.primary.value)
                              const subKey = echo.mainStats.secondary.key
                              const subValue = formatStatKeyValue(subKey, echo.mainStats.secondary.value)
                              return (
                                <StatTray
                                  key={echo.uid}
                                  cost={cost}
                                  title={`Cost ${cost} · ${formatStatKeyLabel(key)} ${value} + ${formatStatKeyLabel(subKey)} ${subValue}`}
                                  primaryVal={value}
                                  primaryIcon={statIconStyle(key)}
                                  subVal={subValue}
                                  subIcon={statIconStyle(subKey)}
                                />
                              )
                            })}
                          </div>
                        </div>
                        <SubStrip
                          subs={grpdSbst.map((entry) => ({
                            key: entry.key,
                            label: entry.label,
                            value: entry.value,
                            icon: statIconStyle(entry.key),
                          }))}
                        />
                      </div>
                      <SpxResult value={formatCompactNum(plan.damage)} isCurrent={isCurrent} diff={percentDiff(plan.damage, baseDamage)} />
                    </div>
                  )
                })}
              </div>
            </ResultBlock>
          )}
        </div>
      )}

      {viewMode === 'substats' && (
        <div className="suggestions-list">
          <SuggToolbar target={targetSelect}>
            <div className="subx-rolls">
              <span className="subx-rolls__lbl">Steps</span>
              <div className="subx-rolls__stepper" role="group" aria-label="Number of steps to add or remove">
                <button
                  type="button" className="subx-rolls__btn"
                  onClick={() => setSubSteps(substatSteps - 1)}
                  disabled={substatSteps <= 1}
                  aria-label="Fewer steps"
                >
                  <Minus size="0.875rem" aria-hidden="true" />
                </button>
                <input
                  type="number" className="subx-rolls__val"
                  min={1}
                  max={88}
                  value={substatSteps}
                  onChange={(event) => setSubSteps(Number(event.target.value))}
                  aria-label="Steps to add or remove"
                />
                <button
                  type="button" className="subx-rolls__btn"
                  onClick={() => setSubSteps(substatSteps + 1)}
                  disabled={substatSteps >= 88}
                  aria-label="More steps"
                >
                  <Plus size="0.875rem" aria-hidden="true" />
                </button>
              </div>
            </div>
          </SuggToolbar>

          <SubPrioTables rows={substatView} evaluation={substatEvaluation} steps={substatSteps} />
        </div>
      )}

      <SuggsMdl
        {...inspectModal}
        xtrClssName={viewMode === 'weapons' ? undefined : 'suggestions-modal--echoes'}
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
        {viewMode === 'weapons' && selWpnPlan && selWpnCard && (
          <WeaponInspect
            wpnSets={wpnSets}
            target={selWpnPlan}
            card={selWpnCard}
            baseDamage={baseDamage}
            runtime={runtime}
          />
        )}
        {viewMode !== 'weapons' && (
          <div>
            <EchoRows
              echoes={nspcChs}
              variant="card"
              interactive
              selection={nspcSel}
              getRowClskn={(item) => {
                if (!item.echo) {
                  return ''
                }

                const itemId = `suggestions:${viewMode}:${item.echo.uid}:${item.renderIndex}`
                return nspcSel.selectionMode
                  ? `selection-mode${nspcSel.isSelected(itemId) ? ' focus-selected' : ''}`
                  : ''
              }}
              wrapRow={(card, item) => {
                if (!item.echo) {
                  return <div key={item.key}>{card}</div>
                }

                const itemId = `suggestions:${viewMode}:${item.echo.uid}:${item.renderIndex}`
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
            <EchoRowsFoot echoes={nspcChs} />
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
                      <RichDscr description={desc ?? 'Active set bonus.'} className="echo-set-tier-desc" />
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

      <WpnCfgMdl
        {...wpnCnfgMdl}
        title="Config - Weapon Suggestions"
        onClose={wpnCnfgMdl.hide}
        runtime={runtime}
        seed={activeSeed}
      />

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
                      alt={selRandMaiel.name} className="rc-echo-img"
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
                      <TriangleAlert size="0.6875rem" strokeWidth={2.6} />
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
                })} className="rc-number"
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
                      type="button" className="rc-remove-btn"
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
              type="button" className="rc-reset-btn"
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

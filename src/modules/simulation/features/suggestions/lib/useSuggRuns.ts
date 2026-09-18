/*
  Author: Runor Ewhro
  Description: Builds suggestion evaluation contexts, owns family-specific
               worker caches, and coalesces invalidation-driven reruns.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { selActTgtSlc } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { runMainStatS, runSetPlanSu, runWpnSuggs } from '@/engine/suggestions/client.ts'
import { readSuggsSss, writeSuggsSs } from '@/engine/suggestions/sessionCache.ts'
import {
  evalSuggChs,
  mkPrepMainSt,
  mkPrepSetPla,
  mkPrepWpnSu,
  mkSuggVltnCt,
  resSuggDmg,
} from '@/engine/suggestions/shared.ts'
import type {
  MainStatSugg,
  SetPlanSuggest,
  SuggestContext,
  WeaponEntry,
} from '@/engine/suggestions/types.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { runCchdSuggJ } from '@/modules/simulation/features/suggestions/lib/runs.ts'
import {
  targetGroups,
  targetOpts,
  type SuggTgtPtn,
} from '@/modules/simulation/features/suggestions/lib/helpers.ts'
import {
  DEFAULT_SUGG,
  DEFWPNSETS,
  ROT_TGT_VL,
  inputSig,
  mkEchoFullSi,
  setsSig,
  smmrCurSetPl,
  wpnSig,
} from '@/modules/simulation/features/suggestions/lib/suggestions.ts'
import { mkEchoMainSt } from '@/engine/suggestions/mutate.ts'
import type { SelectGroup } from '@/shared/ui/LiquidSelect.tsx'

const RERUN_MS = 300

export type SuggKind = 'mainStats' | 'setPlans' | 'weapons' | 'random' | 'substats'

export interface SuggRunsInput {
  runtime: ResRuntime
  simulation: SimResult | null
  enemyProfile: EnemyProfile
  prtcRntmById: Record<string, ResRuntime>
  setConds: SntSetConds
  mode: SuggKind
}

export interface SuggRuns {
  mainStatRslt: MainStatSugg[]
  setPlanRslt: SetPlanSuggest[]
  wpnRslt: WeaponEntry[]
  rnnnMainStat: boolean
  rnnnSetPlns: boolean
  rnnnWpns: boolean

  suggVltnCtx: SuggestContext | null
  mainSuggVltnCtx: SuggestContext | null
  fixedSuggVltnCtx: SuggestContext | null
  mutableBaseDamage: number
  mainBaseDamage: number
  setPlanBaseDamage: number
  fixedBaseDamage: number
  baseDamage: number

  mutableTargetOptions: SuggTgtPtn[]
  fixedTargetOptions: SuggTgtPtn[]
  targetOptions: SuggTgtPtn[]
  targetSkillGroups: SelectGroup<string>[]
  usesFixedTargets: boolean
  selTgtVl: string
  hasMutableTarget: boolean
  hasFixedTarget: boolean

  wpnSets: WeaponPlanSet
  curMainStatS: ReturnType<typeof mkEchoMainSt>
  curEchoSig: string
  curSetPlan: ReturnType<typeof smmrCurSetPl>
  canRunDrctSu: boolean
  canRunFixedSu: boolean
  baseSuggNptS: string
  activeSeed: ReturnType<typeof getResSeedBy>

  runMainStats: (force?: boolean) => Promise<void>
  runSetPlans: (force?: boolean) => Promise<void>
  runWeapons: (force?: boolean) => Promise<void>
  schedRerun: (force?: boolean) => void
  onSelectResults: (handler: (() => void) | null) => void
}

interface KeyedResults<T> {
  key: string | null
  results: T[]
}

export function useSuggRuns({
  runtime,
  simulation,
  enemyProfile,
  prtcRntmById,
  setConds,
  mode,
}: SuggRunsInput): SuggRuns {
  const [mainStatRun, setMainStatRun] = useState<KeyedResults<MainStatSugg>>({ key: null, results: [] })
  const [setPlanRun, setSetPlanRun] = useState<KeyedResults<SetPlanSuggest>>({ key: null, results: [] })
  const [wpnRun, setWpnRun] = useState<KeyedResults<WeaponEntry>>({ key: null, results: [] })
  const [rnnnMainStat, setRnnnMainS] = useState(false)
  const [rnnnSetPlns, setRnnnSetPl] = useState(false)
  const [rnnnWpns, setRnnnWpns] = useState(false)

  const selTrgtByOwn = useAppStore(selActTgtSlc)
  const scenarioId = useAppStore((state) => selectedCombatScenario(state.combat).id)
  const memberId = useAppStore((state) => selectedCombatScenario(state.combat).team.members[0].id)
  const scenarioIdentity = useMemo(
    () => ({ scenarioId, memberId }),
    [memberId, scenarioId],
  )
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const suggsMap = useAppStore((state) => state.simulation.suggestionsByResonatorId)
  const updActResSug = useAppStore((state) => state.updActSuggs)
  const suggsStt = suggsMap[runtime.id] ?? DEFAULT_SUGG

  const wpnSets = useMemo<WeaponPlanSet>(() => ({
    ...DEFWPNSETS,
    ...(weaponSuggests ?? {}),
    stdRank: weaponSuggests?.stdRank ?? DEFWPNSETS.stdRank,
    ranks: { ...DEFWPNSETS.ranks, ...(weaponSuggests?.ranks ?? {}) },
    visible: { ...DEFWPNSETS.visible, ...(weaponSuggests?.visible ?? {}) },
    states: weaponSuggests?.states ?? DEFWPNSETS.states,
  }), [weaponSuggests])

  const activeSeed = useMemo(() => getResSeedBy(runtime.id), [runtime.id])
  const setCondsSig = useMemo(() => setsSig(setConds), [setConds])
  const tgtSqncRef = useRef({ main: 0, set: 0, weapon: 0 })
  const rerunTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rerunForce = useRef(false)
  const didHydrSetCo = useRef(false)
  const onResultsRef = useRef<(() => void) | null>(null)

  const onSelectResults = useCallback((handler: (() => void) | null) => {
    onResultsRef.current = handler
  }, [])

  const mutableTargetOptions = useMemo<SuggTgtPtn[]>(
    () => targetOpts(runtime.id, simulation),
    [runtime.id, simulation],
  )
  const fixedTargetOptions = useMemo<SuggTgtPtn[]>(
    () => targetOpts(runtime.id, simulation, { includeEchoAttacks: true }),
    [runtime.id, simulation],
  )
  const usesFixedTargets = mode === 'substats' || mode === 'weapons'
  const targetOptions = usesFixedTargets ? fixedTargetOptions : mutableTargetOptions
  const targetSkillGroups = useMemo(() => targetGroups(targetOptions), [targetOptions])

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
    if (targetOptions.length === 0) return

    if (suggsStt.settings.rotationMode) {
      if (targetOptions.some((option) => option.value === ROT_TGT_VL)) return
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

  const ctxBase = useMemo(() => ({
    ...scenarioIdentity,
    runtime,
    seed: activeSeed,
    enemy: enemyProfile,
    runtimesById: prtcRntmById,
    selectedTargets: selTrgtByOwn,
    setConds,
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
  }), [
    activeSeed,
    enemyProfile,
    prtcRntmById,
    runtime,
    scenarioIdentity,
    selTrgtByOwn,
    setConds,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])

  const suggVltnCtx = useMemo(() => {
    if (!simulation || !activeSeed || !hasMutableTarget) return null
    return mkSuggVltnCt({ ...ctxBase, seed: activeSeed }, simulation)
  }, [activeSeed, ctxBase, hasMutableTarget, simulation])

  const mainSuggVltnCtx = useMemo(() => {
    if (!simulation || !activeSeed || !hasMutableTarget) return null
    return mkSuggVltnCt({ ...ctxBase, seed: activeSeed, setStateMode: 'resolved' }, simulation)
  }, [activeSeed, ctxBase, hasMutableTarget, simulation])

  const fixedSuggVltnCtx = useMemo(() => {
    if (!simulation || !activeSeed || !hasFixedTarget) return null
    return mkSuggVltnCt({
      ...ctxBase,
      seed: activeSeed,
      setStateMode: 'resolved',
      includeEchoAttacks: true,
    }, simulation)
  }, [activeSeed, ctxBase, hasFixedTarget, simulation])

  const echoes: Array<EchoInstance | null> = runtime.build.echoes

  const mutableBaseDamage = useMemo(
    () => (suggVltnCtx ? evalSuggChs(suggVltnCtx, echoes) : 0),
    [echoes, suggVltnCtx],
  )
  const mainBaseDamage = useMemo(() => {
    if (!simulation || !activeSeed || !hasMutableTarget) return 0
    return resSuggDmg(simulation, { ...ctxBase, seed: activeSeed, includeEchoAttacks: true })
  }, [activeSeed, ctxBase, hasMutableTarget, simulation])
  const setPlanBaseDamage = mainBaseDamage

  const fixedBaseDamage = useMemo(
    () => (fixedSuggVltnCtx ? evalSuggChs(fixedSuggVltnCtx, echoes) : 0),
    [echoes, fixedSuggVltnCtx],
  )
  const weaponBaseDamage = useMemo(() => {
    if (!simulation || !activeSeed || !hasFixedTarget) return 0

    return resSuggDmg(simulation, {
      ...ctxBase,
      seed: activeSeed,
      setStateMode: 'resolved',
      includeEchoAttacks: true,
    })
  }, [activeSeed, ctxBase, hasFixedTarget, simulation])

  const baseDamage = mode === 'mainStats'
    ? mainBaseDamage
    : mode === 'setPlans'
      ? setPlanBaseDamage
      : mode === 'weapons'
        ? weaponBaseDamage
        : usesFixedTargets ? fixedBaseDamage : mutableBaseDamage

  const curMainStatS = useMemo(() => mkEchoMainSt(echoes), [echoes])
  const curEchoSig = useMemo(() => mkEchoFullSi(echoes), [echoes])
  const curSetPlan = useMemo(() => smmrCurSetPl(echoes), [echoes])

  const canRunDrctSu = Boolean(activeSeed) && hasMutableTarget
  const canRunFixedSu = Boolean(activeSeed) && hasFixedTarget

  const baseSuggNptS = useMemo(() => inputSig({
    runtime,
    enemyProfile,
    prtcRntmById,
    selectedTargets: selTrgtByOwn,
    setConds,
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
  }), [
    enemyProfile,
    prtcRntmById,
    runtime,
    selTrgtByOwn,
    setConds,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])
  const mainSuggNptS = useMemo(() => inputSig({
    runtime,
    enemyProfile,
    prtcRntmById,
    selectedTargets: selTrgtByOwn,
    setConds,
    setStateMode: 'resolved',
    includeEchoAttacks: true,
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
  }), [
    enemyProfile,
    prtcRntmById,
    runtime,
    selTrgtByOwn,
    setConds,
    suggsStt.settings.rotationMode,
    suggsStt.settings.targetFeatureId,
  ])
  const fixedSuggNptS = useMemo(() => inputSig({
    runtime,
    enemyProfile,
    prtcRntmById,
    selectedTargets: selTrgtByOwn,
    setConds,
    setStateMode: 'resolved',
    tgtFeatId: suggsStt.settings.targetFeatureId,
    rotationMode: suggsStt.settings.rotationMode,
    includeEchoAttacks: true,
  }), [
    enemyProfile,
    prtcRntmById,
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
  const wpnCchKey = useMemo(
    () => `weapon:${runtime.id}:${fixedSuggNptS}:${wpnSig(wpnSets)}`,
    [fixedSuggNptS, runtime.id, wpnSets],
  )

  /* A baseline follows the live input immediately, while worker results arrive
     later. Only expose rows produced for the same signature so an old result
     can never be measured against a new base during that gap. */
  const mainStatRslt = mainStatRun.key === mainSttsCchK ? mainStatRun.results : []
  const setPlanRslt = setPlanRun.key === setPlnsCchKe ? setPlanRun.results : []
  const wpnRslt = wpnRun.key === wpnCchKey ? wpnRun.results : []

  const runMainStats = useCallback(async (force = false) => {
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
      resetResults: () => setMainStatRun({ key: mainSttsCchK, results: [] }),
      applyResults: (results) => {
        setMainStatRun({ key: mainSttsCchK, results })
        onResultsRef.current?.()
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepMainSt({ ...ctxBase, seed: activeSeed, setStateMode: 'resolved' }, simulation)
          : null
      ),
      run: runMainStatS,
    })
  }, [activeSeed, canRunDrctSu, ctxBase, mainSttsCchK, simulation])

  const runSetPlans = useCallback(async (force = false) => {
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
      resetResults: () => setSetPlanRun({ key: setPlnsCchKe, results: [] }),
      applyResults: (results) => {
        setSetPlanRun({ key: setPlnsCchKe, results })
        onResultsRef.current?.()
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepSetPla({ ...ctxBase, seed: activeSeed }, simulation)
          : null
      ),
      run: runSetPlanSu,
    })
  }, [activeSeed, canRunDrctSu, ctxBase, setPlnsCchKe, simulation])

  const runWeapons = useCallback(async (force = false) => {
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
      resetResults: () => setWpnRun({ key: wpnCchKey, results: [] }),
      applyResults: (results) => {
        setWpnRun({ key: wpnCchKey, results })
        onResultsRef.current?.()
      },
      prepare: () => (
        simulation && activeSeed
          ? mkPrepWpnSu({
              ...ctxBase,
              seed: activeSeed,
              includeEchoAttacks: true,
              weapon: wpnSets,
              topK: 30,
            }, simulation)
          : null
      ),
      run: runWpnSuggs,
    })
  }, [activeSeed, canRunFixedSu, ctxBase, simulation, wpnCchKey, wpnSets])

  const latestRuns = useRef({ runMainStats, runSetPlans, runWeapons })
  useEffect(() => {
    latestRuns.current = { runMainStats, runSetPlans, runWeapons }
  }, [runMainStats, runSetPlans, runWeapons])

  const schedRerun = useCallback((force = false) => {
    rerunForce.current = rerunForce.current || force
    if (rerunTimer.current) clearTimeout(rerunTimer.current)

    rerunTimer.current = setTimeout(() => {
      rerunTimer.current = null
      const runForce = rerunForce.current
      rerunForce.current = false

      void latestRuns.current.runMainStats(runForce)
      void latestRuns.current.runSetPlans(runForce)
      void latestRuns.current.runWeapons(runForce)
    }, RERUN_MS)
  }, [])

  useEffect(() => () => {
    if (rerunTimer.current) {
      clearTimeout(rerunTimer.current)
      rerunTimer.current = null
    }
  }, [])

  useEffect(() => {
    schedRerun()
  }, [mainSttsCchK, setPlnsCchKe, wpnCchKey, schedRerun])

  useEffect(() => {
    // conditionals hydrate from persisted state on mount, so the first pass is
    // not a change and must not force past the cache
    if (!didHydrSetCo.current) {
      didHydrSetCo.current = true
      return
    }

    schedRerun(true)
  }, [setCondsSig, schedRerun])

  return {
    mainStatRslt,
    setPlanRslt,
    wpnRslt,
    rnnnMainStat,
    rnnnSetPlns,
    rnnnWpns,

    suggVltnCtx,
    mainSuggVltnCtx,
    fixedSuggVltnCtx,
    mutableBaseDamage,
    mainBaseDamage,
    setPlanBaseDamage,
    fixedBaseDamage,
    baseDamage,

    mutableTargetOptions,
    fixedTargetOptions,
    targetOptions,
    targetSkillGroups,
    usesFixedTargets,
    selTgtVl,
    hasMutableTarget,
    hasFixedTarget,

    wpnSets,
    curMainStatS,
    curEchoSig,
    curSetPlan,
    canRunDrctSu,
    canRunFixedSu,
    baseSuggNptS,
    activeSeed,

    runMainStats,
    runSetPlans,
    runWeapons,
    schedRerun,
    onSelectResults,
  }
}

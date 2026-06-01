/*
  Author: Runor Ewhro
  Description: Renders the optimizer surface for the calculator optimizer flow.
*/

import {type ReactNode, useCallback, useRef} from 'react'
import {useEffect, useLayoutEffect as useLytFfct, useMemo, useState} from 'react'
import { useNavigate } from 'react-router-dom'
import type {RotationNode} from '@/domain/gameData/contracts'
import {DEF_SET_COND} from '@/domain/entities/sonataSetConditionals'
import type { EchoInstance, ResRuntime, TeamMemRt } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { makeTeamMember } from '@/domain/state/defaults'
import { matTeamMemFr } from '@/domain/state/runtimeMaterialization'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { useAppModal, useAppMdlVl } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import type {SelectOption, SelectGroup} from '@/shared/ui/LiquidSelect'
import {getEchoCatBy} from '@/data/gameData/catalog/echoes'
import {getGameData} from '@/data/gameData'
import {ECHO_SET_DEFS} from '@/data/gameData/echoSets/effects'
import {getEchoSttsSrc} from '@/data/gameData/catalog/echoStats'
import {getResCatByI, getResDtlsBy} from '@/data/gameData/resonators/resonatorDataStore'
import {getWpnsById} from '@/data/gameData/weapons/weaponDataStore'
import {getEchoById, listEchoes} from '@/domain/services/echoCatalogService'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService'
import {makeRuntimeMap} from '@/domain/state/runtimeAdapters'
import {useAppStore} from '@/domain/state/store'
import {
  selActResId,
  selActTgtSlc,
  selEnemyProf,
  selOptCtx,
} from '@/domain/state/selectors'
import {compOptPay} from '@/engine/optimizer/compiler'
import {deriveOptSets} from '@/engine/optimizer/config/defaultSettings.ts'
import {applyKeepPrc, makeStatWeights} from '@/engine/optimizer/search/filtering.ts'
import {
  evalPrepOptB,
} from '@/engine/optimizer/results/materialize.ts'
import {compOptTgtCt} from '@/engine/optimizer/target/context'
import {listOptTrgt} from '@/engine/optimizer/target/skills'
import {countOptCombos, countTheory} from '@/engine/optimizer/search/counting'
import { optSetIdSet } from '@/engine/optimizer/config/allowedSets.ts'
import type {OptBagResult, OptPrgr, TheoryResult, TheoryResultRow} from '@/engine/optimizer/types'
import {seedRsntById} from '@/modules/calculator/features/resonator/lib/seedData.ts'
import {Expandable} from '@/shared/ui/Expandable'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { EchoPicker as EchoPckrMdl } from '@/modules/calculator/features/echoes/Picker.tsx'
import { WeaponPicker as WpnPckrMdl } from '@/modules/calculator/features/weapons/Picker.tsx'
import {
  SetCond
} from '@/modules/calculator/features/controls/SetConditional.tsx'
import {ResPckr as ResPckrMdl} from '@/modules/calculator/features/resonator/Picker.tsx'
import {CharPtnsPnl} from '@/modules/calculator/features/optimizer/ResonatorOptionsPanel.tsx'
import { TeamPanel } from '@/modules/calculator/features/optimizer/TeamPanel.tsx'
import {
  mkMateCntr,
  teamRuntime,
} from '@/modules/calculator/features/optimizer/lib/teamRuntime.ts'
import {ControlBox} from '@/modules/calculator/features/optimizer/ControlBox.tsx'
import {
  type OptDisplayRow,
  Row
} from '@/modules/calculator/features/optimizer/Row.tsx'
import {Rules} from '@/modules/calculator/features/optimizer/Rules.tsx'
import {HEADER_TITLES} from '@/modules/calculator/features/optimizer/lib/mockData.ts'
import { OPT_SKILL_TABS, getSkillTabLabel } from '@/modules/calculator/model/skillTabs'
import {modalContent} from '@/modules/calculator/features/optimizer/Modals.tsx'
import { OptPrvwEchoT } from '@/modules/calculator/features/optimizer/lib/parts.tsx'
import { ResultToolbar } from '@/modules/calculator/features/optimizer/ResultToolbar.tsx'
import {
  plchRslt,
  vsblRsltsAt as getRowsAt,
  type LegOptRsltEn,
  prvwChs as getPreview,
  rsltLdt,
  buildFacetSlice,
  buildResultView,
  facetMatches,
  isDefaultViewCriteria,
  DEFAULT_VIEW_CRITERIA,
  type ResultViewCriteria,
  type ResultFacet,
  type Predicate,
} from '@/modules/calculator/features/optimizer/lib/results.ts'
import { RES_MENU } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { getWeapon, weaponStatsAt } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import {
  type EchoPlan,
  addSetPref as addEchoSetPr,
  derEchoPlan,
  rmSetPref as rmEchoSetPre,
  resEchoPlan,
  selMainEcho,
  setSetCount as setEchoSetCn,
} from '@/modules/calculator/features/optimizer/lib/teammateEchoPlan.ts'
import {
  applyWpnSttD,
  clrWpnSttCnt,
  mkMptyPrgr,
  mkMptyEchoPl,
  mapMainStatF,
  makeOpSlot,
  normEchoLdt,
  rotHasFeats,
  type OpEchoTarget,
  type OpSlot,
  type PrvwTgt,
  smmrEchoLdt,
} from '@/modules/calculator/features/optimizer/lib/helpers.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/calculator/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/calculator/features/echoes/lib/equip.ts'
import { Copy } from 'lucide-react'
import { useCtxBuilder } from '@/shared/context-menu/useCtxBuilder.ts'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import { getOptCtx } from '@/modules/calculator/features/optimizer/lib/ctx.tsx'

export function Optimizer() {
  const showToast = useTstStr((state) => state.show)
  const navigate = useNavigate()
  const menu = useCtxBuilder()
  const actResId = useAppStore(selActResId)
  const activeTarget = useAppStore(selActTgtSlc)
  const enemyProfile = useAppStore(selEnemyProf)
  const optimizer = useAppStore(selOptCtx)
  const optStts = useAppStore((state) => state.optimizer.status)
  const optResults = useAppStore((state) => (
    Array.isArray(state.optimizer.results)
      ? state.optimizer.results
      : []
  ) as Array<OptBagResult | LegOptRsltEn | TheoryResult | TheoryResultRow>)
  const optRrr = useAppStore((state) => state.optimizer.error)
  const optBtchSize = useAppStore((state) => state.optimizer.batchSize)
  const optResultData = useAppStore((state) => state.optimizer.resPay)
  const optResultEchoes = useAppStore((state) => (
    Array.isArray(state.optimizer.resultEchoes)
      ? state.optimizer.resultEchoes
      : []
  ))
  const invEchoEnts = useAppStore((state) => state.calculator.inventoryEchoes)
  const invRttn = useAppStore((state) => state.calculator.inventoryRotations)
  const optCpuHintSe = useAppStore((state) => state.ui.optimizerCpuHintSeen)
  const ensureOptimizer = useAppStore((state) => state.ensureOptimizer)
  const syncOptCtxTo = useAppStore((state) => state.syncOptRt)
  const setOptCpuHin = useAppStore((state) => state.setOptHint)
  const updOptRt = useAppStore((state) => state.updOptRt)
  const updResRt = useAppStore((state) => state.updResRt)
  const updOptSets = useAppStore((state) => state.updOptSets)
  const updResSetCon = useAppStore((state) => state.updResConds)
  const swtcToRes = useAppStore((state) => state.swRes)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const startOpt = useAppStore((state) => state.startOpt)
  const cnclOpt = useAppStore((state) => state.cnclOpt)
  const clrOptRslts = useAppStore((state) => state.clrOptRslt)
  const optResId = optimizer?.resonatorId ?? actResId

  useEffect(() => {
    ensureOptimizer()
  }, [actResId, ensureOptimizer])

  const optRt = optimizer?.runtime ?? null
  const optSets = optimizer?.settings ?? null
  const optSetConds = useAppStore((state) => {
    const resonatorId = optimizer?.resonatorId ?? actResId
    if (!resonatorId) {
      return DEF_SET_COND
    }

    return state.calculator.profiles[resonatorId]?.runtime.local.setConditionals ?? DEF_SET_COND
  })
  const activeSeed = optResId ? seedRsntById[optResId] ?? null : null
  const displayName = activeSeed?.name ?? 'Unknown'
  const rotationMode = optSets?.rotationMode ?? false
  const targetMode: 'skill' | 'combo' = rotationMode ? 'combo' : 'skill'
  const optMode = optSets?.searchMode ?? 'inventory'
  const isThryMode = optMode === 'theory'

  // sprite/profile portrait choice is a persisted global display preference,
  // not resonator-scoped, so it survives both resonator switches and reloads.
  const isSprite = useAppStore((state) => state.ui.optimizerUseSprite)
  const setIsSprite = useAppStore((state) => state.setOptSprite)
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : true,
  )
  const [pageIndex, setPageIndex] = useState(0)
  const [selNdx, setActiveIndex] = useState(0)
  // SQL-style result view: filter (WHERE) + sort (ORDER BY) over the result
  // array. default criteria render the array as-is (identity, zero overhead).
  const [viewCriteria, setViewCriteria] = useState<ResultViewCriteria>(DEFAULT_VIEW_CRITERIA)
  // whether the filter/sort controls are expanded; opening them arms the facet
  // pass so the dropdowns can list the echoes/sets/plans present.
  const [optToolsOpen, setOptToolsOpen] = useState(false)
  const [facetTable, setFacetTable] = useState<ResultFacet[] | null>(null)
  // which console mode the body shows: filter (WHERE, subsets) or find (jump).
  const [consoleMode, setConsoleMode] = useState<'filter' | 'find'>('filter')
  // find (jump-to): predicates to step through within the current view. unlike
  // a filter it never hides rows; it just moves the page/selection to the next
  // matching build. findPos is the display position last jumped to.
  const [findPreds, setFindPreds] = useState<Predicate[]>([])
  const [findPos, setFindPos] = useState(-1)
  // index into pageItems whose ellipsis is currently expanded into a jumper
  // input. only one ellipsis can be in edit mode at a time; null = inactive.
  const [jumpEditNdx, setJumpEditNdx] = useState<number | null>(null)
  const [jumpDraft, setJumpDraft] = useState('')
  const jumpInputRef = useRef<HTMLInputElement | null>(null)
  const [prvwTrgt, setPrvwTrgt] = useState<PrvwTgt>({ kind: 'base' })
  const [echoPlanStr, setEchoPlanS] = useState<{
    resonatorId: string | null
    plans: [EchoPlan | null, EchoPlan | null]
  }>(() => ({
    resonatorId: null,
    plans: mkMptyEchoPl(),
  }))
  const [progress, setProgress] = useState<OptPrgr>(() => mkMptyPrgr())
  const uiModal = useAppMdlVl<ReactNode>()
  const rulesModal = useAppModal()
  const setCondsMdl = useAppModal()
  const quickPickModal = useAppMdlVl<number>()
  const mainEchoPckr = useAppMdlVl<OpEchoTarget>()
  const resPckr = useAppMdlVl<OpSlot>()
  const weaponPicker = useAppMdlVl<OpSlot>()

  const mdlPrtlTgt = mainPortal()

  useLytFfct(() => {
    function handleResize() {
      setIsWide(window.innerWidth >= 1200)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const echoPlans = useMemo(
    () => (
      echoPlanStr.resonatorId === optResId
        ? echoPlanStr.plans
        : mkMptyEchoPl()
    ),
    [optResId, echoPlanStr],
  )

  const setEchoPlans = useCallback((
    action:
      | [EchoPlan | null, EchoPlan | null]
      | ((
        prev: [EchoPlan | null, EchoPlan | null]
      ) => [EchoPlan | null, EchoPlan | null]),
  ) => {
    setEchoPlanS((prevStore) => {
      const prvsPlns = prevStore.resonatorId === optResId
        ? prevStore.plans
        : mkMptyEchoPl()
      const nextPlans = typeof action === 'function'
        ? action(prvsPlns)
        : action

      return {
        resonatorId: optResId,
        plans: nextPlans,
      }
    })
  }, [optResId])

  const mateEchoPlan = useMemo(() => {
    if (!optRt) {
      return {
        runtime: null,
        plans: [null, null] as [EchoPlan | null, EchoPlan | null],
        invalidMainEchoes: [null, null] as [string | null, string | null],
      }
    }

    const rslvPlns = [...echoPlans] as [EchoPlan | null, EchoPlan | null]
    const nvldMainChs: [string | null, string | null] = [null, null]
    const nextTeamRuns = [...optRt.teamRuntimes] as [TeamMemRt | null, TeamMemRt | null]
    let changed = false

    // teammate echo plans are authored as lightweight preferences, so rebuild
    // the concrete teammate loadouts here before downstream optimizer prep.
    for (const slotIndex of [0, 1] as const) {
      const memRt = makeOpSlot(optRt, slotIndex)
      if (!memRt) {
        continue
      }

      const resolvedPlan = resEchoPlan(
        memRt.build.echoes,
        echoPlans[slotIndex],
      )
      rslvPlns[slotIndex] = resolvedPlan.plan
      nvldMainChs[slotIndex] = resolvedPlan.invalidMainId

      if (resolvedPlan.effectEchoes.every((echo, echoIndex) => echo === memRt.build.echoes[echoIndex])) {
        continue
      }

      nextTeamRuns[slotIndex] = teamRuntime({
        ...memRt,
        build: {
          ...memRt.build,
          echoes: resolvedPlan.effectEchoes,
        },
      })
      changed = true
    }

    return {
      runtime: changed
        ? {
            ...optRt,
            teamRuntimes: nextTeamRuns,
          }
        : optRt,
      plans: rslvPlns,
      invalidMainEchoes: nvldMainChs,
    }
  }, [optRt, echoPlans])

  const effectRuntime = mateEchoPlan.runtime
  const rslvEchoPlns = mateEchoPlan.plans
  const nvldMateMain = mateEchoPlan.invalidMainEchoes

  const reset = () => {
    clrOptRslts()
    setPageIndex(0)
    setActiveIndex(0)
    setPrvwTrgt({ kind: 'base' })
    setProgress(mkMptyPrgr())
  }

  const openUiModal = (content: ReactNode) => {
    uiModal.show(content)
  }

  const closeUiModal = () => {
    uiModal.hide()
  }

  const openRlsMdl = () => {
    rulesModal.show()
  }

  const clsRlsMdl = () => {
    rulesModal.hide()
  }

  const imageSrc =
    activeSeed
      ? isSprite
        ? `/assets/resonators/sprite/${optResId}.webp`
        : `/assets/resonators/profiles/${optResId}.webp`
      : '/assets/default.webp'

  const trgtSkll = useMemo(
    () => (effectRuntime ? listOptTrgt(effectRuntime) : []),
    [effectRuntime],
  )

  const skillOptions = useMemo<SelectOption<string>[]>(() => {
    return trgtSkll.map((skill) => ({
      value: skill.id,
      label: skill.label,
    }))
  }, [trgtSkll])

  const skillGroups = useMemo<SelectGroup<string>[]>(() => {
    const grouped = new Map<string, SelectOption<string>[]>()

    for (const skill of trgtSkll) {
      const existing = grouped.get(skill.tab) ?? []
      existing.push({
        value: skill.id,
        label: skill.label,
      })
      grouped.set(skill.tab, existing)
    }

    // keep group ordering aligned with the shared skill-tab order instead of
    // relying on whatever order the targetable skill catalog happened to emit.
    return OPT_SKILL_TABS
      .map((tab) => ({
        label: getSkillTabLabel(tab),
        options: grouped.get(tab) ?? [],
      }))
      .filter((group) => group.options.length > 0)
  }, [trgtSkll])

  const comboOptions: SelectOption[] = (() => {
    if (!effectRuntime || !optResId) {
      return []
    }

    const options: SelectOption[] = [{
      value: `live:${optResId}`,
      label: `${displayName} · Current Personal Rotation · Live`,
    }]

    for (const entry of invRttn) {
      if (entry.mode !== 'personal' || entry.resonatorId !== optResId) {
        continue
      }

      options.push({
        value: `saved:${entry.id}`,
        label: `${entry.resonatorName} · ${entry.name} · Personal`,
      })
    }

    return options
  })()

  // combo (rotation) optimizer mode only makes sense when there is a rotation
  // with at least one damage feature node, either the live personal rotation
  // or a saved personal rotation for this resonator. with none, combo mode is
  // hidden and forced back to skill mode below.
  const comboAvailable = useMemo(() => {
    if (!effectRuntime || !optResId) {
      return false
    }
    if (rotHasFeats(effectRuntime.rotation.personalItems)) {
      return true
    }
    return invRttn.some((entry) => (
      entry.mode === 'personal' &&
      entry.resonatorId === optResId &&
      rotHasFeats(entry.items)
    ))
  }, [effectRuntime, optResId, invRttn])

  useEffect(() => {
    if (rotationMode && !comboAvailable) {
      updOptSets((settings) => ({
        ...settings,
        targetMode: 'skill',
        rotationMode: false,
      }))
    }
  }, [rotationMode, comboAvailable, updOptSets])

  const selRotTms: RotationNode[] | null = (() => {
    if (!effectRuntime || !optResId) {
      return null
    }

    const selSrcId = optSets?.targetComboSourceId
    if (!selSrcId) {
      return effectRuntime.rotation.personalItems
    }

    if (selSrcId === `live:${optResId}`) {
      return effectRuntime.rotation.personalItems
    }

    if (selSrcId.startsWith('saved:')) {
      const rotationId = selSrcId.slice('saved:'.length)
      const saved = invRttn.find((entry) => (
        entry.id === rotationId &&
        entry.mode === 'personal' &&
        entry.resonatorId === optResId
      ))
      return saved?.items ?? null
    }

    return effectRuntime.rotation.personalItems
  })()

  useEffect(() => {
    if (!optSets) {
      return
    }

    const hasSelSkll = optSets.targetSkillId
      ? trgtSkll.some((skill) => skill.id === optSets.targetSkillId)
      : false

    if (hasSelSkll) {
      return
    }

    const nextTgtSkllI = trgtSkll[0]?.id ?? null
    if (optSets.targetSkillId === nextTgtSkllI) {
      return
    }

    updOptSets((settings) => ({
      ...settings,
      targetSkillId: nextTgtSkllI,
    }))
  }, [optSets, trgtSkll, updOptSets])

  useEffect(() => {
    if (!optSets || comboOptions.length === 0) {
      return
    }

    const hasSelCmb = optSets.targetComboSourceId
      ? comboOptions.some((option) => option.value === optSets.targetComboSourceId)
      : false

    if (hasSelCmb) {
      return
    }

    const nextTgtCmbId = comboOptions[0]?.value ?? null
    if (optSets.targetComboSourceId === nextTgtCmbId) {
      return
    }

    updOptSets((settings) => ({
      ...settings,
      targetComboSourceId: nextTgtCmbId,
    }))
  }, [comboOptions, optSets, updOptSets])

  const fltrRuleEcho = useMemo(() => {
    if (!optSets) {
      return invEchoEnts
    }

    const llwdSetIds = optSetIdSet(optSets.allowedSets)
    const llwdMainStat = new Set(
      optSets.mainStatFilter
        .map((key) => mapMainStatF(key, optSets.selectedBonus))
        .filter((value): value is string => Boolean(value)),
    )

    return invEchoEnts.filter(({ echo }) => {
      if (llwdSetIds.size > 0 && !llwdSetIds.has(echo.set)) {
        return false
      }
      return !(llwdMainStat.size > 0 && !llwdMainStat.has(echo.mainStats.primary.key));
    })
  }, [invEchoEnts, optSets])

  const allEchoes = useMemo(() => listEchoes(), [])

  const thryMFltr = useMemo(() => {
    if (!effectRuntime) {
      return {
        mainStatFilter: [],
        selectedBonus: null,
      }
    }

    const ntlSets = deriveOptSets({
      runtime: effectRuntime,
      enemy: enemyProfile,
      selectedTargets: activeTarget,
    })

    return {
      mainStatFilter: [...(ntlSets.mainStatFilter ?? [])],
      selectedBonus: ntlSets.selectedBonus ?? null,
    }
  }, [activeTarget, enemyProfile, effectRuntime])

  const runOptSets = useMemo(() => {
    if (!optSets) {
      return null
    }

    if (!isThryMode) {
      return optSets
    }

    return {
      ...optSets,
      mainStatFilter: thryMFltr.mainStatFilter,
      selectedBonus: thryMFltr.selectedBonus,
    }
  }, [isThryMode, optSets, thryMFltr])

  const prepTgtSkll = useMemo(() => {
    const resonatorId = optResId
    const tgtSkllId = optSets?.targetSkillId
    if (
      !resonatorId ||
      !effectRuntime ||
      !tgtSkllId ||
      rotationMode
    ) {
      return null
    }

    return compOptTgtCt({
      runtime: effectRuntime,
      resonatorId,
      skillId: tgtSkllId,
      enemy: enemyProfile,
      runtimesById: makeRuntimeMap(effectRuntime),
      selectedTargets: activeTarget,
    })
  }, [activeTarget, effectRuntime, enemyProfile, optResId, optSets, rotationMode])

  const optWghtMap = useMemo(() => {
    if (
      !effectRuntime ||
      !optSets ||
      rotationMode ||
      !prepTgtSkll
    ) {
      return null
    }

    // stat weights are derived from the live runtime so filters and result
    // scoring stay consistent with the current build and target context.
    return makeStatWeights({
      finalStats: prepTgtSkll.combat.finalStats,
      skill: prepTgtSkll.skill,
      enemy: enemyProfile,
      level: effectRuntime.base.level,
      combat: effectRuntime.state.combat,
    })
  }, [effectRuntime, enemyProfile, optSets, prepTgtSkll, rotationMode])

  const fltrInvEchoE = useMemo(() => {
    if (!optSets) {
      return fltrRuleEcho
    }

    const fltrChs = applyKeepPrc(
      fltrRuleEcho.map((entry) => entry.echo),
      {
        keepPercent: optSets.keepPercent,
        rotationMode: optSets.rotationMode,
        lockedMainId: optSets.lockedMainEchoId,
        weights: optWghtMap,
      },
    )

    const entriesByUid = new Map(
      fltrRuleEcho.map((entry) => [entry.echo.uid, entry] as const),
    )

    return fltrChs
      .map((echo) => entriesByUid.get(echo.uid) ?? null)
      .filter((entry): entry is (typeof fltrRuleEcho)[number] => Boolean(entry))
  }, [fltrRuleEcho, optSets, optWghtMap])

  const fltrComboChs = useMemo(
    () => fltrInvEchoE.map((entry) => entry.echo),
    [fltrInvEchoE],
  )

  const qppdChs = normEchoLdt(effectRuntime?.build.echoes ?? []).filter(
    (echo): echo is EchoInstance => echo != null,
  )

  const shldCntCombo = fltrComboChs.length >= 5
  const pndnCombos = false
  const rslvComboCnt = useMemo(() => {
    if (isThryMode) {
      if (
        !optResId ||
        !runOptSets ||
        !effectRuntime ||
        (!rotationMode && !runOptSets.targetSkillId) ||
        qppdChs.length === 0
      ) {
        return 0
      }

      return countTheory(runOptSets, effectRuntime)
    }

    if (!shldCntCombo) {
      return 0
    }

    return countOptCombos(
      fltrComboChs,
      optSets?.lockedMainEchoId ?? null,
      optSets?.enableGpu ? 'combinadic' : 'rows',
    )
  }, [
    fltrComboChs,
    effectRuntime,
    isThryMode,
    optResId,
    runOptSets,
    qppdChs.length,
    rotationMode,
    shldCntCombo,
  ])

  const bslnPrepPay = useMemo(() => {
    if (
      !optResId ||
      !effectRuntime ||
      !runOptSets ||
      (!rotationMode && !runOptSets.targetSkillId) ||
      qppdChs.length === 0
    ) {
      return null
    }

    // compile once up front so the baseline card and combo counts can reuse
    // the exact same prepared payload shape as the real optimizer run.
    return compOptPay({
      resonatorId: optResId,
      resSeed: seedRsntById[optResId],
      staticData: {
        gameDataReg: getGameData(),
        resCatById: getResCatByI(),
        resDtlsById: getResDtlsBy(),
        weaponsById: getWpnsById(),
        echoCatById: getEchoCatBy(),
        echoSetDefs: ECHO_SET_DEFS,
        echoStats: getEchoSttsSrc() ?? undefined,
      },
      runtime: effectRuntime,
      settings: {
        ...runOptSets,
        searchMode: 'inventory',
      },
      invChs: qppdChs,
      enemyProfile,
      selectedTargets: activeTarget,
      setConds: optSetConds,
      rotTms: rotationMode ? selRotTms : undefined,
    })
  }, [
    activeTarget,
    enemyProfile,
    qppdChs,
    optResId,
    effectRuntime,
    optSetConds,
    runOptSets,
    rotationMode,
    selRotTms,
  ])

  const bslnVltn = useMemo(() => {
    if (!bslnPrepPay || qppdChs.length === 0) {
      return null
    }

    const mainIndex = qppdChs.findIndex((echo) => echo.mainEcho)
    return evalPrepOptB(
      bslnPrepPay,
      mainIndex >= 0 ? mainIndex : 0,
    )
  }, [bslnPrepPay, qppdChs])

  const baseResult: OptDisplayRow = (() => {
    if (!effectRuntime) {
      return plchRslt()
    }

    const summary = smmrEchoLdt(effectRuntime.build.echoes)

    return {
      damage: bslnVltn?.damage ?? 0,
      costs: summary.costs,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      stats: bslnVltn?.stats ?? null,
    }
  })()

  const invChsByUid = useMemo(
    () => new Map(invEchoEnts.map((entry) => [entry.echo.uid, entry.echo] as const)),
    [invEchoEnts],
  )

  const rsltsPerPage = 32

  useEffect(() => {
    if (optResults.length === 0) {
      setFacetTable(null)
      return
    }

    setFacetTable(null)

    let cncl = false
    const total = optResults.length
    const next = new Array<ResultFacet>(total)
    const chunkSize = 768
    let start = 0
    let tid: ReturnType<typeof setTimeout> | null = null

    const step = () => {
      if (cncl) {
        return
      }

      const end = Math.min(start + chunkSize, total)
      const slice = buildFacetSlice({
        optResults,
        start,
        end,
        invChsByUid,
        optResultEchoes,
        optResultData,
      })

      for (let index = 0; index < slice.length; index += 1) {
        next[start + index] = slice[index]
      }

      start = end
      if (start < total) {
        tid = setTimeout(step, 0)
        return
      }

      setFacetTable(next)
    }

    tid = setTimeout(step, 0)

    return () => {
      cncl = true
      if (tid) {
        clearTimeout(tid)
      }
    }
  }, [optResults, invChsByUid, optResultEchoes, optResultData])

  const viewIndices = useMemo<number[] | null>(() => {
    if (!facetTable || isDefaultViewCriteria(viewCriteria)) {
      return null
    }
    return buildResultView(facetTable, viewCriteria)
  }, [facetTable, viewCriteria])

  // reverse lookup (original index -> display position) so the selected/preview
  // row can be located within the current view.
  const dispPosByOrig = useMemo<Map<number, number> | null>(() => {
    if (!viewIndices) {
      return null
    }
    const map = new Map<number, number>()
    for (let i = 0; i < viewIndices.length; i += 1) {
      map.set(viewIndices[i], i)
    }
    return map
  }, [viewIndices])

  const origAt = (displayPos: number): number =>
    viewIndices ? (viewIndices[displayPos] ?? -1) : displayPos
  const dispPosOf = (origIndex: number): number =>
    dispPosByOrig ? (dispPosByOrig.get(origIndex) ?? -1) : origIndex

  const resultLength = viewIndices ? viewIndices.length : optResults.length
  const totalPages = Math.max(1, Math.ceil(resultLength / rsltsPerPage))
  const pageStart = pageIndex * rsltsPerPage
  const pageEnd = pageStart + rsltsPerPage

  // original result indices for the rows on the current page.
  const pageOrigIndices = useMemo<number[]>(() => {
    const out: number[] = []
    const end = Math.min(pageEnd, resultLength)
    for (let pos = pageStart; pos < end; pos += 1) {
      const orig = viewIndices ? viewIndices[pos] : pos
      if (orig != null && orig >= 0) {
        out.push(orig)
      }
    }
    return out
  }, [viewIndices, pageStart, pageEnd, resultLength])

  const rows = useMemo<OptDisplayRow[]>(() => {
    return getRowsAt({
      optResults: optResults,
      indices: pageOrigIndices,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
    })
  }, [invChsByUid, optResults, optResultData, optResultEchoes, pageOrigIndices])

  // display positions in the current view satisfying the find predicates: the
  // rows the jump steps through (without hiding anything).
  const findMatches = useMemo<number[]>(() => {
    if (findPreds.length === 0 || !facetTable) {
      return []
    }
    const len = viewIndices ? viewIndices.length : optResults.length
    const out: number[] = []
    for (let pos = 0; pos < len; pos += 1) {
      const orig = viewIndices ? viewIndices[pos] : pos
      const facet = orig != null ? facetTable[orig] : undefined
      if (facet && facetMatches(facet, findPreds)) {
        out.push(pos)
      }
    }
    return out
  }, [findPreds, facetTable, viewIndices, optResults.length])

  // 1-based position of the current match within the run, 0 when none active.
  const findMatchIndex = useMemo(() => {
    const at = findMatches.indexOf(findPos)
    return at >= 0 ? at + 1 : 0
  }, [findMatches, findPos])

  const jumpToFind = useCallback((pos: number) => {
    setFindPos(pos)
    setPageIndex(Math.floor(pos / rsltsPerPage))
    setActiveIndex(pos % rsltsPerPage)
    const orig = viewIndices ? viewIndices[pos] : pos
    if (orig != null && orig >= 0) {
      setPrvwTrgt({ kind: 'result', index: orig })
    }
  }, [viewIndices])

  const onFindStep = useCallback((dir: 1 | -1) => {
    if (findMatches.length === 0) {
      return
    }
    let next: number | undefined
    if (dir === 1) {
      next = findMatches.find((pos) => pos > findPos) ?? findMatches[0]
    } else {
      for (let i = findMatches.length - 1; i >= 0; i -= 1) {
        if (findMatches[i] < findPos) {
          next = findMatches[i]
          break
        }
      }
      next ??= findMatches[findMatches.length - 1]
    }
    jumpToFind(next)
  }, [findMatches, findPos, jumpToFind])

  // arm the jump from the current page: changing the find predicates lands on
  // the first matching build at or after where the user is (wrapping if none).
  const onFindPreds = useCallback((preds: Predicate[]) => {
    setFindPreds(preds)
    setFindPos(pageStart - 1)
  }, [pageStart])

  useEffect(() => {
    if (findPreds.length === 0 || findMatches.length === 0) {
      return
    }
    if (findMatches.includes(findPos)) {
      return
    }
    jumpToFind(findMatches.find((pos) => pos > findPos) ?? findMatches[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findPreds, findMatches])
  // display position of the selected row within the view.
  const glblSelNdx = pageStart + selNdx
  const rslvPrvwTgt = useMemo<PrvwTgt>(() => {
    if (prvwTrgt.kind === 'result' && !optResults[prvwTrgt.index]) {
      return { kind: 'base' }
    }

    return prvwTrgt
  }, [optResults, prvwTrgt])
  // actRsltNdx is always an original index into optResults (for preview/equip).
  const actRsltNdx = rslvPrvwTgt.kind === 'result'
    ? rslvPrvwTgt.index
    : origAt(glblSelNdx)
  const selPrvwDispPos = rslvPrvwTgt.kind === 'result'
    ? dispPosOf(rslvPrvwTgt.index)
    : -1
  const selPrvwNdx = (
    selPrvwDispPos >= pageStart &&
    selPrvwDispPos < pageEnd
  )
    ? selPrvwDispPos - pageStart
    : null

  // drop a stale filter/sort when a new run clears the results.
  const noResults = optResults.length === 0
  useEffect(() => {
    if (noResults) {
      setViewCriteria(DEFAULT_VIEW_CRITERIA)
      setFindPreds([])
      setFindPos(-1)
    }
  }, [noResults])

  // keep the page in range when filtering shrinks the view below the cursor.
  useEffect(() => {
    if (pageIndex > totalPages - 1) {
      setPageIndex(Math.max(0, totalPages - 1))
      setActiveIndex(0)
    }
  }, [pageIndex, totalPages])

  const applyViewCriteria = useCallback((next: ResultViewCriteria) => {
    setViewCriteria(next)
    setPageIndex(0)
    setActiveIndex(0)
  }, [])

  const echoes = useMemo(() => {
    return getPreview({
      optResults: optResults,
      rslvPrvwIdx: rslvPrvwTgt.kind === 'result' ? rslvPrvwTgt.index : null,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
      fllbChs: effectRuntime?.build.echoes ?? [],
    })
  }, [
    invChsByUid,
    optResultEchoes,
    optResultData,
    optResults,
    effectRuntime?.build.echoes,
    rslvPrvwTgt,
  ])
  const echoSrfcMenu = useEchoSrfcM({
    clpbSrcResId: optResId ?? actResId ?? 'unknown',
    clipSourceName: displayName,
    curChs: effectRuntime?.build.echoes ?? [],
    onQpEchoAtjg: (echo, slotIndex) => {
      updOptRt((curRt) => ({
        ...curRt,
        build: {
          ...curRt.build,
          echoes: qpEchoAtSlot(curRt.build.echoes, echo, slotIndex),
        },
      }))
    },
  })
  const prvwSelTms = useMemo(
    () => echoes
      .map((echo, index) => echo ? { id: `optimizer:${rslvPrvwTgt.kind}:${index}`, val: echo } : null)
      .filter((item): item is { id: string; val: EchoInstance } => Boolean(item)),
    [echoes, rslvPrvwTgt.kind],
  )
  const prvwSelCtns = useMemo(() => [{
    id: 'optimizer-preview:copy',
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
  const prvwSel = useSel({
    surfaceId: `optimizer:${rslvPrvwTgt.kind}`,
    ariaLabel: 'Optimizer echo selection actions',
    items: prvwSelTms,
    acts: prvwSelCtns,
  })

  const showBasePrvw = () => {
    setPrvwTrgt({ kind: 'base' })
  }

  function applyOptRslt(index: number) {
    const nextEchoes = rsltLdt({
      optResults: optResults,
      index,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
    })
    if (nextEchoes.every((echo) => echo == null)) {
      return
    }

    // apply into optimizer state first so preview and follow-up equip actions
    // keep reading from the same normalized result payload.
    updOptRt((runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))
  }

  function applyOptResult(index: number) {
    const nextEchoes = rsltLdt({
      optResults: optResults,
      index,
      invChsByUid: invChsByUid,
      optResultEchoes: optResultEchoes,
      optResultData: optResultData,
    })
    if (nextEchoes.every((echo) => echo == null)) {
      return
    }

    applyOptRslt(index)

    if (!optResId) {
      return
    }

    updResRt(optResId, (runtime) => ({
      ...runtime,
      build: {
        ...runtime.build,
        echoes: nextEchoes,
      },
    }))

    if (actResId !== optResId) {
      swtcToRes(optResId)
    }
  }

  const showRsltPrvw = (index: number) => {
    setActiveIndex(index)
    const orig = origAt(pageStart + index)
    if (orig >= 0) {
      setPrvwTrgt({ kind: 'result', index: orig })
    }
  }

  const vsblHdrTtls = useMemo(() => {
    if (!rotationMode) {
      return HEADER_TITLES
    }

    return HEADER_TITLES.filter((title) => title !== 'Ʃ BNS%' && title !== 'Ʃ AMP%')
  }, [rotationMode])

  const pageItems = useMemo(() => {
    const items: Array<number | string> = []
    if (totalPages <= 10) {
      for (let i = 0; i < totalPages; i += 1) {
        items.push(i)
      }
      return items
    }
    if (pageIndex < 7) {
      for (let i = 0; i < 7; i += 1) {
        items.push(i)
      }
      items.push('...')
      items.push(totalPages - 1)
      return items
    }
    if (pageIndex > totalPages - 8) {
      items.push(0)
      items.push('...')
      for (let i = totalPages - 7; i < totalPages; i += 1) {
        items.push(i)
      }
      return items
    }
    items.push(0)
    items.push('...')
    for (let i = pageIndex - 2; i <= pageIndex + 2; i += 1) {
      items.push(i)
    }
    items.push('...')
    items.push(totalPages - 1)
    return items
  }, [pageIndex, totalPages])

  // open the page jumper attached to a specific ellipsis. focus + select-all
  // is deferred to the next paint so the input has mounted by the time it
  // arrives.
  const openJump = useCallback((index: number) => {
    setJumpEditNdx(index)
    setJumpDraft('')
    requestAnimationFrame(() => {
      const node = jumpInputRef.current
      if (node) {
        node.focus()
        node.select()
      }
    })
  }, [])

  const closeJump = useCallback(() => {
    setJumpEditNdx(null)
    setJumpDraft('')
  }, [])

  const commitJump = useCallback(() => {
    const parsed = Number.parseInt(jumpDraft, 10)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= totalPages) {
      setPageIndex(parsed - 1)
      setActiveIndex(0)
    }
    closeJump()
  }, [jumpDraft, totalPages, closeJump])

  // close the jumper whenever the page set changes underneath it.
  useEffect(() => {
    if (jumpEditNdx != null && jumpEditNdx >= pageItems.length) {
      closeJump()
    }
  }, [pageItems, jumpEditNdx, closeJump])

  const selMainEchoF = useMemo(() => {
    const echoId = optSets?.lockedMainEchoId
    if (!echoId) {
      return null
    }

    const echo = getEchoById(echoId)
    if (!echo) {
      return null
    }

    return {
      id: echo.id,
      name: echo.name,
      icon: echo.icon,
    }
  }, [optSets?.lockedMainEchoId])

  const resPickerSlot = resPckr.value
  const selWpnPckrSl = weaponPicker.value

  const lgblOptTeamR = useMemo(() => {
    if (!optRt || resPickerSlot === null || resPickerSlot === 'active') {
      return RES_MENU
    }

    const occupiedIds = new Set(
      optRt.build.team.filter(
        (memberId, memberIndex): memberId is string =>
          Boolean(memberId) && memberIndex !== resPickerSlot + 1,
      ),
    )

    return RES_MENU.filter((entry) => !occupiedIds.has(entry.id))
  }, [optRt, resPickerSlot])

  const selWpnPckrRt = useMemo(
    () => (
      optRt && selWpnPckrSl !== null
        ? makeOpSlot(optRt, selWpnPckrSl)
        : null
    ),
    [optRt, selWpnPckrSl],
  )

  const selWpnPckrWp = useMemo(() => {
    if (!selWpnPckrRt) {
      return []
    }

    const seed = seedRsntById[selWpnPckrRt.id] ?? null
    if (!seed) {
      return []
    }

    return listWpnsByTy(seed.weaponType)
  }, [selWpnPckrRt])

  const selWpnPckroe = useMemo(() => {
    const seed = selWpnPckrRt
      ? seedRsntById[selWpnPckrRt.id] ?? null
      : null

    switch (seed?.weaponType) {
      case 1:
        return 'broadblade'
      case 2:
        return 'sword'
      case 3:
        return 'pistols'
      case 4:
        return 'gauntlets'
      case 5:
        return 'rectifier'
      default:
        return null
    }
  }, [selWpnPckrRt])

  const applyOptWpnS = useCallback((slot: OpSlot, weaponId: string) => {
    const selWpn = getWeapon(weaponId)
    if (!selWpn) {
      return
    }

    updOptRt((prev) => {
      if (slot === 'active') {
        const nextControls = { ...prev.state.controls }
        clrWpnSttCnt(nextControls, prev.build.weapon.id)
        applyWpnSttD(nextControls, selWpn.id)
        const stats = weaponStatsAt(selWpn, prev.build.weapon.level)

        return {
          ...prev,
          build: {
            ...prev.build,
            weapon: {
              ...prev.build.weapon,
              id: selWpn.id,
              baseAtk: stats.atk,
              rank: 1,
            },
          },
          state: {
            ...prev.state,
            controls: nextControls,
          },
        }
      }

      const memberId = prev.build.team[slot + 1]
      if (!memberId) {
        return prev
      }

      const seed = seedRsntById[memberId] ?? null
      if (!seed) {
        return prev
      }

      const currentRuntime = prev.teamRuntimes[slot]
      const resolvedRuntime = currentRuntime?.id === memberId
        ? currentRuntime
        : makeTeamMember(seed)
      const curRt = matTeamMemFr(
        seed,
        resolvedRuntime,
        prev.state.controls,
        prev.state.combat,
        prev.build.team,
      )
      const nextControls = { ...curRt.state.controls }
      clrWpnSttCnt(nextControls, curRt.build.weapon.id)
      applyWpnSttD(nextControls, selWpn.id)
      const stats = weaponStatsAt(selWpn, curRt.build.weapon.level)
      const nextRuntime: ResRuntime = {
        ...curRt,
        build: {
          ...curRt.build,
          weapon: {
            ...curRt.build.weapon,
            id: selWpn.id,
            baseAtk: stats.atk,
            rank: 1,
          },
        },
        state: {
          ...curRt.state,
          controls: nextControls,
        },
      }
      const nextTeamRuns = [...prev.teamRuntimes] as [TeamMemRt | null, TeamMemRt | null]
      nextTeamRuns[slot] = teamRuntime(nextRuntime)

      return {
        ...prev,
        state: {
          ...prev.state,
          controls: mkMateCntr(prev.state.controls, [memberId], memberId, nextRuntime),
        },
        teamRuntimes: nextTeamRuns,
      }
    })

    if (selWpnPckroe) {
      bumpPickerFreq({
        bucket: 'weapon',
        weaponType: selWpnPckroe,
        ids: [selWpn.id],
      })
    }
  }, [bumpPickerFreq, selWpnPckroe, updOptRt])

  const applyOptMate = useCallback((slotIndex: 0 | 1, resonatorId: string) => {
    updOptRt((prev) => {
      const nextSeed = seedRsntById[resonatorId] ?? null
      if (!nextSeed) {
        return prev
      }

      const curMemId = prev.build.team[slotIndex + 1]
      const nextTeam = [...prev.build.team] as typeof prev.build.team
      nextTeam[slotIndex + 1] = resonatorId

      const nextRuntime = matTeamMemFr(
        nextSeed,
        makeTeamMember(nextSeed),
        prev.state.controls,
        prev.state.combat,
        nextTeam,
      )
      const currentRuntime = prev.teamRuntimes[slotIndex]
      const memberIdsClear = Array.from(
        new Set([currentRuntime?.id, curMemId].filter((value): value is string => Boolean(value))),
      )
      const nextTeamRuns = [...prev.teamRuntimes] as [TeamMemRt | null, TeamMemRt | null]
      nextTeamRuns[slotIndex] = teamRuntime(nextRuntime)

      return {
        ...prev,
        build: {
          ...prev.build,
          team: nextTeam,
        },
        state: {
          ...prev.state,
          controls: mkMateCntr(prev.state.controls, memberIdsClear, resonatorId, nextRuntime),
        },
        teamRuntimes: nextTeamRuns,
      }
    })

    setEchoPlans((prev) => {
      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = null
      return next
    })
    bumpPickerFreq({
      bucket: 'teamResonator',
      slot: slotIndex === 0 ? 'teammate1' : 'teammate2',
      ids: [resonatorId],
    })
  }, [bumpPickerFreq, setEchoPlans, updOptRt])

  const addSetPref = useCallback((slotIndex: 0 | 1, setId: number) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex) : null
      if (!memRt) {
        return prev
      }

      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = addEchoSetPr(
        prev[slotIndex] ?? derEchoPlan(memRt.build.echoes),
        setId,
      )
      return next
    })
  }, [optRt, setEchoPlans])

  const rmSetPref = useCallback((slotIndex: 0 | 1, setId: number) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex) : null
      if (!memRt) {
        return prev
      }

      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = rmEchoSetPre(
        prev[slotIndex] ?? derEchoPlan(memRt.build.echoes),
        setId,
      )
      return next
    })
  }, [optRt, setEchoPlans])

  const setSetCount = useCallback((slotIndex: 0 | 1, setId: number, count: number) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex) : null
      if (!memRt) {
        return prev
      }

      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = setEchoSetCn(
        prev[slotIndex] ?? derEchoPlan(memRt.build.echoes),
        setId,
        count,
      )
      return next
    })
  }, [optRt, setEchoPlans])

  const rmMate = useCallback((slotIndex: 0 | 1) => {
    updOptRt((prev) => {
      const curMemId = prev.build.team[slotIndex + 1]
      const nextTeam = [...prev.build.team] as typeof prev.build.team
      nextTeam[slotIndex + 1] = null
      const nextTeamRuns = [...prev.teamRuntimes] as [TeamMemRt | null, TeamMemRt | null]
      nextTeamRuns[slotIndex] = null
      const nextControls: Record<string, boolean | number | string> = {}
      for (const [key, value] of Object.entries(prev.state.controls)) {
        if (!curMemId || !key.startsWith(`team:${curMemId}:`)) {
          nextControls[key] = value
        }
      }
      return {
        ...prev,
        build: { ...prev.build, team: nextTeam },
        teamRuntimes: nextTeamRuns,
        state: { ...prev.state, controls: nextControls },
      }
    })
    setEchoPlans((prev) => {
      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = null
      return next
    })
  }, [setEchoPlans, updOptRt])

  const rmMateMainEc = useCallback((slotIndex: 0 | 1) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex) : null
      if (!memRt) {
        return prev
      }

      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = selMainEcho(
        prev[slotIndex] ?? derEchoPlan(memRt.build.echoes),
        null,
      )
      return next
    })
  }, [optRt, setEchoPlans])

  const openResPckr = (slot: OpSlot = 'active') => {
    resPckr.show(slot)
  }

  const clsResPckr = () => {
    resPckr.hide()
  }

  const openWpnPckr = (slot: OpSlot) => {
    weaponPicker.show(slot)
  }

  const clsWpnPckr = () => {
    weaponPicker.hide()
  }

  const openMainEcho = (target: OpEchoTarget = 'filter') => {
    mainEchoPckr.show(target)
  }

  const clsMainEchoP = () => {
    mainEchoPckr.hide()
  }

  const mainEchoPiece = mainEchoPckr.value ?? 'filter'
  const selMainEchoI = mainEchoPiece === 'filter'
    ? optSets?.lockedMainEchoId ?? null
    : rslvEchoPlns[mainEchoPiece]?.mainEchoId ?? null

  const isLoading = optStts === 'running'
  const success = optStts === 'done'
  const cancelled = optStts === 'cancelled'

  function onRunOpt() {
    if (!optimizer || !runOptSets || pndnCombos) {
      return
    }

    if (!runOptSets.enableGpu && !optCpuHintSe) {
      setOptCpuHin(true)
      openUiModal(modalContent.firstTimeOptimizer)
      return
    }

    setPageIndex(0)
    setActiveIndex(0)
    showBasePrvw()
    setProgress(mkMptyPrgr())
    startOpt({
      resonatorId: optimizer.resonatorId,
      resSeed: seedRsntById[optimizer.resonatorId],
      staticData: {
        gameDataReg: getGameData(),
        resCatById: getResCatByI(),
        resDtlsById: getResDtlsBy(),
        weaponsById: getWpnsById(),
        echoCatById: getEchoCatBy(),
        echoSetDefs: ECHO_SET_DEFS,
        echoStats: getEchoSttsSrc() ?? undefined,
      },
      runtime: optimizer.runtime,
      settings: runOptSets,
      invChs: fltrInvEchoE.map((entry) => entry.echo),
      enemyProfile,
      selectedTargets: activeTarget,
      setConds: optSetConds,
      rotTms: selRotTms,
    }, {
      onProgress: (nextProgress) => {
        setProgress(nextProgress)
      },
    })
  }

  function handleReset() {
    reset()
  }

  const onTgtModeChn = useCallback((value: 'skill' | 'combo') => {
    const nextRotMode = value === 'combo'
    updOptSets((settings) => ({
      ...settings,
      targetMode: value,
      rotationMode: nextRotMode,
    }))
    if (rotationMode !== nextRotMode) {
      reset()
    }
  }, [rotationMode, updOptSets])

  function onSyncLive() {
    if (isLoading) {
      return
    }

    syncOptCtxTo(optResId ?? undefined)
    setEchoPlans([null, null])
    reset()
  }

  function handleHalt() {
    cnclOpt()
  }

  const optCtxMenuTm = useMemo(() => getOptCtx({
    pane: menu.calculator.optimizer.pane,
    targetMode,
    skillGroups,
    comboOptions,
    tgtSkllId: optSets?.targetSkillId ?? null,
    tgtCmbId: optSets?.targetComboSourceId ?? null,
    enableGpu: optSets?.enableGpu ?? true,
    comboAvailable,
    isSprite,
    isLoading,
    pending: pndnCombos || isThryMode,
    onPickRes: () => openResPckr('active'),
    onTargetMode: onTgtModeChn,
    onSkill: (value) => {
      updOptSets((settings) => ({
        ...settings,
        targetSkillId: value,
      }))
    },
    onCombo: (value) => {
      updOptSets((settings) => ({
        ...settings,
        targetComboSourceId: value,
      }))
    },
    onGpu: (value) => {
      updOptSets((settings) => ({
        ...settings,
        enableGpu: value,
      }))
    },
    onSprite: setIsSprite,
    onSync: onSyncLive,
    onRun: onRunOpt,
    onHalt: handleHalt,
    onReset: handleReset,
    onClear: reset,
  }), [
    comboOptions,
    comboAvailable,
    handleHalt,
    handleReset,
    onRunOpt,
    onSyncLive,
    onTgtModeChn,
    isLoading,
    isSprite,
    menu.calculator.optimizer,
    openResPckr,
    optSets?.enableGpu,
    optSets?.targetComboSourceId,
    optSets?.targetSkillId,
    pndnCombos,
    reset,
    skillGroups,
    targetMode,
    updOptSets,
  ])

  function handleEquip() {
    if (isLoading || !optResults[actRsltNdx]) {
      return
    }

    quickPickModal.show(actRsltNdx)
  }

  const controlProps = {
    isLoading,
    pndnCmbn: pndnCombos,
    progress,
    success,
    cancelled,
    resultLength,
    fltrEchoCnt: isThryMode ? qppdChs.length : fltrInvEchoE.length,
    cmbnLbl: isThryMode
      // theory mode reports the exact compiled emit count once the worker
      // has prepared the search payload.
      ? ((progress.total ?? 0) > 0
        ? Math.floor(progress.total ?? 0).toLocaleString()
        : '...')
      : shldCntCombo
      ? (pndnCombos ? 'calculating...' : rslvComboCnt.toLocaleString())
      : '0',
    batchSize: optBtchSize,
    resultsLimit: optSets?.resultsLimit ?? 256,
    keepPercent: optSets?.keepPercent ?? 0.5,
    lowMmryMode: optSets?.lowMemoryMode ?? false,
    searchMode: optMode,
    onResultLimit: (value: number) => {
      updOptSets((settings) => ({
        ...settings,
        resultsLimit: value,
      }))
    },
    onKeepPrcnfe: (value: number) => {
      updOptSets((settings) => ({
        ...settings,
        keepPercent: value,
      }))
    },
    onLowMmryMch: (value: boolean) => {
      updOptSets((settings) => ({
        ...settings,
        lowMemoryMode: value,
      }))
    },
    onModeChg: (value: typeof optMode) => {
      updOptSets((settings) => ({
        ...settings,
        searchMode: value,
      }))
    },
    onRunOpt,
    onReset: handleReset,
    onHalt: handleHalt,
    onEquip: handleEquip,
    onGuide: () => {
      navigate('/guides?category=optimizer')
    },
    onRules: openRlsMdl,
    onClear: () => {
      reset()
    },
  }

  return (
    <div className="calculator-stage">
      <AppModal
        state={uiModal.dialogProps}
        variant="optimizer"
        ariaLabel="Optimizer notice"
        onClose={closeUiModal}
      >
        {uiModal.value}
      </AppModal>

      <AppModal
        state={rulesModal.dialogProps}
        variant="optimizer-rules"
        ariaLabel="Optimizer rules"
        onClose={clsRlsMdl}
      >
        <Rules />
      </AppModal>

      <AppModal
        state={quickPickModal.dialogProps}
        variant="confirmation"
        tone="info"
        ariaLabel="Equip optimizer result"
        onClose={quickPickModal.hide}
      >
        <div className="confirmation-modal__body">
          <h2 className="confirmation-modal__title">
            Equip optimizer result
          </h2>
          <div className="confirmation-modal__message">
            Choose whether to apply this result to the optimizer sim only or to both sim and live.
          </div>
        </div>
        <div className="confirmation-modal__actions rotation-load-choice-actions">
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--cancel"
            onClick={quickPickModal.hide}
          >
            Cancel
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            onClick={() => {
              if (quickPickModal.value != null) {
                applyOptRslt(quickPickModal.value)
              }
              quickPickModal.hide()
            }}
          >
            Sim
          </button>
          <button
            type="button"
            className="confirmation-modal__btn confirmation-modal__btn--confirm"
            onClick={() => {
              if (quickPickModal.value != null) {
                applyOptResult(quickPickModal.value)
              }
              quickPickModal.hide()
            }}
          >
            Sim & Live
          </button>
        </div>
      </AppModal>

      <SetCond
        {...setCondsMdl}
        portalTarget={mdlPrtlTgt}
        onClose={setCondsMdl.hide}
        title="Sonata Set Config"
        setConds={optSetConds}
        onSetCondsrx={(updater) => {
          if (!optResId) {
            return
          }

          updResSetCon(optResId, updater)
        }}
      />

      <ContextTrigger
        asChild
        ariaLabel="Optimizer actions"
        items={optCtxMenuTm}
      >
        <div className={`optimizer-pane ${isWide ? '' : 'compact'}`}>
          {isWide ? <ControlBox isWide {...controlProps} /> : null}

          <div className="optimizer-details optimizer-details--compact">
          <Expandable
            header="Sim Settings"
            defaultOpen
            className="optimizer-character-settings"
            triggerClass="opt-expandable-trigger"
            triggerStyle={{ alignItems: 'center' }}
          >
            <div className="character-options-container">
              <CharPtnsPnl
                displayName={displayName}
                level={optRt?.base.level ?? 90}
                sequence={optRt?.base.sequence ?? 0}
                rarity={activeSeed?.rarity ?? 4}
                imageSrc={imageSrc}
                targetMode={targetMode}
                tgtSkllId={optSets?.targetSkillId ?? null}
                tgtCmbId={optSets?.targetComboSourceId ?? null}
                skillOptions={skillOptions}
                skillGroups={skillGroups}
                comboOptions={comboOptions}
                enableGpu={optSets?.enableGpu ?? true}
                comboAvailable={comboAvailable}
                useSplash={isSprite}
                mainEcho={selMainEchoF}
                allowedSets={optSets?.allowedSets ?? {1: [], 3: [], 5: [] }}
                mainStatFilter={isThryMode ? thryMFltr.mainStatFilter : optSets?.mainStatFilter ?? []}
                mainStatRdly={isThryMode}
                selBonus={isThryMode ? thryMFltr.selectedBonus : optSets?.selectedBonus ?? null}
                statCstrs={optSets?.statConstraints ?? {}}
                optRt={optRt}
                onOpenResPick={() => openResPckr('active')}
                onSyncLive={onSyncLive}
                onTgtModeClw={onTgtModeChn}
                onTgtSkllCdf={(value) => {
                  updOptSets((settings) => ({
                    ...settings,
                    targetSkillId: value,
                  }))
                }}
                onTgtCmbChng={(value) => {
                  updOptSets((settings) => ({
                    ...settings,
                    targetComboSourceId: value,
                  }))
                }}
                onNblGpuChng={(enabled) => {
                  updOptSets((settings) => ({
                    ...settings,
                    enableGpu: enabled,
                  }))
                }}
                onOptRtPdt={updOptRt}
                onOpenMainEcho={openMainEcho}
                onOpenSetCond={setCondsMdl.show}
                onClrMainEyq={() => {
                  updOptSets((settings) => ({
                    ...settings,
                    lockedMainEchoId: null,
                  }))
                }}
                onLlwdSetsxi={(value) => {
                  updOptSets((settings) => ({
                    ...settings,
                    allowedSets: value,
                  }))
                }}
                onToggleMain={(value) => {
                  updOptSets((settings) => ({
                    ...settings,
                    mainStatFilter: settings.mainStatFilter.includes(value)
                      ? settings.mainStatFilter.filter((entry) => entry !== value)
                      : [...settings.mainStatFilter, value],
                  }))
                }}
                onPickBonus={(value) => {
                  updOptSets((settings) => ({
                    ...settings,
                    selectedBonus: value,
                    mainStatFilter: settings.mainStatFilter.includes('bonus')
                      ? settings.mainStatFilter
                      : [...settings.mainStatFilter, 'bonus'],
                  }))
                }}
                onClrAllFltr={() => {
                  updOptSets((settings) => ({
                    ...settings,
                    mainStatFilter: [],
                    selectedBonus: null,
                  }))
                }}
                onStatLmtCdd={(statKey, field, value) => {
                  updOptSets((settings) => ({
                    ...settings,
                    statConstraints: {
                      ...settings.statConstraints,
                      [statKey]: {
                        ...settings.statConstraints[statKey],
                        [field]: value,
                      },
                    },
                  }))
                }}
                setIsSprite={setIsSprite}
              />
            </div>
          </Expandable>

          <Expandable header="Sim Team" defaultOpen className="optimizer-search-results" triggerClass="opt-expandable-trigger" triggerStyle={{ alignItems: 'center' }}>
            <TeamPanel
                rarity={activeSeed?.rarity ?? 4}
                displayName={displayName}
                optRt={effectRuntime}
                invalidMainIds={nvldMateMain}
                mateSetPrefs={[
                  rslvEchoPlns[0]?.setPrefs ?? [],
                  rslvEchoPlns[1]?.setPrefs ?? [],
                ]}
                onRtPdt={updOptRt}
                onOpenMate={openResPckr}
                onOpenWeapon={openWpnPckr}
                onOpenMateMenu={(slotIndex) => openMainEcho(slotIndex)}
                onAddMateSet={addSetPref}
                onRemoveMateSet={rmSetPref}
                onSetMateCount={setSetCount}
                onRemoveMate={rmMate}
                onClearMainEcho={rmMateMainEc}
            />
          </Expandable>

          <Expandable header="Sim Results" defaultOpen className="optimizer-search-results" triggerClass="opt-expandable-trigger" triggerStyle={{ alignItems: 'center' }}>
            {!isLoading && optResults.length > 0 ? (
              <ResultToolbar
                open={optToolsOpen}
                onToggle={setOptToolsOpen}
                mode={consoleMode}
                onMode={setConsoleMode}
                facets={facetTable}
                criteria={viewCriteria}
                onCriteria={applyViewCriteria}
                matchCount={resultLength}
                totalCount={optResults.length}
                findPreds={findPreds}
                onFindPreds={onFindPreds}
                findMatchIndex={findMatchIndex}
                findMatchCount={findMatches.length}
                onFindStep={onFindStep}
              />
            ) : null}
            <div className="results-container" data-mode={targetMode}>
                <div
                  className={`opt-results-header${rslvPrvwTgt.kind === 'base' ? ' is-selected' : ''}`}
                  onClick={showBasePrvw}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      showBasePrvw()
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="opt-results-header__titles" data-mode={targetMode}>
                    {vsblHdrTtls.map((title) => (
                      <div key={title} className="opt-results-header__col">
                        {title}
                      </div>
                    ))}
                  </div>
                  <Row
                    result={baseResult}
                    base
                    baseDamage={baseResult.damage}
                    rotationMode={rotationMode}
                    onClick={showBasePrvw}
                  />
                </div>

                <div className={`optimizer-results app-loader-host ${isLoading ? 'running' : ''}`}>
                  {isLoading ? (
                    <AppLdrVrly text="Optimizing..." />
                  ) : (
                    <>
                      {rows.map((result, index) => (
                        <Row
                          key={pageOrigIndices[index] ?? pageStart + index}
                          result={result}
                          baseDamage={baseResult.damage}
                          rotationMode={rotationMode}
                          selected={selPrvwNdx === index}
                          onClick={() => showRsltPrvw(index)}
                        />
                      ))}

                      {optRrr ? (
                        <div className="opt-result-row is-base">
                          <div className="opt-result-row__col">{optRrr}</div>
                        </div>
                      ) : null}

                      {totalPages > 1 ? (
                        <div className="opt-pagination">
                          <button
                            className="opt-pagination__btn opt-pagination__btn--subtle"
                            disabled={pageIndex === 0}
                            onClick={() => {
                              setPageIndex((value) => Math.max(0, value - 1))
                              setActiveIndex(0)
                            }}
                          >
                            ‹
                          </button>

                          {pageItems.map((item, index) =>
                            item === '...' ? (
                              jumpEditNdx === index ? (
                                <input
                                  key={`jump-${index}`}
                                  ref={jumpInputRef}
                                  className="opt-pagination__jump"
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  aria-label={`Jump to page (1 to ${totalPages})`}
                                  placeholder={`1–${totalPages}`}
                                  value={jumpDraft}
                                  onChange={(event) => {
                                    const next = event.target.value.replace(/[^0-9]/g, '')
                                    setJumpDraft(next)
                                  }}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault()
                                      commitJump()
                                    } else if (event.key === 'Escape') {
                                      event.preventDefault()
                                      closeJump()
                                    }
                                  }}
                                  onBlur={() => {
                                    // empty blur cancels silently; non-empty
                                    // commits so trailing-input edge cases
                                    // (click-away after typing) feel intentional.
                                    if (jumpDraft.length === 0) {
                                      closeJump()
                                    } else {
                                      commitJump()
                                    }
                                  }}
                                />
                              ) : (
                                <button
                                  key={`ellipsis-${index}`}
                                  type="button"
                                  className="opt-pagination__ellipsis"
                                  aria-label={`Jump to page (1 to ${totalPages})`}
                                  title="Jump to page"
                                  onClick={() => openJump(index)}
                                >
                                  <span className="opt-pagination__ellipsis-dots" aria-hidden="true">
                                    <span />
                                    <span />
                                    <span />
                                  </span>
                                </button>
                              )
                            ) : (
                              <button
                                key={item}
                                className={`opt-pagination__btn${item === pageIndex ? ' is-active' : ''}`}
                                onClick={() => {
                                  setPageIndex(item as number)
                                  setActiveIndex(0)
                                }}
                              >
                                {(item as number) + 1}
                              </button>
                            ),
                          )}

                          <button
                            className="opt-pagination__btn opt-pagination__btn--subtle"
                            disabled={pageIndex >= totalPages - 1}
                            onClick={() => {
                              setPageIndex((value) => Math.min(totalPages - 1, value + 1))
                              setActiveIndex(0)
                            }}
                          >
                            ›
                          </button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div className="opt-echo-preview">
                <div className="opt-echo-preview__grid" {...prvwSel.surfaceProps}>
                  {echoes.map((echo, index) => {
                    const itemId = `optimizer:${rslvPrvwTgt.kind}:${index}`
                    const tile = (
                      <OptPrvwEchoT
                        key={`preview-echo-${index}`}
                        echo={echo}
                        index={index}
                        selected={prvwSel.isSelected(itemId)}
                        selMode={prvwSel.selectionMode}
                        data-selection-focus-item="true"
                        aria-selected={prvwSel.isSelected(itemId) ? 'true' : 'false'}
                        onClickCapture={prvwSel.buildClickCapture(itemId)}
                      />
                    )

                    if (!echo) {
                      return tile
                    }

                    return (
                      <ContextTrigger
                        key={`preview-echo-menu-${index}`}
                        asChild
                        ariaLabel={`${getEchoById(echo.id)?.name ?? 'Echo'} actions`}
                        items={echoSrfcMenu.buildReadOnlyMenu({
                          id: itemId,
                          echo,
                          onSelect: () => {
                            prvwSel.focusSurface()
                            prvwSel.addToSelection(itemId)
                          },
                        })}
                      >
                        {tile}
                      </ContextTrigger>
                    )
                  })}
                </div>
              </div>
            </Expandable>
            {!isWide ? <ControlBox isWide={false} {...controlProps} /> : null}
          </div>
        </div>
      </ContextTrigger>

      <EchoPckrMdl
        visible={mainEchoPckr.visible}
        open={mainEchoPckr.open}
        closing={mainEchoPckr.closing}
        portalTarget={mdlPrtlTgt}
        echoes={allEchoes}
        selEchoId={selMainEchoI}
        slotIndex={0}
        maxCost={12}
        onSelect={(echoId: string) => {
          if (mainEchoPiece === 'filter') {
            updOptSets((settings) => ({
              ...settings,
              lockedMainEchoId: echoId,
            }))
            bumpPickerFreq({
              bucket: 'echo',
              ids: [echoId],
            })
            return
          }

          setEchoPlans((prev) => {
            const memRt = optRt ? makeOpSlot(optRt, mainEchoPiece) : null
            if (!memRt) {
              return prev
            }

            const next = [...prev] as [EchoPlan | null, EchoPlan | null]
            next[mainEchoPiece] = selMainEcho(
              prev[mainEchoPiece] ?? derEchoPlan(memRt.build.echoes),
              echoId,
            )
            return next
          })
          bumpPickerFreq({
            bucket: 'echo',
            ids: [echoId],
          })
        }}
        onClear={() => {
          if (mainEchoPiece === 'filter') {
            updOptSets((settings) => ({
              ...settings,
              lockedMainEchoId: null,
            }))
            return
          }

          setEchoPlans((prev) => {
            const memRt = optRt ? makeOpSlot(optRt, mainEchoPiece) : null
            if (!memRt) {
              return prev
            }

            const next = [...prev] as [EchoPlan | null, EchoPlan | null]
            next[mainEchoPiece] = selMainEcho(
              prev[mainEchoPiece] ?? derEchoPlan(memRt.build.echoes),
              null,
            )
            return next
          })
        }}
        onClose={clsMainEchoP}
      />

      <ResPckrMdl
        visible={resPckr.visible}
        open={resPckr.open}
        closing={resPckr.closing}
        portalTarget={mdlPrtlTgt}
        eyebrow={resPickerSlot === 'active' ? 'Roster' : 'Team Slots'}
        title={resPickerSlot === 'active' ? 'Select Resonator' : 'Select Teammate'}
        resonators={lgblOptTeamR}
        selResId={
          resPickerSlot === null
            ? null
            : resPickerSlot === 'active'
              ? optResId ?? null
              : optRt?.build.team[resPickerSlot + 1] ?? null
        }
        selLbl={resPickerSlot === 'active' ? 'Active' : 'Selected'}
        smmrPrmr={{
          label: resPickerSlot === 'active' ? 'Current' : 'Slot',
          value:
            resPickerSlot === 'active'
              ? displayName
              : `Teammate ${(resPickerSlot ?? 0) + 1}`,
        }}
        emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
        closeLabel="Close"
        panelWidth="regular"
        onSelect={(resonatorId) => {
          if (resPickerSlot === null || resPickerSlot === 'active') {
            swtcToRes(resonatorId)
          } else {
            applyOptMate(resPickerSlot, resonatorId)
          }
          clsResPckr()
        }}
        onClose={clsResPckr}
      />

      <WpnPckrMdl
        visible={weaponPicker.visible}
        open={weaponPicker.open}
        closing={weaponPicker.closing}
        portalTarget={mdlPrtlTgt}
        weapons={selWpnPckrWp}
        selWpnId={
          selWpnPckrRt?.build.weapon.id && !isNoWeaponId(selWpnPckrRt.build.weapon.id)
            ? selWpnPckrRt.build.weapon.id
            : null
        }
        onSelect={(weaponId) => {
          if (selWpnPckrSl === null) {
            return
          }

          applyOptWpnS(selWpnPckrSl, weaponId)
          clsWpnPckr()
        }}
        onClose={clsWpnPckr}
      />
    </div>
  )
}

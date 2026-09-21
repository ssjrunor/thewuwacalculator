/*
  Author: Runor Ewhro
  Description: Coordinates optimizer settings, search execution, result
               filtering, preview state, and build application.
*/

import {type ReactNode, useCallback, useRef} from 'react'
import {useEffect, useLayoutEffect as useLytFfct, useMemo, useState} from 'react'
import { useInventoryLease } from '@/application/hooks/useInventoryLease.ts'
import { useNavX } from '@/shared/navigation/useNavX'
import type {RotationNode} from '@/domain/gameData/contracts'
import { isRotationSequence } from '@/domain/gameData/rotationSequence.ts'
import {
  cloneEchoLoadout,
  savedRotationItems,
  savedRotationResonatorId,
} from '@/domain/entities/inventoryStorage.ts'
import { OptimizerLab } from './transport/OptimizerLab.tsx'
import { OptStage } from './transport/OptStage.tsx'
import { OptTransport } from './transport/OptTransport.tsx'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { cloneOptSets } from '@/engine/runtime/defaults'
import { maxWpnRt } from '@/engine/runtime/sourceStateInit'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { useAppModal, useAppModalValue } from '@/shared/ui/useAppModal.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import type {SelectOption, SelectGroup} from '@/application/ui/LiquidSelect'
import {getEchoCatBy} from '@/data/gameData/catalog/echoes'
import {getGameData} from '@/data/gameData'
import {ECHO_SET_DEFS} from '@/data/gameData/echoSets/effects'
import {getEchoSttsSrc} from '@/data/gameData/catalog/echoStats'
import {getResCatByI, getResDtlsBy} from '@/data/gameData/resonators/resonatorDataStore'
import {getWpnsById} from '@/data/gameData/weapons/weaponDataStore'
import {getEchoById, listEchoes} from '@/data/catalog/echoCatalogService'
import {weaponEquipState} from '@/engine/optimizer/context/weaponOverlays.ts'
import {getWpnById} from '@/data/catalog/weaponCatalogService'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService'
import { makeRuntimeMap, mkPartRtLkp } from '@/engine/runtime/runtimeAdapters'
import {useAppStore} from '@/application/state'
import {
  selActTgtSlc,
  selEnemyProf,
  selScenarioProfiles,
} from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary'
import { contextScenarioMember } from '@/domain/entities/combatScenario.ts'
import { indexEquippedEchoes } from '@/engine/runtime/inventoryUsage.ts'
import {deriveOptSets, preserveToggles} from '@/engine/optimizer/config/defaultSettings.ts'
import {applyKeepPrc, makeStatWeights} from '@/engine/optimizer/search/filtering.ts'
import {compOptTgtCt} from '@/engine/optimizer/target/context'
import {listOptTrgt} from '@/engine/optimizer/target/skills'
import {countOptCombos, countTheory} from '@/engine/optimizer/search/counting'
import { optSetIdSet } from '@/engine/optimizer/config/allowedSets.ts'
import type {OptBagResult, OptPrgr, OptResultStats, OptStartPay, TheoryResult, TheoryResultRow} from '@/engine/optimizer/types'
import type { OptCompOutMs } from '@/engine/optimizer/compiler/compileWorker.types.ts'
import {seedRsntById} from '@/modules/simulation/features/resonator/lib/seedData.ts'
import {Expandable} from '@/shared/ui/Expandable'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import { EchoPicker as EchoPckrMdl } from '@/modules/simulation/features/echoes/Picker.tsx'
import { WeaponPicker as WpnPckrMdl } from '@/modules/simulation/features/weapons/Picker.tsx'
import {
  SetCond
} from '@/modules/simulation/features/controls/SetConditional.tsx'
import {ResPckr as ResPckrMdl} from '@/modules/simulation/features/resonator/Picker.tsx'
import {CharPtnsPnl} from '@/modules/simulation/surfaces/optimizer/ResonatorOptionsPanel.tsx'
import {WpnCfgMdl} from '@/modules/simulation/surfaces/suggestions/WeaponConfig.tsx'
import { TeamPanel } from '@/modules/simulation/surfaces/optimizer/TeamPanel.tsx'
import {ControlBox} from '@/modules/simulation/surfaces/optimizer/ControlBox.tsx'
import {
  type OptDisplayRow,
  Row
} from '@/modules/simulation/surfaces/optimizer/Row.tsx'
import {Rules} from '@/modules/simulation/surfaces/optimizer/Rules.tsx'
import {HEADER_TITLES} from '@/modules/simulation/surfaces/optimizer/lib/mockData.ts'
import { OPT_SKILL_TABS, getSkillTabLabel } from '@/modules/simulation/model/skillTabs'
import { skillDisplayColor } from '@/modules/simulation/surfaces/rotation/shared/skillDisplay.ts'
import {modalContent} from '@/modules/simulation/surfaces/optimizer/Modals.tsx'
import { OptPrvwEchoT } from '@/modules/simulation/surfaces/optimizer/lib/parts.tsx'
import { ResultToolbar } from '@/modules/simulation/surfaces/optimizer/ResultToolbar.tsx'
import { OptimizerInventoryModal } from '@/modules/simulation/surfaces/optimizer/OptimizerInventoryModal.tsx'
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
} from '@/modules/simulation/surfaces/optimizer/lib/results.ts'
import { RES_MENU } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { getWeapon, weaponStatsAt } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import {
  type EchoPlan,
  addSetPref as addEchoSetPr,
  derEchoPlan,
  rmSetPref as rmEchoSetPre,
  resEchoPlan,
  selMainEcho,
  setSetCount as setEchoSetCn,
} from '@/modules/simulation/surfaces/optimizer/lib/teammateEchoPlan.ts'
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
} from '@/modules/simulation/surfaces/optimizer/lib/helpers.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useEchoSrfcM } from '@/modules/simulation/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/simulation/features/echoes/lib/equip.ts'
import { Copy } from 'lucide-react'
import { useCtxBuilder } from '@/modules/simulation/shell/context-menu/useContextMenuBuilder.ts'
import { useSel } from '@/modules/simulation/lib/sel.tsx'
import { getOptCtx } from '@/modules/simulation/surfaces/optimizer/lib/ctx.tsx'

// The legacy route retains the retired layout; canonical routes use the shared workspace.
export type OptimizerVariant = 'embedded' | 'legacy'

// Bound transition waits even when no completion event arrives.
const BAND_SETTLE_CAP_MS = 700

// Delay synchronous compilation until React commits the fold and its active
// transitions finish. Skip the wait when no transition runs or motion is reduced.
function settleBand(band: HTMLElement | null): Promise<unknown> {
  if (!band) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const folds = [band, ...Array.from(band.children)]
        .flatMap((node) => node.getAnimations())
        .filter((animation) => animation instanceof CSSTransition)
        .map((animation) => animation.finished)

      if (folds.length === 0) {
        resolve()
        return
      }

      const cap = window.setTimeout(resolve, BAND_SETTLE_CAP_MS)
      void Promise.allSettled(folds).then(() => {
        window.clearTimeout(cap)
        resolve()
      })
    })
  })
}

export function Optimizer({ variant = 'embedded' }: { variant?: OptimizerVariant }) {
  useInventoryLease()
  const showToast = useTstStr((state) => state.show)
  const navigate = useNavX()
  const menu = useCtxBuilder()
  const activeTarget = useAppStore(selActTgtSlc)
  const enemyProfile = useAppStore(selEnemyProf)
  const scenario = useAppStore((state) => selectedCombatScenario(state.combat))
  const optimizerMember = contextScenarioMember(scenario)
  const optResId = optimizerMember.resonatorId
  const optRuntimesById = useMemo(() => mkPartRtLkp(scenario), [scenario])
  const optRt = optRuntimesById[optResId] ?? null
  const storedOptSets = useAppStore((state) => state.simulation.optimizerSettings)
  const optSetsResonatorId = useAppStore(
    (state) => state.simulation.optimizerSettingsResonatorId,
  )
  const optSets = useMemo(() => {
    if (!optRt || optSetsResonatorId === optResId) {
      return storedOptSets
    }

    return cloneOptSets({
      ...deriveOptSets({
        runtime: optRt,
        runtimesById: optRuntimesById,
        enemy: enemyProfile,
        selectedTargets: activeTarget,
      }),
      ...preserveToggles(storedOptSets),
    })
  }, [activeTarget, enemyProfile, optResId, optRt, optRuntimesById, optSetsResonatorId, storedOptSets])
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
  const invEchoEnts = useAppStore((state) => state.library.echoes)
  const optProfiles = useAppStore(selScenarioProfiles)
  const optInvEchoSg = useMemo(() => indexEquippedEchoes(optProfiles), [optProfiles])
  const invRttn = useAppStore((state) => state.library.rotations)
  const optCpuHintSe = useAppStore((state) => state.ui.optimizerCpuHintSeen)
  const maxResOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const setOptCpuHin = useAppStore((state) => state.setOptHint)
  const updResRt = useAppStore((state) => state.updResRt)
  const updOptSets = useAppStore((state) => state.updOptSets)
  const updResSetCon = useAppStore((state) => state.updResConds)
  const selectOptimizerResonator = useAppStore((state) => state.selectContextResonator)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const startOpt = useAppStore((state) => state.startOpt)
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const cnclOpt = useAppStore((state) => state.cnclOpt)
  const clrOptRslts = useAppStore((state) => state.clrOptRslt)
  const disposeOptResources = useAppStore((state) => state.disposeOptResources)
  const updateScenarioRuntime = useCallback((updater: (runtime: ResRuntime) => ResRuntime) => {
    updResRt(optResId, updater)
  }, [optResId, updResRt])
  const updateMemberRuntime = useCallback((
    resonatorId: string,
    updater: (runtime: ResRuntime) => ResRuntime,
  ) => {
    updResRt(resonatorId, updater)
  }, [updResRt])
  const { setMember: setTeamMember } = useTeamSlots()
  const optInvSelection = optimizerMember.local.optimizerInventory
  const updResOptInv = useAppStore((state) => state.updResOptInv)
  const optSetConds = optimizerMember.local.setConditionals
  const activeSeed = seedRsntById[optResId] ?? null
  const displayName = activeSeed?.name ?? 'Unknown'
  const rotationMode = optSets.rotationMode
  const targetMode: 'skill' | 'combo' = rotationMode ? 'combo' : 'skill'
  const optMode = optSets.searchMode
  const isThryMode = optMode === 'theory'

  // not resonator-scoped, so it survives both resonator switches and reloads.
  const isSprite = useAppStore((state) => state.ui.optimizerUseSprite)
  const setIsSprite = useAppStore((state) => state.setOptSprite)
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1200 : true,
  )
  const [pageIndex, setPageIndex] = useState(0)
  const [selNdx, setActiveIndex] = useState(0)
  const [viewCriteria, setViewCriteria] = useState<ResultViewCriteria>(DEFAULT_VIEW_CRITERIA)
  // whether the filter/sort controls are expanded; opening them arms the facet
  // pass so the dropdowns can list the echoes/sets/plans present.
  const [optToolsOpen, setOptToolsOpen] = useState(false)
  const [facetTable, setFacetTable] = useState<ResultFacet[] | null>(null)
  // which console mode the body shows: filter (WHERE, subsets) or find (jump).
  const [consoleMode, setConsoleMode] = useState<'filter' | 'find'>('filter')
  // Find predicates navigate within the filtered view without removing rows.
  // findPos records the last matching display position.
  const [findPreds, setFindPreds] = useState<Predicate[]>([])
  const [findPos, setFindPos] = useState(-1)
  // index into pageItems whose ellipsis is currently expanded into a jumper
  // input. only one ellipsis can be in edit mode at a time; null = inactive.
  const [jumpEditNdx, setJumpEditNdx] = useState<number | null>(null)
  const [jumpDraft, setJumpDraft] = useState('')
  const jumpInputRef = useRef<HTMLInputElement | null>(null)
  const bandRef = useRef<HTMLDivElement | null>(null)
  const [prvwTrgt, setPrvwTrgt] = useState<PrvwTgt>({ kind: 'base' })
  const [echoPlanStr, setEchoPlanS] = useState<{
    resonatorId: string | null
    plans: [EchoPlan | null, EchoPlan | null]
  }>(() => ({
    resonatorId: null,
    plans: mkMptyEchoPl(),
  }))
  const [progress, setProgress] = useState<OptPrgr>(() => mkMptyPrgr())
  const uiModal = useAppModalValue<ReactNode>()
  const rulesModal = useAppModal()
  const setCondsMdl = useAppModal()
  const wpnCondMdl = useAppModal()
  const optInvMdl = useAppModal()
  const mainEchoPckr = useAppModalValue<OpEchoTarget>()
  const resPckr = useAppModalValue<OpSlot>()
  const weaponPicker = useAppModalValue<OpSlot>()

  const mdlPrtlTgt = mainPortal()
  const mainEchoSession = useConfigurationSession({
    source: optSets,
    active: mainEchoPckr.visible,
    commit: updOptSets,
  })

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
        runtimesById: {} as Record<string, ResRuntime>,
        plans: [null, null] as [EchoPlan | null, EchoPlan | null],
        invalidMainEchoes: [null, null] as [string | null, string | null],
      }
    }

    const rslvPlns = [...echoPlans] as [EchoPlan | null, EchoPlan | null]
    const nvldMainChs: [string | null, string | null] = [null, null]
    const nextRuntimesById = { ...optRuntimesById }
    let changed = false

    // teammate echo plans are authored as lightweight preferences, so rebuild
    // the concrete teammate loadouts here before downstream optimizer prep.
    for (const slotIndex of [0, 1] as const) {
      const memRt = makeOpSlot(optRt, slotIndex, optRuntimesById)
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

      nextRuntimesById[memRt.id] = {
        ...memRt,
        build: {
          ...memRt.build,
          echoes: resolvedPlan.effectEchoes,
        },
      }
      changed = true
    }

    return {
      runtime: optRt,
      runtimesById: changed ? nextRuntimesById : optRuntimesById,
      plans: rslvPlns,
      invalidMainEchoes: nvldMainChs,
    }
  }, [optRt, optRuntimesById, echoPlans])

  const effectRuntime = mateEchoPlan.runtime
  const effectRuntimesById = mateEchoPlan.runtimesById
  const rslvEchoPlns = mateEchoPlan.plans
  const nvldMateMain = mateEchoPlan.invalidMainEchoes

  const clearRun = useCallback(() => {
    clrOptRslts()
    setPageIndex(0)
    setActiveIndex(0)
    setPrvwTrgt({ kind: 'base' })
    setProgress(mkMptyPrgr())
  }, [clrOptRslts])

  useEffect(() => () => {
    disposeOptResources()
  }, [disposeOptResources])

  useLytFfct(() => {
    if (!optRt || optSetsResonatorId === optResId) {
      return
    }

    // The runtime remains canonical scenario state. Only the optimizer's
    // resonator-specific inputs are re-instantiated for the new subject.
    updOptSets(() => optSets, optResId)
    setEchoPlanS({ resonatorId: optResId, plans: mkMptyEchoPl() })
    clearRun()
  }, [clearRun, optResId, optRt, optSets, optSetsResonatorId, updOptSets])

  const openUiModal = useCallback((content: ReactNode) => {
    uiModal.show(content)
  }, [uiModal])

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
        ? `/assets/game/resonators/sprites/${optResId}.webp`
        : `/assets/game/resonators/profiles/${optResId}.webp`
      : '/assets/game/default.webp'

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

  const skillColors = useMemo(
    () => new Map(trgtSkll.map((skill) => [skill.id, skillDisplayColor(skill)])),
    [trgtSkll],
  )

  // Target skill is an optimizer preference, while the available target list
  // belongs to the current canonical runtime. A resonator/scenario switch can
  // therefore leave the persisted preference pointing at the previous
  // resonator for one render. Resolve the effective value synchronously so no
  // consumer can observe an impossible runtime/skill pair.
  const targetSkillId = trgtSkll.some((skill) => skill.id === optSets.targetSkillId)
    ? optSets.targetSkillId
    : trgtSkll[0]?.id ?? null

  const comboOptions: SelectOption[] = (() => {
    if (!effectRuntime) {
      return []
    }

    const options: SelectOption[] = [{
      value: `live:${optResId}`,
      label: `${displayName} · Current Rotation · Live`,
    }]

    for (const entry of invRttn) {
      const resonatorId = savedRotationResonatorId(entry)
      const items = savedRotationItems(entry)
      if (!isRotationSequence(items, resonatorId) || resonatorId !== optResId) {
        continue
      }

      options.push({
        value: `saved:${entry.id}`,
        label: `${seedRsntById[resonatorId]?.name ?? resonatorId} · ${entry.name} · Saved`,
      })
    }

    return options
  })()

  // combo (rotation) optimizer mode only makes sense when there is a rotation
  // with at least one damage feature node, either the live compact rotation
  // or a compatible saved rotation for this resonator. with none, combo mode is
  // hidden and forced back to skill mode below.
  const comboAvailable = useMemo(() => {
    if (!effectRuntime) {
      return false
    }
    if (rotHasFeats(effectRuntime.rotation.sequence)) {
      return true
    }
    return invRttn.some((entry) => (
      savedRotationResonatorId(entry) === optResId &&
      isRotationSequence(savedRotationItems(entry), savedRotationResonatorId(entry)) &&
      rotHasFeats(savedRotationItems(entry))
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
    if (!effectRuntime) {
      return null
    }

    const selSrcId = optSets.targetComboSourceId
    if (!selSrcId) {
      return effectRuntime.rotation.sequence
    }

    if (selSrcId === `live:${optResId}`) {
      return effectRuntime.rotation.sequence
    }

    if (selSrcId.startsWith('saved:')) {
      const rotationId = selSrcId.slice('saved:'.length)
      const saved = invRttn.find((entry) => (
        entry.id === rotationId &&
        savedRotationResonatorId(entry) === optResId &&
        isRotationSequence(savedRotationItems(entry), savedRotationResonatorId(entry))
      ))
      return saved ? savedRotationItems(saved) : null
    }

    return effectRuntime.rotation.sequence
  })()

  useEffect(() => {
    if (comboOptions.length === 0) {
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

  const optBaseInvEchoE = useMemo(() => {
    if (isThryMode) {
      return invEchoEnts
    }

    if (!optSets.excludeEquipped) {
      return invEchoEnts
    }

    return invEchoEnts.filter(({ echo }) => {
      const owners = optInvEchoSg[echo.uid] ?? []
      return !owners.some((owner) => owner.resonatorId !== optResId)
    })
  }, [invEchoEnts, isThryMode, optInvEchoSg, optResId, optSets.excludeEquipped])

  const fltrRuleEcho = useMemo(() => {
    const llwdSetIds = optSetIdSet(optSets.allowedSets)
    const llwdMainStat = new Set(
      optSets.mainStatFilter
        .map((key) => mapMainStatF(key, optSets.selectedBonus))
        .filter((value): value is string => Boolean(value)),
    )

    return optBaseInvEchoE.filter(({ echo }) => {
      if (llwdSetIds.size > 0 && !llwdSetIds.has(echo.set)) {
        return false
      }
      return !(llwdMainStat.size > 0 && !llwdMainStat.has(echo.mainStats.primary.key));
    })
  }, [optBaseInvEchoE, optSets])

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
      runtimesById: effectRuntimesById,
      enemy: enemyProfile,
      selectedTargets: activeTarget,
    })

    return {
      mainStatFilter: [...(ntlSets.mainStatFilter ?? [])],
      selectedBonus: ntlSets.selectedBonus ?? null,
    }
  }, [activeTarget, effectRuntime, effectRuntimesById, enemyProfile])

  const runOptSets = useMemo(() => {
    if (!isThryMode && targetSkillId === optSets.targetSkillId) {
      return optSets
    }

    return {
      ...optSets,
      targetSkillId,
      ...(isThryMode
        ? {
            mainStatFilter: thryMFltr.mainStatFilter,
            selectedBonus: thryMFltr.selectedBonus,
          }
        : {}),
    }
  }, [isThryMode, optSets, targetSkillId, thryMFltr])

  const prepTgtSkll = useMemo(() => {
    const resonatorId = optResId
    const tgtSkllId = targetSkillId
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
      runtimesById: makeRuntimeMap(effectRuntime, effectRuntimesById),
      selectedTargets: activeTarget,
    })
  }, [
    activeTarget,
    effectRuntime,
    effectRuntimesById,
    enemyProfile,
    optResId,
    rotationMode,
    targetSkillId,
  ])

  const optWghtMap = useMemo(() => {
    if (
      !effectRuntime ||
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
  }, [effectRuntime, enemyProfile, prepTgtSkll, rotationMode])

  const optEligibleInvEchoE = useMemo(() => {
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

  const fltrInvEchoE = useMemo(() => {
    if (isThryMode) {
      return optEligibleInvEchoE
    }

    const trackedUids = new Set(optInvSelection.echoUids)
    if (optInvSelection.mode === 'include') {
      return optEligibleInvEchoE.filter(({ echo }) => echo.uid && trackedUids.has(echo.uid))
    }

    if (trackedUids.size === 0) {
      return optEligibleInvEchoE
    }

    return optEligibleInvEchoE.filter(({ echo }) => !echo.uid || !trackedUids.has(echo.uid))
  }, [isThryMode, optEligibleInvEchoE, optInvSelection])

  const fltrComboChs = useMemo(
    () => fltrInvEchoE.map((entry) => entry.echo),
    [fltrInvEchoE],
  )

  const qppdChs = useMemo(
    () => normEchoLdt(effectRuntime?.build.echoes ?? []).filter(
      (echo): echo is EchoInstance => echo != null,
    ),
    [effectRuntime?.build.echoes],
  )

  const shldCntCombo = fltrComboChs.length >= 5
  const rslvComboCnt = useMemo(() => {
    if (isThryMode) {
      if (
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
      optSets.lockedMainEchoId,
      optSets.enableGpu ? 'combinadic' : 'rows',
    )
  }, [
    fltrComboChs,
    effectRuntime,
    isThryMode,
    optSets.enableGpu,
    optSets.lockedMainEchoId,
    runOptSets,
    qppdChs.length,
    rotationMode,
    shldCntCombo,
  ])

  const bslnInput = useMemo<OptStartPay | null>(() => {
    if (
      !effectRuntime ||
      !runOptSets ||
      (!rotationMode && !runOptSets.targetSkillId) ||
      qppdChs.length === 0
    ) {
      return null
    }

    return {
      scenarioId: scenario.id,
      memberId: optimizerMember.id,
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
      runtimesById: effectRuntimesById,
      settings: {
        ...runOptSets,
        searchMode: 'inventory',
      },
      invChs: qppdChs,
      enemyProfile,
      selectedTargets: activeTarget,
      setConds: optSetConds,
      rotTms: rotationMode ? selRotTms : undefined,
    }
  }, [
    activeTarget,
    enemyProfile,
    qppdChs,
    optResId,
    optimizerMember.id,
    scenario.id,
    effectRuntime,
    effectRuntimesById,
    optSetConds,
    runOptSets,
    rotationMode,
    selRotTms,
  ])

  const [baselineEvaluation, setBaselineEvaluation] = useState<{
    input: OptStartPay
    result: { damage: number; stats: OptResultStats | null } | null
  } | null>(null)

  useEffect(() => {
    if (!bslnInput || qppdChs.length === 0) return undefined
    let disposed = false
    let worker: Worker | null = null
    const mainIndex = Math.max(0, qppdChs.findIndex((echo) => echo.mainEcho))
    const timer = window.setTimeout(() => {
      if (disposed) return
      worker = new Worker(
        new URL('@/engine/optimizer/workers/compile.worker.ts', import.meta.url),
        { type: 'module' },
      )
      worker.onmessage = (event: MessageEvent<OptCompOutMs>) => {
        const message = event.data
        if (message.type !== 'baselineDone' || disposed) return
        setBaselineEvaluation({ input: bslnInput, result: message.result })
        worker?.terminate()
        worker = null
      }
      worker.onerror = () => {
        worker?.terminate()
        worker = null
      }
      worker.postMessage({
        type: 'baseline',
        runId: 1,
        payload: bslnInput,
        mainIndex,
        setConds: optSetConds,
      })
    }, 160)

    return () => {
      disposed = true
      window.clearTimeout(timer)
      worker?.terminate()
    }
  }, [bslnInput, optSetConds, qppdChs])

  const bslnVltn = baselineEvaluation?.input === bslnInput
    ? baselineEvaluation.result
    : null

  const baseResult: OptDisplayRow = (() => {
    if (!effectRuntime) {
      return plchRslt()
    }

    const summary = smmrEchoLdt(effectRuntime.build.echoes)
    const baseWeapon = effectRuntime.build.weapon.id
      ? getWpnById(effectRuntime.build.weapon.id)
      : null

    return {
      damage: bslnVltn?.damage ?? 0,
      costs: summary.costs,
      sets: summary.sets,
      mainEchoIcon: summary.mainEchoIcon,
      weaponIcon: baseWeapon?.icon ?? null,
      weaponName: baseWeapon?.name ?? null,
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
  }, [findPreds, findMatches, findPos, jumpToFind])
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
    clpbSrcResId: optResId,
    clipSourceName: displayName,
    currentEchoes: effectRuntime?.build.echoes ?? [],
    onQpEchoAtjg: (echo, slotIndex) => {
      updateScenarioRuntime((curRt) => ({
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
  const prvwSel = useSel({
    surfaceId: `optimizer:${rslvPrvwTgt.kind}`,
    ariaLabel: 'Optimizer echo selection actions',
    noun: { one: 'echo', many: 'echoes' },
    items: prvwSelTms,
    acts: prvwSelCtns,
  })

  const showBasePrvw = useCallback(() => {
    setPrvwTrgt({ kind: 'base' })
  }, [])

  // resolve the searched weapon for a result, if weapon search produced one.
  // raw theory results carry an index into the run's weaponIds; materialized
  // results carry the resolved id directly.
  function rsltWeaponId(index: number): string | null {
    const entry = optResults[index] as
      | { weaponId?: string; weapon?: number }
      | undefined
    if (!entry) {
      return null
    }
    if (typeof entry.weaponId === 'string' && entry.weaponId) {
      return entry.weaponId
    }
    const ids = optResultData && 'weaponIds' in optResultData
      ? (optResultData as { weaponIds?: string[] }).weaponIds
      : undefined
    if (typeof entry.weapon === 'number' && entry.weapon >= 0 && Array.isArray(ids)) {
      return ids[entry.weapon] ?? null
    }
    return null
  }

  function equipPreviewLoadout(
    nextEchoes: Array<EchoInstance | null>,
    resultIndex: number | null,
  ) {
    const weaponId = resultIndex == null ? null : rsltWeaponId(resultIndex)

    // A preview is detached until this explicit commit. Clone it once more at
    // the boundary so later local edits cannot share objects with live state.
    updateScenarioRuntime((runtime) => {
      const equip = weaponId
        ? weaponEquipState(weaponId, runtime.build.weapon.level, weaponSuggests)
        : null
      return {
        ...runtime,
        build: {
          ...runtime.build,
          echoes: cloneEchoLoadout(nextEchoes),
          ...(equip ? { weapon: { ...runtime.build.weapon, ...equip.weapon } } : {}),
        },
        ...(equip
          ? { state: { ...runtime.state, controls: { ...runtime.state.controls, ...equip.controls } } }
          : {}),
      }
    })
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

    equipPreviewLoadout(nextEchoes, index)
  }

  const showRsltPrvw = (index: number) => {
    setActiveIndex(index)
    const orig = origAt(pageStart + index)
    if (orig >= 0) {
      setPrvwTrgt({ kind: 'result', index: orig })
    }
  }

  const showWeapon = isThryMode && optSets.includeWeapons

  const vsblHdrTtls = useMemo(() => {
    const base = rotationMode
      ? HEADER_TITLES.filter((title) => title !== 'Ʃ BNS%' && title !== 'Ʃ AMP%')
      : HEADER_TITLES
    if (!showWeapon) {
      return base
    }
    // insert the weapon column right after "Main", mirroring the row layout
    const mainIdx = base.indexOf('Main')
    const at = mainIdx >= 0 ? mainIdx + 1 : 1
    return [...base.slice(0, at), 'Weapon', ...base.slice(at)]
  }, [rotationMode, showWeapon])

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
    const echoId = optSets.lockedMainEchoId
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
  }, [optSets.lockedMainEchoId])

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
        ? makeOpSlot(optRt, selWpnPckrSl, optRuntimesById)
        : null
    ),
    [optRt, optRuntimesById, selWpnPckrSl],
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

  const selWpnPckrRecs = useMemo(() => {
    if (!selWpnPckrRt) {
      return []
    }

    return seedRsntById[selWpnPckrRt.id]?.recommendedWeaponIds ?? []
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
    if (!selWpn) return

    const memberId = slot === 'active' ? optResId : optRt?.build.team[slot + 1]
    if (!memberId) return

    const update = slot === 'active'
      ? updateScenarioRuntime
      : (updater: (runtime: ResRuntime) => ResRuntime) => updateMemberRuntime(memberId, updater)

    update((prev) => {
      const nextLevel = maxResOnInit ? 90 : prev.build.weapon.level
      const stats = weaponStatsAt(selWpn, nextLevel)
      const runtimeWithWeapon: ResRuntime = {
        ...prev,
        build: {
          ...prev.build,
          weapon: {
            ...prev.build.weapon,
            id: selWpn.id,
            level: nextLevel,
            baseAtk: stats.atk,
            rank: 1,
          },
        },
      }
      const initializedRuntime = maxResOnInit
        ? maxWpnRt(runtimeWithWeapon, { targetRank: 1 })
        : runtimeWithWeapon
      const nextControls = { ...initializedRuntime.state.controls }
      clrWpnSttCnt(nextControls, prev.build.weapon.id)
      applyWpnSttD(nextControls, selWpn.id, '', initializedRuntime, maxResOnInit)
      return {
        ...initializedRuntime,
        state: {
          ...initializedRuntime.state,
          controls: nextControls,
        },
      }
    })

    if (selWpnPckroe) {
      bumpPickerFreq({
        bucket: 'weapon',
        weaponType: selWpnPckroe,
        ids: [selWpn.id],
      })
    }
  }, [
    bumpPickerFreq,
    maxResOnInit,
    optResId,
    optRt,
    selWpnPckroe,
    updateMemberRuntime,
    updateScenarioRuntime,
  ])

  const applyOptMate = useCallback((slotIndex: 0 | 1, resonatorId: string) => {
    setTeamMember(slotIndex + 1, resonatorId)

    setEchoPlans((prev) => {
      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = null
      return next
    })
  }, [setEchoPlans, setTeamMember])

  const addSetPref = useCallback((slotIndex: 0 | 1, setId: number) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex, optRuntimesById) : null
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
  }, [optRt, optRuntimesById, setEchoPlans])

  const rmSetPref = useCallback((slotIndex: 0 | 1, setId: number) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex, optRuntimesById) : null
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
  }, [optRt, optRuntimesById, setEchoPlans])

  const setSetCount = useCallback((slotIndex: 0 | 1, setId: number, count: number) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex, optRuntimesById) : null
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
  }, [optRt, optRuntimesById, setEchoPlans])

  const rmMate = useCallback((slotIndex: 0 | 1) => {
    setTeamMember(slotIndex + 1, null)
    setEchoPlans((prev) => {
      const next = [...prev] as [EchoPlan | null, EchoPlan | null]
      next[slotIndex] = null
      return next
    })
  }, [setEchoPlans, setTeamMember])

  const rmMateMainEc = useCallback((slotIndex: 0 | 1) => {
    setEchoPlans((prev) => {
      const memRt = optRt ? makeOpSlot(optRt, slotIndex, optRuntimesById) : null
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
  }, [optRt, optRuntimesById, setEchoPlans])

  const openResPckr = useCallback((slot: OpSlot = 'active') => {
    resPckr.show(slot)
  }, [resPckr])

  const clsResPckr = (onClosed?: () => void) => {
    resPckr.hide(onClosed)
  }

  const openWpnPckr = (slot: OpSlot) => {
    weaponPicker.show(slot)
  }

  const clsWpnPckr = (onClosed?: () => void) => {
    weaponPicker.hide(onClosed)
  }

  const openMainEcho = (target: OpEchoTarget = 'filter') => {
    mainEchoPckr.show(target)
  }

  const clsMainEchoP = () => {
    mainEchoPckr.hide(mainEchoSession.finish)
  }

  const mainEchoPiece = mainEchoPckr.value ?? 'filter'
  const selMainEchoI = mainEchoPiece === 'filter'
    ? mainEchoSession.draft.lockedMainEchoId
    : rslvEchoPlns[mainEchoPiece]?.mainEchoId ?? null

  const isLoading = optStts === 'running'
  const success = optStts === 'done'
  const cancelled = optStts === 'cancelled'

  const onRunOpt = useCallback(() => {
    if (!optRt) {
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
      scenarioId: scenario.id,
      memberId: optimizerMember.id,
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
      runtime: optRt,
      runtimesById: effectRuntimesById,
      settings: runOptSets,
      invChs: fltrInvEchoE.map((entry) => entry.echo),
      enemyProfile,
      selectedTargets: activeTarget,
      setConds: optSetConds,
      rotTms: selRotTms,
      weaponPlan: weaponSuggests,
    }, {
      onProgress: (nextProgress) => {
        setProgress(nextProgress)
      },
      settle: () => settleBand(bandRef.current),
    })
  }, [
    activeTarget,
    enemyProfile,
    effectRuntimesById,
    fltrInvEchoE,
    openUiModal,
    optCpuHintSe,
    optSetConds,
    optResId,
    optRt,
    optimizerMember.id,
    runOptSets,
    scenario.id,
    selRotTms,
    setOptCpuHin,
    showBasePrvw,
    startOpt,
    weaponSuggests,
  ])

  const onTgtModeChn = useCallback((value: 'skill' | 'combo') => {
    const nextRotMode = value === 'combo'
    updOptSets((settings) => ({
      ...settings,
      targetMode: value,
      rotationMode: nextRotMode,
    }))
    if (rotationMode !== nextRotMode) {
      clearRun()
    }
  }, [clearRun, rotationMode, updOptSets])

  const handleHalt = useCallback(() => {
    cnclOpt()
  }, [cnclOpt])

  const optCtxMenuTm = useMemo(() => getOptCtx({
    pane: menu.simulation.optimizer.pane,
    targetMode,
    skillGroups,
    comboOptions,
    tgtSkllId: targetSkillId,
    tgtCmbId: optSets.targetComboSourceId,
    enableGpu: optSets.enableGpu,
    comboAvailable,
    isSprite,
    isLoading,
    pending: isThryMode,
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
    onRun: onRunOpt,
    onHalt: handleHalt,
    onClear: clearRun,
  }), [
    comboOptions,
    comboAvailable,
    handleHalt,
    onRunOpt,
    onTgtModeChn,
    isThryMode,
    isLoading,
    isSprite,
    menu.simulation.optimizer,
    openResPckr,
    optSets.enableGpu,
    optSets.targetComboSourceId,
    targetSkillId,
    clearRun,
    setIsSprite,
    skillGroups,
    targetMode,
    updOptSets,
  ])

  function handleEquip() {
    if (isLoading || !optResults[actRsltNdx]) {
      return
    }

    applyOptRslt(actRsltNdx)
  }

  const controlProps = {
    isLoading,
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
      ? rslvComboCnt.toLocaleString()
      : '0',
    batchSize: optBtchSize,
    resultsLimit: optSets.resultsLimit,
    keepPercent: optSets.keepPercent,
    lowMmryMode: optSets.lowMemoryMode,
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
    onHalt: handleHalt,
    onEquip: handleEquip,
    onGuide: () => {
      navigate('/guides?category=optimizer')
    },
    onRules: openRlsMdl,
    onClear: clearRun,
  }

  const resultToolbar = !isLoading && optResults.length > 0 ? (
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
  ) : null

  const resultsTable = (
    <div className="results-container" data-mode={targetMode} data-weapon={showWeapon ? '1' : undefined}>
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
            showWeapon={showWeapon}
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
                  showWeapon={showWeapon}
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
                  <button className="opt-pagination__btn opt-pagination__btn--subtle"
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
                          ref={jumpInputRef} className="opt-pagination__jump"
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
                            // Blur cancels an empty draft and commits a populated one.
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
                          type="button" className="opt-pagination__ellipsis"
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

                  <button className="opt-pagination__btn opt-pagination__btn--subtle"
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
  )

  const echoPreview = (
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
  )



  const labEditable = !isLoading
  const previewKey = rslvPrvwTgt.kind === 'result'
    ? `${optResId}:result:${rslvPrvwTgt.index}`
    : `${optResId}:base`

  // Theory search obtains its exact candidate count from worker progress,
  // unlike inventory mode's precomputed combination count.
  const stagePermutations = isThryMode
    ? ((progress.total ?? 0) > 0 ? Math.floor(progress.total ?? 0).toLocaleString() : null)
    : shldCntCombo
      ? rslvComboCnt.toLocaleString()
      : '0'

  const resultsOnBoard = !isLoading && optResults.length > 0

  const labSurface = (
    <OptimizerLab
      resonatorId={optResId}
      resonatorName={displayName}
      runtime={effectRuntime}
      previewKey={previewKey}
      previewEchoes={echoes}
      bandFolded={resultsOnBoard}
      bandRef={bandRef}
      editable={labEditable}
      onEquipPreview={(previewEchoes) => equipPreviewLoadout(
        previewEchoes,
        rslvPrvwTgt.kind === 'result' ? rslvPrvwTgt.index : null,
      )}
    >
      <div className="opb-surface rte-scope">
        {resultsOnBoard ? (
          <div className="opb-results">
            {resultToolbar}
            {resultsTable}
          </div>
        ) : (
          <OptStage
            isLoading={isLoading}
            progress={progress}
            cancelled={cancelled}
            success={success}
            permutations={stagePermutations}
            batchSize={optBtchSize}
            isTheory={isThryMode}
            resultCount={resultLength}
          />
        )}

        <OptTransport
          isLoading={isLoading}
          progress={progress}
          cancelled={cancelled}
          success={success}
          echoCount={isThryMode ? qppdChs.length : fltrInvEchoE.length}
          resultCount={resultLength}
          batchSize={optBtchSize}
          searchMode={optMode}
          targetMode={targetMode}
          comboAvailable={comboAvailable}
          skillOptions={skillOptions}
          skillGroups={skillGroups}
          skillColors={skillColors}
          comboOptions={comboOptions}
          targetSkillId={targetSkillId}
          targetComboId={optSets.targetComboSourceId}
          mainEcho={selMainEchoF}
          allowedSets={optSets.allowedSets}
          mainStatFilter={isThryMode ? thryMFltr.mainStatFilter : optSets.mainStatFilter}
          selectedBonus={isThryMode ? thryMFltr.selectedBonus : optSets.selectedBonus}
          excludeEquipped={optSets.excludeEquipped}
          includeWeapons={optSets.includeWeapons}
          keepPercent={optSets.keepPercent}
          inventoryExcluded={optInvSelection.echoUids.length}
          inventoryMode={optInvSelection.mode}
          setConds={optSetConds}
          weaponPlan={weaponSuggests}
          statConstraints={optSets.statConstraints}
          resultsLimit={optSets.resultsLimit}
          enableGpu={optSets.enableGpu}
          lowMemoryMode={optSets.lowMemoryMode}
          onRun={onRunOpt}
          onHalt={handleHalt}
          onClear={clearRun}
          onConfig={(config) => {
            const nextRotationMode = config.targetMode === 'combo'
            updOptSets((settings) => ({
              ...settings,
              ...config,
              rotationMode: nextRotationMode,
            }))
            if (rotationMode !== nextRotationMode) clearRun()
          }}
          onOpenMainEcho={() => openMainEcho()}
          onClearMainEcho={() => updOptSets((settings) => ({ ...settings, lockedMainEchoId: null }))}
          onOpenInventorySearch={optInvMdl.show}
          onOpenSetCond={setCondsMdl.show}
          onOpenWeaponCond={wpnCondMdl.show}
          onGuide={() => navigate('/guides?category=optimizer')}
          onRules={openRlsMdl}
        />
      </div>
    </OptimizerLab>
  )


  return (
    <div className={variant === 'legacy' ? 'calculator-stage' : 'opt-host'}>
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
        <Rules onClose={clsRlsMdl} />
      </AppModal>

      <SetCond
        {...setCondsMdl}
        portalTarget={mdlPrtlTgt}
        onClose={setCondsMdl.hide}
        title="Sonata Set Config"
        setConds={optSetConds}
        onSetCondsrx={(updater) => updResSetCon(optResId, updater)}
      />

      <WpnCfgMdl
        {...wpnCondMdl}
        title="Config - Weapon Search"
        onClose={wpnCondMdl.hide}
        runtime={effectRuntime}
        seed={activeSeed}
        lockMaxMode
      />

      {variant === 'embedded' ? labSurface : (
        <ContextTrigger
          asChild
          ariaLabel="Optimizer actions"
          items={optCtxMenuTm}
        >
          <div className={`optimizer-pane ${isWide ? '' : 'compact'}`}>
            {isWide ? <ControlBox isWide {...controlProps} /> : null}

            <div className="optimizer-details">
            <Expandable
              header="Optimizer Settings"
              defaultOpen className="optimizer-character-settings"
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
                  tgtSkllId={targetSkillId}
                  tgtCmbId={optSets.targetComboSourceId}
                  skillOptions={skillOptions}
                  skillGroups={skillGroups}
                  comboOptions={comboOptions}
                  enableGpu={optSets.enableGpu}
                  comboAvailable={comboAvailable}
                  useSplash={isSprite}
                  mainEcho={selMainEchoF}
                  allowedSets={optSets.allowedSets}
                  mainStatFilter={isThryMode ? thryMFltr.mainStatFilter : optSets.mainStatFilter}
                  isTheory={isThryMode}
                  excludeEquipped={optSets.excludeEquipped}
                  includeWeapons={optSets.includeWeapons}
                  selBonus={isThryMode ? thryMFltr.selectedBonus : optSets.selectedBonus}
                  statCstrs={optSets.statConstraints}
                  optRt={optRt}
                  onOpenResPick={() => openResPckr('active')}
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
                  onOptRtPdt={updateScenarioRuntime}
                  onOpenMainEcho={openMainEcho}
                  onOpenInventorySearch={optInvMdl.show}
                  onOpenSetCond={setCondsMdl.show}
                  onOpenWpnCond={wpnCondMdl.show}
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
                  onToggleExcludeEquipped={(value) => {
                    updOptSets((settings) => ({
                      ...settings,
                      excludeEquipped: value,
                    }))
                  }}
                  onToggleWeapons={(value) => {
                    updOptSets((settings) => ({
                      ...settings,
                      includeWeapons: value,
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
                  runtimesById={effectRuntimesById}
                  invalidMainIds={nvldMateMain}
                  mateSetPrefs={[
                    rslvEchoPlns[0]?.setPrefs ?? [],
                    rslvEchoPlns[1]?.setPrefs ?? [],
                  ]}
                  onRtPdt={updateScenarioRuntime}
                  onMemberRtPdt={updateMemberRuntime}
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
              {resultToolbar}
              {resultsTable}
              {echoPreview}
              </Expandable>
              {!isWide ? <ControlBox isWide={false} {...controlProps} /> : null}
            </div>
          </div>
        </ContextTrigger>
      )}

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
            mainEchoSession.update((settings) => ({
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
            const memRt = optRt ? makeOpSlot(optRt, mainEchoPiece, optRuntimesById) : null
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
            mainEchoSession.update((settings) => ({
              ...settings,
              lockedMainEchoId: null,
            }))
            return
          }

          setEchoPlans((prev) => {
            const memRt = optRt ? makeOpSlot(optRt, mainEchoPiece, optRuntimesById) : null
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

      <OptimizerInventoryModal
        visible={optInvMdl.visible}
        open={optInvMdl.open}
        closing={optInvMdl.closing}
        invChs={optEligibleInvEchoE}
        echoSgByUid={optInvEchoSg}
        selection={optInvSelection}
        onSelectionChange={(updater) => updResOptInv(optResId, updater)}
        onClose={optInvMdl.hide}
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
              ? optResId
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
          clsResPckr(() => {
            if (resPickerSlot === null || resPickerSlot === 'active') {
              selectOptimizerResonator(resonatorId)
            } else {
              applyOptMate(resPickerSlot, resonatorId)
            }
          })
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
        recommendedWeaponIds={selWpnPckrRecs}
        onSelect={(weaponId) => {
          if (selWpnPckrSl === null) {
            return
          }
          clsWpnPckr(() => applyOptWpnS(selWpnPckrSl, weaponId))
        }}
        onClose={clsWpnPckr}
      />
    </div>
  )
}

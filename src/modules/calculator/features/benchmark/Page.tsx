import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/domain/state/store.ts'
import {
  selActResId,
  selVrvwDrvd,
} from '@/domain/state/selectors.ts'
import { seedRsntById } from '@/modules/calculator/features/resonator/lib/seedData.ts'
import { getResonator, spriteVars } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { getWpnById } from '@/domain/services/weaponCatalogService'
import { getEchoById } from '@/domain/services/echoCatalogService'
import type { EchoInstance } from '@/domain/entities/runtime'
import { isNoWeaponId } from '@/domain/entities/runtime'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getWpnVisKey } from '@/modules/calculator/features/benchmark/weaponVisual.ts'
import { useEchoSrfcM } from '@/modules/calculator/features/echoes/lib/useEchoSurfaceMenu.tsx'
import { qpEchoAtSlot } from '@/modules/calculator/features/echoes/lib/equip.ts'
import {
  copyBuildCard,
  downloadBuildCard,
  renderBuildCardPng,
} from '@/modules/calculator/features/benchmark/captureBuildCard.ts'
import { ATTR_COLORS } from '@/modules/calculator/model/display'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import type { BenchRptSettings, BenchmarkViewMode } from '@/domain/entities/preferences'
import { DEF_BENCH_CARD_STYLE, DEF_BENCH_HIDE } from '@/domain/entities/preferences'
import { useBenchShowcase, useBenchReport } from '@/modules/calculator/model/useBuildBenchmark.ts'
import { useBenchTarget } from '@/modules/calculator/model/useBenchTarget.ts'
import {
  applyBenchAsm,
  applyBenchMapAsm,
  BENCH_ENEMY,
} from '@/modules/calculator/model/benchmarkAssumptions.ts'
import { nextResonatorSelection } from '@/modules/calculator/model/resonatorProfileActions.ts'
import {
  getBuildBenchmarkGrade,
  getBuildBenchmarkTone,
} from '@/modules/calculator/model/buildBenchmarkDisplay.ts'
import { makeStatsTree, makeStatsView } from '@/modules/calculator/model/statsView.ts'
import { getMaxEchoSc } from '@/data/scoring/echoScoring.ts'
import { getBuildStats } from '@/engine/pipeline/buildStats.ts'
import { resResBaseSt } from '@/domain/services/resonatorSeedService.ts'
import { useAppModal } from '@/shared/ui/useAppModal'
import { useMediaQuery } from '@/app/hooks/useMediaQuery'
import { ImageUploadModal } from '@/shared/ui/ImageUploadModal'
import { resolveImageRef } from '@/shared/lib/imageUpload.ts'
import type { StoredImage } from '@/shared/lib/imageUpload.ts'
import { toTitle } from '@/shared/lib/format'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useCnfr } from '@/app/hooks/useConfirmation.ts'
import { mainPortal } from '@/shared/lib/portalTarget'
import { CnfrMdl } from '@/shared/ui/ConfirmationModal'
import type { BenchmarkBuildSnapshot, BenchmarkEchoSlot } from '@/data/scoring/buildBenchmark.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import { Copy, Scissors, Trash2 } from 'lucide-react'
import { useSel } from '@/modules/calculator/lib/sel.tsx'
import {
  makeProfileClip,
  readProfClip,
  writeProfClip,
} from '@/modules/calculator/features/benchmark/profileClipboard.ts'

import {
  BENCH_RAIL_ENTER_MS, BENCH_RAIL_EXIT_MS, BENCH_RAIL_RESIZE_MS,
  BENCH_SURFACE_ENTER_MS, BENCH_SURFACE_EXIT_MS, type BenchmarkEchoSelection, type CssVars, type DetailBuildKey,
  buildSonataPlan, getBenchmarkSpinePlacement,
  preloadBenchmarkRailImages, scheduleBenchmarkTargetWork,
} from './ui.tsx'
import { BenchCssEditorDock, BenchCustomizePanel } from './Customize.tsx'
import { buildTextSlotVars, collectCardFontFamilies, splitHoistedCss } from './cardStyleVars.ts'
import { buildCardExport, parseCardImport, type CardExportTarget } from './cardTransfer.ts'
import { ensGglFamilyByName } from '@/modules/settings/model/typography.ts'
import {
  BenchmarkResonatorRail, type BenchmarkRosterEntry, type BenchAttrGroup,
} from './ResonatorRail.tsx'
import { BenchmarkToolbar } from './Toolbar.tsx'
import { RailCard, type RailCardModel } from './RailCard.tsx'
import { MainReport } from './MainReport.tsx'
import { ReportSettingsModal } from './ReportSettings.tsx'
import { NarrowBenchmarkBanner } from './NarrowBanner.tsx'
import { getBenchStageCtx, getBenchTargetCtx } from './context.tsx'

const EMPTY_ECHO_LOADOUT: Array<EchoInstance | null> = []

function roundEchoStat(value: number): number {
  return Math.round(value * 1000) / 1000
}

function makeEchoSlot(echo: EchoInstance): BenchmarkEchoSlot {
  const definition = getEchoById(echo.id)
  const setId = echo.set
  return {
    echoId: echo.id,
    echoName: definition?.name ?? echo.id,
    cost: definition?.cost ?? 0,
    mainEcho: echo.mainEcho,
    setId,
    setName: setId > 0 ? getSntSetNam(setId) : 'No set',
    primary: {
      key: echo.mainStats.primary.key,
      value: roundEchoStat(echo.mainStats.primary.value),
    },
    secondary: {
      key: echo.mainStats.secondary.key,
      value: roundEchoStat(echo.mainStats.secondary.value),
    },
    equippedSubstats: Object.entries(echo.substats)
      .map(([key, value]) => ({ key, value: roundEchoStat(value) }))
      .sort((left, right) => right.value - left.value),
  }
}

export function Benchmark() {
  const navigate = useNavigate()
  const showToast = useTstStr((state) => state.show)
  const confirmation = useCnfr()
  const portalTarget = mainPortal()
  const [detailBuildKey, setDetailBuildKey] = useState<DetailBuildKey>('active')
  const actResId = useAppStore(selActResId)
  const showAllStates = useAppStore((state) => state.ui.preferences.showBenchStates)
  const viewMode = useAppStore((state) => state.ui.preferences.benchmarkViewMode)
  const reportSettings = useAppStore((state) => state.ui.preferences.benchRptSettings)
  const themeMode = useAppStore((state) => state.ui.theme)
  const backgroundTextMode = useAppStore((state) => state.ui.backgroundTextMode)
  const isDarkTheme = themeMode === 'background' ? backgroundTextMode === 'dark' : themeMode === 'dark'
  const animatedPortraits = useAppStore((state) => state.ui.preferences.benchAnim2d)
  const entranceAnimations = useAppStore((state) => state.ui.entranceAnimations)
  const profilesById = useAppStore((state) => state.calculator.profiles)
  const { actRt: runtime, partRtsById, initRtsById } = useAppStore(selVrvwDrvd)
  const swapResonator = useAppStore((state) => state.swRes)
  const deleteResonatorProfiles = useAppStore((state) => state.delResProfs)
  const upsertResonatorProfiles = useAppStore((state) => state.upsertRes)
  const updateResonatorRuntime = useAppStore((state) => state.updResRt)
  const setViewMode = useAppStore((state) => state.setBenchView)
  const setAnimatedPortraits = useAppStore((state) => state.setBench2d)
  const patchReportSettings = useAppStore((state) => state.patchBenchRpt)
  const [selectedResId, setSelectedResId] = useState<string | null>(actResId)
  const [reportTargetResId, setReportTargetResId] = useState<string | null>(actResId)
  const [railResId, setRailResId] = useState<string | null>(actResId)
  const [railPhase, setRailPhase] = useState<'idle' | 'out' | 'in'>('idle')
  const isShowcase = viewMode === 'showcase'
  // Below 80rem the non-showcase score meter becomes a portrait banner (the rail
  // hides; the portrait + art ride along as the band's backdrop layers).
  const isNarrow = useMediaQuery('(max-width: 80rem)')
  const [surfacePhase, setSurfacePhase] = useState<'idle' | 'out' | 'in'>('idle')
  const [captureAction, setCaptureAction] = useState<'download' | 'clipboard' | null>(null)
  // Showcase-card customization is persisted per resonator under ui preferences,
  // so each resonator keeps its own colours/fonts/mask/offsets and uploaded images
  // (stored as imgur URLs) across reloads.
  const benchmarkCards = useAppStore((state) => state.ui.preferences.benchmarkCards)
  const patchBenchCardStyle = useAppStore((state) => state.patchBenchCardStyle)
  const toggleBenchHide = useAppStore((state) => state.toggleBenchHide)
  const patchBenchCardHidden = useAppStore((state) => state.patchBenchCardHidden)
  const resetBenchCard = useAppStore((state) => state.resetBenchCard)
  const cardConfig = (railResId && benchmarkCards[railResId]) || null
  const cardStyle = cardConfig?.style ?? DEF_BENCH_CARD_STYLE
  const cardHidden = cardConfig?.hidden ?? DEF_BENCH_HIDE
  const [tuneResetKey, setTuneResetKey] = useState(0)
  const [editMode, setEditMode] = useState<'portrait' | 'backdrop' | null>(null)
  // Expanded Custom CSS editing: the editor docks into the roster-rail slot and the
  // customize panel slides over as a drawer. Only meaningful in showcase mode.
  const [cssExpanded, setCssExpanded] = useState(false)
  const [tuneDrawerOpen, setTuneDrawerOpen] = useState(false)
  // Session-only uploads live here (per resonator), never written to the store.
  const [sessionImages, setSessionImages] = useState<Record<string, { portrait?: string; backdrop?: string }>>({})
  const [uploadTarget, setUploadTarget] = useState<'portrait' | 'backdrop'>('portrait')
  const uploadModal = useAppModal()
  const reportSettingsModal = useAppModal()
  // Effective image refs: a session upload overrides the persisted one; both may
  // be a hosted/data url or an `upload:` IndexedDB key that resolves to an object url.
  const sessionForRail = railResId ? sessionImages[railResId] : undefined
  const portraitRef = sessionForRail?.portrait ?? cardStyle.portraitImage
  const backdropRef = sessionForRail?.backdrop ?? cardStyle.backdropImage
  // URL/data refs resolve synchronously so the image tracks the resonator switch
  // in lockstep (no stale frame); only `upload:` IndexedDB blobs need an async
  // load, cached here and resolved to a usable url once ready.
  const [idbImageUrls, setIdbImageUrls] = useState<Record<string, string>>({})
  const idbImageUrlsRef = useRef(idbImageUrls)
  idbImageUrlsRef.current = idbImageUrls
  const resolveRefSync = useCallback(
    (ref: string | null): string | null => {
      if (!ref) return null
      if (ref.startsWith('upload:')) return idbImageUrls[ref] ?? null
      return ref
    },
    [idbImageUrls],
  )
  const resolvedPortrait = resolveRefSync(portraitRef)
  const resolvedBackdrop = resolveRefSync(backdropRef)

  useEffect(() => {
    const pending = [portraitRef, backdropRef].filter(
      (ref): ref is string => !!ref && ref.startsWith('upload:') && !idbImageUrlsRef.current[ref],
    )
    if (pending.length === 0) return undefined
    let cancelled = false
    void Promise.all(
      pending.map(async (ref) => [ref, (await resolveImageRef(ref))?.url] as const),
    ).then((pairs) => {
      if (cancelled) return
      setIdbImageUrls((prev) => {
        const next = { ...prev }
        for (const [ref, url] of pairs) if (url) next[ref] = url
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [portraitRef, backdropRef])

  useEffect(() => () => {
    for (const url of Object.values(idbImageUrlsRef.current)) URL.revokeObjectURL(url)
  }, [])

  const handlePickImage = useCallback((target: 'portrait' | 'backdrop') => {
    setUploadTarget(target)
    uploadModal.show()
  }, [uploadModal])

  const handleApplyImage = useCallback((result: StoredImage, credit: string) => {
    if (!railResId) return
    const creditValue = credit.trim() || null
    const creditPatch = uploadTarget === 'portrait'
      ? { portraitCredit: creditValue }
      : { backdropCredit: creditValue }
    if (result.persisted) {
      patchBenchCardStyle(
        railResId,
        uploadTarget === 'portrait'
          ? { portraitImage: result.ref, ...creditPatch }
          : { backdropImage: result.ref, ...creditPatch },
      )
      setSessionImages((prev) => {
        const current = prev[railResId]
        if (!current) return prev
        return { ...prev, [railResId]: { ...current, [uploadTarget]: undefined } }
      })
    } else {
      // Session-only image: the ref isn't persisted, but the credit text still is.
      patchBenchCardStyle(railResId, creditPatch)
      setSessionImages((prev) => ({
        ...prev,
        [railResId]: { ...prev[railResId], [uploadTarget]: result.ref },
      }))
    }
    // Drop the user straight into framing controls for the group they just changed.
    setEditMode(uploadTarget)
  }, [railResId, uploadTarget, patchBenchCardStyle])

  // Reset just one image group (image + credit + framing) back to defaults.
  const handleResetGroup = useCallback((group: 'portrait' | 'backdrop') => {
    if (!railResId) return
    if (group === 'portrait') {
      patchBenchCardStyle(railResId, {
        portraitImage: null,
        portraitCredit: null,
        portraitX: null,
        portraitY: null,
        portraitScale: null,
        maskTop: null,
        maskRight: null,
        maskBottom: null,
        maskLeft: null,
        maskTopSharp: null,
        maskRightSharp: null,
        maskBottomSharp: null,
        maskLeftSharp: null,
      })
      patchBenchCardHidden(railResId, { portraitCredit: false })
    } else {
      patchBenchCardStyle(railResId, {
        backdropImage: null,
        backdropCredit: null,
        backdropX: null,
        backdropY: null,
        backdropScale: null,
        backdropBlur: null,
        backdropOpacity: null,
      })
      patchBenchCardHidden(railResId, { backdropCredit: false })
    }
    setSessionImages((prev) => {
      const current = prev[railResId]
      if (!current) return prev
      return { ...prev, [railResId]: { ...current, [group]: undefined } }
    })
    setEditMode(null)
  }, [railResId, patchBenchCardStyle, patchBenchCardHidden])

  const handleExportTarget = useCallback((target: CardExportTarget) => {
    const { raw, filename, mime } = buildCardExport(target, cardStyle, cardHidden)
    const blob = new Blob([raw], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }, [cardStyle, cardHidden])

  const handleImportFile = useCallback(async (file: File) => {
    if (!railResId) return
    try {
      const result = parseCardImport(file.name, await file.text())
      if (result.stylePatch) patchBenchCardStyle(railResId, result.stylePatch)
      if (result.hiddenPatch) patchBenchCardHidden(railResId, result.hiddenPatch)
      showToast({ content: `Imported ${result.label}.`, variant: 'success' })
    } catch (error) {
      showToast({ content: error instanceof Error ? error.message : 'That card file could not be imported.', variant: 'error' })
    }
  }, [railResId, patchBenchCardStyle, patchBenchCardHidden, showToast])
  const railResIdRef = useRef<string | null>(actResId)
  const viewModeRef = useRef<BenchmarkViewMode>(viewMode)
  const surfacePhaseRef = useRef<'idle' | 'out' | 'in'>('idle')
  const surfaceTimersRef = useRef<number[]>([])
  const buildCardRef = useRef<HTMLElement | null>(null)
  const boardRef = useRef<HTMLDivElement | null>(null)
  const mainStackRef = useRef<HTMLDivElement | null>(null)

  const roster = useMemo<BenchmarkRosterEntry[]>(() => {
    return Object.entries(initRtsById)
      .map(([id, rosterRt]) => {
        const res = getResonator(id)
        const attribute = res?.attribute ?? 'aero'
        return {
          id,
          name: res?.name ?? toTitle(id),
          profile: res?.profile ?? res?.sprite ?? '/assets/default.webp',
          sprite: res?.sprite ?? res?.profile ?? '/assets/default.webp',
          spriteCss: spriteVars(res),
          attribute,
          accent: ATTR_COLORS[attribute] ?? '#6b7cff',
          level: rosterRt.base.level ?? 1,
          sequence: rosterRt.base.sequence ?? 0,
        }
      })
      .sort((a, b) =>
        a.attribute === b.attribute ? a.name.localeCompare(b.name) : a.attribute.localeCompare(b.attribute),
      )
  }, [initRtsById])

  const rosterById = useMemo(
    () => new Map(roster.map((entry) => [entry.id, entry])),
    [roster],
  )

  const nextSelectionAfterDelete = useCallback((removedIds: string[]) => (
    nextResonatorSelection(roster, selectedResId, removedIds)
  ), [roster, selectedResId])

  const makeClipboardEntries = useCallback((resonatorIds: string[]) => (
    resonatorIds.flatMap((resonatorId) => {
      const entry = rosterById.get(resonatorId)
      const profile = profilesById[resonatorId]
      if (!entry || !profile) return []
      return [{
        resonatorId,
        resonatorName: entry.name,
        profile,
      }]
    })
  ), [profilesById, rosterById])

  const copyResonatorProfiles = useCallback(async (resonatorIds: string[]) => {
    const entries = makeClipboardEntries(resonatorIds)
    if (entries.length === 0) {
      showToast({
        content: 'Nothing to copy yet.',
        variant: 'default',
        duration: 2200,
      })
      return false
    }

    const wrote = await writeProfClip(makeProfileClip(entries))
    showToast({
      content: wrote
        ? `Copied ${entries.length} resonator profile${entries.length === 1 ? '' : 's'}.`
        : 'Clipboard write failed.',
      variant: wrote ? 'success' : 'error',
      duration: wrote ? 2200 : 2600,
    })
    return wrote
  }, [makeClipboardEntries, showToast])

  const deleteResonatorProfilesWithConfirm = useCallback((
    resonatorIds: string[],
    options: {
      title?: string
      message?: string
      confirmLabel?: string
      successMessage?: string
    } = {},
  ) => {
    const ids = resonatorIds.filter((id, index, list) => rosterById.has(id) && list.indexOf(id) === index)
    if (ids.length === 0) return

    const removed = ids
      .map((id) => rosterById.get(id))
      .filter((entry): entry is BenchmarkRosterEntry => Boolean(entry))
    const nextId = nextSelectionAfterDelete(ids)
    confirmation.confirm({
      title: options.title ?? (ids.length === 1 ? 'Delete this resonator profile?' : `Delete ${ids.length} resonator profiles?`),
      message: options.message ?? (
        ids.length === 1
          ? `${removed[0]?.name ?? 'This resonator'}'s saved calculator state will be removed from benchmark. inventory items stay intact.`
          : 'These saved calculator profiles will be removed from benchmark. inventory items stay intact.'
      ),
      confirmLabel: options.confirmLabel ?? 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: () => {
        deleteResonatorProfiles(ids, nextId)
        setSelectedResId(nextId)
        showToast({
          content: options.successMessage ?? (
            ids.length === 1
              ? `${removed[0]?.name ?? 'Resonator'} removed from benchmark.`
              : `Removed ${ids.length} resonator profiles from benchmark.`
          ),
          variant: 'success',
          duration: 3000,
        })
      },
    })
  }, [confirmation, deleteResonatorProfiles, nextSelectionAfterDelete, rosterById, showToast])

  const pasteResonatorProfiles = useCallback(async () => {
    const payload = await readProfClip()
    if (!payload) {
      showToast({
        content: 'Clipboard does not contain a resonator profile.',
        variant: 'default',
        duration: 2400,
      })
      return
    }

    const overwrites = payload.profiles.filter((entry) => Boolean(profilesById[entry.resonatorId]))
    const addedCount = payload.profiles.length - overwrites.length
    const applyPaste = () => {
      upsertResonatorProfiles(
        payload.profiles.map((entry) => entry.profile),
        payload.profiles.length === 1 ? 'Pasted Resonator Profile' : 'Pasted Resonator Profiles',
      )
      const firstId = payload.profiles[0]?.resonatorId
      if (firstId) setSelectedResId(firstId)
      showToast({
        content: overwrites.length > 0
          ? `Pasted ${payload.profiles.length} resonator profile${payload.profiles.length === 1 ? '' : 's'} (${overwrites.length} overwritten${addedCount > 0 ? `, ${addedCount} added` : ''}).`
          : `Pasted ${payload.profiles.length} resonator profile${payload.profiles.length === 1 ? '' : 's'}.`,
        variant: 'success',
        duration: 3000,
      })
    }

    if (overwrites.length === 0) {
      applyPaste()
      return
    }

    confirmation.confirm({
      title: overwrites.length === 1
        ? `Overwrite ${overwrites[0]?.resonatorName ?? 'this resonator'}?`
        : `Overwrite ${overwrites.length} resonator profiles?`,
      message: overwrites.length === 1
        ? `${overwrites[0]?.resonatorName ?? 'This resonator'} already exists in benchmark. pasting will replace its saved calculator state.`
        : 'Some resonators in the clipboard already exist in benchmark. pasting will replace their saved calculator state.',
      confirmLabel: 'Overwrite',
      cancelLabel: 'Cancel',
      variant: 'danger',
      onConfirm: applyPaste,
    })
  }, [confirmation, profilesById, showToast, upsertResonatorProfiles])

  const rosterSelectionItems = useMemo(
    () => roster.map(({ id }) => ({ id })),
    [roster],
  )

  const rosterSelectionActions = useMemo(() => [
    {
      id: 'benchmark-res:copy',
      key: 'copy' as const,
      needsSel: true,
      icon: <Copy size={14} />,
      label: ({ count }: { count: number }) => `Copy (${count})`,
      title: 'Copy selected resonators (Ctrl/Cmd+C)',
      run: async ({ ids }: { ids: string[] }) => {
        await copyResonatorProfiles(ids)
      },
    },
    {
      id: 'benchmark-res:cut',
      key: 'cut' as const,
      needsSel: true,
      icon: <Scissors size={14} />,
      label: ({ count }: { count: number }) => `Cut (${count})`,
      title: 'Cut selected resonators (Ctrl/Cmd+X)',
      run: async ({ ids }: { ids: string[] }) => {
        const wrote = await copyResonatorProfiles(ids)
        if (!wrote) return
        deleteResonatorProfilesWithConfirm(ids, {
          title: ids.length === 1 ? 'Cut this resonator profile?' : `Cut ${ids.length} resonator profiles?`,
          message: ids.length === 1
            ? 'The profile was copied to the clipboard. deleting it here will remove it from benchmark.'
            : 'These profiles were copied to the clipboard. deleting them here will remove them from benchmark.',
          confirmLabel: 'Cut',
          successMessage: ids.length === 1
            ? 'Resonator profile cut to clipboard.'
            : `Cut ${ids.length} resonator profiles to clipboard.`,
        })
      },
    },
    {
      id: 'benchmark-res:delete',
      key: 'delete' as const,
      needsSel: true,
      icon: <Trash2 size={14} />,
      danger: true,
      label: ({ count }: { count: number }) => `Delete (${count})`,
      title: 'Delete selected resonators (Delete)',
      run: ({ ids }: { ids: string[] }) => {
        deleteResonatorProfilesWithConfirm(ids)
      },
    },
    {
      id: 'benchmark-res:paste',
      key: 'paste' as const,
      float: false,
      label: 'Paste',
      run: () => {
        void pasteResonatorProfiles()
      },
    },
  ], [copyResonatorProfiles, deleteResonatorProfilesWithConfirm, pasteResonatorProfiles])

  const rosterSelection = useSel({
    surfaceId: 'benchmark:resonators',
    ariaLabel: 'Benchmark resonator selection actions',
    items: rosterSelectionItems,
    acts: rosterSelectionActions,
    active: captureAction == null && surfacePhase === 'idle',
  })

  const stageContextItems = useMemo(() => getBenchStageCtx({
    canDeleteAll: roster.length > 0,
    onPaste: () => {
      void pasteResonatorProfiles()
    },
    onDeleteAll: () => {
      deleteResonatorProfilesWithConfirm(
        roster.map((entry) => entry.id),
        {
          title: 'Delete all resonator profiles?',
          message: 'This will remove every saved resonator profile from benchmark. the calculator will fall back to its default profile state.',
          successMessage: `Removed ${roster.length} resonator profiles from benchmark.`,
        },
      )
    },
  }), [deleteResonatorProfilesWithConfirm, pasteResonatorProfiles, roster])

  const getRosterContextItems = useCallback((resonatorId: string) => {
    if (!rosterById.has(resonatorId)) return []
    const selectionIds =
      rosterSelection.selectionMode && rosterSelection.isSelected(resonatorId)
        ? rosterSelection.selectedIdsInOrder
        : [resonatorId]

    return getBenchTargetCtx({
      id: resonatorId,
      isActive: actResId === resonatorId,
      isSelectedTarget: selectedResId === resonatorId,
      isSelectionPicked: rosterSelection.isSelected(resonatorId),
      onInspect: () => setSelectedResId(resonatorId),
      onSwitch: () => swapResonator(resonatorId),
      onDelete: () => deleteResonatorProfilesWithConfirm(selectionIds),
      onCut: () => {
        void (async () => {
          const wrote = await copyResonatorProfiles(selectionIds)
          if (!wrote) return
          deleteResonatorProfilesWithConfirm(selectionIds, {
            title: selectionIds.length === 1 ? 'Cut this resonator profile?' : `Cut ${selectionIds.length} resonator profiles?`,
            message: selectionIds.length === 1
              ? 'The profile was copied to the clipboard. deleting it here will remove it from benchmark.'
              : 'These profiles were copied to the clipboard. deleting them here will remove them from benchmark.',
            confirmLabel: 'Cut',
            successMessage: selectionIds.length === 1
              ? 'Resonator profile cut to clipboard.'
              : `Cut ${selectionIds.length} resonator profiles to clipboard.`,
          })
        })()
      },
      onCopy: () => {
        void copyResonatorProfiles(selectionIds)
      },
      onPaste: () => {
        void pasteResonatorProfiles()
      },
      onSelect: () => {
        rosterSelection.focusSurface()
        rosterSelection.toggleSelection(resonatorId)
      },
    })
  }, [
    actResId,
    copyResonatorProfiles,
    deleteResonatorProfilesWithConfirm,
    pasteResonatorProfiles,
    rosterById,
    rosterSelection,
    selectedResId,
    swapResonator,
  ])

  const setSurfaceTransitionPhase = useCallback((phase: 'idle' | 'out' | 'in') => {
    surfacePhaseRef.current = phase
    setSurfacePhase(phase)
  }, [])

  const settleSurfaceTransition = useCallback(() => {
    const enterTimer = window.setTimeout(() => {
      setSurfaceTransitionPhase('idle')
      surfaceTimersRef.current = []
    }, BENCH_SURFACE_ENTER_MS)
    surfaceTimersRef.current = [enterTimer]
  }, [setSurfaceTransitionPhase])

  const switchViewMode = useCallback((nextMode: BenchmarkViewMode) => {
    for (const timer of surfaceTimersRef.current) window.clearTimeout(timer)
    surfaceTimersRef.current = []

    if (nextMode === viewModeRef.current) {
      if (surfacePhaseRef.current === 'idle') return
      setSurfaceTransitionPhase('in')
      settleSurfaceTransition()
      return
    }

    if (!entranceAnimations) {
      viewModeRef.current = nextMode
      setViewMode(nextMode)
      setSurfaceTransitionPhase('idle')
      return
    }

    // Sequence the transition so nothing overlaps: fade the current surface out,
    // flip the view (which starts the rail's width transition) while keeping the
    // incoming surface hidden, and only fade that surface in once the rail has
    // finished expanding/shrinking.
    setSurfaceTransitionPhase('out')
    const exitTimer = window.setTimeout(() => {
      viewModeRef.current = nextMode
      setViewMode(nextMode)
      const resizeTimer = window.setTimeout(() => {
        setSurfaceTransitionPhase('in')
        settleSurfaceTransition()
      }, BENCH_RAIL_RESIZE_MS)
      surfaceTimersRef.current = [resizeTimer]
    }, BENCH_SURFACE_EXIT_MS)
    surfaceTimersRef.current = [exitTimer]
  }, [entranceAnimations, setSurfaceTransitionPhase, setViewMode, settleSurfaceTransition])

  useEffect(() => {
    viewModeRef.current = viewMode
  }, [viewMode])

  // Leaving showcase tears down the expanded-CSS layout so the normal board returns.
  useEffect(() => {
    if (!isShowcase) {
      setCssExpanded(false)
      setTuneDrawerOpen(false)
    }
  }, [isShowcase])

  useEffect(() => () => {
    for (const timer of surfaceTimersRef.current) window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (roster.length === 0) {
      if (selectedResId !== null) {
        setSelectedResId(null)
      }
      return
    }

    const availableIds = new Set(roster.map((entry) => entry.id))
    if (selectedResId && availableIds.has(selectedResId)) {
      return
    }

    const fallbackId =
      (actResId && availableIds.has(actResId) ? actResId : null)
      ?? roster[0]?.id
      ?? null

    if (fallbackId !== selectedResId) {
      setSelectedResId(fallbackId)
    }
  }, [actResId, roster, selectedResId])

  useEffect(() => {
    if (reportTargetResId === railResId || railPhase !== 'idle') {
      return undefined
    }

    return scheduleBenchmarkTargetWork(() => {
      startTransition(() => {
        setReportTargetResId(railResId)
      })
    })
  }, [railPhase, railResId, reportTargetResId])

  const selectedRuntime =
    selectedResId === actResId
      ? runtime
      : selectedResId ? initRtsById[selectedResId] ?? null : null
  const selectedSeed = selectedResId ? seedRsntById[selectedResId] ?? null : null
  const railRuntime =
    railResId === actResId
      ? runtime
      : railResId ? initRtsById[railResId] ?? null : null
  const railSeed = railResId ? seedRsntById[railResId] ?? null : null

  const reportRuntime =
    reportTargetResId === actResId
      ? runtime
      : reportTargetResId ? initRtsById[reportTargetResId] ?? null : null
  const benchmarkRuntime = useMemo(
    () => reportRuntime ? applyBenchAsm(reportRuntime) : null,
    [reportRuntime],
  )
  const benchmarkPartRtsById = useMemo(
    () => applyBenchMapAsm(partRtsById),
    [partRtsById],
  )
  const benchmarkInitRtsById = useMemo(
    () => applyBenchMapAsm(initRtsById),
    [initRtsById],
  )
  const reportSeed = reportTargetResId ? seedRsntById[reportTargetResId] ?? null : null
  const reportTargets = useMemo(
    () => (
      reportTargetResId
        ? profilesById[reportTargetResId]?.runtime.routing.selectedTargetsByOwnerKey ?? {}
        : {}
    ),
    [profilesById, reportTargetResId],
  )
  const reportTarget = useBenchTarget({
    targetRuntime: benchmarkRuntime,
    targetSeed: reportSeed,
    targetSelections: reportTargets,
    // Benchmark scoring has its own normalized runtime/enemy assumptions, so
    // it must not reuse the live active prep even when benchmarking the active resonator.
    activeResId: null,
    activeRuntimesById: benchmarkPartRtsById,
    initializedRuntimesById: benchmarkInitRtsById,
    enemy: BENCH_ENEMY,
    showAllStates,
  })
  const reportRuntimesById = reportTarget.runtimesById
  const simulation = reportTarget.simulation
  const reportStateGroups = reportTarget.stateGroups
  const echoRuntime = railRuntime
  const echoSeed = railSeed
  const echoLoadout = echoRuntime?.build.echoes ?? EMPTY_ECHO_LOADOUT
  const loadoutSlots = useMemo(
    () => echoLoadout.map((echo) => (echo ? makeEchoSlot(echo) : null)),
    [echoLoadout],
  )
  const equipBenchmarkEcho = useCallback((echo: EchoInstance, slotIndex: number) => {
    const resonatorId = echoRuntime?.id
    if (!resonatorId) return

    updateResonatorRuntime(resonatorId, (curRt) => ({
      ...curRt,
      build: {
        ...curRt.build,
        echoes: qpEchoAtSlot(curRt.build.echoes, echo, slotIndex),
      },
    }))
  }, [echoRuntime?.id, updateResonatorRuntime])
  const echoSurfaceMenu = useEchoSrfcM({
    clpbSrcResId: echoRuntime?.id ?? 'unknown',
    clipSourceName: echoSeed?.name ?? echoRuntime?.id ?? 'No Resonator',
    curChs: echoLoadout,
    onQpEchoAtjg: equipBenchmarkEcho,
  })
  const { buildReadOnlyMenu, copyEchoesToClipboard } = echoSurfaceMenu
  const benchmarkEchoItems = useMemo(
    () => echoLoadout
      .map((echo, index) => (echo ? { id: `benchmark:${echoRuntime?.id ?? 'unknown'}:echo:${index}`, val: echo } : null))
      .filter((item): item is { id: string; val: EchoInstance } => Boolean(item)),
    [echoLoadout, echoRuntime?.id],
  )
  const benchmarkEchoActions = useMemo(() => [{
    id: 'benchmark-echo:copy',
    key: 'copy' as const,
    needsSel: true,
    icon: <Copy size={14} />,
    label: ({ count }: { count: number }) => `Copy (${count})`,
    title: 'Copy selected echoes (Ctrl/Cmd+C)',
    run: async ({ vals }: { vals: EchoInstance[] }) => {
      const wrote = await copyEchoesToClipboard(vals)
      if (wrote) {
        showToast({
          content: `Copied ${vals.length} echo${vals.length === 1 ? '' : 'es'}.`,
          variant: 'success',
          duration: 2200,
        })
      }
    },
  }], [copyEchoesToClipboard, showToast])
  const benchmarkEchoSelection = useSel({
    surfaceId: `benchmark:${echoRuntime?.id ?? 'unknown'}:echoes`,
    ariaLabel: 'Benchmark echo selection actions',
    items: benchmarkEchoItems,
    acts: benchmarkEchoActions,
    active: captureAction == null && surfacePhase === 'idle',
  })
  const focusBenchmarkEchoSurface = benchmarkEchoSelection.focusSurface
  const addBenchmarkEchoToSelection = benchmarkEchoSelection.addToSelection
  const getBenchmarkEchoId = useCallback(
    (slotIndex: number) => `benchmark:${echoRuntime?.id ?? 'unknown'}:echo:${slotIndex}`,
    [echoRuntime?.id],
  )
  const getBenchmarkEchoItems = useCallback((itemId: string, echo: EchoInstance) => (
    buildReadOnlyMenu({
      id: itemId,
      echo,
      onSelect: () => {
        focusBenchmarkEchoSurface()
        addBenchmarkEchoToSelection(itemId)
      },
    })
  ), [addBenchmarkEchoToSelection, buildReadOnlyMenu, focusBenchmarkEchoSurface])
  const echoSelection = useMemo<BenchmarkEchoSelection>(() => ({
    selectionMode: benchmarkEchoSelection.selectionMode,
    isSelected: benchmarkEchoSelection.isSelected,
    buildClickCapture: benchmarkEchoSelection.buildClickCapture,
    getId: getBenchmarkEchoId,
    getItems: getBenchmarkEchoItems,
    surfaceProps: benchmarkEchoSelection.surfaceProps,
  }), [
    benchmarkEchoSelection.buildClickCapture,
    benchmarkEchoSelection.isSelected,
    benchmarkEchoSelection.selectionMode,
    benchmarkEchoSelection.surfaceProps,
    getBenchmarkEchoId,
    getBenchmarkEchoItems,
  ])

  const reportOptions = useMemo(() => ({
    sections: {
      rotationFeatures: reportSettings.buildDetails && reportSettings.rotationFeatures,
      upgradePaths: reportSettings.upgradePaths,
      echoStatsTable: reportSettings.buildDetails && reportSettings.echoStatsTable,
      benchmarkTargets: reportSettings.benchmarkTargets,
    },
  }), [
    reportSettings.benchmarkTargets,
    reportSettings.buildDetails,
    reportSettings.echoStatsTable,
    reportSettings.rotationFeatures,
    reportSettings.upgradePaths,
  ])

  const { report, loading, error, refresh } = useBenchReport({
    runtime: benchmarkRuntime,
    simulation,
    enemy: BENCH_ENEMY,
    runtimesById: reportRuntimesById,
    enabled: !isShowcase && surfacePhase === 'idle',
    reportOptions,
  })
  const prevReportSectionsRef = useRef(reportOptions.sections)

  useEffect(() => {
    const prev = prevReportSectionsRef.current
    const next = reportOptions.sections
    const needsRefresh = (
      (!prev.rotationFeatures && next.rotationFeatures)
      || (!prev.upgradePaths && next.upgradePaths)
      || (!prev.echoStatsTable && next.echoStatsTable)
      || (!prev.benchmarkTargets && next.benchmarkTargets)
    )
    prevReportSectionsRef.current = next
    if (needsRefresh) {
      refresh()
    }
  }, [refresh, reportOptions])

  const { score: showcaseScore, avgDamage: showcaseDamage, runtimeId: showcaseScoreResId } = useBenchShowcase({
    runtime: benchmarkRuntime,
    simulation,
    enemy: BENCH_ENEMY,
    runtimesById: reportRuntimesById,
    enabled: isShowcase && surfacePhase === 'idle' && railPhase === 'idle' && reportTargetResId === railResId,
  })

  const overviewStatsTree = useMemo(
    () => simulation?.finalStats ? makeStatsTree(simulation.finalStats) : [],
    [simulation],
  )

  useLayoutEffect(() => {
    if (isShowcase) return undefined
    const board = boardRef.current
    const stack = mainStackRef.current
    if (!board || !stack) return undefined

    let frame = 0
    const updateInset = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        stack.style.setProperty('--bench-stack-stick-top', `${board.clientHeight - stack.offsetHeight}px`)
      })
    }
    const observer = new ResizeObserver(updateInset)
    observer.observe(board)
    observer.observe(stack)
    updateInset()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [isShowcase, report])

  const accent = selectedSeed ? ATTR_COLORS[selectedSeed.attribute] ?? '#6b7cff' : '#6b7cff'
  const scoreMatchesRail = !isShowcase || (reportTargetResId === railResId && showcaseScoreResId === railResId)
  const score = isShowcase
    ? (scoreMatchesRail ? showcaseScore : null)
    : report ? report.benchmark.percent * 100 : null
  const showcaseAvgDamage = isShowcase && scoreMatchesRail ? showcaseDamage : null
  const grade = getBuildBenchmarkGrade(score)
  const tone = score != null ? getBuildBenchmarkTone(score).color : accent

  const activeBuild: BenchmarkBuildSnapshot | null = report?.benchmark.builds.active ?? null
  const benchBuild: BenchmarkBuildSnapshot | null = report?.benchmark.builds.benchmark100 ?? null
  const perfectBuild: BenchmarkBuildSnapshot | null = report?.benchmark.builds.benchmark200 ?? null

  const showcaseBuild = useMemo(() => {
    if (!railRuntime) return null
    const buildSeed = seedRsntById[railRuntime.id] ?? null
    const buildStats = buildSeed ? getBuildStats(railRuntime, resResBaseSt(buildSeed, railRuntime.base.level)) : null
    const buildStatsView = buildStats ? makeStatsView(railRuntime, buildStats) : null
    return {
      statsView: buildStatsView,
      buildStatsView,
      charId: railRuntime.id,
      hasWeights: getMaxEchoSc(railRuntime.id) > 0,
      echoes: railRuntime.build.echoes,
      sonataSets: buildSonataPlan(railRuntime.build.echoes).map((entry) => ({
        setId: entry.id,
        pieces: entry.count,
        icon: entry.icon,
        name: getSntSetNam(entry.id),
      })),
    }
  }, [railRuntime])

  const attrIcon = getAttributeIconSrc(selectedSeed?.attribute)
  const canSwitchSelected = Boolean(selectedResId && selectedResId !== actResId)

  const makeRailModel = useCallback((resId: string | null): RailCardModel => {
    const railRuntime =
      resId === actResId
        ? runtime
        : resId ? initRtsById[resId] ?? null : null
    const railSeed = resId ? seedRsntById[resId] ?? null : null
    const railDisplayRuntimesById = resId === actResId ? partRtsById : initRtsById
    const railWeaponState = railRuntime?.build.weapon ?? null
    const railWeapon =
      railWeaponState?.id && !isNoWeaponId(railWeaponState.id) ? getWpnById(railWeaponState.id) : null
    const railWeaponName =
      railWeapon?.name ??
      (railWeaponState && !isNoWeaponId(railWeaponState.id) && railWeaponState.id
        ? toTitle(railWeaponState.id)
        : 'No Weapon')
    const railWpnVslKey = getWpnVisKey(railWeapon?.weaponType ?? railSeed?.weaponType ?? null)
    const railWeaponIcon = railWeapon?.icon ?? (railWpnVslKey ? `/assets/weapons/${railWpnVslKey}.webp` : null)
    const railSonataSets = railRuntime
      ? buildSonataPlan(railRuntime.build.echoes).map((entry) => ({
          setId: entry.id,
          pieces: entry.count,
          icon: entry.icon,
          name: getSntSetNam(entry.id),
        }))
      : []
    const railTeamSupports = (railRuntime?.build.team?.slice(1) ?? [])
      .filter((id): id is string => Boolean(id))
      .map((id) => {
        const res = getResonator(id)
        if (!res) return null
        const mateRt = railDisplayRuntimesById[id] ?? null
        const mateWpnState = mateRt?.build.weapon ?? null
        const mateWpn =
          mateWpnState?.id && !isNoWeaponId(mateWpnState.id) ? getWpnById(mateWpnState.id) : null
        const mateWpnKey = getWpnVisKey(mateWpn?.weaponType ?? res.weaponType ?? null)
        const sets = mateRt
          ? buildSonataPlan(mateRt.build.echoes)
              .slice(0, 2)
              .map((entry) => ({ ...entry, name: getSntSetNam(entry.id) }))
          : []
        return {
          id,
          name: res.name,
          rarity: res.rarity ?? 4,
          sprite: res.sprite ?? res.profile ?? '/assets/default.webp',
          spriteCss: spriteVars(res),
          attribute: res.attribute,
          accent: ATTR_COLORS[res.attribute] ?? '#6b7cff',
          level: mateRt?.base.level ?? null,
          sequence: mateRt?.base.sequence ?? 0,
          weaponIcon: mateWpn?.icon ?? (mateWpnKey ? `/assets/weapons/${mateWpnKey}.webp` : null),
          weaponName: mateWpn?.name ?? null,
          weaponRarity: mateWpn?.rarity ?? null,
          weaponLevel: mateWpnState?.level ?? null,
          weaponRank: mateWpnState?.rank ?? null,
          sets,
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))

    return {
      runtime: railRuntime,
      seed: railSeed,
      rarity: railSeed?.rarity ?? 4,
      accent: railSeed ? ATTR_COLORS[railSeed.attribute] ?? '#6b7cff' : '#6b7cff',
        attrIcon: getAttributeIconSrc(railSeed?.attribute),
      portraitSrc: railSeed?.sprite ?? railSeed?.profile ?? '/assets/default.webp',
      spriteCss: spriteVars(railSeed),
      weaponState: railWeaponState,
      weapon: railWeapon,
      weaponName: railWeaponName,
      weaponRarity: railWeapon?.rarity ?? null,
      weaponIcon: railWeaponIcon,
      sonataSets: railSonataSets,
      teamSupports: railTeamSupports,
    }
  }, [actResId, initRtsById, partRtsById, runtime])

  const railModel = useMemo(() => makeRailModel(railResId), [makeRailModel, railResId])

  // Portrait offset/scale sliders (0-100, neutral at 50) nudge the resonator's
  // tuned spine placement; the backdrop sliders override its base opacity/blur.
  // Image settings (portrait placement/mask, backdrop, uploads) persist across
  // both modes; only colours/fonts/layout are showcase-only. Untouched controls
  // resolve to the base placement, so non-customized benchmark views are unchanged.
  const showcasePlacement = useMemo(() => {
    const base = getBenchmarkSpinePlacement(railResId)
    return {
      x: base.x - (((cardStyle.portraitX ?? 50) - 50) / 50) * 800,
      y: base.y - (((cardStyle.portraitY ?? 50) - 50) / 50) * 800,
      scale: base.scale * (0.5 + (cardStyle.portraitScale ?? 50) / 100),
    }
  }, [railResId, cardStyle.portraitX, cardStyle.portraitY, cardStyle.portraitScale])

  const backdropStyle = useMemo<CssVars>(() => {
    return {
      ...(cardStyle.backdropOpacity != null ? { '--asset-base-opacity': cardStyle.backdropOpacity / 100 } : {}),
      ...(cardStyle.backdropBlur != null
        ? { '--asset-base-filter': `blur(${((cardStyle.backdropBlur / 100) * 20).toFixed(1)}px) saturate(1.3)` }
        : {}),
      ...(resolvedBackdrop ? { backgroundImage: `url("${resolvedBackdrop}")` } : {}),
      ...(cardStyle.backdropScale != null ? { backgroundSize: `${cardStyle.backdropScale * 3}%` } : {}),
      ...(cardStyle.backdropX != null || cardStyle.backdropY != null
        ? { backgroundPosition: `${cardStyle.backdropX ?? 50}% ${cardStyle.backdropY ?? 28}%` }
        : {}),
    }
  }, [
    cardStyle.backdropOpacity,
    cardStyle.backdropBlur,
    resolvedBackdrop,
    cardStyle.backdropScale,
    cardStyle.backdropX,
    cardStyle.backdropY,
  ])
  const captureBuildCard = useCallback(async (action: 'download' | 'clipboard') => {
    const card = buildCardRef.current
    if (!card || !isShowcase || captureAction) return

    setCaptureAction(action)
    try {
      const png = renderBuildCardPng(card)
      if (action === 'clipboard') {
        await copyBuildCard(png)
        showToast({ content: 'Build card copied to clipboard.', variant: 'success' })
      } else {
        downloadBuildCard(await png, railModel.seed?.name ?? 'build')
        showToast({ content: 'Build card captured.', variant: 'success' })
      }
    } catch (error) {
      showToast({
        content: error instanceof Error ? error.message : 'Build card capture failed.',
        variant: 'error',
      })
    } finally {
      setCaptureAction(null)
    }
  }, [captureAction, isShowcase, railModel.seed?.name, showToast])
  const selectedRailModel = useMemo(
    () => selectedResId === railResId ? railModel : makeRailModel(selectedResId),
    [makeRailModel, railModel, railResId, selectedResId],
  )
  const selectedRailAssetUrls = useMemo(() => {
    return [
      selectedRailModel.portraitSrc,
      selectedRailModel.attrIcon,
      selectedRailModel.weaponIcon,
      ...selectedRailModel.sonataSets.map((set) => set.icon),
      ...selectedRailModel.teamSupports.flatMap((mate) => [
        getAttributeIconSrc(mate.attribute),
        mate.weaponIcon,
        mate.sprite,
        ...mate.sets.map((set) => set.icon),
      ]),
    ].filter((url): url is string => Boolean(url))
  }, [selectedRailModel])

  useEffect(() => {
    railResIdRef.current = railResId
  }, [railResId])

  useEffect(() => {
    if (selectedResId === railResIdRef.current) {
      return undefined
    }

    let canceled = false

    const commitRail = () => {
      if (canceled) return
      railResIdRef.current = selectedResId
      setRailResId(selectedResId)
      setRailPhase('in')
    }

    if (typeof window === 'undefined') {
      commitRail()
      return undefined
    }

    const phaseHandle = window.setTimeout(() => {
      setRailPhase('out')
    }, 0)
    const exitHandle = window.setTimeout(() => {
      void preloadBenchmarkRailImages(selectedRailAssetUrls).then(commitRail)
    }, BENCH_RAIL_EXIT_MS)

    return () => {
      canceled = true
      window.clearTimeout(phaseHandle)
      window.clearTimeout(exitHandle)
    }
  }, [selectedResId, selectedRailAssetUrls])

  useEffect(() => {
    if (railPhase !== 'in' || typeof window === 'undefined') {
      return undefined
    }
    const handle = window.setTimeout(() => {
      setRailPhase('idle')
    }, BENCH_RAIL_ENTER_MS)
    return () => window.clearTimeout(handle)
  }, [railPhase, railResId])

  const rosterRef = useRef<HTMLElement | null>(null)
  const attrGroups = useMemo<BenchAttrGroup[]>(() => {
    const groups: BenchAttrGroup[] = []
    for (const entry of roster) {
      const last = groups[groups.length - 1]
      if (last && last.attribute === entry.attribute) {
        last.count += 1
      } else {
        groups.push({ attribute: entry.attribute, accent: entry.accent, firstId: entry.id, count: 1 })
      }
    }
    return groups
  }, [roster])

  const deleteSelectedResonator = useCallback(() => {
    if (!selectedResId) return
    deleteResonatorProfilesWithConfirm([selectedResId])
  }, [deleteResonatorProfilesWithConfirm, selectedResId])

  // Per-resonator portrait edge mask, shared by the rail and the banner portrait.
  const maskVars = useMemo<CssVars>(() => ({
    ...(cardStyle.maskTop != null ? { '--mask-top': `${cardStyle.maskTop}%` } : {}),
    ...(cardStyle.maskRight != null ? { '--mask-right': `${cardStyle.maskRight}%` } : {}),
    ...(cardStyle.maskBottom != null ? { '--mask-bottom': `${cardStyle.maskBottom}%` } : {}),
    ...(cardStyle.maskLeft != null ? { '--mask-left': `${cardStyle.maskLeft}%` } : {}),
    ...(cardStyle.maskTopSharp != null ? { '--mask-top-sharp': cardStyle.maskTopSharp / 100 } : {}),
    ...(cardStyle.maskRightSharp != null ? { '--mask-right-sharp': cardStyle.maskRightSharp / 100 } : {}),
    ...(cardStyle.maskBottomSharp != null ? { '--mask-bottom-sharp': cardStyle.maskBottomSharp / 100 } : {}),
    ...(cardStyle.maskLeftSharp != null ? { '--mask-left-sharp': cardStyle.maskLeftSharp / 100 } : {}),
  }), [
    cardStyle.maskTop, cardStyle.maskRight, cardStyle.maskBottom, cardStyle.maskLeft,
    cardStyle.maskTopSharp, cardStyle.maskRightSharp, cardStyle.maskBottomSharp, cardStyle.maskLeftSharp,
  ])

  // Per-text-type typography overrides, emitted as `--ss-*` custom properties the
  // card's CSS consumes (with the slot's built-in styling as the fallback).
  const textSlotVars = useMemo(() => buildTextSlotVars(cardStyle.textSlots ?? {}), [cardStyle.textSlots])

  // Split custom CSS so @import / @font-face / @keyframes sit at the top level
  // (valid for fonts + animations) while the rest stays scoped to the card.
  const customCssParts = useMemo(
    () => (cardStyle.customCss ? splitHoistedCss(cardStyle.customCss) : null),
    [cardStyle.customCss],
  )
  const scopedCustomCss = useMemo(
    () => isShowcase && customCssParts
      ? `${customCssParts.hoisted}\n@scope (.bench-rail-wrapper, .bench-rail) to (.bench-tune) {\n${customCssParts.scoped}\n}`
      : null,
    [customCssParts, isShowcase],
  )
  const railStyle = useMemo<CssVars>(() => ({
    '--resonator-accent': isShowcase ? cardStyle.accent ?? railModel.accent : railModel.accent,
    ...(isShowcase && cardStyle.surface ? { '--bg': cardStyle.surface } : {}),
    ...(isShowcase && cardStyle.text ? { '--text': cardStyle.text } : {}),
    ...(isShowcase && (cardStyle.surface != null || cardStyle.opacity != null)
      ? {
          '--rail-glass': `color-mix(in srgb, var(--bg) ${cardStyle.opacity ?? 82}%, transparent)`,
          '--rail-glass-2': `color-mix(in srgb, var(--bg) ${Math.round((cardStyle.opacity ?? 82) * 0.67)}%, transparent)`,
        }
      : {}),
    ...(isShowcase && cardStyle.displayFont ? { '--display-font': cardStyle.displayFont } : {}),
    ...(isShowcase && cardStyle.monoFont ? { '--mono-font': cardStyle.monoFont } : {}),
    ...maskVars,
    ...(isShowcase ? textSlotVars : {}),
  }), [
    cardStyle.accent,
    cardStyle.displayFont,
    cardStyle.monoFont,
    cardStyle.opacity,
    cardStyle.surface,
    cardStyle.text,
    isShowcase,
    maskVars,
    railModel.accent,
    textSlotVars,
  ])

  // Persisted card fonts store only the resolved stack, not the original Google
  // Fonts link, so re-inject each family's stylesheet when the card mounts/changes
  // otherwise a custom font renders as its fallback after a reload.
  useEffect(() => {
    if (!isShowcase) return
    const families = collectCardFontFamilies({
      displayFont: cardStyle.displayFont,
      monoFont: cardStyle.monoFont,
      textSlots: cardStyle.textSlots ?? {},
    })
    for (const family of families) ensGglFamilyByName(family)
  }, [isShowcase, cardStyle.displayFont, cardStyle.monoFont, cardStyle.textSlots])

  const benchBanner = !isShowcase && isNarrow ? (
    <NarrowBenchmarkBanner
      portraitSrc={railModel.portraitSrc}
      spriteCss={railModel.spriteCss}
      backdropSrc={resolvedBackdrop ?? railModel.portraitSrc}
    />
  ) : null

  return (
    <>
      <div className="calculator-stage">
      <div className="bench" style={{ '--resonator-accent': accent, '--grade': tone } as CssVars}>
        <BenchmarkToolbar
          name={selectedSeed?.name ?? 'Benchmark Target'}
          attributeIcon={attrIcon}
          animatedPortraits={animatedPortraits}
          viewMode={viewMode}
          canSwitch={canSwitchSelected}
          canDelete={Boolean(selectedResId && captureAction == null && surfacePhase === 'idle')}
          onAnimatedPortraitsChange={setAnimatedPortraits}
          onViewModeChange={switchViewMode}
          onSwitch={() => {
            if (selectedResId) swapResonator(selectedResId)
          }}
          onRefresh={refresh}
          onOpenReportSettings={reportSettingsModal.show}
          onDelete={deleteSelectedResonator}
          onClose={() => navigate('/calculator')}
        />

        {!isShowcase && error ? <div className="bench-notice bench-notice--error">{error.message}</div> : null}

        {selectedRuntime ? (
          <ContextTrigger
            asChild
            ariaLabel="Benchmark stage actions"
            items={stageContextItems}
          >
            <div
              ref={boardRef}
              className="bench-board"
              data-view={viewMode}
              data-css-expanded={isShowcase && cssExpanded ? 'true' : undefined}
            >
            {isShowcase && cssExpanded ? (
              <BenchCssEditorDock
                value={cardStyle.customCss ?? ''}
                isDark={isDarkTheme}
                onChange={(value) => {
                  if (railResId) patchBenchCardStyle(railResId, { customCss: value || null })
                }}
                onClose={() => {
                  setCssExpanded(false)
                  setTuneDrawerOpen(false)
                }}
              />
            ) : isShowcase || roster.length > 1 ? (
              <BenchmarkResonatorRail
                viewMode={viewMode}
                roster={roster}
                groups={attrGroups}
                stripRef={rosterRef}
                selectedResId={selectedResId}
                activeResId={actResId}
                phase={surfacePhase}
                onSelect={setSelectedResId}
                selection={{
                  selectionMode: rosterSelection.selectionMode,
                  isSelected: rosterSelection.isSelected,
                  buildClickCapture: rosterSelection.buildClickCapture,
                  getItems: getRosterContextItems,
                  surfaceProps: rosterSelection.surfaceProps,
                }}
              />
            ) : null}
            <div className="bench-workspace">
              <div className="bench-rail-wrapper">
                <RailCard
                  buildCardRef={buildCardRef}
                  isShowcase={isShowcase}
                  customCss={scopedCustomCss}
                  railPhase={railPhase}
                  editMode={editMode}
                  railResId={railResId}
                  railModel={railModel}
                  cardHidden={cardHidden}
                  railStyle={railStyle}
                  backdropStyle={backdropStyle}
                  statsColumn={cardStyle.statsColumn ?? 'build'}
                  portraitCredit={cardStyle.portraitCredit}
                  backdropCredit={cardStyle.backdropCredit}
                  resolvedPortrait={resolvedPortrait}
                  animatedPortraits={animatedPortraits}
                  surfacePhase={surfacePhase}
                  showcasePlacement={showcasePlacement}
                  score={score}
                  grade={grade}
                  tone={tone}
                  showcaseBuild={showcaseBuild}
                  showcaseAvgDamage={showcaseAvgDamage}
                  echoSelection={echoSelection}
                />
                {isShowcase && (
                  <BenchCustomizePanel
                    key={tuneResetKey}
                    accent={cardStyle.accent ?? railModel.accent}
                    surface={cardStyle.surface ?? '#0c111a'}
                    text={cardStyle.text ?? '#eef2f7'}
                    cardOpacity={cardStyle.opacity ?? 82}
                    portraitX={cardStyle.portraitX ?? 50}
                    portraitY={cardStyle.portraitY ?? 50}
                    portraitScale={cardStyle.portraitScale ?? 50}
                    maskTop={cardStyle.maskTop ?? 0}
                    maskRight={cardStyle.maskRight ?? 0}
                    maskBottom={cardStyle.maskBottom ?? 45}
                    maskLeft={cardStyle.maskLeft ?? 0}
                    maskTopSharp={cardStyle.maskTopSharp ?? 0}
                    maskRightSharp={cardStyle.maskRightSharp ?? 0}
                    maskBottomSharp={cardStyle.maskBottomSharp ?? 0}
                    maskLeftSharp={cardStyle.maskLeftSharp ?? 0}
                    portraitImage={resolvedPortrait}
                    backdropImage={resolvedBackdrop}
                    backdropX={cardStyle.backdropX ?? 50}
                    backdropY={cardStyle.backdropY ?? 28}
                    backdropScale={cardStyle.backdropScale ?? 50}
                    backdropBlur={cardStyle.backdropBlur ?? 30}
                    backdropOpacity={cardStyle.backdropOpacity ?? 67}
                    statsColumn={cardStyle.statsColumn ?? 'build'}
                    portraitCredit={cardStyle.portraitCredit ?? ''}
                    backdropCredit={cardStyle.backdropCredit ?? ''}
                    textSlots={cardStyle.textSlots ?? {}}
                    customCss={cardStyle.customCss ?? ''}
                    editMode={editMode}
                    onEdit={(group) => setEditMode((prev) => (prev === group ? null : group))}
                    hidden={cardHidden}
                    onToggleHidden={(key) => {
                      if (railResId) toggleBenchHide(railResId, key)
                    }}
                    onStyleChange={(patch) => {
                      if (railResId) patchBenchCardStyle(railResId, patch)
                    }}
                    onPickImage={handlePickImage}
                    onResetGroup={handleResetGroup}
                    onReset={() => {
                      if (railResId) resetBenchCard(railResId)
                      setEditMode(null)
                      setTuneResetKey((key) => key + 1)
                    }}
                    onCapture={captureBuildCard}
                    captureAction={captureAction}
                    capturing={captureAction != null || surfacePhase !== 'idle'}
                    onExport={handleExportTarget}
                    onImportFile={handleImportFile}
                    docked={cssExpanded}
                    drawerOpen={tuneDrawerOpen}
                    onToggleDrawer={() => setTuneDrawerOpen((open) => !open)}
                    onExpandCss={() => {
                      setCssExpanded((on) => !on)
                      setTuneDrawerOpen(false)
                    }}
                    surfacePhase={surfacePhase}
                  />
                )}
                {isShowcase && (
                  <ImageUploadModal
                    state={uploadModal.dialogProps}
                    title={uploadTarget === 'portrait' ? 'Portrait image' : 'Backdrop image'}
                    initialCredit={(uploadTarget === 'portrait' ? cardStyle.portraitCredit : cardStyle.backdropCredit) ?? ''}
                    onClose={uploadModal.hide}
                    onApply={handleApplyImage}
                  />
                )}
              </div>

              {!isShowcase ? (
                <MainReport
                  phase={surfacePhase}
                  loading={loading}
                  report={report}
                  activeBuild={activeBuild}
                  benchmark100Build={benchBuild}
                  benchmark200Build={perfectBuild}
                  score={score}
                  grade={grade}
                  tone={tone}
                  banner={benchBanner}
                  detailBuildKey={detailBuildKey}
                  setDetailBuildKey={setDetailBuildKey}
                  mainStackRef={mainStackRef}
                  stateGroups={reportStateGroups}
                  reportRuntime={benchmarkRuntime}
                  reportRuntimesById={reportRuntimesById}
                  enemyId={BENCH_ENEMY.id}
                  echoSelection={echoSelection}
                  loadoutSlots={loadoutSlots}
                  sourceEchoes={echoLoadout}
                  settings={reportSettings}
                  overviewStatsTree={overviewStatsTree}
                />
              ) : null}
            </div>
            </div>
          </ContextTrigger>
        ) : null}
      </div>
      </div>
      <ReportSettingsModal
        state={reportSettingsModal.dialogProps}
        settings={reportSettings}
        onChange={(patch: Partial<BenchRptSettings>) => patchReportSettings(patch)}
        onClose={reportSettingsModal.hide}
      />
      <CnfrMdl
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
    </>
  )
}

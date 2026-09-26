/*
  Author: Runor Ewhro
  Description: Hosts the app-header Echo import. Standalone context builds and
               active-team instances remain separate destinations even when
               both happen to use the same resonator id.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ensureResonatorData, hasResonatorData, holdResonatorData } from '@/data/gameData'
import { useLocation } from 'react-router-dom'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { useAppStore } from '@/application/state'
import { selInitRtLkp, selScenarioProfiles, selWorkDrvd } from '@/application/state'
import { runtimeFromSnapshot } from '@/engine/runtime/runtimeAdapters.ts'
import { scenarioIdForContextResonator } from '@/domain/entities/scenarioLibrary.ts'
import { isSimulationRoute } from '@/shared/lib/appRoutes.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { RES_MENU } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { makeResProfile } from '@/engine/runtime/defaults.ts'
import { eligibleForSlot, useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
import { useImportLanding } from '@/modules/simulation/features/echoes/lib/importLanding.ts'
import { ResPckr } from '@/modules/simulation/features/resonator/Picker.tsx'
import { EchoImportTargetBar } from '@/modules/simulation/features/echoes/EchoImportTargetBar.tsx'
import { useEchoImport } from '@/modules/simulation/features/echoes/lib/echoImportStore.ts'
import {
  mergeEchoImportIntoProfile,
  resolveEchoImportRuntime,
  type EchoImportDestination,
} from '@/modules/simulation/features/echoes/lib/echoImportDestination.ts'
import { Parser } from '@/modules/simulation/features/echoes/Parser.tsx'
import type { ParsedBuildScreenshot } from '@/engine/echoParser/ocrParsing.ts'

type PickerTarget =
  | { kind: 'context' }
  | { kind: 'team'; slotIndex: number }

interface DestinationSelection {
  requestId: number
  destination: EchoImportDestination | null
}

interface ContextOptions {
  requestId: number
  ids: string[]
}

const EMPTY_RUNTIME_MAP: Record<string, ResRuntime> = Object.freeze({})
const EMPTY_PROFILES: ReturnType<typeof selScenarioProfiles> = Object.freeze({})

export function EchoImportHost() {
  const pendingDestination = useRef(0)
  const location = useLocation()
  const isOpen = useEchoImport((state) => state.isOpen)
  const initialResonatorId = useEchoImport((state) => state.initialResonatorId)
  const requestId = useEchoImport((state) => state.requestId)
  const closeRequest = useEchoImport((state) => state.close)
  const modal = useAppModal()
  const { hide: hideModal, show: showModal, visible: modalVisible, closing: modalClosing } = modal
  const importActive = isOpen || modalVisible || modalClosing
  const actRt = useAppStore((state) => importActive ? selWorkDrvd(state).actRt : null)
  const partRtsById = useAppStore((state) => importActive
    ? selWorkDrvd(state).partRtsById : EMPTY_RUNTIME_MAP)
  const initRtsById = useAppStore((state) => importActive
    ? selInitRtLkp(state) : EMPTY_RUNTIME_MAP)
  const profiles = useAppStore((state) => importActive
    ? selScenarioProfiles(state) : EMPTY_PROFILES)
  const maxResOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const showToast = useTstStr((state) => state.show)
  const { setMember } = useTeamSlots()
  const picker = useAppModal()
  const [selection, setSelection] = useState<DestinationSelection>({
    requestId: -1,
    destination: null,
  })
  const [contextOptions, setContextOptions] = useState<ContextOptions>({
    requestId: -1,
    ids: [],
  })
  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null)

  const working = isSimulationRoute(location.pathname)
  const defaultDestination = initialResonatorId
    ? { kind: 'context', resonatorId: initialResonatorId } satisfies EchoImportDestination
    : working && actRt
      ? { kind: 'context', resonatorId: actRt.id } satisfies EchoImportDestination
      : null
  const destination = selection.requestId === requestId
    ? selection.destination
    : defaultDestination

  const selectedContextOptions = contextOptions.requestId === requestId ? contextOptions.ids : []
  const contextIds = Array.from(new Set([
    ...selectedContextOptions,
    ...(defaultDestination?.kind === 'context' ? [defaultDestination.resonatorId] : []),
    ...(destination?.kind === 'context' ? [destination.resonatorId] : []),
  ]))
  const contexts = contextIds.flatMap((id) => {
    const resonator = getResSeedBy(id)
    return resonator ? [resonator] : []
  })

  const team = useMemo(() => {
    if (!working || !actRt) return []

    return actRt.build.team.flatMap((resonatorId, slotIndex) => {
      if (!resonatorId || !partRtsById[resonatorId]) return []
      const member = getResSeedBy(resonatorId)
      return member ? [{ member, slotIndex }] : []
    })
  }, [actRt, partRtsById, working])
  const emptyTeamSlot = working && actRt
    ? actRt.build.team.findIndex((id, index) => index > 0 && id === null)
    : -1

  const contextRuntimes = useMemo(() => {
    if (destination?.kind !== 'context' || initRtsById[destination.resonatorId]) {
      return initRtsById
    }

    if (!hasResonatorData([destination.resonatorId])) return initRtsById
    const seed = getResSeedBy(destination.resonatorId)
    if (!seed) return initRtsById
    const profile = profiles[destination.resonatorId]
      ?? makeResProfile(seed, { maxed: maxResOnInit })
    const detachedRuntime = runtimeFromSnapshot(profile)

    return detachedRuntime
      ? { ...initRtsById, [destination.resonatorId]: detachedRuntime }
      : initRtsById
  }, [destination, initRtsById, maxResOnInit, profiles])
  const runtime = resolveEchoImportRuntime(destination, contextRuntimes, partRtsById)

  useEffect(() => {
    if (isOpen) showModal()
  }, [isOpen, requestId, showModal])

  const ensureContextProfile = useCallback((resonatorId: string) => {
    const state = useAppStore.getState()
    if (selScenarioProfiles(state)[resonatorId]) return
    const seed = getResSeedBy(resonatorId)
    if (!seed) return
    state.upsertRes(
      [makeResProfile(seed, { maxed: maxResOnInit })],
      'Added Echo Import Context',
    )
  }, [maxResOnInit])

  const selectContext = useCallback((resonatorId: string) => {
    const pending = ++pendingDestination.current
    void ensureResonatorData([resonatorId]).then(() => {
      if (pending !== pendingDestination.current) return
      setSelection({ requestId, destination: { kind: 'context', resonatorId } })
    }).catch(() => showToast({ content: 'Could not load resonator data. Please try again.', variant: 'error' }))
  }, [requestId, showToast])

  const cancelPendingDestination = useCallback(() => { pendingDestination.current++ }, [])
  useEffect(() => {
    if (isOpen && initialResonatorId) selectContext(initialResonatorId)
    return cancelPendingDestination
  }, [isOpen, initialResonatorId, selectContext, cancelPendingDestination])

  const destinationId = importActive ? destination?.resonatorId : null
  useEffect(() => destinationId ? holdResonatorData([destinationId]) : undefined, [destinationId])

  const selectTeamMember = useCallback((slotIndex: number, resonatorId: string) => {
    pendingDestination.current++
    setSelection({
      requestId,
      destination: { kind: 'team', slotIndex, resonatorId },
    })
  }, [requestId])

  const openContextPicker = useCallback(() => {
    setPickerTarget({ kind: 'context' })
    picker.show()
  }, [picker])

  const openTeamPicker = useCallback(() => {
    if (emptyTeamSlot <= 0) return
    setPickerTarget({ kind: 'team', slotIndex: emptyTeamSlot })
    picker.show()
  }, [emptyTeamSlot, picker])

  const closePicker = useCallback(() => {
    picker.hide(() => setPickerTarget(null))
  }, [picker])

  const pickResonator = useCallback((resonatorId: string) => {
    if (pickerTarget?.kind === 'team') {
      setMember(pickerTarget.slotIndex, resonatorId)
      selectTeamMember(pickerTarget.slotIndex, resonatorId)
    } else {
      ensureContextProfile(resonatorId)
      setContextOptions((current) => ({
        requestId,
        ids: Array.from(new Set([
          ...(current.requestId === requestId ? current.ids : []),
          resonatorId,
        ])),
      }))
      selectContext(resonatorId)
    }
    closePicker()
  }, [closePicker, ensureContextProfile, pickerTarget, requestId, selectContext, selectTeamMember, setMember])

  const closeParser = useCallback(() => {
    closeRequest()
    if (picker.visible) picker.hide(() => setPickerTarget(null))
    hideModal()
  }, [closeRequest, hideModal, picker])

  const updateDestination = useCallback((
    target: EchoImportDestination,
    contextId: string,
    updater: (prev: ResRuntime) => ResRuntime,
    historyLabel: string,
  ) => {
    const state = useAppStore.getState()
    if (target.kind === 'team') {
      const scenarioId = scenarioIdForContextResonator(state.combat, contextId)
      if (!scenarioId || !state.combat.scenariosById[scenarioId]?.team.members.some(
        (member) => member.resonatorId === target.resonatorId,
      )) return false
      state.updScenarioResRt(scenarioId, target.resonatorId, updater)
      return true
    }

    const scenarioId = scenarioIdForContextResonator(state.combat, target.resonatorId)
    if (scenarioId) {
      state.updScenarioResRt(scenarioId, target.resonatorId, updater)
      return true
    }

    const seed = getResSeedBy(target.resonatorId)
    if (!seed) return false
    const profiles = selScenarioProfiles(state)
    const profile = profiles[target.resonatorId]
      ?? makeResProfile(seed, { maxed: maxResOnInit })
    const previous = runtimeFromSnapshot(profile)
    if (!previous) return false

    const next = updater(previous)
    if (next === previous && profiles[target.resonatorId]) return true
    state.upsertRes([mergeEchoImportIntoProfile(profile, next)], historyLabel)
    return true
  }, [maxResOnInit])

  const applyRead = useCallback((
    read: ParsedBuildScreenshot,
    updater: (prev: ResRuntime) => ResRuntime,
  ) => {
    const target = destination ?? (read.resonator.id
      ? { kind: 'context', resonatorId: read.resonator.id } satisfies EchoImportDestination
      : null)
    if (!target) return
    // Team runtimes are scenario-scoped, so retain the active context that owns
    // the imported teammate instead of resolving the member globally.
    const contextId = target.kind === 'team'
      ? selWorkDrvd(useAppStore.getState()).actRt?.id ?? null
      : target.resonatorId
    void ensureResonatorData([target.resonatorId]).then(() => {
      if (!contextId) return
      if (!updateDestination(target, contextId, updater, 'Imported Echo Build Card')) return
      useImportLanding.getState().land({
        resonatorId: target.resonatorId,
        kind: target.kind,
        contextId,
      })
    }).catch(() => showToast({ content: 'Could not load resonator data. Please try again.', variant: 'error' }))
  }, [destination, showToast, updateDestination])

  const detectResonator = useCallback((resonatorId: string) => {
    setContextOptions((current) => ({
      requestId,
      ids: Array.from(new Set([
        ...(current.requestId === requestId ? current.ids : []),
        resonatorId,
      ])),
    }))
    // Detection changes only this modal's destination view; app context stays put.
    selectContext(resonatorId)
  }, [requestId, selectContext])

  if (!isOpen && !modalVisible) return null

  const selectedContextId = destination?.kind === 'context' ? destination.resonatorId : null
  const selectedTeamSlot = destination?.kind === 'team' ? destination.slotIndex : null
  const pickerIsTeam = pickerTarget?.kind === 'team'
  const pickerSlot = pickerIsTeam ? pickerTarget.slotIndex : null

  return (
    <>
      {modalVisible ? (
        <Parser
          visible={modal.visible}
          open={modal.open}
          closing={modalClosing}
          portalTarget={mainPortal()}
          charId={destination?.resonatorId ?? null}
          runtime={runtime}
          currentEchoes={runtime?.build.echoes ?? []}
          onApplyRead={applyRead}
          onDetectedResonator={detectResonator}
          onEquipEcho={(echoes) => {
            if (!destination) return
            const contextId = destination.kind === 'team' ? actRt?.id : destination.resonatorId
            if (!contextId) return
            updateDestination(destination, contextId, (prev) => ({
              ...prev,
              build: { ...prev.build, echoes },
            }), 'Equipped Imported Echo')
          }}
          allowDetectedDestination
          headerExtra={(
            <EchoImportTargetBar
              contexts={contexts}
              selectedContextId={selectedContextId}
              team={team}
              selectedTeamSlot={selectedTeamSlot}
              canAddTeammate={emptyTeamSlot > 0}
              onSelectContext={selectContext}
              onSelectTeam={selectTeamMember}
              onAddContext={openContextPicker}
              onAddTeammate={openTeamPicker}
            />
          )}
          onClose={closeParser}
        />
      ) : null}
      {picker.visible && pickerTarget ? (
        <ResPckr
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={mainPortal()}
          eyebrow={pickerIsTeam ? 'Team' : 'Contexts'}
          title={pickerIsTeam ? 'Add Teammate' : 'Select Context Resonator'}
          resonators={pickerIsTeam && actRt && pickerSlot != null
            ? eligibleForSlot(actRt.build.team, pickerSlot)
            : RES_MENU}
          selResId={pickerIsTeam && actRt && pickerSlot != null
            ? actRt.build.team[pickerSlot]
            : selectedContextId}
          selLbl={pickerIsTeam ? 'Teammate' : 'Context'}
          smmrPrmr={pickerIsTeam
            ? { label: 'Team slot', value: (pickerSlot ?? 0) + 1 }
            : { label: 'Destination', value: getResSeedBy(selectedContextId ?? '')?.name ?? 'Choose one' }}
          emptyState={<p>{pickerIsTeam
            ? 'No eligible resonators remain for this team slot.'
            : 'Choose a resonator to create or select its standalone context build.'}</p>}
          closeLabel="Back"
          panelWidth="regular"
          onClose={closePicker}
          onSelect={pickResonator}
        />
      ) : null}
    </>
  )
}

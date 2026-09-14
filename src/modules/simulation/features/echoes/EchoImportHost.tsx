/*
  Author: Runor Ewhro
  Description: Hosts the app-header Echo import. Standalone context builds and
               active-team instances remain separate destinations even when
               both happen to use the same resonator id.
*/

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { selScenarioProfiles, selVrvwDrvd } from '@/domain/state/selectors.ts'
import { runtimeFromSnapshot } from '@/domain/state/runtimeAdapters.ts'
import { isSimulationRoute } from '@/shared/lib/appRoutes.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { RES_MENU, getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { makeResProfile } from '@/domain/state/defaults.ts'
import { eligibleForSlot, useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { useTstStr } from '@/shared/util/toastStore.ts'
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

export function EchoImportHost() {
  const location = useLocation()
  const isOpen = useEchoImport((state) => state.isOpen)
  const initialResonatorId = useEchoImport((state) => state.initialResonatorId)
  const requestId = useEchoImport((state) => state.requestId)
  const closeRequest = useEchoImport((state) => state.close)
  const { actRt, partRtsById, initRtsById } = useAppStore(selVrvwDrvd)
  const profiles = useAppStore(selScenarioProfiles)
  const maxResOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const showToast = useTstStr((state) => state.show)
  const { setMember } = useTeamSlots()
  const modal = useAppModal()
  const { hide: hideModal, show: showModal, visible: modalVisible, closing: modalClosing } = modal
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
    const resonator = getResonator(id)
    return resonator ? [resonator] : []
  })

  const team = useMemo(() => {
    if (!working || !actRt) return []

    return actRt.build.team.flatMap((resonatorId, slotIndex) => {
      if (!resonatorId || !partRtsById[resonatorId]) return []
      const member = getResonator(resonatorId)
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
    setSelection({ requestId, destination: { kind: 'context', resonatorId } })
  }, [requestId])

  const selectTeamMember = useCallback((slotIndex: number, resonatorId: string) => {
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
    updater: (prev: ResRuntime) => ResRuntime,
    historyLabel: string,
  ) => {
    const state = useAppStore.getState()
    if (target.kind === 'team') {
      state.updResRt(target.resonatorId, updater)
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
    if (!target || !updateDestination(target, updater, 'Imported Echo Build Card')) return

    const name = getResSeedBy(target.resonatorId)?.name ?? 'resonator'
    showToast({
      content: `Imported ${name} ${target.kind === 'team' ? 'team' : 'context'} build.`,
      variant: 'success',
      duration: 2800,
    })
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
    setSelection({ requestId, destination: { kind: 'context', resonatorId } })
  }, [requestId])

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
            updateDestination(destination, (prev) => ({
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

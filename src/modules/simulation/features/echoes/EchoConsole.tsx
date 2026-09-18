/*
  Author: Runor Ewhro
  Description: Resolves requested Echo-slot owners, fixes picker/editor mode
               for each session, and applies loadout edits within the cost budget.
*/

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime.ts'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { selInitRtLkp, selWorkDrvd } from '@/domain/state/selectors.ts'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService.ts'
import { mkDefEchoNst } from '@/modules/simulation/features/echoes/lib/echoPane.ts'
import { cmptTtlEchoC } from '@/modules/simulation/features/echoes/lib/echoes.ts'
import { useEchoCnsl } from '@/modules/simulation/features/echoes/lib/echoConsoleStore.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { projectScenarioUiRuntimes } from '@/domain/state/scenarioRuntime.ts'

// Load picker and editor modules only when a slot request needs them.
const EchoPicker = lazy(async () => ({
  default: (await import('@/modules/simulation/features/echoes/Picker.tsx')).EchoPicker,
}))

const Edit = lazy(async () => ({
  default: (await import('@/modules/simulation/features/echoes/Edit.tsx')).Edit,
}))

// Shared loadout cost ceiling used by slot editing and clipboard imports.
const MAX_ECHO_COST = 12

// Load the console only after a request and hold it until the close completes.
export function EchoConsoleHost() {
  const target = useEchoCnsl((state) => state.target)

  if (!target) {
    return null
  }

  return (
    <Suspense fallback={null}>
      <EchoConsole
        key={`${target.scenarioId ?? 'selected'}:${target.resonatorId}:${target.slotIndex}`}
        resonatorId={target.resonatorId}
        slotIndex={target.slotIndex}
        scenarioId={target.scenarioId}
      />
    </Suspense>
  )
}

function EchoConsole({
  resonatorId,
  slotIndex,
  scenarioId,
}: {
  resonatorId: string
  slotIndex: number
  scenarioId?: CombatScenarioId | null
}) {
  const closeRequest = useEchoCnsl((state) => state.close)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const updResRt = useAppStore((state) => state.updResRt)
  const updScenarioResRt = useAppStore((state) => state.updScenarioResRt)

  // Requests may target another profile: prefer its live participant runtime,
  // falling back to the stored profile when it is outside the current scenario.
  const { partRtsById } = useAppStore(useShallow(selWorkDrvd))
  const initRtsById = useAppStore(selInitRtLkp)
  const targetScenario = useAppStore((state) => (
    scenarioId ? state.combat.scenariosById[scenarioId] ?? null : null
  ))
  const scenarioRuntime = useMemo(
    () => targetScenario?.team.members.some((member) => member.resonatorId === resonatorId)
      ? projectScenarioUiRuntimes(targetScenario).runtimesById[resonatorId] ?? null
      : null,
    [resonatorId, targetScenario],
  )
  const canonicalRuntime = scenarioId
    ? scenarioRuntime
    : partRtsById[resonatorId] ?? initRtsById[resonatorId] ?? null

  const commitRuntime = useCallback((updater: (runtime: ResRuntime | null) => ResRuntime | null) => {
    const update = scenarioId
      ? (next: (prev: ResRuntime) => ResRuntime) => updScenarioResRt(scenarioId, resonatorId, next)
      : (next: (prev: ResRuntime) => ResRuntime) => updResRt(resonatorId, next)
    update((current) => updater(current) ?? current)
  }, [resonatorId, scenarioId, updResRt, updScenarioResRt])
  const session = useConfigurationSession({ source: canonicalRuntime, commit: commitRuntime })
  const runtime = session.draft
  const pickedEchoIdsRef = useRef<string[]>([])

  const { closing, hide, open, show, visible } = useAppModal()

  useEffect(() => {
    show()
  }, [show])

  const closeConsole = useCallback(() => {
    hide(() => {
      session.finish()
      if (pickedEchoIdsRef.current.length > 0) {
        bumpPickerFreq({ bucket: 'echo', ids: pickedEchoIdsRef.current })
      }
      closeRequest()
    })
  }, [bumpPickerFreq, closeRequest, hide, session])

  const echo = runtime?.build.echoes[slotIndex] ?? null

// Keep the initial request mode even after a pick fills an empty slot.
  const [mode] = useState<'pick' | 'edit'>(() => (echo ? 'edit' : 'pick'))

  const allEchoes = useMemo(() => listEchoes(), [])

  const totalCost = runtime ? cmptTtlEchoC(runtime.build.echoes) : 0

  const slotCost = echo ? getEchoById(echo.id)?.cost ?? 0 : 0
  const maxCost = MAX_ECHO_COST - totalCost + slotCost

  // Close if the slot's owner leaves the runtime graph.
  useEffect(() => {
    if (visible && !closing && !runtime) {
      closeConsole()
    }
  }, [closeConsole, closing, runtime, visible])

  const writeSlot = useCallback((next: EchoInstance | null) => {
    session.update((prev) => {
      if (!prev) return prev
      const echoes = [...prev.build.echoes]
      echoes[slotIndex] = next
      return { ...prev, build: { ...prev.build, echoes } }
    })
  }, [session, slotIndex])

  const onSelect = useCallback((echoId: string) => {
    // the slot's own cost is added back before the check, so replacing an echo
    // only measures the net build cost
    const definition = getEchoById(echoId)
    if (!definition || definition.cost > maxCost) return

    const instance = mkDefEchoNst(echoId, slotIndex, echo)
    if (!instance) return

    writeSlot(instance)
    pickedEchoIdsRef.current.push(instance.id)
  }, [echo, maxCost, slotIndex, writeSlot])

  const onClear = useCallback(() => {
    writeSlot(null)
    closeConsole()
  }, [closeConsole, writeSlot])

  const onSave = useCallback((updated: EchoInstance) => {
    writeSlot(updated)
    closeConsole()
  }, [closeConsole, writeSlot])

  if (!runtime || !visible) {
    return null
  }

  if (mode === 'edit') {
    if (!echo) {
      return null
    }

    return (
      <Edit
        visible={visible}
        open={open}
        closing={closing}
        portalTarget={mainPortal()}
        echo={echo}
        slotIndex={slotIndex}
        echoes={allEchoes}
        maxCost={maxCost}
        onSave={onSave}
        onClear={onClear}
        onClose={closeConsole}
      />
    )
  }

  return (
    <EchoPicker
      visible={visible}
      open={open}
      closing={closing}
      portalTarget={mainPortal()}
      echoes={allEchoes}
      selEchoId={echo?.id ?? null}
      slotIndex={slotIndex}
      maxCost={maxCost}
      onSelect={onSelect}
      onClear={onClear}
      onClose={closeConsole}
    />
  )
}

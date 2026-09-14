/*
  Author: Runor Ewhro
  Description: One echo slot, opened from wherever the slot is drawn. An empty
               slot opens the picker, a filled one opens the editor, and the
               mode is fixed when the request lands so a pick does not turn the
               picker into an editor under the cursor.

               The writes are the echo pane's own: a pick goes through
               `mkDefEchoNst` against the slot's cost budget, and a save replaces
               the slot outright.
*/

import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react'
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
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { projectScenarioUiRuntimes } from '@/domain/state/scenarioRuntime.ts'

/* the picker and the editor are the heavy half and only a request needs them,
   so they load late the way the teammate console's stage does */
const EchoPicker = lazy(async () => ({
  default: (await import('@/modules/simulation/features/echoes/Picker.tsx')).EchoPicker,
}))

const Edit = lazy(async () => ({
  default: (await import('@/modules/simulation/features/echoes/Edit.tsx')).Edit,
}))

/* the build's cost ceiling, the same figure the pane and the clipboard hold */
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

  // the surface asking can be standing on any profile, so read the live
  // participant runtime when there is one and the stored one otherwise
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
  const runtime = scenarioId
    ? scenarioRuntime
    : partRtsById[resonatorId] ?? initRtsById[resonatorId] ?? null

  const { closing, hide, open, show, visible } = useAppModal()

  useEffect(() => {
    show()
  }, [show])

  const closeConsole = useCallback(() => {
    hide(() => {
      closeRequest()
    })
  }, [closeRequest, hide])

  const echo = runtime?.build.echoes[slotIndex] ?? null

  /* the mode is decided by what the slot held when the request landed: filling
     an empty slot must not swap the picker for the editor mid-pick */
  const [mode] = useState<'pick' | 'edit'>(() => (echo ? 'edit' : 'pick'))

  const allEchoes = useMemo(() => listEchoes(), [])

  const totalCost = useMemo(
    () => (runtime ? cmptTtlEchoC(runtime.build.echoes) : 0),
    [runtime],
  )

  const slotCost = echo ? getEchoById(echo.id)?.cost ?? 0 : 0
  const maxCost = MAX_ECHO_COST - totalCost + slotCost

  // Close if the slot's owner leaves the runtime graph.
  useEffect(() => {
    if (visible && !closing && !runtime) {
      closeConsole()
    }
  }, [closeConsole, closing, runtime, visible])

  const writeSlot = useCallback((next: EchoInstance | null) => {
    const update = scenarioId
      ? (updater: (prev: ResRuntime) => ResRuntime) => updScenarioResRt(scenarioId, resonatorId, updater)
      : (updater: (prev: ResRuntime) => ResRuntime) => updResRt(resonatorId, updater)
    update((prev) => {
      const echoes = [...prev.build.echoes]
      echoes[slotIndex] = next
      return { ...prev, build: { ...prev.build, echoes } }
    })
  }, [resonatorId, scenarioId, slotIndex, updResRt, updScenarioResRt])

  const onSelect = useCallback((echoId: string) => {
    // the slot's own cost is added back before the check, so replacing an echo
    // only measures the net build cost
    const definition = getEchoById(echoId)
    if (!definition || definition.cost > maxCost) return

    const instance = mkDefEchoNst(echoId, slotIndex, echo)
    if (!instance) return

    writeSlot(instance)
    bumpPickerFreq({ bucket: 'echo', ids: [instance.id] })
  }, [bumpPickerFreq, echo, maxCost, slotIndex, writeSlot])

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

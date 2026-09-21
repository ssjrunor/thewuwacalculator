/*
  Author: Runor Ewhro
  Description: Session-wide, non-persisted ownership for authored rotation
               drafts. A draft follows its rotation owner across route mounts
               without being rewritten by Simulation persistence updates.
*/

import { useCallback, useEffect, useRef, useState } from 'react'
import { createStore, useStore } from 'zustand'
import type { RotationNode } from '@/domain/gameData/contracts.ts'
import type {
  EditorSection,
  LoopRunSelections,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { withRunMetadata, type RunResult } from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import type { RotationEditHistory } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/history.ts'

export interface RotationEditorSession {
  result: RunResult | null
  sections: EditorSection[]
  runsByLoopId: LoopRunSelections
  lastRanAt: number | null
  editHistory: RotationEditHistory
  /** The program against which authored execution changes are considered dirty. */
  baselineItems: RotationNode[]
  runBaselineKey: string

  runBaselineSigs: Map<string, string>
  simulationKey: string
  /** Prepared Simulation workspace that produced `result` and evaluated rows. */
  runInputIdentity: object | null
}

type SessionUpdate = (current: RotationEditorSession) => RotationEditorSession

interface RotationEditorSessionState {
  byOwnerId: Record<string, RotationEditorSession>
  generationByOwnerId: Record<string, number>
}

const rotationEditorSessionStore = createStore<RotationEditorSessionState>(() => ({
  byOwnerId: {},
  generationByOwnerId: {},
}))

export function getRotationEditorSession(ownerId: string): RotationEditorSession | null {
  return rotationEditorSessionStore.getState().byOwnerId[ownerId] ?? null
}

export function getRotationEditorSessionGeneration(ownerId: string): number {
  return rotationEditorSessionStore.getState().generationByOwnerId[ownerId] ?? 0
}

/** Build once for an owner. The factory is deliberately not read again. */
export function ensureRotationEditorSession(
  ownerId: string,
  create: () => RotationEditorSession,
): RotationEditorSession {
  const current = getRotationEditorSession(ownerId)
  if (current) return current

  const created = create()
  rotationEditorSessionStore.setState((state) => ({
    byOwnerId: {
      ...state.byOwnerId,
      [ownerId]: created,
    },
  }))
  return created
}

/**
 * Refresh only the evaluated side of a standing draft when Simulation inputs
 * change. The caller decides how authored sections/history are preserved; the
 * store makes the refresh once per immutable workspace identity and retains
 * the last authored Run's date and timing for the standing readout.
 */
export function reconcileRotationEditorSession(
  ownerId: string,
  runInputIdentity: object | null,
  reconcile: SessionUpdate,
): RotationEditorSession | null {
  const current = getRotationEditorSession(ownerId)
  if (!current || current.runInputIdentity === runInputIdentity) return current

  const evaluated = reconcile(current)
  const refreshed = current.result && evaluated.result
    ? {
        ...evaluated,
        result: withRunMetadata(evaluated.result, {
          ranAt: current.result.ranAt,
          timing: current.result.timing,
        }),
      }
    : evaluated
  const next = refreshed.runInputIdentity === runInputIdentity
    ? refreshed
    : { ...refreshed, runInputIdentity }
  rotationEditorSessionStore.setState((state) => ({
    byOwnerId: {
      ...state.byOwnerId,
      [ownerId]: next,
    },
  }))
  return next
}

export function updateRotationEditorSession(
  ownerId: string,
  update: SessionUpdate,
): void {
  rotationEditorSessionStore.setState((state) => {
    const current = state.byOwnerId[ownerId]
    if (!current) return state
    const next = update(current)
    if (next === current) return state
    return {
      byOwnerId: {
        ...state.byOwnerId,
        [ownerId]: next,
      },
    }
  })
}

/**
 * Explicit document replacement is the only ordinary workflow that discards a
 * draft. The generation changes even when that owner has not mounted yet, so a
 * load and a same-owner replacement both seed from the incoming scenario.
 */
export function clearRotationEditorSession(ownerId: string): void {
  rotationEditorSessionStore.setState((state) => {
    const next = { ...state.byOwnerId }
    delete next[ownerId]
    return {
      byOwnerId: next,
      generationByOwnerId: {
        ...state.generationByOwnerId,
        [ownerId]: (state.generationByOwnerId[ownerId] ?? 0) + 1,
      },
    }
  })
}

export function clearAllRotationEditorSessions(): void {
  rotationEditorSessionStore.setState({ byOwnerId: {}, generationByOwnerId: {} })
}

export function useRotationEditorSession(
  ownerId: string,
  runInputIdentity: object | null,
  create: () => RotationEditorSession,
  reconcile: SessionUpdate,
) {
  const [initial] = useState(() => ({ ownerId, session: create() }))
  const session = useStore(
    rotationEditorSessionStore,
    (state) => state.byOwnerId[ownerId],
  )
  const generation = useStore(
    rotationEditorSessionStore,
    (state) => state.generationByOwnerId[ownerId] ?? 0,
  )
  const createRef = useRef(create)
  useEffect(() => {
    createRef.current = create
  }, [create])

  useEffect(() => {
    ensureRotationEditorSession(ownerId, () => (
      initial.ownerId === ownerId && generation === 0
        ? initial.session
        : createRef.current()
    ))
    reconcileRotationEditorSession(ownerId, runInputIdentity, reconcile)
  }, [generation, initial, ownerId, reconcile, runInputIdentity])

  const updateSession = useCallback((update: SessionUpdate) => {
    updateRotationEditorSession(ownerId, update)
  }, [ownerId])

  return {
    ...(session ?? (initial.ownerId === ownerId ? initial.session : create())),
    updateSession,
  }
}

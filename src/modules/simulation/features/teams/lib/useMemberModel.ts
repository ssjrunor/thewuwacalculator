/*
  Author: Runor Ewhro
  Description: Resolves a scenario member's runtime, team ordering, visible
               source states, combat stats, target routing, and update actions.
*/

import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { CombatScenario, CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import type { SavedBuild } from '@/domain/entities/inventoryStorage.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { setResRtSequence } from '@/engine/gameData/resonatorMax.ts'
import { makeSourceCat } from '@/engine/services/runtimeSourceService.ts'
import { findCombatPart, makeCombatGraph } from '@/engine/runtime/combatGraph.ts'
import { selActTgtSlc, selEnemyProf, selWorkDrvd } from '@/application/state'
import { useAppStore } from '@/application/state'
import { makeCombatEnv } from '@/engine/pipeline/buildCombatContext.ts'
import { isSourceVisible } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import {
  makeStatsTree,
  makeStatsView,
  type StatTreeNode,
  type StatsView,
} from '@/modules/simulation/model/statsView.ts'
import { mkSelTrgtByR } from '@/modules/simulation/model/teamTargets.ts'
import { getResonator, type ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { flattenScenarioRouting } from '@/engine/runtime/scenarioRuntime.ts'
import { applyRuntimeToSimulation, materializeScenarioRuntime } from '@/engine/runtime/runtimeAdapters.ts'
import { prepareCombatScenarioForUi } from '@/engine/pipeline/combatScenario.ts'
import { splitScopedTargetOwnerKey } from '@/domain/gameData/targetRouting.ts'
import { useTeamSlots } from './teamSlots.ts'

const EMPTY_RUNTIME_MAP: Record<string, ResRuntime> = Object.freeze({})

export interface MemberModel {
  /** Selected member, or null when absent from the resolved team. */
  member: ResView | null
  memberRt: ResRuntime | null
  /** Active runtime used when evaluating teammate-dependent visibility. */
  actRt: ResRuntime | null
  /** Resolved team ordered with the active subject first. */
  roster: ResView[]
  isActive: boolean
  sttDefs: SourceState[]
  cmbtSttsView: StatsView | null
  /** Nested projection of the same final stats used by the flat view. */
  cmbtSttsTree: StatTreeNode[]
  invBlds: SavedBuild[]
  onSqncChng: (value: number) => void
  onRtPdt: RtUpdHnd
  setTeamMember: (slotIndex: number, resonatorId: string | null) => void
  setTeam: (supportIds: readonly (string | null)[]) => void
  getSelTgt: (ownerKey: string) => string | null
  setSelTgt: (ownerKey: string, tgtResId: string | null) => void
}

export function useMemberModel(
  memberId: string | null,
  scenarioId?: CombatScenarioId | null,
  draft?: {
    scenario: CombatScenario
    updateScenario: (updater: (scenario: CombatScenario) => CombatScenario) => void
  },
): MemberModel {
  const { setMember: setTeamMember, setTeam } = useTeamSlots({
    scenarioId,
    updateScenario: draft?.updateScenario,
  })
  const { actRt: selectedRuntime, partRtsById: selectedPartRtsById } = useAppStore(useShallow(selWorkDrvd))
  const selectedEnemyProfile = useAppStore(selEnemyProf)
  const selectedTargets = useAppStore(selActTgtSlc)
  const targetScenario = useAppStore((state) => (
    scenarioId ? state.combat.scenariosById[scenarioId] ?? null : null
  ))
  const resolvedScenario = draft?.scenario ?? targetScenario
  const preparedScenario = useMemo(
    () => resolvedScenario ? prepareCombatScenarioForUi(resolvedScenario) : null,
    [resolvedScenario],
  )
  const runtime = scenarioId ? preparedScenario?.subjectRuntime ?? null : selectedRuntime
  const partRtsById = scenarioId
    ? preparedScenario?.runtimesById ?? EMPTY_RUNTIME_MAP
    : selectedPartRtsById
  const enemyProfile = scenarioId ? resolvedScenario?.target ?? selectedEnemyProfile : selectedEnemyProfile
  const selTrgtByOwn = useMemo(
    () => scenarioId && resolvedScenario ? flattenScenarioRouting(resolvedScenario) : selectedTargets,
    [resolvedScenario, scenarioId, selectedTargets],
  )
  const invBlds = useAppStore((state) => state.library.builds)
  const updResRt = useAppStore((state) => state.updResRt)
  const updScenarioResRt = useAppStore((state) => state.updScenarioResRt)
  const setTargetRes = useAppStore((state) => state.setResTgt)
  const setScenarioRouting = useAppStore((state) => state.setScenarioRouting)

  const member = memberId ? getResonator(memberId) : null
  const memberRt = memberId ? partRtsById[memberId] ?? null : null

  // Preserve the active resonator at index zero while dropping unresolved support slots.
  const roster = useMemo(() => {
    if (!runtime) {
      return []
    }

    return [runtime.id, ...runtime.build.team.slice(1)].flatMap((mateId) => {
      if (!mateId || !partRtsById[mateId]) {
        return []
      }

      const mate = getResonator(mateId)
      return mate ? [mate] : []
    })
  }, [partRtsById, runtime])

  const sttDefs = useMemo(() => {
    if (!memberRt || !runtime) {
      return []
    }

    // Team-targeted state visibility depends on the active runtime and composition.
    return makeSourceCat(memberRt).states
      .filter((state) => isSourceVisible(memberRt, memberRt, state, runtime))
      .filter((state) => state.source.type !== 'echo')
  }, [memberRt, runtime])

  const cmbtStts = useMemo(() => {
    const none = { view: null, tree: [] as StatTreeNode[] }
    if (!memberRt || !runtime) {
      return none
    }

    const scenarioContext = preparedScenario?.workspace.cntxByResId[memberRt.id] ?? null
    if (scenarioContext) {
      return {
        view: makeStatsView(memberRt, scenarioContext.finalStats),
        tree: makeStatsTree(scenarioContext.finalStats),
      }
    }

    const activeSeed = getResSeedBy(runtime.id)
    if (!activeSeed) {
      return none
    }

    const graph = makeCombatGraph({
      actRt: runtime,
      activeSeed,
      partRts: {
        ...partRtsById,
        [memberRt.id]: memberRt,
      },
      targetsByRes: mkSelTrgtByR(runtime.build.team, selTrgtByOwn),
    })

    const targetSlotId = findCombatPart(graph, memberRt.id)
    if (!targetSlotId) {
      return none
    }

    const context = makeCombatEnv({
      graph,
      targetSlotId,
      enemy: enemyProfile,
    })

    return {
      view: makeStatsView(memberRt, context.finalStats),
      tree: makeStatsTree(context.finalStats),
    }
  }, [enemyProfile, memberRt, partRtsById, preparedScenario, runtime, selTrgtByOwn])

  const onSqncChng = useCallback((value: number) => {
    if (!memberId) return
    if (draft) {
      draft.updateScenario((scenario) => {
        const current = materializeScenarioRuntime(scenario, memberId)
        if (!current) return scenario
        const next = setResRtSequence(current, getResDtlsBy()[current.id], value)
        return applyRuntimeToSimulation(scenario, memberId, next).scenario
      })
      return
    }
    const update = scenarioId
      ? (updater: (runtime: ResRuntime) => ResRuntime) => updScenarioResRt(scenarioId, memberId, updater)
      : (updater: (runtime: ResRuntime) => ResRuntime) => updResRt(memberId, updater)
    update((prev) => setResRtSequence(prev, getResDtlsBy()[prev.id], value))
  }, [draft, memberId, scenarioId, updResRt, updScenarioResRt])

  const onRtPdt = useCallback<RtUpdHnd>((updater) => {
    if (!memberId) return
    if (draft) {
      draft.updateScenario((scenario) => {
        const current = materializeScenarioRuntime(scenario, memberId)
        return current
          ? applyRuntimeToSimulation(scenario, memberId, updater(current)).scenario
          : scenario
      })
      return
    }
    if (scenarioId) updScenarioResRt(scenarioId, memberId, updater)
    else updResRt(memberId, updater)
  }, [draft, memberId, scenarioId, updResRt, updScenarioResRt])

  const getSelTgt = useCallback(
    (ownerKey: string) => selTrgtByOwn[ownerKey] ?? null,
    [selTrgtByOwn],
  )

  const setSelTgt = useCallback((ownerKey: string, tgtResId: string | null) => {
    if (!memberId) return
    if (draft) {
      draft.updateScenario((scenario) => {
        const sourceMember = scenario.team.members.find(
          (candidate) => candidate.resonatorId === memberId,
        )
        const targetMember = tgtResId
          ? scenario.team.members.find((candidate) => candidate.resonatorId === tgtResId) ?? null
          : null
        if (!sourceMember || (tgtResId && !targetMember)) return scenario
        const routeId = splitScopedTargetOwnerKey(ownerKey).ownerKey
        const bySourceMemberId = {
          ...scenario.environment.routing.bySourceMemberId,
          [sourceMember.id]: {
            ...scenario.environment.routing.bySourceMemberId[sourceMember.id],
            [routeId]: targetMember?.id ?? null,
          },
        }
        return {
          ...scenario,
          environment: {
            ...scenario.environment,
            routing: { bySourceMemberId },
          },
        }
      })
      return
    }
    if (!scenarioId || !targetScenario) {
      setTargetRes(memberId, ownerKey, tgtResId)
      return
    }
    const sourceMember = targetScenario.team.members.find(
      (candidate) => candidate.resonatorId === memberId,
    )
    const targetMember = tgtResId
      ? targetScenario.team.members.find((candidate) => candidate.resonatorId === tgtResId) ?? null
      : null
    if (!sourceMember || (tgtResId && !targetMember)) return
    setScenarioRouting(
      scenarioId,
      sourceMember.id,
      splitScopedTargetOwnerKey(ownerKey).ownerKey,
      targetMember?.id ?? null,
    )
  }, [draft, memberId, scenarioId, setScenarioRouting, setTargetRes, targetScenario])

  return {
    member,
    memberRt,
    actRt: runtime,
    roster,
    isActive: Boolean(member && runtime && member.id === runtime.id),
    sttDefs,
    cmbtSttsView: cmbtStts.view,
    cmbtSttsTree: cmbtStts.tree,
    invBlds,
    onSqncChng,
    onRtPdt,
    setTeamMember,
    setTeam,
    getSelTgt,
    setSelTgt,
  }
}

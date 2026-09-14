/*
  Author: Runor Ewhro
  Description: One account of a single team member: who they are, the runtime
               that resolves them, the states they can drive, their live combat
               stats, and the writers that persist an edit. The console modal
               and Modulation both stand on this, so neither derives
               it again.

               The team is stored on the profile that holds it, so a member is
               only addressable while that profile is the one in front: this
               resolves the resonator in the subject slot and the two supports
               it carries, which is exactly the set the store can write.
*/

import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import type { SavedBuild } from '@/domain/entities/inventoryStorage.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import { getResSeedBy } from '@/domain/services/resonatorSeedService.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { setResRtSequence } from '@/domain/gameData/resonatorMax.ts'
import { makeSourceCat } from '@/domain/services/runtimeSourceService.ts'
import { findCombatPart, makeCombatGraph } from '@/domain/state/combatGraph.ts'
import { selActTgtSlc, selEnemyProf, selWorkDrvd } from '@/domain/state/selectors.ts'
import { useAppStore } from '@/domain/state/store.ts'
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
import { flattenScenarioRouting } from '@/domain/state/scenarioRuntime.ts'
import { prepareCombatScenarioForUi } from '@/engine/pipeline/combatScenario.ts'
import { splitScopedTargetOwnerKey } from '@/domain/gameData/targetRouting.ts'

const EMPTY_RUNTIME_MAP: Record<string, ResRuntime> = Object.freeze({})

export interface MemberModel {
  /* the member being read, null while the team does not carry them */
  member: ResView | null
  memberRt: ResRuntime | null
  /* the resonator in front, which teammate visibility is evaluated against */
  actRt: ResRuntime | null
  /* the whole team, subject first */
  roster: ResView[]
  isActive: boolean
  sttDefs: SourceState[]
  cmbtSttsView: StatsView | null
  /* the same final stats read as the nested tree, so a surface that shows both
     the view and what the view leaves out builds the graph once */
  cmbtSttsTree: StatTreeNode[]
  invBlds: SavedBuild[]
  onSqncChng: (value: number) => void
  onRtPdt: RtUpdHnd
  getSelTgt: (ownerKey: string) => string | null
  setSelTgt: (ownerKey: string, tgtResId: string | null) => void
}

export function useMemberModel(
  memberId: string | null,
  scenarioId?: CombatScenarioId | null,
): MemberModel {
  const { actRt: selectedRuntime, partRtsById: selectedPartRtsById } = useAppStore(useShallow(selWorkDrvd))
  const selectedEnemyProfile = useAppStore(selEnemyProf)
  const selectedTargets = useAppStore(selActTgtSlc)
  const targetScenario = useAppStore((state) => (
    scenarioId ? state.combat.scenariosById[scenarioId] ?? null : null
  ))
  const preparedScenario = useMemo(
    () => targetScenario ? prepareCombatScenarioForUi(targetScenario) : null,
    [targetScenario],
  )
  const runtime = scenarioId ? preparedScenario?.subjectRuntime ?? null : selectedRuntime
  const partRtsById = scenarioId
    ? preparedScenario?.runtimesById ?? EMPTY_RUNTIME_MAP
    : selectedPartRtsById
  const enemyProfile = scenarioId ? targetScenario?.target ?? selectedEnemyProfile : selectedEnemyProfile
  const selTrgtByOwn = useMemo(
    () => scenarioId && targetScenario ? flattenScenarioRouting(targetScenario) : selectedTargets,
    [scenarioId, selectedTargets, targetScenario],
  )
  const invBlds = useAppStore((state) => state.library.builds)
  const updResRt = useAppStore((state) => state.updResRt)
  const updScenarioResRt = useAppStore((state) => state.updScenarioResRt)
  const setTargetRes = useAppStore((state) => state.setResTgt)
  const setScenarioRouting = useAppStore((state) => state.setScenarioRouting)

  const member = memberId ? getResonator(memberId) : null
  const memberRt = memberId ? partRtsById[memberId] ?? null : null

  // slot zero is the resonator in front and stays part of the derived roster
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

    // teammate state visibility is evaluated against the runtime in front
    // because team-targeted effects depend on the current composition.
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
    const update = scenarioId
      ? (updater: (runtime: ResRuntime) => ResRuntime) => updScenarioResRt(scenarioId, memberId, updater)
      : (updater: (runtime: ResRuntime) => ResRuntime) => updResRt(memberId, updater)
    update((prev) => setResRtSequence(prev, getResDtlsBy()[prev.id], value))
  }, [memberId, scenarioId, updResRt, updScenarioResRt])

  const onRtPdt = useCallback<RtUpdHnd>((updater) => {
    if (!memberId) return
    if (scenarioId) updScenarioResRt(scenarioId, memberId, updater)
    else updResRt(memberId, updater)
  }, [memberId, scenarioId, updResRt, updScenarioResRt])

  const getSelTgt = useCallback(
    (ownerKey: string) => selTrgtByOwn[ownerKey] ?? null,
    [selTrgtByOwn],
  )

  const setSelTgt = useCallback((ownerKey: string, tgtResId: string | null) => {
    if (!memberId) return
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
  }, [memberId, scenarioId, setScenarioRouting, setTargetRes, targetScenario])

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
    getSelTgt,
    setSelTgt,
  }
}

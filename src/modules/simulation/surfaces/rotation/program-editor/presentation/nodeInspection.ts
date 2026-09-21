/*
  Author: Runor Ewhro
  Description: Builds inspection projections for authored nodes, executed results, and loop passes.
*/

/* Simulation-backed details displayed for one editor node. */

import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { srcAssetIcon, type RunResult } from '@/modules/simulation/surfaces/rotation/program-editor/simulation/runProgram.ts'
import type { BuffLine, EditorStep } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { stepHasRun } from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import { makeStateSummary } from '@/modules/simulation/model/stateSummary.ts'

export function buildBuffLines({
  result,
  selectedStep,
  disabled,
  runtime,
  runtimesById,
  enemy,
  run,
}: {
  result: RunResult | null | undefined
  selectedStep: EditorStep | null
  disabled: boolean | undefined
  runtime: ResRuntime | null | undefined
  runtimesById: Record<string, ResRuntime>
  enemy: EnemyProfile
  run: number
}): BuffLine[] {
  if (!result || !selectedStep || !runtime || disabled || !stepHasRun(selectedStep, run)) {
    return []
  }

  const snapshot = result.snapshots.get(`${selectedStep.id}:${run}`)
    ?? (!selectedStep.loopScoped
      ? result.snapshots.get(`${selectedStep.id}:1`)
      : undefined)
  if (!snapshot) return []

  const snapshotRuntimes = snapshot.entry.runtimeById ?? {}
  const runtimes = {
    ...runtimesById,
    ...snapshotRuntimes,
    [runtime.id]: snapshotRuntimes[runtime.id] ?? runtime,
  }
  const targetRuntime = runtimes[snapshot.resonatorId] ?? runtime
  const activeId = snapshot.entry.activeResonatorId ?? runtime.id
  const activeRuntime = runtimes[activeId] ?? targetRuntime

  return makeStateSummary(
    targetRuntime,
    runtimes,
    null,
    snapshot.entry.selectedTargetsByRuntimeId?.[targetRuntime.id] ?? null,
    {
      enemyProfile: snapshot.entry.enemy ?? enemy,
      activeRuntime,
      skillTarget: { resonatorId: snapshot.resonatorId, skill: snapshot.skill },
    },
  ).flatMap((group) =>
    group.scopes.flatMap((scope) =>
      scope.nodes
        .filter((node) => node.effectLabels.length > 0)
        .map((node) => ({
          id: `${group.id}:${scope.id}:${node.id}`,
          name: node.ownerLabel,
          icon: srcAssetIcon(node.source) ?? group.srcProf,
          effects: node.effectLabels,
        })),
    ),
  )
}

/*
  Author: Runor Ewhro
  Description: Coordinates optimizer compilation, execution, result selection, preview, and application.
*/

import type { ReactNode, Ref } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/application/state'
import { selVrvwDrvd } from '@/application/state'
import { ATTR_COLORS } from '@/modules/simulation/model/display'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { EvaluationBand } from '@/modules/simulation/surfaces/modulation/EvaluationBand.tsx'
import { useAsmEvaluationReport } from '@/modules/simulation/model/useBuildEvaluation.ts'
import {
  getBuildEvaluationGrade,
  getBuildEvaluationTone,
} from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { OptimizerEchoPreview } from '@/modules/simulation/surfaces/optimizer/transport/OptimizerEchoPreview.tsx'

// The rail and band score only canonical state. Keep their assembly settled
// while rail edits are arriving without involving the disposable Echo preview.
const CANONICAL_SCORE_DEBOUNCE_MS = 320

export function OptimizerLab({
  resonatorId,
  resonatorName,
  runtime,
  previewKey,
  previewEchoes,
  bandFolded,
  bandRef,
  editable,
  onEquipPreview,
  children,
}: {
  resonatorId: string
  resonatorName: string
  runtime: ResRuntime | null
  previewKey: string
  previewEchoes: Array<EchoInstance | null>
  bandFolded: boolean
  bandRef?: Ref<HTMLDivElement>

  editable: boolean
  onEquipPreview: (echoes: Array<EchoInstance | null>) => void
  children: ReactNode
}) {
  const { partRtsById, actTgtSels } = useAppStore(useShallow(selVrvwDrvd))

  const { report } = useAsmEvaluationReport({
    runtime,
    runtimesById: partRtsById,
    targetSelections: actTgtSels,
    debounceMs: CANONICAL_SCORE_DEBOUNCE_MS,
  })
  const score = report ? report.evaluation.percent * 100 : null
  const grade = getBuildEvaluationGrade(score)
  const subject = getResonator(resonatorId)
  const tone = score != null
    ? getBuildEvaluationTone(score).color
    : subject ? ATTR_COLORS[subject.attribute] : '#20bfb9'

  return (
    <main className="workspace-main" data-phase="idle">
      <div ref={bandRef} className="opt-lab-band" data-folded={bandFolded ? '' : undefined}>
        <EvaluationBand report={report} score={score} grade={grade} tone={tone} />
      </div>

      {runtime ? (
        <OptimizerEchoPreview
          previewKey={previewKey}
          resonatorId={resonatorId}
          resonatorName={resonatorName}
          runtime={runtime}
          sourceEchoes={previewEchoes}
          editable={editable}
          onEquip={onEquipPreview}
        />
      ) : null}

      <section className="workspace-section workspace-span opt-lab-run">
        {children}
      </section>
    </main>
  )
}

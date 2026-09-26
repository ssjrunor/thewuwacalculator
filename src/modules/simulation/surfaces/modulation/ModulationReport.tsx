/*
  Author: Runor Ewhro
  Description: Connects evaluation report state to the Modulation band,
               loadout, stat overview, rotation, and detail sections.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import type { EvaluationBuildSnapshot, EvaluationEchoSlot, BuildEvaluationReport } from '@/engine/evaluation/buildEvaluation.ts'
import type { StatTreeNode } from '@/modules/simulation/model/statsView.ts'
import { ActiveStateSources } from '@/modules/simulation/features/controls/ActiveStateSources.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import type { ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { getBuildEvaluationTone } from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { CtnSqnc } from '@/modules/simulation/surfaces/modulation/ActionSequence.tsx'
import { SeatStack } from '@/modules/simulation/surfaces/modulation/SeatStack.tsx'
import { mkSqnc } from '@/modules/simulation/surfaces/modulation/lib/rotationSequence.ts'
import { makeConditionChoices, visibleRotMembers } from '@/modules/simulation/surfaces/rotation/shared/catalog.ts'
import {
  BUILD_LABEL,
  DETAIL_BUILD_LABEL,
  DETAIL_BUILD_ORDER,
  EchoCard,
  type EvaluationEchoActions,
  type EvaluationEchoSelection,
  type DetailBuildKey,
} from '@/modules/simulation/workspace/ui.tsx'
import { EvaluationBand } from './EvaluationBand.tsx'
import { LoadoutHead } from '@/modules/simulation/workspace/LoadoutHead.tsx'
import { ModulationView, findScroller, memberAccent, type ModulationPanel } from './Modulation.tsx'
import type { MemberAnalysisSource } from './lib/memberSim.ts'
import { AlternativesTable, BuildDossier, StatRelevance } from './EvaluationReport.tsx'

export function ModulationReport({
  phase,
  modulation,
  modulationRuntime,
  modulationActRt,
  modulationAnalysisSource,
  modulationDark,
  modulationRoster,
  modulationMemberId,
  onModulationMember,
  onModulationUpdate,
  loading,
  report,
  detailReport,
  detailReportReady,
  detailReportLoading,
  reportOpen,
  onReportOpen,
  onReportClose,
  activeBuild,
  referenceBuild,
  maximumBuild,
  score,
  grade,
  tone,
  banner,
  detailBuildKey,
  setDetailBuildKey,
  mainStackRef,
  stateGroups,
  reportRuntime,
  reportRuntimesById,
  enemyId,
  echoSelection,
  echoActions,
  echoScores,
  loadoutSlots,
  sourceEchoes,
  onEchoOpen,
  overviewStatsTree,
  echoRuntime,
  echoScenarioId,
  echoResonatorName,
  echoEditable,
  canSaveEcho,
  onEchoLoadout,
}: {
  phase: 'idle' | 'out' | 'in'
  modulation: boolean
  modulationRuntime: ResRuntime | null
  modulationActRt: ResRuntime | null
  modulationAnalysisSource: MemberAnalysisSource | null
  modulationDark: boolean
  modulationRoster: ResView[]
  modulationMemberId: string | null
  onModulationMember: (resonatorId: string) => void
  onModulationUpdate: (updater: (runtime: ResRuntime) => ResRuntime) => void
  loading: boolean
  report: BuildEvaluationReport | null
  detailReport: BuildEvaluationReport | null
  detailReportReady: boolean
  detailReportLoading: boolean
  reportOpen: boolean
  onReportOpen: () => void
  onReportClose: () => void
  activeBuild: EvaluationBuildSnapshot | null
  referenceBuild: EvaluationBuildSnapshot | null
  maximumBuild: EvaluationBuildSnapshot | null
  score: number | null
  grade: string | null
  tone: string
  banner: ReactNode
  detailBuildKey: DetailBuildKey
  setDetailBuildKey: Dispatch<SetStateAction<DetailBuildKey>>
  mainStackRef: RefObject<HTMLDivElement | null>
  stateGroups: ComponentProps<typeof ActiveStateSources>['groups']
  reportRuntime: ResRuntime | null
  reportRuntimesById: Record<string, ResRuntime>
  enemyId: string
  echoSelection?: EvaluationEchoSelection
  echoActions?: EvaluationEchoActions
  echoScores?: Array<number | null> | null
  loadoutSlots: Array<EvaluationEchoSlot | null>
  sourceEchoes: Array<EchoInstance | null>
  onEchoOpen?: (slotIndex: number) => void
  overviewStatsTree: StatTreeNode[]
  /** Runtime used by loadout mutations; null prevents writes to a stale report. */
  echoRuntime: ResRuntime | null
  echoScenarioId: CombatScenarioId
  echoResonatorName?: string | null
  echoEditable: boolean
  canSaveEcho: (echo: EchoInstance) => boolean
  onEchoLoadout: (echoes: Array<EchoInstance | null>) => void
}) {
  const rotationModal = useAppModal()
  const [modulationPanel, setModulationPanel] = useState<ModulationPanel>('stats')
  const loadoutHead = useRef<HTMLElement | null>(null)
  const [seatOut, setSeatOut] = useState(false)

  useEffect(() => {
    const node = loadoutHead.current
    if (!modulation || !node) return

    const scroller = findScroller(node)
    if (!scroller) return

    const read = () => {
      const gone = node.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().top
      setSeatOut((was) => (was === gone ? was : gone))
    }

    queueMicrotask(read)
    scroller.addEventListener('scroll', read, { passive: true })
    window.addEventListener('resize', read)
    return () => {
      scroller.removeEventListener('scroll', read)
      window.removeEventListener('resize', read)
    }
  }, [modulation, modulationPanel])
  const rotation = report?.rotation ?? null
  const sequence = useMemo(
    () => rotation
      ? mkSqnc({
          items: rotation.items,
          resonatorId: rotation.resonatorId,
        })
      : null,
    [rotation],
  )
  const condChoices = useMemo(
    () => reportRuntime
      ? makeConditionChoices(visibleRotMembers(reportRuntime, reportRuntimesById), reportRuntime, enemyId)
      : [],
    [enemyId, reportRuntime, reportRuntimesById],
  )
  const rotationAction = rotation ? (
    <button
      type="button" className="workspace-rotation-sequence-link"
      onClick={() => rotationModal.show()}
    >
      Details
    </button>
  ) : null
  const echoSurfaceProps = echoSelection?.surfaceProps ?? {}
  const selectedDetailBuildKey = detailBuildKey
  const selectedDetailBuild = report?.evaluation.builds[selectedDetailBuildKey] ?? activeBuild
  const evaluationMatchesModulationMember = modulationRuntime?.id === reportRuntime?.id

  const viewedMember = modulationRoster.find((mate) => mate.id === modulationMemberId) ?? null
  const echoLoadout = (
    <section className="workspace-section workspace-span workspace-ink"
      style={modulation ? memberAccent(viewedMember) : undefined}
    >
      <LoadoutHead
        headRef={loadoutHead}
        runtime={echoRuntime}
        scenarioId={echoScenarioId}
        resonatorName={echoResonatorName}
        echoes={sourceEchoes}
        editable={echoEditable}
        canSaveEcho={canSaveEcho}
        onEchoes={onEchoLoadout}
        aside={modulation && modulationRoster.length > 0 ? (
          <SeatStack roster={modulationRoster} memberId={modulationMemberId} onMember={onModulationMember} />
        ) : null}
      />
      <div className="workspace-echoes" {...echoSurfaceProps}>
        {Array.from({ length: 5 }, (_, index) => (
          <EchoCard
            key={index}
            echo={loadoutSlots[index] ?? null}
            sourceEcho={sourceEchoes[index] ?? null}
            index={index}
            selection={echoSelection}
            actions={echoActions}
            score={echoScores?.[index] ?? null}
            onOpen={onEchoOpen ? () => onEchoOpen(index) : undefined}
          />
        ))}
      </div>
    </section>
  )

  return (
    <>
      <div className="workspace-main" data-phase={phase}>
      <EvaluationBand report={report} score={score} grade={grade} tone={tone} banner={banner} />

      {echoLoadout}

      {modulation ? (
        modulationRuntime && modulationActRt && modulationAnalysisSource ? (
          <ModulationView
            runtime={modulationRuntime}
            actRt={modulationActRt}
            analysisSource={modulationAnalysisSource}
            isDark={modulationDark}
            onRtPdt={onModulationUpdate}
            view={modulationPanel}
            onView={setModulationPanel}
            roster={modulationRoster}
            memberId={modulationMemberId}
            onMember={onModulationMember}
            seatOut={seatOut}
            activeBuild={evaluationMatchesModulationMember ? activeBuild : null}
            referenceBuild={evaluationMatchesModulationMember ? referenceBuild : null}
            maximumBuild={evaluationMatchesModulationMember ? maximumBuild : null}
            report={report}
            detailReport={detailReport}
            detailReportReady={detailReportReady}
            detailReportLoading={detailReportLoading}
            reportOpen={reportOpen}
            onReportOpen={onReportOpen}
            onReportClose={onReportClose}
          />
        ) : null
      ) : !report || !activeBuild ? (
        loading ? null : (
          <section className="workspace-section workspace-span">
            <header className="workspace-section-head">
              <h3 className="workspace-section-title">Evaluation Report</h3>
              <span className="workspace-section-meta">Unavailable</span>
            </header>
            <p className="workspace-empty">No evaluation report is available for the current resonator.</p>
          </section>
        )
      ) : (
        <>
          <div className="workspace-main-body" data-side="on">
            <div ref={mainStackRef} className="workspace-main-stack">
              <section className="workspace-section">
                <header className="workspace-section-head">
                  <h3 className="workspace-section-title">Build Stats</h3>
                  <span className="workspace-section-meta">
                    Combat stats &amp; Sonata · current / 100% / 200%
                  </span>
                </header>
                <StatRelevance
                  active={activeBuild.overviewStats}
                  reference={referenceBuild?.overviewStats ?? activeBuild.overviewStats}
                  maximum={maximumBuild?.overviewStats ?? activeBuild.overviewStats}
                  invariantStats={report.evaluation.invariantStats}
                  activeSets={activeBuild.sets}
                  referenceSets={referenceBuild?.sets ?? activeBuild.sets}
                  maximumSets={maximumBuild?.sets ?? activeBuild.sets}
                  activeEchoes={activeBuild.echoes}
                  referenceEchoes={referenceBuild?.echoes ?? activeBuild.echoes}
                  maximumEchoes={maximumBuild?.echoes ?? activeBuild.echoes}
                  currentTone={tone}
                  referenceTone={getBuildEvaluationTone(100).color}
                  maximumTone={getBuildEvaluationTone(200).color}
                  showEvaluationTargets
                  overviewStatsTree={overviewStatsTree}
                />
              </section>

              {selectedDetailBuild ? (
              <section className="workspace-section">
                <header className="workspace-section-head">
                  <h3 className="workspace-section-title">Build Details</h3>
                  <div className="workspace-section-meta workspace-build-toggle" role="group" aria-label="Build detail view">
                    {DETAIL_BUILD_ORDER.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`workspace-build-toggle__btn${detailBuildKey === key ? ' is-active' : ''}`}
                        aria-pressed={detailBuildKey === key}
                        onClick={() => setDetailBuildKey(key)}
                      >
                        {DETAIL_BUILD_LABEL[key]}
                      </button>
                    ))}
                  </div>
                </header>
                <BuildDossier
                  label={BUILD_LABEL[selectedDetailBuildKey]}
                  build={selectedDetailBuild}
                  rotationAction={rotationAction}
                  showEchoStats
                  showRotationFeatures
                />
              </section>
              ) : null}

              <section className="workspace-section">
                <header className="workspace-section-head">
                  <h3 className="workspace-section-title">Upgrade Paths</h3>
                  <span className="workspace-section-meta">{report.alternatives.length} main stat &amp; Sonata paths</span>
                </header>
                {report.alternatives.length > 0 ? (
                  <AlternativesTable alternatives={report.alternatives} />
                ) : (
                  <p className="workspace-empty">No valid main stat or Sonata upgrades are available.</p>
                )}
              </section>
            </div>

            <ActiveStateSources
              groups={stateGroups}
              activeResId={reportRuntime?.id ?? null}
              memberCount={reportRuntime?.build.team.filter(Boolean).length ?? 0} className="workspace-state-sources"
              onImageError={withDefIconM}
            />
          </div>
        </>
      )}
      </div>

      <AppModal
        state={rotationModal.dialogProps}
        variant="rotation-action-list"
        ariaLabel="Evaluation rotation action sequence"
        onClose={rotationModal.hide}
      >
        <div className="rotation-action-list-modal__body">
          <div className="rotation-action-list-modal__head">
            <h2 className="confirmation-modal__title">{rotation?.name ?? 'Evaluation Rotation'}</h2>
            <ModalCloseButton onClick={() => rotationModal.hide()} />
          </div>
          <div className="rotation-action-list-modal__list">
            {sequence ? (
              <CtnSqnc
                actions={sequence.actions}
                condChoices={condChoices}
                entries={sequence.entries}
                spans={sequence.spans}
              />
            ) : null}
          </div>
        </div>
      </AppModal>
    </>
  )
}

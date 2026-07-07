import { useMemo } from 'react'
import type { ComponentProps, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { BenchRptSettings } from '@/domain/entities/preferences'
import type { BenchmarkBuildSnapshot, BenchmarkEchoSlot, BuildBenchmarkReport } from '@/data/scoring/buildBenchmark.ts'
import type { StatTreeNode } from '@/modules/calculator/model/statsView.ts'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay.tsx'
import { ActiveStateSources } from '@/modules/calculator/features/controls/ActiveStateSources.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { getBuildBenchmarkTone } from '@/modules/calculator/model/buildBenchmarkDisplay.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { CtnSqnc } from '@/modules/calculator/features/rotation/ActionSequence.tsx'
import { mkSqnc } from '@/modules/calculator/features/rotation/lib/sequence.ts'
import { cllcLoopNds } from '@/modules/calculator/features/rotation/lib/loops.ts'
import { mkRotCondChc, mkVlblRotMmb } from '@/modules/calculator/features/rotation/lib/setup.ts'
import {
  BUILD_LABEL,
  DETAIL_BUILD_LABEL,
  DETAIL_BUILD_ORDER,
  EchoCard,
  type BenchmarkEchoSelection,
  type DetailBuildKey,
} from './ui.tsx'
import { AlternativesTable, BenchmarkMeter, BuildDossier, StatRelevance } from './Report.tsx'

export function MainReport({
  phase,
  loading,
  report,
  activeBuild,
  benchmark100Build,
  benchmark200Build,
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
  loadoutSlots,
  sourceEchoes,
  settings,
  overviewStatsTree,
}: {
  phase: 'idle' | 'out' | 'in'
  loading: boolean
  report: BuildBenchmarkReport | null
  activeBuild: BenchmarkBuildSnapshot | null
  benchmark100Build: BenchmarkBuildSnapshot | null
  benchmark200Build: BenchmarkBuildSnapshot | null
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
  echoSelection?: BenchmarkEchoSelection
  loadoutSlots: Array<BenchmarkEchoSlot | null>
  sourceEchoes: Array<EchoInstance | null>
  settings: BenchRptSettings
  overviewStatsTree: StatTreeNode[]
}) {
  const rotationModal = useAppModal()
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
  const loopLabelById = useMemo(
    () => rotation
      ? new Map(
          cllcLoopNds(rotation.items)
            .filter((node) => node.kind === 'start')
            .map((node, index) => {
              const start = node as Extract<typeof node, { kind: 'start' }>
              return [start.loopId, start.label ?? `Loop ${index + 1}`] as const
            }),
        )
      : undefined,
    [rotation],
  )
  const condChoices = useMemo(
    () => reportRuntime
      ? mkRotCondChc(mkVlblRotMmb(reportRuntime, reportRuntimesById), reportRuntime, enemyId)
      : [],
    [enemyId, reportRuntime, reportRuntimesById],
  )
  const rotationAction = rotation ? (
    <button
      type="button"
      className="bench-rotation-sequence-link"
      onClick={() => rotationModal.show()}
    >
      Details
    </button>
  ) : null
  const echoSurfaceProps = echoSelection?.surfaceProps ?? {}
  const selectedDetailBuildKey = settings.benchmarkTargets ? detailBuildKey : 'active'
  const selectedDetailBuild = report?.benchmark.builds[selectedDetailBuildKey] ?? activeBuild
  const loadoutCount = loadoutSlots.filter(Boolean).length

  return (
    <>
      <div className="bench-main" data-phase={phase}>
      {report && activeBuild && score != null && grade ? (
        <BenchmarkMeter report={report} score={score} grade={grade} tone={tone} banner={banner} />
      ) : null}

      <section className="bench-section bench-span bench-loadout">
        <header className="bench-section-head">
          <h3 className="bench-section-title">Echo Loadout</h3>
          <span className="bench-section-meta">{loadoutCount}/5 equipped</span>
        </header>
        <div className="bench-echoes" {...echoSurfaceProps}>
          {Array.from({ length: 5 }, (_, index) => (
            <EchoCard
              key={index}
              echo={loadoutSlots[index] ?? null}
              sourceEcho={sourceEchoes[index] ?? null}
              index={index}
              selection={echoSelection}
            />
          ))}
        </div>
      </section>

      {!report || !activeBuild ? (
        <section className={`bench-section bench-span ${loading ? 'loading' : ''}`}>
          <header className="bench-section-head">
            <h3 className="bench-section-title">Benchmark Report</h3>
            <span className="bench-section-meta">{loading ? 'Building' : 'Unavailable'}</span>
          </header>
          {loading ? (
            <div className="bench-section-loader">
              <AppLdrVrly mode="centered" text="Building benchmark report..." />
            </div>
          ) : (
            <p className="bench-empty">No benchmark report is available for the selected resonator.</p>
          )}
        </section>
      ) : (
        <>
          <div className="bench-main-body" data-side={settings.activeStateSources ? 'on' : 'off'}>
            <div ref={mainStackRef} className="bench-main-stack">
              <section className="bench-section">
                <header className="bench-section-head">
                  <h3 className="bench-section-title">Build Stats</h3>
                  <span className="bench-section-meta">
                    {settings.benchmarkTargets ? 'Combat stats & Sonata · current / 100% / 200%' : 'Overview stat tree'}
                  </span>
                </header>
                <StatRelevance
                  active={activeBuild.overviewStats}
                  benchmark100={benchmark100Build?.overviewStats ?? activeBuild.overviewStats}
                  benchmark200={benchmark200Build?.overviewStats ?? activeBuild.overviewStats}
                  invariantStats={report.benchmark.invariantStats}
                  activeSets={activeBuild.sets}
                  benchmark100Sets={benchmark100Build?.sets ?? activeBuild.sets}
                  benchmark200Sets={benchmark200Build?.sets ?? activeBuild.sets}
                  activeEchoes={activeBuild.echoes}
                  benchmark100Echoes={benchmark100Build?.echoes ?? activeBuild.echoes}
                  benchmark200Echoes={benchmark200Build?.echoes ?? activeBuild.echoes}
                  currentTone={tone}
                  benchmark100Tone={getBuildBenchmarkTone(100).color}
                  benchmark200Tone={getBuildBenchmarkTone(200).color}
                  showBenchmarkTargets={settings.benchmarkTargets}
                  overviewStatsTree={overviewStatsTree}
                />
              </section>

              {settings.buildDetails && selectedDetailBuild ? (
              <section className="bench-section">
                <header className="bench-section-head">
                  <h3 className="bench-section-title">Build Details</h3>
                  {settings.benchmarkTargets ? (
                  <div className="bench-section-meta bench-build-toggle" role="group" aria-label="Build detail view">
                    {DETAIL_BUILD_ORDER.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className={`bench-build-toggle__btn${detailBuildKey === key ? ' is-active' : ''}`}
                        aria-pressed={detailBuildKey === key}
                        onClick={() => setDetailBuildKey(key)}
                      >
                        {DETAIL_BUILD_LABEL[key]}
                      </button>
                    ))}
                  </div>
                  ) : (
                    <span className="bench-section-meta">Current build</span>
                  )}
                </header>
                <BuildDossier
                  label={BUILD_LABEL[selectedDetailBuildKey]}
                  build={selectedDetailBuild}
                  rotationAction={settings.rotationFeatures ? rotationAction : null}
                  showEchoStats={settings.echoStatsTable}
                  showRotationFeatures={settings.rotationFeatures}
                />
              </section>
              ) : null}

              {settings.upgradePaths ? (
              <section className="bench-section">
                <header className="bench-section-head">
                  <h3 className="bench-section-title">Upgrade Paths</h3>
                  <span className="bench-section-meta">{report.alternatives.length} main stat &amp; Sonata paths</span>
                </header>
                {report.alternatives.length > 0 ? (
                  <AlternativesTable alternatives={report.alternatives} />
                ) : (
                  <p className="bench-empty">No valid main stat or Sonata upgrades are available.</p>
                )}
              </section>
              ) : null}
            </div>

            {settings.activeStateSources ? (
            <ActiveStateSources
              groups={stateGroups}
              activeResId={reportRuntime?.id ?? null}
              memberCount={reportRuntime?.build.team.filter(Boolean).length ?? 0}
              className="bench-state-sources"
              onImageError={withDefIconM}
            />
            ) : null}
          </div>
        </>
      )}
      </div>

      <AppModal
        state={rotationModal.dialogProps}
        variant="rotation-action-list"
        ariaLabel="Benchmark rotation action sequence"
        onClose={rotationModal.hide}
      >
        <div className="confirmation-modal__body rotation-action-list-modal__body">
          <div className="rotation-action-list-modal__head">
            <h2 className="confirmation-modal__title">{rotation?.name ?? 'Benchmark Rotation'}</h2>
            <MdlClsBttn onClick={() => rotationModal.hide()} />
          </div>
          <div className="rotation-action-list-modal__list">
            {sequence ? (
              <CtnSqnc
                actions={sequence.actions}
                condChoices={condChoices}
                entries={sequence.entries}
                loopLabelById={loopLabelById}
                spans={sequence.spans}
              />
            ) : null}
          </div>
        </div>
      </AppModal>
    </>
  )
}

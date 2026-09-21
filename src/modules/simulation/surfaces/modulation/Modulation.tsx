/*
  Author: Runor Ewhro
  Description: Coordinates Modulation member analysis, panel selection, live
               source-state controls, progression edits, and report access.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime'
import { readRtPath } from '@/domain/gameData/runtimePath'
import { mkCntrPath } from '@/domain/gameData/stateKeys.ts'
import { Expandable } from '@/shared/ui/Expandable'
import { SourceStateCtrl } from '@/modules/simulation/features/controls/SourceStateControl.tsx'
import { withDefIconM, withDefResMg } from '@/shared/lib/imageFallback'
import { glyphVars, resNodeIcon } from '@/shared/lib/gameAssets'
import { ATTR_COLORS, rarityVars } from '@/modules/simulation/model/display.ts'
import { ForteTree } from '@/modules/simulation/features/resonator/ForteTree.tsx'
import { useSkllData } from '@/modules/simulation/features/resonator/SkillDataHost.tsx'
import {
  mkForteDock,
  mkForteMode,
  mkForteTree,
} from '@/modules/simulation/features/resonator/lib/forteTree.ts'
import { getResonator, type ResView } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { ModulationDamage, useDamageMeta } from './Damage.tsx'
import { SeatStack } from './SeatStack.tsx'
import { ModulationStats } from './Stats.tsx'
import { EvaluationAside } from './EvaluationAside.tsx'
import { makeStatsTree, makeStatsView, STAT_ICON_MAP } from '@/modules/simulation/model/statsView.ts'
import type {
  EvaluationBuildSnapshot,
  EvaluationOverviewStats,
  BuildEvaluationReport,
} from '@/engine/evaluation/buildEvaluation.ts'
import {
  ASCENSION_STOPS,
  RES_LVL_MAX,
  RES_LVL_MIN,
  setResLvl,
  setSkllLvl,
  tglTrcNd,
} from '@/modules/simulation/features/resonator/lib/buildEdits.ts'
import { setRtPath } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { countLive, makeModulationBays, type BayGlyph, type BayRow } from './lib/modulationBays.ts'
import { useMemberAnalysis, type MemberAnalysisSource } from './lib/memberSim.ts'

type CssVars = CSSProperties & Record<string, string | number>

/* The live combat pipeline already owns current stats. Only the evaluation
   targets need the search program; normalize the three core row keys here so
   the build worksheet can keep its source vocabulary. */
function makeModulationOverviewStats(
  runtime: ResRuntime,
  finalStats: Parameters<typeof makeStatsView>[1],
): EvaluationOverviewStats {
  const view = makeStatsView(runtime, finalStats)
  return {
    ...view,
    mainStats: view.mainStats.map((row) => ({
      ...row,
      key: row.key.endsWith('Flat') ? row.key.slice(0, -4) : row.key,
    })),
  }
}

// Derive member-scoped variables from the currently inspected teammate.
export function memberAccent(member: ResView | null | undefined): CssVars | undefined {
  return member ? { '--resonator-accent': ATTR_COLORS[member.attribute] } : undefined
}

function useForteFacts(runtime: ResRuntime, isDark: boolean) {
  const member = useMemo(() => getResonator(runtime.id), [runtime.id])
  const branches = useMemo(() => (member ? mkForteTree(member, isDark) : []), [member, isDark])
  const dock = useMemo(() => (member ? mkForteDock(member) : []), [member])
  const mode = useMemo(() => (member ? mkForteMode(member) : null), [member])

  const levelled = [
    ...branches.map((branch) => branch.key),
    ...dock.filter((entry) => entry.levelled).map((entry) => entry.key as typeof branches[number]['key']),
  ]

  return {
    member,
    branches,
    dock,
    mode,
    nodesOn: Object.values(runtime.base.traceNodes.activeNodes).filter(Boolean).length,
    nodeTotal: member?.traceNodes?.length ?? 0,
    skillSum: levelled.reduce((total, key) => total + runtime.base.skillLevels[key], 0),
    skillCap: levelled.length * 10,
  }
}

function Glyph({ glyph, className }: { glyph: BayGlyph; className: string }) {
  if (glyph.img) {
    return (
      <span className={className}>
        <img src={glyph.img} alt="" loading="lazy" onError={withDefIconM} />
      </span>
    )
  }

  return (
    <span className={className}>
      <i style={glyphVars(glyph.mask ?? null, '--g')} />
    </span>
  )
}

// Preserve each source state's native control semantics while grouping by owner.
function Row({
  row,
  threaded,
  runtime,
  actRt,
  onRtPdt,
}: {
  row: BayRow
  threaded: boolean
  runtime: ResRuntime
  actRt: ResRuntime
  onRtPdt: RtUpdHnd
}) {
  const classes = [
    'pgs-cell',
    row.lit && row.enabled ? 'is-on' : '',
    row.enabled ? '' : 'is-locked',
    threaded ? 'is-threaded' : '',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <span className="pgs-port" aria-hidden="true">
        <Glyph glyph={row.glyph} className="pgs-port-glyph" />
      </span>

      <div className="pgs-cell-body">
        <SourceStateCtrl
          srcRt={runtime}
          tgtRt={runtime}
          actRt={actRt}
          state={row.state}
          onRtPdt={onRtPdt}
          dscrPrms={row.params.length > 0 ? row.params : undefined}
        />
      </div>
    </div>
  )
}


const SCROLL_PAD = 8

// Find the nearest ancestor that actually owns vertical scrolling.
export function findScroller(from: HTMLElement): HTMLElement | null {
  let node = from.parentElement
  while (node) {
    const flow = getComputedStyle(node).overflowY
    if ((flow === 'auto' || flow === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

const SCROLL_MS = 460

// Cubic easing shared by the manually controlled scroll transition.
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}

// The application motion preference is the canonical animation gate here.
function motionOn(): boolean {
  return typeof document !== 'undefined'
    && !document.documentElement.classList.contains('reduce-animation')
}

function useViewScroll(panel: RefObject<HTMLDivElement | null>) {
  const frame = useRef(0)

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  return () => {
    const node = panel.current
    const scroller = node ? findScroller(node) : null
    if (!node || !scroller) return

    cancelAnimationFrame(frame.current)

    // Re-read the target each frame because swapping panel content changes geometry.
    const mark = () => {
      const want = scroller.scrollTop
        + node.getBoundingClientRect().top
        - scroller.getBoundingClientRect().top
        - SCROLL_PAD
      return Math.max(0, Math.min(want, scroller.scrollHeight - scroller.clientHeight))
    }

    if (!motionOn()) {
      scroller.scrollTop = mark()
      return
    }

    // Drive the transition locally so browser scroll behavior cannot cancel it.
    const from = scroller.scrollTop
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SCROLL_MS)
      scroller.scrollTop = from + (mark() - from) * ease(t)
      if (t < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }
}

export type ModulationPanel =  'damage' | 'stats' | 'states' | 'forte'

const VIEW_TITLES: Record<ModulationPanel, string> = {
  damage: 'Damage',
  stats: 'Build Stats',
  states: 'Effects',
  forte: 'Level & Nodes',
}

interface StatesProps {
  runtime: ResRuntime
  actRt: ResRuntime
  analysisSource: MemberAnalysisSource
  isDark: boolean
  onRtPdt: RtUpdHnd
  view: ModulationPanel
  onView: (view: ModulationPanel) => void
  /** Inspectable team ordered with the current subject first. */
  roster: ResView[]
  memberId: string | null
  onMember: (resonatorId: string) => void
  /** Whether the loadout-hosted member selector is outside the visible board. */
  seatOut: boolean
  /** Optional evaluation snapshots that enrich otherwise live analysis. */
  activeBuild: EvaluationBuildSnapshot | null
  referenceBuild: EvaluationBuildSnapshot | null
  maximumBuild: EvaluationBuildSnapshot | null
  /** Complete evaluation report used by the report modal. */
  report: BuildEvaluationReport | null
}

function PanelSeat({
  roster,
  memberId,
  onMember,
  out,
}: {
  roster: ResView[]
  memberId: string | null
  onMember: (resonatorId: string) => void
  out: boolean
}) {
  const seated = roster.find((mate) => mate.id === memberId) ?? roster[0] ?? null
  if (!seated) return null

  return (
    <div className="pgs-seat" data-out={out ? 'true' : 'false'}>
      <span className="pgs-seat-rail" aria-hidden="true" />
      <SeatStack roster={roster} memberId={memberId} onMember={onMember} hidden={!out} />
      <b className="pgs-seat-name">{seated.name}</b>
    </div>
  )
}

export function ModulationView({
  runtime,
  actRt,
  analysisSource,
  isDark,
  onRtPdt,
  view,
  onView,
  roster,
  memberId,
  onMember,
  seatOut,
  activeBuild,
  referenceBuild,
  maximumBuild,
  report,
}: StatesProps) {
  const bays = useMemo(() => makeModulationBays(runtime, actRt), [runtime, actRt])
  const live = useMemo(() => countLive(bays), [bays])
  const forte = useForteFacts(runtime, isDark)
  const panel = useRef<HTMLDivElement>(null)
  const damageMeta = useDamageMeta(runtime)
  const memberAnalysis = useMemberAnalysis(runtime, analysisSource)
  const currentStats = useMemo(
    () => memberAnalysis.simulation
      ? makeModulationOverviewStats(runtime, memberAnalysis.simulation.finalStats)
      : null,
    [memberAnalysis.simulation, runtime],
  )
  // Build the nested stat graph once for consumers that need rows omitted by the flat view.
  const statsTree = useMemo(
    () => memberAnalysis.simulation
      ? makeStatsTree(memberAnalysis.simulation.finalStats)
      : [],
    [memberAnalysis.simulation],
  )
  const [reportOut, setReportOut] = useState(false)

  const toPanel = useViewScroll(panel)

  // Re-selecting the active panel still scrolls its anchor into view.
  const takeView = (next: ModulationPanel) => {
    onView(next)
    toPanel()
  }

  const forteGlyph = glyphVars(resNodeIcon(runtime.id, 'forteCircuit'), '--g')
  const statsGlyph = { '--g': `url(${STAT_ICON_MAP.ATK})` } as CssVars
  const statCount = currentStats
    ? currentStats.mainStats.length
      + currentStats.secondaryStats.length
      + currentStats.dmgMdfrStts.length
    : 0
  const dmgGlyph = glyphVars(resNodeIcon(runtime.id, 'normalAttack'), '--g')

  return (
    <div className="pgs workspace-ink rte-scope" ref={panel} style={memberAccent(forte.member)}>
      <div className="pgs-head">
        <h4 className="pgs-title">{VIEW_TITLES[view]}</h4>
        <PanelSeat roster={roster} memberId={memberId} onMember={onMember} out={seatOut} />
        <span className="pgs-spacer" />

        {report ? (
          <button
            type="button" className="pgs-report"
            aria-expanded={reportOut}
            onClick={() => setReportOut(true)}
          >
            <em aria-hidden="true" />
            Report
          </button>
        ) : null}

        <div className="pgs-switch"
          data-at={view}
          role="group"
          aria-label="Panel view"
        >
          <span className="pgs-switch-car" aria-hidden="true" />

          <button
            type="button"
            className={view === 'stats' ? 'pgs-view is-at' : 'pgs-view'}
            aria-pressed={view === 'stats'}
            onClick={() => takeView('stats')}
          >
            <span className="pgs-view-port" aria-hidden="true">
              <i style={statsGlyph} />
            </span>
            <span className="pgs-view-text">
              <b>STATS</b>
              <em>{statCount} rows</em>
            </span>
          </button>

          <button
            type="button"
            className={view === 'damage' ? 'pgs-view is-at' : 'pgs-view'}
            aria-pressed={view === 'damage'}
            onClick={() => takeView('damage')}
          >
            <span className="pgs-view-port" aria-hidden="true">
              <i style={dmgGlyph} />
            </span>
            <span className="pgs-view-text">
              <b>DAMAGE</b>
              <em>{damageMeta}</em>
            </span>
          </button>

          <button
            type="button"
            className={view === 'states' ? 'pgs-view is-at' : 'pgs-view'}
            aria-pressed={view === 'states'}
            onClick={() => takeView('states')}
          >
            <span className="pgs-view-port" aria-hidden="true">
              {forte.member?.profile ? (
                <img src={forte.member.profile} alt="" loading="lazy" onError={withDefResMg} />
              ) : null}
            </span>
            <span className="pgs-view-text">
              <b>EFFECTS</b>
              <em>{live.on} of {live.all}</em>
            </span>
          </button>

          <button
            type="button"
            className={view === 'forte' ? 'pgs-view is-at' : 'pgs-view'}
            aria-pressed={view === 'forte'}
            onClick={() => takeView('forte')}
          >
            <span className="pgs-view-port" aria-hidden="true">
              <i style={forteGlyph} />
            </span>
            <span className="pgs-view-text">
              <b>SKILLS</b>
              <em>Lv.{runtime.base.level} &middot; {forte.nodesOn}/{forte.nodeTotal}</em>
            </span>
          </button>
        </div>
      </div>

      {report ? (
        <EvaluationAside
          open={reportOut}
          onClose={() => setReportOut(false)}
          report={report}
          resonatorId={report.rotation?.resonatorId ?? runtime.id}
        />
      ) : null}

      {view === 'stats' ? (
        <ModulationStats
          active={currentStats}
          evaluationActive={activeBuild}
          referenceBuild={referenceBuild}
          maximumBuild={maximumBuild}
          stateGroupsForStat={memberAnalysis.stateGroupsForStat}
          runtime={runtime}
          statsTree={statsTree}
        />
      ) : view === 'damage' ? (
        /* Keep component identity across member changes so panel-local state is
           not reset when only the inspected subject changes. */
        <ModulationDamage runtime={runtime} simulation={memberAnalysis.simulation} />
      ) : view === 'forte' ? (
        <ForteBody runtime={runtime} facts={forte} onRtPdt={onRtPdt} />
      ) : bays.length > 0 ? (
        <div className="pgs-sections">
          {bays.map((bay) => {
            const on = bay.rows.filter((row) => row.lit && row.enabled).length
            // Find the final active row once so the group can terminate its connector.
            const lastLive = bay.rows.reduce(
              (found, row, index) => (row.lit && row.enabled ? index : found),
              -1,
            )

            return (
              <Expandable
                key={bay.id}
                as="section"
                className={on > 0 ? 'pgs-section is-hot' : 'pgs-section'}
                style={rarityVars(bay.rarity, false, '--mcc-accent') as CSSProperties | undefined}
                defaultOpen
                plainTrigger
                noHeaderWrap
                TriggerTag="button"
                triggerClass="pgs-section-head"
                chevWrapClass="pgs-section-chev"
                chevronSize={13}
                innerClass="pgs-gallery"
                header={(
                  <>
                    <Glyph glyph={bay.glyph} className="pgs-section-glyph" />
                    <b>{bay.label}</b>
                    <span className="pgs-section-count">
                      {on}<em>/{bay.rows.length}</em>
                    </span>
                    <span className="pgs-section-src">{bay.source}</span>
                  </>
                )}
              >
                {bay.rows.map((row, index) => (
                  <Row
                    key={row.state.controlKey}
                    row={row}
                    threaded={index < lastLive}
                    runtime={runtime}
                    actRt={actRt}
                    onRtPdt={onRtPdt}
                  />
                ))}
              </Expandable>
            )
          })}
        </div>
      ) : (
        <p className="pgs-empty">This build has no combat states to set.</p>
      )}
    </div>
  )
}

function ForteBody({
  runtime,
  facts,
  onRtPdt,
}: {
  runtime: ResRuntime
  facts: ReturnType<typeof useForteFacts>
  onRtPdt: RtUpdHnd
}) {
  const { member, branches, dock, mode, nodesOn, nodeTotal, skillSum, skillCap } = facts
  // Use the simulation-scoped modal so its member selection stays synchronized.
  const skillData = useSkllData()

  return (
    <section className="pgs-forte" aria-label="Forte">
      <div className="pgs-power">
        <div className="pgs-power-head">
          <span className="pgs-power-label">RESONATOR LEVEL</span>
          <span className="pgs-power-sum">
            {nodesOn}/{nodeTotal} NODES &middot; {skillSum}/{skillCap} SKILL
          </span>
          <span className="pgs-power-value">
            {runtime.base.level}<em> / {RES_LVL_MAX}</em>
          </span>
        </div>

        <div className="pgs-track">
          <input
            type="range"
            min={RES_LVL_MIN}
            max={RES_LVL_MAX}
            value={runtime.base.level}
            aria-label="Resonator level"
            style={{
              '--fill': `${((runtime.base.level - RES_LVL_MIN) / (RES_LVL_MAX - RES_LVL_MIN)) * 100}%`,
            } as CssVars}
            onChange={(event) => onRtPdt((prev) => setResLvl(prev, Number(event.target.value)))}
          />

          <div className="pgs-marks" aria-hidden="true">
            {ASCENSION_STOPS.map((stop) => {
              const reached = runtime.base.level >= stop
              // Mark ascension boundaries that unlock at least one inherent skill.
              const gates = member?.inherentSkills?.some((skill) => skill.unlockLevel === stop)
              return (
                <span
                  key={stop}
                  className={[
                    'pgs-mark',
                    reached ? 'is-reached' : '',
                    gates ? 'is-gate' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ '--at': `${((stop - RES_LVL_MIN) / (RES_LVL_MAX - RES_LVL_MIN)) * 100}%` } as CssVars}
                >
                  <i />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => onRtPdt((prev) => setResLvl(prev, stop))}
                  >
                    {stop === RES_LVL_MAX ? 'MAX' : stop}
                  </button>
                </span>
              )
            })}
          </div>
        </div>
      </div>

      <div className="pgs-tree">
        <svg className="pgs-rings" viewBox="0 0 600 200" preserveAspectRatio="none" aria-hidden="true">
          <path d="M8 200 A292 122 0 0 1 592 200" fill="none" stroke="currentColor" />
          <path d="M78 200 A222 92 0 0 1 522 200" fill="none" stroke="currentColor" />
          <path d="M148 200 A152 64 0 0 1 452 200" fill="none" stroke="currentColor" />
        </svg>

        <ForteTree
          surface="modulation"
          branches={branches}
          dock={dock}
          mode={mode}
          modeValue={mode
            ? String(readRtPath(runtime, mkCntrPath(mode.controlKey)) ?? mode.defaultValue)
            : ''}
          skillLevel={(branch) => runtime.base.skillLevels[branch.key]}
          dockLevel={(entry) => (entry.key === 'outroSkill' ? 0 : runtime.base.skillLevels[entry.key])}
          activeNodes={runtime.base.traceNodes.activeNodes}
          onSkillChange={(branch, next) => onRtPdt((prev) => setSkllLvl(prev, branch.key, next))}
          onDockChange={(entry, next) => {
            const key = entry.key
            // Outro skills have no mutable level.
            if (key === 'outroSkill') return
            onRtPdt((prev) => setSkllLvl(prev, key, next))
          }}
          onModeChange={(next) => {
            if (mode) setRtPath(onRtPdt, mkCntrPath(mode.controlKey), next)
          }}
          onTraceToggle={(nodeId) => onRtPdt((prev) => tglTrcNd(prev, nodeId, member))}
          subject={member?.name ?? null}
          // Open skill data for the currently inspected runtime.
          onSkillData={(tab) => skillData.open({ resonatorId: runtime.id, tab })}
        />
      </div>
    </section>
  )
}

/*
  Author: Runor Ewhro
  Description: Modulation's build-tuning half of the board, standing in the
               room the echo grid and the row under it give it.

               Two kinds of work live here and they are not the same kind. What
               you own -- level, skill levels, forte nodes, resonance mode -- is
               set once and then has no business holding the stage, so it waits
               behind a gate that reports what you set. What is live -- every
               state the build can switch on -- is the ongoing work, so it takes
               the row, one instrument panel bayed by the scope each owner
               already declares.

               The switch does not open an overlay: it swaps what the panel
               is showing, and only the panel. The band and the loadout stay
               mounted above it and the column scrolls to the head, so the forte
               still opens on a full view of itself while the loadout is one
               scroll up rather than gone.
*/

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { CombatScenario } from '@/domain/entities/combatScenario.ts'
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
} from '@/data/scoring/buildEvaluation.ts'
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
import { useMemberAnalysis } from './lib/memberSim.ts'

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

/* what both halves need to say about the forte: what is owned, and how much */
/*
  the column can be pointed at a teammate, and when it is, everything it draws
  is about them: the ink follows the subject rather than staying with whoever
  the board is scoring.
*/
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

/* an owner's art, either a real asset or a white node icon used as a mask */
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

/*
  the console's cell, kept: a port column with the thread running through it and
  the state's own control to its right. the control is the console's too, so a
  toggle, a stack and a select read here exactly as they read in the member
  console. the port is the one addition: it wears the art of whatever produced
  the effect, which is what lets three sections stand in for the six the owners
  would otherwise ask for.
*/
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

/* whatever is actually taking the column's scroll: the board, on this page */
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

/*
  the swap is the same swap it always was, only smaller: the head and the
  loadout above it stay mounted, so the column is brought to the panel rather
  than the panel to the column. every view is walked to the same mark, the
  panel's own head, so the body you asked for opens on a full view of itself
  whichever one it is, and the loadout is one scroll up rather than gone.
  pressing the view already standing walks there too: the press is the ask.
*/
const SCROLL_MS = 460

/* out of rest and back into it, so the column reads as carried, not cut */
function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2
}

/* the app's own motion switch decides this, not the browser's */
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

    /*
      the mark is read from the box on every frame rather than once up front:
      the body swapping under the move changes the column's height, and a mark
      taken before that lands either short or past the end of the scroll.
    */
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

    /*
      the walk is driven here rather than handed to scroll-behavior, which the
      board drops whenever the tab is not the one being looked at.
    */
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

/* the four stops the panel's own switch now stands */
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
  scenario: CombatScenario
  isDark: boolean
  onRtPdt: RtUpdHnd
  view: ModulationPanel
  onView: (view: ModulationPanel) => void
  /* the team the column can be pointed at, subject first */
  roster: ResView[]
  memberId: string | null
  onMember: (resonatorId: string) => void
  /* true once the loadout's head, where the seat normally lives, is off the board */
  seatOut: boolean
  /* evaluation-only enrichment for the live stats sheet: current damage/share,
     then the two searched target builds */
  activeBuild: EvaluationBuildSnapshot | null
  referenceBuild: EvaluationBuildSnapshot | null
  maximumBuild: EvaluationBuildSnapshot | null
  /* the whole report, which the pull-out reads: the rotation and the paths */
  report: BuildEvaluationReport | null
}

/*
  The seat: who the column is pointed at, taken over from the loadout's head
  once that has scrolled away.

  It is deliberately not the switch beside it. Three evenly spaced beads would
  have read as more of the switch's ports, so the party is one object instead:
  the seated member in front at full size wearing their own attribute, the rest
  tucked behind them, smaller and dimmed. One silhouette, then the name.
*/
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
  if (roster.length < 2 || !seated) return null

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
  scenario,
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
  const memberAnalysis = useMemberAnalysis(runtime, scenario)
  const currentStats = useMemo(
    () => memberAnalysis.simulation
      ? makeModulationOverviewStats(runtime, memberAnalysis.simulation.finalStats)
      : null,
    [memberAnalysis.simulation, runtime],
  )
  /* the sheet prints eighteen rows; the tree holds everything else, and the
     stats view needs it to place what it cannot state itself */
  const statsTree = useMemo(
    () => memberAnalysis.simulation
      ? makeStatsTree(memberAnalysis.simulation.finalStats)
      : [],
    [memberAnalysis.simulation],
  )
  const [reportOut, setReportOut] = useState(false)

  const toPanel = useViewScroll(panel)

  /* the press is the ask, so it walks the column even when the view it
     names is the one already standing */
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

        {/* the report is a reading about the whole build rather than a fifth
            view of it, so it opens beside the board instead of taking it */}
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

        {/*
          the three views the panel can stand, on one rail. each keeps its own
          readout, so whichever you are not in still reports what it holds, and
          the carriage carries the notch the gate used to wear.
        */}
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

          {/* the damage view says what it is measuring against, since a hit
              means nothing without the target it landed on */}
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
            {/* the states wear the member's own face, as their first section
                and the state-sources panel both already do */}
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
        /* not keyed on the member: pointing the column at someone else is a
           new reading, not a new view, so the grid, the leader and the card
           stay where they are and take the new numbers */
        <ModulationDamage runtime={runtime} simulation={memberAnalysis.simulation} />
      ) : view === 'forte' ? (
        <ForteBody runtime={runtime} facts={forte} onRtPdt={onRtPdt} />
      ) : bays.length > 0 ? (
        <div className="pgs-sections">
          {bays.map((bay) => {
            const on = bay.rows.filter((row) => row.lit && row.enabled).length
            /* the thread runs from the first port down to the last live one */
            const lastLive = bay.rows.reduce(
              (found, row, index) => (row.lit && row.enabled ? index : found),
              -1,
            )

            return (
              <Expandable
                key={bay.id}
                as="section"
                className={on > 0 ? 'pgs-section is-hot' : 'pgs-section'}
                /* the weapon takes its own rarity's colour, as it does in the console */
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

/*
  the forte takes the room the sections were using, in place. no overlay and no
  second head: the panel's own head already says which view is standing, so
  what is left here is the work -- the level the whole tree is gated on, and
  the tree.
*/
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
  /* the shared modal, so the tree's placard opens the one the roster switch is
     on rather than a second copy of it */
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
              /* the stops that unlock an inherent are worth naming */
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
        {/*
          arcs, not ellipses: an ellipse's widest point sits on the box's bottom
          edge, so it ends abruptly there. a top arc closes on the baseline by
          itself, where the fade has already taken it.
        */}
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
            /* the outro skill carries no level, so it never reaches here */
            if (key === 'outroSkill') return
            onRtPdt((prev) => setSkllLvl(prev, key, next))
          }}
          onModeChange={(next) => {
            if (mode) setRtPath(onRtPdt, mkCntrPath(mode.controlKey), next)
          }}
          onTraceToggle={(nodeId) => onRtPdt((prev) => tglTrcNd(prev, nodeId, member))}
          subject={member?.name ?? null}
          /* the column can be pointed at a teammate, so the door opens on them */
          onSkillData={(tab) => skillData.open({ resonatorId: runtime.id, tab })}
        />
      </div>
    </section>
  )
}

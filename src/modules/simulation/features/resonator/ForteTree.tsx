/*
  Author: Runor Ewhro
  Description: The forte tree: five columns on an arc, the two skills that dock
               under the spine, and the resonance-mode sigil at its head.

               It renders the same structure wherever it stands, and nothing
               about how it looks. The console and Modulation are
               different surfaces with different grounds, so each brings its own
               skin: the root carries `frt--<surface>` and the skin files fill in
               the `--frt-*` tokens `forte-tree.css` leaves open. Neither surface
               overrides the other's rules.
*/

import { Fragment, useState, type CSSProperties as CssProps } from 'react'
import type { SkillTabKey } from '@/domain/entities/resonator'
import { glyphVars } from '@/shared/lib/gameAssets.ts'
import {
  FORTE_SPINE,
  type ForteBranch,
  type ForteDock,
  type ForteMode,
} from '@/modules/simulation/features/resonator/lib/forteTree.ts'
import { SKILL_LVL_MAX, SKILL_LVL_MIN } from '@/modules/simulation/features/resonator/lib/buildEdits.ts'

/** which surface the tree is standing on, so each can bring its own skin */
export type ForteSurface = 'console' | 'page' | 'modulation'

/*
  one door on the placard. the note is whatever else the tab it opens will
  render besides the skill itself, which is only ever the forte circuit's
  inherents, and is read off the branch rather than stated here.
*/
interface ForteDoor {
  key: SkillTabKey
  label: string
  icon: string
  note: string | null
}

/*
  the four-point star the game sets behind every node. one shape reused at two
  scales rather than art per node, so it costs a <use> and stays crisp.
*/
function Spark() {
  return (
    <svg className="frt-spark" viewBox="-50 -50 100 100" aria-hidden="true">
      <use href="#frt-spark" fill="currentColor" transform="scale(1.08 1.32) translate(-50 -50)" />
    </svg>
  )
}

/* the wisp that trails a conduit, so a link reads as drawn rather than ruled */
function Wisp() {
  return (
    <svg viewBox="0 0 24 100" preserveAspectRatio="none" aria-hidden="true">
      <path d="M12 0 C5.5 28 18 58 12 100" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M12 0 C17 32 7 64 12 100" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.6" />
    </svg>
  )
}

/*
  the board behind the tree: wide flat rings centred under the floor, a spire of
  strands rising behind the dock, and the floor itself. how much of any of it
  shows is the skin's call.
*/
function Field() {
  const rings = Array.from({ length: 5 }, (_, index) => {
    const ry = 300 + index * 74
    return (
      <ellipse
        key={index}
        cx="500"
        cy="700"
        rx={(ry * 2.45).toFixed(0)}
        ry={ry}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity={(0.5 - index * 0.075).toFixed(2)}
      />
    )
  })

  const strands = [-4, -3, -2, -1, 1, 2, 3, 4].map((index) => {
    const sign = Math.sign(index)
    const step = Math.abs(index)
    const foot = sign * (9 + step * 11)
    const belly = sign * (2 + step * 4)
    return (
      <path
        key={index}
        d={`M500 196 C${(500 + belly).toFixed(1)} 268 ${(500 + belly * 2.2).toFixed(1)} 320 ${(500 + foot).toFixed(1)} 400`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        opacity={(0.6 - step * 0.115).toFixed(2)}
      />
    )
  })

  return (
    <div className="frt-field" aria-hidden="true">
      <span className="frt-floor" />
      <svg className="frt-rings" viewBox="0 0 1000 400" preserveAspectRatio="none">{rings}</svg>
      <svg className="frt-spire" viewBox="0 0 1000 400" preserveAspectRatio="xMidYMax meet">
        {strands}
        <path d="M500 188 L500 400" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      </svg>
    </div>
  )
}

/* the dial that sets a skill's level, reading it back as ten arc segments */
function Dial({
  label,
  icon,
  level,
  mini = false,
  onChange,
}: {
  label: string
  icon: string
  level: number
  mini?: boolean
  onChange: (next: number) => void
}) {
  return (
    <>
      <button
        type="button"
        className={mini ? 'frt-dial frt-dial--mini' : 'frt-dial'}
        style={{ '--frt-f': level / SKILL_LVL_MAX } as CssProps}
        aria-label={`${label} level ${level} of ${SKILL_LVL_MAX}`}
        title={`${label} Lv ${level}`}
        onClick={() => onChange(level >= SKILL_LVL_MAX ? SKILL_LVL_MIN : level + 1)}
        onContextMenu={(event) => {
          event.preventDefault()
          onChange(level <= SKILL_LVL_MIN ? SKILL_LVL_MAX : level - 1)
        }}
      >
        <Spark />
        <span className="frt-ring" aria-hidden="true"><i /></span>
        <span className="frt-glyph frt-glyph--dial" style={glyphVars(icon) as CssProps} />
      </button>
      <span className="frt-lv">{level}<span>/{SKILL_LVL_MAX}</span></span>
    </>
  )
}

/*
  the two skills the game docks under the spine rather than giving a column of
  their own. the outro skill carries no level, so it wears no collar and holds
  the space its neighbour's readout takes to keep both labels on one baseline.
*/
function DockRow({
  dock,
  levelOf,
  cued,
  onChange,
}: {
  dock: ForteDock[]
  levelOf: (entry: ForteDock) => number
  cued: SkillTabKey | null
  onChange: (entry: ForteDock, next: number) => void
}) {
  return (
    <div className="frt-dock">
      {dock.map((entry) => (
        <span
          className={cued === entry.key ? 'frt-dock-cell is-cued' : 'frt-dock-cell'}
          key={entry.key}
        >
          {entry.levelled ? (
            <Dial
              label={entry.label}
              icon={entry.icon}
              level={levelOf(entry)}
              mini
              onChange={(next) => onChange(entry, next)}
            />
          ) : (
            <>
              <span className="frt-dial frt-dial--mini frt-dial--plain"
                style={{ '--frt-f': 0 } as CssProps}
                role="img"
                aria-label={entry.label}
                title={entry.label}
              >
                <Spark />
                <span className="frt-glyph frt-glyph--dial" style={glyphVars(entry.icon) as CssProps} />
              </span>
              <span className="frt-lv" aria-hidden="true" data-spacer="true">0<i>/10</i></span>
            </>
          )}
          <span className="frt-name">{entry.label}</span>
        </span>
      ))}
    </div>
  )
}

/*
  one column: the stat nodes stack above the dial that sets the skill's level,
  and the conduit between them lights with the node it feeds. every conduit is
  the same length, so the arch is entirely in where a column starts.
*/
function BranchCol({
  branch,
  level,
  activeNodes,
  dock,
  dockLevel,
  cued,
  reads,
  onSkillChange,
  onDockChange,
  onTraceToggle,
}: {
  branch: ForteBranch
  level: number
  activeNodes: Record<string, boolean>
  dock: ForteDock[]
  dockLevel: (entry: ForteDock) => number
  /* which column the placard is pointing at, if any */
  cued: SkillTabKey | null
  /* whether the tree stands a placard at all, and so whether a node carries
     the sentence it is otherwise only drawing the figure of */
  reads: boolean
  onSkillChange: (next: number) => void
  onDockChange: (entry: ForteDock, next: number) => void
  onTraceToggle: (nodeId: string) => void
}) {
  // both stacks are drawn top down, and the game hangs the later unlock highest
  const stones = [...branch.traces].reverse()
  const inherents = [...branch.inherents].reverse()
  const spine = branch.key === FORTE_SPINE

  return (
    <div
      className={cued === branch.key ? 'frt-branch is-cued' : 'frt-branch'}
      data-side={branch.side}
      data-rank={branch.rank}
      data-spine={spine || undefined}
    >
      {inherents.map((inherent, order) => (
        <Fragment key={`${branch.key}-inherent-${order}`}>
          <span className="frt-node frt-node--outer is-fixed"
            role="img"
            title={`${inherent.name} · Lv ${inherent.unlockLevel}`}
            aria-label={`${inherent.name}, unlocks at level ${inherent.unlockLevel}`}
          >
            <Spark />
            {inherent.icon ? (
              <span className="frt-glyph" style={glyphVars(inherent.icon) as CssProps} />
            ) : null}
          </span>
          <span className="frt-val is-lit for-outer">
            Lv {inherent.unlockLevel}
            {reads ? <i className="frt-desc">{inherent.name}</i> : null}
          </span>
          <span className="frt-stem lit" aria-hidden="true"><Wisp /></span>
        </Fragment>
      ))}

      {stones.map((trace, index) => {
        const lit = activeNodes[trace.id] ?? false
        const outer = index === 0 && stones.length > 1
        return (
          <Fragment key={trace.id}>
            <button
              type="button"
              className={`frt-node ${outer ? 'frt-node--outer' : 'frt-node--inner'}${lit ? ' is-on' : ''}`}
              aria-pressed={lit}
              title={`${trace.name} ${trace.value}`}
              aria-label={`${trace.name} ${trace.value}`}
              onClick={() => onTraceToggle(trace.id)}
            >
              <Spark />
              {trace.statIcon ? (
                <span className="frt-glyph" style={glyphVars(trace.statIcon) as CssProps} />
              ) : null}
            </button>
            <span className={`frt-val${lit ? ' is-lit' : ''}${outer ? ' for-outer' : ''}`}>
              {trace.value}
              {reads && trace.desc ? <i className="frt-desc">{trace.desc}</i> : null}
            </span>
            <span className={`frt-stem${lit ? ' lit' : ''}`} aria-hidden="true"><Wisp /></span>
          </Fragment>
        )
      })}

      <Dial label={branch.label} icon={branch.icon} level={level} onChange={onSkillChange} />
      <span className="frt-name">{branch.label}</span>

      {/* the loose skills hang off the spine, centred under the forte circuit */}
      {spine ? <DockRow dock={dock} levelOf={dockLevel} cued={cued} onChange={onDockChange} /> : null}
    </div>
  )
}

/*
  the placard: the label under the exhibit, standing on the horizon the tree
  is drawn over.

  It hangs out of the tree's flow rather than under it, because the surface
  draws the ring horizon off the tree's own box: taking room in the column
  would push the arc up and the rings down, and the placard is meant to arrive
  on the ground the tree already stands on, not move it.

  Hovering a door lights exactly what the tab it opens will render, and the
  caption names the door itself. Two of them land on the modal's Concerto view
  together, which is the modal's own grouping and not something the tree should
  restate: the reader is looking for the outro skill, so the placard says Outro
  Skill.
*/
function Placard({
  subject,
  doors,
  cued,
  onCue,
  onOpen,
}: {
  subject: string | null
  doors: ForteDoor[]
  cued: SkillTabKey | null
  onCue: (key: SkillTabKey | null) => void
  onOpen: (key: SkillTabKey) => void
}) {
  const at = doors.find((door) => door.key === cued) ?? null

  return (
    <div className="frt-placard" onPointerLeave={() => onCue(null)}>
      <span className="frt-placard-name">
        {subject ? `${subject} · Skill data` : 'Skill data'}
      </span>

      <span className="frt-placard-row">
        {doors.map((door) => (
          <button
            type="button"
            key={door.key}
            className={cued === door.key ? 'frt-leaf is-cued' : 'frt-leaf'}
            aria-label={`Skill data: ${door.label}`}
            onPointerEnter={() => onCue(door.key)}
            onFocus={() => onCue(door.key)}
            onBlur={() => onCue(null)}
            onClick={() => onOpen(door.key)}
          >
            <span className="frt-glyph" style={glyphVars(door.icon) as CssProps} />
          </button>
        ))}
      </span>

      {/* the caption holds its line whether or not a door is under the pointer */}
      <span className="frt-placard-cap">
        {at ? `${at.label}${at.note ? ` ${at.note}` : ''}` : ' '}
      </span>
    </div>
  )
}

/* the cluster of needles the two modes pivot on */
function ModeStar() {
  return (
    <span className="frt-mode-star" aria-hidden="true">
      <svg viewBox="-50 -36 100 72">
        {[-2, -1, 1, 2].map((offset) => (
          <use
            key={offset} className="frt-mode-ghost"
            href="#frt-spark"
            transform={`translate(${offset * 8} 0) scale(0.12 ${(0.94 - Math.abs(offset) * 0.14).toFixed(2)}) translate(-50 -50)`}
          />
        ))}
        <use className="frt-mode-bar" href="#frt-spark" transform="scale(1 0.042) translate(-50 -50)" />
        <use className="frt-mode-core" href="#frt-spark" transform="scale(0.22 0.9) translate(-50 -50)" />
      </svg>
    </span>
  )
}

/*
  the sigil the game hangs at the head of the tree for a resonator who fights in
  two resonance modes. the lit side takes the bloom and the crescent, the resting
  side keeps a thin ring, and neither is labelled: the art is the name.
*/
function ModeSigil({
  mode,
  value,
  onChange,
}: {
  mode: ForteMode
  value: string
  onChange: (next: string) => void
}) {
  const [first] = mode.options

  return (
    <div className="frt-mode" role="radiogroup" aria-label="Resonance Mode">
      {mode.options.map((option, index) => {
        const lit = option.id === value
        const crescent = option.id === first.id
          ? 'M-30 -24 A38 38 0 0 0 -30 24'
          : 'M30 -24 A38 38 0 0 1 30 24'

        return (
          <Fragment key={option.id}>
            {index === 1 ? <ModeStar /> : null}
            <button
              type="button" className="frt-mode-opt"
              role="radio"
              aria-checked={lit}
              aria-label={`Resonance Mode: ${option.label}`}
              title={option.label}
              onClick={() => onChange(option.id)}
            >
              <span className="frt-mode-halo" aria-hidden="true" />
              <svg viewBox="-50 -50 100 100" aria-hidden="true">
                <circle className="frt-mode-rest" cx="0" cy="0" r="30" />
                <use className="frt-mode-bloom" href="#frt-spark" transform="scale(0.9 1.28) translate(-50 -50)" />
                <path className="frt-mode-crest" d={crescent} />
              </svg>
              <span className="frt-glyph" style={glyphVars(option.icon) as CssProps} />
            </button>
          </Fragment>
        )
      })}
    </div>
  )
}

export function ForteTree({
  surface,
  branches,
  dock,
  mode,
  modeValue,
  skillLevel,
  dockLevel,
  activeNodes,
  onSkillChange,
  onDockChange,
  onModeChange,
  onTraceToggle,
  subject,
  onSkillData,
}: {
  surface: ForteSurface
  branches: ForteBranch[]
  dock: ForteDock[]
  mode: ForteMode | null
  modeValue: string
  skillLevel: (branch: ForteBranch) => number
  dockLevel: (entry: ForteDock) => number
  activeNodes: Record<string, boolean>
  onSkillChange: (branch: ForteBranch, next: number) => void
  onDockChange: (entry: ForteDock, next: number) => void
  onModeChange: (next: string) => void
  onTraceToggle: (nodeId: string) => void
  /* who the placard names, when the surface stands one */
  subject?: string | null
  /* given a handler, the tree stands its own door onto the skill data */
  onSkillData?: (key: SkillTabKey) => void
}) {
  const [cued, setCued] = useState<SkillTabKey | null>(null)
  const reads = Boolean(onSkillData)

  /*
    seven doors: the five columns, then the two the spine docks. a column's
    note is whatever else its tab renders, which the branch already carries.
  */
  const doors: ForteDoor[] = reads
    ? [
      ...branches.map((branch) => ({
        key: branch.key as SkillTabKey,
        label: branch.label,
        icon: branch.icon,
        note: branch.inherents.length > 0
          ? `+ ${branch.inherents.length} inherent`
          : null,
      })),
      ...dock.map((entry) => ({
        key: entry.key as SkillTabKey,
        label: entry.label,
        icon: entry.icon,
        note: null,
      })),
    ]
    : []

  return (
    <div className={`frt frt--${surface}`}>
      {/* every node's backdrop is one shape reused, defined once per tree */}
      <svg width="0" height="0" className="frt-defs" aria-hidden="true" focusable="false">
        <defs>
          <path
            id="frt-spark"
            d="M50 0 C50.7 41 59 49.3 100 50 C59 50.7 50.7 59 50 100 C49.3 59 41 50.7 0 50 C41 49.3 49.3 41 50 0 Z"
          />
        </defs>
      </svg>

      <Field />

      <div className="frt-band">
        {mode ? <ModeSigil mode={mode} value={modeValue} onChange={onModeChange} /> : null}
      </div>

      <div className="frt-grid">
        {branches.map((branch) => (
          <BranchCol
            key={branch.key}
            branch={branch}
            level={skillLevel(branch)}
            activeNodes={activeNodes}
            /* the spine carries the skills the tree has no column for */
            dock={branch.key === FORTE_SPINE ? dock : []}
            dockLevel={dockLevel}
            cued={cued}
            reads={reads}
            onSkillChange={(next) => onSkillChange(branch, next)}
            onDockChange={onDockChange}
            onTraceToggle={onTraceToggle}
          />
        ))}
      </div>

      {onSkillData ? (
        <Placard
          subject={subject ?? null}
          doors={doors}
          cued={cued}
          onCue={setCued}
          onOpen={onSkillData}
        />
      ) : null}
    </div>
  )
}

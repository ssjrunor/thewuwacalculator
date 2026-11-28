/*
  Author: Runor Ewhro
  description: renders the editor node tree and handles drag operations for moving, inserting, and removing nodes.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnimatedVisibility } from '@/shared/hooks/useAnimatedVisibility'
import { bodyPortal } from '@/shared/lib/portalTarget'
import { ArrowUp, ArrowDown, ArrowRight, ChevronDown, CornerLeftUp, GripVertical } from 'lucide-react'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import * as Collapsible from '@radix-ui/react-collapsible'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { withDefEchoMg, withDefResMg } from '@/shared/lib/imageFallback.ts'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { Tooltip } from '@/shared/ui/Tooltip'
import { getEchoById } from '@/data/catalog/echoCatalogService.ts'
import {
  OffTuneCell,
  RegisterHead,
  bandCells,
  useScrollbarInset,
} from '@/modules/simulation/surfaces/rotation/program-editor/components/RegisterCells.tsx'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import type { AttributeKey, SkillAggType } from '@/domain/entities/stats.ts'
import type {
  EditorBlock,
  EditorCondition,
  NodeGate,
  EditorNode,
  EditorNote,
  NodeOwner,
  EditorSection,
  EditorStep,
  EditorHandoff,
  LoopRunSelections,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import type { EditorMember } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import { isEditorBlock } from '@/modules/simulation/surfaces/rotation/program-editor/model/program.ts'
import {
  countNodes,
  isUnrun,
  type DropEdge,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/treeEdit.ts'
import { carryFoldId } from '@/modules/simulation/surfaces/rotation/program-editor/interaction/selection.ts'
import {
  readStickyScopes,
  sameStack,
  scrollToScope,
  type StickyState,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/enclosingScopes.ts'
import {
  atRun,
  blockRatioAt,
  blockRunsAt,
  blockSteps,
  blockTotal,
  computeGhosts,
  computeCondRuns,
  factorAt,
  computeLoopCrossings,
  computeOwnerRuns,
  formatDamage,
  fmtStat,
  isTextStatKey,
  type OffTuneAuthoringState,
  rowFoldGroupAt,
  shortStat,
  buildRegister,
  type PercentDisplay,
  type RegisterGroup,
  type StatKey,
  stepDamageAt,
  stepHasRun,
  type GhostMap,
  type RunMap,
} from '@/modules/simulation/surfaces/rotation/program-editor/presentation/registerRows.ts'
import type {
  RotationNodeRevealRequest,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/nodeNavigation.ts'
import {
  collectEditorLoopScopeByNode,
  editorLoopId,
  selectedLoopRun,
  selectedRunForLoopIds,
} from '@/modules/simulation/surfaces/rotation/program-editor/model/executionScope.ts'
import { DEFAULT_ROT_BLOCK_COLOR } from '@/modules/simulation/surfaces/rotation/shared/containerMeta.ts'
import { ROT_NOTE_COLORS } from '@/modules/simulation/surfaces/rotation/shared/noteMeta.ts'
import { formatEffectConditionName } from '@/modules/simulation/model/sourceStateDisplay.ts'
import {
  buildGhostPill,
  EXTENT_MIME,
  KIND_MIME,
  PALETTE_MIME,
} from '@/modules/simulation/surfaces/rotation/program-editor/interaction/dragPayload.ts'
import type { PaletteSpec } from '@/modules/simulation/surfaces/rotation/program-editor/model/paletteSpec.ts'
import { truncTo } from '@/shared/lib/number'

export interface TeamLookup {
  member: (id: string) => EditorMember | undefined
  art: (owner: NodeOwner) => { src: string; alt: string; onError: typeof withDefResMg }

  accent: (
    owner: NodeOwner | undefined,
    opts?: {
      memberId?: string
      element?: AttributeKey
      color?: string
      aggregationType?: SkillAggType
    },
  ) => React.CSSProperties | undefined
}

export function makeRoster(members: EditorMember[]): TeamLookup {
  const byId = new Map(members.map((member) => [member.id, member]))
  const echoes = new Map(
    members
      .flatMap((member) => member.echoes)
      .filter((echo) => echo != null)
      .map((echo) => [echo.id, echo]),
  )

  const tone = (color: string | undefined, aggregationType?: SkillAggType) =>
    color
      ? ({
          '--rte-res': color,
          ...(aggregationType && aggregationType !== 'damage' ? { '--avg': color } : {}),
        } as React.CSSProperties)
      : undefined
  const tint = (attribute: AttributeKey | undefined) => tone(
    attribute ? ATTR_COLORS[attribute] : undefined,
  )

  return {
    member: (id) => byId.get(id),
    accent: (owner, opts = {}) => {
      if (opts.color) {
        return tone(opts.color, opts.aggregationType)
      }
      if (opts.element) {
        return tint(opts.element)
      }
      const id = opts.memberId ?? (owner?.kind === 'member' ? owner.memberId : undefined)
      return tint(id ? byId.get(id)?.attribute : undefined)
    },
    art: (owner) => {
      if (owner.kind === 'echo') {
        const echo = echoes.get(owner.echoId) ?? getEchoById(owner.echoId)
        return {
          src: echo?.icon ?? `/assets/game/echoes/icons/${owner.echoId}.webp`,
          alt: echo?.name ?? 'Echo',
          onError: withDefEchoMg,
        }
      }
      const member = byId.get(owner.memberId)
      return { src: member?.profile ?? '', alt: member?.name ?? 'Resonator', onError: withDefResMg }
    },
  }
}

function GateChip({ gate }: { gate: NodeGate }) {
  void gate
  return <span className="rte-chip rte-chip--dead">never runs</span>
}

interface DragBinding {
  // drag handlers for a node's own element; `gutterGrab` also arms the drag from the element's left padding, where a
  // block draws its bracket
  props: (id: string, node: EditorNode, opts?: DragOpts) => Record<string, unknown>
  grip: (id: string) => Record<string, unknown>
  edge: (blockId: string) => Record<string, unknown>
  // the block whose closing edge is in hand
  edgeId: string | null
  // ` is-dragging` / ` is-drop-before` / ` is-drop-after`, ready to append
  className: (id: string) => string
  zone: (containerId: string, opts?: ZoneOpts) => Record<string, unknown>
  // swallows drops inside the list that land on no node, so they never reach the shell
  sink: Record<string, unknown>
  // drop target that removes a node from the rotation
  discard: Record<string, unknown>
  leaving: boolean
}

interface ZoneOpts {
  // the class the drop area takes before `is-over` is appended
  base?: string
  acceptsOnly?: 'condition'
}

interface DragOpts {
  // also arm the drag from the left padding, where a block draws its bracket
  gutterGrab?: boolean
  // part of its parent: droppable into and fixed in place
  fixed?: boolean
  acceptsOnly?: 'condition'
}

function Grip({ handlers }: { handlers: Record<string, unknown> }) {
  return (
    <span className="rte-grip" aria-hidden="true" {...handlers}>
      <GripVertical size="0.72rem" />
    </span>
  )
}

// position the card relative to the viewport because rows can be clipped by scrollers and collapsibles
const ASIDE_HOSTS = '.rte-row, .rte-cond, .rte-swap, .rte-block__head'
const ASIDE_GAP = 16
const ASIDE_EDGE = 8
const ASIDE_TAIL = 7

interface AsideSpot {
  left: number
  top: number
  tail: number
  below: boolean
}

function mkAsideSpot(bubble: DOMRect, card: DOMRect): AsideSpot {
  const width = card.width || bubble.width
  const room = Math.max(ASIDE_EDGE, window.innerWidth - width - ASIDE_EDGE)
  const left = Math.min(Math.max(bubble.left - ASIDE_EDGE, ASIDE_EDGE), room)
  const above = bubble.top - ASIDE_GAP - card.height
  const below = above < ASIDE_EDGE
  const tail = Math.min(
    Math.max(bubble.left + bubble.width / 2 - left - ASIDE_TAIL, 10),
    Math.max(10, width - 24),
  )

  return {
    left,
    top: below ? bubble.bottom + ASIDE_GAP : above,
    tail,
    below,
  }
}

// display the condition state name from game data and underline it when a description is available; hover shows the
// description, and keyboard selection shows it in the inspector without keeping a tooltip open on row focus
function CondName({
  node,
  accent,
}: {
  node: EditorCondition
  // the row's own token, which the portaled card cannot inherit
  accent?: React.CSSProperties
}) {
  const keyed = Boolean(node.description)

  if (!keyed) {
    return <em className="rte-cond__name">{formatEffectConditionName(node.effectName, node.label)}</em>
  }

  const displayName = formatEffectConditionName(node.effectName, node.label)

  return (
    <Tooltip
      placement="bottom"
      content={(
        <span className="rte-gloss" style={accent}>
          {(node.effectName ?? node.sourceName) ? (
            <span className="rte-gloss__src">{node.effectName ?? node.sourceName}</span>
          ) : null}
          <RichDscr className="rte-cdesc"
            description={node.description ?? ''}
            params={node.descriptionParams}
          />
        </span>
      )}
    >
      <em className="rte-cond__name is-keyed"
        // the note opens from the whole row, except while the pointer is on the term
        data-quiets-note="true"
      >
        {displayName}
      </em>
    </Tooltip>
  )
}

// a note attached to a row: a small bubble on the row at rest, and the remark in a tailed bubble that opens on hover
// or keyboard focus; the tail shows which of two neighbouring rows the card belongs to
function NoteAside({
  note,
  speaker,
}: {
  note: EditorNote
  // an attached note uses its host's owner as its speaker
  speaker?: { src: string; alt: string; onError: (event: React.SyntheticEvent<HTMLImageElement>) => void }
}) {
  const bubRef = useRef<HTMLSpanElement | null>(null)
  const cardRef = useRef<HTMLSpanElement | null>(null)
  const [spot, setSpot] = useState<AsideSpot | null>(null)
  const vis = useAnimatedVisibility(230, 2)
  const { show, hide, open, visible } = vis

  // the host row and the bubble on it both open the note card
  useEffect(() => {
    const host = bubRef.current?.closest(ASIDE_HOSTS) ?? bubRef.current
    if (!host) return
    // a row can host both a note and a state gloss: `onTerm` hides the note while the pointer or focus is on the
    // glossed word and restores it when it leaves. the pointer pair bubbles, so the row receives it for a term it has
    // no reference to, and both act only when crossing the term's own edge, because `show` is not idempotent and
    // calling it on every child would restart the card's entrance
    const onTerm = (target: EventTarget | null) => (
      target instanceof Element ? Boolean(target.closest('[data-quiets-note]')) : false
    )
    const enter = () => show()
    const leave = () => hide()
    const focusEnter = (event: Event) => {
      if (onTerm(event.target)) leave()
      else show()
    }
    // the row stays active while moving between its own controls
    const away = (event: Event) => {
      const related = (event as FocusEvent).relatedTarget as Node | null
      if (host.contains(related)) return
      hide()
    }
    const overTerm = (event: Event) => {
      if (onTerm(event.target)) leave()
    }
    const offTerm = (event: Event) => {
      const to = (event as PointerEvent).relatedTarget as Node | null
      // back on the row itself; leaving the row entirely is handled by its own pointerleave, which has already run
      if (onTerm(event.target) && host.contains(to) && !onTerm(to)) show()
    }
    host.addEventListener('pointerenter', enter)
    host.addEventListener('pointerleave', leave)
    host.addEventListener('pointerover', overTerm)
    host.addEventListener('pointerout', offTerm)
    host.addEventListener('focusin', focusEnter)
    host.addEventListener('focusout', away)
    return () => {
      host.removeEventListener('pointerenter', enter)
      host.removeEventListener('pointerleave', leave)
      host.removeEventListener('pointerover', overTerm)
      host.removeEventListener('pointerout', offTerm)
      host.removeEventListener('focusin', focusEnter)
      host.removeEventListener('focusout', away)
    }
  }, [hide, show])

  useLayoutEffect(() => {
    if (!visible) return
    const place = () => {
      const bubble = bubRef.current?.getBoundingClientRect()
      const card = cardRef.current?.getBoundingClientRect()
      if (!bubble || !card) return
      setSpot(mkAsideSpot(bubble, card))
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [visible])

  const tint = { '--rte-note': note.color ?? ROT_NOTE_COLORS[0] } as React.CSSProperties
  const host = bodyPortal()

  return (
    <span ref={bubRef} className="rte-noted" style={tint}>
      <i className="rte-bub" aria-hidden="true" />
      {visible && host ? createPortal(
        <span
          ref={cardRef}
          className={`rte-aside rte-aside--free${open ? ' is-open' : ''}${spot?.below ? ' is-below' : ''}`}
          role="note"
          style={{
            ...tint,
            left: `${spot?.left ?? 0}px`,
            top: `${spot?.top ?? 0}px`,
            '--rte-tail': `${spot?.tail ?? 12}px`,
            visibility: spot ? undefined : 'hidden',
          } as React.CSSProperties}
        >
          <span className="rte-aside__who">
            {speaker ? (
              <DisplayImage className="rte-aside__face" src={speaker.src} alt="" onError={speaker.onError} loading="lazy" />
            ) : null}
            {speaker?.alt ?? 'Note'}
            {note.label ? <s>{note.label}</s> : null}
          </span>
          <span className={`rte-aside__said${note.text ? '' : ' is-empty'}`}>
            {note.text || 'This note has no text yet.'}
          </span>
        </span>,
        host,
      ) : null}
    </span>
  )
}

// render a standalone `EditorNote` without a portrait or speaker bubble
function NoteLine({
  node,
  drag,
  inspected,
  selectionMode,
  compareMark,
  focusSelected,
  inSetup,
  rowMenu,
  onSelect,
}: {
  node: EditorNote
  drag: DragBinding
  inspected: boolean
  selectionMode: boolean
  compareMark: 'on' | 'off' | null
  focusSelected: boolean
  inSetup: boolean
  rowMenu: (node: EditorNode) => MenuEntry[]
  onSelect: (event: React.MouseEvent<HTMLElement>, id: string) => void
}) {
  return (
    <ContextTrigger
      asChild
      ariaLabel={`${node.label ?? 'Note'} actions`}
      getItems={() => rowMenu(node)}
    >
    <button
      type="button"
      data-rte-node-id={node.id}
      data-selection-focus-item="true"
      className={`rte-noteline${compareMark ? ` is-cmp-${compareMark}` : ''}${inspected ? ' is-selected' : ''}${
        selectionMode ? ' selection-mode' : ''
      }${focusSelected ? ' focus-selected' : ''}${drag.className(node.id)}`}
      style={{ '--rte-note': node.color ?? ROT_NOTE_COLORS[0] } as React.CSSProperties}
      aria-pressed={selectionMode ? undefined : inspected}
      aria-selected={selectionMode ? focusSelected : undefined}
      onClick={(event) => onSelect(event, node.id)}
      {...drag.props(node.id, node, inSetup ? { acceptsOnly: 'condition' } : {})}
    >
      <Grip handlers={drag.grip(node.id)} />
      <i className="rte-noteline__rule" aria-hidden="true" />
      <span className={`rte-noteline__said${node.text ? '' : ' is-empty'}`}>
        {node.label ? <b>{node.label}</b> : null}
        {node.text || 'Empty note'}
      </span>
      <i className="rte-noteline__rule" aria-hidden="true" />
    </button>
    </ContextTrigger>
  )
}

// show a dragged node's portrait, name, and optional qualifier without row-specific numeric values
function ghostParts(
  node: EditorNode,
  roster: TeamLookup,
): { art?: string; label: string; note?: string; accent?: string } {
  if (node.type === 'note') {
    return { label: node.label ?? 'Note', note: node.text, accent: node.color }
  }
  if (node.type === 'swap') {
    const to = roster.member(node.to)
    return { art: to?.profile, label: to?.name ?? 'Switch resonator', note: 'on field' }
  }

  if (isEditorBlock(node)) {
    if (node.type !== 'setup' && node.color) {
      const uptime = node.type === 'repeat' ? ` · ${truncTo((node.ratio ?? 1) * 100)}%` : ''
      return { label: node.label, note: `x${node.runs}${uptime}`, accent: node.color }
    }
    // a setup branch runs once, in full
    return { label: node.label, note: node.type === 'setup' ? '' : `x${node.runs}` }
  }

  const art = roster.art(node.owner)
  return {
    art: art.src,
    accent: node.type === 'step'
      ? node.color ?? (node.element ? ATTR_COLORS[node.element] : undefined)
      : undefined,
    label: node.label,
    note: node.type === 'condition' ? node.to : undefined,
  }
}

function buildGhost(
  node: EditorNode,
  roster: TeamLookup,
  host: Element | null,
  count = 1,
): HTMLElement | null {
  return host ? buildGhostPill(ghostParts(node, roster), host, count) : null
}

// handles dragging for every node type by id; dropping beside a node inside a loop moves the dragged node into that
// loop
export function useNodeDrag({
  members,
  disabled = false,
  selection,
  onMove,
  onMoveMany,
  onInsert,
  onInto,
  onRemove,
  onExtent,
}: {
  members: EditorMember[]
  disabled?: boolean
  // in selection mode the list is otherwise undraggable, because a press on a row picks it; the picked rows keep
  // their grips, and a grip there drags the whole set
  selection?: {
    mode: boolean
    ids: ReadonlySet<string>
    // the picked rows in list order, which is the order they are set down in
    inOrder: readonly string[]
    // those rows and everything inside them: none of it can be the target
    holds: ReadonlySet<string>
  }
  onMove: (id: string, targetId: string, edge: DropEdge) => void
  onMoveMany: (ids: readonly string[], targetId: string, edge: DropEdge) => void
  onInsert: (spec: PaletteSpec, targetId: string, edge: DropEdge) => void
  onInto: (containerId: string, payload: PaletteSpec | string | readonly string[]) => void
  onRemove: (id: string) => void
  onExtent: (
    blockId: string,
    targetId: string,
    placement?: 'after' | 'inside',
  ) => void
}): DragBinding {
  const roster = useMemo(() => makeRoster(members), [members])
  const [held, setHeld] = useState<{
    id: string
    kind: 'condition' | 'note' | 'other'
    // every node in hand, when a whole selection was picked up
    ids?: readonly string[]
  } | null>(null)
  const heldId = held?.id ?? null
  const selMode = selection?.mode ?? false
  const selIds = selection?.ids

  // outside selection mode every node is draggable; inside it, only a picked row is, and dragging it drags all of
  // them, with every other drag action disabled
  const canGrab = (id: string) => !disabled || (selMode && Boolean(selIds?.has(id)))
  // a target cannot be a row in hand or a row inside a block in hand, because both would place the set inside itself;
  // refuse the target during row evaluation, and the drop line offers only valid positions
  const inHand = (id: string) => Boolean(held?.ids) && Boolean(selection?.holds.has(id))
  const [armedId, setArmedId] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [overZone, setOverZone] = useState<string | null>(null)
  const [over, setOver] = useState<{ id: string; edge: DropEdge } | null>(null)
  const [edgeId, setEdgeId] = useState<string | null>(null)

  // a press that never became a drag disarms, so the node is not left draggable for the next press
  useEffect(() => {
    if (!armedId) {
      return
    }
    const disarm = () => setArmedId(null)
    window.addEventListener('mouseup', disarm)
    return () => window.removeEventListener('mouseup', disarm)
  }, [armedId])

  const grip = (id: string) => ({
    onMouseDown: (event: React.MouseEvent) => {
      if (!canGrab(id)) {
        return
      }
      event.stopPropagation()
      setArmedId(id)
    },
    // prevent grip clicks from selecting or folding the enclosing button
    onClick: (event: React.MouseEvent) => {
      if (!canGrab(id)) {
        return
      }
      event.stopPropagation()
      event.preventDefault()
    },
  })

  const edge = (blockId: string) => ({
    draggable: !disabled,
    onMouseDown: (event: React.MouseEvent) => event.stopPropagation(),
    onClick: (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
    },
    onDragStart: (event: React.DragEvent) => {
      if (disabled) {
        return
      }
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(EXTENT_MIME, blockId)
      // firefox refuses to start a drag without a text payload
      event.dataTransfer.setData('text/plain', blockId)
      setEdgeId(blockId)
    },
    onDragEnd: () => {
      setEdgeId(null)
      setOver(null)
    },
  })

  const props = (id: string, node: EditorNode, opts: DragOpts = {}) => ({
    draggable: canGrab(id) && !opts.fixed && armedId === id,
    ...(opts.gutterGrab && !opts.fixed && !disabled
      ? {
          onMouseDown: (event: React.MouseEvent) => {
            const element = event.currentTarget as HTMLElement
            // the grab zone is the bracket's padding, which is zero when shut
            const gutter = Number.parseFloat(getComputedStyle(element).paddingLeft) || 0
            if (gutter > 0 && event.clientX - element.getBoundingClientRect().left <= gutter) {
              setArmedId(id)
            }
          },
        }
      : {}),
    onDragStart: (event: React.DragEvent) => {
      if (!canGrab(id)) {
        return
      }
      event.stopPropagation()
      event.dataTransfer.effectAllowed = 'move'
      // firefox refuses to start a drag without payload on the transfer
      event.dataTransfer.setData('text/plain', id)

      const heldIds = selMode ? selection?.inOrder : undefined
      const pill = buildGhost(node, roster, event.currentTarget.closest('.rte-page'), heldIds?.length ?? 1)
      if (pill) {
        event.dataTransfer.setDragImage(pill, 14, pill.offsetHeight / 2)
        // setDragImage snapshots synchronously; remove the element next frame
        requestAnimationFrame(() => pill.remove())
      }

      setHeld({
        id,
        kind: node.type === 'condition' ? 'condition' : node.type === 'note' ? 'note' : 'other',
        ...(heldIds && heldIds.length > 1 ? { ids: heldIds } : {}),
      })
    },
    onDragEnd: () => {
      setHeld(null)
      setArmedId(null)
      setLeaving(false)
      setOver(null)
      setOverZone(null)
    },
    onDragOver: (event: React.DragEvent) => {
      // in selection mode the list accepts only a selection already in hand
      if ((disabled && !heldId) || inHand(id)) {
        return
      }
      const types = event.dataTransfer.types
      const fromPalette = types.includes(PALETTE_MIME)

      // an extent drag makes the target row the block's last node; setup branches cannot serve as boundaries
      if (types.includes(EXTENT_MIME)) {
        if (opts.acceptsOnly === 'condition') {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        event.dataTransfer.dropEffect = 'move'
        setLeaving(false)
        setOver((prev) => (prev?.id === id && prev.edge === 'after' ? prev : { id, edge: 'after' }))
        return
      }

      if (!fromPalette && (!heldId || heldId === id)) {
        return
      }

      // a setup branch contains preconditions and inert notes; notes do not enter the simulation, so they can
      // annotate setup without changing it
      if (opts.acceptsOnly) {
        const kind = fromPalette
          ? (types.includes(KIND_MIME.condition) ? 'condition' : 'other')
          : held?.kind
        if (kind !== opts.acceptsOnly && !(opts.acceptsOnly === 'condition' && kind === 'note')) {
          // refuse here and stop propagation, so the enclosing block does not accept what this row refused
          event.stopPropagation()
          return
        }
      }
      // a block is its head and its bracket, and everything below and right of those is its body; a drop beside a
      // block lands on the block itself, so a release in the space around its rows places the node inside the block
      if (opts.gutterGrab) {
        const element = event.currentTarget as HTMLElement
        const bounds = element.getBoundingClientRect()
        const gutter = Number.parseFloat(getComputedStyle(element).paddingLeft) || 0
        const head = element.querySelector(':scope > .rte-block__head')
        const headBottom = head ? head.getBoundingClientRect().bottom : bounds.top
        const onBracket = event.clientX - bounds.left <= gutter
        if (!onBracket && event.clientY > headBottom) {
          return
        }
      }

      // stopping propagation makes the innermost target win
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = fromPalette ? 'copy' : 'move'
      setLeaving(false)

      const box = event.currentTarget.getBoundingClientRect()
      const edge: DropEdge = event.clientY < box.top + box.height / 2 ? 'before' : 'after'
      setOver((prev) => (prev?.id === id && prev.edge === edge ? prev : { id, edge }))
    },
    onDragLeave: () => {
      setOver((prev) => (prev?.id === id ? null : prev))
    },
    onDrop: (event: React.DragEvent) => {
      if ((disabled && !heldId) || inHand(id)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()

      // the payload is readable only on drop, so the checks above read the type list
      const extent = event.dataTransfer.getData(EXTENT_MIME)
      if (extent) {
        onExtent(extent, id)
        setEdgeId(null)
        setOver(null)
        return
      }

      const payload = event.dataTransfer.getData(PALETTE_MIME)
      if (payload) {
        const edge = over?.id === id ? over.edge : 'after'
        onInsert(JSON.parse(payload) as PaletteSpec, id, edge)
      } else if (held?.ids && over?.id === id) {
        onMoveMany(held.ids, id, over.edge)
      } else if (heldId && over?.id === id) {
        onMove(heldId, id, over.edge)
      }

      setHeld(null)
      setArmedId(null)
      setLeaving(false)
      setOver(null)
    },
  })

  const zone = (containerId: string, opts: ZoneOpts = {}) => ({
    className: `${opts.base ?? 'rte-sec__zone'}${overZone === containerId ? ' is-over' : ''}`,
    onDragLeave: () => setOverZone((prev) => (prev === containerId ? null : prev)),
    onDragOver: (event: React.DragEvent) => {
      // selection mode disables unselected row grabs, but a selected row is still a drag source and can arm this
      // empty target
      if (disabled && !heldId) {
        return
      }
      const types = event.dataTransfer.types
      const fromPalette = types.includes(PALETTE_MIME)
      const fromExtent = types.includes(EXTENT_MIME)
      if (!fromPalette && !fromExtent && !heldId) {
        return
      }

      // setup branches accept only conditions and notes; stop rejected drops here so the enclosing block does not
      // accept them
      if (opts.acceptsOnly) {
        const kind = fromPalette
          ? (types.includes(KIND_MIME.condition) ? 'condition' : 'other')
          : held?.kind
        if (kind !== opts.acceptsOnly && !(opts.acceptsOnly === 'condition' && kind === 'note')) {
          event.stopPropagation()
          setOverZone((prev) => (prev === containerId ? null : prev))
          return
        }
      }

      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = fromPalette ? 'copy' : 'move'
      setLeaving(false)
      setOver(null)
      setOverZone((prev) => (prev === containerId ? prev : containerId))
    },
    onDrop: (event: React.DragEvent) => {
      if (disabled && !heldId) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setOverZone(null)

      const extent = event.dataTransfer.getData(EXTENT_MIME)
      if (extent) {
        onExtent(extent, containerId, 'inside')
        setEdgeId(null)
        setOver(null)
        return
      }

      const payload = event.dataTransfer.getData(PALETTE_MIME)
      if (payload) {
        onInto(containerId, JSON.parse(payload) as PaletteSpec)
      } else if (held?.ids) {
        onInto(containerId, held.ids)
      } else if (heldId) {
        onInto(containerId, heldId)
      }

      setHeld(null)
      setArmedId(null)
      setLeaving(false)
      setOver(null)
    },
  })

  // a drop on empty list space stops before the shell, which reads any drop on itself as removing the node from the
  // rotation
  const sink = {
    onDragOver: (event: React.DragEvent) => {
      if (disabled && !heldId) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setLeaving(false)
    },
    onDrop: (event: React.DragEvent) => {
      if (disabled && !heldId) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      setHeld(null)
      setArmedId(null)
      setLeaving(false)
      setOver(null)
    },
  }

  // outside the list is off the rotation: a palette drag dropped here is discarded, and cancelling with escape fires
  // no drop, so neither deletes anything
  const discard = {
    onDragOver: (event: React.DragEvent) => {
      // dropping a whole selection off the list does not delete it; a selection is deleted by its key and menu action
      if (disabled || !heldId || held?.ids) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setLeaving(true)
      setOver(null)
    },
    onDrop: (event: React.DragEvent) => {
      if (disabled || !heldId || held?.ids) {
        return
      }
      event.preventDefault()
      onRemove(heldId)
      setHeld(null)
      setArmedId(null)
      setLeaving(false)
      setOver(null)
    },
  }

  const className = (id: string) => {
    if (disabled && !heldId) {
      return ''
    }
    // a set in hand dims every one of its rows equally
    if (heldId === id || inHand(id)) {
      return ' is-dragging'
    }
    if (over?.id === id) {
      return over.edge === 'before' ? ' is-drop-before' : ' is-drop-after'
    }
    return ''
  }

  return {
    props,
    grip,
    edge,
    edgeId: disabled ? null : edgeId,
    className,
    zone,
    sink,
    discard,
    leaving: disabled ? false : leaving,
  }
}

// render one selector cell per loop pass; selecting the active cell advances to the next pass with wraparound, and
// arrow keys also change the pass
function RunTrack({
  loopId,
  runs,
  run,
  label,
  onRunChange,
}: {
  loopId: string
  runs: number
  run: number
  label: string
  onRunChange: (loopId: string, run: number) => void
}) {
  const wrap = (value: number) => ((value - 1 + runs) % runs) + 1

  return (
    <span className="rte-track"
      role="radiogroup"
      aria-label={`${label} pass`}
      onKeyDown={(event) => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
          ? 1
          : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
            ? -1
            : 0
        const next = step !== 0
          ? wrap(run + step)
          : event.key === 'Home'
            ? 1
            : event.key === 'End'
              ? runs
              : 0
        if (!next) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        onRunChange(loopId, next)
      }}
    >
      {Array.from({ length: runs }, (_, index) => index + 1).map((value) => {
        const on = value === run
        return (
          <span
            key={value}
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={on ? 'rte-track__cell is-on' : 'rte-track__cell'}

            title={on ? `Next run of ${label}` : `Run ${value} of ${runs}`}
            aria-label={`Show ${label} run ${value} of ${runs}`}
            onClick={(event) => {
              event.stopPropagation()
              onRunChange(loopId, on ? wrap(value + 1) : value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              event.preventDefault()
              event.stopPropagation()
              onRunChange(loopId, on ? wrap(value + 1) : value)
            }}
          />
        )
      })}
    </span>
  )
}

// a handoff renders without the row grid, because a swap has no damage and no stats
function SwapRow({
  node,
  drag,
  roster,
  inspected,
  selectionMode,
  compareMark,
  focusSelected,
  stale,
  rowMenu,
  onSelect,
}: {
  node: EditorHandoff
  drag: DragBinding
  roster: TeamLookup
  inspected: boolean
  selectionMode: boolean
  compareMark: 'on' | 'off' | null
  focusSelected: boolean
  stale: boolean
  rowMenu: (node: EditorNode) => MenuEntry[]
  onSelect: (event: React.MouseEvent<HTMLElement>, id: string) => void
}) {
  const from = roster.member(node.from)
  const to = roster.member(node.to)
  if (!from || !to) {
    return null
  }

  return (
    <ContextTrigger asChild ariaLabel={`Swap to ${to.name} actions`} getItems={() => rowMenu(node)}>
    <button
      type="button"
      data-rte-node-id={node.id}
      data-selection-focus-item="true"
      aria-pressed={selectionMode ? undefined : inspected}
      aria-selected={selectionMode ? focusSelected : undefined}
      className={`rte-swap${compareMark ? ` is-cmp-${compareMark}` : ''}${inspected ? ' is-selected' : ''}${
        selectionMode ? ' selection-mode' : ''
      }${focusSelected ? ' focus-selected' : ''}${
        node.disabled ? ' is-off' : ''
      }${stale ? ' is-stale' : ''}${drag.className(node.id)}`}
      style={roster.accent(undefined, { memberId: node.to })}
      title={`Swapping from ${from.name} to, ${to.name}`}
      onClick={(event) => onSelect(event, node.id)}
      {...drag.props(node.id, node)}
    >
      <Grip handlers={drag.grip(node.id)} />
      <DisplayImage className="rte-swap__out" src={from.profile} alt="" onError={withDefResMg} loading="lazy" />
      <ArrowRight className="rte-swap__arw" size="0.85rem" aria-hidden="true" />
      <DisplayImage className="rte-swap__in" src={to.profile} alt="" onError={withDefResMg} loading="lazy" />
      <b className="rte-swap__to">{to.name}</b>
      {node.attachedNote ? (
        <NoteAside note={node.attachedNote} speaker={{ src: to.profile, alt: to.name, onError: withDefResMg }} />
      ) : null}
    </button>
    </ContextTrigger>
  )
}

// a condition row; the prior value shows on hover, or stays open with the page's `showPriors` switch
function CondLine({
  node,
  run,
  underHead,
  fold,
  drag,
  roster,
  inSetup,
  disabled,
  inspected,
  selectionMode,
  compareMark,
  focusSelected,
  stale,
  rowMenu,
  onSelect,
}: {
  node: EditorCondition
  run: number
  // folded under a head above it, which displays source art for both
  underHead?: boolean
  fold?: { count: number; shut: boolean; onToggle: () => void }
  drag: DragBinding
  roster: TeamLookup
  inSetup: boolean
  disabled?: boolean
  inspected: boolean
  selectionMode: boolean
  compareMark: 'on' | 'off' | null
  focusSelected: boolean
  stale: boolean
  rowMenu: (node: EditorNode) => MenuEntry[]
  onSelect: (event: React.MouseEvent<HTMLElement>, id: string) => void
}) {
  const off = disabled || node.disabled
  const art = roster.art(node.owner)
  const foldable = (fold?.count ?? 0) > 1
  const artSrc = underHead ? null : node.sourceIcon
  // simulation may observe a different before/after value on a later pass
  const wrote = atRun(node.byRun, run, { from: node.from, to: node.to, rising: node.rising })
  const hasPrior = wrote.from !== undefined
  const stateLabel = hasPrior ? `${wrote.from} to ${wrote.to}` : wrote.to

  return (
    <ContextTrigger asChild ariaLabel={`${node.label} actions`} getItems={() => rowMenu(node)}>
    <button
      type="button"
      data-rte-node-id={node.id}
      data-selection-focus-item="true"
      className={`rte-cond${hasPrior ? wrote.rising ? ' is-up' : ' is-down' : ''}${
        off ? ' is-off' : ''
      }${inspected ? ' is-selected' : ''}${selectionMode ? ' selection-mode' : ''}${
        focusSelected ? ' focus-selected' : ''
      }${compareMark ? ` is-cmp-${compareMark}` : ''}${
        stale ? ' is-stale' : ''
      }${drag.className(node.id)}`}
      style={roster.accent(node.owner)}
      title={`${art.alt} . ${node.label} . ${stateLabel}`}
      aria-pressed={selectionMode ? undefined : inspected}
      aria-selected={selectionMode ? focusSelected : undefined}
      onClick={(event) => onSelect(event, node.id)}
      {...drag.props(node.id, node, inSetup ? { acceptsOnly: 'condition' } : {})}
    >
      <Grip handlers={drag.grip(node.id)} />
      <i
        className={`rte-cond__tick${foldable ? ' is-foldable' : ''}${
          fold?.shut ? ' is-shut' : ''
        }`}
        aria-hidden={!foldable}
        {...(foldable
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-expanded': !fold?.shut,
              title: `${node.sourceName ?? 'Source'} . ${fold?.count} states . click to ${
                fold?.shut ? 'show' : 'fold'
              } them`,
              onClick: (event: React.MouseEvent) => {
                event.stopPropagation()
                fold?.onToggle()
              },
              onKeyDown: (event: React.KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                fold?.onToggle()
              },
            }
          : {})}
      >
        {artSrc ? (
          <DisplayImage className="rte-cond__art"
            src={artSrc}
            alt=""
            onError={withDefEchoMg}
            loading="lazy"
          />
        ) : null}
        {foldable ? <b className="rte-cond__count">{fold?.count}</b> : null}
      </i>
      <CondName node={node} accent={roster.accent(node.owner)} />
      {node.attachedNote ? (
        <NoteAside note={node.attachedNote} speaker={{ src: art.src, alt: art.alt, onError: art.onError }} />
      ) : null}
      {node.extra ? <span className="rte-cond__more">+{node.extra} more</span> : null}
      <span className="rte-cond__fill" />
      <span className="rte-cond__delta">
        {hasPrior ? (
          <>
            <s className="rte-cond__was">{wrote.from}</s>
            <i className="rte-cond__arrow" aria-hidden="true">&rarr;</i>
          </>
        ) : null}
        <b className="rte-cond__now">{wrote.to}</b>
      </span>
    </button>
    </ContextTrigger>
  )
}

// height of one restated header, matching .rte-sticky__row in css
const STICKY_ROW = 22

// how long a scope must stay enclosing before its entry is added
const STICKY_ENTER_DELAY = 300

// restates the headers of every scope enclosing the top of the scrollport
function useStickyScopes(deps: unknown) {
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [stack, setStack] = useState<StickyState>({ scopes: [], shift: 0 })
  // the committed stack, readable without making the measure depend on state
  const shown = useRef<StickyState>({ scopes: [], shift: 0 })
  const waiting = useRef(0)

  const measure = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    const next = readStickyScopes(scroller, STICKY_ROW)
    const prev = shown.current

    const commit = (value: StickyState) => {
      shown.current = value
      setStack(value)
    }

    // an arriving entry must hold briefly before it is added, and a leaving entry is removed at once, so fast
    // scrolling through a short scope does not push and pop it immediately
    const arriving =
      next.scopes.length > prev.scopes.length &&
      prev.scopes.every((scope, index) => scope.el === next.scopes[index]?.el)

    if (!arriving) {
      if (waiting.current) {
        window.clearTimeout(waiting.current)
        waiting.current = 0
      }
      if (!sameStack(prev, next)) {
        commit(next)
      }
      return
    }

    // the entry is held back, and the lift tracks while it waits
    if (prev.shift !== next.shift) {
      commit({ ...prev, shift: next.shift })
    }

    if (!waiting.current) {
      waiting.current = window.setTimeout(() => {
        waiting.current = 0
        // re-read when the timer settles, because a scope can scroll past meanwhile
        const settled = readStickyScopes(scroller, STICKY_ROW)
        if (!sameStack(shown.current, settled)) {
          shown.current = settled
          setStack(settled)
        }
      }, STICKY_ENTER_DELAY)
    }
  }, [])

  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }

    let frame = 0
    const onScroll = () => {
      if (frame) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    const observer = new ResizeObserver(onScroll)
    observer.observe(scroller)
    measure()

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      if (waiting.current) {
        window.clearTimeout(waiting.current)
        waiting.current = 0
      }
      scroller.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [measure, deps])

  return { scrollerRef, stack }
}

// align step and attached-feature cells under the same column groups
interface NodeListProps {
  sections: EditorSection[]
  members: EditorMember[]
  runsByLoopId: LoopRunSelections
  peakDamage: number
  selectedId: string | null
  selectionMode: boolean
  selectedIds: ReadonlySet<string>
  revealRequest: RotationNodeRevealRequest | null
  shutIds: ReadonlySet<string>
  // nodes the last run either never saw, or saw as something else
  staleIds: ReadonlySet<string>
  ghostRepeats: boolean
  showPriors: boolean
  onOpenChange: (id: string, open: boolean) => void
  onSelect: (node: EditorStep | null, id: string) => void
  // enable clicking rows to add them to the comparison
  compareMode: boolean
  // `on` marks included rows; `off` marks rows excluded by the limit
  compareMark: (id: string) => 'on' | 'off' | null
  onCompareToggle: (id: string) => void
  onAddSelection: (id: string) => void
  onRangeSelection: (id: string) => void
  onToggleSelection: (id: string) => void
  onRunChange: (loopId: string, run: number) => void
  // the factors each row states, in the order they are read
  statKeys: readonly StatKey[]
  // the order the register's bands read in, left to right
  groupOrder: readonly RegisterGroup[]
  // register bands folded down to a single track
  shutGroups: ReadonlySet<RegisterGroup>
  onToggleGroup: (group: RegisterGroup) => void
  // how many decimal places calculated row values state
  decimals: number
  // whether multiplicative stats read as percentages or decimal factors
  percentDisplay: PercentDisplay
  // what a right-click on a row offers, built by the page from its actions
  rowMenu: (node: EditorNode) => MenuEntry[]
  // move where off-tune starts counting again after a tune break
  onOffTuneResume: (id: string, on: boolean) => void
  offTuneAuthoring: ReadonlyMap<string, OffTuneAuthoringState>
  drag: DragBinding
}

export function NodeList({
  sections,
  members,
  runsByLoopId,
  peakDamage,
  selectedId,
  selectionMode,
  selectedIds,
  compareMode,
  compareMark,
  onCompareToggle,
  revealRequest,
  shutIds,
  staleIds,
  ghostRepeats,
  showPriors,
  onOpenChange,
  onSelect,
  onAddSelection,
  onRangeSelection,
  onToggleSelection,
  onRunChange,
  statKeys,
  groupOrder,
  shutGroups,
  onToggleGroup,
  decimals,
  percentDisplay,
  rowMenu,
  onOffTuneResume,
  offTuneAuthoring,
  drag,
}: NodeListProps) {
  const roster = useMemo(() => makeRoster(members), [members])
  const register = useMemo(
    () => buildRegister(statKeys, shutGroups, groupOrder),
    [groupOrder, shutGroups, statKeys],
  )
  const listRef = useRef<HTMLElement | null>(null)
  const { scrollerRef, stack } = useStickyScopes(`${sections.length}:${shutIds.size}`)
  const loopScope = useMemo(
    () => collectEditorLoopScopeByNode(sections),
    [sections],
  )
  // the same step resolves a different stat line per run
  const ghosts: GhostMap = useMemo(
    () => computeGhosts(sections, runsByLoopId, loopScope.byNodeId),
    [loopScope, runsByLoopId, sections],
  )
  const ownerRuns: RunMap = useMemo(() => computeOwnerRuns(sections), [sections])
  const condRuns: RunMap = useMemo(() => computeCondRuns(sections), [sections])
  // a setup branch reads its window off the block holding it
  const setupHosts = useMemo(() => {
    const hosts = new Map<string, EditorBlock>()
    const visit = (nodes: readonly EditorNode[]) => {
      for (const node of nodes) {
        if (!isEditorBlock(node)) continue
        for (const child of node.children) {
          if (child.type === 'setup') hosts.set(child.id, node)
        }
        visit(node.children)
      }
    }
    for (const section of sections) visit(section.children)
    return hosts
  }, [sections])
  const crossings = useMemo(() => computeLoopCrossings(sections), [sections])

  // the rows scroll and the heading does not, so with a reserved scrollbar the heading's tracks end further right
  // than the rows'; the offset is measured because overlay scrollbars reserve none
  useScrollbarInset(listRef, scrollerRef)

  const isInspected = (id: string) => !selectionMode && selectedId === id
  const isFocusSelected = (id: string) => selectionMode && selectedIds.has(id)

  const selectNode = (
    event: React.MouseEvent<HTMLElement>,
    node: EditorStep | null,
    id: string,
  ) => {
    if (event.defaultPrevented) {
      return
    }

    // in comparison mode, clicks add rows to the rack until it is full
    if (compareMode) {
      event.preventDefault()
      event.stopPropagation()
      if (compareMark(id) !== 'off') {
        onCompareToggle(id)
      }
      return
    }

    if (event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      onRangeSelection(id)
      return
    }

    if (selectionMode) {
      event.preventDefault()
      event.stopPropagation()
      onToggleSelection(id)
      return
    }

    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      onAddSelection(id)
      return
    }

    onSelect(node, id)
  }

  useEffect(() => {
    if (!revealRequest) {
      return
    }

    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const reduceMotion = Boolean(scroller.closest('.reduce-animation'))
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // nested radix collapsibles take 280ms to open, so measure the target after layout settles to center its final
    // scroll position
    const timer = window.setTimeout(() => {
      const target = [...scroller.querySelectorAll<HTMLElement>('[data-rte-node-id]')]
        .find((element) => element.dataset.rteNodeId === revealRequest.nodeId)
      if (!target) {
        return
      }
      target.focus({ preventScroll: true })
      target.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'center',
        inline: 'nearest',
      })
    }, reduceMotion ? 0 : 300)

    return () => window.clearTimeout(timer)
  }, [revealRequest, scrollerRef])

  const renderNode = (
    node: EditorNode,
    inSetup = false,
    loopIds: readonly string[] = [],
    inheritedDisabled = false,
    loopColor?: string,
  ) => {
    if (node.type === 'note') {
      return (
        <NoteLine
          key={node.id}
          node={node}
          drag={drag}
          inspected={isInspected(node.id)}
          selectionMode={selectionMode}
          compareMark={compareMark(node.id)}
          focusSelected={isFocusSelected(node.id)}
          inSetup={inSetup}
          rowMenu={rowMenu}
          onSelect={(event, id) => selectNode(event, null, id)}
        />
      )
    }
    const scopedLoopIds = loopScope.byNodeId.get(node.id) ?? loopIds
    const scopedLoopColor = loopScope.loopsById
      .get(scopedLoopIds[scopedLoopIds.length - 1] ?? '')
      ?.color ?? loopColor

    if (node.type === 'swap') {
      return (
        <SwapRow
          key={node.id}
          node={node}
          drag={drag}
          roster={roster}
          inspected={isInspected(node.id)}
          selectionMode={selectionMode}
          compareMark={compareMark(node.id)}
          focusSelected={isFocusSelected(node.id)}
          stale={staleIds.has(node.id)}
          rowMenu={rowMenu}
          onSelect={(event, id) => selectNode(event, null, id)}
        />
      )
    }

    if (isEditorBlock(node)) {
      return renderBlock(node, inSetup, scopedLoopIds, inheritedDisabled, scopedLoopColor)
    }

    if (node.type === 'condition') {
      const run = selectedRunForLoopIds(scopedLoopIds, runsByLoopId)
      return (
        <CondLine
          key={node.id}
          node={node}
          run={run}
          underHead={isUnderCondHead(node.id)}
          fold={condFold(node.id)}
          drag={drag}
          roster={roster}
          inSetup={inSetup}
          disabled={inheritedDisabled}
          inspected={isInspected(node.id)}
          selectionMode={selectionMode}
          compareMark={compareMark(node.id)}
          focusSelected={isFocusSelected(node.id)}
          stale={staleIds.has(node.id)}
          rowMenu={rowMenu}
          onSelect={(event, id) => selectNode(event, null, id)}
        />
      )
    }

    const step = node.type === 'step' ? node : null
    const run = selectedRunForLoopIds(scopedLoopIds, runsByLoopId)
    const damage = step ? stepDamageAt(step, run) : 0
    // switched off, gated out, and never reached render as one state
    const isDead = node.gate?.kind === 'dead'
      || inheritedDisabled
      || (step ? !stepHasRun(step, run) : false)
      || (step?.disabled ?? false)
    const art = roster.art(node.owner)
    const flags = step ? ghosts.get(step.id) : undefined
    // attached writes gain per-run values after execution; newly authored writes show their authored value with an
    // unrun marker
    const ranWrites = step ? atRun(step.writesByRun, run, undefined) : undefined
    const writes = ranWrites ?? step?.pendingWrites
    const writesPending = !ranWrites && Boolean(step?.pendingWrites?.length)
    const multiplier = step ? atRun(step.multiplierByRun, run, step.multiplier) : 1
    const runInfo = ownerRuns.get(node.id)
    const opensRun = runInfo != null && runInfo.headId === node.id
    const runLength = runInfo?.length ?? 1
    const foldable = opensRun && runLength > 1
    const runShut = foldable && shutIds.has(node.id)
    // attached features use a separate fold key, because a run head already uses its node id for the run
    const carried = step?.attached ?? []
    const carryId = carryFoldId(node.id)
    const carryShut = carried.length > 0 && shutIds.has(carryId)
    const classes = [
      'rte-row',
      step ? '' : 'is-condition',
      isDead ? 'is-dead' : '',
      // the second line is grown for writes, for carried features, or for both
      writes?.length || (carried.length > 0 && !carryShut) ? 'has-writes' : '',
      step && isUnrun(step) ? 'is-fresh' : '',
      staleIds.has(node.id) ? 'is-stale' : '',
      isInspected(node.id) ? 'is-selected' : '',
      selectionMode ? 'selection-mode' : '',
      isFocusSelected(node.id) ? 'focus-selected' : '',
      compareMark(node.id) ? `is-cmp-${compareMark(node.id)}` : '',
    ].filter(Boolean).join(' ') + drag.className(node.id)

    return (
      <ContextTrigger
        key={node.id}
        asChild
        ariaLabel={`${node.label} actions`}
        getItems={() => rowMenu(node)}
      >
      <button
        type="button"
        data-rte-node-id={node.id}
        data-selection-focus-item="true"
        className={classes}
        style={roster.accent(node.owner, {
          color: step?.color,
          element: step?.element,
          aggregationType: step?.aggregationType,
        })}
        aria-pressed={selectionMode ? undefined : isInspected(node.id)}
        aria-selected={selectionMode ? isFocusSelected(node.id) : undefined}
        onClick={(event) => selectNode(event, step, node.id)}
        {...drag.props(node.id, node)}
      >
        <Grip handlers={drag.grip(node.id)} />
        <span className="rte-step">
          {opensRun ? (
            <span
              className={`rte-step__owner${foldable ? ' is-foldable' : ''}${runShut ? ' is-shut' : ''}`}
              title={
                foldable
                  ? `${art.alt} . ${runLength} steps in a row . click to ${runShut ? 'show' : 'fold'} them`
                  : art.alt
              }
              // the portrait takes the button role without nesting buttons
              {...(foldable
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-expanded': !runShut,
                    onClick: (event: React.MouseEvent) => {
                      event.stopPropagation()
                      onOpenChange(node.id, runShut)
                    },
                    onKeyDown: (event: React.KeyboardEvent) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      event.stopPropagation()
                      onOpenChange(node.id, runShut)
                    },
                  }
                : {})}
            >
              <DisplayImage className="rte-step__art" src={art.src} alt="" onError={art.onError} loading="lazy" />
              {foldable ? <i className="rte-step__runs">{runLength}</i> : null}
            </span>
          ) : (
            <span className="rte-step__owner is-held" aria-hidden="true" />
          )}
          <em className="rte-step__name">{node.label}</em>
          {multiplier > 1 ? <i className="rte-step__mult">x{multiplier}</i> : null}
          {carried.length > 0 ? (
            <i
              className={`rte-carry${carryShut ? ' is-shut' : ''}`}
              role="button"
              tabIndex={0}
              aria-expanded={!carryShut}
              onClick={(event: React.MouseEvent) => {
                event.stopPropagation()
                onOpenChange(carryId, carryShut)
              }}
              onKeyDown={(event: React.KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                onOpenChange(carryId, carryShut)
              }}
            >
              {carried.length}
            </i>
          ) : null}
          {node.attachedNote ? (
            <NoteAside note={node.attachedNote} speaker={{ src: art.src, alt: art.alt, onError: art.onError }} />
          ) : null}
          <span className="rte-step__fill" />
          {node.sourceIcon ? (
            <DisplayImage className="rte-step__source" src={node.sourceIcon} alt="" onError={withDefEchoMg} loading="lazy" />
          ) : null}
          {node.gate ? (
            <GateChip gate={node.gate} />
          ) : null}
        </span>

        {/* writes stay inside the step's own column, so the damage and stat tracks keep their row height */}
        {writes?.length ? (
          <span className={`rte-writes${writesPending ? ' is-pending' : ''}`}>
            {writes.map((write) => (
              <span
                key={write.id}
                className={`rte-write${write.rising ? ' is-up' : ' is-down'}`}
              >
                <em>{write.label}</em>
                <b>{write.value}</b>
              </span>
            ))}
          </span>
        ) : null}

        {carried.length > 0 ? (
          <Expandable
            as="span" className="rte-carried"
            open={!carryShut}
            onOpenChange={(open) => onOpenChange(carryId, open)}
            contentOnly
            contentAsChild
          >
            {/* the content box is the grid item spanning every column, and carried rows inside keep their own tracks; the height animation needs this box */}
            <span className="rte-carried__body">
              {carried.map((child) => {
                const childArt = roster.art(child.owner)
                const childDamage = stepDamageAt(child, run)
                const childDead = isDead
                  || child.gate?.kind === 'dead'
                  || !stepHasRun(child, run)
                  || (child.disabled ?? false)
                const childMult = atRun(
                  child.effectiveMultiplierByRun,
                  run,
                  atRun(child.multiplierByRun, run, child.multiplier),
                )
                return (
                  <span className="rte-sub"
                    key={child.id}
                    style={roster.accent(child.owner, {
                      color: child.color,
                      element: child.element,
                      aggregationType: child.aggregationType,
                    })}
                  >
                    <span className="rte-step">
                      <span className="rte-step__owner" title={childArt.alt}>
                        <DisplayImage className="rte-step__art" src={childArt.src} alt="" onError={childArt.onError} loading="lazy" />
                      </span>
                      <em className="rte-step__name">{child.label}</em>
                      {childMult > 1 ? <i className="rte-step__mult">x{childMult}</i> : null}
                      <span className="rte-step__fill" />
                    </span>
                    {bandCells(
                      register,
                      <span className="rte-dmg">
                        <i style={{ '--w': `${childDead || isUnrun(child) ? 0 : (childDamage / Math.max(1, peakDamage)) * 100}%` } as React.CSSProperties} />
                        <b>{isUnrun(child) ? '-' : formatDamage(childDamage, decimals)}</b>
                      </span>,
                      (key) => {
                        if (childDead || isUnrun(child)) {
                          return <span key={key} className="rte-stat is-empty">-</span>
                        }
                        const value = fmtStat(factorAt(child, run, key), key, decimals, percentDisplay)
                        const text = isTextStatKey(key) ? shortStat(key, value) : value
                        if (key === 'offTune') {
                          return (
                            <OffTuneCell key={key}
                              step={child}
                              run={run}
                              text={text}
                              accent={roster.accent(child.owner)}
                              authoringState={offTuneAuthoring.get(child.id)}
                            />
                          )
                        }
                        return (
                          <span
                            key={key}
                            className={`rte-stat${isTextStatKey(key) ? ' is-text' : ''}`}
                            title={isTextStatKey(key) ? value : undefined}
                          >
                            {text}
                          </span>
                        )
                      },
                    )}
                  </span>
                )
              })}
            </span>
          </Expandable>
        ) : null}

        {bandCells(
          register,
          <span className="rte-dmg">
            {step ? (
              <>
                <i style={{ '--w': `${isDead || isUnrun(step) ? 0 : (damage / Math.max(1, peakDamage)) * 100}%` } as React.CSSProperties} />
                <b>{isUnrun(step) ? '-' : formatDamage(damage, decimals)}</b>
              </>
            ) : null}
          </span>,
          (key) => {
            if (!step) {
              return <span key={key} className="rte-stat" />
            }
            if (isDead || isUnrun(step)) {
              return <span key={key} className="rte-stat is-empty">-</span>
            }
            const ghost = ghostRepeats && flags?.has(key) === true
            const value = fmtStat(factorAt(step, run, key), key, decimals, percentDisplay)
            const text = isTextStatKey(key) ? shortStat(key, value) : value
            if (key === 'offTune') {
              return (
                <OffTuneCell key={key}
                  step={step}
                  run={run}
                  text={text}
                  ghost={ghost}
                  accent={roster.accent(step.owner)}
                  onResume={onOffTuneResume}
                  authoringState={offTuneAuthoring.get(step.id)}
                />
              )
            }
            return (
              <span
                key={key}
                className={`rte-stat${isTextStatKey(key) ? ' is-text' : ''}${ghost ? ' is-ghost' : ''}`}
                title={isTextStatKey(key) ? value : undefined}
              >
                {text}
              </span>
            )
          },
        )}
      </button>
      </ContextTrigger>
    )
  }

  const isUnderCondHead = (id: string) => {
    const info = condRuns.get(id)
    return Boolean(info && info.headId !== id)
  }

  const condFold = (id: string) => {
    const info = condRuns.get(id)
    if (!info || info.headId !== id || info.length < 2) {
      return undefined
    }
    const shut = shutIds.has(id)
    return { count: info.length, shut, onToggle: () => onOpenChange(id, shut) }
  }

  const renderList = (
    nodes: EditorNode[],
    inSetup = false,
    loopIds: readonly string[] = [],
    inheritedDisabled = false,
    loopColor?: string,
  ) => {
    const out: React.ReactNode[] = []

    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]
      const foldGroup = rowFoldGroupAt(nodes, index, ownerRuns, condRuns)

      if (foldGroup?.kind === 'conditions') {
        out.push(
          // the same fold as a resonator run, kept out of the sticky stack, which restates only enclosing scopes
          <Collapsible.Root
            key={`states-${node.id}`}
            asChild
            open={!shutIds.has(node.id)}
            onOpenChange={(open) => onOpenChange(node.id, open)}
          >
            <div className="rte-cgrp">
              {renderNode(node, inSetup, loopIds, inheritedDisabled, loopColor)}
              <Collapsible.Content className="expandable__content">
                <div className="rte-cgrp__body">
                  {foldGroup.tail.map((child) =>
                    renderNode(child, inSetup, loopIds, inheritedDisabled, loopColor))}
                </div>
              </Collapsible.Content>
            </div>
          </Collapsible.Root>,
        )
        index += foldGroup.tail.length
        continue
      }

      if (foldGroup?.kind === 'owner') {
        out.push(
          <Collapsible.Root
            key={`run-${node.id}`}
            asChild
            open={!shutIds.has(node.id)}
            onOpenChange={(open) => onOpenChange(node.id, open)}
          >
            <div className="rte-run">
              {renderNode(node, inSetup, loopIds, inheritedDisabled, loopColor)}
              <Collapsible.Content className="expandable__content">
                <div className="rte-run__body">
                  {foldGroup.tail.map((child) =>
                    renderNode(child, inSetup, loopIds, inheritedDisabled, loopColor))}
                </div>
              </Collapsible.Content>
            </div>
          </Collapsible.Root>,
        )
        index += foldGroup.tail.length
        continue
      }

      out.push(renderNode(node, inSetup, loopIds, inheritedDisabled, loopColor))
    }

    return out
  }

  const renderBlock = (
    block: EditorBlock,
    inSetup = false,
    parentLoopIds: readonly string[] = [],
    inheritedDisabled = false,
    parentLoopColor?: string,
  ) => {
    const isSetup = block.type === 'setup'
    // the two segments of a wrapped loop fold together, on the head's id
    const foldId = block.wrapOf ?? block.id
    const shut = shutIds.has(foldId)
    const isLoop = block.type === 'loop'
    const isContinuation = block.wrap === 'head' || block.wrap === 'middle'
    // a loop closing inside a lower block has a bracket extending down its own lane; the lane offset is measured from
    // its enclosing block, and the seams stay with the wrap they belong to
    const crossDepth = crossings.get(block.id)
    const crossing = crossDepth != null
    // the block a crossing loop closes inside is indented one more step, which leaves the loop's lane clear past its
    // head; it is also the only element that can draw that stretch of the line, because the body below it is clipped
    // for the fold animation
    const crossHost = block.children.find((child): child is EditorBlock => {
      const at = crossings.get(child.id)
      return at != null && at > 0
    })
    const crossHostDepth = crossHost ? crossings.get(crossHost.id) : undefined
    const lane = crossDepth ?? crossHostDepth
    // a marker at the end of its list contains no rows: the body is all above it
    const isMarkerOnly = block.wrap === 'tail' && block.children.length === 0
    // the bracket's bottom cap, which is the dragged end, is drawn by the segment the loop closes in: the segment
    // below the last row of the body, so for a reversed loop it is the continuation at the top of the list
    const closes = !block.wrap || block.wrap === 'head'
    // an uptime's setup branch is part of the block
    const hasBody = block.children.some(
      (child) => !(isEditorBlock(child) && child.type === 'setup'),
    )

    const parentRun = selectedRunForLoopIds(parentLoopIds, runsByLoopId)
    const loopId = isLoop ? editorLoopId(block) : null
    const run = isLoop ? selectedLoopRun(block, runsByLoopId) : parentRun
    const blockOff = inheritedDisabled || Boolean(block.disabled)
    const total = blockOff ? 0 : blockTotal(block, run)
    // formula values and fork bodies can vary the evaluated value by pass
    const blockRuns = blockRunsAt(block, parentRun)
    const setupHost = isSetup ? setupHosts.get(block.id) ?? null : null
    const steps = blockSteps(block)
    const childLoopIds = block.type === 'loop'
      ? blockOff
        ? parentLoopIds
        : parentLoopIds.includes(loopId as string)
          ? parentLoopIds
          : [...parentLoopIds, loopId as string]
      : parentLoopIds
    const childLoopColor = block.type === 'loop'
      ? blockOff
        ? parentLoopColor
        : block.color
      : parentLoopColor
    const childInheritedDisabled = block.type === 'loop'
      ? inheritedDisabled
      : blockOff
    // a setup contains conditions, so a step count there is always zero
    const note = isSetup
      ? `${block.children.length} ${block.children.length === 1 ? 'condition' : 'conditions'}`
      : `${steps} ${steps === 1 ? 'step' : 'steps'}`
    const blockColor = block.color
      ?? (block.type === 'repeat' || block.type === 'uptime' ? DEFAULT_ROT_BLOCK_COLOR : undefined)

    // drive the collapsible directly: the head selects while only the chevron folds, and expandable wraps the whole
    // header in its trigger
    const frame = (
        <section
          key={block.id}
          {...drag.props(block.id, block, {
            gutterGrab: true,
            // a continuation is the same loop as its head
            fixed: isSetup || isContinuation,
            acceptsOnly: isSetup || inSetup ? 'condition' : undefined,
          })}
          // each authored container defines its colour; `--rte-blk` stays local to that surface, and run labels
          // receive their loop colour as explicit data so nested blocks cannot recolour another loop rule
          style={{
            ...roster.accent(block.owner),
            ...(blockColor ? { '--rte-blk': blockColor } : {}),
            // depth of this element relative to the crossing loop lane
            ...(lane != null ? { '--rte-cross': lane } : {}),
            // a crossed block draws part of the loop line, so the loop colour is passed explicitly to that segment
            ...(crossHost?.color ? { '--rte-cross-blk': crossHost.color } : {}),
          } as React.CSSProperties}
          data-loop-id={isLoop ? loopId ?? undefined : undefined}
          data-runs={isLoop ? block.runs : undefined}
          className={`rte-block rte-block--${block.type}${
            block.wrap && !crossing ? ` rte-block--wrap${block.wrap}` : ''
          }${crossing ? ` rte-block--cross rte-block--cross-${
            closes ? 'close' : block.wrap === 'middle' ? 'thru' : 'open'
          }` : ''}${crossHost ? ' rte-block--crosshost' : ''
          }${isMarkerOnly ? ' rte-block--marker' : ''}${shut ? ' is-shut' : ''}${
            blockOff ? ' is-off' : ''
          }${!isSetup && isInspected(block.id) ? ' is-selected' : ''}${drag.className(block.id)}`}
        >
          {isContinuation ? null : (
          <ContextTrigger
            asChild
            ariaLabel={`${isSetup ? setupHost?.label ?? block.label : block.label} actions`}
            getItems={() => rowMenu(isSetup ? setupHost ?? block : block)}
          >
          <button
            type="button"
            data-rte-node-id={block.id}
            data-selection-focus-item={isSetup ? undefined : 'true'}
            className={`rte-block__head${
              !isSetup && selectionMode ? ' selection-mode' : ''
            }${!isSetup && isFocusSelected(block.id) ? ' focus-selected' : ''}${
              !isSetup && compareMark(block.id) ? ` is-cmp-${compareMark(block.id)}` : ''
            }${!isSetup && staleIds.has(block.id) ? ' is-stale' : ''}`}
            // setup branches are display-only parts of uptime blocks; their heads fold the branch without selecting a
            // node
            {...(isSetup
              ? { onClick: () => onOpenChange(block.id, shut) }
              : {
                  'aria-pressed': selectionMode ? undefined : isInspected(block.id),
                  'aria-selected': selectionMode ? isFocusSelected(block.id) : undefined,
                  onClick: (event: React.MouseEvent<HTMLElement>) =>
                    selectNode(event, null, block.id),
                })}
          >
            {shut && !isSetup ? <Grip handlers={drag.grip(block.id)} /> : null}
            {isSetup ? (
              <ChevronDown className="rte-block__chev" size="0.8rem" aria-hidden="true" />
            ) : (() => {
              // the head selects, so only this folds and the press stops here; the marker's own segment has no
              // content to fold, so it folds the segment above it through their shared fold id
              const fold = (
                <span
                  role="button"
                  tabIndex={0} className="rte-block__fold"
                  aria-label={`${shut ? 'Expand' : 'Collapse'} ${block.label}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    if (isMarkerOnly) onOpenChange(foldId, shut)
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.stopPropagation()
                    if (isMarkerOnly) {
                      event.preventDefault()
                      onOpenChange(foldId, shut)
                    }
                  }}
                >
                  <ChevronDown className="rte-block__chev" size="0.8rem" aria-hidden="true" />
                </span>
              )

              return isMarkerOnly ? fold : <Collapsible.Trigger asChild>{fold}</Collapsible.Trigger>
            })()}
            <b className="rte-block__name">{block.label}</b>
            {block.attachedNote ? <NoteAside note={block.attachedNote} /> : null}
            {isSetup ? (
              // the window of the branch that opens it: the block head shows how many times the body runs, and this
              // one how much of that time the setup is active
              setupHost ? (
                <span className="rte-block__ratio">
                  {truncTo(blockRatioAt(setupHost, parentRun) * 100)}%
                </span>
              ) : null
            ) : (
              <span className="rte-block__x">x{blockRuns}</span>
            )}

            {isLoop && !shut && block.runs > 1 ? (
              <RunTrack
                loopId={loopId as string}
                runs={block.runs}
                run={run}
                label={block.label}
                onRunChange={onRunChange}
              />
            ) : null}

            <span className="rte-block__fill" />

            <i className="rte-block__note">
              {shut || !isLoop ? note : `run ${run} of ${block.runs}`}
            </i>
            {isSetup ? null : <u className="rte-block__total">{formatDamage(total, decimals)}</u>}
          </button>
          </ContextTrigger>
          )}

          {isMarkerOnly ? null : (
            <Collapsible.Content className="expandable__content">
              {/* row drops insert beside that row and drops in the remaining block area insert into the block; the zone stops drops from reaching an outer area */}
              <div
                {...drag.zone(block.id, {
                  base: 'rte-block__body',
                  acceptsOnly: isSetup || inSetup ? 'condition' : undefined,
                })}
              >
                {block.children.length > 0
                  ? renderList(
                    block.children,
                    inSetup || isSetup,
                    childLoopIds,
                    childInheritedDisabled,
                    childLoopColor,
                  )
                  : null}

                {hasBody ? null : (
                  <p className="rte-empty rte-empty--block">
                    {isSetup || inSetup ? 'Drop a condition here.' : 'Drop an item here.'}
                  </p>
                )}
              </div>
            </Collapsible.Content>
          )}

          {/* the bracket's closing edge: dragging it over a row makes that row the block's last node, which resizes a block or gives an endless loop an end; the drag names the loop by the segment holding its start */}
          {selectionMode || isSetup || shut || !closes ? null : (
            <span className="rte-block__edge"
              role="button"
              tabIndex={-1}
              aria-label={`Move where ${block.label} ends`}
              {...drag.edge(block.wrapOf ?? block.id)}
            />
          )}
        </section>
    )

    // nothing to fold means nothing to animate, so no collapsible
    const section = isMarkerOnly ? frame : (
      <Collapsible.Root
        key={block.id}
        asChild
        open={!shut}
        onOpenChange={(open) => onOpenChange(foldId, open)}
      >
        {frame}
      </Collapsible.Root>
    )

    // show the wrap arrow only when the loop returns to its start; bounded and crossing loops use the bracket without
    // an outer seam
    if (!block.wrap || crossing) {
      return section
    }

    // the seam renders outside the segment with the loop color and transition
    const seam = (direction: 'up' | 'down') => (
      <div
        className={shut ? 'rte-seam is-shut' : 'rte-seam'}
        aria-hidden="true"
        style={block.color ? ({ '--rte-blk': block.color } as React.CSSProperties) : undefined}
      >
        <i>{direction === 'down' ? <ArrowDown size="0.7rem" /> : <ArrowUp size="0.7rem" />}</i>
        <u />
      </div>
    )

    return (
      <Fragment key={block.id}>
        {block.wrap === 'head' || block.wrap === 'middle' ? seam('down') : null}
        {section}
        {block.wrap === 'tail' || block.wrap === 'middle' ? seam('up') : null}
      </Fragment>
    )
  }

  return (
    <main
      ref={listRef}
      className={`rte-list${showPriors ? ' is-priors' : ''}`}
      data-selection-mode={selectionMode ? 'true' : undefined}
      // declare the visible track count here; rows and headings share it
      style={{
        '--rte-statn': statKeys.length,
        '--rte-cols': register.template,
        '--rte-tail': register.tail,
        '--rte-minw': register.minWidth,
      } as React.CSSProperties}
      {...drag.sink}
    >
      <RegisterHead
        register={register}
        percentDisplay={percentDisplay}
        onToggleGroup={onToggleGroup}
      />

      <div className="rte-rows rte-scroll" ref={scrollerRef}>
        <div className="rte-sticky" aria-hidden={stack.scopes.length === 0}>
          <div className="rte-sticky__stack">
            {stack.scopes.map((scope, index) => (
              <button
                // scope identity keys force a remount when a same-depth scope swaps
                key={scope.key}
                type="button"
                className={`rte-sticky__row rte-sticky__row--${scope.kind}`}
                // only the last entry moves, behind the ones above it: outer scopes stack in front while the ending
                // scope slides beneath them
                style={{
                  // set the external stack color from each scope
                  ...(scope.accent
                    ? scope.kind === 'run'
                      ? { '--rte-res': scope.accent }
                      : { '--rte-blk': scope.accent }
                    : {}),
                  zIndex: stack.scopes.length - index,
                  paddingLeft: `${0.85 + index * 0.8}rem`,
                  transform: index === stack.scopes.length - 1
                    ? `translateY(${stack.shift}px)`
                    : undefined,
                }}
                title={`Back to ${scope.label}`}
                onClick={() => {
                  const scroller = scrollerRef.current
                  if (scroller) {
                    scrollToScope(scroller, scope, index * STICKY_ROW)
                  }
                }}
              >
                <CornerLeftUp className="rte-sticky__mark" size="0.7rem" aria-hidden="true" />
                {scope.icon ? (
                  <DisplayImage className="rte-sticky__icon" src={scope.icon} alt="" onError={withDefResMg} />
                ) : null}
                <b className="rte-sticky__name">{scope.label}</b>
                {scope.note ? <i className="rte-sticky__note">{scope.note}</i> : null}
                {scope.kind === 'loop' && scope.runs > 1 ? (
                  <RunTrack
                    loopId={scope.loopId}
                    runs={scope.runs}
                    run={runsByLoopId[scope.loopId] ?? 1}
                    label={scope.label}
                    onRunChange={onRunChange}
                  />
                ) : null}
                <span className="rte-sticky__fill" />
                {scope.meta ? <i className="rte-sticky__meta">{scope.meta}</i> : null}
                {scope.total ? <u className="rte-sticky__total">{scope.total}</u> : null}
              </button>
            ))}
          </div>
        </div>

        {sections.map((section) => {
          const shut = shutIds.has(section.id)
          const counts = countNodes(section.children)
          const meta = section.id === 'preamble'
            ? `${counts.nodes} ${counts.nodes === 1 ? 'condition' : 'conditions'}`
            : `${counts.nodes} nodes . ${counts.steps} steps`

          return (
            <Expandable
              key={section.id}
              as="section"
              className={`rte-sec${shut ? ' is-shut' : ''}`}
              open={!shut}
              onOpenChange={(open) => onOpenChange(section.id, open)}
              TriggerTag="button"
              triggerClass="rte-band"
              innerClass="rte-sec__body"
              plainTrigger
              hideChevron
              noHeaderWrap
              header={
                <>
                  <ChevronDown className="rte-chev" size="0.85rem" aria-hidden="true" />
                  <b className="rte-band__title">{section.title}</b>
                  <span className="rte-band__meta">{meta}</span>
                  <span className="rte-band__actions">
                    {section.total != null ? (
                      <u className="rte-band__total">{formatDamage(section.total, decimals)}</u>
                    ) : null}
                  </span>
                </>
              }
            >
              <div {...drag.zone(section.id)}>
                {section.children.length > 0
                  ? renderList(section.children)
                  : <p className="rte-empty">Drop a feature, condition or block here to fill this section.</p>}
              </div>
            </Expandable>
          )
        })}
      </div>
    </main>
  )
}

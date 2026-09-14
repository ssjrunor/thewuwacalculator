/*
  Author: Runor Ewhro
  Description: Owns inspect panels behavior and state transitions for the components module.
*/

import {
  ArrowRight,
  CheckCheck,
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  BarChart3,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eraser,
  GitCompare,
  Layers,
  Plus,
  Power,
  PowerOff,
  ChevronDown,
  ChevronRight,
  Minus,
  Pencil,
  Repeat,
  RotateCcw,
  Scissors,
  Swords,
  Timer,
  TextQuote,
  Trash2,
  TriangleAlert,
  SquarePen,
  Unlink,
  X,
  MessageSquareText,
  MessageSquarePlus
} from 'lucide-react'
import { ATTR_COLORS, getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { withDefEchoMg, withDefIconM, withDefResMg, withDefWpnMg } from '@/shared/lib/imageFallback.ts'
import {
  getSntSetClr,
  getSntSetIco,
  getSntSetNam,
} from '@/data/gameData/catalog/sonataSets.ts'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'
import type {
  ConditionWriteAction,
  EditorBlock,
  EditorEcho,
  EditorHandoff,
  BuffLine,
  EditorCondition,
  EditorExecutionScope,
  EditorSection,
  LoopRunSelections,
  EditorMember,
  EditorNode,
  EditorNote,
  RotationSummary,
  EditorStep,
  SummaryGroup,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  editorNodeLabel,
  isEditorBlock,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { LiquidSelect, type SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import { HexColorInput, HexColorPicker } from 'react-colorful'
import { ROT_LOOP_COLORS } from '@/modules/simulation/features/rotation/shared/loopMeta.ts'
import { ROT_BLOCK_COLORS } from '@/modules/simulation/features/rotation/shared/containerMeta.ts'
import { ROT_NOTE_COLORS } from '@/modules/simulation/features/rotation/shared/noteMeta.ts'
import { formatDamage, stepDamageAt, stepHasRun } from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import {
  formatExecutionRun,
  formatExecutionScope,
} from '@/modules/simulation/features/rotation/program-editor/model/executionScope.ts'
import type {
  FeatureOccurrence,
  RotationNodeTarget,
} from '@/modules/simulation/features/rotation/program-editor/interaction/nodeNavigation.ts'
import { condActionFromChange } from '@/modules/simulation/features/rotation/shared/conditions.tsx'
import { ROT_FORMULA_OWNER_KEY } from '@/modules/simulation/features/rotation/shared/conditions.tsx'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { rarityVars } from '@/modules/simulation/model/display.ts'
import {
  fmtWpnStatDs,
  WPNSTATLBLS,
  WPN_STAT_CNS,
} from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { regTextValue } from '@/modules/simulation/features/rotation/program-editor/model/registerValues.ts'
import type { AttachedWrite } from '@/modules/simulation/features/rotation/program-editor/model/nodeAuthoring.ts'
import {
  BuffRows,
  InspectorSection,
} from '@/modules/simulation/features/rotation/program-editor/components/InspectorPrimitives.tsx'

/** what the inspector can do to the one note a node is allowed to own */
interface NoteActions {
  note: EditorNote | null
  onAdd: () => void
  onLabel: (label: string) => void
  onWrite: (text: string) => void
  onColor: (color: string | undefined) => void
  onRemove: () => void
  /** Standalone notes also take the normal clipboard actions. */
  nodeActions?: ScopedNodeActions
}

function RunScope({
  scope,
  base,
  scopeColor,
}: {
  scope: EditorExecutionScope | null
  base?: number | null
  scopeColor?: string
}) {
  if (scope == null && base == null) {
    return null
  }

  return (
    <em className="rte-mult__note"
      style={scopeColor
        ? ({ '--rte-scope-color': scopeColor } as React.CSSProperties)
        : undefined}
    >
      {scope ? formatExecutionRun(scope) : 'all passes'}
      {base != null ? ` . base ${base}` : ''}
    </em>
  )
}

function ActBtn({
  icon,
  label,
  hint,
  danger,
  disabled,
  onPress,
}: {
  icon: ReactNode
  label: string
  hint?: string
  danger?: boolean
  disabled?: boolean
  onPress: () => void
}) {
  return (
    <button
      type="button"
      className={`rte-act${danger ? ' is-danger' : ''}`}
      disabled={disabled}
      title={hint ?? label}
      onClick={onPress}
    >
      <span className="rte-act__icon" aria-hidden="true">{icon}</span>
      <span className="rte-act__label">{label}</span>
      {hint ? <span className="rte-act__hint">{hint}</span> : null}
    </button>
  )
}

/*
  Inspector numbers used to commit on every digit, which cloned the whole
  rotation for a value that is not finished yet. The draft stays local until
  the field is left or Enter confirms it.
*/
function DraftNumber({
  value,
  displayValue,
  onCommit,
  parse,
  ...props
}: {
  value: number
  displayValue?: string
  onCommit: (next: number) => void
  parse?: (raw: string) => number | null
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>) {
  const [draft, setDraft] = useState(displayValue ?? String(value))
  const shown = displayValue ?? String(value)
  const [seen, setSeen] = useState(shown)
  if (seen !== shown) {
    setSeen(shown)
    setDraft(shown)
  }

  const flush = (raw: string) => {
    const parsed = parse ? parse(raw) : Number(raw)
    if (parsed == null || Number.isNaN(parsed)) {
      setDraft(shown)
      return
    }
    if (parsed !== value) {
      onCommit(parsed)
    } else {
      setDraft(shown)
    }
  }

  return (
    <input
      {...props}
      type="number"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => flush(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
    />
  )
}

function ColourPicker({
  colour,
  presets,
  onCommit,
  name,
}: {
  colour: string
  presets: readonly string[]
  onCommit: (color: string) => void
  name: string
}) {
  const [custom, setCustom] = useState(false)
  const [draft, setDraft] = useState(colour)
  const [seen, setSeen] = useState(colour)
  const draftRef = useRef(draft)
  if (seen !== colour) {
    setSeen(colour)
    setDraft(colour)
  }

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    if (!custom) {
      return
    }

    const flush = () => {
      if (draftRef.current !== colour) {
        onCommit(draftRef.current)
      }
    }

    window.addEventListener('pointerup', flush)
    window.addEventListener('pointercancel', flush)
    return () => {
      window.removeEventListener('pointerup', flush)
      window.removeEventListener('pointercancel', flush)
    }
  }, [colour, custom, onCommit])

  const preset = presets.includes(colour)

  return (
    <>
      <div className="rte-swatches" role="radiogroup" aria-label={name}>
        {presets.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={color === colour}
            aria-label={`Colour ${color}`}
            className={`rte-swatch${color === colour ? ' is-on' : ''}`}
            style={{ background: color }}
            onClick={() => onCommit(color)}
          />
        ))}
        <button
          type="button"
          className={`rte-swatch rte-swatch--custom${custom ? ' is-open' : ''}${
            colour && !preset ? ' is-on' : ''
          }`}
          title="Custom colour"
          aria-label="Custom colour"
          aria-expanded={custom}
          style={colour && !preset ? { background: colour } : undefined}
          onClick={() => setCustom((open) => !open)}
        >
          {custom ? <Minus size="0.7rem" /> : <Plus size="0.7rem" />}
        </button>
      </div>
      {custom ? (
        <div className="rte-picker">
          <HexColorPicker color={draft} onChange={setDraft} />
          <label className="rte-picker__hex">
            <span aria-hidden="true">#</span>
            <HexColorInput
              color={draft}
              aria-label={`${name} hex`}
              onChange={(value) => setDraft(`#${value.replace(/^#/, '')}`)}
            />
          </label>
        </div>
      ) : null}
    </>
  )
}

/*
  Where a note is written. The list is where it is read, and the aside drawn
  there is display only: a text field inside a row button would be an
  interactive inside an interactive, so authoring lives here instead.
*/
function NoteSect(actions: NoteActions) {
  const { note, onAdd } = actions
  if (!note) {
    return (
      <InspectorSection label="Note">
        <div className="rte-acts">
          <ActBtn
            icon={<MessageSquarePlus size="0.8rem" />}
            label="Add note"
            onPress={onAdd}
          />
        </div>
      </InspectorSection>
    )
  }

  return (
    <NoteFields
      key={note.id}
      {...actions}
      note={note}
    />
  )
}

function NoteFields({
  note,
  onLabel,
  onWrite,
  onColor,
  onRemove,
  nodeActions,
}: NoteActions & { note: EditorNote }) {
  const [title, setTitle] = useState(note.label ?? 'Note')
  const [text, setText] = useState(note.text)
  const colour = note.color ?? ROT_NOTE_COLORS[0]
  const shownTitle = note.label ?? 'Note'
  const [seenTitle, setSeenTitle] = useState(shownTitle)
  const [seenText, setSeenText] = useState(note.text)
  if (seenTitle !== shownTitle) {
    setSeenTitle(shownTitle)
    setTitle(shownTitle)
  }
  if (seenText !== note.text) {
    setSeenText(note.text)
    setText(note.text)
  }

  const noteField = (
    <textarea className="rte-notefield"
      value={text}
      rows={4}
      placeholder="What should the next reader know about this line?"
      aria-label="Note text"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text !== note.text) {
          onWrite(text)
        }
      }}
    />
  )

  const colourFields = (
    <ColourPicker
      colour={colour}
      presets={ROT_NOTE_COLORS}
      onCommit={onColor}
      name="Note colour"
    />
  )

  if (!nodeActions) {
    return (
      <InspectorSection label="Note">
        <div className="rte-notesettings">
          <label className="rte-notesettings__title">
            <span>Title</span>
            <input
              type="text"
              value={title}
              placeholder="Note title"
              aria-label="Note title"
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => onLabel(title)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
            />
          </label>
          {noteField}
          {colourFields}
          <div className="rte-acts rte-notesettings__actions">
            <ActBtn
              icon={<Trash2 size="0.8rem" />}
              label="Remove note"
              danger
              onPress={onRemove}
            />
          </div>
        </div>
      </InspectorSection>
    )
  }

  return (
    <>
      <InspectorSection label="Note" defaultOpen={true}>
        {noteField}
      </InspectorSection>

      <InspectorSection label="Colour" defaultOpen={true}>
        {colourFields}
      </InspectorSection>

      <InspectorSection label="Actions" defaultOpen={true}>
        <div className="rte-acts">
          {nodeActions ? <ClipActs actions={nodeActions} /> : null}
          <ActBtn
            icon={<Trash2 size="0.8rem" />}
            label={nodeActions ? 'Delete note' : 'Remove note'}
            danger
            onPress={onRemove}
          />
        </div>
      </InspectorSection>
    </>
  )
}

/*
  every node kind takes the clipboard on the same terms, so the three are drawn
  once rather than repeated in each inspector.
*/
function ClipActs({ actions }: { actions: ScopedNodeActions }) {
  return (
    <>
      <ActBtn
        icon={<Copy size="0.8rem" />}
        label="Copy"
        hint={actions.canCopy ? undefined : 'This loop is drawn in segments and cannot be copied whole'}
        disabled={!actions.canCopy}
        onPress={actions.onCopy}
      />
      <ActBtn
        icon={<Scissors size="0.8rem" />}
        label="Cut"
        hint={actions.canCopy ? undefined : 'This loop is drawn in segments and cannot be cut whole'}
        disabled={!actions.canCopy}
        onPress={actions.onCut}
      />
      <ActBtn
        icon={<ClipboardPaste size="0.8rem" />}
        label="Paste"
        hint={actions.canPaste ? undefined : 'Nothing copied yet'}
        disabled={!actions.canPaste}
        onPress={actions.onPaste}
      />
      <ActBtn
        icon={<CopyPlus size="0.8rem" />}
        label="Duplicate"
        hint={actions.canCopy ? 'Stand a copy right after this one' : 'This loop is drawn in segments and cannot be copied whole'}
        disabled={!actions.canCopy}
        onPress={actions.onDuplicate}
      />
    </>
  )
}

function NodeActions({
  step,
  run,
  actions,
}: {
  step: EditorStep
  run: number
  actions: StepActions
}) {
  const baseMultiplier = Math.max(1, Math.floor(step.multiplier ?? 1))
  const multiplier = Math.max(
    1,
    Math.floor(step.multiplierByRun?.[run] ?? baseMultiplier),
  )
  const disabled = Boolean(step.disabled)

  return (
    <InspectorSection label="Actions" defaultOpen={true}>

      <div className="rte-acts">
        <ActBtn icon={<Pencil size="0.8rem" />} label="Edit feature" onPress={actions.onEdit} />

        {/* swaps only exist where the skill has a neighbour to swap to */}
        {actions.previousLabel ? (
          <ActBtn
            icon={<ChevronsLeft size="0.8rem" />}
            label="Prev. replace"
            hint={actions.previousLabel}
            onPress={actions.onReplacePrevious}
          />
        ) : null}
        {actions.adjacentLabel ? (
          <>
            <ActBtn
              icon={<ChevronsDown size="0.8rem" />}
              label="Adj. add"
              hint={actions.adjacentLabel}
              onPress={actions.onAddAdjacent}
            />
            <ActBtn
              icon={<ChevronsRight size="0.8rem" />}
              label="Adj. replace"
              hint={actions.adjacentLabel}
              onPress={actions.onReplaceAdjacent}
            />
          </>
        ) : null}

        <ClipActs actions={actions} />

        <ActBtn
          icon={disabled ? <PowerOff size="0.8rem" /> : <Power size="0.8rem" />}
          label={disabled ? 'Enable step' : 'Disable step'}
          onPress={actions.onToggleEnabled}
        />
        <ActBtn
          icon={<Trash2 size="0.8rem" />}
          label="Delete"
          danger
          onPress={actions.onDelete}
        />
      </div>

      <label className="rte-mult">
        <span className="rte-mult__sym" aria-hidden="true">&times;</span>
        <DraftNumber
          min={1}
          step={1}
          value={multiplier}
          aria-label="Times this step runs"
          parse={(raw) => Math.max(1, Math.floor(Number(raw) || 1))}
          onCommit={actions.onMultiplier}
        />
        <span className="rte-mult__lbl">times</span>
        <RunScope
          scope={actions.scope}
          scopeColor={actions.scopeColor}
        />
      </label>
    </InspectorSection>
  )
}

interface ScopedNodeActions {
  /** the section or labelled loop pass an edit lands on */
  scope: EditorExecutionScope | null
  /** explicit loop identity colour; never inherited from the inspected node */
  scopeColor?: string
  /** false for a node that cannot be lifted out of the tree whole */
  canCopy: boolean
  canPaste: boolean
  onCopy: () => void
  onCut: () => void
  /** stand a copy of this node directly after it */
  onDuplicate: () => void
  onPaste: () => void
}

export interface StepActions extends ScopedNodeActions {
  /** the neighbouring skills this step can be swapped for, if any */
  previousLabel: string | null
  adjacentLabel: string | null
  /** the state writes attached to this step, in authored order */
  attached: AttachedWrite[]
  onReplacePrevious: () => void
  onAddAdjacent: () => void
  onReplaceAdjacent: () => void
  onEdit: () => void
  onSetCondition: () => void
  /** instances in the negative-effect stack series (default 1) */
  onNegInstances: (value: number) => void
  /** hits that keep the same stack value before it steps down (default 1) */
  onNegStableWidth: (value: number) => void
  /* the features this step carries, and the two ways to change the set */
  attachedFeatures: EditorStep[]
  onAttachFeature: () => void
  onDetachFeature: (childId: string) => void
  onAttachedMultiplier: (childId: string, value: number) => void
  onSetAttachedValue: (index: number, value: string) => void
  onSetAttachedAction: (index: number, action: ConditionWriteAction) => void
  onRemoveAttached: (index: number) => void
  onMultiplier: (value: number) => void
  onToggleEnabled: () => void
  onDelete: () => void
}

/**
 * Instances and stable width for a negative-effect skill that builds a stack
 * series. Fixed-max skills have no series, so this section is not rendered for
 * them. Values land on the authored feature node the same way the pane modal
 * writes them.
 */
function NegEffectSeries({
  step,
  actions,
}: {
  step: EditorStep
  actions: StepActions
}) {
  if (!step.negEffect || step.negFixedStacks) {
    return null
  }

  const instances = Math.max(1, Math.floor(step.negativeEffectInstances ?? 1))
  const stable = Math.max(1, Math.floor(step.negativeEffectStableWidth ?? 1))
  const attribute = step.element
  const attributeIcon = attribute ? getAttributeIconSrc(attribute) : null

  return (
    <InspectorSection label="Negative effect series">
      <div className="rte-neg">
        <div className="rte-neg__fields">
          <label className="rte-neg__field">
            <span>Instances</span>
            <DraftNumber
              min={1}
              step={1}
              value={instances}
              aria-label="Negative effect instances"
              parse={(raw) => Math.max(1, Math.floor(Number(raw) || 1))}
              onCommit={actions.onNegInstances}
            />
          </label>
          <label className="rte-neg__field">
            <span>Stable width</span>
            <DraftNumber
              min={1}
              step={1}
              value={stable}
              aria-label="Negative effect stable width"
              parse={(raw) => Math.max(1, Math.floor(Number(raw) || 1))}
              onCommit={actions.onNegStableWidth}
            />
          </label>
        </div>

        <div className="rte-neg__summary">
          {attributeIcon ? (
            <img className="rte-neg__icon"
              src={attributeIcon}
              alt=""
              aria-hidden="true"
              onError={withDefIconM}
              loading="lazy"
            />
          ) : (
            <span className="rte-neg__icon is-mark" aria-hidden="true">
              <Layers size="0.75rem" />
            </span>
          )}
          <div className="rte-neg__copy">
            <strong>{step.label}</strong>
            <span>
              Count {instances} instance{instances === 1 ? '' : 's'} and keep each
              stack value for {stable} instance{stable === 1 ? '' : 's'} before
              lowering it.
            </span>
          </div>
        </div>
      </div>
    </InspectorSection>
  )
}

/*
  a condition writes state and nothing else. it has no damage, no buffs and no
  stat line, so the panel that serves a step would be four empty sections. it
  shows what it is instead: where the state comes from, what it now holds, and
  how it got there.
*/
/*
  the state's own control, in this surface's vocabulary rather than the
  condition editor's. changing it is the same edit that editor would make: the
  condition writes a new value, or, inside a loop, writes a different one on
  the run being viewed.
*/
function CondValue({
  state,
  value,
  action,
  onChange,
  onActionChange,
}: {
  state: SourceState
  value: string
  action: ConditionWriteAction
  onChange: (next: string) => void
  onActionChange: (next: ConditionWriteAction) => void
}) {
  if (state.kind === 'toggle') {
    const on = value === 'on'
    return (
      <div className="rte-cseg" role="group" aria-label={`${state.label} value`}>
        <button
          type="button"
          className={on ? 'is-on' : undefined}
          aria-pressed={on}
          onClick={() => onChange('on')}
        >
          on
        </button>
        <button
          type="button"
          className={!on ? 'is-on' : undefined}
          aria-pressed={!on}
          onClick={() => onChange('off')}
        >
          off
        </button>
      </div>
    )
  }

  if (state.kind === 'select') {
    return (
      <LiquidSelect className="rte-cselect"
        value={value}
        options={(state.options ?? []).map((option) => ({
          value: option.id,
          label: option.label,
        }))}
        ariaLabel={`${state.label} value`}
        onChange={(next) => onChange(String(next))}
      />
    )
  }

  const min = action === 'add'
    ? undefined
    : state.kind === 'stack'
      ? state.min ?? 0
      : state.min
  const max = action === 'add' ? undefined : state.max
  const step = state.kind === 'stack' ? 1 : 0.1

  return (
    <div className="rte-cwrite">
      <div className="rte-cverb" role="group" aria-label={`${state.label} operation`}>
        <button
          type="button"
          className={action === 'set' ? 'is-on' : undefined}
          aria-pressed={action === 'set'}
          onClick={() => onActionChange('set')}
        >
          Set
        </button>
        <button
          type="button"
          className={action === 'add' ? 'is-on' : undefined}
          aria-pressed={action === 'add'}
          onClick={() => onActionChange('add')}
        >
          Add
        </button>
      </div>
      <label className="rte-cnum">
        <DraftNumber
          value={value === '' ? 0 : Number(value)}
          displayValue={value}
          min={min}
          max={max}
          step={step}
          aria-label={`${state.label} value`}
          parse={(raw) => {
            const parsed = Number(raw)
            if (Number.isNaN(parsed)) {
              return null
            }
            return Math.min(
              max ?? Number.POSITIVE_INFINITY,
              Math.max(min ?? Number.NEGATIVE_INFINITY, state.kind === 'stack' ? Math.floor(parsed) : parsed),
            )
          }}
          onCommit={(next) => onChange(String(next))}
        />
        {max != null ? <span className="rte-cnum__max">of {max}</span> : null}
      </label>
    </div>
  )
}

/*
  the writes a step carries. they are authored on the step rather than standing
  in the list as conditions of their own, so nothing names them until a run
  reports what they wrote: the panel states them as authored, and edits each one
  with the same control its state would have as a condition.

  they are also scoped, which nothing else on the step says: a write here opens
  an overlay the step and its own attachments read, and the list past it does
  not. the panel states that once, under the writes it applies to.
*/
function AttachedWrites({ actions }: { actions: StepActions }) {
  const writes = actions.attached
  const features = actions.attachedFeatures
  const multiplierFor = (child: EditorStep) => Math.max(
    1,
    Math.floor(child.multiplier),
  )

  return (
    <InspectorSection label={<>Attached . {writes.length + features.length}</>}>
      {writes.length > 0 ? (
        <div className="rte-attach">
          {writes.map((write) => (
            <div
              key={`${write.index}:${write.label}`}
              className={`rte-attach__row${write.rising ? ' is-up' : ' is-down'}`}
            >
              <div className="rte-attach__head">
                <b className="rte-attach__name">{write.label}</b>
                <button
                  type="button" className="rte-attach__drop"
                  title={`Remove ${write.label}`}
                  onClick={() => actions.onRemoveAttached(write.index)}
                >
                  <X size="0.7rem" />
                </button>
              </div>
              {write.state ? (
                <CondValue
                  state={write.state}
                  value={write.value}
                  action={write.action}
                  onChange={(next) => actions.onSetAttachedValue(write.index, next)}
                  onActionChange={(next) => actions.onSetAttachedAction(write.index, next)}
                />
              ) : (
                /*
                  nothing in the catalog claims the path this writes, so there
                  is no control to offer: it is stated as authored instead.
                */
                <span className="rte-attach__raw">{write.value || '-'}</span>
              )}
            </div>
          ))}
        </div>
      ) : null}

      {/*
        a carried feature is a feature, so the panel names it and gets out of
        the way: what it does is set where every other feature's is, on the row
        it draws in the list.
      */}
      {features.length > 0 ? (
        <div className="rte-attach">
          {features.map((child) => (
            <div className="rte-attach__row is-feature" key={child.id}>
              <div className="rte-attach__head">
                <b className="rte-attach__name">{child.label}</b>
                <button
                  type="button" className="rte-attach__drop"
                  title={`Remove ${child.label}`}
                  onClick={() => actions.onDetachFeature(child.id)}
                >
                  <X size="0.7rem" />
                </button>
              </div>
              {/*
                its own count, on the terms the step above states its own. the
                engine runs it at this times the parent's, which the row in the
                list is where you read.
              */}
              <label className="rte-attach__mult">
                <span className="rte-mult__sym" aria-hidden="true">&times;</span>
                <DraftNumber
                  min={1}
                  step={1}
                  value={multiplierFor(child)}
                  aria-label={`Times ${child.label} runs`}
                  parse={(raw) => Math.max(1, Math.floor(Number(raw) || 1))}
                  onCommit={(next) => actions.onAttachedMultiplier(child.id, next)}
                />
                <span className="rte-mult__lbl">times</span>
              </label>
            </div>
          ))}
        </div>
      ) : null}

      {writes.length === 0 && features.length === 0 ? (
        <p className="rte-palette__empty">Nothing attached to this step yet.</p>
      ) : null}

      <button type="button" className="rte-mini rte-attach__add" onClick={actions.onSetCondition}>
        <Plus size="0.7rem" />
        Add condition
      </button>
      <button type="button" className="rte-mini rte-attach__add" onClick={actions.onAttachFeature}>
        <Plus size="0.7rem" />
        Add feature
      </button>
    </InspectorSection>
  )
}

export interface ConditionActions extends ScopedNodeActions {
  /** which modifier stat a formula condition writes; ignored by every other */
  onSetModifier: (choiceId: string) => void
  onSetValue: (value: string) => void
  onSetAction: (action: ConditionWriteAction) => void
  onEdit: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}

/*
  a handoff is a condition writing the active resonator, so it takes the same
  actions on the same terms, per-run edits included. the write action is the
  only one of the condition's it has no use for: an id is set, never added to.
*/
export interface HandoffActions extends ScopedNodeActions {
  onSetTo: (memberId: string) => void
  onEdit: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}

interface WriteRecordRow {
  nodeId: string
  run: number
  loopRuns: LoopRunSelections
  scope: EditorExecutionScope
  from?: string
  to: string
  rising: boolean
  by: string
}

function sameExecutionScope(
  left: EditorExecutionScope,
  right: EditorExecutionScope | null,
): boolean {
  if (!right || left.kind !== right.kind || left.sectionId !== right.sectionId) {
    return false
  }
  return left.kind === 'section'
    || (right.kind === 'loop' && left.loopId === right.loopId && left.run === right.run)
}

function sameLoopRuns(
  expected: LoopRunSelections,
  selected: LoopRunSelections,
): boolean {
  return Object.entries(expected).every(([loopId, run]) =>
    (selected[loopId] ?? 1) === run)
}

function isCurrentWrite(
  entry: WriteRecordRow,
  nodeId: string,
  scope: EditorExecutionScope | null,
  runsByLoopId: LoopRunSelections,
): boolean {
  return entry.nodeId === nodeId
    && sameExecutionScope(entry.scope, scope)
    && sameLoopRuns(entry.loopRuns, runsByLoopId)
}

interface NodeReferenceRow {
  key: string
  target: RotationNodeTarget
  label: string
  scope: EditorExecutionScope
  scopeLabel?: string
  marker: 'up' | 'down' | 'node'
  current: boolean
  later?: boolean
  trailing?: ReactNode
}

function NodeReferenceList({
  rows,
  loopColors,
  onNavigateNode,
}: {
  rows: NodeReferenceRow[]
  loopColors: ReadonlyMap<string, string>
  onNavigateNode: (target: RotationNodeTarget) => void
}) {
  return (
    <ol className="rte-refs">
      {rows.map((row) => {
        const scopeColor = row.scope.kind === 'loop'
          ? loopColors.get(row.scope.loopId)
          : undefined
        return (
          <li
            key={row.key}
            className={`rte-refs__row${row.current ? ' is-here' : ''}${
              row.later ? ' is-later' : ''
            }`}
          >
            <button
              type="button" className="rte-refs__jump"
              title={`Go to ${row.label} in ${row.scopeLabel ?? formatExecutionScope(row.scope)}`}
              onClick={() => onNavigateNode(row.target)}
            >
              <i className={`rte-refs__tick is-${row.marker}`} aria-hidden="true" />
              <span className="rte-refs__by">{row.label}</span>
              <em className="rte-refs__run"
                style={scopeColor
                  ? ({ '--rte-scope-color': scopeColor } as React.CSSProperties)
                  : undefined}
              >
                {formatExecutionRun(row.scope)}
              </em>
              {row.trailing}
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function FeatureOccurrences({
  step,
  occurrences,
  scope,
  runsByLoopId,
  loopColors,
  onNavigateNode,
}: {
  step: EditorStep
  occurrences: FeatureOccurrence[]
  scope: EditorExecutionScope | null
  runsByLoopId: LoopRunSelections
  loopColors: ReadonlyMap<string, string>
  onNavigateNode: (target: RotationNodeTarget) => void
}) {
  if (occurrences.length === 0) {
    return null
  }

  const rows: NodeReferenceRow[] = occurrences.map((occurrence, index) => ({
    key: `${occurrence.nodeId}:${index}`,
    target: {
      nodeId: occurrence.nodeId,
      loopRuns: occurrence.loopRuns,
    },
    label: occurrence.label,
    scope: occurrence.scope,
    scopeLabel: occurrence.scopeLabel,
    marker: 'node',
    current: occurrence.nodeId === step.id
      && sameExecutionScope(occurrence.scope, scope)
      && sameLoopRuns(occurrence.loopRuns, runsByLoopId),
    trailing: <span className="rte-refs__ord">#{index + 1}</span>,
  }))

  return (
    <InspectorSection label={<>Occurrences . {occurrences.length}</>}>
      <NodeReferenceList
        rows={rows}
        loopColors={loopColors}
        onNavigateNode={onNavigateNode}
      />
    </InspectorSection>
  )
}

function CondInspector({
  node,
  run,
  history,
  modifierOptions,
  runsByLoopId,
  loopColors,
  actions,
  onNavigateNode,
}: {
  node: EditorCondition
  run: number
  history: WriteRecordRow[]
  modifierOptions: SelectOption<string>[]
  runsByLoopId: LoopRunSelections
  loopColors: ReadonlyMap<string, string>
  actions: ConditionActions
  onNavigateNode: (target: RotationNodeTarget) => void
}) {
  // the same condition can write a different value on a different pass
  const wrote = node.byRun?.[run] ?? { from: node.from, to: node.to, rising: node.rising }
  const hasPrior = wrote.from !== undefined
  const authoredWrite = node.byRun?.[run]?.writeValue ?? node.writeValue
  const editValue = authoredWrite === undefined ? wrote.to : regTextValue(authoredWrite)
  const baseAction = node.writeAction ?? condActionFromChange(node.change) ?? 'set'
  const editAction = node.byRun?.[run]?.writeAction ?? baseAction
  const disabled = Boolean(node.disabled)
  const isModifier = node.state?.ownerKey === ROT_FORMULA_OWNER_KEY
  const modifierLabel = modifierOptions
    .find((option) => option.value === node.state?.id)?.label ?? node.label
  /*
    keyed by the condition it belongs to, so selecting another one closes the
    group without an effect having to reach in and shut it.
  */
  const [picking, setPicking] = useState<string | null>(null)
  const here = history.findIndex((entry) =>
    isCurrentWrite(entry, node.id, actions.scope, runsByLoopId))
  const historyRows: NodeReferenceRow[] = history.map((entry, index) => ({
    key: `${entry.nodeId}:${index}`,
    target: {
      nodeId: entry.nodeId,
      loopRuns: entry.loopRuns,
    },
    label: entry.by,
    scope: entry.scope,
    marker: entry.from === undefined ? 'node' : entry.rising ? 'up' : 'down',
    current: isCurrentWrite(entry, node.id, actions.scope, runsByLoopId),
    later: index > here && here >= 0,
    trailing: (
      <span className="rte-refs__delta">
        {entry.from !== undefined ? (
          <>
            <s>{entry.from || '-'}</s>
            <i aria-hidden="true">&rarr;</i>
          </>
        ) : null}
        <b>{entry.to || '-'}</b>
      </span>
    ),
  }))

  return (
    <>
      <InspectorSection label="State" defaultOpen={true}>
        <div className="rte-cval">
          {hasPrior ? (
            <>
              <s className="rte-cval__was">{wrote.from || '-'}</s>
              <i className="rte-cval__arw" aria-hidden="true">&rarr;</i>
            </>
          ) : null}
          <b className={`rte-cval__now${hasPrior ? wrote.rising ? ' is-up' : ' is-down' : ''}`}>{wrote.to || '-'}</b>
        </div>

        {node.description ? (
          <RichDscr className="rte-cdesc"
            description={node.description}
            params={node.descriptionParams}
          />
        ) : null}

        <div className="rte-kv">
          <span>Source</span>
          <b>{node.effectName ?? node.sourceName ?? 'Unknown'}</b>
        </div>
        {node.extra ? (
          <div className="rte-kv">
            <span>Also writes</span>
            <b>{node.extra} more</b>
          </div>
        ) : null}
      </InspectorSection>

      <InspectorSection label="Actions" defaultOpen={true}>
        <div className="rte-acts">
          {node.state ? (
            <div className="rte-cedit">
              {/*
                a modifier is one condition standing for a whole group of
                stats, so which stat it writes is part of editing it rather
                than something fixed when it was added.
              */}
              {isModifier && modifierOptions.length > 0 ? (
                <Expandable className="rte-modpick"
                  TriggerTag="button"
                  triggerClass="rte-modpick__now"
                  innerClass="rte-modpick__grid"
                  chevronClass="rte-modpick__chev"
                  chevronSize={11}
                  plainTrigger
                  noHeaderWrap
                  open={picking === node.id}
                  onOpenChange={(next) => setPicking(next ? node.id : null)}
                  header={<b>{modifierLabel}</b>}
                >
                  {modifierOptions.map((option) => (
                    <button
                      key={String(option.value)}
                      type="button"
                      className={option.value === node.state?.id
                        ? 'rte-modpick__opt is-on'
                        : 'rte-modpick__opt'}
                      aria-pressed={option.value === node.state?.id}
                      onClick={() => {
                        setPicking(null)
                        actions.onSetModifier(String(option.value))
                      }}
                    >
                      {option.label}
                    </button>
                  ))}
                </Expandable>
              ) : null}
              <CondValue
                state={node.state}
                value={editValue}
                action={editAction}
                onChange={actions.onSetValue}
                onActionChange={actions.onSetAction}
              />
              <RunScope
                scope={actions.scope}
                scopeColor={actions.scopeColor}
              />
            </div>
          ) : null}
          <ActBtn icon={<Pencil size="0.8rem" />} label="Edit condition" onPress={actions.onEdit} />
          <ClipActs actions={actions} />
          <ActBtn
            icon={disabled ? <PowerOff size="0.8rem" /> : <Power size="0.8rem" />}
            label={disabled ? 'Enable condition' : 'Disable condition'}
            onPress={actions.onToggleEnabled}
          />
          <ActBtn icon={<Trash2 size="0.8rem" />} label="Delete" danger onPress={actions.onDelete} />
        </div>
      </InspectorSection>

      <InspectorSection label={<>History . {history.length} {history.length === 1 ? 'write' : 'writes'}</>}>
        {history.length > 0 ? (
          <NodeReferenceList
            rows={historyRows}
            loopColors={loopColors}
            onNavigateNode={onNavigateNode}
          />
        ) : (
          <p className="rte-palette__empty">Nothing writes this state.</p>
        )}
      </InspectorSection>
    </>
  )
}

function MemberFace({
  member,
  className,
}: {
  member: EditorMember | undefined
  className: string
}) {
  return (
    <img
      className={className}
      src={member?.profile ?? ''}
      alt=""
      title={member?.name}
      onError={withDefResMg}
      loading="lazy"
    />
  )
}

/*
  a handoff inspects as the pair it is. its value is a resonator id, so the
  select the condition branch would draw becomes the team, and the history's
  value delta becomes the two faces.
*/
function HandoffInspector({
  node,
  run,
  members,
  history,
  runsByLoopId,
  loopColors,
  actions,
  onNavigateNode,
}: {
  node: EditorHandoff
  run: number
  members: EditorMember[]
  history: WriteRecordRow[]
  runsByLoopId: LoopRunSelections
  loopColors: ReadonlyMap<string, string>
  actions: HandoffActions
  onNavigateNode: (target: RotationNodeTarget) => void
}) {
  const byId = new Map(members.map((member) => [member.id, member]))
  // the same handoff can hand to someone else on a different pass
  const handed = node.byRun?.[run] ?? { from: node.from, to: node.to }
  const picked = handed.to
  const from = byId.get(handed.from)
  const to = byId.get(handed.to)
  const disabled = Boolean(node.disabled)
  const here = history.findIndex((entry) =>
    isCurrentWrite(entry, node.id, actions.scope, runsByLoopId))

  const historyRows: NodeReferenceRow[] = history.map((entry, index) => ({
    key: `${entry.nodeId}:${index}`,
    target: { nodeId: entry.nodeId, loopRuns: entry.loopRuns },
    label: entry.by,
    scope: entry.scope,
    marker: 'node',
    current: isCurrentWrite(entry, node.id, actions.scope, runsByLoopId),
    later: index > here && here >= 0,
    trailing: (
      <span className="rte-hoff__delta">
        <MemberFace
          member={entry.from === undefined ? undefined : byId.get(entry.from)} className="rte-hoff__delta-out"
        />
        <MemberFace member={byId.get(entry.to)} className="rte-hoff__delta-in" />
      </span>
    ),
  }))

  return (
    <>
      <InspectorSection label="State" defaultOpen={true}>
        <div className="rte-hoff">
          <span className="rte-hoff__side is-out">
            <MemberFace member={from} className="rte-hoff__face" />
            <span className="rte-hoff__name">{from?.name ?? node.from}</span>
          </span>
          <ArrowRight className="rte-hoff__arw" size="0.9rem" aria-hidden="true" />
          <span className="rte-hoff__side is-in">
            <MemberFace member={to} className="rte-hoff__face" />
            <span className="rte-hoff__name">{to?.name ?? node.to}</span>
          </span>
        </div>
      </InspectorSection>

      <InspectorSection label="Actions" defaultOpen={true}>
        <div className="rte-acts">
          <div className="rte-cedit">
            <div className="rte-hoff__picks" role="radiogroup" aria-label="On field">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  role="radio"
                  aria-checked={member.id === picked}
                  className={`rte-hoff__pick${member.id === picked ? ' is-on' : ''}`}
                  style={{ '--rte-tone': ATTR_COLORS[member.attribute] } as React.CSSProperties}
                  onClick={() => actions.onSetTo(member.id)}
                >
                  <MemberFace member={member} className="rte-hoff__pick-face" />
                  <span>{member.name}</span>
                </button>
              ))}
            </div>
            <RunScope
              scope={actions.scope}
              scopeColor={actions.scopeColor}
            />
          </div>

          <ActBtn icon={<Pencil size="0.8rem" />} label="Edit condition" onPress={actions.onEdit} />
          <ClipActs actions={actions} />
          <ActBtn
            icon={disabled ? <PowerOff size="0.8rem" /> : <Power size="0.8rem" />}
            label={disabled ? 'Enable handoff' : 'Disable handoff'}
            onPress={actions.onToggleEnabled}
          />
          <ActBtn icon={<Trash2 size="0.8rem" />} label="Delete" danger onPress={actions.onDelete} />
        </div>
      </InspectorSection>

      <InspectorSection label={<>History . {history.length} {history.length === 1 ? 'handoff' : 'handoffs'}</>}>
        {history.length > 0 ? (
          <NodeReferenceList
            rows={historyRows}
            loopColors={loopColors}
            onNavigateNode={onNavigateNode}
          />
        ) : (
          <p className="rte-palette__empty">Nothing hands over the field.</p>
        )}
      </InspectorSection>
    </>
  )
}

/*
  a block is a container: it has no owner asset and no stat line of its own.
  what it has is a shape (how many times, or how much of the time), a total,
  and the things inside it.
*/
export interface BlockActions extends ScopedNodeActions {
  onAddSetup: () => void
  onRemoveSetup: () => void
  /** take a loop's end away, leaving it running back around to its own start */
  onRemoveEnd: () => void
  onRename: (label: string) => void
  onColor: (color: string) => void
  onValue: (value: number) => void
  onUptime: (value: number) => void
  onToggleShut: () => void
  onToggleEnabled: () => void
  onDelete: () => void
}

const BLOCK_ICON = {
  loop: RotateCcw,
  repeat: Repeat,
  uptime: Timer,
  setup: Layers,
} as const

function InspectorItems({
  nodes,
  label,
  onSelectNode,
}: {
  nodes: EditorNode[]
  label: string
  onSelectNode?: (id: string) => void
}) {
  return (
    <div className="rte-items">
      <span className="rte-items__lbl">{label}</span>
      {nodes.length > 0 ? (
        nodes.map((child, index) => {
          const content = (
            <>
              <i className="rte-item__mark" aria-hidden="true" />
              <span className="rte-item__name">{editorNodeLabel(child)}</span>
              {child.type === 'step' && child.multiplier > 1 ? (
                <em className="rte-item__note">x{child.multiplier}</em>
              ) : null}
              {child.type === 'condition' ? (
                <em className="rte-item__note">{child.to}</em>
              ) : null}
            </>
          )
          const className = `rte-item rte-item--${child.type}${onSelectNode ? '' : ' is-static'}`
          const childColor = child.type === 'step'
            ? child.color ?? (child.element ? ATTR_COLORS[child.element] : undefined)
            : undefined
          const style = childColor
            ? ({ '--rte-res': childColor } as React.CSSProperties)
            : undefined

          return onSelectNode ? (
            <button
              key={`${index}:${child.id}`}
              type="button"
              className={className}
              style={style}
              onClick={() => onSelectNode(child.id)}
            >
              {content}
            </button>
          ) : (
            <div key={`${index}:${child.id}`} className={className} style={style}>
              {content}
            </div>
          )
        })
      ) : (
        <p className="rte-palette__empty">Nothing here yet.</p>
      )}
    </div>
  )
}

function collectInspectorNodes(
  nodes: EditorNode[],
  seen: Set<string>,
  out: EditorNode[] = [],
): EditorNode[] {
  for (const node of nodes) {
    const sourceId = node.sourceNode?.id ?? node.id
    if (!seen.has(sourceId)) {
      seen.add(sourceId)
      out.push(node)
    }

    if (node.type !== 'note' && node.type !== 'setup' && node.attachedNote) {
      collectInspectorNodes([node.attachedNote], seen, out)
    }
    if (node.type === 'step' && node.attached) {
      collectInspectorNodes(node.attached, seen, out)
    }
    if (isEditorBlock(node)) {
      collectInspectorNodes(node.children, seen, out)
    }
  }
  return out
}

/** Every authored node in a completed rotation result, grouped by section. */
export function RotationNodesInspector({
  sections,
}: {
  sections: EditorSection[]
}) {
  const seen = new Set<string>()
  const groups = sections.map((section) => ({
    id: section.id,
    label: section.title,
    nodes: collectInspectorNodes(section.children, seen),
  }))

  return (
    <InspectorSection label="Nodes">
      {groups.map((group) => (
        <InspectorItems
          key={group.id}
          nodes={group.nodes}
          label={group.label}
        />
      ))}
    </InspectorSection>
  )
}

function BlockInspector({
  node,
  body: bodyItems,
  run,
  runTotals,
  shut,
  actions,
  decimals,
  onRunChange,
  onSelectNode,
}: {
  node: EditorBlock
  /**
   * what the block runs, in the order it runs it. for a loop drawn in more
   * than one piece this is the whole loop rather than the piece that happens
   * to be selected, which is a drawing and not the thing that runs.
   */
  body: EditorNode[]
  run: number
  /** what the loop deals on each of its passes, run 1 first */
  runTotals: number[]
  shut: boolean
  actions: BlockActions
  decimals: number
  onRunChange: (run: number) => void
  onSelectNode: (id: string) => void
}) {
  const isUptime = node.type === 'uptime'
  const value = isUptime
    ? Math.round((node.ratioByRun?.[run] ?? node.ratio ?? 1) * 100)
    : Math.max(1, node.runsByRun?.[run] ?? node.runs)
  const disabled = Boolean(node.disabled)
  const colors: readonly string[] = node.type === 'loop' ? ROT_LOOP_COLORS : ROT_BLOCK_COLORS
  const colour = node.color ?? colors[0]
  const setup = node.children.find((child): child is EditorBlock => child.type === 'setup')
  const body = bodyItems.filter((child) => child.type !== 'setup')
  const hasSetup = Boolean(setup?.children.length)
  const repeatValue = Math.max(1, node.runsByRun?.[run] ?? node.runs)
  const uptimeValue = Math.round((node.ratioByRun?.[run] ?? node.ratio ?? 1) * 100)

  return (
    <>
      <InspectorSection label="Settings" defaultOpen={true}>
        <div className="rte-blocksettings">
          {node.type !== 'setup' ? (
            <ColourPicker
              colour={colour}
              presets={colors}
              onCommit={actions.onColor}
              name={`${node.type} colour`}
            />
          ) : null}

          {/* what each pass actually deals. the loop runs the same nodes every
              time, so where the numbers differ it is the state that differs. */}
          {runTotals.length > 1 ? (
            <ol className="rte-runlist">
              {runTotals.map((amount, index) => {
                const which = index + 1
                const peak = Math.max(1, ...runTotals)
                return (
                  <li key={which}>
                    <button
                      type="button"
                      className={`rte-runlist__row${which === run ? ' is-on' : ''}`}
                      aria-pressed={which === run}
                      aria-label={`${node.label} run ${which} of ${runTotals.length}`}
                      onClick={() => onRunChange(which)}
                    >
                      <span className="rte-runlist__no">{which}</span>
                      <span className="rte-runlist__bar" aria-hidden="true">
                        <i style={{ '--w': `${(amount / peak) * 100}%` } as React.CSSProperties} />
                      </span>
                      <b className="rte-runlist__amt">{formatDamage(amount, decimals)}</b>
                    </button>
                  </li>
                )
              })}
            </ol>
          ) : null}

          {/*
            Two numbers do not need two cards. Each setting is a ruled line:
            the name on the left in the panel's own label voice, the value on
            the right, and the unit once rather than three times.
          */}
          {node.type === 'repeat' ? (
            <div className="rte-blockset">
              <label className="rte-blockset__row">
                <span className="rte-blockset__key">Repeat body</span>
                <span className="rte-blockset__val">
                  <DraftNumber
                    min={1}
                    step={1}
                    value={repeatValue}
                    aria-label="Times this block runs"
                    parse={(raw) => {
                      const parsed = Number(raw)
                      return Number.isNaN(parsed) ? null : Math.max(1, parsed)
                    }}
                    onCommit={actions.onValue}
                  />
                  <i className="rte-blockset__unit" aria-hidden="true">&times;</i>
                </span>
                <RunScope scope={actions.scope} base={repeatValue !== node.runs ? node.runs : null} scopeColor={actions.scopeColor} />
              </label>

              {/*
                The window is the setup branch's, so the row that edits it is
                also the row that adds and removes the branch.
              */}
              <div className={`rte-blockset__row${setup ? '' : ' is-empty'}`}>
                <span className="rte-blockset__key">Setup window</span>
                {setup ? (
                  <span className="rte-blockset__val">
                    <DraftNumber
                      min={0}
                      max={100}
                      step={5}
                      value={uptimeValue}
                      aria-label="Percent of the time the setup window is up"
                      parse={(raw) => {
                        const parsed = Number(raw)
                        return Number.isNaN(parsed) ? null : Math.max(0, Math.min(100, parsed))
                      }}
                      onCommit={actions.onUptime}
                    />
                    <i className="rte-blockset__unit" aria-hidden="true">%</i>
                    <button
                      type="button" className="rte-blockset__act"
                      title={hasSetup
                        ? 'Remove the setup branch. Its entries move to the top of the body.'
                        : 'Remove the setup branch'}
                      aria-label="Remove setup"
                      onClick={actions.onRemoveSetup}
                    >
                      <Minus size="0.72rem" aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <button
                    type="button" className="rte-blockset__act rte-blockset__act--wide"
                    onClick={actions.onAddSetup}
                  >
                    <Layers size="0.72rem" aria-hidden="true" />
                    Add setup
                  </button>
                )}
                {setup && !hasSetup ? (
                  <em className="rte-blockset__note">Empty, so the window changes nothing yet.</em>
                ) : null}
                {!setup ? (
                  <em className="rte-blockset__note">A branch that runs once to open the window.</em>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="rte-blockset">
              <label className="rte-blockset__row">
                <span className="rte-blockset__key">{isUptime ? 'Window' : 'Runs'}</span>
                <span className="rte-blockset__val">
                  <DraftNumber
                    min={isUptime ? 0 : 1}
                    max={isUptime ? 100 : undefined}
                    step={isUptime ? 5 : 1}
                    value={value}
                    aria-label={isUptime ? 'Percent of the time the window is up' : 'Times this block runs'}
                    parse={(raw) => {
                      const parsed = Number(raw)
                      return Number.isNaN(parsed) ? null : isUptime ? Math.max(0, Math.min(100, parsed)) : Math.max(1, parsed)
                    }}
                    onCommit={actions.onValue}
                  />
                  <i className="rte-blockset__unit" aria-hidden="true">{isUptime ? '%' : '\u00d7'}</i>
                </span>
              </label>
            </div>
          )}
        </div>
      </InspectorSection>

      <InspectorSection label="Actions" defaultOpen={true}>
        <div className="rte-acts">
          {node.type === 'loop' ? (
            /*
              a loop with no end is a shape you can author, so the page offers
              it: the end goes back onto the start and the loop runs on round
              to it. a loop that already has none has nothing to take away.
            */
            <ActBtn
              icon={<Unlink size="0.8rem" />}
              label="Remove end"
              disabled={node.noEnd}
              onPress={actions.onRemoveEnd}
            />
          ) : null}
          <ActBtn
            icon={shut ? <ChevronRight size="0.8rem" /> : <ChevronDown size="0.8rem" />}
            label={shut ? 'Expand block' : 'Collapse block'}
            onPress={actions.onToggleShut}
          />
          <ClipActs actions={actions} />
          <ActBtn
            icon={disabled ? <PowerOff size="0.8rem" /> : <Power size="0.8rem" />}
            label={disabled ? 'Enable block' : 'Disable block'}
            onPress={actions.onToggleEnabled}
          />
          <ActBtn icon={<Trash2 size="0.8rem" />} label="Delete" danger onPress={actions.onDelete} />
        </div>
      </InspectorSection>

      <InspectorSection label="Items">
        {setup && setup.type === 'setup' ? (
          <InspectorItems nodes={setup.children} label="Setup" onSelectNode={onSelectNode} />
        ) : null}
        <InspectorItems
          nodes={body}
          label={setup ? 'Body' : 'Contents'}
          onSelectNode={onSelectNode}
        />
      </InspectorSection>
    </>
  )
}

/*
  resonators choose the scope of the second split. within that scope, the
  three lenses are the same damage seen by skill type, talent node, or
  attribute, so each still adds up to its own 100%.
*/
type BreakdownLensKey = 'type' | 'node' | 'attr'
type BreakdownLensField = 'skillTypes' | 'talentNodes' | 'attributes'

const BREAKDOWN_LENSES: {
  key: BreakdownLensKey
  label: string
  field: BreakdownLensField
}[] = [
  { key: 'type', label: 'Type', field: 'skillTypes' },
  { key: 'node', label: 'Node', field: 'talentNodes' },
  { key: 'attr', label: 'Attr', field: 'attributes' },
]

/** how many rows are left standing once the list has to fold */
const RANK_ROWS = 4

/*
  the list stands in full wherever it fits: a fold is a cost, so it is only
  paid when the panel is genuinely too short to hold the rows. this measures
  the inspector's own scrollport rather than guessing at a breakpoint, because
  what is left for the list depends on what else is open above it.
*/
function useTightList(signature: string) {
  const listRef = useRef<HTMLOListElement | null>(null)
  const [tight, setTight] = useState(false)
  // the committed answer, so measuring never depends on state
  const held = useRef(false)

  const measure = useCallback(() => {
    const list = listRef.current
    const port = list?.closest<HTMLElement>('.rte-scroll')
    if (!list || !port) {
      return
    }

    const spare = port.clientHeight - port.scrollHeight

    if (!held.current) {
      if (spare < 0) {
        held.current = true
        setTight(true)
      }
      return
    }

    // going back needs room for every row still folded away, plus a little,
    // so the list cannot fold and unfold around a single pixel
    const rows = list.children.length
    const step = rows > 0 ? list.getBoundingClientRect().height / rows : 0
    const hidden = Number(list.dataset.hidden ?? 0)
    if (spare >= hidden * step + 8) {
      held.current = false
      setTight(false)
    }
  }, [])

  useLayoutEffect(() => {
    const list = listRef.current
    const port = list?.closest<HTMLElement>('.rte-scroll')
    if (!list || !port) {
      return
    }

    let frame = 0
    const schedule = () => {
      if (frame) {
        return
      }
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }

    // the observer delivers the sizes it starts with, so the first answer
    // comes from it rather than from a measure taken during the effect
    const observer = new ResizeObserver(schedule)
    observer.observe(port)
    observer.observe(list)

    return () => {
      if (frame) {
        cancelAnimationFrame(frame)
      }
      observer.disconnect()
    }
  }, [measure, signature])

  return { listRef, tight }
}

/*
  a group paints in its own colour where it has one, an attribute or a
  resonator's element. the rest ramp down from a tone by rank, so a list
  without colours still reads as a share rather than as a stripe. the tone is
  the panel accent until the list is scoped to one resonator, at which point it
  is that resonator's, so the whole reading is in their colour.
*/
const RAMP = [100, 62, 42, 28, 18]

function tint(group: SummaryGroup, index: number, tone: string): string {
  if (group.color) {
    return group.color
  }
  return `color-mix(in srgb, ${tone} ${RAMP[index] ?? 12}%, var(--rte-card))`
}

function RankedBreakdown({
  groups,
  signature,
  all,
  onToggleAll,
  selectedId,
  onSelect,
  decimals,
  tone = 'var(--accent)',
}: {
  groups: SummaryGroup[]
  signature: string
  all: boolean
  onToggleAll: () => void
  selectedId?: string | null
  onSelect?: (id: string) => void
  decimals: number
  /** what the colourless ranks ramp down from */
  tone?: string
}) {
  const { listRef, tight } = useTightList(signature)
  const shown = tight && !all ? groups.slice(0, RANK_ROWS) : groups
  const rest = groups.slice(shown.length)
  const restPct = rest.reduce((sum, group) => sum + group.sharePct, 0)
  // bars read against the leader, not against the whole, so the shape of the
  // list stays legible when one group carries most of the rotation
  const leader = Math.max(1, groups[0]?.avg ?? 1)

  if (groups.length === 0) {
    return <p className="rte-palette__empty">No damage resolved yet.</p>
  }

  return (
    <>
      <div className="rte-stack" aria-hidden="true">
        {groups.map((group, index) => (
          <i key={group.id} style={{ width: `${group.sharePct}%`, background: tint(group, index, tone) }} />
        ))}
      </div>

      <ol className="rte-rank" ref={listRef} data-hidden={rest.length}>
        {shown.map((group, index) => {
          const title = `${formatDamage(group.normal, decimals)} normal . ${formatDamage(group.crit, decimals)} crit . ${group.count} ${group.count === 1 ? 'row' : 'rows'}`
          const content = (
            <>
              {group.icon ? (
                <img
                  className={`rte-rank__key ${group.iconKind === 'glyph' ? 'is-glyph' : 'is-art'}`}
                  src={group.icon}
                  alt=""
                  onError={withDefIconM}
                  loading="lazy"
                />
              ) : (
                <i className="rte-rank__key" style={{ background: tint(group, index, tone) }} aria-hidden="true" />
              )}
              <span className="rte-rank__main">
                <span className="rte-rank__name">{group.label}</span>
                <span className="rte-rank__bar" aria-hidden="true">
                  <i style={{ width: `${(group.avg / leader) * 100}%`, background: tint(group, index, tone) }} />
                </span>
              </span>
              <span className="rte-rank__num">
                {formatDamage(group.avg, decimals)}
                <em>{group.sharePct.toFixed(1)}%</em>
              </span>
            </>
          )

          return onSelect ? (
            <li key={group.id}>
              <button
                type="button"
                className={`rte-rank__row is-pick${selectedId === group.id ? ' is-on' : ''}`}
                style={{ '--rte-rank-tone': tint(group, index, tone) } as React.CSSProperties}
                aria-pressed={selectedId === group.id}
                title={title}
                onClick={() => onSelect(group.id)}
              >
                {content}
              </button>
            </li>
          ) : (
            <li
              key={group.id} className="rte-rank__row"
              /* normal, crit and the row count stay reachable without
                 taking a column each */
              title={title}
            >
              {content}
            </li>
          )
        })}
      </ol>

      {tight && (rest.length > 0 || all) ? (
        <button
          type="button" className="rte-more"
          onClick={onToggleAll}
        >
          {all
            ? 'Show the top four'
            : `+ ${rest.length} more . ${restPct.toFixed(1)}%`}
        </button>
      ) : null}
    </>
  )
}

/*
  What a rotation put out that was not damage, read under the figure it stands
  with. Two numbers are not a section: they are the rest of the sentence the
  figure starts, so they sit on its line rather than behind a fold.
*/
export function SupportReadings({
  totals,
  decimals,
}: {
  totals: RotationSummary['supportTotals']
  decimals: number
}) {
  if (totals.healing === 0 && totals.shield === 0) {
    return null
  }

  return (
    <span className="rte-figure__sup">
      {totals.healing !== 0 ? (
        <span className="rte-sup rte-sup--healing">
          <b>{formatDamage(totals.healing, decimals)}</b>
          heal
        </span>
      ) : null}
      {totals.shield !== 0 ? (
        <span className="rte-sup rte-sup--shield">
          <b>{formatDamage(totals.shield, decimals)}</b>
          shield
        </span>
      ) : null}
    </span>
  )
}

/*
  What the rotation was run with. The five echoes are a strip read left to
  right, and under it a tie brackets the pieces that make one sonata set, so a
  build's shape is literal: one wide tie is a whole set, two short ties are a
  split. The strip groups by set rather than by slot, which is what lets a tie
  be exactly a set instead of whichever pieces happen to sit side by side. Slot
  order says nothing here that the reader needs: the main echo wears its own
  mark and cost is only ever a total.

  A solid tie is a set paying in full, whatever full means for it: one piece,
  three or five. A dashed tie is a five-piece set stopped at its two-piece
  rung, and it names the target it is short of. A dotted stub is pieces that
  buy nothing yet.
*/
const MAX_ECHO_COST = 12

/** a stat icon is drawn as a mask so it can take the weapon's rarity ink */
function glyphMask(src: string): React.CSSProperties {
  return { WebkitMaskImage: `url(${src})`, maskImage: `url(${src})` } as React.CSSProperties
}

interface EchoRun {
  setId: number
  /** first and last cell in the strip this set covers */
  start: number
  end: number
  /** unique pieces, counted the way the engine counts them for a bonus */
  pieces: number
  /** what this set asks for in full: one, three or five */
  req: number
  /** the set is paying everything it has to give */
  complete: boolean
  /** something is live, whether that is the whole set or its first tier */
  live: boolean
}

/*
  a set's ladder is its own. one-piece and three-piece sets pay once, at the
  top; only a five-piece set has a rung below the top, at two. so a run cannot
  be read against a fixed five and has to ask the set what it wants.
*/
function setLadder(setId: number): { req: number; firstTier: number } {
  const setMax = getEchoSetDe(setId)?.setMax
  if (setMax === 1) return { req: 1, firstTier: 1 }
  if (setMax === 3) return { req: 3, firstTier: 3 }
  return { req: 5, firstTier: 2 }
}

function readBuild(echoes: Array<EditorEcho | null>) {
  const worn = echoes.filter((echo): echo is EditorEcho => echo != null)
  const order: number[] = []
  const bySet = new Map<number, EditorEcho[]>()

  for (const echo of worn) {
    const group = bySet.get(echo.setId)
    if (group) {
      group.push(echo)
    } else {
      bySet.set(echo.setId, [echo])
      order.push(echo.setId)
    }
  }

  const cells: EditorEcho[] = []
  const runs: EchoRun[] = []

  for (const setId of order) {
    const group = bySet.get(setId) ?? []
    // two copies of one echo only buy one piece of the set, so count ids
    const pieces = new Set(group.map((echo) => echo.id)).size
    const { req, firstTier } = setLadder(setId)
    runs.push({
      setId,
      start: cells.length,
      end: cells.length + group.length - 1,
      pieces,
      req,
      complete: pieces >= req,
      live: pieces >= firstTier,
    })
    cells.push(...group)
  }

  return {
    cells,
    runs,
    slots: Math.max(echoes.length, cells.length),
    empty: echoes.length - cells.length,
    cost: cells.reduce((total, echo) => total + echo.cost, 0),
  }
}

/*
  A band names the resonator it is about, unless it is already standing under
  one: the saved ledger opens a build inside the take it belongs to, so the
  face, the name and the attribute would only say it twice. Everything the
  stamp carries is about the build rather than the resonator, so it stays.
*/
export function BuildBand({
  member,
  identified = true,
}: {
  member: EditorMember
  identified?: boolean
}) {
  const { cells, runs, slots, empty, cost } = readBuild(member.echoes)
  const attribute = getAttributeIconSrc(member.attribute)
  const columns = { gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }

  return (
    <div className="rte-bld__band"
      style={{ '--rte-bld-m': ATTR_COLORS[member.attribute] } as React.CSSProperties}
    >
      <div className="rte-bld__id">
        {identified ? (
          <>
            <img className="rte-bld__face"
              src={member.profile}
              alt=""
              onError={withDefResMg}
              loading="lazy"
            />
            <span className="rte-bld__name" title={member.name}>{member.name}</span>
            {attribute ? (
              <img className="rte-bld__attr"
                src={attribute}
                alt={member.attribute}
                onError={withDefIconM}
                loading="lazy"
              />
            ) : null}
          </>
        ) : null}
        <span className="rte-bld__stamp">
          <span title="Resonator level">LV {member.level}</span>
          <span className="rte-bld__seq" title="Sequence">S{member.sequence}</span>
          {/* level, sequence and budget are all facts about the build as a
              whole, so they read as one stamp and the foot is left to the
              weapon */}
          <span className="rte-bld__bdgt"
            title={`${cost} of ${MAX_ECHO_COST} cost used`}
          >
            <b>{cost}<em>/{MAX_ECHO_COST}</em></b>
            <i
              aria-hidden="true"
              style={{
                '--rte-bld-pct': `${Math.min(100, (cost / MAX_ECHO_COST) * 100)}%`,
              } as React.CSSProperties}
            />
          </span>
        </span>
      </div>

      <div className="rte-bld__strip" style={columns}>
        {cells.map((echo, index) => (
          <span
            key={`${echo.id}:${index}`}
            className={`rte-bld__cell${echo.mainEcho ? ' is-main' : ''}`}
            style={{ '--rte-bld-s': getSntSetClr(echo.setId) ?? 'var(--muted)' } as React.CSSProperties}
            title={`${echo.name} . cost ${echo.cost} . ${getSntSetNam(echo.setId)}`}
          >
            <img
              src={echo.icon || `/assets/game/echoes/icons/${echo.id}.webp`}
              alt=""
              onError={withDefEchoMg}
              loading="lazy"
            />
            {/* the slot's price, facing the main-echo flag across the frame.
                it is a caption: it never sizes or orders the frame it sits on,
                and the only measure of cost is the total in the stamp. */}
            <i className="rte-bld__cost" aria-hidden="true">
              {String(echo.cost).padStart(2, '0')}
            </i>
          </span>
        ))}
        {Array.from({ length: Math.max(0, empty) }, (_, index) => (
          <span key={`empty:${index}`} className="rte-bld__cell is-empty" title="Empty slot" />
        ))}
      </div>

      {runs.length > 0 ? (
        <div className="rte-bld__ties" style={columns}>
          {runs.map((run) => {
            const icon = getSntSetIco(run.setId)
            const name = getSntSetNam(run.setId)
            const width = run.end - run.start + 1
            return (
              <span
                key={run.setId}
                className={[
                  'rte-bld__tie',
                  run.complete ? '' : run.live ? '' : 'is-orphan',
                ].filter(Boolean).join(' ')}
                style={{
                  '--rte-bld-s': getSntSetClr(run.setId) ?? 'var(--muted)',
                  gridColumn: `${run.start + 1}/${run.end + 2}`,
                } as React.CSSProperties}
                title={`${name} . ${run.pieces} of ${run.req}${
                  run.complete
                    ? ` . ${run.req}-piece live`
                    : run.live ? ' . two-piece live' : ' . no bonus yet'
                }`}
              >
                {run.live ? (
                  <span className="rte-bld__tag">
                    {icon ? (
                      <img src={icon} alt="" onError={withDefIconM} loading="lazy" />
                    ) : null}
                    {/* a two-slot tie cannot hold a set name without shredding
                        it, and two sets share #FFFFFF, so the glyph is what
                        names a set and the words are a bonus where they fit */}
                    {width >= 3 ? <span className="rte-bld__set">{name}</span> : null}
                    {/* a complete set has nothing left to reach, so it states
                        what it has. one still short names the target too. */}
                    <em>{run.complete
                      ? <>&times;{run.pieces}</>
                      : `${run.pieces}/${run.req}`}</em>
                  </span>
                ) : null}
              </span>
            )
          })}
        </div>
      ) : null}

      {member.weapon.id ? (
        <div className="rte-bld__wpn"
          style={rarityVars(member.weapon.rarity, false, '--rte-bld-w') as React.CSSProperties}
        >
          <img className="rte-bld__wart"
            src={member.weapon.icon || `/assets/game/weapons/icons/${member.weapon.id}.webp`}
            alt=""
            onError={withDefWpnMg}
            loading="lazy"
          />
          {/* the row has one voice: art, then the name as its label, then the
              figures. rarity is the only thing that inks it. */}
          <span className="rte-bld__wname" title={member.weapon.name}>
            {member.weapon.name || 'Weapon'}
          </span>
          <span className="rte-bld__wstamp">
            R{member.weapon.rank} · LV {member.weapon.level}
          </span>
          <span className="rte-bld__wstats">
            <span className="rte-bld__wstat"
              title={`Base ATK at Lv ${member.weapon.level}`}
            >
              <i className="rte-bld__wglyph" style={glyphMask(WPN_STAT_CNS.atk)} />
              {member.weapon.atk}
            </span>
            {member.weapon.statKey ? (
              <span className="rte-bld__wstat"
                title={WPNSTATLBLS[member.weapon.statKey] ?? member.weapon.statKey}
              >
                {WPN_STAT_CNS[member.weapon.statKey] ? (
                  <i className="rte-bld__wglyph"
                    style={glyphMask(WPN_STAT_CNS[member.weapon.statKey])}
                  />
                ) : null}
                {fmtWpnStatDs(member.weapon.statKey, member.weapon.statValue)}
              </span>
            ) : null}
          </span>
        </div>
      ) : (
        <div className="rte-bld__wpn is-void">
          <span className="rte-bld__wname">No weapon equipped</span>
        </div>
      )}
    </div>
  )
}

/**
 * The builds a run was made with, as its own fold. Every surface that reads a
 * rotation shows the same one, including the saved panel before its run has
 * resolved: a take's builds are known the moment it is picked, and do not have
 * to wait for the numbers.
 */
export function BuildsSection({
  members,
  defaultOpen = false,
}: {
  members: EditorMember[]
  defaultOpen?: boolean
}) {
  if (members.length === 0) {
    return null
  }

  return (
    <InspectorSection label={<>Builds . {members.length}</>} defaultOpen={defaultOpen}>
      <div className="rte-bld">
        {members.map((member) => (
          <BuildBand key={member.id} member={member} />
        ))}
      </div>
    </InspectorSection>
  )
}

export function RotationTotalsInspector({
  summary,
  members = [],
  decimals,
  defaultOpen = {},
}: {
  summary: RotationSummary
  members?: EditorMember[]
  decimals: number
  /*
    what each fold does when the panel first draws, straight through to the
    section. a saved take opens on its builds and leaves the rest shut: the
    builds are read off its snapshot and have nothing to wait for, and the
    folds that do wait fill in collapsed, where nobody is looking.
  */
  defaultOpen?: {
    resonators?: boolean
    builds?: boolean
    breakdown?: boolean
  }
}) {
  const [selectedResonatorId, setSelectedResonatorId] = useState<string | null>(null)
  const [resonatorsAll, setResonatorsAll] = useState(false)
  const [view, setView] = useState<{ lens: BreakdownLensKey; all: boolean }>({
    lens: 'type',
    all: false,
  })

  const lens = BREAKDOWN_LENSES.find((entry) => entry.key === view.lens) ?? BREAKDOWN_LENSES[0]
  const selectedResonator = summary.resonators.find(
    (group) => group.id === selectedResonatorId,
  ) ?? null
  const scopedBreakdown = selectedResonator
    ? summary.byResonator[selectedResonator.id]
    : summary
  const groups = scopedBreakdown?.[lens.field] ?? []

  const selectResonator = (id: string) => {
    setSelectedResonatorId((selected) => selected === id ? null : id)
    setView((current) => ({ ...current, all: false }))
  }

  return (
    <>
      {/*
        healing and shield are stated by the totals strip at the foot of the
        page, which reports whatever the page is showing. the panel breaks
        those totals down rather than quoting them a second time.
      */}
      <InspectorSection label="Resonators" defaultOpen={defaultOpen.resonators ?? true}>
        <RankedBreakdown
          groups={summary.resonators}
          signature={`resonators:${summary.resonators.length}`}
          all={resonatorsAll}
          onToggleAll={() => setResonatorsAll((current) => !current)}
          selectedId={selectedResonator?.id}
          onSelect={selectResonator}
          decimals={decimals}
        />
      </InspectorSection>

      <BuildsSection members={members} defaultOpen={defaultOpen.builds ?? false} />

      <InspectorSection defaultOpen={defaultOpen.breakdown ?? true}
        label={(
          <span className="rte-breakdown__label">
            Breakdown
            <em
              style={{'--accent': selectedResonator ? selectedResonator.color : 'var(--muted)'} as React.CSSProperties}
            >
              {selectedResonator?.label ?? 'Total'}</em>
          </span>
        )}
      >
        <div className="rte-lens"
          role="group"
          aria-label="Break down by"
          /* the lens says which reading is on screen, so it is coloured by
             whose reading it is rather than by the page's own resonator */
          style={selectedResonator?.color
            ? { '--rte-res': selectedResonator.color } as React.CSSProperties
            : undefined}
        >
          {BREAKDOWN_LENSES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={entry.key === lens.key}
              className={entry.key === lens.key ? 'is-on' : undefined}
              onClick={() => setView({ lens: entry.key, all: false })}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <RankedBreakdown
          groups={groups}
          signature={`${selectedResonator?.id ?? 'total'}:${lens.key}:${groups.length}`}
          all={view.all}
          onToggleAll={() => setView((current) => ({ ...current, all: !current.all }))}
          /* attributes carry the colours of the elements they are, which are
             not the resonator's to overrule */
          tone={selectedResonator && lens.key !== 'attr' ? selectedResonator.color : undefined}
          decimals={decimals}
        />

        {summary.counts.neverFired > 0 ? (
          <div className="rte-notes">
            <p className="rte-note is-warn" title="Their conditions were false on every pass.">
              <TriangleAlert size="0.75rem" aria-hidden="true" />
              {summary.counts.neverFired} {summary.counts.neverFired === 1 ? 'step' : 'steps'} never fired
            </p>
          </div>
        ) : null}
      </InspectorSection>
    </>
  )
}

/** one kind of node in the set, and how many of it were caught */
interface SelectionTally {
  label: string
  count: number
}

export interface SelectionSummary {
  count: number
  /** ordered most numerous first, so the bar reads left to right */
  tallies: SelectionTally[]
}

/*
  what a set of rows can be told to do. loopify and blockify already act on the
  whole selection, and the clipboard and delete take the set the same way, so
  the branch offers exactly these and invents nothing.
*/
export interface SelectionActions {
  hasSelection: boolean
  canCopy: boolean
  canPaste: boolean
  /**
   * stand the picked rows beside each other. only the surfaces that can show
   * more than one thing at once offer it, so it is absent rather than disabled
   * everywhere else.
   */
  onCompare?: () => void
  canCompare?: boolean
  compareLabel?: string
  compareHint?: string
  onLoopify?: () => void
  onBlockify?: () => void
  onCopy: () => void
  onCut?: () => void
  onPaste?: () => void
  onDuplicate?: () => void
  onSelectAll: () => void
  onClear: () => void
  onExit: () => void
  onDelete?: () => void
}

/*
  the panel accent graded down the tally, so the bar and the chips beside the
  counts are read as one measure rather than as a palette. kinds have no colour
  of their own in this editor: a step is coloured by the element it deals and a
  swap by whoever takes the field, so borrowing either here would be a lie.
*/
const SELECTION_TONES = ['100%', '62%', '40%', '26%']

export function selectionTone(index: number): string {
  return SELECTION_TONES[Math.min(index, SELECTION_TONES.length - 1)]
}

/*
  selection mode inspects the set instead of a node: how much was caught, what
  it is made of, and what can be done to all of it at once.
*/
export function SelectionInspector({
  summary,
  actions,
  emptyText = 'Pick rows in the rotation to act on them together. Shift picks a range.',
}: {
  summary: SelectionSummary
  actions: SelectionActions
  emptyText?: string
}) {
  return (
    <>
      <InspectorSection label="Contents">
        {summary.count === 0 ? (
          <p className="rte-selsum__empty">
            {emptyText}
          </p>
        ) : (
          summary.tallies.map((tally, index) => (
            <div className="rte-kv" key={tally.label}>
              <span className="rte-selsum__kind">
                <i className="rte-selsum__chip"
                  style={{ '--rte-tone': selectionTone(index) } as React.CSSProperties}
                  aria-hidden="true"
                />
                {tally.label}
              </span>
              <b>{tally.count}</b>
            </div>
          ))
        )}
      </InspectorSection>

      <InspectorSection label="Actions" defaultOpen={true}>
        <div className="rte-acts">
          {actions.onCompare ? (
            <ActBtn
              icon={<GitCompare size="0.8rem" />}
              label={actions.compareLabel ?? 'Compare'}
              hint={actions.compareHint}
              disabled={!actions.canCompare}
              onPress={actions.onCompare}
            />
          ) : null}
          {actions.onLoopify ? (
            <ActBtn
              icon={<RotateCcw size="0.8rem" />}
              label="Loopify"
              disabled={!actions.hasSelection}
              onPress={actions.onLoopify}
            />
          ) : null}
          {actions.onBlockify ? (
            <ActBtn
              icon={<TextQuote size="0.8rem" />}
              label="Blockify"
              disabled={!actions.hasSelection}
              onPress={actions.onBlockify}
            />
          ) : null}

          <ActBtn
            icon={<Copy size="0.8rem" />}
            label="Copy"
            hint="Cmd C"
            disabled={!actions.canCopy}
            onPress={actions.onCopy}
          />
          {actions.onCut ? (
            <ActBtn
              icon={<Scissors size="0.8rem" />}
              label="Cut"
              hint="Cmd X"
              disabled={!actions.canCopy}
              onPress={actions.onCut}
            />
          ) : null}
          {actions.onPaste ? (
            <ActBtn
              icon={<ClipboardPaste size="0.8rem" />}
              label="Paste"
              hint="Cmd V"
              disabled={!actions.canPaste}
              onPress={actions.onPaste}
            />
          ) : null}
          {actions.onDuplicate ? (
            <ActBtn
              icon={<CopyPlus size="0.8rem" />}
              label="Duplicate"
              hint="Stand a copy of each right after it"
              disabled={!actions.canCopy}
              onPress={actions.onDuplicate}
            />
          ) : null}

          <ActBtn
            icon={<CheckCheck size="0.8rem" />}
            label="Select all"
            hint="Cmd A"
            onPress={actions.onSelectAll}
          />
          <ActBtn
            icon={<Eraser size="0.8rem" />}
            label="Clear selection"
            hint="Shift Cmd A"
            disabled={!actions.hasSelection}
            onPress={actions.onClear}
          />
          <ActBtn
            icon={<X size="0.8rem" />}
            label="Exit selection"
            hint="Esc"
            onPress={actions.onExit}
          />

          {actions.onDelete ? (
            <ActBtn
              icon={<Trash2 size="0.8rem" />}
              label={summary.count > 0 ? `Delete ${summary.count}` : 'Delete'}
              hint="Del"
              danger
              disabled={!actions.hasSelection}
              onPress={actions.onDelete}
            />
          ) : null}
        </div>
      </InspectorSection>
    </>
  )
}

/** Flat execution keeps the aggregate reading beside, rather than behind, a row. */
export function RotationTotalsPanel({
  open,
  summary,
  members,
  decimals,
}: {
  open: boolean
  summary: RotationSummary
  members: EditorMember[]
  decimals: number
}) {
  return (
    <aside
      className={`rte-inspector${open ? ' is-out' : ''}`}
      inert={!open}
      aria-label="Rotation totals"
      style={{ '--rte-res': 'var(--accent)' } as React.CSSProperties}
    >
      <div className="rte-inspector__head">
        <div className="rte-inspector__top">
          <span className="rte-inspector__avatar is-block" aria-hidden="true">
            <BarChart3 size="1rem" />
          </span>
          <span className="rte-inspector__titles"><b>Rotation totals</b></span>
        </div>
        <div className="rte-figure">
          <b>{formatDamage(summary.total.avg, decimals)}</b>
          <span className="rte-figure__unit">avg</span>
          <span className="rte-figure__share">
            {summary.counts.damage} {summary.counts.damage === 1 ? 'damage row' : 'damage rows'}
          </span>
          <SupportReadings totals={summary.supportTotals} decimals={decimals} />
        </div>
      </div>
      <div className="rte-inspector__mid rte-scroll">
        <RotationTotalsInspector summary={summary} members={members} decimals={decimals} />
      </div>
    </aside>
  )
}

export function Inspector({
  note,
  step,
  condition,
  block,
  handoff,
  blockRunTotals,
  blockShut,
  blockBody,
  blockTotal,
  blockSteps,
  blockActions,
  handoffActions,
  selection,
  selectionActions,
  history,
  modifierOptions,
  featureOccurrences,
  runsByLoopId,
  loopColors,
  run,
  member,
  members,
  buffs,
  summary,
  totalAvg,
  decimals,
  actions,
  condActions,
  onRunChange,
  onNavigateNode,
  open = true,
  panelRef,
  onAccent,
  noteActions,
  showTotalsView = true,
}: {
  note: EditorNote | null
  step: EditorStep | null
  condition: EditorCondition | null
  block: EditorBlock | null
  handoff: EditorHandoff | null
  blockRunTotals: number[]
  blockShut: boolean
  blockTotal: number
  blockSteps: number
  /** what the selected loop runs, in the order it runs it */
  blockBody: EditorNode[]
  blockActions: BlockActions
  handoffActions: HandoffActions
  /** non-null only while selection mode is on, and it takes the whole panel */
  selection: SelectionSummary | null
  selectionActions: SelectionActions
  history: WriteRecordRow[]
  modifierOptions: SelectOption<string>[]
  featureOccurrences: FeatureOccurrence[]
  runsByLoopId: LoopRunSelections
  loopColors: ReadonlyMap<string, string>
  run: number
  member: EditorMember
  members: EditorMember[]
  buffs: BuffLine[]
  summary: RotationSummary
  totalAvg: number
  /** how many decimal places a damage figure states before it is cut */
  decimals: number
  actions: StepActions
  condActions: ConditionActions
  onRunChange: (run: number) => void
  onNavigateNode: (target: RotationNodeTarget) => void
  /** whether the page has this note out of the margin */
  open?: boolean
  /** the page measures the note to hang it beside its row */
  panelRef?: React.Ref<HTMLElement>
  /** the colour of whatever is being inspected, so the margin can take it too */
  onAccent?: (accent: string) => void
  /** null while nothing that can own a note is being inspected */
  noteActions?: NoteActions | null
  /** flat execution keeps totals in their own side panel */
  showTotalsView?: boolean
}) {
  /*
    selection mode outranks whatever node was last inspected: the panel is
    describing the set now, and the node it was on is only one member of it.
    it takes the item slot so entering the mode switches to it and Totals stays
    one press away.
  */
  const selectedBranchId = selection
    ? 'selection'
    : note?.id ?? step?.id ?? condition?.id ?? block?.id ?? handoff?.id ?? null
  const hasItemView = selectedBranchId != null
  const [inspectorState, setInspectorState] = useState<{
    view: 'totals' | 'item'
    branchId: string | null
  }>({ view: 'totals', branchId: null })

  const nextInspectorState = selectedBranchId !== inspectorState.branchId
    ? {
      branchId: selectedBranchId,
      view: selectedBranchId ? 'item' as const : 'totals' as const,
    }
    : inspectorState

  if (nextInspectorState !== inspectorState) {
    setInspectorState(nextInspectorState)
  }

  const activeView = showTotalsView
    ? hasItemView ? nextInspectorState.view : 'totals'
    : 'item'
  /*
    the draft is keyed by the block it belongs to, so selecting another node
    drops it without an effect having to clear it.
  */
  const [rename, setRename] = useState<{ id: string; draft: string } | null>(null)
  const renameId = note?.id ?? (block && block.type !== 'setup' ? block.id : null)
  const renaming = renameId && rename?.id === renameId ? rename : null
  const ownerId = step?.memberId
    ?? (condition?.owner.kind === 'member' ? condition.owner.memberId : undefined)
  const owner = members.find((entry) => entry.id === ownerId) ?? member
  const damage = step && !step.disabled && stepHasRun(step, run) ? stepDamageAt(step, run) : 0
  const sharePct = totalAvg > 0 ? (damage / totalAvg) * 100 : 0
  const conditionWrite = condition
    ? condition.byRun?.[run] ?? {
      from: condition.from,
      to: condition.to,
      rising: condition.rising,
    }
    : null
  /*
    a condition is identified by where its state comes from, not by who is
    holding the field, so the head takes the source's own asset and falls back
    to the owner only when the source has none. it carries no attribute icon
    either: a state deals no damage, so it has no element.
  */
  const isCond = Boolean(condition)
  /*
    an echo attack belongs to the echo and to the resonator: the list draws the
    echo, so the head draws it too and notches the caster into it rather than
    showing one in place of the other.
  */
  const echo = step?.owner.kind === 'echo' ? getEchoById(step.owner.echoId) : null
  const echoId = step?.owner.kind === 'echo' ? step.owner.echoId : null
  // a modifier writes the rotation's own formula, so no resonator owns it
  const isModifierCond = condition?.state?.ownerKey === ROT_FORMULA_OWNER_KEY
  const handoffTo = handoff ? members.find((entry) => entry.id === handoff.to) : undefined
  const handoffFrom = handoff ? members.find((entry) => entry.id === handoff.from) : undefined
  // a block has no asset at all: it is a shape, so it gets a drawn mark
  const BlockIcon = block ? BLOCK_ICON[block.type] : null
  const isTotals = showTotalsView && activeView === 'totals'
  const itemNodeType = step?.sourceNode?.type
    ?? condition?.sourceNode?.type
    ?? block?.sourceNode?.type
    ?? (note ? 'note' : step ? 'feature' : condition ? 'condition' : handoff ? 'handoff' : block?.type)
  const itemTabLabel = selection
    ? 'Selection'
    : itemNodeType
    ? `${itemNodeType.charAt(0).toUpperCase()}${itemNodeType.slice(1)}`
    : 'Node'
  const headIcon = condition ? condition.sourceIcon ?? owner.profile : owner.profile
  const headAlt = condition
    ? condition.effectName ?? condition.sourceName ?? owner.name
    : owner.name
  const stepElement = step?.element ?? owner.attribute
  const elementIcon = isCond || note || block || handoff ? null : getAttributeIconSrc(stepElement)
  const commitRename = () => {
    if (renaming) {
      if (note) {
        noteActions?.onLabel(renaming.draft)
      } else {
        blockActions.onRename(renaming.draft)
      }
    }
    setRename(null)
  }
  const panelAccent = selection
    ? 'var(--accent)'
    : isModifierCond
    ? 'var(--accent)'
    : handoff
    ? handoffTo ? ATTR_COLORS[handoffTo.attribute] : 'var(--accent)'
    : note
    ? note.color ?? ROT_NOTE_COLORS[0]
    : block
    ? block.color ?? (block.type === 'loop' ? ROT_LOOP_COLORS[0] : ROT_BLOCK_COLORS[0])
    : step?.color ?? ATTR_COLORS[step ? stepElement : owner.attribute]

  /*
    the bookmark and the pip sit outside this panel but belong to it, so the
    colour it took has to travel back up to the page that draws them.
  */
  useEffect(() => {
    onAccent?.(panelAccent)
  }, [onAccent, panelAccent])

  return (
    /*
      the panel takes the accent of the thing being inspected: a block's own
      colour, or the element a step actually deals,
      which is not always its caster's.
    */
    <aside
      ref={panelRef}
      className={`rte-inspector${open ? ' is-out' : ''}`}
      inert={!open}
      style={{
        '--rte-res': panelAccent,
        ...(step?.aggregationType && step.aggregationType !== 'damage'
          ? { '--avg': panelAccent }
          : {}),
      } as React.CSSProperties}
    >
      <div className="rte-inspector__head">
        {/* the palette's mode strip, doing the same job here */}
        {showTotalsView && hasItemView ? (
          <div className="rte-palette__modes" role="tablist" aria-label="Inspector view">
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'totals'}
              className={activeView === 'totals' ? 'is-on' : undefined}
              onClick={() => setInspectorState((state) => ({ ...state, view: 'totals' }))}
            >
              Totals
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeView === 'item'}
              className={activeView === 'item' ? 'is-on' : undefined}
              onClick={() => setInspectorState((state) => ({ ...state, view: 'item' }))}
            >
              {itemTabLabel}
            </button>
          </div>
        ) : null}

        {/*
          a handoff has no single subject, so its head is the pair: the one
          walking off, the arrow, and the one taking the field, whose name is
          the title.
        */}
        {selection && !isTotals ? null : !isTotals && handoff ? (
          <div className="rte-inspector__top rte-hoff__top">
            <img className="rte-hoff__top-out"
              src={handoffFrom?.profile ?? ''}
              alt=""
              title={handoffFrom?.name}
              onError={withDefResMg}
              loading="lazy"
            />
            <ArrowRight className="rte-hoff__top-arw" size="0.85rem" aria-hidden="true" />
            <img className="rte-hoff__top-in"
              src={handoffTo?.profile ?? ''}
              alt=""
              title={handoffTo?.name}
              onError={withDefResMg}
              loading="lazy"
            />
            <span className="rte-inspector__titles">
              <b>{handoffTo?.name ?? handoff.to}</b>
              <em className="rte-hoff__top-from">from {handoffFrom?.name ?? handoff.from}</em>
            </span>
          </div>
        ) : (
        <div className="rte-inspector__top">
          {note ? (
            <span className="rte-inspector__avatar is-block" aria-hidden="true">
              <MessageSquareText size="1rem" />
            </span>
          ) : BlockIcon ? (
            <span className="rte-inspector__avatar is-block" aria-hidden="true">
              <BlockIcon size="1rem" />
            </span>
          ) : isTotals ? (
            <span className="rte-inspector__avatar is-block" aria-hidden="true">
              <BarChart3 size="1rem" />
            </span>
          ) : echoId ? (
            <span className="rte-inspector__mark">
              <img className="rte-inspector__avatar"
                src={echo?.icon ?? `/assets/game/echoes/icons/${echoId}.webp`}
                alt=""
                title={echo?.name ?? 'Echo'}
                onError={withDefEchoMg}
                loading="lazy"
              />
              <img className="rte-inspector__caster"
                src={owner.profile}
                alt=""
                title={`Cast by ${owner.name}`}
                onError={withDefResMg}
                loading="lazy"
              />
            </span>
          ) : isModifierCond ? (
            /*
              a modifier belongs to the rotation's formula rather than to any
              resonator, so it takes a drawn mark the way a block does instead
              of borrowing a portrait it does not own.
            */
            <span className="rte-inspector__avatar is-block" aria-hidden="true">
              <Swords size="1rem" />
            </span>
          ) : (
            <img
              className={`rte-inspector__avatar${isCond ? ' is-source' : ''}`}
              src={headIcon}
              alt=""
              title={headAlt}
              onError={isCond ? withDefIconM : withDefResMg}
              loading="lazy"
            />
          )}
          <span className="rte-inspector__titles">
            {/* every authored container carries its own name */}
            {!isTotals && renaming ? (
              <input
                type="text" className="rte-inspector__rename"
                value={renaming.draft}
                autoFocus
                aria-label={note ? 'Note name' : 'Block name'}
                placeholder={note ? 'Note name' : 'Block name'}
                onChange={(event) => setRename({ id: renaming.id, draft: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitRename()
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setRename(null)
                  }
                }}
                onBlur={commitRename}
              />
            ) : (
              <b>{isTotals
                ? 'Rotation totals'
                : note
                  ? note.label ?? 'Note'
                  : step?.label ?? condition?.label ?? block?.label ?? 'Nothing selected'}</b>
            )}
          </span>
          {!isTotals && renameId && !renaming ? (
            <button
              type="button" className="rte-inspector__rename-btn"
              title={note ? 'Rename note' : 'Rename block'}
              aria-label={note ? 'Rename note' : 'Rename block'}
              onClick={() => setRename({
                id: renameId,
                draft: note?.label ?? block?.label ?? 'Note',
              })}
            >
              <SquarePen size="1.25rem" aria-hidden="true" />
            </button>
          ) : null}
          {!isTotals && elementIcon ? (
            <img className="rte-inspector__element"
              src={elementIcon}
              alt={stepElement}
              onError={withDefIconM}
              loading="lazy"
            />
          ) : null}
        </div>
        )}

        {selection && !isTotals ? (
          /*
            the count is the figure, and the bar under it is that count split
            by kind: the same measure read twice, once as a number and once as
            a proportion.
          */
          <>
            <div className="rte-figure rte-figure--sel">
              <b>{selection.count}</b>
              <span className="rte-figure__unit">selected</span>
            </div>
            {selection.count > 0 ? (
              <div className="rte-selsum__bar" aria-hidden="true">
                {selection.tallies.map((tally, index) => (
                  <i
                    key={tally.label}
                    style={{
                      flexGrow: tally.count,
                      '--rte-tone': selectionTone(index),
                    } as React.CSSProperties}
                  />
                ))}
              </div>
            ) : null}
          </>
        ) : isTotals ? (
          <div className="rte-figure">
            <b>{formatDamage(summary.total.avg, decimals)}</b>
            <span className="rte-figure__unit">avg</span>
            <span className="rte-figure__share">
              {summary.counts.damage} {summary.counts.damage === 1 ? 'damage row' : 'damage rows'}
            </span>
            <SupportReadings totals={summary.supportTotals} decimals={decimals} />
          </div>
        ) : note ? (
          <div className="rte-figure rte-figure--state">
            <b>{note.text.trim() ? note.text.trim().split(/\s+/).length : 0}</b>
            <span className="rte-figure__unit">
              {note.text.trim().split(/\s+/).filter(Boolean).length === 1 ? 'word' : 'words'}
            </span>
            <span className="rte-figure__share">display only</span>
          </div>
        ) : block ? (
          <div className="rte-figure">
            <b>{formatDamage(blockTotal, decimals)}</b>
            <span className="rte-figure__unit">avg</span>
            <span className="rte-figure__share">
              {block.type === 'loop' && block.runs > 1
                ? `per run . ${blockSteps} ${blockSteps === 1 ? 'step' : 'steps'}`
                : `${blockSteps} ${blockSteps === 1 ? 'step' : 'steps'}`}
            </span>
          </div>
        ) : conditionWrite ? (
          <div className="rte-figure rte-figure--state">
            <b>{conditionWrite.to || '-'}</b>
            <span className="rte-figure__unit">now</span>
            {conditionWrite.from !== undefined ? (
              <span className="rte-figure__share">was {conditionWrite.from || '-'}</span>
            ) : null}
          </div>
        ) : handoff ? null : (
          <div className="rte-figure">
            <b>{formatDamage(damage, decimals)}</b>
            <span className="rte-figure__unit">avg</span>
            <span className="rte-figure__share">
              {step ? `${sharePct.toFixed(1)}%` : '-'}
            </span>
          </div>
        )}
      </div>

      <div className="rte-inspector__mid rte-scroll">
        {activeView === 'totals' ? (
          <RotationTotalsInspector summary={summary} members={members} decimals={decimals} />
        ) : selection ? (
          <SelectionInspector summary={selection} actions={selectionActions} />
        ) : (
          <>
            {block ? (
              <BlockInspector
                node={block}
                body={blockBody}
                run={run}
                runTotals={blockRunTotals}
                shut={blockShut}
                decimals={decimals}
                onRunChange={onRunChange}
                actions={blockActions}
                onSelectNode={(id) => onNavigateNode({ nodeId: id })}
              />
            ) : null}

            {handoff ? (
              <HandoffInspector
                node={handoff}
                run={run}
                members={members}
                history={history}
                runsByLoopId={runsByLoopId}
                loopColors={loopColors}
                actions={handoffActions}
                onNavigateNode={onNavigateNode}
              />
            ) : null}

            {condition ? (
              <CondInspector
                node={condition}
                run={run}
                history={history}
                modifierOptions={modifierOptions}
                runsByLoopId={runsByLoopId}
                loopColors={loopColors}
                actions={condActions}
                onNavigateNode={onNavigateNode}
              />
            ) : null}

            {step ? (
              <>
                <NodeActions step={step} run={run} actions={actions} />
                <NegEffectSeries step={step} actions={actions} />
                <AttachedWrites actions={actions} />
                <FeatureOccurrences
                  step={step}
                  occurrences={featureOccurrences}
                  scope={actions.scope}
                  runsByLoopId={runsByLoopId}
                  loopColors={loopColors}
                  onNavigateNode={onNavigateNode}
                />
              </>
            ) : null}

            {/* every node that can own a note offers the same one place to write it */}
            {noteActions ? <NoteSect {...noteActions} /> : null}

            {note || condition || block || handoff ? null : (
            <InspectorSection label={<>Buffs applied . {buffs.length}</>}>
              {/* the count comes from what actually resolved for this row, not from
                  a field on the node: the node has no idea what applies to it */}
              {step && buffs.length > 0 ? (
                <BuffRows buffs={buffs} />
              ) : (
                <p className="rte-palette__empty">
                  {step ? 'Nothing applies to this row.' : 'Pick a row to see what applies.'}
                </p>
              )}
            </InspectorSection>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

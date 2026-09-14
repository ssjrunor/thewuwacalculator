/*
  Author: Runor Ewhro
  Description: Owns program toolbar behavior and state transitions for the components module.
*/

import {
  type CSSProperties,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  CopyPlus,
  DecimalsArrowLeft,
  DecimalsArrowRight,
  Download,
  FolderInput,
  GitCompare,
  ListPlus,
  MessageSquarePlus,
  Microchip,
  PanelRight,
  Pencil,
  Percent,
  Play,
  Radio,
  RadioOff,
  Redo2,
  RotateCwSquare,
  Save,
  Settings,
  Share2,
  SquareDashedMousePointer,
  Undo2,
  Columns4,
  Columns3,
  Workflow,
  ListOrdered
} from '@/shared/ui/LucideMotionIcons.ts'
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  Clock,
  Command,
  CornerDownLeft,
  LayoutList,
  List,
  ListFilter,
  Scale,
  Swords,
  TestTubes,
  Timer,
  Trash2,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { LuListTree } from 'react-icons/lu'
import { PiBroom } from 'react-icons/pi'
import type { UiState } from '@/domain/entities/appState.ts'
import {
  AnchoredAppPopup,
  AppPopupHeader,
  useAppPopupDismiss,
} from '@/shared/ui/AppPopup.tsx'
import type { RotationEditorPreferences } from '@/domain/entities/rotationEditorPreferences.ts'
import { LiquidSelect, type SelectOption } from '@/shared/ui/LiquidSelect.tsx'
import { ColumnsMenu } from './ColumnsMenu.tsx'
import { NodeSearch, type NodeSearchProps } from './NodeSearch.tsx'
import {
  DAMAGE_DECIMALS,
  statCeiling,
  type StatKey,
} from '@/modules/simulation/features/rotation/program-editor/presentation/registerRows.ts'
import type { SavedListView } from '@/modules/simulation/features/rotation/program-editor/presentation/savedRotationList.ts'
import {useAppStore} from "@/domain/state/store.ts";

type Surface = 'editor' | 'saved'
type SavedPreferences = Pick<
  UiState['savedRotationPreferences'],
  'sortBy' | 'sortOrder' | 'contributionFilter' | 'showLiveRotation'
>
type SavedSortKey = SavedPreferences['sortBy']
type SavedContributionFilter = SavedPreferences['contributionFilter']

interface EditorBarActions {
  /** rows are standing beside the one being read */
  comparing: boolean

  canCompare: boolean
  onCompare: () => void
  canUndo: boolean
  canRedo: boolean
  canClear: boolean
  canSave: boolean
  canShare: boolean
  canCollapse: boolean
  canExpand: boolean
  selectionMode: boolean
  appendOptions: SelectOption<string>[]
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onSave: () => void
  onShare: () => void
  onCollapse: () => void
  onExpand: () => void
  onPreamble: () => void
  onAddLoop: () => void
  onAddBlock: () => void
  onAddNote: () => void
  onToggleSelection: () => void
  onAppend: (value: string) => void
  /**
   * Rows the last run left doing nothing, which the sweep would take. Null
   * while the tree is not the one that ran, since nothing has judged it yet.
   */
  cleanCount: number | null
  onClean: () => void
}

interface SavedBarActions {
  prefs: SavedPreferences
  view: SavedListView
  query: string
  count: number
  selectedName: string | null
  selectedRate: string | null
  selectionMode: boolean
  canLoad: boolean
  canEdit: boolean
  canDuplicate: boolean
  canShare: boolean
  canDelete: boolean
  canCollapse: boolean
  canExpand: boolean
  /** takes are already standing beside each other */
  comparing: boolean
  canCompare: boolean
  onPrefs: (patch: Partial<SavedPreferences>) => void
  onView: (view: SavedListView) => void
  onQuery: (query: string) => void
  onImport: () => void
  onPaste: () => void
  onLoad: () => void
  onEdit: () => void
  onToggleSelection: () => void
  onCompare: () => void
  onDuplicate: () => void
  onShare: () => void
  onDelete: () => void
  onCollapse: () => void
  onExpand: () => void
}

interface DisplayBarActions {
  statKeys: readonly StatKey[]
  onStatKeys: (value: readonly StatKey[]) => void
  onDockPane: (value: boolean) => void
  onSettings: () => void
}

interface RunBarAction {
  dirty: boolean
  armed: boolean
  onRun: () => void
}

interface RotationProgramToolbarProps {
  surface: Surface
  lastSavedView: 'list' | 'groups'
  onSurface: (view: RotationEditorPreferences['savedView']) => void
  editor: EditorBarActions
  saved: SavedBarActions
  search: NodeSearchProps
  display: DisplayBarActions
  run: RunBarAction
}

function MotionTool({
  label,
  Icon,
  disabled = false,
  pressed,
  danger = false,
  keepSelection = false,
  onClick,
}: {
  label: string
  Icon: typeof Save
  disabled?: boolean
  pressed?: boolean
  danger?: boolean
  keepSelection?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      className={`rte-tool${pressed ? ' is-on' : ''}${danger ? ' rte-tool__danger' : ''}`}
      data-motion-icon-group=""
      data-selection-keep={keepSelection ? '' : undefined}
      aria-pressed={pressed}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size="0.86rem" mode="signature" trigger="parent-hover" aria-hidden="true" />
    </button>
  )
}

function SurfaceTools({
  surface,
  lastSavedView,
  onSurface,
}: Pick<RotationProgramToolbarProps, 'surface' | 'lastSavedView' | 'onSurface'>) {
  return (
    <span className="rte-deck" role="group" aria-label="Rotation view">
      <button
        type="button"
        className={`rte-tool${surface === 'editor' ? ' is-on' : ''}`}
        aria-pressed={surface === 'editor'}
        title="Rotation"
        aria-label="Rotation"
        onClick={() => onSurface('off')}
      >
        <TestTubes size="0.86rem" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`rte-tool${surface === 'saved' ? ' is-on' : ''}`}
        aria-pressed={surface === 'saved'}
        title="Saved rotations"
        aria-label="Saved rotations"
        onClick={() => onSurface(lastSavedView)}
      >
        <Scale size="0.86rem" aria-hidden="true" />
      </button>
    </span>
  )
}

function DocumentTools({
  surface,
  editor,
  saved,
}: Pick<RotationProgramToolbarProps, 'surface' | 'editor' | 'saved'>) {
  const archive = surface === 'saved'

  return (
    <span className="rte-deck" role="group" aria-label={archive ? 'Saved rotation actions' : 'Rotation actions'}>
      <MotionTool
        label={archive ? 'Saved-list undo is not available yet' : 'Undo the last edit'}
        Icon={Undo2}
        disabled={archive || !editor.canUndo}
        onClick={editor.onUndo}
      />
      <MotionTool
        label={archive ? 'Saved-list redo is not available yet' : 'Redo the last edit'}
        Icon={Redo2}
        disabled={archive || !editor.canRedo}
        onClick={editor.onRedo}
      />
      <i className="rte-pipe" aria-hidden="true" />
      <MotionTool
        label="Save the live advanced rotation"
        Icon={Save}
        disabled={!editor.canSave}
        onClick={editor.onSave}
      />
      <MotionTool label="Import a rotation" Icon={Download} onClick={saved.onImport} />
      <MotionTool
        label={archive
          ? saved.selectedName
            ? `Share or export ${saved.selectedName}`
            : 'Select a saved rotation to share or export'
          : editor.canShare
            ? 'Share or export the current rotation'
            : 'Run the current rotation before sharing'}
        Icon={Share2}
        disabled={archive ? !saved.canShare : !editor.canShare}
        keepSelection={archive && saved.selectionMode}
        onClick={archive ? saved.onShare : editor.onShare}
      />
      <button
        type="button" className="rte-tool rte-tool__danger"
        title={archive
          ? saved.selectedName
            ? `Delete ${saved.selectedName}`
            : 'Select a saved rotation to delete'
          : 'Clear this rotation'}
        aria-label={archive ? 'Delete the selected saved rotation' : 'Clear this rotation'}
        data-selection-keep={archive && saved.selectionMode ? '' : undefined}
        disabled={archive ? !saved.canDelete : !editor.canClear}
        onClick={archive ? saved.onDelete : editor.onClear}
      >
        <Trash2 size="0.86rem" aria-hidden="true" />
      </button>
    </span>
  )
}

function FeatureTools({ editor }: Pick<RotationProgramToolbarProps, 'editor'>) {
  return (
    <span className="rte-feature-tools" role="group" aria-label="Rotation node actions">
      <MotionTool
        label="Generate the preamble"
        Icon={Microchip}
        onClick={editor.onPreamble}
      />
      <MotionTool
        label="Add an empty loop"
        Icon={RotateCwSquare}
        disabled={editor.selectionMode}
        onClick={editor.onAddLoop}
      />
      <button
        type="button" className="rte-tool"
        title="Add an empty block"
        aria-label="Add an empty block"
        disabled={editor.selectionMode}
        onClick={editor.onAddBlock}
      >
        <LuListTree size="0.86rem" aria-hidden="true" />
      </button>
      <MotionTool
        label="Add a note"
        Icon={MessageSquarePlus}
        disabled={editor.selectionMode}
        onClick={editor.onAddNote}
      />
      <MotionTool
        label={editor.selectionMode ? 'Exit selection mode' : 'Select rotation nodes'}
        Icon={SquareDashedMousePointer}
        pressed={editor.selectionMode}
        keepSelection
        onClick={editor.onToggleSelection}
      />
      <LiquidSelect className="rte-append"
        value=""
        options={editor.appendOptions}
        disabled={editor.appendOptions.length === 0}
        ariaLabel="Append a rotation"
        motionIconGroup
        renderTrigger={() => (
          <ListPlus size="0.86rem" mode="signature" trigger="parent-hover" aria-hidden="true" />
        )}
        onChange={editor.onAppend}
      />
      <MotionTool
        label="Collapse every block"
        Icon={ChevronsDownUp}
        disabled={!editor.canCollapse}
        onClick={editor.onCollapse}
      />
      <MotionTool
        label="Expand every block"
        Icon={ChevronsUpDown}
        disabled={!editor.canExpand}
        onClick={editor.onExpand}
      />
    </span>
  )
}

interface SavedMenuOption<Key extends string> {
  key: Key
  label: string
  hint: string
  Icon: LucideIcon
}

const SORT_TOOLS: SavedMenuOption<SavedSortKey>[] = [
  { key: 'date', label: 'Date saved', hint: 'Sort by when it was saved', Icon: Clock },
  { key: 'name', label: 'Name', hint: 'Sort by name', Icon: ArrowDownAZ },
  { key: 'avg', label: 'Average damage', hint: 'Sort by average damage', Icon: Swords },
  { key: 'dps', label: 'DPS', hint: 'Sort by DPS', Icon: Timer },
]

const CONTRIBUTION_FILTER_TOOLS: SavedMenuOption<SavedContributionFilter>[] = [
  { key: 'unset', label: 'Unset', hint: 'Show every saved rotation', Icon: ListFilter },
  { key: 'solo', label: 'Solo', hint: 'Show rotations with one damage contributor', Icon: UserRound },
  { key: 'duo', label: 'Duo', hint: 'Show rotations with two damage contributors', Icon: UsersRound },
  { key: 'trio', label: 'Trio', hint: 'Show rotations with three damage contributors', Icon: Users },
]

function SavedToolbarMenu<Key extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: Key
  options: readonly SavedMenuOption<Key>[]
  label: string
  onChange: (value: Key) => void
}) {
  const [open, setOpen] = useState(false)
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)
  const active = options.find(({ key }) => key === value) ?? options[0]!
  const ActiveIcon = active.Icon

  useAppPopupDismiss({
    open,
    onDismiss: () => setOpen(false),
    hostRef,
    popupRef,
    returnFocusRef: triggerRef,
    pointerEvent: 'mousedown',
  })

  return (
    <span className="rte-cm" ref={hostRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`rte-tool${open ? ' is-on' : ''}`}
        aria-expanded={open}
        aria-haspopup="menu"
        title={active.hint}
        aria-label={`${active.hint}. Choose ${label.toLowerCase()}`}
        onClick={() => setOpen((value) => !value)}
      >
        <ActiveIcon size="0.86rem" aria-hidden="true" />
      </button>

      <AnchoredAppPopup
        visible={open}
        anchorRef={triggerRef}
        popupRef={popupRef}
        align="end"
        preferredPlacement="down" className="rte-choice__drop"
        open={open}
        role="menu"
        aria-label={label}
      >
        <AppPopupHeader>{label}</AppPopupHeader>
        <div className="rte-choice__options">
          {options.map(({ key, label: optionLabel, hint, Icon }) => {
            const selected = value === key
            return (
              <button
                key={key}
                type="button"
                className={`rte-choice__option${selected ? ' is-on' : ''}`}
                role="menuitemradio"
                aria-checked={selected}
                title={hint}
                onClick={() => {
                  onChange(key)
                  setOpen(false)
                }}
              >
                <Icon size="1em" aria-hidden="true" />
                <span>{optionLabel}</span>
              </button>
            )
          })}
        </div>
      </AnchoredAppPopup>
    </span>
  )
}

function SavedRotationListTools({ saved }: Pick<RotationProgramToolbarProps, 'saved'>) {
  const ascending = saved.prefs.sortOrder === 'asc'
  const Order = ascending ? ArrowUpNarrowWide : ArrowDownWideNarrow

  return (
    <>
      <span className="rte-deck" role="group" aria-label="Saved rotation layout">
        <button
          type="button"
          className={`rte-tool${saved.view === 'list' ? ' is-on' : ''}`}
          aria-pressed={saved.view === 'list'}
          title="One row per saved rotation"
          aria-label="List view"
          onClick={() => saved.onView('list')}
        >
          <List size="0.86rem" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`rte-tool${saved.view === 'groups' ? ' is-on' : ''}`}
          aria-pressed={saved.view === 'groups'}
          title="Grouped by the resonator each was written for"
          aria-label="Grouped view"
          onClick={() => saved.onView('groups')}
        >
          <LayoutList size="0.86rem" aria-hidden="true" />
        </button>
      </span>
      {saved.view === 'groups' ? (
        <span className="rte-deck" role="group" aria-label="Saved rotation group disclosure">
          <MotionTool
            label="Collapse every block"
            Icon={ChevronsDownUp}
            disabled={!saved.canCollapse}
            onClick={saved.onCollapse}
          />
          <MotionTool
            label="Expand every block"
            Icon={ChevronsUpDown}
            disabled={!saved.canExpand}
            onClick={saved.onExpand}
          />
        </span>
      ) : null}
      <span className="rte-deck" role="group" aria-label="Saved rotation order">
        <SavedToolbarMenu
          value={saved.prefs.contributionFilter}
          options={CONTRIBUTION_FILTER_TOOLS}
          label="Feature contributors"
          onChange={(contributionFilter) => saved.onPrefs({ contributionFilter })}
        />
        <i className="rte-pipe" aria-hidden="true" />
        <SavedToolbarMenu
          value={saved.prefs.sortBy}
          options={SORT_TOOLS}
          label="Sort"
          onChange={(sortBy) => saved.onPrefs({ sortBy })}
        />
        <i className="rte-pipe" aria-hidden="true" />
        <button
          type="button" className="rte-tool"
          title={ascending ? 'Smallest first. Click for largest first' : 'Largest first. Click for smallest first'}
          aria-label="Reverse the order"
          onClick={() => saved.onPrefs({ sortOrder: ascending ? 'desc' : 'asc' })}
        >
          <Order size="0.86rem" aria-hidden="true" />
        </button>
      </span>
    </>
  )
}

/*
  The three that work the list rather than the rotation open in it: what a
  picked take can be turned into, what can be dropped in beside it, and how
  more than one is picked at once. They stand against the search because that
  is the end of the bar the list itself is handled from.
*/
function SavedRotationListEditTools({ saved }: Pick<RotationProgramToolbarProps, 'saved'>) {
  return (
    <span className="rte-feature-tools" role="group" aria-label="Saved entry actions">
      <MotionTool
        label={saved.selectedName ? `Duplicate ${saved.selectedName}` : 'Select a saved rotation to duplicate'}
        Icon={CopyPlus}
        disabled={!saved.canDuplicate}
        keepSelection={saved.selectionMode}
        onClick={saved.onDuplicate}
      />
      <MotionTool
        label="Paste saved rotations"
        Icon={ClipboardPaste}
        onClick={saved.onPaste}
      />
      <MotionTool
        label={saved.selectedName ? `Load ${saved.selectedName} into the editor` : 'Select a saved rotation to load'}
        Icon={FolderInput}
        disabled={!saved.canLoad}
        onClick={saved.onLoad}
      />
      <MotionTool
        label={saved.selectedName ? `Edit ${saved.selectedName}` : 'Select a saved rotation to edit'}
        Icon={Pencil}
        disabled={!saved.canEdit}
        onClick={saved.onEdit}
      />
      <MotionTool
        label={saved.selectionMode ? 'Exit saved rotation selection' : 'Select saved rotations'}
        Icon={SquareDashedMousePointer}
        pressed={saved.selectionMode}
        keepSelection
        onClick={saved.onToggleSelection}
      />
    </span>
  )
}

/*
  It stands against the search because both work the rotation that is open
  rather than the document: one finds a row in it, the other takes out the rows
  the last run showed were carrying nothing. With nothing to sweep it has
  nothing to say, so it goes quiet rather than prompting for an empty edit.
*/
function CleanTool({ editor }: Pick<RotationProgramToolbarProps, 'editor'>) {
  const count = editor.cleanCount
  const label = count === null
    ? 'Run the rotation before sweeping no-op nodes'
    : count > 0
      ? `Sweep ${count} unused ${count === 1 ? 'row' : 'rows'}`
      : 'No unused rows to sweep'

  return (
    <button
      type="button" className="rte-tool"
      title={label}
      aria-label={label}
      disabled={count === null || count === 0}
      onClick={editor.onClean}
    >
      <PiBroom size="0.86rem" aria-hidden="true" />
    </button>
  )
}

function SearchMark({ open }: { open: boolean }) {
  return (
    <svg className="rte-search__mk" viewBox="0 0 24 24" aria-hidden="true">
      <circle className="rte-search__lens" cx="11" cy="11" r="8" />
      <path className="rte-search__bar" d="M21 21 L6 6" pathLength="100" />
      <path className="rte-search__cut" d="M18 6 L6 18" pathLength="100" />
      <title>{open ? 'Close search' : 'Search saved rotations'}</title>
    </svg>
  )
}

function SavedRotationListSearch({ saved }: Pick<RotationProgramToolbarProps, 'saved'>) {
  const [open, setOpen] = useState(false)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const toggleRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onQuery = saved.onQuery

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      const target = event.target as Node
      if (hostRef.current?.contains(target) || toggleRef.current?.contains(target)) return
      setOpen(false)
      onQuery('')
    }
    document.addEventListener('mousedown', away, true)
    return () => document.removeEventListener('mousedown', away, true)
  }, [onQuery, open])

  const close = () => {
    setOpen(false)
    onQuery('')
  }

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className={`rte-tool rte-search${open ? ' is-on' : ''}`}
        aria-pressed={open}
        title={open ? 'Stop searching' : 'Find a saved rotation'}
        aria-label="Find a saved rotation"
        onClick={() => open ? close() : setOpen(true)}
      >
        <SearchMark open={open} />
      </button>
      <div ref={hostRef} className={`rte-read${open ? ' is-find' : ''}`}>
        <button type="button" className="rte-read__face" disabled>
          <i className="rte-read__dot" aria-hidden="true" />
          <span className="rte-read__name">{saved.selectedName ?? 'no selection'}</span>
          <span className="rte-spacer" />
          <span className="rte-read__ms">{saved.selectedRate ?? `${saved.count} saved`}</span>
        </button>
        <div className="rte-read__find" role="search">
          <input
            ref={inputRef}
            type="text" className="rte-find__input"
            value={saved.query}
            placeholder="find a saved rotation or resonator"
            autoComplete="off"
            spellCheck={false}
            tabIndex={open ? undefined : -1}
            onChange={(event) => saved.onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
          />
        </div>
      </div>
    </>
  )
}

function SavedRotationLiveTool({ saved }: Pick<RotationProgramToolbarProps, 'saved'>) {
  const shown = saved.prefs.showLiveRotation

  return (
    <MotionTool
      label={shown ? 'Hide live rotation' : 'Show live rotation'}
      Icon={shown ? Radio : RadioOff}
      pressed={shown}
      onClick={() => saved.onPrefs({ showLiveRotation: !shown })}
    />
  )
}

function DisplayTools({
  surface,
  display,
  editor,
  saved,
}: Pick<RotationProgramToolbarProps, 'surface' | 'display' | 'editor' | 'saved'>) {
  const archive = surface === 'saved'
  const decimals = useAppStore((state) => state.ui.rotationEditorPreferences.decimals)
  const percentDisplay = useAppStore(
    (state) => state.ui.rotationEditorPreferences.percentDisplay,
  )
  const dockPane = useAppStore((state) => state.ui.rotationEditorPreferences.dockPane)
  const groupOrder = useAppStore((state) => state.ui.rotationEditorPreferences.groupOrder)
  const setEditorPreferences = useAppStore((state) => state.setRotEditorPrefs)
  const setRotPrefs = useAppStore((store) => store.setRotPrefs)
  const scaleToSelected = useAppStore(
    (store) => store.ui.savedRotationPreferences.scaleToSelected,
  )
  const view = useAppStore((state) => state.ui.rotationEditorPreferences.view)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const decimalIndex = DAMAGE_DECIMALS.indexOf(decimals)
  const ceiling = statCeiling(dockPane)

  return (
    <>
      {!archive ? (
        <span className="rte-deck" role="group" aria-label="Rotation reading">
          <button
          type="button"
          className={`rte-tool${view === 'tree' ? ' is-on' : ''}`}
          aria-pressed={view === 'tree'}
          disabled={archive}
          title="Tree node view"
          aria-label="Tree node view"
          onClick={() => setEditorPreferences({ view: 'tree' })}
        >
          <Workflow size="0.86rem" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`rte-tool${view === 'flat' ? ' is-on' : ''}`}
          aria-pressed={view === 'flat'}
          disabled={archive}
          title="Run order view"
          aria-label="Run order view"
          onClick={() => setEditorPreferences({ view: 'flat' })}
        >
          <ListOrdered size="0.86rem" aria-hidden="true" />
        </button>
      </span>
      ) : null}


      <span className="rte-steps" aria-label="Damage decimal places">
        <button
          type="button"
          data-motion-icon-group=""
          disabled={decimals === DAMAGE_DECIMALS[0]}
          aria-label="Fewer decimal places"
          title="Fewer decimal places"
          onClick={() => setEditorPreferences({
            decimals: DAMAGE_DECIMALS[Math.max(0, decimalIndex - 1)] ?? decimals,
          })}
        >
          <DecimalsArrowLeft size="0.6rem" mode="signature" trigger="parent-hover" aria-hidden="true" />
        </button>
        <samp>{decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`}</samp>
        <button
          type="button"
          data-motion-icon-group=""
          disabled={decimals === DAMAGE_DECIMALS[DAMAGE_DECIMALS.length - 1]}
          aria-label="More decimal places"
          title="More decimal places"
          onClick={() => setEditorPreferences({
            decimals: DAMAGE_DECIMALS[Math.min(
              DAMAGE_DECIMALS.length - 1,
              decimalIndex + 1,
            )] ?? decimals,
          })}
        >
          <DecimalsArrowRight size="0.6rem" mode="signature" trigger="parent-hover" aria-hidden="true" />
        </button>
      </span>
      {!archive && (
        <MotionTool
          label={percentDisplay === 'percent'
            ? 'Show multiplicative values as factors'
            : 'Show multiplicative values as percentages'}
          Icon={Percent}
          pressed={percentDisplay === 'percent'}
          onClick={() => setEditorPreferences({
            percentDisplay: percentDisplay === 'percent' ? 'factor' : 'percent',
          })}
        />
      )}
      {/*
        both surfaces compare, and each stands its own things beside each
        other: takes on the archive, rows in the editor. the tool is one
        control either way, disabled until there is something to read the rest
        against.
      */}
      <MotionTool
        label={archive
          ? saved.comparing ? 'Stop comparing' : 'Compare'
          : editor.comparing ? 'Stop comparing' : 'Compare'}
        Icon={GitCompare}
        disabled={archive
          ? !saved.comparing && !saved.canCompare
          : !editor.comparing && !editor.canCompare}
        pressed={archive ? saved.comparing : editor.comparing}
        onClick={archive ? saved.onCompare : editor.onCompare}
      />
      {archive ? (
        <MotionTool
          label={!scaleToSelected ? 'Scale' : 'Don\'t scale'}
          Icon={!scaleToSelected ? Columns4 : Columns3}
          pressed={scaleToSelected}
          onClick={() => setRotPrefs((current) => ({
            ...current,
            scaleToSelected: !current.scaleToSelected,
          }))}
        />
        ) : (
        <ColumnsMenu
          open={archive ? false : columnsOpen}
          onOpenChange={setColumnsOpen}
          statKeys={display.statKeys}
          onStatKeys={display.onStatKeys}
          groupOrder={groupOrder}
          onGroupOrder={(value) => setEditorPreferences({ groupOrder: [...value] })}
          ceiling={ceiling}
          disabled={archive}
        />
      )}
      <MotionTool
        label={dockPane ? 'Let the side panel float over the list again' : 'Keep the side panel open beside the list'}
        Icon={PanelRight}
        pressed={dockPane}
        onClick={() => display.onDockPane(!dockPane)}
      />
      <MotionTool label="How the rotation is drawn and how an edit is taken" Icon={Settings} onClick={display.onSettings} />
    </>
  )
}

function RunTool({ run }: Pick<RotationProgramToolbarProps, 'run'>) {
  const enabled = run.dirty
  return (
    <button
      type="button"
      className={`rte-runbtn${enabled && run.armed ? ' is-armed' : ''}`}
      data-motion-icon-group={enabled ? '' : undefined}
      style={{ '--rte-creep': enabled ? '88%' : '0%' } as CSSProperties}
      disabled={!enabled}
      title={enabled ? 'Run the changed rotation' : 'Nothing to run'}
      onClick={run.onRun}
    >
      <Play
        size="0.64rem"
        fill="currentColor"
        mode="signature"
        trigger={enabled ? 'parent-hover' : 'manual'}
        aria-hidden="true"
      />
      run
      <span className="rte-runbtn__hint" aria-hidden="true">
        <Command size="0.62rem" />
        <CornerDownLeft size="0.62rem" />
      </span>
      <i className="rte-runbtn__creep" aria-hidden="true" />
    </button>
  )
}

export function RotationProgramToolbar(props: RotationProgramToolbarProps) {
  const { surface, editor, saved, search, display, run } = props

  return (
    <div className={`rte-bar rte-bar--${surface}`}>
      <SurfaceTools surface={surface} lastSavedView={props.lastSavedView} onSurface={props.onSurface} />

      <DocumentTools surface={surface} editor={editor} saved={saved} />

      {surface === 'editor' ? (
        <>
          <FeatureTools editor={editor} />
          <i className="rte-pipe" aria-hidden="true" />
        </>
      ) : null}
      {surface === 'saved' ? (
        <>
          <SavedRotationListEditTools saved={saved} />
          <SavedRotationListSearch saved={saved} />
          <SavedRotationLiveTool saved={saved} />
          <SavedRotationListTools saved={saved} />
        </>
      ) : (
        <>
          <NodeSearch {...search} />
          <CleanTool editor={editor} />
        </>
      )}
      <DisplayTools surface={surface} display={display} editor={editor} saved={saved} />
      {surface === 'editor' ? (
        <RunTool run={run} />
      ) : null}
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronDown, FileImage, Save, Trash2 } from 'lucide-react'
import type { EchoInstance, ResonatorRuntimeState } from '@/domain/entities/runtime'
import { areBuildSnapshotsEquivalent, areEchoInstancesEquivalent, cloneEchoLoadout } from '@/domain/entities/inventoryStorage'
import { getEchoById, listEchoes } from '@/domain/services/echoCatalogService'
import { getResonatorSeedById } from '@/domain/services/resonatorSeedService'
import { listStatesForSource } from '@/domain/services/gameDataService'
import { getMainEchoSourceRef } from '@/domain/services/runtimeSourceService'
import { getSonataSetName, getSonataSetIcon } from '@/data/gameData/catalog/sonataSets'
import { getEchoSetDef, getEchoSetControlKey } from '@/data/gameData/echoSets/effects'
import type { SetDef } from '@/data/gameData/echoSets/effects'
import { selectActiveTargetSelections } from '@/domain/state/selectors'
import { useAppStore } from '@/domain/state/store'
import { Expandable } from '@/shared/ui/Expandable'
import { RichDescription } from '@/shared/ui/RichDescription'
import { EchoPickerModal } from '@/modules/calculator/components/workspace/panes/left/modals/EchoPickerModal'
import { EchoEditModal } from '@/modules/calculator/components/inventory/modals/EchoEditModal'
import { EchoImageParserModal } from '@/modules/calculator/components/inventory/modals/EchoImageParserModal'
import { computeEchoCritValue, getCvBadgeClass, getScoreBadgeClass } from '@/modules/calculator/model/echoMetricBadges'
import {
  computeSetCounts,
  formatEchoStatLabel,
  formatEchoStatValue,
  getEchoStatIconUrl,
  makeDefaultEchoInstance,
} from '@/modules/calculator/model/echoPane'
import { computeTotalEchoCost } from '@/modules/calculator/model/echoes'
import {
  getEchoScorePercent,
  getBuildScorePercent,
  getMaxEchoScore,
  aggregateEchoStats,
} from '@/data/scoring/echoScoring'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { ConfirmationModal } from '@/shared/ui/ConfirmationModal'
import { useConfirmation } from '@/app/hooks/useConfirmation.ts'
import { SourceStateControl } from '@/modules/calculator/components/workspace/panes/left/controls/SourceStateControl'
import {
  getStateTeamTargetMode,
  getTeamTargetOptions,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { evaluateSourceStateVisibility } from '@/modules/calculator/model/sourceStateEvaluation'
import { hideBrokenImage } from '@/shared/lib/imageFallback'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { useToastStore } from '@/shared/util/toastStore.ts'
import { formatDescription } from '@/shared/lib/formatDescription'
import { IoArchive } from 'react-icons/io5'
import { RiDeleteBin2Fill } from 'react-icons/ri'

const MAX_COST = 12

// manages the echo list pane along with all picker and edit modals.
interface CalculatorEchoesPaneProps {
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
}

// stat icon component
function StatIcon({ statKey }: { statKey: string }) {
  const iconUrl = getEchoStatIconUrl(statKey)
  if (!iconUrl) return null
  return (
    <span
      className="echo-stat-icon-mask"
      style={{
        WebkitMaskImage: `url(${iconUrl})`,
        maskImage: `url(${iconUrl})`,
      }}
    />
  )
}

function EchoSlot({
  echo,
  index,
  score,
  canSave,
  showMainChevron = false,
  mainEchoExpanded = false,
  onToggleMainEcho,
  onOpenPicker,
  onOpenEdit,
  onRemove,
  onSave,
}: {
  echo: EchoInstance | null
  index: number
  score: number | null
  canSave: boolean
  isMainEcho?: boolean
  showMainChevron?: boolean
  mainEchoExpanded?: boolean
  onToggleMainEcho?: () => void
  onOpenPicker: () => void
  onOpenEdit: () => void
  onRemove: () => void
  onSave: () => void
}) {
  const definition = echo ? getEchoById(echo.id) : null
  const cost = definition?.cost ?? 0

  if (!echo || !definition) {
    return (
      <article className="echo-slot echo-slot--empty" onClick={onOpenPicker}>
        <div className="echo-slot-icon echo-slot-icon--empty">
          <span className="echo-slot-icon-plus">+</span>
        </div>
        <div className="echo-slot-info">
          <span className="echo-slot-label">Slot {index + 1}</span>
          <span className="echo-slot-hint">Tap to select</span>
        </div>
      </article>
    )
  }

  const setIcon = getSonataSetIcon(echo.set)
  const substatEntries = Object.entries(echo.substats)
  const cv = computeEchoCritValue(echo.substats)
  return (
    <article className="echo-slot">
      <div className="echo-slot-content">
        <div className="echo-slot-card">
          {/* ── Left column: identity ── */}
          <div className="echo-slot-left">
            <button type="button" className="echo-slot-icon" onClick={onOpenPicker}>
              <img
                src={definition.icon}
                alt={definition.name}
                className="echo-slot-icon-img"
                loading="lazy"
                decoding="async"
                onError={hideBrokenImage}
              />
            </button>

            <div className="echo-slot-identity">
              <div className="echo-slot-name-row">
                <span className="echo-slot-name">{definition.name}</span>
              </div>
              <div className="echo-slot-meta">
                {setIcon ? (
                  <img src={setIcon} alt={getSonataSetName(echo.set)} className="echo-slot-set-icon" loading="lazy" />
                ) : null}
                <span className="echo-slot-cost echo-score-badge">{cost}C</span>
                {echo.mainEcho ? <span className="echo-slot-badge echo-slot-badge--main">Main</span> : null}
                {score !== null ? (
                    <span className={getScoreBadgeClass(score)}>
                      {score.toFixed(1)}%
                    </span>
                ) : null}
              </div>
            </div>

            <div className="echo-slot-actions">
              {showMainChevron ? (
                  <button
                      type="button"
                      className={`echo-slot-action echo-slot-main-chevron${mainEchoExpanded ? ' echo-slot-main-chevron--open' : ''}`}
                      onClick={(e) => { e.stopPropagation(); onToggleMainEcho?.() }}
                      title="Toggle main echo details"
                  >
                    <ChevronDown size={14} />
                  </button>
              ) : null}
              <button
                type="button"
                className="echo-slot-action"
                title={canSave ? 'Save echo to bag' : 'This echo is already saved'}
                onClick={onSave}
                disabled={!canSave}
              >
                <IoArchive size={14} />
              </button>
              <button
                type="button"
                className="echo-slot-remove"
                title="Remove echo"
                onClick={onRemove}
              >
                <RiDeleteBin2Fill />
              </button>
            </div>
          </div>

          {/* ── Right column: stat card (clickable → opens edit modal) ── */}
          <div className="echo-stat-card" onClick={onOpenEdit} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenEdit() } }}>
            <div className="echo-stat-card-accent" />
            <div className="echo-stat-card-section echo-stat-card-section--main">
              <div className="echo-stat-primary">
                <StatIcon statKey={echo.mainStats.primary.key} />
                <span className="echo-stat-primary-label">{formatEchoStatLabel(echo.mainStats.primary.key)}</span>
                <span className="echo-stat-primary-value">{formatEchoStatValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}</span>
              </div>
              <div className="echo-stat-secondary">
                <StatIcon statKey={echo.mainStats.secondary.key} />
                <span className="echo-stat-secondary-label">{formatEchoStatLabel(echo.mainStats.secondary.key)}</span>
                <span className="echo-stat-secondary-value">{formatEchoStatValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}</span>
                <span className="echo-stat-secondary-tag">Fixed</span>
              </div>
            </div>

            {substatEntries.length > 0 ? (
              <div className="echo-stat-card-section echo-stat-card-section--subs">
                <div className="echo-stat-subs-header">
                  <span className="echo-stat-subs-title">Substats</span>
                  {cv > 0 ? (
                      <span className={getCvBadgeClass(cv)}>
                        CV {cv.toFixed(1)}
                      </span>
                  ) : null}
                </div>
                <div className="echo-stat-subs-list">
                  {substatEntries.map(([key, val]) => (
                    <div key={key} className="echo-stat-sub">
                      <StatIcon statKey={key} />
                      <span className="echo-stat-sub-label">{formatEchoStatLabel(key)}</span>
                      <span className="echo-stat-sub-value">{formatEchoStatValue(key, val)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="echo-stat-card-section echo-stat-card-section--subs echo-stat-card-section--empty">
                <span className="echo-stat-empty-hint">Tap to edit stats</span>
              </div>
            )}
          </div>
        </div>
      </div>

    </article>
  )
}

// ---------------------------------------------------------------------------
// EchoSetBonus
// ---------------------------------------------------------------------------

function EchoSetBonus({
  setId,
  count,
  runtime,
  onRuntimeUpdate,
  selectedTargetsByOwnerKey,
  setResonatorTargetSelection,
}: {
  setId: number
  count: number
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  selectedTargetsByOwnerKey: Record<string, string | null>
  setResonatorTargetSelection: (resonatorId: string, ownerKey: string, targetResonatorId: string | null) => void
}) {
  const def = getEchoSetDef(setId)
  if (!def) return null

  const minReq = def.setMax === 3 ? 3 : 2
  if (count < minReq) return null

  const icon = getSonataSetIcon(setId)
  const pieceReq = def.setMax === 3 ? 3 : 5
  const hasPieceReq = count >= pieceReq

  // Split parts into passive tiers and interactive state parts
  const passiveParts = def.parts.filter((part) => {
    const isPassive = part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
    if (!isPassive) return false
    if (part.key === 'twoPiece') return count >= 2
    return count >= pieceReq
  })

  const stateParts = def.parts.filter((part) => {
    const isPassive = part.key === 'twoPiece' || part.key === 'fivePiece' || part.key === 'threePiece'
    return !isPassive && hasPieceReq
  })

  // Piece tier labels
  const tierLabel = (key: string) => {
    if (key === 'twoPiece') return '2pc'
    if (key === 'threePiece') return '3pc'
    if (key === 'fivePiece') return '5pc'
    return ''
  }

  return (
    <div className="echo-set-bonus">
      {/* ── Header with icon + name + piece count indicator ── */}
      <div className="echo-set-bonus-header">
        <div className="echo-set-bonus-icon-wrap">
          {icon ? (
            <img src={icon} alt={def.name} className="echo-set-bonus-icon" loading="lazy" />
          ) : (
            <span className="echo-set-bonus-icon-fallback" />
          )}
        </div>
        <div className="echo-set-bonus-info">
          <span className="echo-set-bonus-name">{def.name}</span>
          <div className="echo-set-bonus-pips">
            {Array.from({ length: pieceReq }, (_, i) => (
              <span
                key={i}
                className={`echo-set-pip${i < count ? ' echo-set-pip--filled' : ''}`}
              />
            ))}
            <span className="echo-set-bonus-count">{count}/{pieceReq}</span>
          </div>
        </div>
      </div>

      {/* ── Passive tier bonuses ── */}
      {passiveParts.length > 0 ? (
        <div className="echo-set-bonus-tiers">
          {passiveParts.map((part) => (
            <div key={part.key} className="echo-set-tier">
              <span className="echo-set-tier-tag">{tierLabel(part.key)}</span>
              <RichDescription description={part.label} className="echo-set-tier-desc" unstyled />
            </div>
          ))}
        </div>
      ) : null}

      {/* ── Interactive state controls ── */}
      {stateParts.length > 0 ? (
        <div className="echo-set-bonus-controls">
          {stateParts.map((part) => (
            <EchoSetStatePart
              key={part.key}
              setDef={def}
              stateKey={part.key}
              label={part.label}
              trigger={part.trigger}
              runtime={runtime}
              onRuntimeUpdate={onRuntimeUpdate}
              selectedTargetsByOwnerKey={selectedTargetsByOwnerKey}
              setResonatorTargetSelection={setResonatorTargetSelection}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function EchoSetStatePart({
  setDef,
  stateKey,
  label,
  trigger,
  runtime,
  onRuntimeUpdate,
  selectedTargetsByOwnerKey,
  setResonatorTargetSelection,
}: {
  setDef: SetDef
  stateKey: string
  label: string
  trigger: string
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
  selectedTargetsByOwnerKey: Record<string, string | null>
  setResonatorTargetSelection: (resonatorId: string, ownerKey: string, targetResonatorId: string | null) => void
}) {
  const stateEntry = setDef.states[stateKey]
  if (!stateEntry) return null
  const sourceState = listStatesForSource('echoSet', String(setDef.id)).find((state) => state.id === stateKey) ?? null

  const ck = getEchoSetControlKey(setDef.id, stateKey)
  const currentValue = (runtime.state?.controls as Record<string, unknown> | undefined)?.[ck]
  const targetMode = sourceState ? getStateTeamTargetMode(sourceState) : null
  const targetOptions = sourceState && targetMode
    ? getTeamTargetOptions(runtime, runtime.id, targetMode)
    : []
  const currentTarget = sourceState
    ? selectedTargetsByOwnerKey[sourceState.ownerKey] ?? null
    : null
  const fallbackTarget = targetOptions[0]?.value ?? null
  const selectedTarget = (
    typeof currentTarget === 'string'
      && targetOptions.some((option) => option.value === currentTarget)
  )
    ? currentTarget
    : fallbackTarget

  const perStack = stateEntry.perStack ?? stateEntry.max
  const isToggle = perStack.every((ps, i) => ps.value === stateEntry.max[i].value)

  const updateControl = (value: boolean | number) => {
    onRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        controls: {
          ...(prev.state?.controls ?? {}),
          [ck]: value,
        },
      },
    }))
  }

  const updateSelectedTarget = (targetResonatorId: string | null) => {
    if (!sourceState) {
      return
    }
    setResonatorTargetSelection(runtime.id, sourceState.ownerKey, targetResonatorId)
  }

  const targetPills = targetOptions.length > 0 ? (
    <div className="echo-set-state-targets">
      <span className="echo-set-state-targets-label">Target</span>
      <div className="echo-set-state-targets-pills">
        {targetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={`echo-set-state-target-pill${option.value === selectedTarget ? ' echo-set-state-target-pill--active' : ''}`}
            onClick={() => updateSelectedTarget(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  ) : null

  if (isToggle) {
    const checked = Boolean(currentValue)
    return (
      <div className={`echo-set-state${checked ? ' echo-set-state--active' : ''}`}>
        <label className="echo-set-state-toggle">
          <input
            type="checkbox"
            checked={checked}
            onChange={() => updateControl(!checked)}
          />
          <span className="echo-set-state-switch" />
          <span
            className="echo-set-state-label"
            dangerouslySetInnerHTML={{ __html: formatDescription(label) }}
          />
        </label>
        {trigger ? (
          <span
            className="echo-set-state-trigger"
            dangerouslySetInnerHTML={{ __html: formatDescription(trigger) }}
          />
        ) : null}
        {targetPills}
      </div>
    )
  }

  // Stack control
  const maxStacks = Math.round(
    Math.max(...perStack.map((ps, i) => stateEntry.max[i].value / ps.value)),
  )
  const stackValue = typeof currentValue === 'number' ? currentValue : 0

  return (
    <div className={`echo-set-state${stackValue > 0 ? ' echo-set-state--active' : ''}`}>
      <div className="echo-set-state-stack">
        <span
          className="echo-set-state-label"
          dangerouslySetInnerHTML={{ __html: formatDescription(label) }}
        />
        <div className="echo-set-state-stack-control">
          {Array.from({ length: maxStacks + 1 }, (_, i) => (
            <button
              key={i}
              type="button"
              className={`echo-set-stack-btn${i === stackValue ? ' echo-set-stack-btn--active' : ''}`}
              onClick={() => updateControl(i)}
            >
              {i}
            </button>
          ))}
        </div>
      </div>
      {trigger ? (
        <span
          className="echo-set-state-trigger"
          dangerouslySetInnerHTML={{ __html: formatDescription(trigger) }}
        />
      ) : null}
      {targetPills}
    </div>
  )
}

// ---------------------------------------------------------------------------
// EchoTotals
// ---------------------------------------------------------------------------

const TOTALS_GROUPS: { label: string; keys: string[] }[] = [
  { label: 'Offense', keys: ['atkFlat', 'atkPercent', 'critRate', 'critDmg'] },
  { label: 'Defense', keys: ['hpFlat', 'hpPercent', 'defFlat', 'defPercent'] },
  { label: 'Utility', keys: ['energyRegen', 'healingBonus'] },
  { label: 'Attribute', keys: ['aero', 'glacio', 'electro', 'fusion', 'havoc', 'spectro'] },
  { label: 'Skill', keys: ['basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation'] },
]

function EchoTotals({ echoes, buildScore }: { echoes: Array<EchoInstance | null>; buildScore: number | null }) {
  const totals = useMemo(() => aggregateEchoStats(echoes), [echoes])

  const totalCV = (totals.critRate ?? 0) * 2 + (totals.critDmg ?? 0)
  const equippedCount = echoes.filter(Boolean).length

  const groups = useMemo(() => {
    return TOTALS_GROUPS
      .map((group) => ({
        ...group,
        entries: group.keys
          .filter((key) => totals[key] != null && totals[key] !== 0)
          .map((key) => ({ key, value: totals[key] })),
      }))
      .filter((g) => g.entries.length > 0)
  }, [totals])

  if (groups.length === 0) return null

  return (
    <Expandable
      className="echo-totals"
      header={
        <div className="echo-totals-header">
          <span className="echo-totals-title">Echo Stats</span>
          <div className="echo-totals-badges">
            <span className="echo-totals-count">{equippedCount}/5 equipped</span>
            {totalCV > 0 ? (
              <span className={getCvBadgeClass((totalCV - 44)/5)}>
                CV {totalCV.toFixed(1)}
              </span>
            ) : null}
            {buildScore !== null ? (
              <span className={`${getScoreBadgeClass(buildScore)} echo-score-badge--build`}>
                {buildScore.toFixed(1)}%
              </span>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="echo-totals-body">
        {groups.map((group) => (
          <div key={group.label} className="echo-totals-group">
            <span className="echo-totals-group-label">{group.label}</span>
            <div className="echo-totals-group-rows">
              {group.entries.map(({ key, value }) => (
                <div key={key} className="echo-totals-row">
                  <span className="echo-totals-stat-name">
                    <StatIcon statKey={key} />
                    {formatEchoStatLabel(key)}
                  </span>
                  <span className="echo-totals-stat-value">{formatEchoStatValue(key, value)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Expandable>
  )
}

export function CalculatorEchoesPane({ runtime, onRuntimeUpdate }: CalculatorEchoesPaneProps) {
  const allEchoes = useMemo(() => listEchoes(), [])
  const inventoryEchoes = useAppStore((state) => state.calculator.inventoryEchoes)
  const inventoryBuilds = useAppStore((state) => state.calculator.inventoryBuilds)
  const selectedTargetsByOwnerKey = useAppStore(selectActiveTargetSelections)
  const showToast = useToastStore((s) => s.show)
  const confirmation = useConfirmation()
  const portalTarget = getMainContentPortalTarget()
  const addEchoToInventory = useAppStore((state) => state.addEchoToInventory)
  const addBuildToInventory = useAppStore((state) => state.addBuildToInventory)
  const setResonatorTargetSelection = useAppStore((state) => state.setResonatorTargetSelection)
  const activeSeed = useMemo(() => getResonatorSeedById(runtime.id), [runtime.id])
  const mainEcho = runtime.build.echoes[0]
  const mainEchoDefinition = useMemo(
    () => (mainEcho ? getEchoById(mainEcho.id) : null),
    [mainEcho],
  )
  const mainEchoSource = useMemo(() => getMainEchoSourceRef(runtime), [runtime])
  const mainEchoStates = useMemo(() => {
    if (!mainEchoSource) {
      return []
    }

    return listStatesForSource(mainEchoSource.type, mainEchoSource.id).filter((state) =>
      evaluateSourceStateVisibility(runtime, runtime, state),
    )
  }, [mainEchoSource, runtime])

  // picker modal state
  const [pickerSlot, setPickerSlot] = useState<number | null>(null)
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAnimatingOut, setMenuAnimatingOut] = useState(false)
  const menuCloseTimerRef = useRef<number | null>(null)

  // edit modal state
  const [editSlot, setEditSlot] = useState<number | null>(null)
  const [editVisible, setEditVisible] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editAnimatingOut, setEditAnimatingOut] = useState(false)
  const editCloseTimerRef = useRef<number | null>(null)

  // parser modal state
  const [parserVisible, setParserVisible] = useState(false)

  // main echo detail toggle
  const [showMainEchoDesc, setShowMainEchoDesc] = useState(false)
  const hasMainEchoDetail = Boolean(mainEchoDefinition && (mainEchoDefinition.skillDesc || mainEchoStates.length > 0))

  useEffect(() => {
    return () => {
      if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current)
      if (editCloseTimerRef.current !== null) window.clearTimeout(editCloseTimerRef.current)
    }
  }, [])

  // picker animation
  useEffect(() => {
    if (!menuVisible || menuAnimatingOut) return
    const frame = window.requestAnimationFrame(() => setMenuOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [menuAnimatingOut, menuVisible])

  // edit animation
  useEffect(() => {
    if (!editVisible || editAnimatingOut) return
    const frame = window.requestAnimationFrame(() => setEditOpen(true))
    return () => window.cancelAnimationFrame(frame)
  }, [editAnimatingOut, editVisible])

  const openPicker = (slotIndex: number) => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current)
      menuCloseTimerRef.current = null
    }
    setPickerSlot(slotIndex)
    setMenuVisible(true)
    setMenuAnimatingOut(false)
    setMenuOpen(false)
  }

  const closePicker = () => {
    if (!menuVisible) return
    if (menuCloseTimerRef.current !== null) window.clearTimeout(menuCloseTimerRef.current)
    setMenuOpen(false)
    setMenuAnimatingOut(true)
    menuCloseTimerRef.current = window.setTimeout(() => {
      setMenuVisible(false)
      setMenuAnimatingOut(false)
      setPickerSlot(null)
      menuCloseTimerRef.current = null
    }, 300)
  }

  const openEdit = (slotIndex: number) => {
    if (editCloseTimerRef.current !== null) {
      window.clearTimeout(editCloseTimerRef.current)
      editCloseTimerRef.current = null
    }
    setEditSlot(slotIndex)
    setEditVisible(true)
    setEditAnimatingOut(false)
    setEditOpen(false)
  }

  const closeEdit = () => {
    if (!editVisible) return
    if (editCloseTimerRef.current !== null) window.clearTimeout(editCloseTimerRef.current)
    setEditOpen(false)
    setEditAnimatingOut(true)
    editCloseTimerRef.current = window.setTimeout(() => {
      setEditVisible(false)
      setEditAnimatingOut(false)
      setEditSlot(null)
      editCloseTimerRef.current = null
    }, 300)
  }

  const handleEditSave = (updated: EchoInstance) => {
    if (editSlot === null) return
    onRuntimeUpdate((prev) => {
      const next = [...prev.build.echoes]
      next[editSlot] = updated
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
    closeEdit()
  }

  const totalCost = useMemo(() => computeTotalEchoCost(runtime.build.echoes), [runtime.build.echoes])
  const equippedCount = runtime.build.echoes.filter(Boolean).length

  // cost of the echo currently in the picker slot (0 if empty)
  const slotCost = useMemo(() => {
    if (pickerSlot === null) return 0
    const echo = runtime.build.echoes[pickerSlot]
    if (!echo) return 0
    return getEchoById(echo.id)?.cost ?? 0
  }, [pickerSlot, runtime.build.echoes])

  // max cost an echo can have to fit in the current slot
  const maxCostForSlot = MAX_COST - totalCost + slotCost

  const handleSelect = (echoId: string) => {
    if (pickerSlot === null) return
    const echoDef = getEchoById(echoId)
    if (!echoDef) return
    if (echoDef.cost > maxCostForSlot) return

    const previous = runtime.build.echoes[pickerSlot]
    const instance = makeDefaultEchoInstance(echoId, pickerSlot, previous)
    if (!instance) return

    onRuntimeUpdate((prev) => {
      const next = [...prev.build.echoes]
      next[pickerSlot] = instance
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
  }

  const handleClear = () => {
    if (pickerSlot === null) return
    onRuntimeUpdate((prev) => {
      const next = [...prev.build.echoes]
      next[pickerSlot] = null
      return { ...prev, build: { ...prev.build, echoes: next } }
    })
  }

  const setCounts = useMemo(() => computeSetCounts(runtime.build.echoes), [runtime.build.echoes])

  // filter to sets that meet their minimum piece requirement
  const activeSets = useMemo(() => {
    return Object.entries(setCounts)
        .map(([setId, count]) => ({ setId: Number(setId), count }))
        .filter(({ setId, count }) => {
          const def = getEchoSetDef(setId)
          if (!def) return false
          const minReq = def.setMax === 3 ? 3 : 2
          return count >= minReq
        })
        .reverse()
  }, [setCounts])

  // scoring
  const hasWeights = useMemo(() => getMaxEchoScore(runtime.id) > 0, [runtime.id])
  const echoScores = useMemo(() => {
    if (!hasWeights) return null
    return runtime.build.echoes.map((echo) =>
      echo ? getEchoScorePercent(runtime.id, echo) : null,
    )
  }, [hasWeights, runtime.id, runtime.build.echoes])
  const buildScore = useMemo(() => {
    if (!hasWeights) return null
    return getBuildScorePercent(runtime.id, runtime.build.echoes)
  }, [hasWeights, runtime.id, runtime.build.echoes])

  const modalPortalTarget = getMainContentPortalTarget()

  const editEcho = editSlot !== null ? runtime.build.echoes[editSlot] : null
  const currentBuildSaved = useMemo(
    () =>
      inventoryBuilds.some((entry) =>
        areBuildSnapshotsEquivalent(entry.build, {
          weapon: runtime.build.weapon,
          echoes: runtime.build.echoes,
        }),
      ),
    [inventoryBuilds, runtime.build.echoes, runtime.build.weapon],
  )
  const mainEchoPanel = mainEchoDefinition && (mainEchoDefinition.skillDesc || mainEchoStates.length > 0) ? (
    <>
      <div className="echo-slot-feature-head">
        <div className="panel-overline">
          <span className="echo-feature-diamond" aria-hidden="true" />
          Main Echo
        </div>
        <h4 className="panel-title">{mainEchoDefinition.name}</h4>
      </div>
      {mainEchoDefinition.skillDesc ? (
        <div className="stack">
          <RichDescription description={mainEchoDefinition.skillDesc} />
        </div>
      ) : null}
      {mainEchoStates.length > 0 ? (
        <>
          {mainEchoStates.map((state) => (
            <SourceStateControl
              key={state.controlKey}
              sourceRuntime={runtime}
              targetRuntime={runtime}
              state={state}
              onRuntimeUpdate={onRuntimeUpdate}
            />
          ))}
        </>
      ) : null}
    </>
  ) : null

  const savableEquippedEchoes = useMemo(() => {
    return runtime.build.echoes.filter(
        (echo): echo is EchoInstance =>
            Boolean(echo) &&
            !inventoryEchoes.some((entry) => areEchoInstancesEquivalent(entry.echo, echo)),
    )
  }, [runtime.build.echoes, inventoryEchoes])

  return (
    <section className="calc-pane echoes-pane">
      <div className="echoes-pane-header">
        <div>
          <div className="panel-overline">Build</div>
          <h3>Echoes</h3>
        </div>
        <div className="echoes-pane-summary">
          <button
            type="button"
            className="ui-pill-button echoes-pane-action"
            onClick={() => setParserVisible(true)}
          >
            <FileImage size={15} />
            Import Echo
          </button>
          <button
            type="button"
            className="ui-pill-button echoes-pane-action"
            onClick={() => {
              addBuildToInventory({
                resonatorId: runtime.id,
                resonatorName: activeSeed?.name ?? runtime.id,
                build: {
                  weapon: { ...runtime.build.weapon },
                  echoes: cloneEchoLoadout(runtime.build.echoes),
                },
              })
              showToast({
                content: `Saved~ ദ്ദി ˉ꒳ˉ )✧`,
                variant: 'success',
                duration: 3000,
              })
            }}
            disabled={currentBuildSaved}
          >
            <Save size={15} />
            {currentBuildSaved ? 'Saved' : 'Save Build'}
          </button>
          <button
              type="button"
              className="ui-pill-button echoes-pane-action"
              disabled={savableEquippedEchoes.length === 0}
              onClick={() => {
                for (const echo of savableEquippedEchoes) {
                  addEchoToInventory(echo)
                }

                showToast({
                  content: `Saved ${savableEquippedEchoes.length} echo${savableEquippedEchoes.length === 1 ? '' : 'es'} to bag.`,
                  variant: 'success',
                  duration: 3000,
                })
              }}
          >
            <IoArchive size={15} />
            Save All
          </button>
          <button
            type="button"
            className="ui-pill-button ui-pill-button-danger echoes-pane-action"
            onClick={() => confirmation.confirm({
              title: 'You sure about that? ( · ❛ ֊ ❛)',
              message: 'This will remove all echoes from the current loadout.',
              confirmLabel: 'Unequip All',
              variant: 'danger',
              onConfirm: () => onRuntimeUpdate((prev) => ({
                ...prev,
                build: { ...prev.build, echoes: [null, null, null, null, null] },
              })),
            })}
            disabled={equippedCount === 0}
          >
            <Trash2 size={15} />
            Unequip All
          </button>
          <span className={`hero-badge ${totalCost > MAX_COST ? 'hero-badge--over' : ''}`}>{totalCost}/12C</span>
        </div>
      </div>

      <section className="echoes-pane-content">
        <motion.div
          className="echoes-slot-grid"
          layout
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Slot 0 — Main Echo */}
          <motion.div layout transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
            <EchoSlot
              key="echo-slot-0"
              echo={runtime.build.echoes[0]}
              index={0}
              score={echoScores?.[0] ?? null}
              canSave={Boolean(runtime.build.echoes[0]) && !inventoryEchoes.some((entry) => areEchoInstancesEquivalent(entry.echo, runtime.build.echoes[0]))}
              isMainEcho
              showMainChevron={hasMainEchoDetail}
              mainEchoExpanded={showMainEchoDesc}
              onToggleMainEcho={() => setShowMainEchoDesc((prev) => !prev)}
              onOpenPicker={() => openPicker(0)}
              onOpenEdit={() => runtime.build.echoes[0] && openEdit(0)}
              onSave={() => { if (runtime.build.echoes[0]) addEchoToInventory(runtime.build.echoes[0]) }}
              onRemove={() =>
                onRuntimeUpdate((prev) => {
                  const next = [...prev.build.echoes]
                  next[0] = null
                  return { ...prev, build: { ...prev.build, echoes: next } }
                })
              }
            />
          </motion.div>

          {/* Slot 1 — or Main Echo description panel when expanded */}
          <motion.div layout transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
            <AnimatePresence mode="wait">
              {showMainEchoDesc && mainEchoPanel ? (
                <motion.div
                  key="main-echo-desc"
                  className="echo-slot-detail-panel"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="echo-slot-feature">
                    {mainEchoPanel}
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="echo-slot-1"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                >
                  <EchoSlot
                    echo={runtime.build.echoes[1]}
                    index={1}
                    score={echoScores?.[1] ?? null}
                    canSave={Boolean(runtime.build.echoes[1]) && !inventoryEchoes.some((entry) => areEchoInstancesEquivalent(entry.echo, runtime.build.echoes[1]))}
                    onOpenPicker={() => openPicker(1)}
                    onOpenEdit={() => runtime.build.echoes[1] && openEdit(1)}
                    onSave={() => { if (runtime.build.echoes[1]) addEchoToInventory(runtime.build.echoes[1]) }}
                    onRemove={() =>
                      onRuntimeUpdate((prev) => {
                        const next = [...prev.build.echoes]
                        next[1] = null
                        return { ...prev, build: { ...prev.build, echoes: next } }
                      })
                    }
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Slots 2–4 (bottom row of 3) */}
          {runtime.build.echoes.slice(2).map((echo, i) => {
            const index = i + 2
            return (
              <motion.div key={`echo-slot-wrapper-${index}`} layout transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
                <EchoSlot
                  echo={echo}
                  index={index}
                  score={echoScores?.[index] ?? null}
                  canSave={Boolean(echo) && !inventoryEchoes.some((entry) => areEchoInstancesEquivalent(entry.echo, echo))}
                  onOpenPicker={() => openPicker(index)}
                  onOpenEdit={() => echo && openEdit(index)}
                  onSave={() => { if (echo) addEchoToInventory(echo) }}
                  onRemove={() =>
                    onRuntimeUpdate((prev) => {
                      const next = [...prev.build.echoes]
                      next[index] = null
                      return { ...prev, build: { ...prev.build, echoes: next } }
                    })
                  }
                />
              </motion.div>
            )
          })}
        </motion.div>

        {activeSets.length > 0 ? (
            <div className="echo-set-bonuses">
              {activeSets.map(({ setId, count }) => (
                  <EchoSetBonus
                      key={setId}
                      setId={setId}
                      count={count}
                      runtime={runtime}
                      onRuntimeUpdate={onRuntimeUpdate}
                      selectedTargetsByOwnerKey={selectedTargetsByOwnerKey}
                      setResonatorTargetSelection={setResonatorTargetSelection}
                  />
              ))}
            </div>
        ) : null}

        <EchoTotals echoes={runtime.build.echoes} buildScore={buildScore} />
      </section>

      {menuVisible && pickerSlot !== null ? (
        <EchoPickerModal
          visible={menuVisible}
          open={menuOpen}
          closing={menuAnimatingOut}
          portalTarget={modalPortalTarget}
          echoes={allEchoes}
          selectedEchoId={runtime.build.echoes[pickerSlot]?.id ?? null}
          slotIndex={pickerSlot}
          maxCost={maxCostForSlot}
          onSelect={handleSelect}
          onClear={handleClear}
          onClose={closePicker}
        />
      ) : null}

      {editVisible && editSlot !== null && editEcho ? (
        <EchoEditModal
          visible={editVisible}
          open={editOpen}
          closing={editAnimatingOut}
          portalTarget={modalPortalTarget}
          echo={editEcho}
          slotIndex={editSlot}
          onSave={handleEditSave}
          onClose={closeEdit}
        />
      ) : null}

      {parserVisible ? (
        <EchoImageParserModal
          visible={parserVisible}
          portalTarget={modalPortalTarget}
          charId={runtime.id}
          onEquip={(echoes) => {
            onRuntimeUpdate((prev) => ({
              ...prev,
              build: { ...prev.build, echoes },
            }))
            showToast({
              content: 'Echoes imported~! (〜^∇^)〜',
              variant: 'success',
              duration: 3000,
            })
          }}
          onClose={() => setParserVisible(false)}
        />
      ) : null}

      <ConfirmationModal
        visible={confirmation.visible}
        open={confirmation.open}
        closing={confirmation.closing}
        portalTarget={portalTarget}
        title={confirmation.title}
        message={confirmation.message}
        confirmLabel={confirmation.confirmLabel}
        cancelLabel={confirmation.cancelLabel}
        variant={confirmation.variant}
        onConfirm={confirmation.onConfirm}
        onCancel={confirmation.onCancel}
      />
    </section>
  )
}

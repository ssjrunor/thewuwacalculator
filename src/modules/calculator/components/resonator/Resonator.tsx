import {useEffect, useMemo, useRef, useState} from 'react'
import type { CSSProperties } from 'react'
import { Info } from 'lucide-react'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { useAppStore } from '@/domain/state/store'
import { computeTraceNodeBuffs } from '@/domain/state/traceNodes'
import { AppDialog } from '@/shared/ui/AppDialog'
import { RichDescription } from '@/shared/ui/RichDescription'
import { Tooltip } from '@/shared/ui/Tooltip'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { ModalCloseButton } from '@/shared/ui/ModalCloseButton'
import { normalizeResonatorRuntimeControls } from '@/domain/gameData/controlOptions'
import { ResonatorPickerModal } from '@/modules/calculator/components/resonator/modals/ResonatorPickerModal'
import {
  RESONATOR_FILTER_ATTRIBUTES,
  RESONATOR_FILTER_WEAPONS,
  RESONATOR_MENU,
  TRACE_NODE_ICON_MAP,
  WEAPON_TYPE_TO_KEY,
  getResonator,
  getResonatorDetails,
  getVisibleResonatorSkillSliderTabs,
  type ResonatorSkillTabKey,
  type ResonatorSliderSkillTabKey,
  type ResonatorStateControl,
} from '@/modules/calculator/model/resonator.ts'
import { toTitle } from '@/modules/calculator/model/overviewStats'
import {
  attributeSliderColors,
  formatSkillKey,
  getControlOptions,
  getScaledValue,
  isControlVisiblyActive,
  mergeDescriptionKeywords,
  preloadImage,
  skillLabelMap,
  toStoredControlValue,
} from '@/modules/calculator/model/resonatorPanel'
import { getWeapon } from '@/modules/calculator/model/weapon'
import {
  evaluateResonatorControlEnabled,
  evaluateResonatorControlVisible,
  evaluateResonatorVisibility,
} from '@/modules/calculator/model/resonatorControlEvaluation'
import { getResonatorControlDisabledReason } from '@/modules/calculator/model/stateDisabledReason'
import { getControlInactiveValue } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { withDefaultIconImage } from '@/shared/lib/imageFallback'
import { clampNumber } from '@/shared/lib/number'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { aggregateEchoStats, getBuildScorePercent, getMaxEchoScore } from '@/data/scoring/echoScoring.ts'

// surfaces the resonator selector and slider controls that drive the runtime.
interface ResonatorPaneProps {
  runtime: ResonatorRuntimeState
  activeResonatorId: string | null
  onRuntimeUpdate: (updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState) => void
  isDarkMode: boolean
}

// surfaces the resonator selector and slider controls that drive the runtime.

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
}) {
  return (
    <input
      className="resonator-level-input"
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value) || 0)}
    />
  )
}

export function Resonator({
  runtime,
  activeResonatorId,
  onRuntimeUpdate,
  isDarkMode,
}: ResonatorPaneProps) {
  const switchToResonator = useAppStore((s) => s.switchToResonator)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuVisible, setMenuVisible] = useState(false)
  const [menuAnimatingOut, setMenuAnimatingOut] = useState(false)
  const [menuPreloaded, setMenuPreloaded] = useState(false)
  const skillsModal = useAnimatedVisibility(300)
  const [activeSkillTab, setActiveSkillTab] = useState<ResonatorSkillTabKey>('normalAttack')

  const menuCloseTimerRef = useRef<number | null>(null)

  const resonator = getResonator(runtime.id)
  const details = getResonatorDetails(runtime.id)
  const sliderSkillTabs = getVisibleResonatorSkillSliderTabs(details)
  const displayName = resonator?.name ?? runtime.id
  const menu = resonator ? { displayName: resonator.name, profile: resonator.profile, rarity: resonator.rarity, attribute: resonator.attribute, weaponType: resonator.weaponType } : null
  const currentWeaponType = resonator?.weaponType ?? 4
  const currentWeaponKey = WEAPON_TYPE_TO_KEY[currentWeaponType as keyof typeof WEAPON_TYPE_TO_KEY] ?? 'gauntlets'
  const currentAttribute = resonator?.attribute ?? 'physical'
  const currentSliderColor = attributeSliderColors[currentAttribute] ?? '#888'
  const activeSprite = resonator?.sprite ?? '/assets/default-icon.webp'
  const availableControls = [
    ...(details?.statePanels.flatMap((panel) => panel.controls) ?? []),
    ...(details?.resonanceChains
      .map((entry) => entry.control ?? entry.toggleControl)
      .filter((control): control is ResonatorStateControl => Boolean(control)) ?? []),
  ]
  const controlsByKey = Object.fromEntries(availableControls.map((control) => [control.key, control]))

  useEffect(() => {
    return () => {
      if (menuCloseTimerRef.current !== null) {
        window.clearTimeout(menuCloseTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!menuVisible || !menuPreloaded || menuAnimatingOut) {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setMenuOpen(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [menuAnimatingOut, menuPreloaded, menuVisible])

  useEffect(() => {
    if (!menuVisible) return
    let cancelled = false

    async function preloadMenuImages() {
      const sources: string[] = []

      for (const entry of RESONATOR_MENU) {
        const weaponKey = WEAPON_TYPE_TO_KEY[entry.weaponType]
        sources.push(entry.profile)
        sources.push(`/assets/weapons/${weaponKey}.webp`)
        sources.push(`/assets/attributes/attributes alt/${entry.attribute}.webp`)
      }

      for (const weapon of RESONATOR_FILTER_WEAPONS) {
        sources.push(`/assets/weapons/${weapon.key}.webp`)
      }

      for (const attribute of RESONATOR_FILTER_ATTRIBUTES) {
        sources.push(`/assets/attributes/attributes alt/${attribute}.webp`)
      }

      await Promise.all(sources.map((source) => preloadImage(source)))

      if (!cancelled) {
        setMenuPreloaded(true)
      }
    }

    void preloadMenuImages()

    return () => {
      cancelled = true
    }
  }, [menuVisible])

  const openMenu = () => {
    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current)
      menuCloseTimerRef.current = null
    }

    setMenuPreloaded(false)
    setMenuVisible(true)
    setMenuAnimatingOut(false)
    setMenuOpen(false)
  }

  const closeMenu = () => {
    if (!menuVisible) {
      return
    }

    if (menuCloseTimerRef.current !== null) {
      window.clearTimeout(menuCloseTimerRef.current)
    }

    setMenuOpen(false)
    setMenuAnimatingOut(true)
    menuCloseTimerRef.current = window.setTimeout(() => {
      setMenuVisible(false)
      setMenuAnimatingOut(false)
      menuCloseTimerRef.current = null
    }, 300)
  }

  const openSkillsModal = () => {
    if (details && !details.skillsByTab[activeSkillTab]) {
      const fallback = details.skillTabs[0]
      if (fallback) {
        setActiveSkillTab(fallback)
      }
    }

    skillsModal.show()
  }

  const closeSkillsModal = () => {
    skillsModal.hide()
  }

  const updateLevel = (level: number) => {
    const nextLevel = clampNumber(Math.round(level), 1, 90)
    onRuntimeUpdate((prev) => ({
      ...prev,
      base: {
        ...prev.base,
        level: nextLevel,
      },
    }))
  }

  const updateSequence = (sequence: number) => {
    const nextSequence = clampNumber(Math.round(sequence), 0, 6)
    onRuntimeUpdate((prev) => {
      const nextRuntime = {
        ...prev,
        base: {
          ...prev.base,
          sequence: nextSequence,
        },
      }

      return {
        ...nextRuntime,
        state: {
          ...nextRuntime.state,
          controls: normalizeResonatorRuntimeControls(nextRuntime),
        },
      }
    })
  }

  const updateSkillLevel = (key: ResonatorSliderSkillTabKey, value: number) => {
    const nextValue = clampNumber(Math.round(value), 1, 10)
    onRuntimeUpdate((prev) => ({
      ...prev,
      base: {
        ...prev.base,
        skillLevels: {
          ...prev.base.skillLevels,
          [key]: nextValue,
        },
      },
    }))
  }

  const updateControlValue = (control: ResonatorStateControl, rawValue: boolean | number) => {
    const currentSequence = runtime.base.sequence
    const dynamicMax = control.sequenceAwareCap
      ? currentSequence >= control.sequenceAwareCap.threshold
        ? control.sequenceAwareCap.atOrAbove
        : control.sequenceAwareCap.below
      : control.max

    onRuntimeUpdate((prev) => {
      const nextControls = {
        ...prev.state.controls,
      }

      if (control.kind === 'toggle') {
        nextControls[control.key] = Boolean(rawValue)
      } else {
        const numericRaw = typeof rawValue === 'number' ? rawValue : Number(rawValue)
        const min = control.min ?? 0
        const max = dynamicMax ?? 99
        const bounded = clampNumber(Math.round(numericRaw), min, max)
        nextControls[control.key] = bounded
      }

      if (control.kind === 'toggle' && Boolean(rawValue) && control.resets?.length) {
        for (const key of control.resets) {
          const target = controlsByKey[key]
          nextControls[key] = target ? getControlInactiveValue(target, {
            ...prev,
            state: {
              ...prev.state,
              controls: nextControls,
            },
          }) : false
        }
      }

      for (const candidate of availableControls) {
        if (!candidate.disabledWhen) {
          continue
        }

        if (nextControls[candidate.disabledWhen.key] === candidate.disabledWhen.equals) {
          nextControls[candidate.key] = getControlInactiveValue(candidate, {
            ...prev,
            state: {
              ...prev.state,
              controls: nextControls,
            },
          })
        }
      }

      const nextRuntime = {
        ...prev,
        state: {
          ...prev.state,
          controls: nextControls,
        },
      }

      return {
        ...nextRuntime,
        state: {
          ...nextRuntime.state,
          controls: normalizeResonatorRuntimeControls(nextRuntime, nextControls),
        },
      }
    })
  }

  const getControlValue = (control: ResonatorStateControl): boolean | number | string | undefined =>
    runtime.state.controls[control.key]

  const getControlDisabled = (control: ResonatorStateControl): boolean =>
    Boolean(
      (control.disabledWhen
        ? runtime.state.controls[control.disabledWhen.key] === control.disabledWhen.equals
        : false)
      || !evaluateResonatorControlEnabled(runtime, control),
    )

  const getControlVisible = (control: ResonatorStateControl): boolean =>
    evaluateResonatorControlVisible(runtime, control)

  const getSequenceControlStatus = (control: ResonatorStateControl) => {
    const controlValue = getControlValue(control)

    if (control.kind === 'toggle') {
      return {
        label: control.label,
        active: Boolean(controlValue),
      }
    }

    const stored = Number(controlValue ?? control.min ?? 0)
    const displayValue = getScaledValue(control, stored)

    return {
      label: `${control.label}: ${displayValue}`,
      active: isControlVisiblyActive(control, controlValue),
    }
  }

  const renderControlField = (
    control: ResonatorStateControl,
    options?: {
      disabled?: boolean
      disabledReason?: string
      className?: string
    },
  ) => {
    if (!getControlVisible(control)) {
      return null
    }

    const controlValue = getControlValue(control)
    const isDisabled = options?.disabled ?? getControlDisabled(control)
    const disabledReason = isDisabled
      ? (options?.disabledReason ?? getResonatorControlDisabledReason(control, controlsByKey))
      : null

    if (control.kind === 'toggle') {
      return (
        <div key={control.key} className={['state-control-field', isDisabled ? 'is-disabled' : '', options?.className].filter(Boolean).join(' ')}>
          <label className={['toggle-row', options?.className, isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
            <span>{control.label}</span>
            <input
              type="checkbox"
              checked={Boolean(controlValue)}
              onChange={(event) => updateControlValue(control, event.target.checked)}
              disabled={isDisabled}
            />
          </label>
          {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
        </div>
      )
    }

    if (control.kind === 'select') {
      const optionsList = getControlOptions(control, runtime)
      return (
        <div key={control.key} className={['state-control-field', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
          <label className={['state-control-label', options?.className, isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
            {control.label}
            <LiquidSelect
              value={Number(controlValue ?? control.min ?? 0)}
              disabled={isDisabled}
              options={optionsList.map((option) => ({
                value: option,
                label: String(option),
              }))}
              onChange={(nextValue) => updateControlValue(control, nextValue)}
            />
          </label>
          {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
        </div>
      )
    }

    const dynamicMax = control.sequenceAwareCap
      ? runtime.base.sequence >= control.sequenceAwareCap.threshold
        ? control.sequenceAwareCap.atOrAbove
        : control.sequenceAwareCap.below
      : control.max

    const stored = Number(controlValue ?? control.min ?? 0)
    const scaledValue = getScaledValue(control, stored)
    const scaledMin = control.min === undefined ? undefined : getScaledValue(control, control.min)
    const scaledMax = control.inputMax ?? (dynamicMax === undefined ? undefined : getScaledValue(control, dynamicMax))
    const scaledStep = control.step === undefined
      ? control.displayMultiplier ?? 1
      : getScaledValue(control, control.step)

    return (
      <div key={control.key} className={['state-control-field', isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
        <label className={['state-control-label', options?.className, isDisabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
          {control.label}
          <NumberInput
            value={scaledValue}
            min={scaledMin}
            max={scaledMax}
            step={scaledStep}
            disabled={isDisabled}
            onChange={(value) => updateControlValue(control, toStoredControlValue(control, value))}
          />
        </label>
        {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
      </div>
    )
  }

  const toggleTraceNode = (nodeId: string) => {
    onRuntimeUpdate((prev) => {
      const nextActiveNodes = {
        ...prev.base.traceNodes.activeNodes,
        [nodeId]: !prev.base.traceNodes.activeNodes[nodeId],
      }

      return {
        ...prev,
        base: {
          ...prev.base,
          traceNodes: details ? computeTraceNodeBuffs(details, nextActiveNodes) : prev.base.traceNodes,
        },
      }
    })
  }

  const handleMax = () => {
    onRuntimeUpdate((prev) => {
      const nextActiveNodes = details
        ? Object.fromEntries(details.traceNodes.map((node) => [node.id, true]))
        : prev.base.traceNodes.activeNodes

      const nextSkillLevels = {
        ...prev.base.skillLevels,
      }

      for (const tab of sliderSkillTabs) {
        nextSkillLevels[tab] = 10
      }

      return {
        ...prev,
        base: {
          ...prev.base,
          level: 90,
          skillLevels: nextSkillLevels,
          traceNodes: details ? computeTraceNodeBuffs(details, nextActiveNodes) : prev.base.traceNodes,
        },
      }
    })
  }

  const allTraceNodesActive = details
    ? details.traceNodes.every((node) => runtime.base.traceNodes.activeNodes[node.id])
    : true

  const maxedSkills =
    runtime.base.level === 90 &&
    sliderSkillTabs.every((tab) => runtime.base.skillLevels[tab] >= 10) &&
    allTraceNodesActive

  const resolvedActiveSkillTab =
    details?.skillsByTab[activeSkillTab] ? activeSkillTab : (details?.skillTabs[0] ?? activeSkillTab)

  const modalSkill = details?.skillsByTab[resolvedActiveSkillTab] ?? null
  const tabLevel =
    resolvedActiveSkillTab === 'outroSkill'
      ? null
      : runtime.base.skillLevels[resolvedActiveSkillTab]
  const multiplierIndex = typeof tabLevel === 'number' ? tabLevel - 1 : -1
  const modalPortalTarget = getMainContentPortalTarget()

  const resonatorMenuPortal =
    menuVisible && menuPreloaded
      ? (
          <ResonatorPickerModal
            visible={menuVisible}
            open={menuOpen}
            closing={menuAnimatingOut}
            portalTarget={modalPortalTarget}
            eyebrow="Roster"
            title="Select Resonator"
            resonators={RESONATOR_MENU}
            selectedResonatorId={activeResonatorId ?? runtime.id}
            selectionLabel="Active"
            summaryPrimary={{
              label: 'Current',
              value: menu?.displayName ?? displayName,
            }}
            emptyState={<p>I hope Solon Lee releases the character you're searching for.</p>}
            closeLabel="Close"
            panelWidth="regular"
            onClose={closeMenu}
            onSelect={(resonatorId) => {
              switchToResonator(resonatorId)
              closeMenu()
            }}
          />
        )
      : null

  const skillsModalPortal =
    skillsModal.visible && modalPortalTarget
      ? (
          <AppDialog
            visible={skillsModal.visible}
            open={skillsModal.open}
            closing={skillsModal.closing}
            portalTarget={modalPortalTarget}
            overlayClassName="skills-modal-overlay"
            contentClassName="app-modal-panel skills-modal-content"
            ariaLabel="Skill data"
            onClose={closeSkillsModal}
          >
            <div onClick={(event) => event.stopPropagation()}>
              <div className="app-modal-header">
                <div className="app-modal-header-top">
                  <div>
                    <div className="panel-overline">Skill Data</div>
                    <h3 className="panel-heading-title">{menu?.displayName ?? displayName}</h3>
                  </div>
                  <ModalCloseButton onClick={closeSkillsModal} />
                </div>
              </div>

              <div className="rotation-view-toggle">
                {(details?.skillTabs ?? []).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={resolvedActiveSkillTab === tab ? 'view-toggle-button active' : 'view-toggle-button'}
                    onClick={() => setActiveSkillTab(tab)}
                  >
                    {skillLabelMap[tab] ?? formatSkillKey(tab)}
                  </button>
                ))}
              </div>

              <div className="skills-modal-content-area">
                {modalSkill ? (
                  <>
                    <h4>{modalSkill.name}</h4>
                    <RichDescription
                      description={modalSkill.desc}
                      params={modalSkill.param}
                      accentColor={currentSliderColor}
                      extraKeywords={mergeDescriptionKeywords(details?.descriptionKeywords, modalSkill.keywords)}
                    />
                    {modalSkill.multipliers.length > 0 && (
                      <table className="multipliers-table">
                        <tbody>
                          {modalSkill.multipliers.map((multiplier) => (
                            <tr key={multiplier.id} className="multiplier-row">
                              <td className="multiplier-label">{multiplier.label}</td>
                              <td className="multiplier-value">
                                {multiplierIndex >= 0 ? multiplier.values[multiplierIndex] ?? 'N/A' : 'N/A'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </>
                ) : (
                  <p>No data available.</p>
                )}
              </div>
            </div>
          </AppDialog>
        )
      : null

  const hasWeights = useMemo(() => getMaxEchoScore(runtime.id) > 0, [runtime.id])
  const echoes = runtime.build.echoes
  const totals = useMemo(() => aggregateEchoStats(echoes), [echoes])
  const buildScore = useMemo(() => {
    if (!hasWeights) return null
    return getBuildScorePercent(runtime.id, echoes)
  }, [hasWeights, runtime.id, echoes])
  const totalCV = (totals.critRate ?? 0) * 2 + (totals.critDmg ?? 0)

  return (
    <section
      className="calc-pane resonator-pane"
      style={{ '--slider-color': currentSliderColor } as CSSProperties}
    >
      <div className="resonator-flow-header">
        <button
          type="button"
          className={`resonator-avatar-button rarity-${menu?.rarity ?? 5}`}
          aria-label="Open resonator selector"
          onClick={() => {
            if (menuOpen) {
              closeMenu()
              return
            }
            openMenu()
          }}
        >
          <img
            src={activeSprite}
            alt={menu?.displayName ?? displayName}
            className={`resonator-avatar resonator-avatar--sprite rarity-${menu?.rarity ?? 5}`}
            onError={withDefaultIconImage}
          />
        </button>

        <div className="resonator-heading">
          <div className="panel-overline">Active Resonator</div>
          <div className="resonator-heading-top">
            <h3>{menu?.displayName ?? displayName}</h3>
            <div className="resonator-heading-badges">
              <span className="hero-badge">Lv {runtime.base.level}</span>
              <span className="hero-badge">S{runtime.base.sequence}</span>
            </div>
          </div>
          <div className="resonator-heading-subline">
            <div className="resonator-heading-icons">
              <img
                src={`/assets/weapons/${currentWeaponKey}.webp`}
                alt={toTitle(currentWeaponKey)}
                className="weapon-icon"
              />
              <img
                src={`/assets/attributes/attributes alt/${currentAttribute}.webp`}
                alt={toTitle(currentAttribute)}
                className="attribute-icon"
                style={currentAttribute === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
              />
            </div>
            <div className="resonator-heading-meta">
              <span className="hero-chip">{toTitle(currentWeaponKey)}</span>
              <span className="hero-chip">{toTitle(currentAttribute)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="resonator-snapshot-grid">
        <article className="resonator-snapshot-card ui-surface-card ui-surface-card--section">
          <span className="resonator-snapshot-label">Resonator Level</span>
          <strong className="resonator-snapshot-value">Lv {runtime.base.level}</strong>
          <span className="resonator-snapshot-detail">Yes, this is in fact their level.</span>
        </article>

        <article className="resonator-snapshot-card ui-surface-card ui-surface-card--section">
          <span className="resonator-snapshot-label">Investment</span>
          <strong className="resonator-snapshot-value">S{runtime.base.sequence} ⥋ R{runtime.build.weapon.rank}</strong>
          <span className="resonator-snapshot-detail">Investment Level</span>
        </article>

        <article className="resonator-snapshot-card shrink ui-surface-card ui-surface-card--section">
          <span className="resonator-snapshot-label">Weapon</span>
          <strong className="resonator-snapshot-value">{getWeapon(runtime.build.weapon.id)?.name}</strong>
          <span className="resonator-snapshot-detail">{toTitle(currentWeaponKey)} ⥋ Lv {runtime.build.weapon.level} | R{runtime.build.weapon.rank}</span>
        </article>

        <article className="resonator-snapshot-card shrink ui-surface-card ui-surface-card--section">
          <span className="resonator-snapshot-label">Build Metric</span>
          <strong className="resonator-snapshot-value">
            {(buildScore)?.toFixed(1)}% ⥋ {(totalCV).toFixed(1)}%
          </strong>
          <span className="resonator-snapshot-detail">Score and CV</span>
        </article>
      </div>

      {resonatorMenuPortal}

      <div className="resonator-settings ui-surface-card ui-surface-card--section">
        <div className="slider-group">
          <div className="level-group">
            <div className="slider-label-with-input">
              <label>Level</label>
              <NumberInput
                value={runtime.base.level}
                min={1}
                max={90}
                onChange={updateLevel}
              />
            </div>
            <button
              type="button"
              className={maxedSkills ? 'chip active' : 'chip'}
              disabled={maxedSkills}
              onClick={handleMax}
            >
              {maxedSkills ? 'Maxed ✓' : 'Max'}
            </button>
          </div>
          <div className="slider-controls">
            <input
              type="range"
              min={1}
              max={90}
              value={runtime.base.level}
              onChange={(event) => updateLevel(Number(event.target.value))}
              style={{ '--slider-fill': `${((runtime.base.level - 1) / 89) * 100}%` } as CSSProperties}
            />
            <span>{runtime.base.level}</span>
          </div>
        </div>

        <div className="slider-group">
          <label>Sequence</label>
          <div className="slider-controls">
            <input
              type="range"
              min={0}
              max={6}
              value={runtime.base.sequence}
              onChange={(event) => updateSequence(Number(event.target.value))}
              style={{ '--slider-fill': `${(runtime.base.sequence / 6) * 100}%` } as CSSProperties}
            />
            <span>{runtime.base.sequence}</span>
          </div>
        </div>
      </div>

      <div className="skills-settings clickable ui-surface-card ui-surface-card--section">
        <button type="button" className="skill-info-button" onClick={openSkillsModal}>
          <Info size={20} />
        </button>

        {sliderSkillTabs.map((key) => (
          <div className="slider-group" key={key}>
            <label>{skillLabelMap[key] ?? formatSkillKey(key)}</label>
            <div className="slider-controls">
              <input
                type="range"
                min={1}
                max={10}
                value={runtime.base.skillLevels[key]}
                onChange={(event) => updateSkillLevel(key, Number(event.target.value))}
                style={{ '--slider-fill': `${((runtime.base.skillLevels[key] - 1) / 9) * 100}%` } as CSSProperties}
              />
              <span>{runtime.base.skillLevels[key]}</span>
            </div>
          </div>
        ))}
      </div>

      {skillsModalPortal}

      <div className="inherent-skills-box ui-surface-card ui-surface-card--section">
        <h3>Inherent Skills</h3>

        <div className="inherent-skills">
          {details?.inherentSkills.map((inherent) => {
            const locked = runtime.base.level < inherent.unlockLevel
            const control = inherent.control
            const statusLabel = locked ? 'Locked' : control ? 'Configurable' : 'Passive'

            return (
              <article
                key={inherent.id}
                className={
                  locked
                    ? 'control-panel-box inherent-skill locked ui-surface-card ui-surface-card--inner'
                    : 'control-panel-box inherent-skill ui-surface-card ui-surface-card--inner'
                }
              >
                <div className="sequence-card-head inherent-skill-head">
                  <div className="sequence-card-title-row">
                    <span className="sequence-card-badge">Lv {inherent.unlockLevel}</span>
                    <h4 className="highlight">{inherent.name}</h4>
                  </div>
                  <span className={locked ? 'sequence-card-status' : 'sequence-card-status active'}>{statusLabel}</span>
                </div>

                <div className="sequence-card-body inherent-skill-body">
                  <RichDescription
                    description={inherent.desc}
                    params={inherent.param}
                    accentColor={currentSliderColor}
                    extraKeywords={mergeDescriptionKeywords(details?.descriptionKeywords, inherent.keywords)}
                  />
                </div>

                {(control || locked) && (
                  <div className="sequence-card-footer inherent-skill-footer">
                    {control ? renderControlField(control, { disabled: locked, className: 'inherent-skill-control' }) : null}
                    {locked ? <span className="inherent-lock">Unlocks at Lv. {inherent.unlockLevel}</span> : null}
                  </div>
                )}
              </article>
            )
          })}
        </div>

        {!details && <p className="pane-hint">No resonator-specific inherent data yet.</p>}

        {details && (
          <div className="trace-icons">
            {details.traceNodes.map((node) => {
              const iconKey = TRACE_NODE_ICON_MAP[node.name]
              const iconPath = iconKey
                ? `/assets/skills/icons/${isDarkMode ? 'dark' : 'light'}/${iconKey}.webp`
                : null
              const active = runtime.base.traceNodes.activeNodes[node.id] ?? false

              return (
                <Tooltip
                  key={node.id}
                  placement="top"
                  content={
                    <div className="trace-node-tooltip">
                      <div className="tooltip-header">
                        <div className="tooltip-title">{node.name}</div>
                      </div>
                      <div className="tooltip-section">
                        <RichDescription
                          description={node.desc}
                          params={node.param}
                          accentColor={currentSliderColor}
                        />
                      </div>
                    </div>
                  }
                >
                  <button
                    type="button"
                    className={active ? 'trace-icon active' : 'trace-icon'}
                    onClick={() => toggleTraceNode(node.id)}
                  >
                    {iconPath ? <img src={iconPath} alt={node.name} /> : <span>{node.name}</span>}
                  </button>
                </Tooltip>
              )
            })}
          </div>
        )}

        {details?.statePanels.map((panel) => {
          if (!evaluateResonatorVisibility(runtime, panel.visibleWhen)) {
            return null
          }

          const visibleControls = panel.controls.filter((control) => getControlVisible(control))
          if (visibleControls.length === 0) {
            return null
          }

          return (
            <div key={panel.id} className="control-panel-box ui-surface-card ui-surface-card--inner">
              <h4>{panel.title}</h4>
              <RichDescription
                description={panel.body}
                params={panel.param}
                accentColor={currentSliderColor}
                extraKeywords={mergeDescriptionKeywords(details?.descriptionKeywords, panel.keywords)}
              />
              <div className="stack">{visibleControls.map((control) => renderControlField(control))}</div>
            </div>
          )
        })}
      </div>

      {details && runtime.base.sequence > 0 && (
        <div className="inherent-skills-box sequence-box ui-surface-card pane-section">
          <h2>Resonance Chain</h2>

          <div className="sequence-chain-list">
            {details.resonanceChains
              .filter((entry) => entry.index <= runtime.base.sequence)
              .map((entry) => {
                const sequenceControl = entry.control ?? entry.toggleControl
                const sequenceControlStatus = sequenceControl ? getSequenceControlStatus(sequenceControl) : null

                return (
                  <article key={`chain-${entry.index}`} className="control-panel-box sequence-node ui-surface-card ui-surface-card--inner">
                    <div className="sequence-card-head">
                      <div className="sequence-card-title-row">
                        <span className="sequence-card-badge">S{entry.index}</span>
                        <h4 className="highlight">{entry.name}</h4>
                      </div>
                      {sequenceControlStatus ? (
                        <span className={sequenceControlStatus.active ? 'sequence-card-status active' : 'sequence-card-status'}>
                          {sequenceControlStatus.label}
                        </span>
                      ) : null}
                    </div>

                    <div className="sequence-card-body">
                      <RichDescription
                        description={entry.desc}
                        params={entry.param}
                        accentColor={currentSliderColor}
                        extraKeywords={mergeDescriptionKeywords(details?.descriptionKeywords, entry.keywords)}
                      />
                    </div>

                    {sequenceControl && (
                      <div className="sequence-card-footer">
                        {renderControlField(sequenceControl, {
                          disabled: runtime.base.sequence < entry.index,
                          className: 'sequence-toggle-row',
                        })}
                      </div>
                    )}
                  </article>
                )
              })}
          </div>
        </div>
      )}
    </section>
  )
}

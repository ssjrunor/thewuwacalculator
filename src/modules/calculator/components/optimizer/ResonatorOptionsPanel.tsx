import { useMemo } from 'react'
import { ChevronDown, Crosshair, Cpu, Image, Info, X } from 'lucide-react'
import { readRuntimePath } from '@/domain/gameData/runtimePath'
import type { OptimizerSetSelections, OptimizerStatConstraint } from '@/domain/entities/optimizer'
import { isUnsetWeaponId, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { SourceStateDefinition } from '@/domain/gameData/contracts'
import { listStatesForSource } from '@/domain/services/gameDataService'
import type { LiquidSelectOption, LiquidSelectOptionGroup } from '@/shared/ui/LiquidSelect'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import { NumberInput } from '@/modules/calculator/components/workspace/panes/left/controls/NumberInput'
import {
  isSourceStateEnabled,
  setSourceStateValue,
  type RuntimeUpdateHandler,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { evaluateSourceStateVisibility } from '@/modules/calculator/model/sourceStateEvaluation'
import { getSourceStateDisplay } from '@/modules/calculator/model/sourceStateDisplay'
import { getWeapon, withDefaultWeaponImage } from '@/modules/calculator/model/weapon'
import { AllowedSetDropdown } from './AllowedSetDropdown'
import { STAT_LIST } from './mockData'
import { SiBattledotnet } from "react-icons/si";

const BONUS_SHORT_LABELS: Record<string, string> = {
  glacio: 'Glacio',
  fusion: 'Fusion',
  electro: 'Electro',
  aero: 'Aero',
  spectro: 'Spectro',
  havoc: 'Havoc',
}

// surfaces the optimizer resonator options panel, mirroring the live control inputs.
interface ResonatorOptionsPanel {
  displayName: string
  level: number
  sequence: number
  rarity: number
  imageSrc: string
  targetMode: 'skill' | 'combo'
  targetSkillId: string | null
  targetComboId: string | null
  skillOptions: LiquidSelectOption<string>[]
  skillGroups?: LiquidSelectOptionGroup<string>[]
  comboOptions: LiquidSelectOption<string>[]
  enableGpu: boolean
  useSplash: boolean
  mainEcho: { id: string; name: string; icon: string } | null
  allowedSets: OptimizerSetSelections
  mainStatFilter: string[]
  selectedBonus: string | null
  statConstraints: Record<string, OptimizerStatConstraint>
  optimizerRuntime: ResonatorRuntimeState | null
  onTargetModeChange: (value: 'skill' | 'combo') => void
  onTargetSkillChange: (value: string) => void
  onTargetComboChange: (value: string) => void
  onEnableGpuChange: (enabled: boolean) => void
  onOptimizerRuntimeUpdate: RuntimeUpdateHandler
  onOpenResonatorPicker: () => void
  onSyncLive: () => void
  onOpenMainEchoPicker: () => void
  onOpenSetConditionals: () => void
  onClearMainEchoSelection: () => void
  onAllowedSetsChange: (value: OptimizerSetSelections) => void
  onToggleMainStat: (value: string) => void
  onPickBonus: (value: string) => void
  onClearAllFilters: () => void
  onStatLimitChange: (statKey: string, field: 'minTotal' | 'maxTotal', value: string) => void
  setIsSprite?: (value: boolean) => void
}

// surfaces the optimizer resonator options panel, mirroring the live control inputs.
function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return fallback
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return value === 'true'
  }

  if (typeof value === 'number') {
    return value > 0
  }

  return fallback
}

export function CharacterOptionsPanel({
  displayName,
  level,
  sequence,
  rarity,
  imageSrc,
  targetMode,
  targetSkillId,
  targetComboId,
  skillOptions,
  skillGroups,
  comboOptions,
  enableGpu,
  useSplash,
  mainEcho,
  allowedSets,
  mainStatFilter,
  selectedBonus,
  statConstraints,
  optimizerRuntime,
  onTargetModeChange,
  onTargetSkillChange,
  onTargetComboChange,
  onEnableGpuChange,
  onOptimizerRuntimeUpdate,
  onOpenResonatorPicker,
  onSyncLive,
  onOpenMainEchoPicker,
  onOpenSetConditionals,
  onClearMainEchoSelection,
  onAllowedSetsChange,
  onToggleMainStat,
  onPickBonus,
  onClearAllFilters,
  onStatLimitChange,
  setIsSprite,
}: ResonatorOptionsPanel) {
  const bonusOptions = [
    { value: 'glacio', label: 'Glacio DMG' },
    { value: 'fusion', label: 'Fusion DMG' },
    { value: 'electro', label: 'Electro DMG' },
    { value: 'aero', label: 'Aero DMG' },
    { value: 'spectro', label: 'Spectro DMG' },
    { value: 'havoc', label: 'Havoc DMG' },
  ] satisfies LiquidSelectOption<string>[]
  const sequenceOptions = useMemo(
    () => Array.from({ length: 7 }, (_, index) => ({
      value: index,
      label: `S${index}`,
    })),
    [],
  )

  const mainStatOptions = useMemo(
    () => [
      { value: 'atk%', label: 'ATK%', short: 'ATK%' },
      { value: 'hp%', label: 'HP%', short: 'HP%' },
      { value: 'def%', label: 'DEF%', short: 'DEF%' },
      { value: 'er', label: 'Energy Regen', short: 'ER' },
      { value: 'cr', label: 'Crit. Rate', short: 'CR' },
      { value: 'cd', label: 'Crit. DMG', short: 'CD' },
      {
        value: 'bonus',
        label: 'Ele. DMG Bonus',
        short: selectedBonus ? BONUS_SHORT_LABELS[selectedBonus] : 'DMG%',
      },
      { value: 'healing', label: 'Healing Bonus', short: 'Heal' },
    ],
    [selectedBonus],
  )

  const targetOptions = targetMode === 'combo' ? comboOptions : skillOptions
  const targetGroups = targetMode === 'combo' ? undefined : skillGroups
  const targetValue = targetMode === 'combo' ? (targetComboId ?? '') : (targetSkillId ?? '')
  const targetLabel = targetMode === 'combo' ? 'Target Combo' : 'Target Skill'
  const targetPlaceholder = targetMode === 'combo' ? 'Select combo' : 'Select skill'
  const weaponId = optimizerRuntime?.build.weapon.id ?? null
  const resonatorStates = useMemo(() => {
    if (!optimizerRuntime) {
      return []
    }

    return listStatesForSource('resonator', optimizerRuntime.id)
      .filter((state) => evaluateSourceStateVisibility(optimizerRuntime, optimizerRuntime, state, optimizerRuntime))
  }, [optimizerRuntime])
  const weaponDef = useMemo(
    () => (weaponId && !isUnsetWeaponId(weaponId) ? getWeapon(weaponId) : null),
    [weaponId],
  )
  const weaponStates = useMemo(() => {
    if (!optimizerRuntime || !weaponId || isUnsetWeaponId(weaponId)) {
      return []
    }

    return listStatesForSource('weapon', weaponId)
      .filter((state) => evaluateSourceStateVisibility(optimizerRuntime, optimizerRuntime, state, optimizerRuntime))
  }, [optimizerRuntime, weaponId])

  const renderRuntimeState = (runtime: ResonatorRuntimeState, state: SourceStateDefinition) => {
    const display = getSourceStateDisplay(state)
    const currentValue = readRuntimePath(runtime, state.path)
    const isEnabled = isSourceStateEnabled(runtime, runtime, state, runtime)

    if (state.kind === 'toggle') {
      const checked = toBoolean(currentValue ?? state.defaultValue, false)
      return (
        <div
          key={state.controlKey}
          className={`co-runtime-state${checked ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
        >
          <span className="co-runtime-state__label">{display.label}</span>
          <label className="co-runtime-state__toggle">
            <input
              type="checkbox"
              checked={checked}
              disabled={!isEnabled}
              onChange={(event) => {
                setSourceStateValue(onOptimizerRuntimeUpdate, runtime, state, event.target.checked)
              }}
            />
            <span className="co-runtime-state__switch" />
          </label>
        </div>
      )
    }

    if (state.kind === 'stack') {
      const min = Math.max(0, Math.floor(state.min ?? 0))
      const defaultStack = toNumber(state.defaultValue, min)
      const max = Math.max(min, Math.floor(state.max ?? defaultStack))
      const stackValue = toNumber(currentValue ?? state.defaultValue, min)
      return (
        <div
          key={state.controlKey}
          className={`co-runtime-state${stackValue > min ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
        >
          <span className="co-runtime-state__label">{display.label}</span>
          <div className="co-runtime-state__stack">
            {Array.from({ length: max - min + 1 }, (_, offset) => {
              const value = min + offset
              return (
                <button
                  key={value}
                  type="button"
                  className={`co-runtime-state__stack-btn${value === stackValue ? ' is-active' : ''}`}
                  disabled={!isEnabled}
                  onClick={() => {
                    setSourceStateValue(onOptimizerRuntimeUpdate, runtime, state, value)
                  }}
                >
                  {value}
                </button>
              )
            })}
          </div>
        </div>
      )
    }

    if (state.kind === 'select' && state.options) {
      const selectedValue = String(currentValue ?? state.defaultValue ?? state.options[0]?.id ?? '')
      const isActive = toNumber(selectedValue, 0) > 0
      return (
        <div
          key={state.controlKey}
          className={`co-runtime-state${isActive ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
        >
          <span className="co-runtime-state__label">{display.label}</span>
          <div className="co-runtime-state__select">
            <LiquidSelect
              value={selectedValue}
              options={state.options.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
              onChange={(value) => {
                setSourceStateValue(onOptimizerRuntimeUpdate, runtime, state, value)
              }}
              disabled={!isEnabled}
              baseClass="co-runtime-select"
              ariaLabel={display.label}
              preferredPlacement="down"
            />
          </div>
        </div>
      )
    }

    const min = state.min ?? 0
    const max = state.max
    const numericValue = toNumber(currentValue ?? state.defaultValue, min)
    return (
      <div
        key={state.controlKey}
        className={`co-runtime-state${numericValue > 0 ? ' is-active' : ''}${!isEnabled ? ' is-disabled' : ''}`}
      >
        <span className="co-runtime-state__label">{display.label}</span>
        <div className="co-runtime-state__number">
          <NumberInput
            value={numericValue}
            min={min}
            max={max}
            step={0.1}
            disabled={!isEnabled}
            onChange={(value) => {
              setSourceStateValue(onOptimizerRuntimeUpdate, runtime, state, value)
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="co">
      <div className="co-split">
        <div className="co-portrait">
          <button
            type="button"
            className={`co-portrait__ring co-portrait__ring-button rarity-${rarity}`}
            onClick={onOpenResonatorPicker}
            aria-label="Open resonator picker"
          >
            <img src={imageSrc} alt={displayName} className="co-portrait__img" loading="eager" />
          </button>
          <div className="co-portrait__caption">
            <h2 className="co-portrait__name">{displayName}</h2>
            <div className="co-portrait__meta">
              <span className="co-badge">Lvl {level}</span>
              <span className="co-badge co-badge--lit">S{sequence}</span>
            </div>
            <button type="button" className="co-portrait__sync" onClick={onSyncLive}>
              Sync Live
            </button>
          </div>
        </div>

        <div className="co-config">
          <div className="co-skill-bar">
            <div className="co-topbar-fields">
              <div className="co-topbar-field">
                <span className="co-topbar-field__label">Level</span>
                <div className="co-topbar-input">
                  <NumberInput
                    value={level}
                    min={1}
                    max={90}
                    step={1}
                    onChange={(value) => {
                      onOptimizerRuntimeUpdate((prev) => ({
                        ...prev,
                        base: {
                          ...prev.base,
                          level: Math.max(1, Math.min(90, Math.round(value))),
                        },
                      }))
                    }}
                  />
                </div>
              </div>
              <span className="co-bar__sep" />
              <div className="co-topbar-field">
                <span className="co-topbar-field__label">Sequence</span>
                <LiquidSelect
                  value={sequence}
                  options={sequenceOptions}
                  onChange={(value) => {
                    onOptimizerRuntimeUpdate((prev) => ({
                      ...prev,
                      base: {
                        ...prev.base,
                        sequence: value,
                      },
                      }))
                  }}
                  baseClass="co-topbar-select"
                  ariaLabel="Optimizer sequence"
                  preferredPlacement="down"
                />
              </div>
            </div>
            <span className="co-bar__sep" />
            <LiquidSelect
              value={targetValue}
              options={targetOptions}
              groups={targetGroups}
              onChange={targetMode === 'combo' ? onTargetComboChange : onTargetSkillChange}
              placeholder={targetPlaceholder}
              baseClass="co-skill-select"
              ariaLabel={targetLabel}
              disabled={targetOptions.length === 0}
              preferredPlacement="down"
              triggerClassName="co-skill-bar__main"
              renderTriggerContent={(selectedOption, placeholder) => (
                <>
                  <Crosshair size={15} className="co-skill-bar__icon" />
                  <div className="co-skill-bar__text">
                    <span className="co-skill-bar__label">{targetLabel}</span>
                    <span
                      className={
                        selectedOption
                          ? 'co-skill-bar__value'
                          : 'co-skill-bar__value co-skill-bar__value--placeholder'
                      }
                    >
                      {selectedOption?.label ?? placeholder}
                    </span>
                  </div>
                  <ChevronDown size={16} className="co-skill-bar__chevron" />
                </>
              )}
            />
            <span className="co-bar__sep" />
            <div className="co-switches">
              <div className="co-switch">
                <button
                    type="button"
                    className={`co-switch__opt${targetMode === 'skill' ? ' on' : ''}`}
                    onClick={() => onTargetModeChange('skill')}
                >
                  <SiBattledotnet size={13}/>
                  Skill
                </button>
                <button
                    type="button"
                    className={`co-switch__opt${targetMode === 'combo' ? ' on' : ''}`}
                    onClick={() => onTargetModeChange('combo')}
                >
                  <SiBattledotnet size={13}/>
                  Combo
                </button>
              </div>
              <div className="co-switch">
                <button
                  type="button"
                  className={`co-switch__opt${enableGpu ? ' on' : ''}`}
                  onClick={() => onEnableGpuChange(true)}
                >
                  <Cpu size={13} />
                  GPU
                </button>
                <button
                  type="button"
                  className={`co-switch__opt${!enableGpu ? ' on' : ''}`}
                  onClick={() => onEnableGpuChange(false)}
                >
                  <Cpu size={13} />
                  CPU
                </button>
              </div>
              <div className="co-switch">
                <button
                  type="button"
                  className={`co-switch__opt${useSplash ? ' on' : ''}`}
                  onClick={() => setIsSprite?.(true)}
                >
                  <Image size={13} />
                  Sprite
                </button>
                <button
                  type="button"
                  className={`co-switch__opt${!useSplash ? ' on' : ''}`}
                  onClick={() => setIsSprite?.(false)}
                >
                  <Image size={13} />
                  Icon
                </button>
              </div>
            </div>
          </div>

          <div className="co-mosaic">
            <section className="co-tile co-tile--resonator">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Resonator</h3>
              </div>

              {optimizerRuntime && resonatorStates.length > 0 ? (
                <div className="co-runtime-states">
                  {resonatorStates.map((state) => renderRuntimeState(optimizerRuntime, state))}
                </div>
              ) : (
                <div className="co-runtime-state__empty">
                  No resonator runtime controls.
                </div>
              )}
            </section>
            <section className="co-tile co-tile--weapon">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Weapon</h3>
              </div>

              <div className="co-weapon-card">
                <div className="co-weapon-card__icon-wrap">
                  <img
                    src={weaponDef?.icon ?? '/assets/weapon-icons/default.webp'}
                    alt={weaponDef?.name ?? 'Weapon'}
                    className="co-weapon-card__icon"
                    loading="lazy"
                    onError={withDefaultWeaponImage}
                  />
                </div>
                <div className="co-weapon-card__copy">
                  <strong className="co-weapon-card__name">{weaponDef?.name ?? 'No Weapon'}</strong>
                </div>
              </div>

              {optimizerRuntime && weaponStates.length > 0 ? (
                <div className="co-runtime-states">
                  {weaponStates.map((state) => renderRuntimeState(optimizerRuntime, state))}
                </div>
              ) : (
                <div className="co-runtime-state__empty">
                  No weapon runtime controls.
                </div>
              )}
            </section>
            <section className="co-tile co-tile--filters">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Filters</h3>
                <Info size={13} className="co-tile__info" />
              </div>

              <div className="co-field">
                <span className="co-field__label">Main Echo</span>
                <button type="button" className="co-chip" onClick={onOpenMainEchoPicker}>
                  {mainEcho ? (
                    <>
                      <img src={mainEcho.icon} alt={mainEcho.name} className="co-trigger__ico" loading="lazy" />
                      {mainEcho.name}
                      <span
                        className="co-trigger__x"
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          event.stopPropagation()
                          onClearMainEchoSelection()
                        }}
                      >
                        <X size={11} strokeWidth={3} />
                      </span>
                    </>
                  ) : (
                    <>Select echo</>
                  )}
                </button>
              </div>

              <div className="co-field">
                <span className="co-field__label">Allowed Sets</span>
                <AllowedSetDropdown
                  selectedIdsByPiece={allowedSets}
                  onChange={onAllowedSetsChange}
                />
              </div>

              <div className="co-field">
                <span className="co-field__label">Conditionals</span>
                <button type="button" className="co-chip" onClick={onOpenSetConditionals}>
                  Set Conditionals
                  <ChevronDown size={12} />
                </button>
              </div>

              <div className="co-field">
                <div className="co-tile__head">
                  <span className="co-field__label">Main Stat Filters</span>
                  {mainStatFilter.length > 0 ? (
                    <button className="co-clear" onClick={onClearAllFilters}>
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="co-tags">
                  {mainStatOptions.map((option) => {
                    if (option.value === 'bonus') {
                      const isActive = mainStatFilter.includes('bonus')
                      return (
                        <LiquidSelect
                          key={option.value}
                          value={selectedBonus ?? ''}
                          options={bonusOptions}
                          onChange={onPickBonus}
                          placeholder={option.short}
                          baseClass="co-tag-select"
                          className={isActive ? 'on' : ''}
                          preferredPlacement="down"
                        />
                      )
                    }

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`co-tag${mainStatFilter.includes(option.value) ? ' on' : ''}`}
                        onClick={() => onToggleMainStat(option.value)}
                        title={option.label}
                      >
                        {option.short}
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            <section className="co-tile co-tile--stats">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Range Limits</h3>
              </div>

              <div className="co-limits">
                {STAT_LIST.map(({ key: statKey, label }) => {
                  const current = statConstraints[statKey] ?? {}
                  return (
                    <div className="co-limit" key={statKey}>
                      <span className="co-limit__name">{label}</span>
                      <input
                        className="co-limit__in"
                        placeholder="min"
                        type="number"
                        value={current.minTotal ?? ''}
                        onChange={(event) => onStatLimitChange(statKey, 'minTotal', event.target.value)}
                      />
                      <span className="co-limit__dash" />
                      <input
                        className="co-limit__in"
                        placeholder="max"
                        type="number"
                        value={current.maxTotal ?? ''}
                        onChange={(event) => onStatLimitChange(statKey, 'maxTotal', event.target.value)}
                      />
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

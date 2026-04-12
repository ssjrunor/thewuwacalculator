import { useMemo } from 'react'
import { ChevronDown, Crosshair, Cpu, Image, Info, X } from 'lucide-react'
import type { OptimizerSetSelections, OptimizerStatConstraint } from '@/domain/entities/optimizer'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import type { LiquidSelectOption, LiquidSelectOptionGroup } from '@/shared/ui/LiquidSelect'
import { LiquidSelect } from '@/shared/ui/LiquidSelect'
import {
  type RuntimeUpdateHandler,
} from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { ManualBuffsAdvancedModal } from './ManualBuffsAdvancedModal'
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
  skillOptions: LiquidSelectOption[]
  skillGroups?: LiquidSelectOptionGroup[]
  comboOptions: LiquidSelectOption[]
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
  ] satisfies LiquidSelectOption[]

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

  const advBuffsModal = useAnimatedVisibility(320)
  const portalTarget = getMainContentPortalTarget()

  const updateQuickBaseStat = (stat: 'atk' | 'hp' | 'def', field: 'flat' | 'percent', raw: number) => {
    const max = field === 'flat' ? 9999 : 999
    const val = Math.max(0, Math.min(max, raw))
    onOptimizerRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: {
            ...prev.state.manualBuffs.quick,
            [stat]: { ...prev.state.manualBuffs.quick[stat], [field]: val },
          },
        },
      },
    }))
  }

  const updateQuickScalar = (key: 'critRate' | 'critDmg' | 'energyRegen' | 'healingBonus', raw: number) => {
    const val = Math.max(0, Math.min(999, raw))
    onOptimizerRuntimeUpdate((prev) => ({
      ...prev,
      state: {
        ...prev.state,
        manualBuffs: {
          ...prev.state.manualBuffs,
          quick: { ...prev.state.manualBuffs.quick, [key]: val },
        },
      },
    }))
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
                      <div className="co-limit__range">
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
                    </div>
                  )
                })}
              </div>
            </section>
            <section className="co-tile co-tile--resonator">
              <div className="co-tile__head">
                <h3 className="co-tile__title">Manual Buffs</h3>
              </div>

              {optimizerRuntime ? (
                <div className="co-qbuff">
                  <div className="co-qbuff-duals">
                    {(
                      [
                        { label: 'ATK', stat: 'atk' as const },
                        { label: 'HP',  stat: 'hp'  as const },
                        { label: 'DEF', stat: 'def' as const },
                      ]
                    ).map(({ label, stat }) => (
                      <div key={stat} className="co-qbuff-row">
                        <span className="co-qbuff-label">{label}</span>
                        <div className="co-qbuff-inputs">
                          <input
                            type="number"
                            className="co-qbuff-in"
                            min={0}
                            max={9999}
                            value={optimizerRuntime.state.manualBuffs.quick[stat].flat}
                            onChange={(e) => updateQuickBaseStat(stat, 'flat', Number(e.target.value) || 0)}
                          />
                          <div className="co-qbuff-in-pct">
                            <input
                              type="number"
                              className="co-qbuff-in"
                              min={0}
                              max={999}
                              value={optimizerRuntime.state.manualBuffs.quick[stat].percent}
                              onChange={(e) => updateQuickBaseStat(stat, 'percent', Number(e.target.value) || 0)}
                            />
                            <span className="co-qbuff-suffix">%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="co-qbuff-scalars">
                    {(
                      [
                        { label: 'CR%',  key: 'critRate'     as const },
                        { label: 'CD%',  key: 'critDmg'      as const },
                        { label: 'ER%',  key: 'energyRegen'  as const },
                        { label: 'HB%',  key: 'healingBonus' as const },
                      ]
                    ).map(({ label, key }) => (
                      <div key={key} className="co-qbuff-scalar">
                        <span className="co-qbuff-label co-qbuff-label--sm">{label}</span>
                        <div className="co-qbuff-in-pct">
                          <input
                            type="number"
                            className="co-qbuff-in"
                            min={0}
                            max={999}
                            value={optimizerRuntime.state.manualBuffs.quick[key]}
                            onChange={(e) => updateQuickScalar(key, Number(e.target.value) || 0)}
                          />
                          <span className="co-qbuff-suffix">%</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="co-qbuff-adv-btn"
                    onClick={advBuffsModal.show}
                  >
                    <span className="co-qbuff-adv-label">Advanced Modifiers</span>
                    {optimizerRuntime.state.manualBuffs.modifiers.length > 0 && (
                      <span className="co-qbuff-adv-count">
                        {optimizerRuntime.state.manualBuffs.modifiers.length}
                      </span>
                    )}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        </div>
      </div>

      {optimizerRuntime && advBuffsModal.visible && (
        <ManualBuffsAdvancedModal
          visible={advBuffsModal.visible}
          open={advBuffsModal.open}
          closing={advBuffsModal.closing}
          portalTarget={portalTarget}
          onClose={advBuffsModal.hide}
          runtime={optimizerRuntime}
          onRuntimeUpdate={onOptimizerRuntimeUpdate}
        />
      )}
    </div>
  )
}

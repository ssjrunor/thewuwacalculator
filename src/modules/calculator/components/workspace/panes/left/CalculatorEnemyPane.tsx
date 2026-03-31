import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState'
import type { EnemyClassId, EnemyElementId } from '@/domain/entities/enemy'
import { ENEMY_CLASS_LABELS, ENEMY_PRESETS, getEnemyIconPath } from '@/domain/entities/enemy'
import type { ResonatorRuntimeState } from '@/domain/entities/runtime'
import { filterEnemyCatalog, getEnemyCatalogEntryById } from '@/domain/services/enemyCatalogService'
import { EnemyPickerModal } from '@/modules/calculator/components/workspace/panes/left/modals/EnemyPickerModal'
import {
  getEnemyResistanceRows,
  getEnemyTuneStrain,
  getResolvedEnemyClass,
  isCustomEnemyProfile,
  selectCatalogEnemyProfile,
  selectEnemyPreset,
  setEnemyClass,
  setEnemyLevel,
  setEnemyResistance,
  setEnemyTuneStrain,
  toggleEnemyTowerMode,
} from '@/domain/services/enemyProfileService'
import { useEnemyCatalog } from '@/app/hooks/useEnemyCatalog.ts'
import { NumberInput } from '@/modules/calculator/components/workspace/panes/left/controls/NumberInput'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { withDefaultIconImage } from '@/shared/lib/imageFallback'
import { clampNumber } from '@/shared/lib/number'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'

interface CalculatorEnemyPaneProps {
  runtime: ResonatorRuntimeState
  enemyProfile: EnemyProfile
  onRuntimeUpdate: (updater: (runtime: ResonatorRuntimeState) => ResonatorRuntimeState) => void
  onEnemyProfileChange: (enemy: EnemyProfile) => void
}

// manages the enemy tuning panel and pushes the adjusted profile back into the runtime state.
const MODAL_EXIT_DURATION_MS = 300
const ENEMY_CLASS_OPTIONS: EnemyClassId[] = [1, 2, 3, 4]
const ENEMY_ELEMENT_OPTIONS: EnemyElementId[] = [0, 4, 3, 2, 1, 5, 6]

interface SliderControlProps {
  label: string
  value: number
  min: number
  max: number
  accent?: string
  helper?: string
  onChange: (value: number) => void
}

function SliderControl({
  label,
  value,
  min,
  max,
  accent,
  helper,
  onChange,
}: SliderControlProps) {
  const ratio = max === min ? 0 : ((value - min) / (max - min)) * 100

  return (
    <div className="enemy-slider">
      <div className="enemy-slider__meta">
        <div>
          <strong>{label}</strong>
          {helper ? <p>{helper}</p> : null}
        </div>
        <NumberInput value={value} min={min} max={max} onChange={(next) => onChange(clampNumber(next, min, max))} />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
        style={
          {
            '--slider-color': accent ?? 'var(--resonator-accent)',
            '--slider-fill': `${ratio}%`,
          } as CSSProperties
        }
      />
    </div>
  )
}

export function CalculatorEnemyPane({
  runtime,
  enemyProfile,
  onRuntimeUpdate,
  onEnemyProfileChange,
}: CalculatorEnemyPaneProps) {
  const enemyPicker = useAnimatedVisibility(MODAL_EXIT_DURATION_MS)
  const modalPortalTarget = getMainContentPortalTarget()
  const { catalog, loading, error } = useEnemyCatalog()
  const [search, setSearch] = useState('')
  const [selectedElement, setSelectedElement] = useState<EnemyElementId | null>(null)
  const [selectedClass, setSelectedClass] = useState<EnemyClassId | null>(null)

  const selectedEnemy = useMemo(
    () => getEnemyCatalogEntryById(catalog, enemyProfile.id),
    [catalog, enemyProfile.id],
  )

  const filteredEnemies = useMemo(
    () =>
      filterEnemyCatalog(catalog, {
        search,
        element: selectedElement,
        enemyClass: selectedClass,
      }),
    [catalog, search, selectedClass, selectedElement],
  )

  const combatState = runtime.state.combat
  const isCustomMode = isCustomEnemyProfile(enemyProfile)
  const tuneStrain = getEnemyTuneStrain(enemyProfile)
  const enemyClass = getResolvedEnemyClass(enemyProfile)
  const resistanceRows = getEnemyResistanceRows(enemyProfile, ENEMY_ELEMENT_OPTIONS)
  const selectedEnemyIcon = selectedEnemy?.icon ?? getEnemyIconPath(enemyProfile.id) ?? '/assets/default-icon.webp'

  const openPicker = () => {
    enemyPicker.show()
  }

  const closePicker = () => {
    enemyPicker.hide()
  }

  const handleEnemySelect = (enemyId: string) => {
    const nextEnemy = getEnemyCatalogEntryById(catalog, enemyId)
    if (!nextEnemy) {
      return
    }

    onEnemyProfileChange(selectCatalogEnemyProfile(enemyProfile, nextEnemy))
    closePicker()
  }

  const handlePresetSelect = (presetId: string) => {
    const preset = ENEMY_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) {
      return
    }

    onEnemyProfileChange(selectEnemyPreset(enemyProfile, preset))
  }

  const handleToaToggle = (nextToa: boolean) => {
    onEnemyProfileChange(toggleEnemyTowerMode(enemyProfile, selectedEnemy, nextToa))
  }

  const handleTuneStrainChange = (nextValue: number) => {
    onEnemyProfileChange(setEnemyTuneStrain(enemyProfile, nextValue))
  }

  const handleCombatStateChange = (
    key: keyof ResonatorRuntimeState['state']['combat'],
    nextValue: number,
    min: number,
    max: number,
  ) => {
    onRuntimeUpdate((currentRuntime) => ({
      ...currentRuntime,
      state: {
          ...currentRuntime.state,
          combat: {
            ...currentRuntime.state.combat,
            [key]: clampNumber(nextValue, min, max),
          },
        },
      }))
  }

  return (
    <section className="calc-pane enemy-pane-v2">
      <div className="enemy-pane-v2__hero">
        <div className="enemy-pane-v2__hero-copy">
          <span className="panel-overline">Enemy Tuning</span>
          <h3>Scenario Target</h3>
        </div>

      </div>

      <div className="pane-section enemy-pane-v2__stage">
        <div className="enemy-pane-v2__stage-top">
          <button type="button" className="resonator-avatar-button" onClick={openPicker}>
            <div className="enemy-stage-card__media">
            </div>
            <img
                src={selectedEnemyIcon}
                alt={selectedEnemy?.name ?? 'Enemy'}
                className="resonator-avatar resonator-avatar--sprite"
                onError={withDefaultIconImage}
            />
          </button>
          <div className="resonator-heading">
            <div className="panel-overline">{isCustomMode
                ? `${ENEMY_CLASS_LABELS[enemyClass]} · editable profile`
                : selectedEnemy
                    ? ENEMY_CLASS_LABELS[selectedEnemy.class]
                    : "Select an enemy from the catalog"}</div>
            <div className="resonator-heading-top">
              <h3>{isCustomMode ? 'Preset Scenario' : selectedEnemy?.name ?? 'Choose an enemy'}</h3>
              <div className="resonator-heading-badges">
                <span className="hero-badge">Lv {enemyProfile.level}</span>
                <span className="hero-badge">Class {enemyClass}</span>
              </div>
            </div>
            <div className="resonator-heading-subline">
              <div className="enemy-pane-v2__mode-switch">
                <button
                    type="button"
                    className={enemyProfile.toa ? 'enemy-toggle active' : 'enemy-toggle'}
                    onClick={() => handleToaToggle(true)}
                >
                  Tower
                </button>
                <button
                    type="button"
                    className={!enemyProfile.toa ? 'enemy-toggle active' : 'enemy-toggle'}
                    onClick={() => handleToaToggle(false)}
                >
                  Field
                </button>
              </div>
              <span className="enemy-stage-card__eyebrow">{isCustomMode ? 'Custom Scenario' : 'Catalog Enemy'}</span>
            </div>
          </div>
          {/*<div className="enemy-stage-card__copy">
            <span className="enemy-stage-card__eyebrow">{isCustomMode ? 'Custom Scenario' : 'Catalog Enemy'}</span>
            <strong>{isCustomMode ? 'Preset Scenario' : selectedEnemy?.name ?? 'Choose an enemy'}</strong>
            <span>
                {isCustomMode
                    ? `${ENEMY_CLASS_LABELS[enemyClass]} · editable profile`
                    : selectedEnemy
                        ? ENEMY_CLASS_LABELS[selectedEnemy.class]
                        : "Select an enemy from the catalog"}
              </span>
          </div>*/}
        </div>

      </div>

      <div className="pane-section enemy-pane-v2__profile-grid">
        <div className="enemy-slider">
          <div className="enemy-slider__meta">
            <span className="enemy-profile-tile__label">Level</span>
            <div className="enemy-profile-tile__value-row">
              <NumberInput
                  value={enemyProfile.level}
                  min={1}
                  max={150}
                  onChange={(value) => onEnemyProfileChange(setEnemyLevel(enemyProfile, value))}
              />
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={150}
            value={enemyProfile.level}
            onChange={(event) => onEnemyProfileChange(setEnemyLevel(enemyProfile, Number(event.target.value)))}
            style={
              {
                '--slider-color': 'var(--resonator-accent)',
                '--slider-fill': `${((enemyProfile.level - 1) / 149) * 100}%`,
              } as CSSProperties
            }
          />
        </div>

        {isCustomMode ? (
            <div className="enemy-slider">
              <span className="enemy-profile-tile__label">Class</span>
              <div className="enemy-class-radio-group" role="radiogroup" aria-label="Enemy class">
                {ENEMY_CLASS_OPTIONS.map((classId) => (
                    <button
                        key={classId}
                        type="button"
                        className={enemyClass === classId ? 'enemy-class-radio active' : 'enemy-class-radio'}
                        onClick={() => onEnemyProfileChange(setEnemyClass(enemyProfile, classId))}
                    >
                      <span className="enemy-class-radio__dot" />
                      {ENEMY_CLASS_LABELS[classId]}
                    </button>
                ))}
              </div>
            </div>
        ) : null}
      </div>

      <div className="pane-section">
        <div className="enemy-pane-v2__section-head">
          <div><h4>Resistances</h4></div>
        </div>

        <div className="enemy-res-grid">
          {resistanceRows.map(({ elementId, label, attributeKey, value }) => (
            <div key={elementId} className={isCustomMode ? 'enemy-res-card editable' : 'enemy-res-card'}>
              <div className="enemy-res-card__head">
                <span className="enemy-res-card__label">
                  <img
                    src={`/assets/attributes/attributes alt/${attributeKey}.webp`}
                    alt=""
                    aria-hidden="true"
                    style={attributeKey === 'physical' ? { filter: 'grayscale(1) brightness(0.6)' } : undefined}
                  />
                  {label}
                </span>
                {isCustomMode ? (
                  <NumberInput
                    value={value}
                    min={-100}
                    max={200}
                    onChange={(nextValue) => onEnemyProfileChange(setEnemyResistance(enemyProfile, elementId, nextValue))}
                  />
                ) : (
                  <strong>{value}%</strong>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="pane-section">
        <div className="enemy-pane-v2__section-head">
          <div><h4>Tunability</h4></div>
        </div>

        <SliderControl
          label="Tune Strain"
          value={tuneStrain}
          min={0}
          max={10}
          accent="#c9b35d"
          onChange={handleTuneStrainChange}
        />
      </div>

      <div className="pane-section">
        <div className="enemy-pane-v2__section-head">
          <div><h4>Negative Effects</h4></div>
        </div>

        <div className="enemy-slider-grid">
          <SliderControl
            label="Spectro Frazzle"
            value={combatState.spectroFrazzle}
            min={0}
            max={60}
            accent="rgb(202,179,63)"
            onChange={(value) => handleCombatStateChange('spectroFrazzle', value, 0, 60)}
          />
          <SliderControl
            label="Aero Erosion"
            value={combatState.aeroErosion}
            min={0}
            max={12}
            accent="rgb(15,205,160)"
            onChange={(value) => handleCombatStateChange('aeroErosion', value, 0, 12)}
          />
          <SliderControl
            label="Fusion Burst"
            value={combatState.fusionBurst}
            min={0}
            max={13}
            accent="rgb(197,52,79)"
            onChange={(value) => handleCombatStateChange('fusionBurst', value, 0, 13)}
          />
          <SliderControl
            label="Havoc Bane"
            value={combatState.havocBane}
            min={0}
            max={6}
            accent="rgb(172,9,96)"
            onChange={(value) => handleCombatStateChange('havocBane', value, 0, 6)}
          />
          <SliderControl
              label="Electro Flare"
              value={combatState.electroFlare}
              min={0}
              max={13}
              accent="rgb(167,13,209)"
              onChange={(value) => handleCombatStateChange('electroFlare', value, 0, 13)}
          />
        </div>
      </div>

      <div className="pane-section enemy-pane-v2__presets">
        <div className="enemy-pane-v2__section-head">
          <div><h4>Presets</h4></div>
        </div>

        <div className="enemy-preset-grid">
          {ENEMY_PRESETS.map((preset) => (
              <button
                  key={preset.id}
                  type="button"
                  className="chip"
                  onClick={() => handlePresetSelect(preset.id)}
              >
                {preset.label}
              </button>
          ))}
        </div>
      </div>

      <EnemyPickerModal
        visible={enemyPicker.visible}
        open={enemyPicker.open}
        closing={enemyPicker.closing}
        portalTarget={modalPortalTarget}
        enemies={filteredEnemies}
        selectedEnemyId={selectedEnemy?.id ?? null}
        search={search}
        selectedElement={selectedElement}
        selectedClass={selectedClass}
        loading={loading}
        error={error}
        onSearchChange={setSearch}
        onElementChange={setSelectedElement}
        onClassChange={setSelectedClass}
        onSelect={handleEnemySelect}
        onClose={closePicker}
      />
    </section>
  )
}

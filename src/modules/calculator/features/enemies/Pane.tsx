/*
  Author: Runor Ewhro
  Description: renders the pane surface for the calculator enemies flow.
*/

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties as CssProps, ReactNode } from 'react'
import type { EnemyProfile, EnemyStateValue } from '@/domain/entities/appState.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { EnemyClassId, EnemyElemId } from '@/domain/entities/enemy.ts'
import { ENEMY_CLASS_TXT, ENEMY_PRST, getEnemyIcon } from '@/domain/entities/enemy.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { NEG_EFFECT_ELEM, negEffectsFor } from '@/domain/gameData/negativeEffects.ts'
import { fltrEnemyCat, getEnemyCatE } from '@/domain/services/enemyCatalogService.ts'
import { EnemyPicker } from '@/modules/calculator/features/enemies/Picker.tsx'
import {
  getEnemyReys,
  getEnemyState,
  getEnemyTune,
  getRslvEnemy,
  isCustEnemyP,
  selCatEnemyP,
  selEnemyPrst,
  setEnemyClss,
  setEnemyLvl,
  setEnemyResi,
  setEnemyState,
  setEnemyTune,
  tglEnemyTwrM,
} from '@/domain/services/enemyProfileService.ts'
import { listEffectsFor, listStatesFor } from '@/domain/services/gameDataService.ts'
import { useEnemyCat } from '@/app/hooks/useEnemyCatalog.ts'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { StackGauge } from '@/modules/calculator/features/controls/StackGauge.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { clampNumber } from '@/shared/lib/number.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { ATTR_ID_COLORS } from "@/modules/calculator/model/display.ts";

interface CalcEnemyPan {
  runtime: ResRuntime
  enemyProfile: EnemyProfile
  simulation: SimResult | null
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
  onEnemyChange: (enemy: EnemyProfile) => void
}

// manages the enemy tuning panel and pushes the adjusted profile back into the runtime state.
const ENEMYCLSSPTN: EnemyClassId[] = [1, 2, 3, 4]
const ENEMYELEMPTN: EnemyElemId[] = [0, 4, 3, 2, 1, 5, 6]

// damage resistance multiplier mirrors the engine's resistMult() in
// src/engine/formulas/damage.ts. converts an effective res% after shred
// into the decimal multiplier that scales damage in the pipeline.
function resistMultiplier(enemyResPct: number): number {
  if (enemyResPct < 0) return 1 - enemyResPct / 200
  if (enemyResPct < 75) return 1 - enemyResPct / 100
  return 1 / (1 + 5 * (enemyResPct / 100))
}

interface EnemyStateCtrlPrps {
  state: SourceState
  value: EnemyStateValue | undefined
  onChange: (value: EnemyStateValue) => void
}

// renders a single enemy debuff state as a control panel: name, description, then the control,
// matching the resonator/weapon source-state panels.
function EnemyStateCtrl({ state, value, onChange }: EnemyStateCtrlPrps) {
  const display = getStateText(state)
  let control: ReactNode

  if (state.kind === 'toggle') {
    const checked = typeof value === 'boolean' ? value : Boolean(state.defaultValue)
    control = (
      <div className="state-control-field">
        <label className="toggle-row">
          <span>{display.label}</span>
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
          />
        </label>
      </div>
    )
  } else if (state.kind === 'select' && state.options && state.options.length > 0) {
    const current = typeof value === 'string'
      ? value
      : String(state.defaultValue ?? state.options[0]?.id ?? '')
    // mirror the resonator/weapon source-state highlight: a non-zero selection
    // marks the state active and tints the control border.
    const selNum = Number(current)
    const isActive = Number.isFinite(selNum) && selNum > 0

    control = (
      <div className="state-control-field">
        <label className={isActive ? 'state-control-label is-active' : 'state-control-label'}>
          {display.label}
          <LiquidSelect
            value={current}
            options={state.options.map((option) => ({ value: option.id, label: option.label }))}
            onChange={(next) => onChange(next)}
          />
        </label>
      </div>
    )
  } else {
    const min = state.min ?? 0
    const max = state.max
    const numeric = typeof value === 'number' ? value : Number(state.defaultValue ?? 0)
    const isActive = numeric > min
    control = (
      <div className="state-control-field">
        <label className={isActive ? 'state-control-label is-active' : 'state-control-label'}>
          {display.label}
          <NumberInput
            value={numeric}
            min={min}
            max={max}
            step={state.kind === 'stack' ? 1 : 0.1}
            onChange={(next) => onChange(clampNumber(next, min, max ?? Number.MAX_SAFE_INTEGER))}
          />
        </label>
      </div>
    )
  }

  return (
    <>
      <h4>{display.label}</h4>
      {display.description ? <RichDscr description={display.description} /> : null}
      <div className="sequence-card-footer inherent-skill-footer">
        <div className="stack">{control}</div>
      </div>
    </>
  )
}

export function CalcEnemyPmg({
  runtime,
  enemyProfile,
  simulation,
  onRtPdt: onRtPdt,
  onEnemyChange: onNmyPrflChn,
}: CalcEnemyPan) {
  const enemyPicker = useAppModal()
  const mdlPrtlTgt = mainPortal()
  const { catalog, loading, error } = useEnemyCat()
  const [search, setSearch] = useState('')
  const [selLmnt, setSelLmnt] = useState<EnemyElemId | null>(null)
  const [selClss, setSelClss] = useState<EnemyClassId | null>(null)

  const selEnemy = useMemo(
    () => getEnemyCatE(catalog, enemyProfile.id),
    [catalog, enemyProfile.id],
  )

  const fltrNmsnq = useMemo(
    () =>
      fltrEnemyCat(catalog, {
        search,
        element: selLmnt,
        enemyClass: selClss,
      }),
    [catalog, search, selClss, selLmnt],
  )

  const combatState = runtime.state.combat
  const vsblNegFfct = useMemo(
    () => negEffectsFor(runtime),
    [runtime],
  )
  const djstNegFfct = useMemo(
    () => vsblNegFfct.filter((effect) => effect.sliderVisible),
    [vsblNegFfct],
  )
  const enemyStates = useMemo(
    () => listStatesFor('enemy', enemyProfile.id),
    [enemyProfile.id],
  )
  const enemyPassives = useMemo(
    () => listEffectsFor('enemy', enemyProfile.id).filter((effect) => Boolean(effect.description)),
    [enemyProfile.id],
  )
  const isCustomMode = isCustEnemyP(enemyProfile)
  const tuneStrain = getEnemyTune(enemyProfile)
  const enemyClass = getRslvEnemy(enemyProfile)
  const resistRows = getEnemyReys(enemyProfile, ENEMYELEMPTN)
  // mirrors the damage pipeline: enemy defense scales linearly with level.
  const enemyDef = 8 * enemyProfile.level + 792
  // the active build's flat res shred per element (attribute-level; skill-type-specific
  // shred is contextual and excluded). effective res = base − this.
  const ttrbBkt = simulation?.finalStats.attribute ?? null
  const resShredFor = (attributeKey: string): number =>
    ttrbBkt ? ttrbBkt.all.resShred + (ttrbBkt[attributeKey as AttributeKey]?.resShred ?? 0) : 0
  const selEnemyIcon = selEnemy?.icon ?? getEnemyIcon(enemyProfile.id) ?? '/assets/default.webp'

  useEffect(() => {
    const entsToClmp = vsblNegFfct.filter((effect) => combatState[effect.key] > effect.max)

    if (entsToClmp.length === 0) {
      return
    }

    onRtPdt((curRt) => {
      const nextCombat = { ...curRt.state.combat }
      let changed = false

      for (const effect of entsToClmp) {
        const currentValue = nextCombat[effect.key]
        if (currentValue > effect.max) {
          nextCombat[effect.key] = effect.max
          changed = true
        }
      }

      if (!changed) {
        return curRt
      }

      return {
        ...curRt,
        state: {
          ...curRt.state,
          combat: nextCombat,
        },
      }
    })
  }, [combatState, onRtPdt, vsblNegFfct])

  const openPicker = () => {
    enemyPicker.show()
  }

  const closePicker = () => {
    enemyPicker.hide()
  }

  const onEnemySel = (enemyId: string) => {
    const nextEnemy = getEnemyCatE(catalog, enemyId)
    if (!nextEnemy) {
      return
    }

    onNmyPrflChn(selCatEnemyP(enemyProfile, nextEnemy))
    closePicker()
  }

  const onPrstSel = (presetId: string) => {
    const preset = ENEMY_PRST.find((entry) => entry.id === presetId)
    if (!preset) {
      return
    }

    onNmyPrflChn(selEnemyPrst(enemyProfile, preset))
  }

  const onToaTgl = (nextToa: boolean) => {
    onNmyPrflChn(tglEnemyTwrM(enemyProfile, selEnemy, nextToa))
  }

  const onTuneStrnCh = (nextValue: number) => {
    onNmyPrflChn(setEnemyTune(enemyProfile, nextValue))
  }

  const onCmbtSttChn = (
    key: keyof ResRuntime['state']['combat'],
    nextValue: number,
    min: number,
    max: number,
  ) => {
    onRtPdt((curRt) => ({
      ...curRt,
      state: {
          ...curRt.state,
          combat: {
            ...curRt.state.combat,
            [key]: clampNumber(nextValue, min, max),
          },
        },
      }))
  }

  return (
    <section className="calc-pane enemy-pane-v2">
      <div className=" enemy-banner-card">
        <div className="enemy-banner">
          <div className="enemy-banner__top">
            <button
              type="button"
              className="resonator-avatar-button enemy-banner__avatar"
              aria-label="Open enemy selector"
              onClick={openPicker}
            >
              <span className="resonator-avatar-button__frame" aria-hidden="true" />
              <span className="resonator-avatar-button__media">
                <img
                  src={selEnemyIcon}
                  alt={selEnemy?.name ?? 'Enemy'}
                  className="resonator-avatar resonator-avatar--sprite"
                  onError={withDefIconM}
                />
              </span>
            </button>

            <div className="enemy-banner__id">
              <h3 className="enemy-banner__name">
                {isCustomMode ? 'Preset Scenario' : selEnemy?.name ?? 'Choose an enemy'}
              </h3>
              <div className="enemy-banner__meta">
                <span className="hero-chip">{ENEMY_CLASS_TXT[enemyClass ?? 1]}</span>
                <span className="hero-chip enemy-banner__lvchip">Lv.{enemyProfile.level}</span>
              </div>
            </div>

            <div className="enemy-banner__rail">
              <div className="enemy-mode-switch" role="group" aria-label="Scenario mode">
                <button
                  type="button"
                  className={enemyProfile.toa ? 'enemy-toggle is-active' : 'enemy-toggle'}
                  onClick={() => onToaTgl(true)}
                >
                  Tower
                </button>
                <button
                  type="button"
                  className={!enemyProfile.toa ? 'enemy-toggle is-active' : 'enemy-toggle'}
                  onClick={() => onToaTgl(false)}
                >
                  Field
                </button>
              </div>
              <div className="weapon-figure enemy-banner__def">
                <span className="weapon-figure__label">Defense</span>
                <strong className="weapon-figure__value">{enemyDef.toLocaleString()}</strong>
                <span className="enemy-banner__def-sub">at Lv.{enemyProfile.level}</span>
              </div>
            </div>
          </div>

          <div className="enemy-banner__stats">
            <div className="res-level enemy-banner__level">
              <div className="res-level__head">
                <span className="res-prog-label">Level</span>
                <span className="res-level__value">
                  <NumberInput
                    value={enemyProfile.level}
                    min={1}
                    max={120}
                    onChange={(value) => onNmyPrflChn(setEnemyLvl(enemyProfile, value))}
                  />
                  <span className="res-level__cap">/ 120</span>
                </span>
              </div>
              <div
                className="res-level__slider"
                style={{
                  '--slider-fill': `${((enemyProfile.level - 1) / 119) * 100}%`,
                  '--rl-fill-frac': `${(enemyProfile.level - 1) / 119}`,
                } as CssProps}
              >
                <input
                  type="range"
                  className="res-level__track"
                  min={1}
                  max={120}
                  value={enemyProfile.level}
                  onChange={(event) => onNmyPrflChn(setEnemyLvl(enemyProfile, Number(event.target.value)))}
                  aria-label="Enemy level"
                />
                <div className="res-level__marks" aria-hidden="true">
                  {[70, 75, 80, 90, 100, 120].map((lvl) => {
                    const reached = enemyProfile.level >= lvl
                    const isMax = lvl === 120
                    return (
                      <span
                        key={lvl}
                        className={[
                          'res-level__mark',
                          reached ? 'is-reached' : '',
                          enemyProfile.level === lvl ? 'is-current' : '',
                          isMax ? 'is-max' : '',
                        ].filter(Boolean).join(' ')}
                        style={{ '--mark-pct': `${((lvl - 1) / 119) * 100}%` } as CssProps}
                      >
                        <span className="res-level__mark-tick" />
                        <button
                          type="button"
                          className="res-level__mark-label"
                          tabIndex={-1}
                          onClick={() => onNmyPrflChn(setEnemyLvl(enemyProfile, lvl))}
                        >
                          {isMax ? 'MAX' : lvl}
                        </button>
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {isCustomMode ? (
          <section className="enemy-strip">
            <div className="enemy-class-radio-group" role="radiogroup" aria-label="Enemy class">
              {ENEMYCLSSPTN.map((classId) => (
                <button
                  key={classId}
                  type="button"
                  className={enemyClass === classId ? 'enemy-class-radio is-active' : 'enemy-class-radio'}
                  onClick={() => onNmyPrflChn(setEnemyClss(enemyProfile, classId))}
                >
                  <span className="enemy-class-radio__dot" />
                  {ENEMY_CLASS_TXT[classId]}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="enemy-strip enemy-res">
          <div className="enemy-res-grid">
            {resistRows.map(({ elementId, label, attributeKey, value }) => {
              const effRes = value - resShredFor(attributeKey)
              const resMult = resistMultiplier(effRes)
              if (elementId === 6) console.log(value, effRes, resMult)
              const shifted = Math.abs(effRes - value) >= 0.05
              const sign = effRes < 0 ? 'vuln' : effRes > 0 ? 'resist' : 'zero'
              const fmt = (n: number) => `${n > 0 ? '+' : ''}${n}%`
              const isPhys = attributeKey === 'physical'
              const iconSrc = `/assets/attributes/attributes alt/${attributeKey}.webp`
              return (
                <div
                  key={elementId}
                  className={`enemy-res-cell ${effRes < value ? 'good' : effRes > value ? 'bad' : ''}`}
                  data-sign={sign}
                  style={{ '--el': ATTR_ID_COLORS[elementId] } as CssProps}
                  title={`${label} · RES ${fmt(value)}${shifted ? ` (effective ${fmt(Math.round(effRes))})` : ''} · damage ×${resMult.toFixed(3)}`}
                >
                  <img
                    src={iconSrc}
                    alt=""
                    aria-hidden="true"
                    className={isPhys ? 'enemy-res-cell__ghost is-phys' : 'enemy-res-cell__ghost'}
                    onError={withDefIconM}
                  />
                  <div className="enemy-res-cell__head">
                    <img
                      src={iconSrc}
                      alt={label}
                      className={isPhys ? 'enemy-res-cell__icon is-phys' : 'enemy-res-cell__icon'}
                      onError={withDefIconM}
                    />
                    <span className="enemy-res-cell__label">{label}</span>
                  </div>

                  {isCustomMode ? (
                    <div className="enemy-res-cell__res">
                      <NumberInput
                        value={value}
                        min={-100}
                        max={200}
                        onChange={(nextValue) => onNmyPrflChn(setEnemyResi(enemyProfile, elementId, nextValue))}
                      />
                    </div>
                  ) : (
                    <div className="enemy-res-cell__res" data-shifted={shifted}>{fmt(effRes)}</div>
                  )}

                  <div className="enemy-res-cell__mult">
                    <span className="enemy-res-cell__mult-x">×</span>
                    {resMult.toFixed(2)}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      <section className="pane-section ennemy-nf-t">
        <section className="enemy-strip">
          <StackGauge
            desc="Tune Strain"
            value={tuneStrain}
            min={0}
            max={10}
            accent="#c9b35d"
            onChange={onTuneStrnCh}
          />

        </section>
        {djstNegFfct.length > 0 ? (
          <section className="enemy-strip">
            <div className="stack-gauge-grid">
              {djstNegFfct.map((effect) => {
                // the element behind each archetype drives its attribute icon.
                const elem = NEG_EFFECT_ELEM[effect.key]
                return (
                  <StackGauge
                    key={effect.key}
                    desc={effect.label}
                    value={combatState[effect.key]}
                    min={0}
                    max={effect.max}
                    accent={effect.accent}
                    icon={`/assets/attributes/attributes alt/${elem}.webp`}
                    onChange={(value) => onCmbtSttChn(effect.key, value, 0, effect.max)}
                  />
                )
              })}
            </div>
          </section>
        ) : null}
      </section>

      {enemyStates.length > 0 || enemyPassives.length > 0 ? (
        <section className="enemy-strip">
          <div className="weapon-effect__bar">
            <span className="weapon-effect__sigil" aria-hidden="true" />
            <span className="weapon-effect__titles">
                  <span className="weapon-effect__tag">Combat Effect</span>
                  <span className="weapon-effect__name">{selEnemy?.name || 'who-is-this'}</span>
                </span>
          </div>
          <div className="stack enemy-state-controls">
            {enemyPassives.map((effect) => (
              <div
                key={effect.id}
                className="pane-section"
              >
                <div className="sequence-card-head">
                  <div className="sequence-card-title-row">
                    <h4>{effect.label}</h4>
                  </div>
                  <span className="sequence-card-status active">Active</span>
                </div>
                {effect.description ? <RichDscr description={effect.description} /> : null}
              </div>
            ))}
            {enemyStates.map((state) => (
              <div
                key={state.controlKey}
                className="pane-section"
              >
                <EnemyStateCtrl
                  state={state}
                  value={getEnemyState(enemyProfile, state.id)}
                  onChange={(value) => onNmyPrflChn(setEnemyState(enemyProfile, state.id, value))}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="pane-section enemy-strip">
        <header className="enemy-strip__head"><span className="panel-overline">Presets</span></header>
        <div className="enemy-preset-grid">
          {ENEMY_PRST.map((preset) => (
              <button
                  key={preset.id}
                  type="button"
                  className="chip"
                  onClick={() => onPrstSel(preset.id)}
              >
                {preset.label}
              </button>
          ))}
        </div>
      </section>

      <EnemyPicker
        visible={enemyPicker.visible}
        open={enemyPicker.open}
        closing={enemyPicker.closing}
        portalTarget={mdlPrtlTgt}
        enemies={fltrNmsnq}
        selEnemyId={selEnemy?.id ?? null}
        search={search}
        selElem={selLmnt}
        selClss={selClss}
        loading={loading}
        error={error}
        onSrchChng={setSearch}
        onElemChng={setSelLmnt}
        onClssChng={setSelClss}
        onSelect={onEnemySel}
        onClose={closePicker}
      />
    </section>
  )
}

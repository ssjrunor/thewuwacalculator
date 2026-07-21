/*
  Author: Runor Ewhro
  Description: renders the pane surface for the calculator enemies flow.
*/

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties as CssProps, ReactNode } from 'react'
import type { EnemyProfile, EnemyStateValue } from '@/domain/entities/appState.ts'
import type { EffectScope, FormExpr, SourceState } from '@/domain/gameData/contracts.ts'
import type { EnemyClassId, EnemyElemId } from '@/domain/entities/enemy.ts'
import { ENEMY_CLASS_TXT, ENEMY_PRST, getEnemyIcon } from '@/domain/entities/enemy.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import { NEG_EFFECT_ELEM, negEffectsFor } from '@/domain/gameData/negativeEffects.ts'
import { mkSrcSttScp, srcSttOpts } from '@/modules/calculator/model/sourceEval.ts'
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
import { listEffectsFor, listFfctForO, listStatesFor } from '@/domain/services/gameDataService.ts'
import { useEnemyCat } from '@/app/hooks/useEnemyCatalog.ts'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'
import { SourceStateCtrl } from '@/modules/calculator/features/controls/SourceStateControl.tsx'
import { StackGauge } from '@/modules/calculator/features/controls/StackGauge.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { getStateText } from '@/modules/calculator/model/sourceStateDisplay.ts'
import { getSrcSttNct } from '@/domain/gameData/controlOptions.ts'
import { srcSttNumMax } from '@/domain/state/sourceStateInit.ts'
import { evalCond, evalForm } from '@/engine/effects/evaluator.ts'
import { getSrcSttDsb } from '@/modules/calculator/model/stateDisabledReason.ts'
import {
  isSourceVisible,
  isSrcSttOn,
  setSourceState,
} from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { clampNumber, formatTruncCompact } from '@/shared/lib/number.ts'
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

interface EnemyCombatCtrlPrps {
  state: SourceState
  value: EnemyStateValue | undefined
  onChange: (value: EnemyStateValue) => void
}

// renders a single enemy debuff state as a control panel: name, description, then the control,
// matching the resonator/weapon source-state panels.
function EnemyCombatCtrl({ state, value, onChange }: EnemyCombatCtrlPrps) {
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

interface ResCombatSttCard {
  id: string
  title: string
  body: string
  type?: 'tuneStrain'
  states: SourceState[]
  keywords?: string[]
}

interface ResCombatStatePrps {
  card: ResCombatSttCard
  runtime: ResRuntime
  enemy: EnemyProfile
  simulation: SimResult | null
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
}

function fmtPct(value: number): string {
  const rounded = Math.abs(value) >= 10
    ? Math.round(value * 10) / 10
    : Math.round(value * 100) / 100

  return `${rounded > 0 ? '+' : ''}${formatTruncCompact(rounded, 2)}%`
}

function fmtMathNum(value: number): string {
  return formatTruncCompact(Math.round(value * 100) / 100, 2)
}

function formulaTerm(formula: FormExpr, scope: EffectScope): string {
  if (formula.type === 'const') {
    return fmtMathNum(formula.value)
  }

  if (formula.type === 'read') {
    const value = evalForm(formula, scope)
    const path = `${formula.from ?? ''}.${formula.path}`

    if (path.endsWith('finalStats.tbb') || path.endsWith('finalStats.tuneBreakBoost')) {
      return `TBB ${fmtMathNum(value)}`
    }

    if (path.endsWith('enemy.status.tuneStrain')) {
      return `Tune Strain ${fmtMathNum(value)}`
    }

    return `${formula.path.split('.').at(-1) ?? 'Value'} ${fmtMathNum(value)}`
  }

  if (formula.type === 'clamp') {
    return formulaTerm(formula.value, scope)
  }

  return fmtMathNum(evalForm(formula, scope))
}

function formulaMath(formula: FormExpr, scope: EffectScope): string {
  if (formula.type === 'mul') {
    return formula.values.map((entry) => formulaTerm(entry, scope)).join(' x ')
  }

  if (formula.type === 'add') {
    return formula.values.map((entry) => formulaTerm(entry, scope)).join(' + ')
  }

  return formulaTerm(formula, scope)
}

function effectScope(
  runtime: ResRuntime,
  state: SourceState,
  enemy: EnemyProfile,
  simulation: SimResult | null,
): EffectScope {
  const base = mkSrcSttScp(runtime, runtime, state, runtime)
  const finalStats = simulation?.finalStats

  return {
    ...base,
    sourceFinalStats: finalStats,
    finalStats,
    context: {
      ...base.context,
      sourceFinalStats: finalStats,
      finalStats,
      enemy,
    },
  }
}

function dmgVulnMath(
  runtime: ResRuntime,
  state: SourceState,
  enemy: EnemyProfile,
  simulation: SimResult | null,
): Array<{ id: string; label: string; value: number; equation: string; active: boolean }> {
  const scope = effectScope(runtime, state, enemy, simulation)

  return listFfctForO(state.ownerKey)
    .flatMap((effect) => {
      const active = evalCond(effect.condition, scope)
      return effect.operations.flatMap((operation, index) => {
        if (operation.type !== 'add_top_stat' || operation.stat !== 'dmgVuln') {
          return []
        }

        return [{
          id: `${effect.id}:${index}`,
          label: effect.label,
          value: active ? evalForm(operation.value, scope) : 0,
          equation: formulaMath(operation.value, scope),
          active,
        }]
      })
    })
}

function toSourceBool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value > 0
  if (typeof value === 'string') return value === 'true'
  return false
}

function toSourceNum(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function ResCombatStateControl({
  state,
  runtime,
  onRtPdt,
  compact = false,
}: {
  state: SourceState
  runtime: ResRuntime
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
  compact?: boolean
}) {
  const current = readRtValue(runtime, state)
  const enabled = isSrcSttOn(runtime, runtime, state, runtime)
  const disabledReason = enabled ? null : getSrcSttDsb(state)
  const display = getStateText(state)

  if (state.kind === 'toggle') {
    const checked = toSourceBool(current)

    return (
      <div className={['res-combat-control', compact ? 'res-combat-control--compact' : '', checked ? 'is-active' : '', !enabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="res-combat-switch"
          aria-pressed={checked}
          disabled={!enabled}
          onClick={() => setSourceState(onRtPdt, runtime, runtime, state, !checked, runtime)}
        >
          <span className="res-combat-switch__mark" aria-hidden="true" />
          <span className="res-combat-switch__text">{display.label}</span>
          <span className="res-combat-switch__state">{checked ? 'Active' : 'Off'}</span>
        </button>
        {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
      </div>
    )
  }

  if (state.kind === 'select') {
    const options = srcSttOpts(runtime, runtime, state, runtime)
    const value = String(current ?? options[0]?.id ?? '')

    return (
      <label className={['res-combat-control', !enabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
        <span>{display.label}</span>
        <LiquidSelect
          value={value}
          options={options.map((option) => ({ value: option.id, label: option.label }))}
          disabled={!enabled}
          onChange={(next) => setSourceState(onRtPdt, runtime, runtime, state, next, runtime)}
        />
        {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
      </label>
    )
  }

  const min = state.min ?? 0
  const max = srcSttNumMax(runtime, runtime, state, runtime)

  return (
    <label className={['res-combat-control', !enabled ? 'is-disabled' : ''].filter(Boolean).join(' ')}>
      <span>{display.label}</span>
      <NumberInput
        value={toSourceNum(current)}
        min={min}
        max={max}
        step={state.kind === 'stack' ? 1 : 0.1}
        disabled={!enabled}
        onChange={(next) => setSourceState(onRtPdt, runtime, runtime, state, clampNumber(next, min, max ?? Number.MAX_SAFE_INTEGER), runtime)}
      />
      {disabledReason ? <div className="state-control-reason">{disabledReason}</div> : null}
    </label>
  )
}

function readRtValue(runtime: ResRuntime, state: SourceState): string | number | boolean {
  const stored = readRtPath(runtime, state.path)
  if (stored === undefined) {
    return getSrcSttNct(runtime, runtime, state, runtime)
  }

  return stored as string | number | boolean
}

function ResCombatTuneCard({ card, runtime, enemy, simulation, onRtPdt }: ResCombatStatePrps) {
  const state = card.states[0]
  const mathRows = state ? dmgVulnMath(runtime, state, enemy, simulation) : []
  const total = mathRows.reduce((sum, row) => sum + row.value, 0)

  const active = total > 0
  const showTermValues = mathRows.length > 1

  return (
    <article className={active ? 'combat-tune-card is-active' : 'combat-tune-card'}>
      <header className="combat-tune-card__header">
        <h4 className="combat-tune-card__title">{card.title}</h4>
        <div className="combat-tune-card__output">
          <span className="combat-tune-card__output-value">{fmtPct(total)}</span>
          <span className="combat-tune-card__output-label">DMG taken</span>
        </div>
      </header>
      <RichDscr
        description={card.body}
        className="combat-tune-card__desc"
        xtrKywr={card.keywords}
      />
      <div className="combat-tune-card__controls">
        {card.states.map((entry) => (
          <SourceStateCtrl
            key={entry.controlKey}
            srcRt={runtime}
            tgtRt={runtime}
            state={entry}
            onRtPdt={onRtPdt}
            hideDscr
          />
        ))}
      </div>
      {mathRows.length > 0 ? (
        <div className="combat-tune-card__breakdown">
          {mathRows.map((row) => (
            <div key={row.id} className={row.active ? 'combat-tune-card__term is-active' : 'combat-tune-card__term'}>
              <span className="combat-tune-card__term-desc">
                <span className="combat-tune-card__term-label">{row.label}</span>
                <span className="combat-tune-card__term-eq">{row.equation}</span>
              </span>
              {showTermValues ? <span className="combat-tune-card__term-value">{fmtPct(row.value)}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function ResCombatPlainCard({ card, runtime, enemy, simulation, onRtPdt }: ResCombatStatePrps) {
  const mathRows = card.states.flatMap((state) => dmgVulnMath(runtime, state, enemy, simulation))

  return (
    <article className="pane-section res-combat-plain-card">
      <div className="sequence-card-head">
        <div className="sequence-card-title-row">
          <h4>{card.title}</h4>
        </div>
      </div>
      <RichDscr description={card.body} xtrKywr={card.keywords} />
      <div className="res-combat-plain-card__controls">
        {card.states.map((state) => (
          <ResCombatStateControl
            key={state.controlKey}
            state={state}
            runtime={runtime}
            onRtPdt={onRtPdt}
          />
        ))}
      </div>
      {mathRows.length > 0 ? (
        <div className="res-combat-plain-card__math">
          {mathRows.map((row) => (
            <span key={row.id}>{row.equation} = {fmtPct(row.value)} DMG Vulnerability</span>
          ))}
        </div>
      ) : null}
    </article>
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
  const enemySourceCombatStates = useMemo(
    () => listStatesFor('enemy', enemyProfile.id),
    [enemyProfile.id],
  )
  const resCombatStateCards = useMemo<ResCombatSttCard[]>(() => {
    const details = getResDtlsBy()[runtime.id]
    if (!details?.combatStates?.length) {
      return []
    }

    const statesByControlKey = new Map(
      listStatesFor('resonator', runtime.id)
        .map((state) => [state.controlKey, state]),
    )

    return details.combatStates
      .map((entry) => {
        const stateKeys = entry.stateKeys ?? entry.controls.map((control) => control.key)
        const states = stateKeys
          .map((key) => statesByControlKey.get(key))
          .filter((state): state is SourceState => Boolean(state))
          .filter((state) => isSourceVisible(runtime, runtime, state, runtime))

        return {
          id: entry.id ?? entry.title,
          title: entry.title,
          body: entry.body,
          type: entry.type,
          keywords: entry.keywords,
          states,
        }
      })
      .filter((entry) => entry.states.length > 0)
  }, [runtime])
  const tuneStrainCards = resCombatStateCards.filter((entry) => entry.type === 'tuneStrain')
  const plainResCombatCards = resCombatStateCards.filter((entry) => entry.type !== 'tuneStrain')
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
                  title={`${label} · RES ${fmt(value)}${shifted ? ` (effective ${fmt(effRes)})` : ''} · damage x${formatTruncCompact(resMult, 3)}`}
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
                    {formatTruncCompact(resMult, 2)}
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
          {tuneStrainCards.length > 0 ? (
            <div className="combat-tune-responder-list">
              {tuneStrainCards.map((card) => (
                <ResCombatTuneCard
                  key={card.id}
                  card={card}
                  runtime={runtime}
                  enemy={enemyProfile}
                  simulation={simulation}
                  onRtPdt={onRtPdt}
                />
              ))}
            </div>
          ) : null}

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

      {enemySourceCombatStates.length > 0 || enemyPassives.length > 0 || plainResCombatCards.length > 0 ? (
        <section className="enemy-strip">
          <div className="weapon-effect__bar">
            <span className="weapon-effect__sigil" aria-hidden="true" />
            <span className="weapon-effect__titles">
                  <span className="weapon-effect__tag">Combat Effects</span>
                  <span className="weapon-effect__name">{selEnemy?.name || 'who-is-this'}</span>
                </span>
          </div>
          <div className="stack combat-effect-controls">
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
            {enemySourceCombatStates.map((state) => (
              <div
                key={state.controlKey}
                className="pane-section"
              >
                <EnemyCombatCtrl
                  state={state}
                  value={getEnemyState(enemyProfile, state.id)}
                  onChange={(value) => onNmyPrflChn(setEnemyState(enemyProfile, state.id, value))}
                />
              </div>
            ))}
            {plainResCombatCards.map((card) => (
              <ResCombatPlainCard
                key={card.id}
                card={card}
                runtime={runtime}
                enemy={enemyProfile}
                simulation={simulation}
                onRtPdt={onRtPdt}
              />
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

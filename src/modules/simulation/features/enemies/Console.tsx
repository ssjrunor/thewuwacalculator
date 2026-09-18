/*
  Author: Runor Ewhro
  Description: Edits enemy target profiles and runtime vulnerability controls,
               deriving resistance and defense multipliers from the draft.
*/

import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { EnemyClassId, EnemyElemId } from '@/domain/entities/enemy.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { ENEMY_CLASS_TXT, ENEMY_PRST, getEnemyIcon } from '@/domain/entities/enemy.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import { NEG_EFFECT_ELEM, negEffectsFor } from '@/domain/gameData/negativeEffects.ts'
import { getTuneStrainMaxForTeam } from '@/domain/gameData/tuneStrain.ts'
import { fltrEnemyCat, getEnemyCatE } from '@/domain/services/enemyCatalogService.ts'
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
  setEnemyState,
  setEnemyTune,
  tglEnemyTwrM,
} from '@/domain/services/enemyProfileService.ts'
import { getSrcSttNct } from '@/domain/gameData/controlOptions.ts'
import { srcSttNumMax } from '@/domain/state/sourceStateInit.ts'
import { useEnemyCat } from '@/app/hooks/useEnemyCatalog.ts'
import { EnemyPicker } from '@/modules/simulation/features/enemies/Picker.tsx'
import { readVulns, type VulnRow } from '@/modules/simulation/features/enemies/lib/enemyVulns.ts'
import { ResistanceGrid, resistMultiplier } from '@/modules/simulation/features/enemies/ResistanceGrid.tsx'
import { StackGauge } from '@/modules/simulation/features/controls/StackGauge.tsx'
import { setSourceState } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { ATTR_ID_COLORS } from '@/modules/simulation/model/display.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell.tsx'
import { HoverCard } from '@/shared/ui/Tooltip.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { clampNumber, formatTruncCompact } from '@/shared/lib/number.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

const CLASSES: EnemyClassId[] = [1, 2, 3, 4]
// Element ids in the shared resistance-grid order: physical, then elemental.
const ELEMENTS: EnemyElemId[] = [0, 4, 3, 2, 1, 5, 6]

const SIZE = 336
const MID = SIZE / 2
const INNER = 88
const OUTER = 150
// Multipliers saturate at 1.8 when mapped into the available radial range.
const CEILING = 1.8

function radiusOf(multiplier: number): number {
  return INNER + Math.min(1, multiplier / CEILING) * (OUTER - INNER)
}

function pointOn(angle: number, radius: number): [number, number] {
  const rad = ((angle - 90) * Math.PI) / 180
  return [MID + radius * Math.cos(rad), MID + radius * Math.sin(rad)]
}

function arcPath(from: number, to: number, inner: number, outer: number): string {
  const [x0, y0] = pointOn(from, outer)
  const [x1, y1] = pointOn(to, outer)
  const [x2, y2] = pointOn(to, inner)
  const [x3, y3] = pointOn(from, inner)
  const wide = to - from > 180 ? 1 : 0

  return `M${x0} ${y0} A${outer} ${outer} 0 ${wide} 1 ${x1} ${y1} `
    + `L${x2} ${y2} A${inner} ${inner} 0 ${wide} 0 ${x3} ${y3} Z`
}

const fmtX = (value: number) => `x${formatTruncCompact(value, 2)}`
const fmtPct = (value: number) => `${value > 0 ? '+' : ''}${formatTruncCompact(Math.round(value * 10) / 10, 1)}%`

function VulnName({ row }: { row: VulnRow }) {
  if (!row.description) {
    return <span className="enc-vuln__name">{row.label}</span>
  }

  return (
    <HoverCard
      label={row.label}
      triggerClassName="enc-vuln__name is-keyed"
      rootClassName="res-tag-tooltip"
      cardClassName="res-tag-tooltip__card"
      content={() => (
        <>
          <div className="res-tag-tooltip__head">
            <span className="res-tag-tooltip__label">
              {row.side === 'team' ? 'Your team' : 'Target'}
            </span>
            <span className="res-tag-tooltip__count">
              {row.active ? fmtPct(row.value) : 'off'}
              <span className="res-tag-tooltip__count-unit">
                {row.stat === 'finalDmg' ? 'final dmg' : 'vuln'}
              </span>
            </span>
          </div>

          <ul className="res-tag-tooltip__list">
            <li className="res-tag-tooltip__row">
              <span className="res-tag-tooltip__text">
                <span className="res-tag-tooltip__name">{row.label}</span>
                <RichDscr className="res-tag-tooltip__desc"
                  description={row.description ?? ''}
                  params={row.params}
                />
              </span>
            </li>
          </ul>
        </>
      )}
    >
      {row.label}
    </HoverCard>
  )
}

// Dispatch vulnerability edits through the authored control shape and owner.
function VulnControl({
  row,
  enemy,
  runtime,
  onRtPdt,
  onEnemyChange,
}: {
  row: VulnRow
  enemy: EnemyProfile
  runtime: ResRuntime
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
  onEnemyChange: (enemy: EnemyProfile) => void
}) {
  const state = row.state
  if (!state) {
    return null
  }

  const onTarget = state.source.type === 'enemy'
  const current = onTarget
    ? getEnemyState(enemy, state.id)
    : (readRtPath(runtime, state.path) ?? getSrcSttNct(runtime, runtime, state, runtime))

  const write = (next: string | number | boolean) => {
    if (onTarget) {
      onEnemyChange(setEnemyState(enemy, state.id, next))
      return
    }
    setSourceState(onRtPdt, runtime, runtime, state, next, runtime)
  }

  if (state.kind === 'toggle') {
    const on = current === true
    return (
      <button
        type="button"
        className={on ? 'amdl__chip is-on' : 'amdl__chip'}
        aria-pressed={on}
        onClick={() => write(!on)}
      >
        {on ? 'On' : 'Off'}
      </button>
    )
  }

  const min = state.min ?? 0
  const max = onTarget
    ? state.max ?? 1
    : srcSttNumMax(runtime, runtime, state, runtime) ?? state.max ?? 1
  const value = Number(current) || 0

  return (
    <span className="enc-stk" role="group" aria-label={row.label}>
      {Array.from({ length: Math.max(1, Math.round(max)) }, (_, index) => index + 1).map((step) => (
        <button
          key={step}
          type="button"
          className={step <= value ? 'enc-stk__seg is-on' : 'enc-stk__seg'}
          aria-pressed={step <= value}
          aria-label={`${row.label}: ${step}`}
          onClick={() => write(clampNumber(value === step ? step - 1 : step, min, max))}
        />
      ))}
    </span>
  )
}

interface EnemyConsoleProps {
  visible: boolean
  open: boolean
  closing?: boolean
  runtime: ResRuntime | null
  runtimesById: Record<string, ResRuntime>
  enemyProfile: EnemyProfile
  simulation: SimResult | null
  onRtPdt: (updater: (runtime: ResRuntime) => ResRuntime) => void
  onEnemyChange: (enemy: EnemyProfile) => void
  onClose: () => void
}

export function EnemyConsole({
  visible,
  open,
  closing = false,
  runtime,
  runtimesById,
  enemyProfile,
  simulation,
  onRtPdt,
  onEnemyChange,
  onClose,
}: EnemyConsoleProps) {
  const { catalog, loading, error } = useEnemyCat()
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [byElem, setByElem] = useState<EnemyElemId | null>(null)
  const [byClass, setByClass] = useState<EnemyClassId | null>(null)
  const [focus, setFocus] = useState<EnemyElemId>(2)

  const selEnemy = useMemo(
    () => getEnemyCatE(catalog, enemyProfile.id),
    [catalog, enemyProfile.id],
  )
  const shown = useMemo(
    () => fltrEnemyCat(catalog, { search, element: byElem, enemyClass: byClass }),
    [catalog, search, byClass, byElem],
  )

  const custom = isCustEnemyP(enemyProfile)
  const enemyClass = getRslvEnemy(enemyProfile)
  const tune = getEnemyTune(enemyProfile)
  const tuneMax = useMemo(
    () => (runtime ? getTuneStrainMaxForTeam(runtime) : 0),
    [runtime],
  )
  const negEffects = useMemo(
    () => (runtime ? negEffectsFor(runtime, runtimesById).filter((effect) => effect.sliderVisible) : []),
    [runtime, runtimesById],
  )

  const vulns = useMemo(() => {
    if (!runtime) {
      return { rows: [], dmgVuln: 0, finalDmg: 0, scoped: [] }
    }

    return readVulns(
      runtime,
      enemyProfile,
      simulation,
      (field) => getEnemyState(enemyProfile, field),
      (state: SourceState) => readRtPath(runtime, state.path)
        ?? getSrcSttNct(runtime, runtime, state, runtime),
    )
  }, [runtime, enemyProfile, simulation])

  const attrBucket = simulation?.finalStats.attribute ?? null
  const shredFor = (attributeKey: string): number => (
    attrBucket ? attrBucket.all.resShred + (attrBucket[attributeKey as AttributeKey]?.resShred ?? 0) : 0
  )

  const resistRows = getEnemyReys(enemyProfile, ELEMENTS)
  // mirrors the pipeline: defense scales linearly with level
  const defense = 8 * enemyProfile.level + 792
  const boost = (1 + vulns.dmgVuln / 100) * (1 + vulns.finalDmg / 100)

  const readings = resistRows.map((row) => {
    const effective = row.value - shredFor(row.attributeKey)
    const base = resistMultiplier(effective)
    return { ...row, effective, base, net: base * boost }
  })
  const picked = readings.find((row) => row.elementId === focus) ?? readings[0]

  const combat = runtime?.state.combat
  useEffect(() => {
    if (tune <= tuneMax) return
    onEnemyChange(setEnemyTune(enemyProfile, tuneMax))
  }, [enemyProfile, onEnemyChange, tune, tuneMax])

  if (!visible || !runtime || !picked) {
    return null
  }

  const onPick = (enemyId: string) => {
    const next = getEnemyCatE(catalog, enemyId)
    if (!next) return
    onEnemyChange(selCatEnemyP(enemyProfile, next))
    setPicking(false)
  }

  const icon = selEnemy?.icon ?? getEnemyIcon(enemyProfile.id) ?? '/assets/game/default.webp'
  const targetName = custom ? 'Custom target' : selEnemy?.name ?? 'Choose a target'

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="enemy-console"
      ariaLabel="Target"
      onClose={onClose}
    >
      <div className="amdl enc">
        <ModalHeader
          over="Target"
          title={targetName}
          leading={(
            <button
              type="button" className="enc-face"
              aria-label="Change target"
              onClick={() => setPicking(true)}
            >
              <img src={icon} alt="" onError={withDefIconM} />
            </button>
          )}
          onClose={onClose}
        >
          {custom ? (
            <span className="amdl__seg" role="group" aria-label="Target class">
              {CLASSES.map((classId) => (
                <button
                  key={classId}
                  type="button"
                  className={enemyClass === classId ? 'amdl__seg-btn is-on' : 'amdl__seg-btn'}
                  aria-pressed={enemyClass === classId}
                  onClick={() => onEnemyChange(setEnemyClss(enemyProfile, classId))}
                >
                  {ENEMY_CLASS_TXT[classId]}
                </button>
              ))}
            </span>
          ) : null}

          <span className="amdl__seg" role="group" aria-label="Encounter">
            {[['Tower', true], ['Field', false]].map(([label, toa]) => (
              <button
                key={String(label)}
                type="button"
                className={enemyProfile.toa === toa ? 'amdl__seg-btn is-on' : 'amdl__seg-btn'}
                aria-pressed={enemyProfile.toa === toa}
                onClick={() => onEnemyChange(tglEnemyTwrM(enemyProfile, selEnemy, Boolean(toa)))}
              >
                {label}
              </button>
            ))}
          </span>

          <span className="amdl__gauge">
            {!custom ? (
              <span className="amdl__pill">
                <span className="amdl__pill-label">Class</span>
                <span className="amdl__pill-value">{ENEMY_CLASS_TXT[enemyClass]}</span>
              </span>
            ) : null}
            <span className="amdl__pill">
              <span className="amdl__pill-label">Def</span>
              <span className="amdl__pill-value">{defense.toLocaleString()}</span>
            </span>
          </span>
        </ModalHeader>

        <div className="amdl__body enc__body">
          <div className="amdl__rail enc-rail">
            <div className="amdl__grp">
              <div className="amdl__grp-name">Loads</div>
              <div className="enc-loads">
                <StackGauge
                  desc="Tune Strain"
                  value={tune}
                  min={0}
                  max={tuneMax}
                  accent="#c9b35d"
                  onChange={(next) => onEnemyChange(
                    setEnemyTune(enemyProfile, clampNumber(next, 0, tuneMax)),
                  )}
                />
                {negEffects.map((effect) => (
                  <StackGauge
                    key={effect.key}
                    desc={effect.label}
                    value={combat?.[effect.key] ?? 0}
                    min={0}
                    max={effect.max}
                    accent={effect.accent}
                    icon={`/assets/game/attributes/icons/${NEG_EFFECT_ELEM[effect.key]}.webp`}
                    onChange={(next) => onRtPdt((prev) => ({
                      ...prev,
                      state: {
                        ...prev.state,
                        combat: {
                          ...prev.state.combat,
                          [effect.key]: clampNumber(next, 0, effect.max),
                        },
                      },
                    }))}
                  />
                ))}
              </div>
            </div>

            <div className="amdl__rail-foot">
              {`Lv ${enemyProfile.level} · ${enemyProfile.toa ? 'Tower' : 'Field'}`}
            </div>
          </div>

          <div className="enc-ring">
            <svg
              viewBox={`-12 -12 ${SIZE + 24} ${SIZE + 24}`} className="enc-ring__svg"
              role="img"
              aria-label="Damage multiplier by element"
            >
              <circle cx={MID} cy={MID} r={INNER - 6} className="enc-ring__hub" />
              <circle cx={MID} cy={MID} r={radiusOf(1)} className="enc-ring__datum" />

              {readings.map((row, index) => {
                const step = 360 / readings.length
                const from = index * step + 2.5
                const to = (index + 1) * step - 2.5
                const [ix, iy] = pointOn((from + to) / 2, OUTER + 14)
                const on = row.elementId === focus

                return (
                  <g key={row.elementId}>
                    <g
                      className={on ? 'enc-ring__arc is-on' : 'enc-ring__arc'}
                      role="button"
                      tabIndex={0}
                      aria-label={`${row.label}, ${fmtX(row.net)}`}
                      onClick={() => setFocus(row.elementId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setFocus(row.elementId)
                      }}
                    >
                      <path d={arcPath(from, to, INNER, OUTER)} className="enc-ring__bed" />
                      <path
                        d={arcPath(from, to, INNER, radiusOf(row.net))} className="enc-ring__band"
                        style={{ '--el': ATTR_ID_COLORS[row.elementId] } as CssProps}
                      />
                    </g>
                    <image
                      href={`/assets/game/attributes/icons/${row.attributeKey}.webp`}
                      width={15}
                      height={15}
                      x={ix - 7.5}
                      y={iy - 7.5}
                      className={on ? 'enc-ring__glyph is-on' : 'enc-ring__glyph'}
                    />
                  </g>
                )
              })}
            </svg>

            <div className="enc-ring__core">
              <button
                type="button" className="enc-face enc-face--core"
                aria-label="Change target"
                onClick={() => setPicking(true)}
              >
                <img src={icon} alt="" onError={withDefIconM} />
              </button>
              <b className="enc-ring__x">
                {fmtX(picked.net)}
              </b>
              <span className="enc-ring__of">{picked.label}</span>
            </div>
          </div>

          <div className="amdl__pane enc-side">
            <div className="amdl__grp">
              <div className="amdl__grp-name">Level</div>
              <div className="enc-level">
                <span className="enc-level__fig">
                  <b>{enemyProfile.level}</b>
                  <span>/ 120</span>
                </span>
                <input
                  type="range"
                  min={1}
                  max={120}
                  value={enemyProfile.level}
                  aria-label="Target level"
                  style={{ '--at': `${((enemyProfile.level - 1) / 119) * 100}%` } as CssProps}
                  onChange={(event) => onEnemyChange(
                    setEnemyLvl(enemyProfile, Number(event.target.value)),
                  )}
                />
              </div>
            </div>
            <div className="amdl__grp">
              <div className="amdl__grp-name">
                Takes extra
                <span className="amdl__grp-n">{fmtPct(vulns.dmgVuln + vulns.finalDmg)}</span>
              </div>
              {vulns.rows.length > 0 ? vulns.rows.map((row) => (
                <div className="amdl__row enc-vuln" key={row.id}>
                  <div className="amdl__row-k">
                    <VulnName row={row} />
                    {row.side === 'team' || row.stat === 'finalDmg' || row.scope ? (
                      <small>
                        {[
                          row.scope,
                          row.stat === 'finalDmg' ? 'Final DMG' : null,
                          row.side === 'team' ? 'from your team' : null,
                        ].filter(Boolean).join(' · ')}
                      </small>
                    ) : null}
                  </div>
                  <div className="enc-vuln__end">
                    {row.active || !row.state ? (
                      <span className={row.active ? 'amdl__row-v is-lit' : 'amdl__row-v is-mut'}>
                        {row.active ? fmtPct(row.value) : 'off'}
                      </span>
                    ) : null}
                    <VulnControl
                      row={row}
                      enemy={enemyProfile}
                      runtime={runtime}
                      onRtPdt={onRtPdt}
                      onEnemyChange={onEnemyChange}
                    />
                  </div>
                </div>
              )) : (
                <div className="amdl__row">
                  <div className="amdl__row-k">
                    Nothing
                    <small>This target has no authored weakness.</small>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="amdl__grp enc-band">
            <div className="amdl__grp-name">
              Resistance
              <span className="amdl__grp-n">{custom ? 'editable' : ''}</span>
            </div>
            <ResistanceGrid
              profile={enemyProfile}
              elements={ELEMENTS}
              editable={custom}
              shredFor={shredFor}
              onChange={onEnemyChange}
              selected={focus}
              onSelect={setFocus}
            />
          </div>

        </div>

        <div className="amdl__foot enc-foot">
          <span className="amdl__over">Quick targets</span>
          {ENEMY_PRST.map((preset) => (
            <button
              key={preset.id}
              type="button" className="amdl__chip"
              onClick={() => onEnemyChange(selEnemyPrst(enemyProfile, preset))}
            >
              {preset.label}
            </button>
          ))}
          <span className="amdl__fill" />
          <button type="button" className="amdl__act is-go" onClick={onClose}>Done</button>
        </div>
      </div>

      <EnemyPicker
        visible={picking}
        open={picking}
        portalTarget={mainPortal()}
        enemies={shown}
        selEnemyId={selEnemy?.id ?? null}
        search={search}
        selElem={byElem}
        selClss={byClass}
        loading={loading}
        error={error}
        onSrchChng={setSearch}
        onElemChng={setByElem}
        onClssChng={setByClass}
        onSelect={onPick}
        onClose={() => setPicking(false)}
      />
    </AppModal>
  )
}

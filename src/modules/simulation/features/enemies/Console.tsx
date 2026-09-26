/*
  Author: Runor Ewhro
  Description: States the target: what it resists, whatever rules it or the team
               brings, and the level behind it. Only the resistance reading is
               always present; every other row exists because the data gave it
               one, so an unauthored target renders a short panel.
*/

import { useMemo, useState } from 'react'
import type { CSSProperties as CssProps, ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import type { EnemyProfile } from '@/domain/entities/appState.ts'
import type { EnemyClassId, EnemyElemId } from '@/domain/entities/enemy.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { AttributeKey } from '@/domain/entities/stats.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { SimResult } from '@/engine/pipeline/types.ts'
import { ENEMY_CLASS_TXT, ENEMY_PRST, getEnemyIcon } from '@/domain/entities/enemy.ts'
import { readRtPath } from '@/domain/gameData/runtimePath.ts'
import { NEG_EFFECT_ELEM, negEffectsFor } from '@/engine/gameData/negativeEffects.ts'
import { getTuneStrainMaxForTeam } from '@/engine/gameData/tuneStrain.ts'
import { fltrEnemyCat, getEnemyCatE } from '@/data/catalog/enemyCatalogService.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { listStatesFor } from '@/data/catalog/gameDataService.ts'
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
import { getSrcSttNct } from '@/engine/gameData/controlOptions.ts'
import { srcSttNumMax } from '@/engine/runtime/sourceStateInit.ts'
import { sourceOptions } from '@/engine/services/sourceStateService.ts'
import { useEnemyCat } from '@/application/hooks/useEnemyCatalog.ts'
import { EnemyPicker } from '@/modules/simulation/features/enemies/Picker.tsx'
import { readVulns, type VulnRow } from '@/modules/simulation/features/enemies/lib/enemyVulns.ts'
import { topStatMath } from '@/modules/simulation/features/enemies/lib/effectMath.ts'
import { resistMultiplier } from '@/modules/simulation/features/enemies/ResistanceGrid.tsx'
import { NumberInput } from '@/modules/simulation/features/controls/NumberInput.tsx'
import { isSourceVisible, setSourceState } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { ATTR_ID_COLORS } from '@/modules/simulation/model/display.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell.tsx'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { clampNumber, formatTruncCompact } from '@/shared/lib/number.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'

const CLASSES: EnemyClassId[] = [1, 2, 3, 4]
const ELEMENTS: EnemyElemId[] = [0, 4, 3, 2, 1, 5, 6]

const fmtX = (value: number) => `×${formatTruncCompact(value, 2)}`
const fmtPct = (value: number) => `${value > 0 ? '+' : ''}${formatTruncCompact(Math.round(value * 10) / 10, 1)}%`
const fmtRes = (value: number) => `${value > 0 ? '+' : ''}${value}%`

interface DragNumProps {
  value: number
  min: number
  max: number
  label: string
  onChange: (value: number) => void
}

// Pointer movement maps every six pixels to one integer step. A click without
// movement advances once and wraps at the authored bounds.
function DragNum({ value, min, max, label, onChange }: DragNumProps) {
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startValue = value
    let dragged = false

    const onMove = (moveEvent: PointerEvent) => {
      const step = Math.round((moveEvent.clientX - startX) / 6)
      if (!step && !dragged) return
      dragged = true
      onChange(clampNumber(startValue + step, min, max))
    }
    const onUp = () => {
      if (!dragged) onChange(startValue >= max ? min : startValue + 1)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowUp'
      ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    if (!step) return
    event.preventDefault()
    onChange(clampNumber(value + step * (event.shiftKey ? 10 : 1), min, max))
  }

  return (
    <button
      type="button"
      className={value > min ? 'enc-num' : 'enc-num is-zero'}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={label}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      {value}
    </button>
  )
}

function Switch({ on, label, onToggle }: { on: boolean, label: string, onToggle: () => void }) {
  return (
    <button type="button" className="enc-sw" aria-pressed={on} aria-label={label} onClick={onToggle}>
      <em>{on ? 'On' : 'Off'}</em>
      <i aria-hidden="true" />
    </button>
  )
}

interface RowProps {
  id: string
  name: string
  glyph?: string | null
  worth?: ReactNode
  control?: ReactNode
  scope?: string | null
  description?: string | null
  params?: Array<string | number>
  equation?: string | null
  dim?: boolean
  open: boolean
  onToggle: () => void
  children?: ReactNode
}

function Row({
  id,
  name,
  glyph,
  worth,
  control,
  scope,
  description,
  params,
  equation,
  dim = false,
  open,
  onToggle,
  children,
}: RowProps) {
  return (
    <div className={dim ? 'enc-rw is-off' : 'enc-rw'}>
      <span className="enc-rw__k">
        {glyph ? <img src={glyph} alt="" aria-hidden="true" onError={withDefIconM} /> : null}
        <span className="enc-rw__nm">{name}</span>
      </span>
      {worth ?? <span />}
      <span className="enc-rw__c">{control}</span>
      {description ? (
        <button
          type="button" className="enc-rw__dc"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          aria-label={name}
          onClick={onToggle}
        >
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      ) : <span className="enc-rw__dc" />}
      {scope ? <div className="enc-rw__scope">{scope}</div> : null}
      {description ? (
        <Expandable
          as="div" id={`${id}-body`}
          className="enc-rw__body"
          contentOnly
          open={open}
          onOpenChange={onToggle}
        >
          <RichDscr className="enc-rw__txt rich-description" description={description} params={params} />
          {equation ? <div className="enc-rw__eq"><b>{equation}</b></div> : null}
        </Expandable>
      ) : null}
      {children}
    </div>
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
  // Store only expanded ids; all other descriptions remain collapsed.
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  const isOpen = (id: string) => opened.has(id)
  const toggleOpen = (id: string) => setOpened((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })

  const selEnemy = useMemo(() => getEnemyCatE(catalog, enemyProfile.id), [catalog, enemyProfile.id])
  const shown = useMemo(
    () => fltrEnemyCat(catalog, { search, element: byElem, enemyClass: byClass }),
    [catalog, search, byClass, byElem],
  )

  const custom = isCustEnemyP(enemyProfile)
  const enemyElement = selEnemy?.element ?? selEnemy?.elementArray[0] ?? null
  const enemyColor = enemyElement != null ? ATTR_ID_COLORS[enemyElement] : 'var(--text)'
  const enemyClass = getRslvEnemy(enemyProfile)
  const tune = getEnemyTune(enemyProfile)
  const tuneMax = useMemo(() => (runtime ? getTuneStrainMaxForTeam(runtime) : 0), [runtime])

  // Include fixed-max negative effects even though they expose no control state.
  const loads = useMemo(
    () => (runtime ? negEffectsFor(runtime, runtimesById) : []),
    [runtime, runtimesById],
  )

  const vulns = useMemo(() => {
    if (!runtime) {
      return { rows: [] as VulnRow[], dmgVuln: 0, finalDmg: 0, scoped: [] }
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

  const enemyStates = useMemo(() => listStatesFor('enemy', enemyProfile.id), [enemyProfile.id])

  // Combat-state responders currently modify Tune Strain, so keep them with
  // negative-effect sources rather than the general vulnerability collection.
  const responders = useMemo(() => {
    if (!runtime) return []
    const details = getResDtlsBy()[runtime.id]
    if (!details?.combatStates?.length) return []

    const byKey = new Map(
      listStatesFor('resonator', runtime.id).map((state) => [state.controlKey, state]),
    )

    return details.combatStates.flatMap((entry) => {
      const keys = entry.stateKeys ?? entry.controls.map((control) => control.key)
      const states = keys
        .map((key) => byKey.get(key))
        .filter((state): state is SourceState => Boolean(state))
        .filter((state) => isSourceVisible(runtime, runtime, state, runtime))

      if (!states.length) return []

      const math = states.flatMap(
        (state) => topStatMath(runtime, state, enemyProfile, simulation, 'finalDmg'),
      )
      const total = math.reduce((sum, term) => sum + term.value, 0)

      return [{
        id: entry.id ?? entry.title,
        title: entry.title,
        body: entry.body,
        keywords: entry.keywords,
        states,
        total,
        equation: math[0]?.equation ?? null,
      }]
    })
  }, [runtime, enemyProfile, simulation])

  const responderKeys = useMemo(
    () => new Set(responders.flatMap((entry) => entry.states.map((state) => state.controlKey))),
    [responders],
  )
  const targetRows = vulns.rows.filter((row) => !responderKeys.has(row.id))

  const attrBucket = simulation?.finalStats.attribute ?? null
  const shredFor = (attributeKey: string): number => (
    attrBucket ? attrBucket.all.resShred + (attrBucket[attributeKey as AttributeKey]?.resShred ?? 0) : 0
  )

  const defense = 8 * enemyProfile.level + 792
  const boost = (1 + vulns.dmgVuln / 100) * (1 + vulns.finalDmg / 100)
  const readings = getEnemyReys(enemyProfile, ELEMENTS).map((row) => {
    const shred = shredFor(row.attributeKey)
    const effective = row.value - shred
    const base = resistMultiplier(effective)
    return { ...row, shred, effective, base, net: base * boost }
  })
  const picked = readings.find((row) => row.elementId === focus) ?? readings[0]

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

  const writeState = (state: SourceState, next: string | number | boolean) => {
    if (state.source.type === 'enemy') {
      onEnemyChange(setEnemyState(enemyProfile, state.id, next))
      return
    }
    setSourceState(onRtPdt, runtime, runtime, state, next, runtime)
  }

  const readState = (state: SourceState): string | number | boolean => {
    if (state.source.type === 'enemy') {
      return getEnemyState(enemyProfile, state.id) as string | number | boolean
    }
    return (readRtPath(runtime, state.path)
      ?? getSrcSttNct(runtime, runtime, state, runtime)) as string | number | boolean
  }

  const stateControl = (state: SourceState, label: string): ReactNode => {
    const current = readState(state)

    if (state.kind === 'toggle') {
      return (
        <Switch
          on={current === true}
          label={label}
          onToggle={() => writeState(state, current !== true)}
        />
      )
    }

    if (state.kind === 'select') {
      const options = sourceOptions(runtime, runtime, state, runtime)
      const value = String(current ?? options[0]?.id ?? '')

      return (
        <span className="enc-opts" role="group" aria-label={label}>
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={value === option.id}
              onClick={() => writeState(state, option.id)}
            >
              {option.label}
            </button>
          ))}
        </span>
      )
    }

    const min = state.min ?? 0
    const max = state.source.type === 'enemy'
      ? state.max ?? 1
      : srcSttNumMax(runtime, runtime, state, runtime) ?? state.max ?? 1

    if (state.kind === 'stack') {
      return (
        <span className="enc-cnt">
          <DragNum
            value={Number(current) || 0}
            min={min}
            max={max}
            label={label}
            onChange={(next) => writeState(state, next)}
          />
          <span className="enc-cnt__max">{max}</span>
        </span>
      )
    }

    return (
      <NumberInput
        value={Number(current) || 0}
        min={min}
        max={max}
        step={0.1}
        onChange={(next) => writeState(state, clampNumber(next, min, max))}
      />
    )
  }

  const rowWorth = (row: VulnRow): ReactNode => {
    if (!row.active) {
      return row.state ? undefined : <span className="enc-rw__w is-idle">Off</span>
    }
    const tone = row.value > 0 ? 'is-up' : row.value < 0 ? 'is-down' : 'is-idle'
    return <span className={`enc-rw__w ${tone}`}>{fmtPct(row.value)}</span>
  }

  const stateById = new Map(enemyStates.map((state) => [state.controlKey, state]))
  const subLine = (row: VulnRow) => [
    row.scope,
    row.stat === 'finalDmg' ? 'Final DMG' : null,
  ].filter(Boolean).join(' · ')

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="enemy-console"
      ariaLabel="Target"
      style={{
        '--modal-accent': enemyColor,
        '--picker-modal-accent': enemyColor,
      } as CssProps}
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
          ) : (
            <span className="amdl__pill">
              <span className="amdl__pill-label">Class</span>
              <span className="amdl__pill-value">{ENEMY_CLASS_TXT[enemyClass]}</span>
            </span>
          )}
        </ModalHeader>

        <div className="amdl__body enc__body">
          <div className="enc-core">
            <div className="enc-inp">
              <span className="enc-seg" role="group" aria-label="Scenario mode">
                {([['Tower', true], ['Field', false]] as Array<[string, boolean]>).map(([label, toa]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={enemyProfile.toa === toa}
                    onClick={() => onEnemyChange(tglEnemyTwrM(enemyProfile, selEnemy, toa))}
                  >
                    {label}
                  </button>
                ))}
              </span>
              <span className="enc-lvl">
                <span className="enc-lvl__lab">Level</span>
                <DragNum
                  value={enemyProfile.level}
                  min={1}
                  max={120}
                  label="Target level"
                  onChange={(next) => onEnemyChange(setEnemyLvl(enemyProfile, next))}
                />
                <span className="enc-lvl__def">Defense<b>{defense.toLocaleString()}</b></span>
              </span>
            </div>

            <div className="enc-mk">
              {readings.map((row) => (
                <button
                  key={row.elementId}
                  type="button"
                  aria-pressed={row.elementId === focus}
                  style={{ '--el': ATTR_ID_COLORS[row.elementId] } as CssProps}
                  title={`${row.label} · RES ${fmtRes(row.value)}`
                    + `${row.shred ? ` (effective ${fmtRes(row.effective)})` : ''}`
                    + ` · damage x${formatTruncCompact(row.base, 3)}`}
                  onClick={() => setFocus(row.elementId)}
                >
                  <span
                    className={row.net > 1.005 ? 'enc-mk__fig is-over' : 'enc-mk__fig'}
                    style={{
                      '--enc-ic': `url(/assets/game/attributes/icons/${row.attributeKey}.webp)`,
                      '--enc-f': `${Math.min(100, row.net * 100)}%`,
                    } as CssProps}
                  >
                    <i className="enc-mk__dim" />
                    <i className="enc-mk__lit" />
                  </span>
                  <span className="enc-mk__v">{fmtX(row.net)}</span>
                  <span className="enc-mk__bl" />
                </button>
              ))}
            </div>

            <div className="enc-read">
              <b>{picked.label}</b>
              {custom ? null : (
                <span className="enc-read__s">
                  {`RES ${fmtRes(picked.value)}`}
                  {picked.shred ? <> {'→'} <u>{fmtRes(picked.effective)}</u> effective</> : null}
                </span>
              )}
              {custom ? (
                <NumberInput
                  value={picked.value}
                  min={-100}
                  max={200}
                  onChange={(next) => onEnemyChange(
                    setEnemyResi(enemyProfile, picked.elementId, next),
                  )}
                />
              ) : (
                <span className="enc-read__x">{fmtX(picked.net)}</span>
              )}
            </div>
          </div>

          {targetRows.length > 0 ? (
            <section className="enc-sec">
              <div className="enc-sec__hd"><span className="amdl__over">Combat Effects</span></div>
              {targetRows.map((row) => {
                const state = row.state ? stateById.get(row.id) ?? row.state : null
                return (
                  <Row
                    key={row.id}
                    id={row.id}
                    name={row.label}
                    worth={rowWorth(row)}
                    control={state ? stateControl(state, row.label) : <span className="enc-pin">Active</span>}
                    scope={subLine(row) || null}
                    description={row.description}
                    params={row.params}
                    dim={!row.active}
                    open={isOpen(row.id)}
                    onToggle={() => toggleOpen(row.id)}
                  />
                )
              })}
            </section>
          ) : null}

          <section className="enc-sec">
            <Row
              id="tuneStrain"
              name="Tune Strain"
              worth={undefined}
              control={(
                <span className="enc-cnt">
                  <DragNum
                    value={tune}
                    min={0}
                    max={tuneMax}
                    label="Tune Strain"
                    onChange={(next) => onEnemyChange(setEnemyTune(enemyProfile, next))}
                  />
                  <span className="enc-cnt__max">{tuneMax}</span>
                </span>
              )}
              open={false}
              onToggle={() => {}}
            >
              {responders.length > 0 ? (
                <div className="enc-rsp">
                  {responders.map((entry) => (
                    <Row
                      key={entry.id}
                      id={entry.id}
                      name={entry.title}
                      worth={entry.total !== 0
                        ? <span className="enc-rw__w is-up">{fmtPct(entry.total)}</span>
                        : undefined}
                      control={entry.states.map((state) => (
                        <span key={state.controlKey}>{stateControl(state, entry.title)}</span>
                      ))}
                      description={entry.body}
                      equation={entry.equation}
                      dim={entry.total === 0}
                      open={isOpen(entry.id)}
                      onToggle={() => toggleOpen(entry.id)}
                    />
                  ))}
                </div>
              ) : null}
            </Row>

            {loads.map((load) => (
              <Row
                key={load.key}
                id={load.key}
                name={load.label}
                glyph={`/assets/game/attributes/icons/${NEG_EFFECT_ELEM[load.key]}.webp`}
                control={load.stackMode === 'fixedMax' ? (
                  <span className="enc-pin"><b>{load.max}</b>at max</span>
                ) : (
                  <span className="enc-cnt">
                    <DragNum
                      value={runtime.state.combat[load.key] ?? 0}
                      min={0}
                      max={load.max}
                      label={load.label}
                      onChange={(next) => onRtPdt((prev) => ({
                        ...prev,
                        state: {
                          ...prev.state,
                          combat: {
                            ...prev.state.combat,
                            [load.key]: clampNumber(next, 0, load.max),
                          },
                        },
                      }))}
                    />
                    <span className="enc-cnt__max">{load.max}</span>
                  </span>
                )}
                open={false}
                onToggle={() => {}}
              />
            ))}
          </section>

          {vulns.dmgVuln !== 0 ? (
            <div className="enc-tot"><span>DMG Vulnerability</span><b>{fmtPct(vulns.dmgVuln)}</b></div>
          ) : null}
          {vulns.finalDmg !== 0 ? (
            <div className="enc-tot"><span>Final DMG</span><b>{fmtPct(vulns.finalDmg)}</b></div>
          ) : null}
        </div>

        <div className="amdl__foot enc-foot">
          <span className="amdl__over">Presets</span>
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

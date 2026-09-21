/*
  Author: Runor Ewhro
  Description: Edits optimizer search constraints and execution preferences,
               gates mode-dependent settings, and opens delegated configuration.
*/

import { useCallback, useMemo, useState } from 'react'
import { Settings2, Trash2 } from 'lucide-react'
import type { OptSearchMode, OptSetChoice, OptSets, OptStatCstr } from '@/domain/entities/optimizer'
import type { OptPrgr } from '@/engine/optimizer/types'
import type { SelectGroup, SelectOption } from '@/application/ui/LiquidSelect'
import type { SntSetConds } from '@/domain/entities/sonataSetConditionals'
import type { WeaponPlanSet } from '@/domain/entities/suggestions'
import { ECHO_SET_DEFS } from '@/data/gameData/echoSets/effects'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback'
import { Choice, DropHead, DropHost, Glyph, OutRow, Slide, Toggle } from './Drop.tsx'
import { formatOptimizerTime } from '../lib/progress.ts'
import {
  optSetPieceCount,
  type OptSetPieceCount as PieceCount,
} from '@/engine/optimizer/config/allowedSets.ts'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

const BUCKETS: PieceCount[] = [5, 3, 1]
const BUCKET_LABEL: Record<PieceCount, string> = { 5: '5pc', 3: '3pc', 1: '1pc' }

// Elemental main-stat filtering uses one selectedBonus, unlike the plain-stat list.
const MAIN_STATS: Array<{ value: string; label: string; glyph: string }> = [
  { value: 'atk%', label: 'ATK%', glyph: 'atkPercent' },
  { value: 'hp%', label: 'HP%', glyph: 'hpPercent' },
  { value: 'def%', label: 'DEF%', glyph: 'defPercent' },
  { value: 'er', label: 'Energy Regen', glyph: 'energyRegen' },
  { value: 'cr', label: 'Crit Rate', glyph: 'critRate' },
  { value: 'cd', label: 'Crit DMG', glyph: 'critDmg' },
  { value: 'healing', label: 'Healing', glyph: 'healingBonus' },
]

const BONUS_ELEMENTS: Array<[string, string]> = [
  ['glacio', 'Glacio'],
  ['fusion', 'Fusion'],
  ['electro', 'Electro'],
  ['aero', 'Aero'],
  ['spectro', 'Spectro'],
  ['havoc', 'Havoc'],
]

// the eight pairs encStatCstrs actually writes into the search kernel.
const LIMITS: Array<{ key: string; label: string; glyph: string }> = [
  { key: 'atk', label: 'ATK', glyph: 'atk' },
  { key: 'hp', label: 'HP', glyph: 'hp' },
  { key: 'def', label: 'DEF', glyph: 'def' },
  { key: 'er', label: 'ER%', glyph: 'energyRegen' },
  { key: 'cr', label: 'CR%', glyph: 'critRate' },
  { key: 'cd', label: 'CD%', glyph: 'critDmg' },
  { key: 'bonus', label: 'BNS%', glyph: 'aero' },
  { key: 'damage', label: 'DMG', glyph: '' },
]

const EMPTY_CHOICE: OptSetChoice = { 1: [], 3: [], 5: [] }
const LIMIT_MIN = 64
const LIMIT_MAX = 65536
const LIMIT_POW = Math.log2(LIMIT_MAX / LIMIT_MIN)

export type OptTransportConfig = Pick<
  OptSets,
  | 'searchMode'
  | 'targetMode'
  | 'targetSkillId'
  | 'targetComboSourceId'
  | 'allowedSets'
  | 'mainStatFilter'
  | 'selectedBonus'
  | 'excludeEquipped'
  | 'includeWeapons'
  | 'keepPercent'
  | 'statConstraints'
  | 'resultsLimit'
  | 'enableGpu'
  | 'lowMemoryMode'
>

export interface OptTransportProps {
  isLoading: boolean
  progress: OptPrgr
  cancelled: boolean
  success: boolean
  echoCount: number
  resultCount: number
  batchSize: number | null

  searchMode: OptSearchMode
  targetMode: 'skill' | 'combo'
  comboAvailable: boolean
  skillOptions: SelectOption[]
  skillGroups?: SelectGroup[]
  skillColors: ReadonlyMap<string, string>
  comboOptions: SelectOption[]
  targetSkillId: string | null
  targetComboId: string | null

  mainEcho: { id: string; name: string; icon: string } | null
  allowedSets: OptSetChoice
  mainStatFilter: string[]
  selectedBonus: string | null
  excludeEquipped: boolean
  includeWeapons: boolean
  keepPercent: number
  inventoryExcluded: number
  inventoryMode: 'include' | 'exclude'
  setConds: SntSetConds
  weaponPlan: WeaponPlanSet
  statConstraints: Record<string, OptStatCstr>
  resultsLimit: number
  enableGpu: boolean
  lowMemoryMode: boolean

  onRun: () => void
  onHalt: () => void
  onClear: () => void
  onConfig: (config: OptTransportConfig) => void
  onOpenMainEcho: () => void
  onClearMainEcho: () => void
  onOpenInventorySearch: () => void
  onOpenSetCond: () => void
  onOpenWeaponCond: () => void
  onGuide: () => void
  onRules: () => void
}

export function OptTransport(props: OptTransportProps) {
  const {
    isLoading, progress, cancelled, success,
    echoCount, resultCount, batchSize,
    comboAvailable,
    skillOptions, skillGroups, skillColors, comboOptions, targetSkillId, targetComboId,
    mainEcho,
    inventoryExcluded, inventoryMode, setConds, weaponPlan,
  } = props

  const [drop, setDrop] = useState<string | null>(null)
  const [setBucket, setSetBucket] = useState<PieceCount>(5)
  const [setQuery, setSetQuery] = useState('')
  const sourceConfig = useMemo<OptTransportConfig>(() => ({
    searchMode: props.searchMode,
    targetMode: props.targetMode,
    targetSkillId,
    targetComboSourceId: targetComboId,
    allowedSets: props.allowedSets,
    mainStatFilter: props.mainStatFilter,
    selectedBonus: props.selectedBonus,
    excludeEquipped: props.excludeEquipped,
    includeWeapons: props.includeWeapons,
    keepPercent: props.keepPercent,
    statConstraints: props.statConstraints,
    resultsLimit: props.resultsLimit,
    enableGpu: props.enableGpu,
    lowMemoryMode: props.lowMemoryMode,
  }), [
    props.allowedSets,
    props.enableGpu,
    props.excludeEquipped,
    props.includeWeapons,
    props.keepPercent,
    props.lowMemoryMode,
    props.mainStatFilter,
    props.resultsLimit,
    props.searchMode,
    props.selectedBonus,
    props.statConstraints,
    props.targetMode,
    targetComboId,
    targetSkillId,
  ])
  const session = useConfigurationSession({
    source: sourceConfig,
    active: drop !== null,
    commit: (reducer) => props.onConfig(reducer(sourceConfig)),
  })
  const config = drop === null ? sourceConfig : session.draft
  const {
    searchMode,
    targetMode,
    targetSkillId: draftTargetSkillId,
    targetComboSourceId: draftTargetComboId,
    allowedSets,
    mainStatFilter,
    selectedBonus,
    excludeEquipped,
    includeWeapons,
    keepPercent,
    statConstraints,
    resultsLimit,
    enableGpu,
    lowMemoryMode,
  } = config
  const patchConfig = useCallback((patch: Partial<OptTransportConfig>) => {
    session.update((current) => ({ ...current, ...patch }))
  }, [session])
  const changeDrop = useCallback((next: string | null) => {
    setDrop(next)
    if (next === null) session.finish()
  }, [session])

  const isTheory = searchMode === 'theory'
  const isCombo = targetMode === 'combo'
  // Rotation mode does not apply single-skill keep trimming or stat limits.
  const limitsLive = !isCombo
  const filterLive = !isCombo && !isTheory

  const setOptions = useMemo(() => {
    const byBucket: Record<PieceCount, Array<{ id: number; name: string; icon: string | null }>> = { 1: [], 3: [], 5: [] }
    for (const set of ECHO_SET_DEFS) {
      const bucket: PieceCount = set.setMax === 1 || set.setMax === 3 ? set.setMax : 5
      byBucket[bucket].push({ id: set.id, name: getSntSetNam(set.id), icon: getSntSetIco(set.id) })
    }
    for (const bucket of BUCKETS) {
      byBucket[bucket].sort((left, right) => left.name.localeCompare(right.name))
    }
    return byBucket
  }, [])

  const setTotal = BUCKETS.reduce((sum, bucket) => sum + allowedSets[bucket].length, 0)
  const setRows = useMemo(() => {
    const term = setQuery.trim().toLowerCase()
    const rows = setOptions[setBucket]
    return term ? rows.filter((row) => row.name.toLowerCase().includes(term)) : rows
  }, [setBucket, setOptions, setQuery])

  const fx = useMemo(() => {
    let parts = 0
    for (const set of ECHO_SET_DEFS) parts += set.parts.length
    let setOff = 0
    for (const list of Object.values(setConds?.off ?? {})) setOff += list.length
    let weaponOff = 0
    for (const states of Object.values(weaponPlan?.states ?? {})) {
      for (const state of Object.values(states)) if (state?.off) weaponOff += 1
    }
    return { parts, setOn: Math.max(0, parts - setOff), setOff, weaponOff }
  }, [setConds, weaponPlan])

  const limitCount = useMemo(
    () => LIMITS.filter(({ key }) => {
      const entry = statConstraints[key]
      return Boolean(entry?.minTotal || entry?.maxTotal)
    }).length,
    [statConstraints],
  )

  const targetLabel = isCombo
    ? comboOptions.find((option) => option.value === draftTargetComboId)?.label ?? 'Select combo'
    : skillOptions.find((option) => option.value === draftTargetSkillId)?.label ?? 'Select skill'

  const status = isLoading
    ? progress.phase === 'discovering'
      ? `Discovering · ${progress.discovered ? progress.discovered.toLocaleString() : '...'}`
      : `${Math.floor(progress.progress * 100)}% · ${progress.processed.toLocaleString()} processed`
    : cancelled
      ? 'Cancelled'
      : success
        ? `${resultCount.toLocaleString()} builds · ${formatOptimizerTime(progress.elapsedMs, '...')}`
        : `Standby · ${echoCount} ${isTheory ? 'build echoes' : 'echoes'}`

  const limitToSlider = (limit: number) => {
    const clamped = Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, limit))
    return (Math.log2(clamped / LIMIT_MIN) / LIMIT_POW) * 100
  }
  const sliderToLimit = (value: number) => {
    // snap to the nearest power of two so worker payload sizes stay predictable.
    const pow = Math.round((Math.min(100, Math.max(0, value)) / 100) * LIMIT_POW)
    return Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, LIMIT_MIN * Math.pow(2, pow)))
  }

  const toggleSet = (id: number) => {
    const bucket = optSetPieceCount(id)
    const current = allowedSets[bucket]
    patchConfig({
      allowedSets: {
        ...allowedSets,
        [bucket]: current.includes(id)
          ? current.filter((entry) => entry !== id)
          : [...current, id].sort((left, right) => left - right),
      },
    })
  }

  return (
    <div className="rte-bar opb-bar">
      <button
        type="button"
        className={`opb-key${isLoading ? ' is-halt' : ''}`}
        onClick={() => (isLoading ? props.onHalt() : props.onRun())}
      >
        {isLoading ? 'Halt' : 'Run'}
      </button>

      <span className="rte-read opb-read">
        <span className="rte-read__face">
          <span className="rte-read__dot" aria-hidden="true" />
          <span className="rte-read__name">{status}</span>
        </span>
      </span>

      <span className="rte-pipe" aria-hidden="true" />

      <DropHost
        id="target"
        openId={drop}
        onOpen={changeDrop}
        label="Target"
        trigger={({ open, toggle }) => (
          <button type="button" className={`opb-tag${open ? ' is-on' : ''}`} onClick={toggle}>
            {isCombo ? 'Combo' : 'Skill'}
            <i>{targetLabel}</i>
            <span className="opb-tag__car" aria-hidden="true" />
          </button>
        )}
      >
        <DropHead
          title="Target"
          action={comboAvailable ? (
            <button
              type="button" className="app-popup__action"
              onClick={() => patchConfig({ targetMode: isCombo ? 'skill' : 'combo' })}
            >
              {isCombo ? 'Skill' : 'Combo'}
            </button>
          ) : undefined}
        />
        <div className="rte-choice__options">
          {isCombo
            ? comboOptions.map((option) => (
              <Choice
                key={String(option.value)}
                on={option.value === draftTargetComboId}
                label={option.label}
                onSelect={() => {
                  patchConfig({ targetComboSourceId: String(option.value) })
                  changeDrop(null)
                }}
              />
            ))
            : (skillGroups ?? [{ label: '', options: skillOptions }]).map((group) => (
              <div key={group.label || 'skills'}>
                {group.label ? <div className="app-popup__header"><span>{group.label}</span></div> : null}
                {group.options.map((option) => (
                  <Choice
                    key={String(option.value)}
                    on={option.value === draftTargetSkillId}
                    label={option.label}
                    accent={skillColors.get(String(option.value))}
                    onSelect={() => {
                      patchConfig({ targetSkillId: String(option.value) })
                      changeDrop(null)
                    }}
                  />
                ))}
              </div>
            ))}
        </div>
      </DropHost>

      <DropHost
        id="source"
        openId={drop}
        onOpen={changeDrop}
        label="Search source"
        trigger={({ open, toggle }) => (
          <button type="button" className={`opb-tag${open ? ' is-on' : ''}`} onClick={toggle}>
            {isTheory ? 'Theorymax' : 'Inventory'}
            <span className="opb-tag__car" aria-hidden="true" />
          </button>
        )}
      >
        <DropHead title="Source" value={echoCount} unit={isTheory ? 'build echoes' : 'echoes'} />
        <div className="rte-choice__options">
          <Choice on={!isTheory} label="Inventory" tail="bag" onSelect={() => patchConfig({ searchMode: 'inventory' })} />
          <Choice on={isTheory} label="Theorymax" tail="equipped rolls" onSelect={() => patchConfig({ searchMode: 'theory' })} />
        </div>
        <div className="opb-rule" />
        <div className="opb-drop__body">
          {isTheory ? (
            <Toggle
              on={includeWeapons}
              label="Search weapons too"
              onToggle={() => patchConfig({ includeWeapons: !includeWeapons })}
            />
          ) : (
            <>
              <Toggle
                on={excludeEquipped}
                label="Skip echoes equipped elsewhere"
                onToggle={() => patchConfig({ excludeEquipped: !excludeEquipped })}
              />
              <OutRow
                label="Inventory Search"
                at={inventoryExcluded > 0 ? `${inventoryExcluded} ${inventoryMode === 'include' ? 'kept' : 'excluded'}` : undefined}
                onOpen={() => {
                  changeDrop(null)
                  props.onOpenInventorySearch()
                }}
              />
            </>
          )}
        </div>
        {filterLive ? (
          <>
            <div className="opb-rule" />
            <div className="opb-drop__body">
              <Slide
                label="Filter strength"
                value={Math.round(keepPercent * 100)}
                read={`${Math.round(keepPercent * 100)}%`}
                max={90}
                step={10}
                disabled={isLoading}
                onChange={(value) => patchConfig({ keepPercent: value / 100 })}
              />
            </div>
          </>
        ) : null}
      </DropHost>

      <span className="rte-pipe" aria-hidden="true" />

      <button
        type="button"
        className={`opb-tag${mainEcho ? ' is-on' : ''}`}
        title={mainEcho ? `Main echo locked to ${mainEcho.name}` : 'Lock a main echo'}
        onClick={() => {
          changeDrop(null)
          props.onOpenMainEcho()
        }}
      >
        {mainEcho ? (
          <>
            <img className="opb-tag__ico" src={mainEcho.icon} alt="" loading="lazy" onError={withDefEchoMg} />
            {mainEcho.name}
          </>
        ) : (
          'Main echo'
        )}
      </button>

      <DropHost
        id="sets"
        openId={drop}
        onOpen={changeDrop}
        label="Sonata sets"
        trigger={({ open, toggle }) => (
          <button type="button" className={`opb-tag${open ? ' is-on' : ''}`} onClick={toggle}>
            Sets
            <i>{setTotal || 'any'}</i>
            <span className="opb-tag__car" aria-hidden="true" />
          </button>
        )}
      >
        <DropHead title="Sonata sets" value={setTotal} unit={`/ ${ECHO_SET_DEFS.length}`} />
        <div className="opb-sets">
          <div className="opb-sets__tabs">
            {BUCKETS.map((bucket) => (
              <button
                key={bucket}
                type="button"
                className={`opb-sets__tab${setBucket === bucket ? ' is-on' : ''}`}
                onClick={() => setSetBucket(bucket)}
              >
                {BUCKET_LABEL[bucket]}
                <i>{allowedSets[bucket].length}/{setOptions[bucket].length}</i>
              </button>
            ))}
          </div>
          <label className="opb-find">
            ⌕
            <input
              type="search"
              value={setQuery}
              placeholder="Search"
              onChange={(event) => setSetQuery(event.target.value)}
            />
          </label>
          <div className="opb-sets__list">
            {setRows.length === 0 ? (
              <p className="opb-note">No set by that name.</p>
            ) : setRows.map((row) => {
              const on = allowedSets[setBucket].includes(row.id)
              return (
                <button
                  key={row.id}
                  type="button"
                  className={`opb-sets__row${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleSet(row.id)}
                >
                  <span className="opb-box" aria-hidden="true" />
                  {row.icon ? <img src={row.icon} alt="" loading="lazy" onError={withDefIconM} /> : null}
                  <span>{row.name}</span>
                </button>
              )
            })}
          </div>
        </div>
        <div className="app-popup__footer">
          <button
            type="button" className="app-popup__action"
            onClick={() => patchConfig({
              allowedSets: {
                ...allowedSets,
                [setBucket]: setOptions[setBucket].map((row) => row.id),
              },
            })}
          >
            All {BUCKET_LABEL[setBucket]}
          </button>
          <button
            type="button" className="app-popup__action"
            onClick={() => patchConfig({
              allowedSets: { ...allowedSets, [setBucket]: [] },
            })}
          >
            None
          </button>
          <span className="app-popup__fill" />
          <button type="button" className="app-popup__action" onClick={() => patchConfig({ allowedSets: EMPTY_CHOICE })}>
            Any
          </button>
        </div>
      </DropHost>

      <DropHost
        id="mains"
        openId={drop}
        onOpen={changeDrop}
        label="Main stat"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className={`opb-tag${open ? ' is-on' : ''}${isTheory ? ' is-dim' : ''}`}
            onClick={toggle}
          >
            Main stat
            <i>{mainStatFilter.length}</i>
            <span className="opb-tag__car" aria-hidden="true" />
          </button>
        )}
      >
        <DropHead
          title="Main stat"
          action={(
            <button
              type="button"
              className="app-popup__action"
              onClick={() => patchConfig({ mainStatFilter: [], selectedBonus: null })}
            >
              Clear
            </button>
          )}
        />
        <div className="opb-mains">
          {MAIN_STATS.map((stat) => {
            const on = mainStatFilter.includes(stat.value)
            return (
              <button
                key={stat.value}
                type="button"
                className={`opb-main${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => patchConfig({
                  mainStatFilter: on
                    ? mainStatFilter.filter((entry) => entry !== stat.value)
                    : [...mainStatFilter, stat.value],
                })}
              >
                <Glyph statKey={stat.glyph} />
                {stat.label}
              </button>
            )
          })}
        </div>
        <div className="opb-rule" />
        <div className={`opb-bns${selectedBonus ? ' is-on' : ''}`}>
          <span className="opb-bns__lab">
            Attribute DMG
            <i>{selectedBonus ? BONUS_ELEMENTS.find(([key]) => key === selectedBonus)?.[1] : 'one only'}</i>
          </span>
          <div className="opb-bns__row">
            {BONUS_ELEMENTS.map(([key, label]) => {
              const on = selectedBonus === key
              return (
                <button
                  key={key}
                  type="button"
                  className={`opb-bns__el${on ? ' is-on' : ''}`}
                  title={`${label} DMG`}
                  aria-label={`${label} DMG`}
                  aria-pressed={on}
                  onClick={() => patchConfig(on
                    ? {
                        selectedBonus: null,
                        mainStatFilter: mainStatFilter.filter((entry) => entry !== 'bonus'),
                      }
                    : {
                        selectedBonus: key,
                        mainStatFilter: mainStatFilter.includes('bonus')
                          ? mainStatFilter
                          : [...mainStatFilter, 'bonus'],
                      })}
                >
                  <Glyph statKey={key} size={1} />
                </button>
              )
            })}
          </div>
        </div>
      </DropHost>

      <DropHost
        id="effects"
        openId={drop}
        onOpen={changeDrop}
        label="Effects"
        trigger={({ open, toggle }) => (
          <button type="button" className={`opb-tag${open ? ' is-on' : ''}`} onClick={toggle}>
            Effects
            {fx.setOff + fx.weaponOff > 0 ? <i>{fx.setOff + fx.weaponOff} off</i> : null}
            <span className="opb-tag__car" aria-hidden="true" />
          </button>
        )}
      >
        <DropHead title="Effects" value={fx.setOn} unit="on" />
        <div className="opb-drop__body">
          <button
            type="button" className="opb-fx"
            onClick={() => {
              changeDrop(null)
              props.onOpenSetCond()
            }}
          >
            <span className="opb-fx__name">Sonata set effects</span>
            <span className="opb-fx__count">{fx.setOn}<i>/ {fx.parts}</i></span>
            <span className="opb-fx__arw" aria-hidden="true">↗</span>
            <span className="opb-fx__bar" aria-hidden="true">
              <i style={{ width: `${fx.parts ? (fx.setOn / fx.parts) * 100 : 0}%` }} />
            </span>
          </button>
          <button
            type="button" className="opb-fx"
            disabled={!isTheory || !includeWeapons}
            onClick={() => {
              changeDrop(null)
              props.onOpenWeaponCond()
            }}
          >
            <span className="opb-fx__name">Weapon effects</span>
            <span className="opb-fx__count">
              {!isTheory || !includeWeapons
                ? <i>weapon search off</i>
                : fx.weaponOff > 0 ? <>{fx.weaponOff}<i>off</i></> : <i>all on</i>}
            </span>
            <span className="opb-fx__arw" aria-hidden="true">↗</span>
            <span className="opb-fx__bar" aria-hidden="true"><i style={{ width: '0%' }} /></span>
          </button>
        </div>
      </DropHost>

      <DropHost
        id="limits"
        openId={drop}
        onOpen={changeDrop}
        label="Stat limits"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className={`opb-tag${open ? ' is-on' : ''}${limitsLive ? '' : ' is-dim'}`}
            onClick={toggle}
          >
            Limits
            <i>{limitsLive ? limitCount : '—'}</i>
            <span className="opb-tag__car" aria-hidden="true" />
          </button>
        )}
      >
        <DropHead
          title="Stat limits"
          action={(
            <button type="button" className="app-popup__action" onClick={() => patchConfig({ statConstraints: {} })}>Clear</button>
          )}
        />
        {limitsLive ? null : <p className="opb-note">Not applied to a combo target.</p>}
        <div className={`opb-lims${limitsLive ? '' : ' is-off'}`}>
          {LIMITS.map((limit) => {
            const current = statConstraints[limit.key] ?? {}
            return (
              <div className="opb-lim" key={limit.key}>
                <span className="opb-lim__name">
                  {limit.glyph ? <Glyph statKey={limit.glyph} size={0.7} /> : null}
                  {limit.label}
                </span>
                <input
                  type="number"
                  placeholder="min"
                  value={current.minTotal ?? ''}
                  onChange={(event) => patchConfig({
                    statConstraints: {
                      ...statConstraints,
                      [limit.key]: {
                        ...statConstraints[limit.key],
                        minTotal: event.target.value,
                      },
                    },
                  })}
                />
                <input
                  type="number"
                  placeholder="max"
                  value={current.maxTotal ?? ''}
                  onChange={(event) => patchConfig({
                    statConstraints: {
                      ...statConstraints,
                      [limit.key]: {
                        ...statConstraints[limit.key],
                        maxTotal: event.target.value,
                      },
                    },
                  })}
                />
              </div>
            )
          })}
        </div>
      </DropHost>

      <DropHost
        id="gear"
        openId={drop}
        onOpen={changeDrop}
        label="Engine settings"
        trigger={({ open, toggle }) => (
          <button
            type="button"
            className={`rte-tool${open ? ' is-on' : ''}`}
            title="Engine settings"
            aria-label="Engine settings"
            aria-expanded={open}
            onClick={toggle}
          >
            <Settings2 size="0.86rem" />
          </button>
        )}
      >
        <DropHead title="Engine" />
        <div className="rte-choice__options">
          <Choice on={enableGpu} label="GPU" tail="WebGPU" onSelect={() => patchConfig({ enableGpu: true })} />
          <Choice on={!enableGpu} label="CPU" tail="workers" onSelect={() => patchConfig({ enableGpu: false })} />
        </div>
        <div className="opb-rule" />
        <div className="opb-drop__body">
          <Toggle
            on={lowMemoryMode}
            label="Low memory"
            onToggle={() => patchConfig({ lowMemoryMode: !lowMemoryMode })}
          />
          <Slide
            label="Results kept"
            value={limitToSlider(resultsLimit)}
            read={resultsLimit.toLocaleString()}
            disabled={isLoading}
            onChange={(value) => patchConfig({ resultsLimit: sliderToLimit(value) })}
          />
        </div>
        <div className="app-popup__footer">
          <span>Batch {batchSize ? batchSize.toLocaleString() : '...'}</span>
          <span className="app-popup__fill" />
          <button type="button" className="app-popup__action" onClick={props.onGuide}>Guide</button>
          <button type="button" className="app-popup__action" onClick={props.onRules}>Rules</button>
        </div>
      </DropHost>

      <button
        type="button" className="rte-tool rte-tool__danger"
        title="Clear results"
        aria-label="Clear results"
        disabled={isLoading || (
          resultCount === 0 &&
          !cancelled &&
          !success &&
          progress.processed === 0 &&
          progress.discovered === 0
        )}
        onClick={props.onClear}
      >
        <Trash2 size="0.86rem" />
      </button>
    </div>
  )
}

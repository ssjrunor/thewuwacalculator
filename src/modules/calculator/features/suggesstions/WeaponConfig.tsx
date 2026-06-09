/*
  Author: Runor Ewhro
  Description: Shared weapon-config modal body (search rules + per-weapon passive
               states), backed by the global weaponSuggests store. Used by both
               the weapon-suggestions pane and the theory optimizer. The optimizer
               passes lockMaxMode: the search only ever scores weapons at max
               passives, so the "Search for…" mode is forced to Max and disabled,
               while the rest of the settings (rarity visibility, ranks) drive the
               candidate set the same way they drive suggestions.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { WeaponPlanSet, WpnStCfg } from '@/domain/entities/suggestions.ts'
import { isStdWpn } from '@/domain/entities/weapon.ts'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { listStatesFor } from '@/domain/services/gameDataService.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { DEFWPNSETS } from './lib/suggestions.ts'
import { isSourceVisible } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { srcSttOpts as sourceOptions } from '@/modules/calculator/model/sourceEval.ts'
import { resPssvPrms, weaponStatsAt, withDefWpnMg } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { NumberInput } from '@/modules/calculator/features/controls/NumberInput.tsx'

const WPN_RARS = [5, 4, 3, 2, 1] as const
type WpnCfgView = 'search' | 'states'

interface WpnStRow {
  wpn: GenWpn
  rt: ResRuntime
  states: SourceState[]
}

// resolve the rank used for a visible weapon candidate; standard-weapon rank
// overrides rarity rank, matching the suggestion engine.
export function getWpnRank(wpn: GenWpn, settings: WeaponPlanSet): number {
  const def = wpn.rarity === 5 ? 1 : 5
  const raw = isStdWpn(wpn.id)
    ? settings.stdRank ?? def
    : settings.ranks[String(wpn.rarity)] ?? def
  return Math.max(1, Math.min(5, Math.round(raw)))
}

// only weapons whose rarity is toggled on are in the search space.
export function canUseWpn(wpn: GenWpn, settings: WeaponPlanSet): boolean {
  return settings.visible[String(wpn.rarity)] ?? false
}

function stDefMax(state: SourceState, opts: Array<{ id: string }> = state.options ?? []): boolean | number | string {
  if (state.kind === 'toggle') return true
  if (state.kind === 'stack' || state.kind === 'number') return state.max ?? state.defaultValue ?? state.min ?? 0
  return state.defaultValue ?? opts[0]?.id ?? ''
}

function clnStMax(state: SourceState, value: boolean | number | string, opts: Array<{ id: string }> = state.options ?? []): boolean | number | string {
  if (state.kind === 'toggle') return true
  if (state.kind === 'stack' || state.kind === 'number') {
    const num = Number(value)
    if (!Number.isFinite(num)) return stDefMax(state, opts)
    const min = state.min ?? 0
    const max = state.max ?? num
    return Math.max(min, Math.min(max, num))
  }
  const str = String(value)
  return opts.some((option) => option.id === str) ? str : stDefMax(state, opts)
}

function hasStCfg(config?: WpnStCfg): boolean {
  return config?.off === true || config?.max !== undefined
}

// normalize the sparse stored config against defaults.
function normPlan(state: Partial<WeaponPlanSet> | null | undefined): WeaponPlanSet {
  return {
    ...DEFWPNSETS,
    ...(state ?? {}),
    ranks: { ...DEFWPNSETS.ranks, ...(state?.ranks ?? {}) },
    visible: { ...DEFWPNSETS.visible, ...(state?.visible ?? {}) },
    stdRank: state?.stdRank ?? DEFWPNSETS.stdRank,
    states: state?.states ?? DEFWPNSETS.states,
  }
}

export function WeaponConfig({
  runtime,
  seed,
  lockMaxMode = false,
}: {
  runtime: ResRuntime
  seed: ResSeed | null
  lockMaxMode?: boolean
}) {
  const weaponSuggests = useAppStore((state) => state.calculator.weaponSuggests)
  const updWpnSuggs = useAppStore((state) => state.updWpnSuggs)

  const [wpnCfgView, setWpnCfgVw] = useState<WpnCfgView>('search')
  const [wpnStQuery, setWpnStQuery] = useState('')
  const [wpnStRarFlt, setWpnStRarFlt] = useState<number | 'all'>('all')

  const wpnSets = useMemo<WeaponPlanSet>(() => normPlan(weaponSuggests), [weaponSuggests])

  const stdWpns = useMemo(
    () => (seed ? listWpnsByTy(seed.weaponType).filter((wpn) => isStdWpn(wpn.id)) : []),
    [seed],
  )

  const wpnStRows = useMemo<WpnStRow[]>(() => {
    if (!seed) return []
    return listWpnsByTy(seed.weaponType)
        .filter((wpn) => canUseWpn(wpn, wpnSets))
        .map((wpn) => {
          const rank = getWpnRank(wpn, wpnSets)
          const stats = weaponStatsAt(wpn, runtime.build.weapon.level)
          const rt: ResRuntime = {
            ...runtime,
            build: { ...runtime.build, weapon: { id: wpn.id, level: runtime.build.weapon.level, rank, baseAtk: stats.atk } },
          }
          const states = listStatesFor('weapon', wpn.id).filter((state) => isSourceVisible(rt, rt, state))
          return { wpn, rt, states }
        })
        .filter((row) => row.states.length > 0)
  }, [seed, runtime, wpnSets])

  const filteredWpnStRows = useMemo(() => {
    const term = wpnStQuery.trim().toLowerCase()
    return wpnStRows.filter((row) => {
      if (wpnStRarFlt !== 'all' && row.wpn.rarity !== wpnStRarFlt) return false
      if (term && !row.wpn.name.toLowerCase().includes(term)) return false
      return true
    })
  }, [wpnStRows, wpnStQuery, wpnStRarFlt])

  const wpnStToggleStats = useMemo(() => {
    let total = 0
    let checked = 0
    for (const row of filteredWpnStRows) {
      for (const state of row.states) {
        total += 1
        if (wpnSets.states[row.wpn.id]?.[state.controlKey]?.off !== true) checked += 1
      }
    }
    return { total, checked, allChecked: total > 0 && checked === total, someChecked: checked > 0 && checked < total }
  }, [filteredWpnStRows, wpnSets.states])

  const wpnStGlobalRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    if (wpnStGlobalRef.current) wpnStGlobalRef.current.indeterminate = wpnStToggleStats.someChecked
  }, [wpnStToggleStats.someChecked])

  const updWpnSets = useCallback((patch: Partial<WeaponPlanSet>) => {
    updWpnSuggs((state) => {
      const prev = normPlan(state)
      return {
        ...prev,
        ...patch,
        ranks: { ...prev.ranks, ...(patch.ranks ?? {}) },
        visible: { ...prev.visible, ...(patch.visible ?? {}) },
        states: patch.states ?? prev.states,
      }
    })
  }, [updWpnSuggs])

  const updWpnSt = useCallback((wpnId: string, cntrKey: string, mkNext: (config: WpnStCfg) => WpnStCfg) => {
    updWpnSuggs((state) => {
      const prev = normPlan(state)
      const states = structuredClone(prev.states)
      const wpnCfg = { ...(states[wpnId] ?? {}) }
      const nextCfg = mkNext({ ...(wpnCfg[cntrKey] ?? {}) })
      if (hasStCfg(nextCfg)) wpnCfg[cntrKey] = nextCfg
      else delete wpnCfg[cntrKey]
      if (Object.keys(wpnCfg).length > 0) states[wpnId] = wpnCfg
      else delete states[wpnId]
      return { ...prev, states }
    })
  }, [updWpnSuggs])

  const applyAllVisibleStates = useCallback((checked: boolean) => {
    updWpnSuggs((state) => {
      const prev = normPlan(state)
      const states = structuredClone(prev.states)
      for (const row of filteredWpnStRows) {
        const wpnCfg = { ...(states[row.wpn.id] ?? {}) }
        for (const stateDef of row.states) {
          const cur = { ...(wpnCfg[stateDef.controlKey] ?? {}) }
          if (checked) delete cur.off
          else cur.off = true
          if (Object.keys(cur).length > 0) wpnCfg[stateDef.controlKey] = cur
          else delete wpnCfg[stateDef.controlKey]
        }
        if (Object.keys(wpnCfg).length > 0) states[row.wpn.id] = wpnCfg
        else delete states[row.wpn.id]
      }
      return { ...prev, states }
    })
  }, [filteredWpnStRows, updWpnSuggs])

  const wpnStProgressPct = wpnStToggleStats.total > 0
    ? `${(wpnStToggleStats.checked / wpnStToggleStats.total) * 100}%`
    : '0%'

  // the optimizer always scores at max state, so the mode is fixed to "max".
  const effMode = lockMaxMode ? 'max' : wpnSets.mode

  return (
    <div className="wpncfg">
      <header className="wpncfg__header">
        <div className="wpncfg__tabs" role="tablist" aria-label="Weapon config view">
          <button type="button" role="tab" aria-selected={wpnCfgView === 'search'} className={`wpncfg__tab${wpnCfgView === 'search' ? ' is-active' : ''}`} onClick={() => setWpnCfgVw('search')}>
            <span className="wpncfg__tab-cap">01</span>
            <span className="wpncfg__tab-label">Search</span>
          </button>
          <button type="button" role="tab" aria-selected={wpnCfgView === 'states'} className={`wpncfg__tab${wpnCfgView === 'states' ? ' is-active' : ''}`} onClick={() => setWpnCfgVw('states')}>
            <span className="wpncfg__tab-cap">02</span>
            <span className="wpncfg__tab-label">Passives</span>
          </button>
        </div>
        {wpnCfgView === 'search' ? (
          <div className="wpncfg__header-meta">
            {effMode === 'both' ? `Both · ranked by ${wpnSets.target}` : effMode}
          </div>
        ) : (
          <label className="ssc-global-row wpncfg__global">
            <input ref={wpnStGlobalRef} type="checkbox" className="ssc-native-checkbox" checked={wpnStToggleStats.allChecked} disabled={wpnStToggleStats.total === 0} onChange={(event) => applyAllVisibleStates(event.target.checked)} />
            <span className="ssc-checkmark">
              <svg className="ssc-checkmark-icon" width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <svg className="ssc-dash-icon" width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true"><path d="M1 1H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            </span>
            <span className="ssc-toggle-label">Toggle all visible</span>
            <span className="ssc-count-display">{wpnStToggleStats.checked} / {wpnStToggleStats.total}</span>
            <span className="ssc-progress-track" aria-hidden="true"><span className="ssc-progress-fill" style={{ width: wpnStProgressPct }} /></span>
          </label>
        )}
      </header>

      {wpnCfgView === 'search' ? (
        <div className="wpncfg__body" key="search">
          <section className={`wpncfg__card${lockMaxMode ? ' is-locked' : ''}`}>
            <div className="wpncfg__card-head">
              <span className="wpncfg__card-cap">Mode</span>
              {lockMaxMode ? <span className="wpncfg__card-sub">Optimizer scores at max passives only</span> : null}
            </div>
            <div className="wpncfg__seg-row">
              <span className="wpncfg__seg-label">Search for…</span>
              <div className="wpncfg__seg">
                <button type="button" className={`wpncfg__seg-btn${effMode === 'default' ? ' is-active' : ''}`} disabled={lockMaxMode} onClick={() => updWpnSets({ mode: 'default', target: 'default' })}>Default</button>
                <button type="button" className={`wpncfg__seg-btn${effMode === 'max' ? ' is-active' : ''}`} disabled={lockMaxMode} onClick={() => updWpnSets({ mode: 'max', target: 'max' })}>Max</button>
                <button type="button" className={`wpncfg__seg-btn${effMode === 'both' ? ' is-active' : ''}`} disabled={lockMaxMode} onClick={() => updWpnSets({ mode: 'both' })}>Both</button>
              </div>
            </div>
            {!lockMaxMode && wpnSets.mode === 'both' && (
              <div className="wpncfg__seg-row">
                <span className="wpncfg__seg-label">Rank by…</span>
                <div className="wpncfg__seg">
                  <button type="button" className={`wpncfg__seg-btn${wpnSets.target === 'default' ? ' is-active' : ''}`} onClick={() => updWpnSets({ target: 'default' })}>Default</button>
                  <button type="button" className={`wpncfg__seg-btn${wpnSets.target === 'max' ? ' is-active' : ''}`} onClick={() => updWpnSets({ target: 'max' })}>Max</button>
                </div>
              </div>
            )}
          </section>

          {stdWpns.length > 0 && (
            <section className="wpncfg__card">
              <div className="wpncfg__card-head">
                <span className="wpncfg__card-cap">Standard Weapons</span>
                <span className="wpncfg__card-sub">{stdWpns.map((wpn) => wpn.name).join(' · ')}</span>
              </div>
              <div className="wpncfg__rank-strip">
                {[1, 2, 3, 4, 5].map((rank) => (
                  <button key={`std-rank-${rank}`} type="button" className={`wpncfg__rank-btn${wpnSets.stdRank === rank ? ' is-active' : ''}`} onClick={() => updWpnSets({ stdRank: rank })}>R{rank}</button>
                ))}
              </div>
            </section>
          )}

          <section className="wpncfg__card">
            <div className="wpncfg__card-head"><span className="wpncfg__card-cap">Rarity Rules</span></div>
            <div className="wpncfg__rarity-grid">
              {WPN_RARS.map((rarity) => {
                const rarKey = String(rarity)
                const showWpn = wpnSets.visible[rarKey] ?? false
                const rankVal = wpnSets.ranks[rarKey] ?? (rarity === 5 ? 1 : 5)
                return (
                  <div key={`wpn-rar-${rarity}`} className={`wpncfg__rarity-cell rarity-${rarity}${showWpn ? '' : ' is-off'}`}>
                    <header className="wpncfg__rarity-head">
                      <span className="wpncfg__rarity-stars">{'★'.repeat(rarity)}</span>
                      <button type="button" className={`wpncfg__pill${showWpn ? ' is-active' : ''}`} onClick={() => updWpnSets({ visible: { [rarKey]: !showWpn } })}>{showWpn ? 'On' : 'Off'}</button>
                    </header>
                    <div className="wpncfg__rank-strip">
                      {[1, 2, 3, 4, 5].map((rank) => (
                        <button key={`wpn-rank-${rarity}-${rank}`} type="button" className={`wpncfg__rank-btn${rankVal === rank ? ' is-active' : ''}`} disabled={!showWpn} onClick={() => updWpnSets({ ranks: { [rarKey]: rank } })}>R{rank}</button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          <footer className="wpncfg__footer">
            <button type="button" className="wpncfg__reset" onClick={() => updWpnSets(DEFWPNSETS)}>↺ Reset to defaults</button>
          </footer>
        </div>
      ) : (
        <div className="wpncfg__body" key="states">
          {wpnStRows.length === 0 ? (
            <div className="wpncfg__empty">No configurable weapon passives in the current search space.</div>
          ) : (
            <>
              <div className="ssc-toolbar wpncfg__toolbar">
                <div className="ssc-tabs">
                  <button type="button" className={`ssc-tab${wpnStRarFlt === 'all' ? ' active' : ''}`} onClick={() => setWpnStRarFlt('all')}>All</button>
                  {WPN_RARS.map((rar) => (
                    <button key={`chip-${rar}`} type="button" className={`ssc-tab${wpnStRarFlt === rar ? ' active' : ''}`} onClick={() => setWpnStRarFlt(rar)}>{rar}★</button>
                  ))}
                </div>
                <div className="rotation-saved-filters__search">
                  <Search size={13} className="rotation-saved-filters__search-icon" />
                  <input type="text" value={wpnStQuery} onChange={(event) => setWpnStQuery(event.target.value)} placeholder="Search weapons…" className="rotation-saved-filters__search-input" aria-label="Filter weapons" />
                </div>
              </div>

              {filteredWpnStRows.length === 0 ? (
                <div className="wpncfg__empty">No matching weapons.</div>
              ) : (
                <div className="wpncfg__weapons">
                  {filteredWpnStRows.map(({ wpn, rt, states }) => {
                    const rank = getWpnRank(wpn, wpnSets)
                    const params = resPssvPrms(wpn.passive.params, rank)
                    const onCount = states.filter((state) => wpnSets.states[wpn.id]?.[state.controlKey]?.off !== true).length
                    const counterClass = onCount === 0 ? 'wpncfg__weapon-counter' : onCount === states.length ? 'wpncfg__weapon-counter is-full' : 'wpncfg__weapon-counter is-partial'
                    return (
                      <article key={`wpn-state-${wpn.id}`} className={`wpncfg__weapon rarity-${wpn.rarity}`}>
                        <header className="wpncfg__weapon-head">
                          <span className="wpncfg__weapon-frame"><img src={wpn.icon} alt={wpn.name} className="wpncfg__weapon-icon" onError={withDefWpnMg} /></span>
                          <div className="wpncfg__weapon-title">
                            <span className="wpncfg__weapon-name">{wpn.name}</span>
                            <span className="wpncfg__weapon-sub">{wpn.passive.name || 'Passive'} · R{rank}</span>
                          </div>
                          <span className={counterClass}>{onCount}/{states.length}</span>
                        </header>
                        <ul className="wpncfg__states">
                          {states.map((state) => {
                            const cfg = wpnSets.states[wpn.id]?.[state.controlKey]
                            const isOn = cfg?.off !== true
                            const opts = state.kind === 'select' ? sourceOptions(rt, rt, state) : []
                            const defMax = stDefMax(state, opts)
                            const maxVal = cfg?.max === undefined ? defMax : clnStMax(state, cfg.max, opts)
                            const toggleStateOff = () => {
                              updWpnSt(wpn.id, state.controlKey, (cur) => {
                                const next = { ...cur }
                                if (isOn) next.off = true
                                else delete next.off
                                return next
                              })
                            }
                            return (
                              <li key={state.controlKey} className={`wpncfg__state${isOn ? ' is-on' : ''}`}>
                                <div className="wpncfg__state-row" role="checkbox" aria-checked={isOn} tabIndex={0} onClick={toggleStateOff} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggleStateOff() } }}>
                                  <span className="wpncfg__checkmark">
                                    <svg className="wpncfg__checkmark-icon" width="9" height="7" viewBox="0 0 9 7" fill="none" aria-hidden="true"><path d="M1 3.5L3 5.5L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                                  </span>
                                  <div className="wpncfg__state-body">
                                    {state.description ? <RichDscr description={state.description} params={params} className="wpncfg__state-desc" /> : <span className="wpncfg__state-desc">{state.label}</span>}
                                  </div>
                                  {isOn && state.kind !== 'toggle' ? (
                                    <span className="wpncfg__state-input" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                                      {state.kind === 'select' ? (
                                        <LiquidSelect value={String(maxVal)} options={opts.map((option) => ({ value: option.id, label: option.label }))} onChange={(nextValue) => {
                                          updWpnSt(wpn.id, state.controlKey, (cur) => { const next = { ...cur }; const clean = clnStMax(state, String(nextValue), opts); if (clean === defMax) delete next.max; else next.max = clean; return next })
                                        }} />
                                      ) : (
                                        <NumberInput value={Number(maxVal)} min={state.min ?? 0} max={state.max} step={state.kind === 'stack' ? 1 : 0.1} onChange={(nextValue) => {
                                          updWpnSt(wpn.id, state.controlKey, (cur) => { const next = { ...cur }; const clean = clnStMax(state, nextValue, opts); if (clean === defMax) delete next.max; else next.max = clean; return next })
                                        }} />
                                      )}
                                    </span>
                                  ) : null}
                                </div>
                              </li>
                            )
                          })}
                        </ul>
                      </article>
                    )
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

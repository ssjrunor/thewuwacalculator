/*
  Author: Runor Ewhro
  Description: Normalizes weapon-search rarity, rank, and passive preferences
               and drafts configuration shared by suggestion and optimizer runs.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties as CssProps } from 'react'
import { Search } from 'lucide-react'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import type { ResSeed } from '@/domain/entities/runtime.ts'
import type { GenWpn } from '@/domain/entities/weapon.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import type { WeaponPlanSet, WpnStCfg } from '@/domain/entities/suggestions.ts'
import { isStdWpn } from '@/domain/entities/weapon.ts'
import { listWpnsByTy } from '@/data/catalog/weaponCatalogService.ts'
import { listStatesFor } from '@/data/catalog/gameDataService.ts'
import { useAppStore } from '@/application/state'
import { DEFWPNSETS } from './lib/suggestions.ts'
import { isSourceVisible } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { sourceOptions as sourceOptions } from '@/engine/services/sourceStateService.ts'
import { resPssvPrms, weaponStatsAt, withDefWpnMg } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import { LiquidSelect } from '@/application/ui/LiquidSelect.tsx'
import { NumberInput } from '@/modules/simulation/features/controls/NumberInput.tsx'
import { rarityVars } from '@/modules/simulation/model/display.ts'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader } from '@/shared/ui/AppModalShell'
import { useConfigurationSession } from '@/shared/ui/useConfigurationSession.ts'

const WPN_RARS = [5, 4, 3, 2, 1] as const
const RANKS = [1, 2, 3, 4, 5] as const
type WpnCfgView = 'search' | 'states'
type RarFilter = number | 'all'

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

const CkMark = ({ className = 'wcfg__ck' }: { className?: string }) => (
  <span className={className}>
    <svg className="wcfg__ck-icon" width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
      <path d="M1 4L3.5 6.5L9 1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <svg className="wcfg__ck-icon wcfg__ck-dash" width="10" height="2" viewBox="0 0 10 2" fill="none" aria-hidden="true">
      <path d="M1 1H9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  </span>
)

function useWpnCfg({
  runtime,
  seed,
  lockMaxMode,
  wpnSets,
  updateWpnSets,
}: {
  runtime: ResRuntime
  seed: ResSeed | null
  lockMaxMode: boolean
  wpnSets: WeaponPlanSet
  updateWpnSets: (updater: (current: WeaponPlanSet) => WeaponPlanSet) => void
}) {
  const [wpnCfgView, setWpnCfgVw] = useState<WpnCfgView>('search')
  const [wpnStQuery, setWpnStQuery] = useState('')
  const [wpnStRarFlt, setWpnStRarFlt] = useState<RarFilter>('all')

  const stdWpns = useMemo(
    () => (seed ? listWpnsByTy(seed.weaponType).filter((wpn) => isStdWpn(wpn.id)) : []),
    [seed],
  )

  // Rarity counts include all weapons of the type, not just configurable passives.
  const poolByRar = useMemo(() => {
    const pool: Record<string, GenWpn[]> = {}
    if (!seed) return pool
    for (const wpn of listWpnsByTy(seed.weaponType)) {
      (pool[String(wpn.rarity)] ??= []).push(wpn)
    }
    return pool
  }, [seed])

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
    updateWpnSets((state) => {
      const prev = normPlan(state)
      return {
        ...prev,
        ...patch,
        ranks: { ...prev.ranks, ...(patch.ranks ?? {}) },
        visible: { ...prev.visible, ...(patch.visible ?? {}) },
        states: patch.states ?? prev.states,
      }
    })
  }, [updateWpnSets])

  const updWpnSt = useCallback((wpnId: string, cntrKey: string, mkNext: (config: WpnStCfg) => WpnStCfg) => {
    updateWpnSets((state) => {
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
  }, [updateWpnSets])

  const applyAllVisibleStates = useCallback((checked: boolean) => {
    updateWpnSets((state) => {
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
  }, [filteredWpnStRows, updateWpnSets])

  const wpnStProgressPct = wpnStToggleStats.total > 0
    ? `${(wpnStToggleStats.checked / wpnStToggleStats.total) * 100}%`
    : '0%'

  // the optimizer always scores at max state, so the mode is fixed to "max".
  const effMode = lockMaxMode ? 'max' : wpnSets.mode

  const tabs = (
    <nav className="wcfg__tabs" role="tablist" aria-label="Weapon config view">
      <button type="button" role="tab" aria-selected={wpnCfgView === 'search'} className={`wcfg__tab${wpnCfgView === 'search' ? ' is-on' : ''}`} onClick={() => setWpnCfgVw('search')}>
        <span className="wcfg__tab-n">01</span>
        <span className="wcfg__tab-l">Search</span>
      </button>
      <button type="button" role="tab" aria-selected={wpnCfgView === 'states'} className={`wcfg__tab${wpnCfgView === 'states' ? ' is-on' : ''}`} onClick={() => setWpnCfgVw('states')}>
        <span className="wcfg__tab-n">02</span>
        <span className="wcfg__tab-l">Passives</span>
      </button>
    </nav>
  )

  const headAside = wpnCfgView === 'search' ? (
    <span className="wcfg__meta">
      {effMode === 'both' ? `Both · ranked by ${wpnSets.target}` : effMode}
    </span>
  ) : (
    <label className="amdl__find wcfg__find">
      <Search size="0.8125rem" aria-hidden="true" />
      <input
        type="text"
        value={wpnStQuery}
        onChange={(event) => setWpnStQuery(event.target.value)}
        placeholder="Search weapons…"
        aria-label="Filter weapons"
      />
    </label>
  )

  const searchBody = (
    <>
      <div className="amdl__pane wcfg__pane">
        <div className="wcfg__sheet">
          <section className={`wcfg__spec${lockMaxMode ? ' is-locked' : ''}`}>
            <span className="wcfg__cap">Mode</span>
            <div className="wcfg__lines">
              <div className="wcfg__line">
                <span className="wcfg__line-k">Search for…</span>
                <span className="wcfg__line-v">
                  {(['default', 'max', 'both'] as const).map((mode) => (
                    <button
                      key={`wpn-mode-${mode}`}
                      type="button"
                      className={`wcfg__pick${effMode === mode ? ' is-on' : ''}`}
                      disabled={lockMaxMode}
                      onClick={() => updWpnSets(mode === 'both' ? { mode } : { mode, target: mode })}
                    >
                      {mode === 'default' ? 'Default' : mode === 'max' ? 'Max' : 'Both'}
                    </button>
                  ))}
                </span>
                {lockMaxMode ? <span className="wcfg__line-note">Optimizer scores at max passives only</span> : null}
              </div>
              {!lockMaxMode && wpnSets.mode === 'both' && (
                <div className="wcfg__line">
                  <span className="wcfg__line-k">Rank by…</span>
                  <span className="wcfg__line-v">
                    {(['default', 'max'] as const).map((target) => (
                      <button
                        key={`wpn-target-${target}`}
                        type="button"
                        className={`wcfg__pick${wpnSets.target === target ? ' is-on' : ''}`}
                        onClick={() => updWpnSets({ target })}
                      >
                        {target === 'default' ? 'Default' : 'Max'}
                      </button>
                    ))}
                  </span>
                </div>
              )}
            </div>
          </section>

          <table className="wcfg__tbl">
            <thead>
              <tr>
                <th scope="col" className="wcfg__stub">Rarity Rules</th>
                {RANKS.map((rank) => (
                  <th key={`wpn-rh-${rank}`} scope="col" className="wcfg__rh">R{rank}</th>
                ))}
                <th scope="col" className="wcfg__ph">Pool</th>
              </tr>
            </thead>
            <tbody>
              {WPN_RARS.map((rarity) => {
                const rarKey = String(rarity)
                const showWpn = wpnSets.visible[rarKey] ?? false
                const rankVal = wpnSets.ranks[rarKey] ?? (rarity === 5 ? 1 : 5)
                const pool = poolByRar[rarKey] ?? []
                return (
                  <tr
                    key={`wpn-rar-${rarity}`}
                    className={`wcfg__row${showWpn ? '' : ' is-off'}`}
                    style={rarityVars(rarity, false, '--wcfg-r') as CssProps}
                  >
                    <td>
                      <span className="wcfg__rule">
                        <span className="wcfg__stars">{'★'.repeat(rarity)}</span>
                        <button type="button" className={`wcfg__onoff${showWpn ? ' is-on' : ''}`} onClick={() => updWpnSets({ visible: { [rarKey]: !showWpn } })}>{showWpn ? 'On' : 'Off'}</button>
                      </span>
                    </td>
                    {RANKS.map((rank) => (
                      <td key={`wpn-rank-${rarity}-${rank}`} className="wcfg__cell">
                        <button
                          type="button"
                          className={`wcfg__dot${rankVal === rank ? ' is-on' : ''}`}
                          aria-label={`R${rank}`}
                          aria-pressed={rankVal === rank}
                          disabled={!showWpn}
                          onClick={() => updWpnSets({ ranks: { [rarKey]: rank } })}
                        />
                      </td>
                    ))}
                    <td>
                      <span className="wcfg__pool">
                        {pool.map((wpn) => (
                          <img key={`wpn-pool-${wpn.id}`} src={wpn.icon} alt={wpn.name} title={wpn.name} loading="lazy" onError={withDefWpnMg} />
                        ))}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {stdWpns.length > 0 && (
                <tr className="wcfg__row wcfg__row--std" style={rarityVars(5, false, '--wcfg-r') as CssProps}>
                  <td>
                    <span className="wcfg__cap wcfg__cap--std">Standard Weapons</span>
                    <span className="wcfg__std-sub">{stdWpns.map((wpn) => wpn.name).join(' · ')}</span>
                  </td>
                  {RANKS.map((rank) => (
                    <td key={`std-rank-${rank}`} className="wcfg__cell">
                      <button
                        type="button"
                        className={`wcfg__dot${wpnSets.stdRank === rank ? ' is-on' : ''}`}
                        aria-label={`R${rank}`}
                        aria-pressed={wpnSets.stdRank === rank}
                        onClick={() => updWpnSets({ stdRank: rank })}
                      />
                    </td>
                  ))}
                  <td>
                    <span className="wcfg__pool">
                      {stdWpns.map((wpn) => (
                        <img key={`std-pool-${wpn.id}`} src={wpn.icon} alt={wpn.name} title={wpn.name} loading="lazy" onError={withDefWpnMg} />
                      ))}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="amdl__foot wcfg__foot">
        <button type="button" className="amdl__act" onClick={() => updWpnSets(DEFWPNSETS)}>↺ Reset to defaults</button>
      </div>
    </>
  )

  const statesBody = wpnStRows.length === 0 ? (
    <div className="amdl__pane wcfg__pane">
      <div className="wcfg__empty">No configurable weapon passives in the current search space.</div>
    </div>
  ) : (
    <div className="amdl__pane wcfg__pane">
      <div className="wcfg__lead">
        <span className="wcfg__chips">
          {(['all', ...WPN_RARS] as RarFilter[]).map((rar) => (
            <button
              key={`chip-${rar}`}
              type="button"
              className={`wcfg__chip${wpnStRarFlt === rar ? ' is-on' : ''}`}
              onClick={() => setWpnStRarFlt(rar)}
            >
              {rar === 'all' ? 'All' : `${rar}★`}
            </button>
          ))}
        </span>
        <label className="wcfg__master">
          <input
            ref={wpnStGlobalRef}
            type="checkbox" className="wcfg__native"
            checked={wpnStToggleStats.allChecked}
            disabled={wpnStToggleStats.total === 0}
            onChange={(event) => applyAllVisibleStates(event.target.checked)}
          />
          <CkMark />
          <span className="wcfg__master-l">Toggle all visible</span>
          <span className={`wcfg__count${wpnStToggleStats.someChecked ? ' is-partial' : ''}`}>{wpnStToggleStats.checked} / {wpnStToggleStats.total}</span>
          <span className="wcfg__prog" aria-hidden="true"><span className="wcfg__prog-fill" style={{ width: wpnStProgressPct }} /></span>
        </label>
      </div>

      {filteredWpnStRows.length === 0 ? (
        <div className="wcfg__empty">No matching weapons.</div>
      ) : (
        filteredWpnStRows.map(({ wpn, rt, states }) => {
          const rank = getWpnRank(wpn, wpnSets)
          const params = resPssvPrms(wpn.passive.params, rank)
          const onCount = states.filter((state) => wpnSets.states[wpn.id]?.[state.controlKey]?.off !== true).length
          const counterClass = onCount === 0 ? 'wcfg__wpn-n' : onCount === states.length ? 'wcfg__wpn-n is-full' : 'wcfg__wpn-n is-partial'
          return (
            <article
              key={`wpn-state-${wpn.id}`} className="wcfg__wpn"
              style={rarityVars(wpn.rarity, false, '--wcfg-r') as CssProps}
            >
              <span className="wcfg__plate">
                <img src={wpn.icon} alt={wpn.name} className="wcfg__plate-img" loading="lazy" onError={withDefWpnMg} />
              </span>
              <div className="wcfg__wpn-body">
                <header className="wcfg__wpn-head">
                  <span className="wcfg__wpn-name">{wpn.name}</span>
                  <span className="wcfg__wpn-sub">{wpn.passive.name || 'Passive'} · R{rank}</span>
                  <span className={counterClass}>{onCount}/{states.length}</span>
                </header>
                <ul className="wcfg__sts">
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
                      <li key={state.controlKey} className={`wcfg__st${isOn ? ' is-on' : ''}`}>
                        <div className="wcfg__st-row" role="checkbox" aria-checked={isOn} tabIndex={0} onClick={toggleStateOff} onKeyDown={(event) => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggleStateOff() } }}>
                          <CkMark />
                          <div className="wcfg__st-body">
                            {state.description ? <RichDscr description={state.description} params={params} className="wcfg__st-desc" /> : <span className="wcfg__st-desc">{state.label}</span>}
                          </div>
                          {isOn && state.kind !== 'toggle' ? (
                            <span className="wcfg__st-input" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
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
              </div>
            </article>
          )
        })
      )}
    </div>
  )

  return { tabs, headAside, body: wpnCfgView === 'search' ? searchBody : statesBody }
}

export function WpnCfgMdl({
  visible,
  open,
  closing = false,
  title,
  onClose,
  runtime,
  seed,
  lockMaxMode = false,
}: {
  visible: boolean
  open: boolean
  closing?: boolean
  title: string
  onClose: (onClosed?: () => void) => void
  runtime: ResRuntime | null
  seed: ResSeed | null
  lockMaxMode?: boolean
}) {
  const weaponSuggests = useAppStore((state) => state.simulation.weaponSuggests)
  const updWpnSuggs = useAppStore((state) => state.updWpnSuggs)
  const session = useConfigurationSession<WeaponPlanSet>({
    source: normPlan(weaponSuggests),
    active: visible,
    commit: updWpnSuggs,
  })
  const close = useCallback(() => onClose(session.finish), [onClose, session])
  const dashIdx = title.indexOf(' - ')
  const eyebrow = dashIdx !== -1 ? title.slice(0, dashIdx) : undefined
  const mainTitle = dashIdx !== -1 ? title.slice(dashIdx + 3) : title

  return (
    <AppModal
      state={{ visible, open, closing }}
      variant="weapon-config"
      ariaLabel={title}
      onClose={close}
    >
      <div className="amdl wcfg">
        {runtime ? (
          <WpnCfgShell
            runtime={runtime}
            seed={seed}
            lockMaxMode={lockMaxMode}
            eyebrow={eyebrow}
            title={mainTitle}
            onClose={close}
            wpnSets={session.draft}
            updateWpnSets={session.update}
          />
        ) : (
          <ModalHeader over={eyebrow} title={mainTitle} onClose={close} />
        )}
      </div>
    </AppModal>
  )
}

function WpnCfgShell({
  runtime,
  seed,
  lockMaxMode,
  eyebrow,
  title,
  onClose,
  wpnSets,
  updateWpnSets,
}: {
  runtime: ResRuntime
  seed: ResSeed | null
  lockMaxMode: boolean
  eyebrow?: string
  title: string
  onClose: () => void
  wpnSets: WeaponPlanSet
  updateWpnSets: (updater: (current: WeaponPlanSet) => WeaponPlanSet) => void
}) {
  const { tabs, headAside, body } = useWpnCfg({
    runtime,
    seed,
    lockMaxMode,
    wpnSets,
    updateWpnSets,
  })
  return (
    <>
      <ModalHeader over={eyebrow} title={title} onClose={onClose}>
        {tabs}
        {headAside}
      </ModalHeader>
      {body}
    </>
  )
}

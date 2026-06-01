/*
  Author: Runor Ewhro
  Description: Renders the config modal surface for the calculator teams flow.
*/

import { type CSSProperties as CssProps, useCallback, useMemo, useState } from 'react'
import { Settings2, Swords } from 'lucide-react'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime.ts'
import { cloneEchoLdt, type InventoryEntry } from '@/domain/entities/inventoryStorage.ts'
import type { SourceState } from '@/domain/gameData/contracts.ts'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { listStatesFor, listOwnersFor } from '@/domain/services/gameDataService.ts'
import { applyCscdRst, getStateTeamTag, getTeamTgtPt, isSourceVisible } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/calculator/features/controls/lib/runtimeStateUtils.ts'
import { RtEchoSetBns, RtMainEchoPn } from '@/modules/calculator/features/echoes/RuntimePanels.tsx'
import { BuffEditor } from '@/modules/calculator/features/buffs/BuffEditor.tsx'
import {
  STATICONMAP,
  fmtDsplVl,
  type VrvwSttsView,
} from '@/modules/calculator/features/overview/lib/stats.ts'
import { getWeapon, weaponStatsAt, resPssvPrms } from '@/modules/calculator/features/weapons/lib/weapon.ts'
import { SourceStateCtrl } from '@/modules/calculator/features/controls/SourceStateControl.tsx'
import { LiquidSelect } from '@/shared/ui/LiquidSelect.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { MdlClsBttn } from '@/shared/ui/ModalCloseButton.tsx'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import type { ResView } from '@/modules/calculator/features/resonator/lib/resonator.ts'
import { withDefResMg, withDefWpnMg } from '@/shared/lib/imageFallback.ts'

// surface the team member config modal that combines state controls, build picks, and stats.
interface TeamMemCnfgM {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  member: ResView
  runtime: ResRuntime
  actRt: ResRuntime
  invBlds: InventoryEntry[]
  sttDefs: SourceState[]
  cmbtSttsView: VrvwSttsView | null
  onSqncChng: (value: number) => void
  onRtPdt: RtUpdHnd
  getSelTgt: (ownerKey: string) => string | null
  setSelTgt: (ownerKey: string, tgtResId: string | null) => void
  onClose: () => void
}

function CmpcCmbtStts({
  statsView,
}: {
  statsView: VrvwSttsView | null
}) {
  if (!statsView) {
    return (
      <div className="soft-empty team-member-config-modal__empty">
        Combat stats are unavailable for this teammate.
      </div>
    )
  }

  return (
    <div className="team-member-config-modal__combat-stats">
      <div className="overview-main-metrics">
        {statsView.mainStats.map((stat) => (
          <div key={stat.label} className="overview-metric-tile">
            <div className="overview-metric-tile-head">
              {STATICONMAP[stat.label] ? (
                <div
                  className="grid-stat-icon overview"
                  style={{
                    '--stat-color': stat.color ?? '#999999',
                    WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                    maskImage: `url(${STATICONMAP[stat.label]})`,
                  } as CssProps}
                />
              ) : null}
              <span>{stat.label}</span>
            </div>
            <span className="overview-metric-tile-value">{fmtDsplVl(stat.label, stat.total)}</span>
          </div>
        ))}
      </div>

      <div className="overview-secondary-list">
        {statsView.secondaryStats.map((stat) => (
          <div key={stat.label} className="overview-secondary-row">
            <span className="overview-secondary-label">
              {STATICONMAP[stat.label] ? (
                <div
                  className="grid-stat-icon overview small"
                  style={{
                    '--stat-color': stat.color ?? '#999999',
                    WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                    maskImage: `url(${STATICONMAP[stat.label]})`,
                  } as CssProps}
                />
              ) : null}
              {stat.label}
            </span>
            <span className="overview-secondary-value">{fmtDsplVl(stat.label, stat.total)}</span>
          </div>
        ))}
      </div>

      <div className="overview-secondary-list">
        {statsView.dmgMdfrStts.map((stat) => (
          <div key={stat.label} className="overview-secondary-row">
            <span
              className="overview-secondary-label"
              style={stat.color ? ({ color: stat.color } as CssProps) : undefined}
            >
              {STATICONMAP[stat.label] ? (
                <div
                  className="grid-stat-icon overview small"
                  style={{
                    '--stat-color': stat.color ?? '#999999',
                    WebkitMaskImage: `url(${STATICONMAP[stat.label]})`,
                    maskImage: `url(${STATICONMAP[stat.label]})`,
                  } as CssProps}
                />
              ) : null}
              {stat.label.replace(' DMG Bonus', '')}
            </span>
            <span
              className="overview-secondary-value"
              style={stat.color ? ({ color: stat.color } as CssProps) : undefined}
            >
              {fmtDsplVl(stat.label, stat.total)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ConfigModal({
  visible,
  open,
  closing = false,
  member,
  runtime,
  actRt: actRt,
  invBlds: invBlds,
  sttDefs: sttDfnt,
  cmbtSttsView: cmbtStatsVie,
  onSqncChng: onSqncChng,
  onRtPdt: onRtPdt,
  getSelTgt: getSelTrgt,
  setSelTgt: setSelTrgt,
  onClose,
}: TeamMemCnfgM) {
  const [selBldId, setSelBldId] = useState<string>('')

  const vlblCntr = useMemo(() => [
    // teammate state controls include both normal panels and resonance-chain controls because cascade resets can cross
    // those groups.
    ...member.statePanels.flatMap((panel) => panel.controls),
    ...member.resonanceChains.flatMap((entry) => entry.controls ?? []),
  ], [member])

  const cscdRtUpd: RtUpdHnd = useCallback((updater) => {
    // teammate edits pass through cascade resets just like active resonator edits, keeping mutually-exclusive controls
    // valid after modal changes.
    onRtPdt((prev) => {
      const next = updater(prev)
      const cscdCntr = applyCscdRst(
        next,
        prev.state.controls,
        next.state.controls,
        vlblCntr,
      )
      return {
        ...next,
        state: { ...next.state, controls: cscdCntr },
      }
    })
  }, [onRtPdt, vlblCntr])

  const weapons = useMemo(() => listWpnsByTy(member.weaponType), [member.weaponType])
  const weaponId = runtime.build.weapon.id
  const weaponDef = useMemo(() => getWeapon(weaponId), [weaponId])
  const currentRank = runtime.build.weapon.rank

  const pssvPrms = useMemo(
    () => (weaponDef ? resPssvPrms(weaponDef.passive.params, currentRank) : []),
    [weaponDef, currentRank],
  )

  const weaponOwner = useMemo(() => {
    // weapon owners provide the grouping desc for state controls; unset weapons intentionally have no owner section.
    if (!weaponId || isNoWeaponId(weaponId)) return null
    const owners = listOwnersFor('weapon', weaponId)
    return owners[0] ?? null
  }, [weaponId])

  const weaponStates = useMemo(() => {
    // weapon states are filtered through teammate-versus-active visibility because team buffs can target different
    // members depending on who is active.
    if (!weaponId || isNoWeaponId(weaponId)) return []
    return listStatesFor('weapon', weaponId).filter((state) =>
      isSourceVisible(runtime, runtime, state, actRt),
    )
  }, [actRt, weaponId, runtime])

  const wpnPtns = useMemo(
    () => weapons.map((w) => ({ value: w.id, label: w.name, icon: w.icon })),
    [weapons],
  )

  const buildOptions = useMemo(
    () => invBlds.map((entry) => ({
      value: entry.id,
      label: `${entry.name} - ${entry.resonatorName}`,
    })),
    [invBlds],
  )

  const rslvSelMkId =
    // if the previously selected build was deleted, fall back to the first available entry instead of leaving the
    // select in a stale state.
    selBldId && invBlds.some((entry) => entry.id === selBldId)
      ? selBldId
      : (invBlds[0]?.id ?? '')

  const selMk = useMemo(
    () => invBlds.find((entry) => entry.id === rslvSelMkId) ?? null,
    [invBlds, rslvSelMkId],
  )

  const onWpnChng = useCallback((nextWeaponId: string) => {
    const selected = weapons.find((w) => w.id === nextWeaponId)
    if (!selected) return
    const stats = weaponStatsAt(selected, 90)
    const newWpnStts = listStatesFor('weapon', nextWeaponId)

    onRtPdt((prev) => {
      const nextControls = { ...prev.state.controls }
      // clear old weapon states before adding defaults so stale passive toggles cannot survive a weapon swap.
      if (prev.build.weapon.id && !isNoWeaponId(prev.build.weapon.id)) {
        const oldPrefix = `weapon:${prev.build.weapon.id}:`
        for (const key of Object.keys(nextControls)) {
          if (key.startsWith(oldPrefix)) {
            delete nextControls[key]
          }
        }
      }
      // apply new weapon state defaults because some passives are on by default when the weapon is equipped.
      for (const state of newWpnStts) {
        if (state.defaultValue !== undefined) {
          const controlKey = state.path.replace(/^runtime\.state\.controls\./, '')
          nextControls[controlKey] = state.defaultValue
        }
      }

      return {
        ...prev,
        build: {
          ...prev.build,
          weapon: { id: selected.id, level: 90, rank: 1, baseAtk: stats.atk },
        },
        state: { ...prev.state, controls: nextControls },
      }
    })
  }, [weapons, onRtPdt])

  const onRankChng = useCallback((rank: number) => {
    const nextRank = Math.max(1, Math.min(5, Math.round(rank)))
    onRtPdt((prev) => ({
      ...prev,
      build: { ...prev.build, weapon: { ...prev.build.weapon, rank: nextRank } },
    }))
  }, [onRtPdt])

  const onLoadMk = useCallback(() => {
    if (!selMk) {
      return
    }

    onRtPdt((prev) => {
      const mkWpnId = selMk.build.weapon.id
      const buildWeapon = mkWpnId && !isNoWeaponId(mkWpnId) ? getWeapon(mkWpnId) : null
      const wpnMtchType = buildWeapon?.weaponType === member.weaponType
      const mkWpnStts = wpnMtchType && buildWeapon
        ? weaponStatsAt(buildWeapon, 90)
        : null
      let nextControls = prev.state.controls

      if (wpnMtchType && mkWpnId) {
        nextControls = { ...prev.state.controls }

        if (prev.build.weapon.id && !isNoWeaponId(prev.build.weapon.id)) {
          const oldPrefix = `weapon:${prev.build.weapon.id}:`
          for (const key of Object.keys(nextControls)) {
            if (key.startsWith(oldPrefix)) {
              delete nextControls[key]
            }
          }
        }

        for (const state of listStatesFor('weapon', mkWpnId)) {
          if (state.defaultValue !== undefined) {
            const controlKey = state.path.replace(/^runtime\.state\.controls\./, '')
            nextControls[controlKey] = state.defaultValue
          }
        }
      }

      return {
        ...prev,
        build: {
          ...prev.build,
          weapon: wpnMtchType
            ? {
                ...prev.build.weapon,
                id: selMk.build.weapon.id,
                level: 90,
                rank: selMk.build.weapon.rank,
                baseAtk: mkWpnStts?.atk ?? prev.build.weapon.baseAtk,
              }
            : prev.build.weapon,
          echoes: cloneEchoLdt(selMk.build.echoes),
        },
        state: {
          ...prev.state,
          controls: nextControls,
        },
      }
    })
  }, [member.weaponType, onRtPdt, selMk])

  if (!visible) {
    return null
  }

  return (
    <AppModal
      state={{ visible, open, closing: closing ?? false }}
      variant="team-config"
      ariaLabelBy="team-member-config-title"
      onClose={onClose}
    >
      <div className="app-modal-header team-member-config-modal__header team-member-config-modal__hero"
           onClick={(event) => event.stopPropagation()}>
        <div className="team-member-config-modal__hero-main">
          <div className="team-member-config-modal__hero-id">
              <span className={`picker-modal__media-frame team-member-config-modal__avatar team-member-config-modal__avatar-frame rarity-${member.rarity}`}>
                <img src={member.profile} alt={member.name} className="picker-modal__media-image" onError={withDefResMg} />
              </span>

            <div className="team-member-config-modal__heading">
              <div className="team-member-config-modal__eyebrow">Teammate</div>

              <div className="team-member-config-modal__hero-title-row">
                <div className="team-member-config-modal__copy">
                  <h2 id="team-member-config-title" className="team-member-config-modal__title">
                    {member.name}
                  </h2>
                  <p className="team-member-config-modal__description">
                    Configure this teammate's runtime, build, and state setup here.
                  </p>
                </div>

                <div className="team-member-config-modal__hero-pills">
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Level</span>
                    <span className="team-member-config-modal__summary-value">Lv {runtime.base.level}</span>
                  </div>
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Investment</span>
                    <span className="team-member-config-modal__summary-value">S{runtime.base.sequence} - R{currentRank}</span>
                  </div>
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Current States</span>
                    <span className="team-member-config-modal__summary-value">{sttDfnt.length + weaponStates.length}</span>
                  </div>
                  <div className="team-member-config-modal__summary-pill">
                    <span className="team-member-config-modal__summary-label">Weapon States</span>
                    <span className="team-member-config-modal__summary-value">{weaponStates.length}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <MdlClsBttn className="team-member-config-modal__close" onClick={onClose} />
        </div>
      </div>

      <div className="team-member-config-modal__workspace">
        <aside className="team-member-config-modal__rail">
          <section className="team-member-config-modal__section team-member-config-modal__section--config ui-surface-card ui-surface-card--section">
            <div className="team-member-config-modal__section-head">
              <div className="team-member-config-modal__section-title">
                  <span className="team-member-config-modal__section-icon" aria-hidden="true">
                    <Settings2 size={16} />
                  </span>
                <div className="team-member-config-modal__section-copy">
                  <h3>Runtime</h3>
                </div>
              </div>
            </div>

            <div className="team-member-config-modal__config-stack">
              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Load Build</span>
                  <span className="team-state-badge">{invBlds.length}</span>
                </div>

                <div className="team-member-config-modal__build-loader">
                  <LiquidSelect
                    value={rslvSelMkId}
                    options={buildOptions}
                    disabled={buildOptions.length === 0}
                    placeholder="No saved builds"
                    onChange={setSelBldId}
                  />
                  <button
                    type="button"
                    className="ui-pill-button team-member-config-modal__build-loader-action"
                    disabled={!selMk}
                    onClick={onLoadMk}
                  >
                    Load Build
                  </button>
                </div>
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Sequence</span>
                  <span className="team-state-badge">S{runtime.base.sequence}</span>
                </div>

                <div className="slider-group">
                  <div className="slider-controls">
                    <input
                        type="range"
                        min={0}
                        max={6}
                        value={runtime.base.sequence}
                        onChange={(event) => onSqncChng(Number(event.target.value))}
                        style={{ '--slider-fill': `${(runtime.base.sequence / 6) * 100}%` } as CssProps}
                    />
                    <span>{runtime.base.sequence}</span>
                  </div>
                </div>
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Combat Stats</span>
                  <span className="team-state-badge">Live</span>
                </div>
                <CmpcCmbtStts statsView={cmbtStatsVie} />
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Echo Sets</span>
                </div>
                <RtEchoSetBns
                  runtime={runtime}
                  actRt={actRt}
                  onRtPdt={cscdRtUpd}
                  getSelTgt={getSelTrgt}
                  setSelTgt={setSelTrgt}
                />
              </section>

              <section className="team-state-config ui-surface-card ui-surface-card--inner">
                <div className="team-member-config-modal__card-head">
                  <span className="team-state-config-title">Main Echo</span>
                </div>
                <RtMainEchoPn
                  runtime={runtime}
                  team={true}
                  actRt={actRt}
                  onRtPdt={cscdRtUpd}
                  getSelTgt={getSelTrgt}
                  setSelTgt={setSelTrgt}
                />
              </section>

              <BuffEditor
                runtime={runtime}
                onRtPdt={onRtPdt}
                cardVariant="inner"
                showQckStts={false}
              />
            </div>
          </section>
        </aside>

        <main className="team-member-config-modal__content">
          <section className="team-member-config-modal__section team-member-config-modal__section--config ui-surface-card ui-surface-card--section">
            <div className="team-member-config-modal__section-head">
              <div className="team-member-config-modal__section-title">
                  <span className="team-member-config-modal__section-icon" aria-hidden="true">
                    <Swords size={16} />
                  </span>
                <div className="team-member-config-modal__section-copy">
                  <h3>Weapon Setup</h3>
                  <span>Weapon stuff.</span>
                </div>
              </div>
            </div>

            <div className="team-member-config-modal__config-stack">
              <div className="team-member-config-modal__weapon-meta">
                <div className={`picker-modal__media-frame team-member-config-modal__avatar team-member-config-modal__avatar-frame rarity-${member.rarity}`}>
                  <img src={weaponDef?.icon ?? `/assets/weapon-icons/${weaponId}.webp`} alt={weaponDef?.name} className="picker-modal__media-image" onError={withDefWpnMg} />
                </div>

                <div className="team-member-config-modal__config-stack">
                  <section className="team-state-config ui-surface-card ui-surface-card--inner">
                    <div className="team-member-config-modal__card-head">
                      <span className="team-state-config-title">Weapon</span>
                      <span className="team-state-badge">Lv 90</span>
                    </div>

                    <LiquidSelect
                        value={weaponId ?? ''}
                        options={wpnPtns}
                        onChange={onWpnChng}
                    />
                  </section>

                  <section className="team-state-config ui-surface-card ui-surface-card--inner">
                    <div className="team-member-config-modal__card-head">
                      <span className="team-state-config-title">Rank</span>
                      <span className="team-state-badge">R{currentRank}</span>
                    </div>

                    <div className="slider-group">
                      <div className="slider-controls">
                        <input
                            type="range"
                            min={1}
                            max={5}
                            value={currentRank}
                            onChange={(event) => onRankChng(Number(event.target.value))}
                            style={{ '--slider-fill': `${((currentRank - 1) / 4) * 100}%` } as CssProps}
                        />
                        <span>{currentRank}</span>
                      </div>
                    </div>
                  </section>
                </div>
              </div>

              {(weaponOwner || weaponStates.length > 0) ? (
                  <section className="team-state-config ui-surface-card ui-surface-card--inner">
                    <div className="team-member-config-modal__card-head">
                      <span className="team-state-config-title">{weaponDef?.passive.name || 'Passive'}</span>
                      <span className="team-state-badge">
                        {weaponStates.length} {weaponStates.length === 1 ? 'state' : 'states'}
                      </span>
                    </div>

                    {weaponOwner?.description ? (
                        <div className="team-member-config-modal__weapon-desc">
                          <RichDscr
                              description={weaponOwner.description}
                              params={pssvPrms}
                          />
                        </div>
                    ) : null}

                    {weaponStates.length > 0 ? (
                        <div className="team-member-config-modal__mini-state-grid">
                          {weaponStates.map((state) => {
                            const targetMode = getStateTeamTag(state)
                            const teamTgtSel = targetMode ? (() => {
                              const options = getTeamTgtPt(actRt, member.id, targetMode)
                              const currentValue = getSelTrgt(state.ownerKey)
                              const fllbVl = options[0]?.value ?? ''
                              const selVl =
                                  typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
                                      ? currentValue
                                      : fllbVl

                              return (
                                  <label className="team-state-target">
                                    Active Resonator
                                    <LiquidSelect
                                        value={selVl}
                                        options={options}
                                        disabled={options.length <= 1}
                                        onChange={(nextValue) => setSelTrgt(state.ownerKey, nextValue || null)}
                                    />
                                  </label>
                              )
                            })() : undefined

                            return (
                                <div key={state.controlKey} className="team-member-config-modal__state-row team-state-control team-member-config-modal__state-row--mini">
                                  <SourceStateCtrl
                                  srcRt={runtime}
                                      tgtRt={runtime}
                                      actRt={actRt}
                                      state={state}
                                      onRtPdt={cscdRtUpd}
                                      teamTgtSlct={teamTgtSel}
                                      dscrPrms={pssvPrms}
                                  />
                                </div>
                            )
                          })}
                        </div>
                    ) : null}
                  </section>
              ) : null}
            </div>
          </section>
          <section className="team-member-config-modal__section team-member-config-modal__section--states ui-surface-card ui-surface-card--section">
            <div className="team-member-config-modal__section-head">
              <div className="team-member-config-modal__section-copy">
                <h3>State Gallery</h3>
                <span>States and target routing.</span>
              </div>
              <span className="team-state-badge">{sttDfnt.length}</span>
            </div>

            {sttDfnt.length > 0 ? (
                <div className="team-member-config-modal__state-gallery">
                  {sttDfnt.map((state) => {
                    const targetMode = getStateTeamTag(state)
                    const teamTgtSel = targetMode ? (() => {
                      const options = getTeamTgtPt(actRt, member.id, targetMode)
                      const currentValue = getSelTrgt(state.ownerKey)
                      const fllbVl = options[0]?.value ?? ''
                      const selVl =
                          typeof currentValue === 'string' && options.some((option) => option.value === currentValue)
                              ? currentValue
                              : fllbVl

                      return (
                          <label className="team-state-target">
                            Active Resonator
                            <LiquidSelect
                                value={selVl}
                                options={options}
                                disabled={options.length <= 1}
                                onChange={(nextValue) => setSelTrgt(state.ownerKey, nextValue || null)}
                            />
                          </label>
                      )
                    })() : undefined

                    return (
                        <div key={state.controlKey} className="team-member-config-modal__state-row team-state-control">
                          <SourceStateCtrl
                              srcRt={runtime}
                              tgtRt={runtime}
                              actRt={actRt}
                              state={state}
                              onRtPdt={cscdRtUpd}
                              teamTgtSlct={teamTgtSel}
                          />
                        </div>
                    )
                  })}
                </div>
            ) : (
                <div className="soft-empty team-member-config-modal__empty">
                  No visible states for this teammate right now.
                </div>
            )}
          </section>
        </main>
      </div>
    </AppModal>
  )
}

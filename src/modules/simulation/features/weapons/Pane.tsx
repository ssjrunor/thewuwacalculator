/*
  Author: Runor Ewhro
  Description: Edits active weapon selection, rank, weapon runtime controls,
               and source-owner detail rendering for the current resonator.
*/

import { useMemo } from 'react'
import type { CSSProperties as CssProps } from 'react'
import { Star, Zap } from 'lucide-react'
import type { PickFreqWeapon } from '@/domain/entities/appState'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime.ts'
import { maxWpnRt, wpnSttsMaxed } from '@/domain/state/sourceStateInit.ts'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { listOwnersFor, listStatesFor } from '@/domain/services/gameDataService.ts'
import { getResonator, WPNTYPETOKEY } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { setWpnLvl } from '@/modules/simulation/features/resonator/lib/buildEdits.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { toTitle } from '@/shared/lib/format.ts'
import {
  getWeapon,
  weaponStatsAt,
  fmtWpnStatDs,
  resPssvPrms,
  withDefWpnMg,
  WPNSTATLBLS,
  WPN_STAT_CNS,
} from '@/modules/simulation/features/weapons/lib/weapon.ts'
import {
  applyWpnSel,
  setWpnRank,
} from '@/modules/simulation/features/weapons/lib/weaponSlotOps.ts'
import { WeaponPicker } from '@/modules/simulation/features/weapons/Picker.tsx'
import { SourceStateCtrl } from '@/modules/simulation/features/controls/SourceStateControl.tsx'
import { isSourceVisible } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { rarityVars } from '@/modules/simulation/model/display.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'

interface WeaponPaneProps {
  runtime: ResRuntime
  onRtPdt: RtUpdHnd
}

function StatIcon({ statKey }: { statKey: string }) {
  const iconPath = WPN_STAT_CNS[statKey]
  if (!iconPath) return null

  return (
    <span className="weapon-stat-icon"
      style={{
        WebkitMaskImage: `url(${iconPath})`,
        maskImage: `url(${iconPath})`,
      }}
    />
  )
}

export function Weapon({ runtime, onRtPdt: onRtPdt }: WeaponPaneProps) {
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)
  const maxWpnOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const resonator = getResonator(runtime.id)
  const weaponType = resonator?.weaponType ?? 4
  const weaponKey = (
    WPNTYPETOKEY[weaponType as keyof typeof WPNTYPETOKEY] ?? 'gauntlets'
  ) as PickFreqWeapon
  const weapons = listWpnsByTy(weaponType)
  const actWpnId = isNoWeaponId(runtime.build.weapon.id) ? null : runtime.build.weapon.id
  const weaponDef = getWeapon(actWpnId)
  const weaponMenu = useAppModal()

  const currentLevel = runtime.build.weapon.level
  const currentRank = runtime.build.weapon.rank
  const levelStats = weaponDef ? weaponStatsAt(weaponDef, currentLevel) : null
  const displayAtk = levelStats ? levelStats.atk : runtime.build.weapon.baseAtk
  const dsplScndStat = levelStats?.scndStatVl ?? 0
  const statLabel = weaponDef ? (WPNSTATLBLS[weaponDef.statKey] ?? weaponDef.statKey) : ''
  const statDisplay = weaponDef ? fmtWpnStatDs(weaponDef.statKey, dsplScndStat) : ''

  const pssvPrms = useMemo(
    () => (weaponDef ? resPssvPrms(weaponDef.passive.params, currentRank) : []),
    [weaponDef, currentRank],
  )

  const weaponOwner = useMemo(() => {
    // owner metadata lives in the state registry rather than the runtime build,
    // so resolve it separately before rendering source details.
    if (!actWpnId) return null
    const owners = listOwnersFor('weapon', actWpnId)
    return owners[0] ?? null
  }, [actWpnId])

  const weaponStates = useMemo(() => {
    // state controls are filtered through runtime visibility rules so hidden
    // weapon passives do not leak inactive controls into the pane.
    if (!actWpnId) return []
    return listStatesFor('weapon', actWpnId).filter((state) =>
      isSourceVisible(runtime, runtime, state),
    )
  }, [actWpnId, runtime])

  const hasStrcDesc = Boolean(weaponOwner?.description || weaponStates.some((s) => s.description))

  const isMaxed = currentLevel === 90 && wpnSttsMaxed(runtime)

  const onWpnSel = (weaponId: string) => {
    const selected = weapons.find((weapon) => weapon.id === weaponId)
    if (!selected) return

    onRtPdt((prev) => applyWpnSel(prev, selected, {
      maxOnInit: maxWpnOnInit,
      level: prev.build.weapon.level,
    }))
    bumpPickerFreq({
      bucket: 'weapon',
      weaponType: weaponKey,
      ids: [selected.id],
    })
    weaponMenu.hide()
  }

  const updateLevel = (level: number) => {
    onRtPdt((prev) => setWpnLvl(prev, level, weaponDef))
  }

  const updateRank = (rank: number) => {
    onRtPdt((prev) => setWpnRank(prev, rank))
  }

  const handleMax = () => {
    if (weaponDef) {
      const stats = weaponStatsAt(weaponDef, 90)
      onRtPdt((prev) => maxWpnRt({
        ...prev,
        build: {
          ...prev.build,
          weapon: {
            ...prev.build.weapon,
            level: 90,
            rank: currentRank,
            baseAtk: stats.atk,
          },
        },
      }, { targetRank: currentRank }))
    } else {
      onRtPdt((prev) => maxWpnRt({
        ...prev,
        build: {
          ...prev.build,
          weapon: { ...prev.build.weapon, level: 90, rank: currentRank },
        },
      }, { targetRank: currentRank }))
    }
  }

  const weaponIcon = weaponDef?.icon ?? '/assets/game/default.webp'
  const weaponRarity = weaponDef?.rarity ?? 4

  const mdlPrtlTgt = mainPortal()

  const wpnPckrPrtl =
    weaponMenu.visible ? (
      <WeaponPicker
        visible={weaponMenu.visible}
        open={weaponMenu.open}
        closing={weaponMenu.closing}
        portalTarget={mdlPrtlTgt}
        weapons={weapons}
        selWpnId={actWpnId}
        recommendedWeaponIds={resonator?.recommendedWeaponIds ?? []}
        onClose={() => weaponMenu.hide()}
        onSelect={onWpnSel}
      />
    ) : null

  const hasPassive = weaponDef && weaponDef.passive.desc
  const hasStates = weaponStates.length > 0

  return (
    <section className="calc-pane resonator-pane weapon-pane">

      <div className="weapon-banner">
        <div className="weapon-banner__top">
          <button
            type="button" className="resonator-avatar-button weapon-banner__avatar"
            style={{
              ...rarityVars(weaponRarity, false, '--avatar-rarity-color'),
              '--rstars': weaponRarity,
            } as CssProps}
            aria-label="Open weapon selector"
            onClick={() => {
              if (weaponMenu.open) {
                weaponMenu.hide()
                return
              }
              weaponMenu.show()
            }}
          >
            <span className="resonator-avatar-button__frame" aria-hidden="true" />
            <span className="resonator-avatar-button__media">
              <img
                src={weaponIcon}
                alt={weaponDef?.name ?? 'Weapon'} className="resonator-avatar weapon-avatar-icon"
                style={{ objectFit: 'contain' }}
                onError={withDefWpnMg}
              />
            </span>
            <span className="res-portrait-scrim" aria-hidden="true" />
            <span className="res-portrait-rarity" aria-label={`${weaponRarity} star`}>
              {Array.from({ length: weaponRarity }).map((_, index) => (
                <Star key={index} size="0.5625rem" strokeWidth={0} className="res-portrait-rstar" aria-hidden="true" />
              ))}
            </span>
          </button>

          <div className="weapon-banner__id">
            <h3 className="weapon-banner__name">{weaponDef?.name ?? 'No Weapon'}</h3>
            <div className="weapon-banner__meta">
              <span className="hero-chip">
                <img
                  src={`/assets/game/weapons/types/${weaponKey}.webp`}
                  alt={toTitle(weaponKey)} className="weapon-icon"
                  onError={withDefWpnMg}
                />
                {toTitle(weaponKey)}
              </span>
            </div>
          </div>

          <div className="weapon-banner__figures">
            <div className="weapon-figure">
              <span className="weapon-figure__label">
                <StatIcon statKey="atk" />
                Base ATK
              </span>
              <strong className="weapon-figure__value">{Math.floor(displayAtk)}</strong>
            </div>
            {weaponDef && statLabel ? (
              <div className="weapon-figure">
                <span className="weapon-figure__label">
                  <StatIcon statKey={weaponDef.statKey} />
                  {statLabel}
                </span>
                <strong className="weapon-figure__value">{statDisplay}</strong>
              </div>
            ) : null}
          </div>
        </div>

        <div className="weapon-progression pane-section">
          <div className="res-level">
            <div className="res-level__head">
              <span className="res-prog-label">Level</span>
              <span className="res-level__value">
                <input
                  type="number"
                  value={currentLevel}
                  min={1}
                  max={90}
                  onChange={(event) => updateLevel(Number(event.target.value) || 1)}
                  aria-label="Weapon level"
                />
                <span className="res-level__cap">/ 90</span>
              </span>
              <button
                type="button"
                className={isMaxed ? 'res-card__max is-maxed' : 'res-card__max'}
                disabled={isMaxed}
                onClick={handleMax}
              >
                <Zap size="0.75rem" />
                {isMaxed ? 'Maxed' : 'Max'}
              </button>
            </div>
            <div className="res-level__slider"
              style={{
                '--slider-fill': `${((currentLevel - 1) / 89) * 100}%`,
                '--rl-fill-frac': `${(currentLevel - 1) / 89}`,
              } as CssProps}
            >
              <input
                type="range" className="res-level__track"
                min={1}
                max={90}
                value={currentLevel}
                onChange={(event) => updateLevel(Number(event.target.value))}
                aria-label="Weapon level"
              />
              <div className="res-level__marks" aria-hidden="true">
                {[20, 40, 50, 60, 70, 80, 90].map((lvl) => {
                  const reached = currentLevel >= lvl
                  const isMax = lvl === 90
                  return (
                    <span
                      key={lvl}
                      className={[
                        'res-level__mark',
                        reached ? 'is-reached' : '',
                        currentLevel === lvl ? 'is-current' : '',
                        isMax ? 'is-max' : '',
                      ].filter(Boolean).join(' ')}
                      style={{ '--mark-pct': `${((lvl - 1) / 89) * 100}%` } as CssProps}
                    >
                      <span className="res-level__mark-tick" />
                      <button
                        type="button" className="res-level__mark-label"
                        tabIndex={-1}
                        onClick={() => updateLevel(lvl)}
                      >
                        {isMax ? 'MAX' : lvl}
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="res-sequence weapon-rank-seq">
            <div className="res-seq-track" role="radiogroup" aria-label="Weapon rank">
              {[1, 2, 3, 4, 5].map((tier) => (
                <button
                  key={tier}
                  type="button"
                  role="radio"
                  aria-checked={currentRank === tier}
                  aria-label={`Rank ${tier}`}
                  className={tier <= currentRank ? 'res-seq-node is-filled' : 'res-seq-node'}
                  onClick={() => updateRank(currentRank === tier ? tier - 1 : tier)}
                >
                  <span className="res-seq-node__dot" aria-hidden="true">
                    <span className="res-seq-node__core" />
                  </span>
                  <span className="res-seq-node__label" aria-hidden="true">R{tier}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(hasPassive || hasStates) ? (
        <section className="weapon-effect">
          <div>
            <div>
              <div className="weapon-effect__bar">
                <span className="weapon-effect__sigil" aria-hidden="true" />
                <span className="weapon-effect__titles">
                  <span className="weapon-effect__tag">Weapon Effect</span>
                  <span className="weapon-effect__name">{weaponDef?.passive.name || 'Passive'}</span>
                </span>
              </div>

              <div className="weapon-effect__body pane-section inherent-skill ui-surface-card">
                {hasStrcDesc ? (
                  <>
                    {weaponOwner?.description ? (
                      <div className="weapon-effect-block">
                        <RichDscr
                          description={weaponOwner.description}
                          params={pssvPrms}
                        />
                      </div>
                    ) : null}

                    {weaponStates.map((state) => (
                      <div key={state.controlKey} className="weapon-effect-block">
                        {state.description ? (
                          <RichDscr
                            description={state.description}
                            params={pssvPrms}
                          />
                        ) : null}
                        <SourceStateCtrl
                          srcRt={runtime}
                          tgtRt={runtime}
                          state={state}
                          onRtPdt={onRtPdt}
                          hideDscr
                        />
                      </div>
                    ))}
                  </>
                ) : (
                  <>
                    {hasPassive ? (
                      <RichDscr
                        description={weaponDef.passive.desc}
                        params={pssvPrms}
                      />
                    ) : null}

                    {hasStates ? (
                      <div className="weapon-effect__tuning">
                        <span className="weapon-effect__tuning-label">Tuning</span>
                        <div className="stack weapon-state-controls">
                          {weaponStates.map((state) => (
                            <SourceStateCtrl
                              key={state.controlKey}
                              srcRt={runtime}
                              tgtRt={runtime}
                              state={state}
                              onRtPdt={onRtPdt}
                            />
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {wpnPckrPrtl}
    </section>
  )
}

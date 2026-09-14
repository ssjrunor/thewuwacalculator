/*
  Author: Runor Ewhro
  Description: The weapon console. A surface that draws a weapon (the bench
               rail, for one) hands the whole slot to this modal: the type and
               passive on one mono rule, the plate that opens the picker, the
               typed level, the syntonize lamps, and the passive in the game's
               own words at the rank standing.

               It is the progression panel's weapon module (`pstr-wpn`) given
               modal room, so the two read as the same instrument; the panel
               keeps its own markup because it is laid out for a 20rem column.
*/

import { useCallback, useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { CSSProperties as CssProps } from 'react'
import { isNoWeaponId } from '@/domain/entities/runtime.ts'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import { useAppStore } from '@/domain/state/store.ts'
import { listWpnsByTy } from '@/domain/services/weaponCatalogService.ts'
import { getRarityColor, getWpnTypeLb, WPNTYPETOKEY } from '@/modules/simulation/model/display.ts'
import type { PickFreqWeapon } from '@/domain/entities/appState'
import { glyphVars } from '@/shared/lib/gameAssets.ts'
import { withDefWpnMg } from '@/shared/lib/imageFallback.ts'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { AppModal } from '@/shared/ui/AppModal.tsx'
import { ModalHeader, ModalShell } from '@/shared/ui/AppModalShell.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { selInitRtLkp, selWorkDrvd } from '@/domain/state/selectors.ts'
import type { RtUpdHnd } from '@/modules/simulation/features/controls/lib/runtimeStateUtils.ts'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import {
  RES_LVL_MAX,
  RES_LVL_MIN,
  setWpnLvl,
} from '@/modules/simulation/features/resonator/lib/buildEdits.ts'
import {
  fmtWpnStatDs,
  getWeapon,
  resPssvPrms,
  weaponStatsAt,
  WPN_STAT_CNS,
  WPNSTATLBLS,
} from '@/modules/simulation/features/weapons/lib/weapon.ts'
import {
  applyWpnSel,
  setWpnRank,
  WPN_RANK_MAX,
} from '@/modules/simulation/features/weapons/lib/weaponSlotOps.ts'
import { WeaponPicker } from '@/modules/simulation/features/weapons/Picker.tsx'
import { useWpnCnsl } from '@/modules/simulation/features/weapons/lib/weaponConsoleStore.ts'
import { projectScenarioUiRuntimes } from '@/domain/state/scenarioRuntime.ts'

// Load the console only after a request and hold it until the close completes.
export function WeaponConsoleHost() {
  const target = useWpnCnsl((state) => state.target)

  if (!target) {
    return null
  }

  return (
    <WeaponConsole
      key={`${target.scenarioId ?? 'selected'}:${target.resonatorId}`}
      resonatorId={target.resonatorId}
      scenarioId={target.scenarioId}
    />
  )
}

function WeaponConsole({
  resonatorId,
  scenarioId,
}: {
  resonatorId: string
  scenarioId?: CombatScenarioId | null
}) {
  const closeRequest = useWpnCnsl((state) => state.close)
  const maxWpnOnInit = useAppStore((state) => state.ui.preferences.maxResOnInit)
  const bumpPickerFreq = useAppStore((state) => state.bumpPickFr)

  // the surface standing this console can be showing any profile, not just the
  // resonator in front: read the live participant runtime when there is one and
  // the profile's stored runtime otherwise, the way the rail card itself does.
  const { partRtsById } = useAppStore(useShallow(selWorkDrvd))
  const initRtsById = useAppStore(selInitRtLkp)
  const updResRt = useAppStore((state) => state.updResRt)
  const updScenarioResRt = useAppStore((state) => state.updScenarioResRt)
  const targetScenario = useAppStore((state) => (
    scenarioId ? state.combat.scenariosById[scenarioId] ?? null : null
  ))
  const scenarioRuntime = useMemo(
    () => targetScenario?.team.members.some((member) => member.resonatorId === resonatorId)
      ? projectScenarioUiRuntimes(targetScenario).runtimesById[resonatorId] ?? null
      : null,
    [resonatorId, targetScenario],
  )
  const runtime = scenarioId
    ? scenarioRuntime
    : partRtsById[resonatorId] ?? initRtsById[resonatorId] ?? null
  const resonator = getResonator(resonatorId)

  const onRtPdt = useCallback<RtUpdHnd>((updater) => {
    if (scenarioId) {
      updScenarioResRt(scenarioId, resonatorId, updater)
    } else {
      updResRt(resonatorId, updater)
    }
  }, [resonatorId, scenarioId, updResRt, updScenarioResRt])

  const { closing, hide, open, show, visible } = useAppModal()
  const picker = useAppModal()

  useEffect(() => {
    show()
  }, [show])

  const closeConsole = useCallback(() => {
    hide(() => {
      closeRequest()
    })
  }, [closeRequest, hide])

  // Close if the weapon's owner leaves the current runtime graph.
  useEffect(() => {
    if (visible && !closing && !runtime) {
      closeConsole()
    }
  }, [closeConsole, closing, runtime, visible])

  const weaponId = runtime && !isNoWeaponId(runtime.build.weapon.id) ? runtime.build.weapon.id : null
  const weapon = getWeapon(weaponId)
  const level = runtime?.build.weapon.level ?? RES_LVL_MIN
  const rank = runtime?.build.weapon.rank ?? 1
  const stats = weapon ? weaponStatsAt(weapon, level) : null
  const rarity = getRarityColor(weapon?.rarity) ?? 'var(--muted)'
  const typeKey = weapon ? WPNTYPETOKEY[weapon.weaponType] : null

  const weapons = useMemo(
    () => (resonator ? listWpnsByTy(resonator.weaponType) : []),
    [resonator],
  )

  // resolving five strings by rank is cheap enough to do on every render, and
  // the catalog entry is not a stable memo dependency
  const pssvPrms = weapon ? resPssvPrms(weapon.passive.params, rank) : []

  const onLevel = useCallback((next: number) => {
    onRtPdt((prev) => setWpnLvl(prev, next, getWeapon(prev.build.weapon.id)))
  }, [onRtPdt])

  const onRank = useCallback((next: number) => {
    onRtPdt((prev) => setWpnRank(prev, next))
  }, [onRtPdt])

  const onSelect = useCallback((pickedId: string) => {
    const picked = weapons.find((entry) => entry.id === pickedId)
    if (!picked) return

    onRtPdt((prev) => applyWpnSel(prev, picked, { maxOnInit: maxWpnOnInit, level: prev.build.weapon.level }))

    if (resonator) {
      bumpPickerFreq({
        bucket: 'weapon',
        weaponType: (WPNTYPETOKEY[resonator.weaponType] ?? 'gauntlets') as PickFreqWeapon,
        ids: [picked.id],
      })
    }

    picker.hide()
  }, [bumpPickerFreq, maxWpnOnInit, onRtPdt, picker, resonator, weapons])

  if (!runtime || !visible) {
    return null
  }

  return (
    <>
      <AppModal
        state={{ visible, open, closing }}
        variant="weapon-console"
        ariaLabel="Weapon"
        style={{ '--rar': rarity } as CssProps}
        onClose={closeConsole}
      >
        <ModalShell>
          <ModalHeader over="Weapon" title={resonator?.name ?? 'Resonator'} onClose={closeConsole} />

          <div className="wcon-body">
            <span className="wcon-sec">
              {/* the type mark is the game's white art, so it is painted as a
                  mask rather than pasted as an image */}
              {typeKey ? (
                <i className="wcon-sec-type"
                  aria-hidden="true"
                  style={glyphVars(`/assets/game/weapons/types/${typeKey}.webp`, '--g')}
                />
              ) : null}
              {weapon ? getWpnTypeLb(weapon.weaponType) : 'Weapon'}
              <i className="wcon-sec-sep" aria-hidden="true" />
              <span className="wcon-sec-passive">{weapon?.passive.name || 'No weapon'}</span>
            </span>

            <div className="wcon-console">
              <button
                type="button" className="wcon-open"
                aria-label={weapon ? `Change weapon, currently ${weapon.name}` : 'Choose a weapon'}
                onClick={() => picker.show()}
              >
                <span className="wcon-icon">
                  <img
                    src={weapon?.icon ?? '/assets/game/default.webp'}
                    alt=""
                    loading="lazy"
                    onError={withDefWpnMg}
                  />
                  <i className="wcon-rank">R{rank}</i>
                </span>
                <span className="wcon-plate">
                  <span className="wcon-name" title={weapon?.name}>
                    {weapon?.name ?? 'No weapon'}
                  </span>
                  {weapon && stats ? (
                    <span className="wcon-statline">
                      <span className="wcon-stat" title={`Base ATK at Lv ${level}`}>
                        <span className="wcon-stat-glyph"
                          aria-hidden="true"
                          style={glyphVars(WPN_STAT_CNS.atk, '--g')}
                        />
                        {/* the level table carries fractions; the weapon pane
                            floors base ATK, so this reads the same figure */}
                        {Math.floor(stats.atk)}
                      </span>
                      <span className="wcon-stat" title={WPNSTATLBLS[weapon.statKey] ?? weapon.statKey}>
                        {WPN_STAT_CNS[weapon.statKey] ? (
                          <span className="wcon-stat-glyph"
                            aria-hidden="true"
                            style={glyphVars(WPN_STAT_CNS[weapon.statKey], '--g')}
                          />
                        ) : null}
                        {fmtWpnStatDs(weapon.statKey, stats.scndStatVl)}
                      </span>
                    </span>
                  ) : null}
                </span>
              </button>

              {/* the level is typed rather than dragged: the weapon only ever
                  needs the number */}
              <label className="wcon-lvl" data-max={level >= RES_LVL_MAX ? '1' : '0'}>
                <span className="wcon-lvl-cap">Weapon Lv</span>
                <span className="wcon-lvl-val">
                  <input
                    type="number"
                    min={RES_LVL_MIN}
                    max={RES_LVL_MAX}
                    value={level}
                    aria-label="Weapon level"
                    onChange={(event) => onLevel(Number(event.target.value) || RES_LVL_MIN)}
                  />
                  <em>/{RES_LVL_MAX}</em>
                </span>
              </label>
            </div>

            {/* Syntonize rides the Simulation workspace's star track, lit by rarity. */}
            <div className="res-sequence wcon-rank-track">
              <div className="res-seq-track" role="radiogroup" aria-label="Syntonize rank">
                {Array.from({ length: WPN_RANK_MAX }, (_, index) => index + 1).map((tier) => (
                  <button
                    type="button"
                    key={tier}
                    role="radio"
                    aria-checked={rank === tier}
                    aria-label={`Syntonize ${tier}`}
                    className={tier <= rank ? 'res-seq-node is-filled' : 'res-seq-node'}
                    onClick={() => onRank(rank === tier ? tier - 1 : tier)}
                  >
                    <span className="res-seq-node__dot" aria-hidden="true">
                      <span className="res-seq-node__core" />
                    </span>
                    <span className="res-seq-node__label" aria-hidden="true">R{tier}</span>
                  </button>
                ))}
              </div>
            </div>

            <i className="wcon-rule" aria-hidden="true" />

            {weapon?.passive.desc ? (
              <RichDscr className="wcon-passive"
                description={weapon.passive.desc}
                params={pssvPrms}
                accentColor={rarity}
              />
            ) : (
              <p className="wcon-passive wcon-passive--empty">Pick a weapon to read its passive.</p>
            )}

            <div className="wcon-foot">
              <button type="button" className="wcon-swap" onClick={() => picker.show()}>
                {typeKey ? (
                  <i className="wcon-swap-glyph"
                    aria-hidden="true"
                    style={glyphVars(`/assets/game/weapons/types/${typeKey}.webp`, '--g')}
                  />
                ) : null}
                Change weapon
              </button>
            </div>
          </div>
        </ModalShell>
      </AppModal>

      {picker.visible ? (
        <WeaponPicker
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={mainPortal()}
          weapons={weapons}
          selWpnId={weaponId}
          recommendedWeaponIds={resonator?.recommendedWeaponIds ?? []}
          onClose={() => picker.hide()}
          onSelect={onSelect}
        />
      ) : null}
    </>
  )
}

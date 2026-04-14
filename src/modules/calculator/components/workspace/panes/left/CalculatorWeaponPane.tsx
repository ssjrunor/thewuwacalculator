import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { isUnsetWeaponId, type ResonatorRuntimeState } from '@/domain/entities/runtime'
import { listWeaponsByType } from '@/domain/services/weaponCatalogService'
import { listOwnersForSource, listStatesForSource } from '@/domain/services/gameDataService'
import { getResonator, WEAPON_TYPE_TO_KEY } from '@/modules/calculator/model/resonator'
import { toTitle } from '@/shared/lib/format'
import {
  getWeapon,
  resolveWeaponStatsAtLevel,
  formatWeaponStatDisplay,
  resolvePassiveParams,
  withDefaultWeaponImage,
  WEAPON_STAT_LABELS,
  WEAPON_STAT_ICONS,
} from '@/modules/calculator/model/weapon'
import { WeaponPickerModal } from '@/modules/calculator/components/workspace/panes/left/modals/WeaponPickerModal'
import { SourceStateControl } from '@/modules/calculator/components/workspace/panes/left/controls/SourceStateControl'
import { isSourceStateVisible } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import type { RuntimeUpdateHandler } from '@/modules/calculator/components/workspace/panes/left/helpers/runtimeStateUtils'
import { useAnimatedVisibility } from '@/app/hooks/useAnimatedVisibility.ts'
import { clampNumber } from '@/shared/lib/number'
import { getMainContentPortalTarget } from '@/shared/lib/portalTarget'
import { RichDescription } from '@/shared/ui/RichDescription'

interface CalculatorWeaponPaneProps {
  runtime: ResonatorRuntimeState
  onRuntimeUpdate: RuntimeUpdateHandler
}

// exposes the weapon editor surface and hooks its runtime control panel into shared helpers.
function StatIcon({ statKey }: { statKey: string }) {
  const iconPath = WEAPON_STAT_ICONS[statKey]
  if (!iconPath) return null

  return (
    <span
      className="weapon-stat-icon"
      style={{
        WebkitMaskImage: `url(${iconPath})`,
        maskImage: `url(${iconPath})`,
      }}
    />
  )
}

export function CalculatorWeaponPane({ runtime, onRuntimeUpdate }: CalculatorWeaponPaneProps) {
  const resonator = getResonator(runtime.id)
  const weaponType = resonator?.weaponType ?? 4
  const weaponKey = WEAPON_TYPE_TO_KEY[weaponType as keyof typeof WEAPON_TYPE_TO_KEY] ?? 'gauntlets'
  const weapons = listWeaponsByType(weaponType)
  const activeWeaponId = isUnsetWeaponId(runtime.build.weapon.id) ? null : runtime.build.weapon.id
  const weaponDef = getWeapon(activeWeaponId)
  const weaponMenu = useAnimatedVisibility(300)

  const currentLevel = runtime.build.weapon.level
  const currentRank = runtime.build.weapon.rank
  const levelStats = weaponDef ? resolveWeaponStatsAtLevel(weaponDef, currentLevel) : null
  const displayAtk = levelStats ? levelStats.atk : runtime.build.weapon.baseAtk
  const displaySecondaryStat = levelStats?.secondaryStatValue ?? 0
  const statLabel = weaponDef ? (WEAPON_STAT_LABELS[weaponDef.statKey] ?? weaponDef.statKey) : ''
  const statDisplay = weaponDef ? formatWeaponStatDisplay(weaponDef.statKey, displaySecondaryStat) : ''

  const passiveParams = useMemo(
    () => (weaponDef ? resolvePassiveParams(weaponDef.passive.params, currentRank) : []),
    [weaponDef, currentRank],
  )

  const weaponOwner = useMemo(() => {
    if (!activeWeaponId) return null
    const owners = listOwnersForSource('weapon', activeWeaponId)
    return owners[0] ?? null
  }, [activeWeaponId])

  const weaponStates = useMemo(() => {
    if (!activeWeaponId) return []
    return listStatesForSource('weapon', activeWeaponId).filter((state) =>
      isSourceStateVisible(runtime, runtime, state),
    )
  }, [activeWeaponId, runtime])

  const hasStructuredDesc = Boolean(weaponOwner?.description || weaponStates.some((s) => s.description))

  const isMaxed = currentLevel === 90 && currentRank === 5

  const handleWeaponSelect = (weaponId: string) => {
    const selected = weapons.find((weapon) => weapon.id === weaponId)
    if (!selected) return

    const stats = resolveWeaponStatsAtLevel(selected, currentLevel)

    onRuntimeUpdate((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        weapon: {
          ...prev.build.weapon,
          id: selected.id,
          baseAtk: stats.atk,
          rank: 1,
        },
      },
    }))
    weaponMenu.hide()
  }

  const updateLevel = (level: number) => {
    const nextLevel = clampNumber(Math.round(level), 1, 90)

    if (weaponDef) {
      const stats = resolveWeaponStatsAtLevel(weaponDef, nextLevel)
      onRuntimeUpdate((prev) => ({
        ...prev,
        build: {
          ...prev.build,
          weapon: {
            ...prev.build.weapon,
            level: nextLevel,
            baseAtk: stats.atk,
          },
        },
      }))
    } else {
      onRuntimeUpdate((prev) => ({
        ...prev,
        build: {
          ...prev.build,
          weapon: { ...prev.build.weapon, level: nextLevel },
        },
      }))
    }
  }

  const updateRank = (rank: number) => {
    const nextRank = clampNumber(Math.round(rank), 1, 5)
    onRuntimeUpdate((prev) => ({
      ...prev,
      build: {
        ...prev.build,
        weapon: { ...prev.build.weapon, rank: nextRank },
      },
    }))
  }

  const handleMax = () => {
    if (weaponDef) {
      const stats = resolveWeaponStatsAtLevel(weaponDef, 90)
      onRuntimeUpdate((prev) => ({
        ...prev,
        build: {
          ...prev.build,
          weapon: {
            ...prev.build.weapon,
            level: 90,
            rank: 5,
            baseAtk: stats.atk,
          },
        },
      }))
    } else {
      onRuntimeUpdate((prev) => ({
        ...prev,
        build: {
          ...prev.build,
          weapon: { ...prev.build.weapon, level: 90, rank: 5 },
        },
      }))
    }
  }

  const weaponIcon = weaponDef?.icon ?? '/assets/weapon-icons/default.webp'
  const weaponRarity = weaponDef?.rarity ?? 4

  const modalPortalTarget = getMainContentPortalTarget()

  const weaponPickerPortal =
    weaponMenu.visible ? (
      <WeaponPickerModal
        visible={weaponMenu.visible}
        open={weaponMenu.open}
        closing={weaponMenu.closing}
        portalTarget={modalPortalTarget}
        weapons={weapons}
        selectedWeaponId={activeWeaponId}
        onClose={() => weaponMenu.hide()}
        onSelect={handleWeaponSelect}
      />
    ) : null

  const hasPassive = weaponDef && weaponDef.passive.desc
  const hasStates = weaponStates.length > 0

  return (
    <section className="calc-pane resonator-pane weapon-pane">
      <div className="resonator-flow-header">
        <button
          type="button"
          className={`resonator-avatar-button rarity-${weaponRarity}`}
          aria-label="Open weapon selector"
          onClick={() => {
            if (weaponMenu.open) {
              weaponMenu.hide()
              return
            }
            weaponMenu.show()
          }}
        >
          <img
            src={weaponIcon}
            alt={weaponDef?.name ?? 'Weapon'}
            className="resonator-avatar weapon-avatar-icon"
            style={{ objectFit: 'contain' }}
            onError={withDefaultWeaponImage}
          />
        </button>

        <div className="resonator-heading">
          <div className="panel-overline">Equipped Weapon</div>
          <div className="resonator-heading-top">
            <h3>{weaponDef?.name ?? 'No Weapon'}</h3>
            <div className="resonator-heading-badges">
              <span className="hero-badge">Lv {currentLevel}</span>
              <span className="hero-badge">R{currentRank}</span>
            </div>
          </div>
          <div className="resonator-heading-subline">
            <div className="resonator-heading-icons">
              <img
                src={`/assets/weapons/${weaponKey}.webp`}
                alt={toTitle(weaponKey)}
                className="weapon-icon"
              />
            </div>
            <div className="resonator-heading-meta">
              <span className="hero-chip">{toTitle(weaponKey)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="resonator-snapshot-grid">
        <article className="resonator-snapshot-card ui-surface-card ui-surface-card--section">
          <span className="resonator-snapshot-label">
            <StatIcon statKey="atk" />
            Base ATK
          </span>
          <strong className="resonator-snapshot-value">{Math.floor(displayAtk)}</strong>
          <span className="resonator-snapshot-detail">At Lv {currentLevel}</span>
        </article>

        {weaponDef && statLabel ? (
          <article className="resonator-snapshot-card ui-surface-card ui-surface-card--section">
            <span className="resonator-snapshot-label">
              <StatIcon statKey={weaponDef.statKey} />
              {statLabel}
            </span>
            <strong className="resonator-snapshot-value">{statDisplay}</strong>
            <span className="resonator-snapshot-detail">At Lv {currentLevel}</span>
          </article>
        ) : null}
      </div>

      {weaponPickerPortal}

      <div className="resonator-settings ui-surface-card ui-surface-card--section">
        <div className="slider-group">
          <div className="level-group">
            <div className="slider-label-with-input">
              <label>Level</label>
              <input
                className="resonator-level-input"
                type="number"
                value={currentLevel}
                min={1}
                max={90}
                onChange={(event) => updateLevel(Number(event.target.value) || 1)}
              />
            </div>
            <button
              type="button"
              className={isMaxed ? 'chip active' : 'chip'}
              disabled={isMaxed}
              onClick={handleMax}
            >
              {isMaxed ? 'Maxed' : 'Max'}
            </button>
          </div>
          <div className="slider-controls">
            <input
              type="range"
              min={1}
              max={90}
              value={currentLevel}
              onChange={(event) => updateLevel(Number(event.target.value))}
              style={{ '--slider-fill': `${((currentLevel - 1) / 89) * 100}%` } as CSSProperties}
            />
            <span>{currentLevel}</span>
          </div>
        </div>

        <div className="slider-group">
          <label>Rank</label>
          <div className="slider-controls">
            <input
              type="range"
              min={1}
              max={5}
              value={currentRank}
              onChange={(event) => updateRank(Number(event.target.value))}
              style={{ '--slider-fill': `${((currentRank - 1) / 4) * 100}%` } as CSSProperties}
            />
            <span>{currentRank}</span>
          </div>
        </div>
      </div>

      {(hasPassive || hasStates) ? (
        <div className="inherent-skills-box ui-surface-card ui-surface-card--section">
          <h3>Weapon Effect</h3>

          <div className="control-panel-box ui-surface-card ui-surface-card--inner">
            <h4 className="highlight">{weaponDef?.passive.name || 'Passive'}</h4>

            {hasStructuredDesc ? (
              <>
                {weaponOwner?.description ? (
                  <div className="weapon-effect-block">
                    <RichDescription
                      description={weaponOwner.description}
                      params={passiveParams}
                    />
                  </div>
                ) : null}

                {weaponStates.map((state) => (
                  <div key={state.controlKey} className="weapon-effect-block">
                    {state.description ? (
                      <RichDescription
                        description={state.description}
                        params={passiveParams}
                      />
                    ) : null}
                    <SourceStateControl
                      sourceRuntime={runtime}
                      targetRuntime={runtime}
                      state={state}
                      onRuntimeUpdate={onRuntimeUpdate}
                      hideDescription
                    />
                  </div>
                ))}
              </>
            ) : (
              <>
                {hasPassive ? (
                  <RichDescription
                    description={weaponDef.passive.desc}
                    params={passiveParams}
                  />
                ) : null}

                {hasStates ? (
                  <div className="stack weapon-state-controls">
                    {weaponStates.map((state) => (
                      <SourceStateControl
                        key={state.controlKey}
                        sourceRuntime={runtime}
                        targetRuntime={runtime}
                        state={state}
                        onRuntimeUpdate={onRuntimeUpdate}
                      />
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/*
  Author: Runor Ewhro
  Description: Normalizes weapon suggestion rows into comparable damage/spec
               columns without rerunning suggestion scoring.
*/

import type { CSSProperties as CssProps } from 'react'
import type { WeaponPlanSet } from '@/domain/entities/suggestions.ts'
import type { WeaponEntry } from '@/engine/suggestions/types.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { getWpnById } from '@/data/catalog/weaponCatalogService.ts'
import { resPssvPrms, weaponStatsAt, withDefWpnMg } from '@/modules/simulation/features/weapons/lib/weapon.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { rarityVars } from '@/modules/simulation/model/display.ts'
import { RichDscr } from '@/modules/simulation/ui/RichDescription.tsx'
import {
  formatDamage,
  getDiffArrow,
  getDiffLabel,
  getDiffTone,
  percentDiff,
} from '@/modules/simulation/surfaces/suggestions/lib/suggestions.ts'

export function WeaponInspect({
  wpnSets,
  target,
  card,
  baseDamage,
  runtime,
}: {
  wpnSets: WeaponPlanSet
  target: WeaponEntry
  card: { plans: WeaponEntry[] }
  baseDamage: number
  runtime: ResRuntime
}) {
  const inspectTargetMode = wpnSets.mode === 'both' ? wpnSets.target : wpnSets.mode
  const inspectTarget = card.plans.find((p) => p.mode === inspectTargetMode) ?? target
  const inspectAlt = card.plans.find((p) => p !== inspectTarget) ?? null
  const inspectTargetDiff = percentDiff(inspectTarget.damage, baseDamage)
  const inspectAltDiff = inspectAlt ? percentDiff(inspectAlt.damage, baseDamage) : 0
  const inspectIsCurrent = inspectTarget.weaponId === runtime.build.weapon.id
  const inspectIsDual = !!inspectAlt
  const equippedWpnId = runtime.build.weapon.id
  const equippedDef = equippedWpnId ? getWpnById(equippedWpnId) : null
  const equippedLevel = runtime.build.weapon.level
  const equippedRank = runtime.build.weapon.rank
  const equippedStats = equippedDef ? weaponStatsAt(equippedDef, equippedLevel) : null
  const equippedParams = equippedDef ? resPssvPrms(equippedDef.passive.params, equippedRank) : []
  const showCompare = !!equippedDef && equippedWpnId !== inspectTarget.weaponId

  const renderColumn = (
    kind: 'equipped' | 'inspected',
    opts: {
      cap: string
      icon: string
      name: string
      rarity: number
      level: number
      rank: number
      baseAtk: number
      statKey: string
      statValue: number
      damage: number
      diff: number
      diffLabelIsCurrent: boolean
      showAlt: boolean
      altMode?: 'default' | 'max'
      altDamage?: number
      altDiff?: number
      targetMode?: 'default' | 'max'
      passiveName?: string
      passiveDesc?: string
      passiveParams: string[]
    },
  ) => (
    <div
      className={`weapon-inspect__col weapon-inspect__col--${kind}`}
      style={rarityVars(opts.rarity, false, '--weapon-rarity-tint') as CssProps}
    >
      <header className="weapon-inspect__col-head">
        <span className="weapon-inspect__col-cap">{opts.cap}</span>
      </header>
      <div className="weapon-inspect__identity">
        <span className="weapon-inspect__frame">
          <img src={opts.icon} alt={opts.name} className="weapon-inspect__icon" onError={withDefWpnMg} />
        </span>
        <div className="weapon-inspect__title">
          <h3 className="weapon-inspect__name">{opts.name}</h3>
          <div className="weapon-inspect__tags">
            <span className="weapon-inspect__rarity" aria-label={`${opts.rarity}-star`}>
              {'★'.repeat(opts.rarity)}
            </span>
            <span className="weapon-inspect__sep" aria-hidden />
            <span>Lv. {opts.level}</span>
            <span className="weapon-inspect__sep" aria-hidden />
            <span>R{opts.rank}</span>
          </div>
        </div>
      </div>

      <div className="weapon-inspect__specs">
        <div className="weapon-inspect__spec">
          <span className="weapon-inspect__spec-k">Base ATK</span>
          <span className="weapon-inspect__spec-v">{Math.round(opts.baseAtk)}</span>
        </div>
        <div className="weapon-inspect__spec">
          <span className="weapon-inspect__spec-k">{formatStatKeyLabel(opts.statKey)}</span>
          <span className="weapon-inspect__spec-v">{formatStatKeyValue(opts.statKey, opts.statValue)}</span>
        </div>
      </div>

      <div className="weapon-inspect__block">
        <div className="weapon-inspect__block-label">Damage</div>
        <div className="weapon-inspect__output">
          <div className={`weapon-inspect__output-row${kind === 'inspected' ? ' weapon-inspect__output-row--target' : ''}${opts.targetMode ? ' weapon-inspect__output-row--withtag' : ''}`}>
            {opts.targetMode ? (
              <span className="weapon-inspect__mode-tag">{opts.targetMode === 'max' ? 'MAX' : 'DEF'}</span>
            ) : null}
            <span className="weapon-inspect__output-damage">{formatDamage(opts.damage)}</span>
            {kind === 'equipped' ? (
              <span className="set-plan-damage-diff weapon-inspect__diff zero">base</span>
            ) : (
              <span className={`set-plan-damage-diff weapon-inspect__diff ${getDiffTone(opts.diff)}`}>
                {getDiffLabel(opts.diff, opts.diffLabelIsCurrent)}
                {getDiffArrow(opts.diff)}
              </span>
            )}
          </div>
          {opts.showAlt && opts.altDamage !== undefined && opts.altDiff !== undefined && opts.altMode ? (
            <div className="weapon-inspect__output-row weapon-inspect__output-row--alt weapon-inspect__output-row--withtag">
              <span className="weapon-inspect__mode-tag">{opts.altMode === 'max' ? 'MAX' : 'DEF'}</span>
              <span className="weapon-inspect__output-damage">{formatDamage(opts.altDamage)}</span>
              <span className={`set-plan-damage-diff weapon-inspect__diff ${getDiffTone(opts.altDiff)}`}>
                {getDiffLabel(opts.altDiff, false)}
                {getDiffArrow(opts.altDiff)}
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="weapon-inspect__block">
        <div className="weapon-inspect__block-label">
          Passive{opts.passiveName ? ` · ${opts.passiveName}` : ''}
        </div>
        {opts.passiveDesc ? (
          <RichDscr
            description={opts.passiveDesc}
            params={opts.passiveParams} className="weapon-inspect-desc"
          />
        ) : (
          <p className="suggestions-modal-hint">No passive description.</p>
        )}
      </div>
    </div>
  )

  return (
    <div className={`weapon-inspect ${showCompare ? 'weapon-inspect--compare' : 'weapon-inspect--solo'}`}>
      {showCompare && equippedDef && equippedStats
        ? renderColumn('equipped', {
            cap: 'Equipped',
            icon: equippedDef.icon,
            name: equippedDef.name,
            rarity: equippedDef.rarity,
            level: equippedLevel,
            rank: equippedRank,
            baseAtk: equippedStats.atk,
            statKey: equippedDef.statKey,
            statValue: equippedStats.scndStatVl,
            damage: baseDamage,
            diff: 0,
            diffLabelIsCurrent: true,
            showAlt: false,
            passiveName: equippedDef.passive.name,
            passiveDesc: equippedDef.passive.desc,
            passiveParams: equippedParams,
          })
        : null}
      {renderColumn('inspected', {
        cap: showCompare ? 'Inspected' : 'Weapon',
        icon: inspectTarget.icon,
        name: inspectTarget.name,
        rarity: inspectTarget.rarity,
        level: inspectTarget.level,
        rank: inspectTarget.rank,
        baseAtk: inspectTarget.baseAtk,
        statKey: inspectTarget.statKey,
        statValue: inspectTarget.statValue,
        damage: inspectTarget.damage,
        diff: inspectTargetDiff,
        diffLabelIsCurrent: inspectIsCurrent,
        showAlt: !!inspectAlt,
        altMode: inspectAlt?.mode,
        altDamage: inspectAlt?.damage,
        altDiff: inspectAlt ? inspectAltDiff : undefined,
        targetMode: inspectIsDual ? inspectTarget.mode : undefined,
        passiveName: inspectTarget.pssvName,
        passiveDesc: inspectTarget.pssvDesc,
        passiveParams: inspectTarget.params,
      })}
    </div>
  )
}

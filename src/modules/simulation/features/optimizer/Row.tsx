/*
  Author: Runor Ewhro
  Description: Converts optimizer display rows into inert/interactive result
               rows without re-validating optimizer search output.
*/

import { withDefEchoMg, withDefIconM } from '@/shared/lib/imageFallback.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { SonataTokens } from '@/modules/simulation/workspace/ui.tsx'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects.ts'

export interface OptDsplStts {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

export interface OptDsplSetEn {
  id: number
  icon: string | null
  count: number
}

export interface OptDisplayRow {
  damage: number
  stats: OptDsplStts | null
  // the per-echo cost combo is stored because every legal loadout already sums
  // to 12, making the total less useful than the chosen cost distribution.
  costs: number[] | null
  sets: OptDsplSetEn[]
  mainEchoIcon: string | null
  // Populated only by theory weapon search; null keeps ordinary echo rows on the
  // historical display shape.
  weaponIcon: string | null
  weaponName: string | null
  // theory builds that cannot materialize into a legal five-echo loadout (e.g.
  // the same catalog echo lands in two slots). they still carry an abstract
  // damage number so they render, but they have no preview and cannot be
  // equipped, so the row is shown disabled rather than clickable.
  invalid?: boolean
}

interface OptRowPrps {
  result: OptDisplayRow
  baseDamage?: number
  base?: boolean
  rotationMode?: boolean
  showWeapon?: boolean
  selected?: boolean
  onClick?: () => void
}

function renderStat(value: number | null | undefined, formatter: (next: number) => string): string {
  if (value == null || !Number.isFinite(value)) {
    return '...'
  }

  return formatter(value)
}

function displayedDamage(value: number): number {
  return Math.floor(value || 0)
}

function formatEfficiency(damage: number, baseDamage: number | undefined, base: boolean): string {
  if (base || !baseDamage || baseDamage <= 0) {
    return '100.00'
  }

  const baseDisplayDamage = displayedDamage(baseDamage)
  if (baseDisplayDamage > 0 && displayedDamage(damage) === baseDisplayDamage) {
    return '100.00'
  }

  return formatTruncCompact((damage / baseDamage) * 100, 2)
}

export function Row({
  result,
  baseDamage,
  base = false,
  rotationMode = false,
  showWeapon = false,
  selected = false,
  onClick,
}: OptRowPrps) {
  const { stats, costs, sets, mainEchoIcon, weaponIcon, weaponName, damage, invalid } = result
  const displayDamage = displayedDamage(damage)
  const diff = formatEfficiency(damage, baseDamage, base)
  // an invalid build cannot be previewed or equipped, so the row is inert:
  // no click target, no keyboard/button semantics.
  const clickable = Boolean(onClick) && !invalid

  function viewSetBdgs() {
    if (!sets || sets.length === 0) return <span className="empty-set">…</span>

    // same sonata-token rendering as the evaluation set plan so the results
    // table and the set-plan picker read identically.
    return (
      <SonataTokens
        sets={sets.map((entry) => ({
          setId: entry.id,
          name: getEchoSetDe(entry.id)?.name ?? `Set ${entry.id}`,
          pieces: entry.count,
          icon: entry.icon,
        }))} className="workspace-srel-set-plan"
        emptyLabel="…"
      />
    )
  }

  function viewCostCombo() {
    if (!costs || costs.length === 0) return <span className="cost-combo cost-combo--empty">…</span>
    const total = costs.reduce((sum, value) => sum + value, 0)
    return (
      <span className="cost-combo" title={`Total cost: ${total}`}>
        {costs.map((value, index) => (
          <span key={`${index}-${value}`} className="cost-combo__group">
            {index > 0 ? (
              <span className="cost-combo__sep" aria-hidden="true">⟡</span>
            ) : null}
            <span className={`cost-combo__digit cost-combo__digit--c${value}`}>
              {value}
            </span>
          </span>
        ))}
      </span>
    )
  }

  return (
    <div
      className={`opt-result-row${selected ? ' is-selected' : ''}${base ? ' is-base' : ''}${invalid ? ' is-invalid' : ''}`}
      onClick={clickable ? onClick : undefined}
      onKeyDown={(event) => {
        if (!clickable || !onClick) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      aria-disabled={invalid ? true : undefined}
      title={invalid ? 'Invalid build: cannot be equipped' : undefined}
    >
      <div className="opt-result-row__col opt-result-row__col--sets">{viewSetBdgs()}</div>
      <div className="opt-result-row__col">
        {mainEchoIcon ? (
          <img src={mainEchoIcon} alt="main echo" className="opt-result-row__echo-icon" loading="lazy" onError={withDefEchoMg} />
        ) : (
          <span className="opt-result-row__placeholder">...</span>
        )}
      </div>
      {showWeapon ? (
        <div className="opt-result-row__col">
          {weaponIcon ? (
            <img
              src={weaponIcon}
              alt={weaponName ?? 'weapon'}
              title={weaponName ?? undefined} className="opt-result-row__weapon-icon"
              loading="lazy"
              onError={withDefIconM}
            />
          ) : (
            <span className="opt-result-row__placeholder">-</span>
          )}
        </div>
      ) : null}
      <div className="opt-result-row__col opt-result-row__col--cost">{viewCostCombo()}</div>
      <div className="opt-result-row__col">{renderStat(stats?.atk, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.hp, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.def, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.er, (value) => formatTruncCompact(value, 1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cr, (value) => formatTruncCompact(value, 1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cd, (value) => formatTruncCompact(value, 1))}</div>
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.bonus, (value) => formatTruncCompact(value, 1))}</div>
      ) : null}
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.amp, (value) => formatTruncCompact(value, 1))}</div>
      ) : null}
      <div className="opt-result-row__col opt-result-row__col--dmg avg">{displayDamage}</div>
      <div className="opt-result-row__col opt-result-row__col--eff">{diff}%</div>
    </div>
  )
}

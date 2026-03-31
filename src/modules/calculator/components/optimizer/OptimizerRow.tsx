export interface OptimizerDisplayStats {
  atk: number
  hp: number
  def: number
  er: number
  cr: number
  cd: number
  bonus: number
  amp: number
}

export interface OptimizerDisplaySetEntry {
  id: number
  icon: string | null
  count: number
}

export interface OptimizerDisplayRow {
  damage: number
  stats: OptimizerDisplayStats | null
  cost: number | null
  sets: OptimizerDisplaySetEntry[]
  mainEchoIcon: string | null
}

interface OptimizerRowProps {
  result: OptimizerDisplayRow
  baseDamage?: number
  base?: boolean
  rotationMode?: boolean
  selected?: boolean
  onClick?: () => void
}

function renderStat(value: number | null | undefined, formatter: (next: number) => string): string {
  if (value == null || !Number.isFinite(value)) {
    return '...'
  }

  return formatter(value)
}

export function OptimizerRow({
  result,
  baseDamage,
  base = false,
  rotationMode = false,
  selected = false,
  onClick,
  }: OptimizerRowProps) {
  const { stats, cost, sets, mainEchoIcon, damage } = result
  const diff =
    base || !baseDamage || baseDamage <= 0
      ? '100.00'
      : ((damage / baseDamage) * 100).toFixed(2)

  function renderSetBadges() {
    if (!sets || sets.length === 0) return <span className="empty-set">...</span>

    return sets.map((entry) => (
      <span key={`${entry.id}-${entry.count}`} className="set-badge">
        {entry.icon ? (
          <img src={entry.icon} alt={String(entry.id)} className="set-icon" />
        ) : (
          <span className="set-icon-placeholder" />
        )}
        &times; {entry.count}
      </span>
    ))
  }

  return (
    <div
      className={`opt-result-row${selected ? ' is-selected' : ''}${base ? ' is-base' : ''}`}
      onClick={onClick}
      onKeyDown={(event) => {
        if (!onClick) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {selected ? <span className="opt-result-row__accent-bar" /> : null}
      <div className="opt-result-row__col opt-result-row__col--sets">{renderSetBadges()}</div>
      <div className="opt-result-row__col opt-result-row__col--echo">
        {mainEchoIcon ? (
          <img src={mainEchoIcon} alt="main echo" className="opt-result-row__echo-icon" loading="lazy" />
        ) : (
          <span className="opt-result-row__placeholder">...</span>
        )}
      </div>
      <div className="opt-result-row__col">{cost ?? '...'}</div>
      <div className="opt-result-row__col">{renderStat(stats?.atk, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.hp, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.def, (value) => Math.floor(value).toString())}</div>
      <div className="opt-result-row__col">{renderStat(stats?.er, (value) => value.toFixed(1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cr, (value) => value.toFixed(1))}</div>
      <div className="opt-result-row__col">{renderStat(stats?.cd, (value) => value.toFixed(1))}</div>
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.bonus, (value) => value.toFixed(1))}</div>
      ) : null}
      {!rotationMode ? (
        <div className="opt-result-row__col">{renderStat(stats?.amp, (value) => value.toFixed(1))}</div>
      ) : null}
      <div className="opt-result-row__col opt-result-row__col--dmg avg">{Math.floor(damage || 0)}</div>
      <div className="opt-result-row__col opt-result-row__col--eff">{diff}%</div>
    </div>
  )
}

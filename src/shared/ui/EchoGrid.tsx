import type { EchoInstance } from '@/domain/entities/runtime'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { getSonataSetIcon, getSonataSetName } from '@/data/gameData/catalog/sonataSets'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/overviewStats'
import '../../styles/EchoGrid.css'

// ── Types ────────────────────────────────────────────────────────────────────

export type EchoCardVariant = 'full' | 'compact'

export interface EchoCardProps {
  echo: EchoInstance | null
  /** Visual size / detail level. Default: 'full' */
  variant?: EchoCardVariant
  /** Show echo substats section. Default: true for full, false for compact */
  showSubstats?: boolean
  /** Show the echo artwork image. Default: true */
  showImage?: boolean
  /** Optional 0–100 score badge shown in the meta row */
  score?: number | null
  /** Make the card interactive (hover state + pointer cursor) */
  interactive?: boolean
  className?: string
  onClick?: () => void
}

export interface EchoGridProps {
  echoes: Array<EchoInstance | null>
  /** Visual size / detail level. Default: 'full' */
  variant?: EchoCardVariant
  /** Show echo substats section. Default: true for full, false for compact */
  showSubstats?: boolean
  /** Show the echo artwork image. Default: true */
  showImage?: boolean
  /** Per-echo score values (index-aligned). 0–100 */
  scores?: Array<number | null> | null
  /** How many total slots to render (pads with nulls). Defaults to echoes.length */
  slotCount?: number
  /** Make each card interactive */
  interactive?: boolean
  className?: string
  onEchoClick?: (echo: EchoInstance | null, index: number) => void
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEchoCostFromInstance(echo: EchoInstance): number {
  return getEchoById(echo.id)?.cost ?? (echo.mainEcho ? 4 : 1)
}

// ── EchoCard ─────────────────────────────────────────────────────────────────

export function EchoCard({
  echo,
  variant = 'full',
  showSubstats,
  showImage = true,
  score = null,
  interactive = false,
  className = '',
  onClick,
}: EchoCardProps) {
  const resolvedShowSubstats = showSubstats ?? variant === 'full'

  if (!echo) {
    return (
      <div className={`echo-card echo-card--${variant} echo-card--empty ${className}`.trim()}>
        <span className="echo-card__empty-label">Empty</span>
      </div>
    )
  }

  const definition = getEchoById(echo.id)
  const cost = definition?.cost ?? getEchoCostFromInstance(echo)
  const setIcon = echo.set ? getSonataSetIcon(echo.set) : null
  const setName = echo.set ? getSonataSetName(echo.set) : null
  const substatEntries = Object.entries(echo.substats)
  const hasImage = showImage && Boolean(definition?.icon)

  const classNames = [
    'echo-card',
    `echo-card--${variant}`,
    interactive && 'echo-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classNames} onClick={onClick}>
      {/* ── Top: icon + identity (matches echo-slot-left pattern) ── */}
      <div className="echo-card__top">
        {hasImage && (
          <div className="echo-card__icon">
            <img
              src={definition!.icon}
              alt={definition!.name ?? 'Echo'}
              className="echo-card__icon-img"
              loading="lazy"
            />
          </div>
        )}

        <div className="echo-card__identity">
          {definition?.name && (
            <span className="echo-card__name">{definition.name}</span>
          )}
          {/* Meta row: set icon · cost · badges — matches echo-slot-meta */}
          <div className="echo-card__meta">
            {setIcon && (
              <img src={setIcon} alt={setName ?? ''} className="echo-card__set-icon" />
            )}
            <span className="echo-card__cost-badge">{cost}C</span>
            {echo.mainEcho && (
              <span className="echo-card__main-badge">Main</span>
            )}
            {score != null && score > 0 && (
              <span className="echo-score-badge">{score.toFixed(1)}%</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Stat card: accent strip + primary + secondary + substats ── */}
      <div className="echo-card__stat-card">
        <div className="echo-card__stat-accent" />
        <div className="echo-card__stat-section echo-card__stat-section--main">
          <div className="echo-card__stat">
            <span className="echo-card__stat-label">
              {formatStatKeyLabel(echo.mainStats.primary.key)}
            </span>
            <span className="echo-card__stat-value echo-card__stat-value--primary">
              {formatStatKeyValue(echo.mainStats.primary.key, echo.mainStats.primary.value)}
            </span>
          </div>
          <div className="echo-card__stat echo-card__stat--secondary">
            <span className="echo-card__stat-label">
              {formatStatKeyLabel(echo.mainStats.secondary.key)}
            </span>
            <span className="echo-card__stat-value">
              {formatStatKeyValue(echo.mainStats.secondary.key, echo.mainStats.secondary.value)}
            </span>
          </div>
        </div>

        {resolvedShowSubstats && substatEntries.length > 0 && (
          <div className="echo-card__stat-section echo-card__stat-section--subs">
            <div className="echo-card__subs-header">
              <span className="echo-card__subs-title">Substats</span>
            </div>
            {substatEntries.map(([key, value]) => (
              <div key={key} className="echo-card__stat echo-card__stat--sub">
                <span className="echo-card__stat-label">{formatStatKeyLabel(key)}</span>
                <span className="echo-card__stat-value echo-card__stat-value--sub">
                  {formatStatKeyValue(key, value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── EchoGrid ─────────────────────────────────────────────────────────────────

export function EchoGrid({
  echoes,
  variant = 'full',
  showSubstats,
  showImage = true,
  scores = null,
  slotCount,
  interactive = false,
  className = '',
  onEchoClick,
}: EchoGridProps) {
  const slots: Array<EchoInstance | null> = slotCount != null
    ? [
        ...echoes,
        ...Array.from<null>({ length: Math.max(0, slotCount - echoes.length) }).fill(null),
      ].slice(0, slotCount)
    : echoes

  const sorted = [...slots].sort((a, b) => {
    const costA = a ? (getEchoById(a.id)?.cost ?? (a.mainEcho ? 4 : 1)) : -1
    const costB = b ? (getEchoById(b.id)?.cost ?? (b.mainEcho ? 4 : 1)) : -1
    return costB - costA
  })

  const gridClass = ['echo-grid', `echo-grid--${variant}`, className]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={gridClass}>
      {sorted.map((echo, index) => (
        <EchoCard
          key={echo ? `${echo.uid}-${index}` : `empty-${index}`}
          echo={echo}
          variant={variant}
          showSubstats={showSubstats}
          showImage={showImage}
          score={scores?.[index] ?? null}
          interactive={interactive || Boolean(onEchoClick)}
          onClick={onEchoClick ? () => onEchoClick(echo, index) : undefined}
        />
      ))}
    </div>
  )
}

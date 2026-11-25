/*
  Author: Runor Ewhro
  description: projects normalized showcase report and customization data into
               the detailed card layout, including responsive text and ribbon
               geometry derived from rendered measurements.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { memo, useLayoutEffect, useMemo, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { ShowcaseCardHidden, StatsColumnHighlight } from '@/domain/entities/preferences'
import { useAppStore } from '@/application/state'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { weaponStatsAt } from '@/domain/services/weaponPlan.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getRarityColor, getRarityInk } from '@/modules/simulation/model/display.ts'
import { getWpnVisKey } from '@/modules/simulation/workspace/weaponVisual.ts'
import { useEchoScores } from '@/application/hooks/useEchoScoringRevision.ts'
import { cmptEchoCrit, getCvToneColor, getScrTone, SCORE_TONE_COLORS } from '@/modules/simulation/features/echoes/lib/metric.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { formatBuildEvaluationScore } from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { groupUid } from '@/modules/simulation/features/echoes/lib/playerIdentity.ts'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger.tsx'
import {
  EvaluationSeqRail,
  ResonatorName,
  statFamily,
  type CssVars,
  type EvaluationEchoSelection,
} from '@/modules/simulation/workspace/ui.tsx'
import type { BuildRailModel, ShowcaseBuildModel } from '@/modules/simulation/workspace/BuildRail.tsx'
import {
  ShowcaseEchoMains,
  ShowcaseEchoSubs,
  ShowcaseStatRow,
  loadoutCv,
  makeRelStats,
  type RelStats,
} from './Showcase.tsx'
import { buildTotalsByKey, showcaseSecondaryRows } from './lib/showcaseStats.ts'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'

export function rarityVars(rarity: number | null | undefined): CssVars | undefined {
  const color = getRarityColor(rarity)
  if (!color) return undefined
  return { '--kit-rar': color, '--kit-rar-ink': getRarityInk(rarity) } as CssVars
}

// reduce marked text only until it fits its container or reaches its declared floor.
function fitSignature(node: HTMLElement): string {
  const style = getComputedStyle(node)
  return [node.textContent, node.clientWidth, style.fontFamily, style.fontSize, style.fontWeight, style.letterSpacing].join('|')
}

function fitLines(root: HTMLElement, cache: WeakMap<HTMLElement, string>): void {
  const nodes = [...root.querySelectorAll<HTMLElement>('[data-fit]')].filter((node) => cache.get(node) !== fitSignature(node))
  for (const node of nodes) node.style.removeProperty('font-size')
  const pending = nodes.map((node) => ({ node, floor: Number(node.dataset.fit) || 10, size: parseFloat(getComputedStyle(node).fontSize) }))
  // read every overflow before writing this step, avoiding a layout per label.
  for (;;) {
    const shrinking = pending.filter(({ node, floor, size }) => size > floor && node.scrollWidth > node.clientWidth + 0.5)
    if (!shrinking.length) break
    for (const entry of shrinking) {
      entry.size = Math.max(entry.floor, entry.size - 0.5)
      entry.node.style.fontSize = `${entry.size}px`
    }
  }
  for (const node of nodes) cache.set(node, fitSignature(node))
}

// derive the ribbon opening from the measured card bounds.
function openRibbon(ribbon: HTMLElement, card: HTMLElement): void {
  const start = card.offsetLeft - ribbon.offsetLeft
  const end = start + card.offsetWidth
  if (ribbon.style.getPropertyValue('--showcase-detail-open-start') !== `${start}px`) ribbon.style.setProperty('--showcase-detail-open-start', `${start}px`)
  if (ribbon.style.getPropertyValue('--showcase-detail-open-end') !== `${end}px`) ribbon.style.setProperty('--showcase-detail-open-end', `${end}px`)
}

export const DetailedCard = memo(function DetailedCard({
  model,
  build,
  score,
  grade,
  tone,
  avgDamage,
  hidden,
  statsColumn,
  portraitCredit,
  backdropCredit,
  resId,
  onSequence,
  onEditWeapon,
  onOpenMember,
  team,
  onEchoOpen,
  echoSelection,
  blank,
  holder,
}: {
  model: BuildRailModel
  build: ShowcaseBuildModel
  score: number | null
  grade: string | null
  tone: string
  avgDamage: number | null
  hidden: ShowcaseCardHidden
  statsColumn: StatsColumnHighlight
  portraitCredit: string | null
  backdropCredit: string | null
  resId: string | null
  onSequence?: (node: number) => void
  onEditWeapon?: () => void
  onOpenMember?: () => void
  team: ReactNode
  onEchoOpen?: (slotIndex: number) => void
  echoSelection?: EvaluationEchoSelection
  blank?: boolean
  /** another player's name and UID, replacing the viewer's own. */
  holder?: { name: string | null; uid: string | null }
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scoreRef = useRef<HTMLDivElement>(null)
  const ribbonRef = useRef<HTMLSpanElement>(null)
  const ownId = useAppStore((state) => state.ui.preferences.playerId)
  const ownUid = useAppStore((state) => state.ui.preferences.playerUid)
  const playerId = holder ? holder.name : ownId
  const playerUid = holder ? holder.uid : ownUid
  const relStats = useMemo(() => makeRelStats(build.charId), [build.charId])
  const showRel = !hidden.relStats
  const slots = useMemo(() => Array.from({ length: 5 }, (_, slot) => build.echoes[slot] ?? null), [build.echoes])
  const echoScores = useEchoScores(build.charId, slots)
  const cv = loadoutCv(slots, blank)
  const buildByKey = buildTotalsByKey(build.buildStatsView)
  const rows = build.combatStatsView
    ? [...build.combatStatsView.mainStats, ...showcaseSecondaryRows(build.combatStatsView, build.buildStatsView)]
    : []
  const level = model.runtime?.base.level ?? 1
  const sequence = model.runtime?.base.sequence ?? 0
  const weaponLevel = model.weaponState?.level ?? 1
  const weaponStats = model.weapon ? weaponStatsAt(model.weapon, weaponLevel) : null
  const scoreLabel = formatBuildEvaluationScore(score)
  const credits: Array<{ tag: string; who: string }> = []
  if (!hidden.portraitCredit && portraitCredit) credits.push({ tag: 'Art', who: portraitCredit })
  if (!hidden.backdropCredit && backdropCredit) credits.push({ tag: 'BG', who: backdropCredit })

  useLayoutEffect(() => {
    const root = rootRef.current
    const ribbon = ribbonRef.current
    const scoreNode = scoreRef.current
    if (!root || !ribbon || !scoreNode) return
    let frame = 0
    let lastWidth = -1
    let fitted = new WeakMap<HTMLElement, string>()
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { fitLines(root, fitted); openRibbon(ribbon, scoreNode) })
    }
    const resize = new ResizeObserver(() => {
      const width = root.clientWidth
      if (width !== lastWidth) { lastWidth = width; schedule() }
      else openRibbon(ribbon, scoreNode)
    })
    resize.observe(root)
    resize.observe(scoreNode)
    const text = new MutationObserver(schedule)
    text.observe(root, { childList: true, characterData: true, subtree: true })
    const card = root.closest('.wk-rail')
    const typography = () => { fitted = new WeakMap(); schedule() }
    card?.addEventListener('showcase:typography', typography)
    document.fonts?.addEventListener('loadingdone', typography)
    schedule()
    return () => {
      cancelAnimationFrame(frame); resize.disconnect(); text.disconnect()
      card?.removeEventListener('showcase:typography', typography)
      document.fonts?.removeEventListener('loadingdone', typography)
    }
  }, [])

  const weaponRarity = model.weaponRarity ?? model.weapon?.rarity ?? null
  const weaponTypeKey = getWpnVisKey(model.weapon?.weaponType ?? model.seed?.weaponType ?? null)
  const bloomBody = (
    <>
      <span className="showcase-detail-weapon-halftone" aria-hidden="true" />
      <span className="showcase-detail-weapon-glow" aria-hidden="true" />
      {model.weaponIcon ? (
        <DisplayImage className="showcase-detail-weapon-gun" src={model.weaponIcon} alt="" decoding="async" onError={withDefIconM} />
      ) : (
        <span className="showcase-detail-weapon-gun showcase-detail-weapon-gun--empty" aria-hidden="true" />
      )}
      {weaponTypeKey ? (
        <span
          className="showcase-detail-weapon-type"
          aria-hidden="true"
          style={{ maskImage: `url('/assets/game/weapons/types/${weaponTypeKey}.webp')` } as CssVars}
        />
      ) : null}
      {weaponRarity ? (
        <span className="showcase-detail-stars-col" role="img" aria-label={`${weaponRarity}-star weapon`}>
          {Array.from({ length: weaponRarity }, (_, star) => (
            <i key={star} className="showcase-detail-star" aria-hidden="true" />
          ))}
        </span>
      ) : null}
      {model.weapon?.passive.name ? (
        <span className="showcase-detail-weapon-passive">{model.weapon.passive.name}</span>
      ) : null}
      <span className="showcase-detail-weapon-foot">
        <strong className="showcase-detail-weapon-name" data-fit="11">{model.weaponName}</strong>
        <span className="showcase-detail-weapon-pair">
          <b>R{model.weaponState?.rank ?? 1}</b>
          <span>LV {weaponLevel}</span>
        </span>
        {model.weapon ? (
          <span className="showcase-detail-weapon-figs">
            <span className="showcase-detail-weapon-fig" data-stat-family={statFamily('atk')}>
              <em>{formatStatKeyLabel('atk')}</em>
              <b>{Math.round(weaponStats?.atk ?? model.weapon.baseAtk)}</b>
            </span>
            <span className="showcase-detail-weapon-fig" data-stat-family={statFamily(model.weapon.statKey)}>
              <em>{formatStatKeyLabel(model.weapon.statKey)}</em>
              <b>{formatStatKeyValue(model.weapon.statKey, weaponStats?.statVal ?? model.weapon.statValue)}</b>
            </span>
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <div className="showcase-detail" ref={rootRef}>
      <span className="showcase-detail-background" aria-hidden="true" />

      <div className="showcase-detail-echoes">
        {slots.map((echo, slot) => (
          <Echo
            key={echo?.uid ?? `empty:${slot}`}
            echo={echo}
            index={slot + 1}
            score={echoScores?.[slot] ?? null}
            relStats={relStats}
            showRel={showRel}
            hideSubVal={hidden.subVal}
            hideSubColor={hidden.subColor}
            onOpen={onEchoOpen ? () => onEchoOpen(slot) : undefined}
            selection={echoSelection}
          />
        ))}
      </div>

      <span className="showcase-detail-panel" aria-hidden="true" />
      <span className="showcase-detail-ribbon" ref={ribbonRef} aria-hidden="true" />
      <span
        className="showcase-detail-kit-scale"
        aria-hidden="true"
        style={{ '--kit-rar': getRarityColor(weaponRarity) ?? 'var(--resonator-accent)' } as CssVars}
      />
      <span className="showcase-detail-kit-trace" aria-hidden="true" />

      {resId ? (
        <div className="showcase-detail-chain">
          <EvaluationSeqRail resId={resId} sequence={sequence} hidden={false} onActivate={onSequence} />
        </div>
      ) : null}

      {!hidden.brand || credits.length ? (
        <div className="showcase-detail-credits" aria-hidden="true">
          {credits.map((credit) => (
            <span key={credit.tag} className="showcase-detail-credit">
              <i>{credit.tag}</i>
              {credit.who}
            </span>
          ))}
          {!hidden.brand ? (
            <span className="showcase-detail-brand">
              <Thewuwacalculator className="showcase-detail-brand-mark" />
              <span><b>thewuwacalculator</b>.com</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="showcase-detail-id">
        <span className="showcase-detail-id-head">
          {model.attrIcon ? (
            <DisplayImage className="showcase-detail-id-attr" src={model.attrIcon} alt="" decoding="async" onError={withDefIconM} />
          ) : null}
          <strong className="showcase-detail-id-name" data-fit="28">
            <ResonatorName name={model.seed?.name ?? 'Resonator'} onOpen={onOpenMember} />
          </strong>
        </span>
        <span className="showcase-detail-id-meta">
          <span className="showcase-detail-stars" role="img" aria-label={`${model.rarity}-star resonator`}>
            {Array.from({ length: model.rarity }, (_, star) => (
              <i key={star} className="showcase-detail-star" aria-hidden="true" />
            ))}
          </span>
          <span className="showcase-detail-id-lv">Lv.<b>{level}</b></span>
        </span>
      </div>

      <div className="showcase-detail-verdict" ref={scoreRef} style={{ '--grade': tone } as CssVars}>
        <span className="showcase-detail-grade"><b>{grade || '-'}</b></span>
        <span className="showcase-detail-score">
          {scoreLabel.endsWith('%') ? (
            <>
              {scoreLabel.slice(0, -1)}
              <small>%</small>
            </>
          ) : scoreLabel}
        </span>
      </div>

      <div className="showcase-detail-metrics">
        <span className="showcase-detail-avg-line">
          <b className="showcase-detail-avg" data-fit="22">
            {avgDamage != null ? Math.round(avgDamage).toLocaleString('en-US') : '-'}
          </b>
          <span className="showcase-detail-label">avg dmg</span>
        </span>
        <span className="showcase-detail-metrics-foot">
          {playerId || playerUid ? (
            <span className="showcase-detail-holder">
              {playerId ? <b>{playerId}</b> : null}
              {playerUid ? <span>{groupUid(playerUid)}</span> : null}
            </span>
          ) : null}
          <span className="showcase-detail-cv" style={cv.tone ? ({ '--cv-tone': cv.tone } as CssVars) : undefined}>
            <span className="showcase-detail-label">cv</span>
            <b>{blank ? '-' : formatTruncCompact(cv.total, 1)}</b>
          </span>
        </span>
      </div>

      {rows.length ? (
        <div className="showcase-detail-stats sc-ladder" data-highlight={statsColumn}>
          <div className="sc-ladder-head" aria-hidden="true">
            <span className="sc-ladder-head-lead" />
            <span className="sc-ladder-col sc-ladder-col--build">build</span>
            <span className="sc-ladder-col sc-ladder-col--combat">combat</span>
          </div>
          <div className="showcase-detail-stats-rows">
            {rows.map((row) => {
              const buildTotal = buildByKey.get(row.key) ?? null
              return (
                <ShowcaseStatRow
                  key={row.key}
                  row={row}
                  buildTotal={buildTotal}
                  blank={blank}
                  relevant={showRel && relStats.fams.has(statFamily(row.key))}
                  raised={buildTotal != null && row.total - buildTotal > 0.0001}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="showcase-detail-stats sc-ladder sc-ladder--empty">No stats</div>
      )}

      {team}

      {onEditWeapon ? (
        <button
          type="button" className="showcase-detail-weapon"
          aria-label={`Edit ${model.weaponName}`}
          style={rarityVars(weaponRarity)}
          onClick={onEditWeapon}
        >
          {bloomBody}
        </button>
      ) : (
        <div className="showcase-detail-weapon" style={rarityVars(weaponRarity)}>{bloomBody}</div>
      )}
    </div>
  )
})

function Echo({
  echo,
  index,
  score,
  relStats,
  showRel,
  hideSubVal,
  hideSubColor,
  selection,
  onOpen,
}: {
  echo: EchoInstance | null
  index: number
  score: number | null
  relStats: RelStats
  showRel: boolean
  hideSubVal: boolean
  hideSubColor: boolean
  selection?: EvaluationEchoSelection
  onOpen?: () => void
}) {
  const openProps = onOpen ? {
    role: 'button',
    tabIndex: 0,
    onClick: () => {
      if (!selection?.selectionMode) onOpen()
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (selection?.selectionMode) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.click()
    },
  } : undefined

  if (!echo) {
    return (
      <article
        className="showcase-detail-echo showcase-detail-echo--empty"
        style={{ '--i': index } as CssVars}
        aria-label={onOpen ? `Slot ${index}, empty. Choose an Echo` : undefined}
        {...openProps}
      >
        <span className="showcase-detail-echo-plate" aria-hidden="true" />
        <span className="showcase-detail-echo-halo" aria-hidden="true" />
        <span className="showcase-detail-echo-medal" aria-hidden="true" />
        <span className="showcase-detail-echo-vacant">Empty slot</span>
      </article>
    )
  }

  const echoDef = getEchoById(echo.id)
  const setIcon = getSntSetIco(echo.set)
  const cv = cmptEchoCrit(echo.substats)
  const tone = score != null ? getScrTone(score) : null
  const itemId = selection?.getId(index - 1) ?? null
  const selected = itemId ? selection?.isSelected(itemId) ?? false : false

  const card = (
    <article
      className={[
        'showcase-detail-echo',
        selection?.selectionMode ? 'selection-mode' : '',
        selected ? 'focus-selected' : '',
      ].filter(Boolean).join(' ')}
      data-tone={tone ?? undefined}
      data-selection-focus-item="true"
      data-selected={selected ? 'true' : undefined}
      style={{ '--i': index, '--showcase-detail-tone': tone ? SCORE_TONE_COLORS[tone] : undefined } as CssVars}
      aria-label={onOpen ? `Slot ${index}. Edit ${echoDef?.name ?? 'Echo'}` : undefined}
      {...openProps}
      onClickCapture={itemId ? selection?.buildClickCapture(itemId) : undefined}
    >
      <span className="showcase-detail-echo-plate" aria-hidden="true" />
      <span className="showcase-detail-echo-halo" aria-hidden="true" />
      <span className="showcase-detail-echo-medal">
        {echoDef?.icon ? (
          <DisplayImage src={echoDef.icon} alt="" className="showcase-detail-echo-icon" decoding="async" onError={withDefIconM} />
        ) : (
          <span className="showcase-detail-echo-icon showcase-detail-echo-icon--fallback" />
        )}
      </span>
      {setIcon ? (
        <span className="showcase-detail-echo-coin showcase-detail-echo-coin--set">
          <DisplayImage src={setIcon} alt="" onError={withDefIconM} />
        </span>
      ) : null}
      <span className="showcase-detail-echo-coin showcase-detail-echo-coin--cost" aria-label={`${echoDef?.cost ?? 0} cost`}>
        {echoDef?.cost ?? 0}
      </span>
      {score != null ? (
        <span className="showcase-detail-echo-score">
          <b>{formatTruncCompact(score, 0)}</b>
          <i>%</i>
        </span>
      ) : null}
      <span className="showcase-detail-echo-cv" style={{ '--cv-tone': getCvToneColor(cv) } as CssVars}>
        CV {formatTruncCompact(cv, 1)}
      </span>
      <strong className="showcase-detail-echo-name" data-fit="10">{echoDef?.name ?? 'Echo'}</strong>
      <ShowcaseEchoMains echo={echo} relevant={showRel && relStats.keys.has(echo.mainStats.primary.key)} />
      <ShowcaseEchoSubs
        echo={echo}
        relStats={relStats}
        showRel={showRel}
        hideSubVal={hideSubVal}
        hideSubColor={hideSubColor}
      />
    </article>
  )

  if (!selection || !itemId) {
    return card
  }

  return (
    <ContextTrigger
      asChild
      ariaLabel={`${echoDef?.name ?? 'Echo'} actions`}
      items={selection.getItems(itemId, echo)}
    >
      {card}
    </ContextTrigger>
  )
}

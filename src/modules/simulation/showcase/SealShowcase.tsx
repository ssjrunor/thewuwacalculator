/*
  Author: Runor Ewhro
  Description: Projects normalized showcase report and customization data into
               the Seal card layout, including responsive text and ribbon
               geometry derived from rendered measurements.
*/

import { useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import type { EchoInstance } from '@/domain/entities/runtime'
import type { ShowcaseCardHidden, StatsColumnHighlight } from '@/domain/entities/preferences'
import { useAppStore } from '@/domain/state/store.ts'
import { getEchoById } from '@/domain/services/echoCatalogService'
import { weaponStatsAt } from '@/domain/services/weaponPlan.ts'
import { getSntSetIco } from '@/data/gameData/catalog/sonataSets'
import { getRarityColor, getRarityInk } from '@/modules/simulation/model/display.ts'
import { getWpnVisKey } from '@/modules/simulation/workspace/weaponVisual.ts'
import { getEchoScrPr } from '@/data/scoring/echoScoring.ts'
import { useEchoScoringRevision } from '@/data/scoring/useEchoScoringRevision.ts'
import { cmptEchoCrit, getCvToneColor, getScrTone } from '@/modules/simulation/features/echoes/lib/metric.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { formatBuildEvaluationScore } from '@/modules/simulation/model/buildEvaluationDisplay.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import {
  EvaluationSeqRail,
  statFamily,
  type CssVars,
  type EvaluationEchoSelection,
} from '@/modules/simulation/workspace/ui.tsx'
import type { BuildRailModel, ShowcaseBuildModel } from '@/modules/simulation/workspace/BuildRail.tsx'
import {
  ShowcaseEchoMains,
  ShowcaseEchoSubs,
  ShowcaseStatRow,
  buildTotalsByKey,
  loadoutCv,
  makeRelStats,
  type RelStats,
} from './Showcase.tsx'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'

// Return rarity color and its paired contrast ink as one CSS-variable contract.
export function rarityVars(rarity: number | null | undefined): CssVars | undefined {
  const color = getRarityColor(rarity)
  if (!color) return undefined
  return { '--kit-rar': color, '--kit-rar-ink': getRarityInk(rarity) } as CssVars
}

// Reduce marked text only until it fits its container or reaches its declared floor.
function fitLines(root: HTMLElement): void {
  for (const node of root.querySelectorAll<HTMLElement>('[data-fit]')) {
    node.style.removeProperty('font-size')
    const floor = Number(node.dataset.fit) || 10
    let size = parseFloat(getComputedStyle(node).fontSize)
    while (node.scrollWidth > node.clientWidth + 0.5 && size > floor) {
      size = Math.max(floor, size - 0.5)
      node.style.fontSize = `${size}px`
    }
  }
}

// Group numeric UIDs into stable three-digit segments without changing other ids.
function groupUid(uid: string): string {
  return /^\d+$/.test(uid) ? uid.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : uid
}

// Derive the ribbon opening from the measured seal bounds.
function openRibbon(ribbon: HTMLElement, seal: HTMLElement): void {
  const start = seal.offsetLeft - ribbon.offsetLeft
  ribbon.style.setProperty('--seal-open-start', `${start}px`)
  ribbon.style.setProperty('--seal-open-end', `${start + seal.offsetWidth}px`)
}

export function SealShowcase({
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
  team,
  echoSelection,
  blank,
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
  team: ReactNode
  echoSelection?: EvaluationEchoSelection
  blank?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const sealRef = useRef<HTMLDivElement>(null)
  const ribbonRef = useRef<HTMLSpanElement>(null)
  const playerId = useAppStore((state) => state.ui.preferences.playerId)
  const playerUid = useAppStore((state) => state.ui.preferences.playerUid)
  const relStats = useMemo(() => makeRelStats(build.charId), [build.charId])
  const showRel = !hidden.relStats
  const slots = Array.from({ length: 5 }, (_, slot) => build.echoes[slot] ?? null)
  const cv = loadoutCv(slots, blank)
  const buildByKey = buildTotalsByKey(build.buildStatsView)
  const rows = build.combatStatsView
    ? [...build.combatStatsView.mainStats, ...build.combatStatsView.secondaryStats]
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
    if (rootRef.current) fitLines(rootRef.current)
  })

  useLayoutEffect(() => {
    let live = true
    void document.fonts?.ready.then(() => {
      if (live && rootRef.current) fitLines(rootRef.current)
    })
    return () => {
      live = false
    }
  }, [])

  // Recalculate after every render because score content can move the seal.
  useLayoutEffect(() => {
    if (ribbonRef.current && sealRef.current) openRibbon(ribbonRef.current, sealRef.current)
  })

  // ResizeObserver covers geometry changes that do not trigger a React render.
  useLayoutEffect(() => {
    const ribbon = ribbonRef.current
    const sealNode = sealRef.current
    if (!ribbon || !sealNode) return undefined
    const observer = new ResizeObserver(() => openRibbon(ribbon, sealNode))
    observer.observe(sealNode)
    return () => observer.disconnect()
  }, [])

  const weaponRarity = model.weaponRarity ?? model.weapon?.rarity ?? null
  const weaponTypeKey = getWpnVisKey(model.weapon?.weaponType ?? model.seed?.weaponType ?? null)
  const bloomBody = (
    <>
      <span className="seal-bloom-halftone" aria-hidden="true" />
      <span className="seal-bloom-glow" aria-hidden="true" />
      {model.weaponIcon ? (
        <img className="seal-bloom-gun" src={model.weaponIcon} alt="" decoding="async" onError={withDefIconM} />
      ) : (
        <span className="seal-bloom-gun seal-bloom-gun--empty" aria-hidden="true" />
      )}
      {weaponTypeKey ? (
        <span
          className="seal-bloom-type"
          aria-hidden="true"
          style={{ maskImage: `url('/assets/game/weapons/types/${weaponTypeKey}.webp')` } as CssVars}
        />
      ) : null}
      {weaponRarity ? (
        <span className="seal-stars-col" role="img" aria-label={`${weaponRarity}-star weapon`}>
          {Array.from({ length: weaponRarity }, (_, star) => (
            <i key={star} className="seal-spark" aria-hidden="true" />
          ))}
        </span>
      ) : null}
      {model.weapon?.passive.name ? (
        <span className="seal-bloom-passive">{model.weapon.passive.name}</span>
      ) : null}
      <span className="seal-bloom-foot">
        <strong className="seal-bloom-name" data-fit="11">{model.weaponName}</strong>
        <span className="seal-bloom-pair">
          <b>R{model.weaponState?.rank ?? 1}</b>
          <span>LV {weaponLevel}</span>
        </span>
        {model.weapon ? (
          <span className="seal-bloom-figs">
            <span className="seal-bloom-fig" data-stat-family={statFamily('atk')}>
              <em>{formatStatKeyLabel('atk')}</em>
              <b>{Math.round(weaponStats?.atk ?? model.weapon.baseAtk)}</b>
            </span>
            <span className="seal-bloom-fig" data-stat-family={statFamily(model.weapon.statKey)}>
              <em>{formatStatKeyLabel(model.weapon.statKey)}</em>
              <b>{formatStatKeyValue(model.weapon.statKey, weaponStats?.statVal ?? model.weapon.statValue)}</b>
            </span>
          </span>
        ) : null}
      </span>
    </>
  )

  return (
    <div className="seal" ref={rootRef}>
      <span className="seal-veil" aria-hidden="true" />

      <div className="seal-echoes">
        {slots.map((echo, slot) => (
          <SealEcho
            key={echo?.uid ?? `empty:${slot}`}
            echo={echo}
            index={slot + 1}
            charId={build.charId}
            hasWeights={build.hasWeights}
            relStats={relStats}
            showRel={showRel}
            hideSubVal={hidden.subVal}
            hideSubColor={hidden.subColor}
            selection={echoSelection}
          />
        ))}
      </div>

      <span className="seal-panel" aria-hidden="true" />
      <span className="seal-ribbon" ref={ribbonRef} aria-hidden="true" />
      <span
        className="seal-kit-scale"
        aria-hidden="true"
        style={{ '--kit-rar': getRarityColor(weaponRarity) ?? 'var(--resonator-accent)' } as CssVars}
      />
      <span className="seal-kit-trace" aria-hidden="true" />

      {resId ? (
        <div className="seal-chain">
          <EvaluationSeqRail resId={resId} sequence={sequence} hidden={false} onActivate={onSequence} />
        </div>
      ) : null}

      {!hidden.brand || credits.length ? (
        <div className="seal-credits" aria-hidden="true">
          {credits.map((credit) => (
            <span key={credit.tag} className="seal-credit">
              <i>{credit.tag}</i>
              {credit.who}
            </span>
          ))}
          {!hidden.brand ? (
            <span className="seal-brand">
              <Thewuwacalculator className="seal-brand-mark" />
              <span><b>thewuwacalculator</b>.com</span>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="seal-id">
        <span className="seal-id-head">
          {model.attrIcon ? (
            <img className="seal-id-attr" src={model.attrIcon} alt="" decoding="async" onError={withDefIconM} />
          ) : null}
          <strong className="seal-id-name" data-fit="28">{model.seed?.name ?? 'Resonator'}</strong>
        </span>
        <span className="seal-id-meta">
          <span className="seal-stars" role="img" aria-label={`${model.rarity}-star resonator`}>
            {Array.from({ length: model.rarity }, (_, star) => (
              <i key={star} className="seal-star" aria-hidden="true" />
            ))}
          </span>
          <span className="seal-id-lv">Lv.<b>{level}</b></span>
        </span>
      </div>

      <div className="seal-verdict" ref={sealRef} style={{ '--grade': tone } as CssVars}>
        <span className="seal-grade"><b>{grade || '-'}</b></span>
        <span className="seal-score">
          {scoreLabel.endsWith('%') ? (
            <>
              {scoreLabel.slice(0, -1)}
              <small>%</small>
            </>
          ) : scoreLabel}
        </span>
      </div>

      <div className="seal-figures">
        <span className="seal-avg-line">
          <b className="seal-avg" data-fit="22">
            {avgDamage != null ? Math.round(avgDamage).toLocaleString('en-US') : '-'}
          </b>
          <span className="seal-label">avg dmg</span>
        </span>
        <span className="seal-figures-foot">
          {playerId || playerUid ? (
            <span className="seal-holder">
              {playerId ? <b>{playerId}</b> : null}
              {playerUid ? <span>{groupUid(playerUid)}</span> : null}
            </span>
          ) : null}
          <span className="seal-cv" style={cv.tone ? ({ '--cv-tone': cv.tone } as CssVars) : undefined}>
            <span className="seal-label">cv</span>
            <b>{blank ? '-' : formatTruncCompact(cv.total, 1)}</b>
          </span>
        </span>
      </div>

      {rows.length ? (
        <div className="seal-ledger showcase-ladder" data-highlight={statsColumn}>
          <div className="showcase-ladder-head" aria-hidden="true">
            <span className="showcase-ladder-head-lead" />
            <span className="showcase-ladder-col showcase-ladder-col--build">build</span>
            <span className="showcase-ladder-col showcase-ladder-col--combat">combat</span>
          </div>
          <div className="seal-ledger-rows">
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
        <div className="seal-ledger showcase-ladder showcase-ladder--empty">No stats</div>
      )}

      {team}

      {onEditWeapon ? (
        <button
          type="button" className="seal-bloom"
          aria-label={`Edit ${model.weaponName}`}
          style={rarityVars(weaponRarity)}
          onClick={onEditWeapon}
        >
          {bloomBody}
        </button>
      ) : (
        <div className="seal-bloom" style={rarityVars(weaponRarity)}>{bloomBody}</div>
      )}
    </div>
  )
}

function SealEcho({
  echo,
  index,
  charId,
  hasWeights,
  relStats,
  showRel,
  hideSubVal,
  hideSubColor,
  selection,
}: {
  echo: EchoInstance | null
  index: number
  charId: string
  hasWeights: boolean
  relStats: RelStats
  showRel: boolean
  hideSubVal: boolean
  hideSubColor: boolean
  selection?: EvaluationEchoSelection
}) {
  useEchoScoringRevision(charId)

  if (!echo) {
    return (
      <article className="seal-echo seal-echo--empty" style={{ '--i': index } as CssVars}>
        <span className="seal-echo-plate" aria-hidden="true" />
        <span className="seal-echo-halo" aria-hidden="true" />
        <span className="seal-echo-medal" aria-hidden="true" />
        <span className="seal-echo-vacant">Empty slot</span>
      </article>
    )
  }

  const echoDef = getEchoById(echo.id)
  const setIcon = getSntSetIco(echo.set)
  const cv = cmptEchoCrit(echo.substats)
  const score = hasWeights ? getEchoScrPr(charId, echo) : null
  const tone = score != null ? getScrTone(score) : null
  const itemId = selection?.getId(index - 1) ?? null
  const selected = itemId ? selection?.isSelected(itemId) ?? false : false

  const card = (
    <article
      className={[
        'seal-echo',
        selection?.selectionMode ? 'selection-mode' : '',
        selected ? 'focus-selected' : '',
      ].filter(Boolean).join(' ')}
      data-tone={tone ?? undefined}
      data-selection-focus-item="true"
      data-selected={selected ? 'true' : undefined}
      style={{ '--i': index } as CssVars}
      onClickCapture={itemId ? selection?.buildClickCapture(itemId) : undefined}
    >
      <span className="seal-echo-plate" aria-hidden="true" />
      <span className="seal-echo-halo" aria-hidden="true" />
      <span className="seal-echo-medal">
        {echoDef?.icon ? (
          <img src={echoDef.icon} alt="" className="seal-echo-icon" decoding="async" onError={withDefIconM} />
        ) : (
          <span className="seal-echo-icon seal-echo-icon--fallback" />
        )}
      </span>
      {setIcon ? (
        <span className="seal-echo-coin seal-echo-coin--set">
          <img src={setIcon} alt="" onError={withDefIconM} />
        </span>
      ) : null}
      <span className="seal-echo-coin seal-echo-coin--cost" aria-label={`${echoDef?.cost ?? 0} cost`}>
        {echoDef?.cost ?? 0}
      </span>
      {score != null ? (
        <span className="seal-echo-score">
          <b>{formatTruncCompact(score, 0)}</b>
          <i>%</i>
        </span>
      ) : null}
      <span className="seal-echo-cv" style={{ '--cv-tone': getCvToneColor(cv) } as CssVars}>
        CV {formatTruncCompact(cv, 1)}
      </span>
      <strong className="seal-echo-name" data-fit="10">{echoDef?.name ?? 'Echo'}</strong>
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

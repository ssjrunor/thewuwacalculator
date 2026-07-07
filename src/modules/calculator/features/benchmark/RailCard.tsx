import type { CSSProperties, MouseEvent as ReactMouseEvent, RefObject } from 'react'
import type { ResRuntime, ResSeed, WeaponState } from '@/domain/entities/runtime'
import type { GenWpn } from '@/domain/entities/weapon'
import type { AttributeKey } from '@/domain/entities/stats'
import { weaponStatsAt } from '@/domain/services/weaponPlan.ts'
import type { StatsView } from '@/modules/calculator/model/statsView.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/calculator/model/statsView.ts'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { SpinePortrait, SpineSetupBackground } from '@/shared/spine/SpinePortrait.tsx'
import type { SpinePlacement } from '@/shared/spine/SpinePortrait.tsx'
import type { BenchmarkCardHidden } from '@/domain/entities/preferences'
import { StatGlyph, BenchSeqRail, statFamily, type BenchmarkEchoSelection, type CssVars } from './ui.tsx'
import { ShowcaseBuild } from './Showcase.tsx'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'

interface SonataToken {
  id?: number
  setId?: number
  count?: number
  pieces?: number
  icon?: string | null
  name: string
}

interface TeamSupport {
  id: string
  name: string
  rarity: number
  sprite: string
  spriteCss: CSSProperties
  attribute: AttributeKey
  accent: string
  level: number | null
  sequence: number
  weaponIcon: string | null
  weaponName: string | null
  weaponRarity: number | null
  weaponLevel: number | null
  weaponRank: number | null
  sets: SonataToken[]
}

export interface RailCardModel {
  runtime: ResRuntime | null
  seed: ResSeed | null
  rarity: number
  accent: string
  attrIcon: string | null
  portraitSrc: string
  spriteCss: CSSProperties
  weaponState: WeaponState | null
  weapon: GenWpn | null
  weaponName: string
  weaponRarity: number | null
  weaponIcon: string | null
  sonataSets: Array<{ setId: number; pieces: number; icon: string | null; name: string }>
  teamSupports: TeamSupport[]
}

export interface ShowcaseBuildModel {
  statsView: StatsView | null
  buildStatsView: StatsView | null
  charId: string
  hasWeights: boolean
  echoes: ResRuntime['build']['echoes']
  sonataSets: Array<{ setId: number; pieces: number; icon: string | null; name: string }>
}

// Stat hover-focus: keying one stat must light every element of the same family
// across the card (ladder rows, echo mains/subs, weapon stats), which live in
// separate subtrees, so it is driven from the shared root rather than CSS :hover.
// Toggles classes directly on the handful of [data-stat-family] nodes (no React
// re-render) and short-circuits when the keyed family has not changed.
function applyStatFocus(root: HTMLElement, family: string): void {
  if ((root.dataset.statFocus ?? '') === family) return
  if (family) root.dataset.statFocus = family
  else delete root.dataset.statFocus
  for (const node of root.querySelectorAll<HTMLElement>('[data-stat-family]')) {
    const match = family !== '' && node.dataset.statFamily === family
    node.classList.toggle('stat-keyed', match)
    node.classList.toggle('stat-muted', family !== '' && !match)
  }
}

function handleStatFocusOver(event: ReactMouseEvent<HTMLElement>): void {
  const keyed = (event.target as HTMLElement).closest<HTMLElement>('[data-stat-family]')
  applyStatFocus(event.currentTarget, keyed?.dataset.statFamily ?? '')
}

export function RailCard({
  buildCardRef,
  isShowcase,
  customCss,
  railPhase,
  editMode,
  railResId,
  railModel,
  cardHidden,
  railStyle,
  backdropStyle,
  statsColumn,
  portraitCredit,
  backdropCredit,
  resolvedPortrait,
  animatedPortraits,
  surfacePhase,
  showcasePlacement,
  score,
  grade,
  tone,
  showcaseBuild,
  showcaseAvgDamage,
  echoSelection,
  blank,
}: {
  buildCardRef: RefObject<HTMLElement | null>
  isShowcase: boolean
  customCss: string | null
  railPhase: 'idle' | 'out' | 'in'
  editMode: 'portrait' | 'backdrop' | null
  railResId: string | null
  railModel: RailCardModel
  cardHidden: BenchmarkCardHidden
  railStyle: CssVars
  backdropStyle: CssVars
  statsColumn: 'build' | 'combat' | 'both'
  portraitCredit: string | null
  backdropCredit: string | null
  resolvedPortrait: string | null
  animatedPortraits: boolean
  surfacePhase: 'idle' | 'out' | 'in'
  showcasePlacement: SpinePlacement
  score: number | null
  grade: string | null
  tone: string
  showcaseBuild: ShowcaseBuildModel | null
  showcaseAvgDamage: number | null
  echoSelection?: BenchmarkEchoSelection
  blank?: boolean
}) {
  const credits: Array<{ tag: string; who: string }> = []
  if (isShowcase && !cardHidden.portraitCredit && portraitCredit) {
    credits.push({ tag: 'Art', who: portraitCredit })
  }
  if (isShowcase && !cardHidden.backdropCredit && backdropCredit) {
    credits.push({ tag: 'BG', who: backdropCredit })
  }
  const weaponLevel = railModel.weaponState?.level ?? 1
  const weaponStats = railModel.weapon ? weaponStatsAt(railModel.weapon, weaponLevel) : null
  const seqRailHidden = isShowcase && cardHidden.seqRail

  return (
    <aside
      ref={buildCardRef}
      className="bench-rail bench-card"
      data-phase={railPhase}
      data-edit={isShowcase ? editMode ?? undefined : undefined}
      style={railStyle}
      onMouseOver={isShowcase ? handleStatFocusOver : undefined}
      onMouseLeave={isShowcase ? (event) => applyStatFocus(event.currentTarget, '') : undefined}
    >
      {isShowcase && customCss ? <style>{customCss}</style> : null}
      <SpineSetupBackground
        resId={railResId}
        fallbackUrl={railModel.portraitSrc}
        className="bench-portrait-bg"
        style={backdropStyle}
      />
      <div className="bench-rail-port">
        <div className="bench-portrait-figure">
          <SpinePortrait
            resId={railResId}
            animated={animatedPortraits}
            playing={surfacePhase === 'idle' && railPhase === 'idle'}
            spineClassName="bench-portrait-spine"
            placement={showcasePlacement}
            overrideImageUrl={resolvedPortrait}
            fallback={
              <img
                src={railModel.portraitSrc}
                alt={railModel.seed?.name ?? 'Resonator'}
                className="bench-portrait-img"
                style={railModel.spriteCss}
                loading="lazy"
                decoding="async"
                onError={withDefIconM}
              />
            }
          />
          {grade ? (
            <span className="bench-portrait-grade" data-score={Math.floor(score ?? 0)} style={{ '--grade': tone } as CssVars}>
              {grade}
            </span>
          ) : null}
          {railResId ? (
            <BenchSeqRail
              resId={railResId}
              sequence={railModel.runtime?.base.sequence ?? 0}
              hidden={seqRailHidden}
            />
          ) : null}
        </div>

        <div className="bench-rail-body">
          <div className="bench-portrait-meta" data-rarity={railModel.rarity}>
            <h3 className="bench-portrait-name">{railModel.seed?.name ?? 'Resonator'}</h3>
            <div className="bench-portrait-tags">
              <span className="bench-rarity" role="img" aria-label={`${railModel.rarity}-star resonator`}>
                {Array.from({ length: railModel.rarity }, (_, star) => (
                  <i key={star} className="bench-rarity-star" aria-hidden="true" />
                ))}
              </span>
              <span className="bench-portrait-lv">Lv.{railModel.runtime?.base.level ?? 1}</span>
            </div>
          </div>

          <div className="bench-weapon">
            <span className="bench-weapon-frame" data-rarity={railModel.weaponRarity ?? undefined}>
              {railModel.weaponIcon ? (
                <img
                  src={railModel.weaponIcon}
                  alt={railModel.weaponName}
                  className="bench-weapon-icon"
                  loading="lazy"
                  decoding="async"
                  onError={withDefIconM}
                />
              ) : (
                <span className="bench-weapon-icon bench-weapon-icon--fallback">W</span>
              )}
            </span>
            <span className="bench-weapon-copy">
              <span className="bench-weapon-head">
                                <span className="bench-weapon-meta">
                  <span className="bench-weapon-lv">Lv.{railModel.weaponState?.level ?? 1}</span>
                  <span className="bench-weapon-rank">R{railModel.weaponState?.rank ?? 1}</span>
                </span>
                <strong className="bench-weapon-name">{railModel.weaponName}</strong>
              </span>
              <span className="bench-weapon-stat">
                {railModel.weapon ? (
                  <>
                    <span className="bench-weapon-stat-item" data-stat-family={statFamily('atk')}>
                      <StatGlyph statKey="atk" size={1.25} />
                      <span className="bench-weapon-stat-figure">
                        <span className="bench-weapon-stat-value">{Math.round(weaponStats?.atk ?? railModel.weapon.baseAtk)}</span>
                        <span className="bench-weapon-stat-label">Base ATK</span>
                      </span>
                    </span>
                    <span className="bench-weapon-stat-item" data-stat-family={statFamily(railModel.weapon.statKey)}>
                      <StatGlyph statKey={railModel.weapon.statKey} size={1.25} />
                      <span className="bench-weapon-stat-figure">
                        <span className="bench-weapon-stat-value">
                          {formatStatKeyValue(railModel.weapon.statKey, weaponStats?.statVal ?? railModel.weapon.statValue)}
                        </span>
                        <span className="bench-weapon-stat-label">{formatStatKeyLabel(railModel.weapon.statKey)}</span>
                      </span>
                    </span>
                  </>
                ) : (
                  <span className="bench-weapon-stat--empty">No bonus stat</span>
                )}
              </span>
            </span>
          </div>

          {!(isShowcase && cardHidden.team) ? <TeamBlock teamSupports={railModel.teamSupports} /> : null}
        </div>
      </div>

      <div
        className="bench-rail-build"
        data-phase={isShowcase ? surfacePhase : undefined}
        {...(isShowcase ? echoSelection?.surfaceProps : undefined)}
      >
        {isShowcase && showcaseBuild ? (
          <ShowcaseBuild
            echoes={showcaseBuild.echoes}
            statsView={showcaseBuild.statsView}
            buildStatsView={showcaseBuild.buildStatsView}
            sonataSets={showcaseBuild.sonataSets}
            score={score}
            grade={grade}
            hideSubVal={cardHidden.subVal}
            hideSubColor={cardHidden.subColor}
            hideRelStats={cardHidden.relStats}
            tone={tone}
            avgDamage={showcaseAvgDamage}
            charId={showcaseBuild.charId}
            hasWeights={showcaseBuild.hasWeights}
            hideScore={cardHidden.score}
            hideDamage={cardHidden.damage}
            hideCv={cardHidden.cv}
            statsColumn={statsColumn}
            echoSelection={echoSelection}
            blank={blank}
          />
        ) : null}
      </div>

      {isShowcase && !cardHidden.brand ? (
        <div className="bench-rail-brand" aria-hidden="true">
          <span className="bench-brand-word">rendered by</span>
          <Thewuwacalculator className="bench-brand-mark" />
          <span className="bench-brand-word">
            thewuwacalculator<span className="bench-brand-tld">.com</span>
          </span>
        </div>
      ) : null}

      {credits.length ? (
        <div className="bench-rail-credit" aria-hidden="true">
          {credits.map((credit) => (
            <span key={credit.tag} className="bench-credit-line">
              <span className="bench-credit-tag">{credit.tag}</span>
              <span className="bench-credit-who">{credit.who}</span>
            </span>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

function TeamBlock({ teamSupports }: { teamSupports: TeamSupport[] }) {
  return (
    <div className="bench-rail-block">
      <span className="bench-eyebrow">Team</span>
      <div className="bench-team">
        {Array.from({ length: 2 }, (_, slotIndex) => {
          const mate = teamSupports[slotIndex]
          return mate ? <TeamMate key={mate.id} mate={mate} /> : <EmptyTeamMate key={`empty:${slotIndex}`} />
        })}
      </div>
    </div>
  )
}

function EmptyTeamMate() {
  return (
    <article className="bench-mate bench-mate--empty">
      <div className="bench-mate-content">
        <div className="bench-mate-head">
          <span className="bench-mate-attr bench-mate-attr--empty" aria-hidden="true" />
          <strong className="bench-mate-name">No resonator</strong>
          <span className="bench-mate-lv">-</span>
          <span className="bench-mate-seq" aria-hidden="true">
            {Array.from({ length: 6 }, (_, pip) => (
              <i key={pip} />
            ))}
          </span>
        </div>
        <div className="bench-mate-gear">
          <span className="bench-mate-chip">
            <span className="bench-mate-wpn bench-mate-wpn--empty" />
            <span className="bench-mate-chip-text">No wpn</span>
          </span>
          <span className="bench-mate-chip">
            <span className="bench-mate-set bench-mate-set--empty" />
            <span className="bench-mate-chip-text">-pc</span>
          </span>
        </div>
      </div>
      <span className="bench-mate-frame" aria-hidden="true" />
    </article>
  )
}

function TeamMate({ mate }: { mate: TeamSupport }) {
  const attrIcon = getAttributeIconSrc(mate.attribute)
  return (
    <article
      className="bench-mate"
      data-rarity={mate.rarity}
      style={{ '--browser-accent': mate.accent } as CssVars}
    >
      <div className="bench-mate-content">
        <div className="bench-mate-head">
          {attrIcon ? (
            <img src={attrIcon} alt="" className="bench-mate-attr" loading="lazy" onError={withDefIconM} />
          ) : null}
          <strong className="bench-mate-name">{mate.name}</strong>
          <span className="bench-mate-lv">Lv.{mate.level ?? 1}</span>
          <span className="bench-mate-seq" aria-label={`Sequence ${mate.sequence} of 6`}>
            {Array.from({ length: 6 }, (_, pip) => (
              <i key={pip} data-on={pip < mate.sequence ? 'true' : undefined} />
            ))}
          </span>
        </div>
        <div className="bench-mate-gear">
          <span className="bench-mate-chip bench-mate-chip--wpn" data-rarity={mate.weaponRarity ?? undefined}>
            {mate.weaponIcon ? (
              <img
                src={mate.weaponIcon}
                alt={mate.weaponName ?? 'Weapon'}
                className="bench-mate-wpn"
                loading="lazy"
                onError={withDefIconM}
              />
            ) : (
              <span className="bench-mate-wpn bench-mate-wpn--empty" />
            )}
            <span className="bench-mate-chip-text">
              {mate.weaponLevel != null ? `Lv.${mate.weaponLevel}` : 'No Wpn'}
              {mate.weaponRank != null ? ` · R${mate.weaponRank}` : ''}
            </span>
          </span>
          {mate.sets.map((set) => (
            <span key={set.id ?? set.setId} className="bench-mate-chip" title={set.name}>
              {set.icon ? <img src={set.icon} alt={set.name} className="bench-mate-set" loading="lazy" onError={withDefIconM} /> : null}
              <span className="bench-mate-chip-text">{set.count ?? set.pieces}pc</span>
            </span>
          ))}
        </div>
      </div>
      <span className="bench-mate-frame" aria-hidden="true">
        <img
          src={mate.sprite}
          alt=""
          className="bench-mate-portrait"
          style={mate.spriteCss}
          loading="lazy"
          decoding="async"
          onError={withDefIconM}
        />
      </span>
    </article>
  )
}

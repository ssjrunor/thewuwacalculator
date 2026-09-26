/*
  Author: Runor Ewhro
  Description: Projects a runtime into the shared build rail and coordinates
               stat-family focus, sequence changes, and scenario member edits.
*/

import { useCallback, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
import type { ResRuntime, ResSeed, WeaponState } from '@/domain/entities/runtime'
import type { CombatScenarioId } from '@/domain/entities/combatScenario.ts'
import type { GenWpn } from '@/domain/entities/weapon'
import type { AttributeKey } from '@/domain/entities/stats'
import { weaponStatsAt } from '@/domain/services/weaponPlan.ts'
import type { StatsView } from '@/modules/simulation/model/statsView.ts'
import { formatStatKeyLabel, formatStatKeyValue } from '@/modules/simulation/model/statsView.ts'
import { getAttributeIconSrc } from '@/domain/gameData/attributeDisplay.ts'
import { withDefIconM } from '@/shared/lib/imageFallback.ts'
import { useAppStore } from '@/application/state'
import { selectedCombatScenario } from '@/domain/entities/scenarioLibrary.ts'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore.ts'
import { setResRtSequence } from '@/engine/gameData/resonatorMax.ts'
import { openTeamCnsl } from '@/modules/simulation/features/teams/lib/teamConsoleStore.ts'
import { openWpnCnsl } from '@/modules/simulation/features/weapons/lib/weaponConsoleStore.ts'
import { useTeamSlots } from '@/modules/simulation/features/teams/lib/teamSlots.ts'
import { TeamPicker } from '@/modules/simulation/features/teams/TeamPicker.tsx'
import { useAppModal } from '@/shared/ui/useAppModal.ts'
import { mainPortal } from '@/shared/lib/portalTarget.ts'
import { SpinePortrait, SpineSetupBackground } from '@/shared/spine/SpinePortrait.tsx'
import type { SpinePlacement } from '@/shared/spine/SpinePortrait.tsx'
import type { ShowcaseCardHidden, ShowcaseLayout } from '@/domain/entities/preferences'
import { StatGlyph, EvaluationSeqRail, statFamily, type EvaluationEchoSelection, type CssVars } from '@/modules/simulation/workspace/ui.tsx'
import { ShowcaseBuild } from '@/modules/simulation/surfaces/showcase/Showcase.tsx'
import { SealShowcase, rarityVars } from '@/modules/simulation/surfaces/showcase/SealShowcase.tsx'
import { getRarityColor } from '@/modules/simulation/model/display.ts'
import { useShowcaseImageContrast } from '@/modules/simulation/surfaces/showcase/showcaseImageContrast.ts'
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
  profile: string
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

export interface BuildRailModel {
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
  combatStatsView: StatsView | null
  buildStatsView: StatsView | null
  charId: string
  hasWeights: boolean
  echoes: ResRuntime['build']['echoes']
  sonataSets: Array<{ setId: number; pieces: number; icon: string | null; name: string }>
}

/* Stat families cross separate subtrees, so one delegated root updates their
   DOM classes without introducing transient React state. */
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

export function BuildRail({
  buildCardRef,
  isShowcase,
  customCss,
  railPhase,
  editMode,
  railResId,
  scenarioId,
  railModel,
  cardHidden,
  railStyle,
  backdropStyle,
  statsColumn,
  portraitCredit,
  backdropCredit,
  resolvedPortrait,
  animatedPortraits,
  onAnimatedPortraitsChange,
  editable,
  onRuntimeUpdate,
  surfacePhase,
  showcasePlacement,
  score,
  grade,
  tone,
  showcaseBuild,
  showcaseAvgDamage,
  onEchoOpen,
  echoSelection,
  blank,
  autoImageContrast,
  layout = 'classic',
}: {
  buildCardRef: RefObject<HTMLElement | null>
  isShowcase: boolean
  customCss: string | null
  railPhase: 'idle' | 'out' | 'in'
  editMode: 'portrait' | 'backdrop' | null
  railResId: string | null
  scenarioId?: CombatScenarioId | null
  railModel: BuildRailModel
  cardHidden: ShowcaseCardHidden
  railStyle: CssVars
  backdropStyle: CssVars
  statsColumn: 'build' | 'combat' | 'both'
  portraitCredit: string | null
  backdropCredit: string | null
  resolvedPortrait: string | null
  animatedPortraits: boolean
  onAnimatedPortraitsChange?: (next: boolean) => void
  editable: boolean
  onRuntimeUpdate?: (resonatorId: string, updater: (runtime: ResRuntime) => ResRuntime) => void
  surfacePhase: 'idle' | 'out' | 'in'
  showcasePlacement: SpinePlacement
  score: number | null
  grade: string | null
  tone: string
  showcaseBuild: ShowcaseBuildModel | null
  showcaseAvgDamage: number | null
  onEchoOpen?: (slotIndex: number) => void
  echoSelection?: EvaluationEchoSelection
  blank?: boolean
  autoImageContrast: boolean
  layout?: ShowcaseLayout
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
  // Layout preference is showcase-only; shared workspace rails remain classic.
  const seal = isShowcase && layout === 'seal'
  const contrastWatchKey = `${railResId ?? ''}:${JSON.stringify(backdropStyle)}`
  const imageContrastVars = useShowcaseImageContrast(
    buildCardRef,
    isShowcase && autoImageContrast,
    contrastWatchKey,
  )
  const resolvedRailStyle = useMemo(
    () => ({ ...railStyle, ...imageContrastVars }),
    [imageContrastVars, railStyle],
  )

  const updResRt = useAppStore((state) => state.updResRt)
  // Activating the current sequence node steps back one; another node selects its prefix.
  const setSequence = useCallback((node: number) => {
    if (!editable || !railResId) return
    const update = onRuntimeUpdate ?? updResRt
    update(railResId, (prev) => setResRtSequence(
      prev,
      getResDtlsBy()[prev.id],
      prev.base.sequence === node ? node - 1 : node,
    ))
  }, [editable, onRuntimeUpdate, railResId, updResRt])

  const weaponBlock = (
    <>
      <span className="workspace-weapon-frame" data-rarity={railModel.weaponRarity ?? undefined}>
        {railModel.weaponIcon ? (
          <img
            src={railModel.weaponIcon}
            alt={railModel.weaponName} className="workspace-weapon-icon"
            loading="lazy"
            decoding="async"
            onError={withDefIconM}
          />
        ) : (
          <span className="workspace-weapon-icon workspace-weapon-icon--fallback">W</span>
        )}
      </span>
      <span className="workspace-weapon-copy">
        <span className="workspace-weapon-head">
                          <span className="workspace-weapon-meta">
            <span className="workspace-weapon-lv">Lv.{railModel.weaponState?.level ?? 1} • R{railModel.weaponState?.rank ?? 1}</span>
          </span>
          <strong className="workspace-weapon-name">{railModel.weaponName}</strong>
        </span>
        <span className="workspace-weapon-stat">
          {railModel.weapon ? (
            <>
              <span className="workspace-weapon-stat-item" data-stat-family={statFamily('atk')}>
                <StatGlyph statKey="atk" size={1.25} />
                <span className="workspace-weapon-stat-figure">
                  <span className="workspace-weapon-stat-value">{Math.round(weaponStats?.atk ?? railModel.weapon.baseAtk)}</span>
                  <span className="workspace-weapon-stat-label">Base ATK</span>
                </span>
              </span>
              <span className="workspace-weapon-stat-item" data-stat-family={statFamily(railModel.weapon.statKey)}>
                <StatGlyph statKey={railModel.weapon.statKey} size={1.25} />
                <span className="workspace-weapon-stat-figure">
                  <span className="workspace-weapon-stat-value">
                    {formatStatKeyValue(railModel.weapon.statKey, weaponStats?.statVal ?? railModel.weapon.statValue)}
                  </span>
                  <span className="workspace-weapon-stat-label">{formatStatKeyLabel(railModel.weapon.statKey)}</span>
                </span>
              </span>
            </>
          ) : (
            <span className="workspace-weapon-stat--empty">No bonus stat</span>
          )}
        </span>
      </span>
    </>
  )

  return (
    <aside
      ref={buildCardRef} className="workspace-rail workspace-card"
      data-phase={railPhase}
      data-layout={seal ? 'seal' : undefined}
      data-edit={isShowcase ? editMode ?? undefined : undefined}
      style={resolvedRailStyle}
      onMouseOver={isShowcase ? handleStatFocusOver : undefined}
      onMouseLeave={isShowcase ? (event) => applyStatFocus(event.currentTarget, '') : undefined}
    >
      {isShowcase && customCss ? <style>{customCss}</style> : null}
      <SpineSetupBackground
        resId={railResId}
        fallbackUrl={railModel.portraitSrc} className="workspace-portrait-bg"
        style={backdropStyle}
      />

      {onAnimatedPortraitsChange ? (
        <>
          <span className="workspace-portrait-scrim" aria-hidden="true" />
          <span className="workspace-portrait-cue" aria-hidden="true">
            <span className={`workspace-cue-glyph${animatedPortraits ? '' : ' is-paused'}`}>
              <i className="workspace-cue-bar workspace-cue-bar--a" />
              <i className="workspace-cue-bar workspace-cue-bar--b" />
            </span>
            <span className="workspace-cue-word">{animatedPortraits ? 'Pause' : 'Play'}</span>
          </span>
        </>
      ) : null}
      <div className="workspace-rail-port">
        <div className="workspace-portrait-figure"
          data-switch={onAnimatedPortraitsChange ? 'true' : undefined}
          role={onAnimatedPortraitsChange ? 'switch' : undefined}
          aria-checked={onAnimatedPortraitsChange ? animatedPortraits : undefined}
          aria-label={onAnimatedPortraitsChange ? 'Animated portrait' : undefined}
          tabIndex={onAnimatedPortraitsChange ? 0 : undefined}
          onClick={onAnimatedPortraitsChange ? (event) => {
            // Nested controls retain their own activation instead of toggling playback.
            if ((event.target as HTMLElement).closest('button, a, input, [role="button"], [role="radio"]')) return
            onAnimatedPortraitsChange(!animatedPortraits)
          } : undefined}
          onKeyDown={onAnimatedPortraitsChange ? (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            if (event.target !== event.currentTarget) return
            event.preventDefault()
            onAnimatedPortraitsChange(!animatedPortraits)
          } : undefined}
        >
          <SpinePortrait
            resId={railResId}
            animated={animatedPortraits}
            playing={surfacePhase === 'idle' && railPhase === 'idle'}
            spineClassName="workspace-portrait-spine"
            placement={showcasePlacement}
            overrideImageUrl={resolvedPortrait}
            fallback={
              <img
                src={railModel.portraitSrc}
                alt={railModel.seed?.name ?? 'Resonator'} className="workspace-portrait-img"
                style={railModel.spriteCss}
                loading="lazy"
                decoding="async"
                onError={withDefIconM}
              />
            }
          />
          {grade && !seal ? (
            <span className="workspace-portrait-grade" data-score={Math.floor(score ?? 0)} style={{ '--grade': tone } as CssVars}>
              {grade}
            </span>
          ) : null}
          {railResId && !seal ? (
            <EvaluationSeqRail
              resId={railResId}
              sequence={railModel.runtime?.base.sequence ?? 0}
              hidden={seqRailHidden}
              onActivate={editable && railModel.runtime ? setSequence : undefined}
            />
          ) : null}
        </div>

        {!seal ? (
          <div className="workspace-rail-body">
            <div className="workspace-portrait-meta" data-rarity={railModel.rarity}>
              <span className="workspace-portrait-name"> {railModel.attrIcon ? (
                <img
                  src={railModel.attrIcon}
                  alt="" className="workspace-portrait-elem"
                  loading="lazy"
                  decoding="async"
                  onError={withDefIconM}
                />
              ) : null} {railModel.seed?.name ?? 'Resonator'}</span>
              <div className="workspace-portrait-tags">
                <span className="workspace-rarity" role="img" aria-label={`${railModel.rarity}-star resonator`}>
                  {Array.from({ length: railModel.rarity }, (_, star) => (
                    <i key={star} className="workspace-rarity-star" aria-hidden="true" />
                  ))}
                </span>
                <span className="workspace-portrait-lv">LV {railModel.runtime?.base.level ?? 1}</span>
              </div>
            </div>

            {editable && railResId && railModel.runtime ? (
              <button
                type="button" className="workspace-weapon"
                aria-label={`Edit ${railModel.weaponName}`}
                onClick={() => openWpnCnsl(railResId, scenarioId)}
              >
                {weaponBlock}
              </button>
            ) : (
              <div className="workspace-weapon">{weaponBlock}</div>
            )}

            {!(isShowcase && cardHidden.team) ? (
              <TeamBlock
                teamSupports={railModel.teamSupports}
                ownerResId={railResId}
                team={railModel.runtime?.build.team ?? null}
                editable={editable}
                scenarioId={scenarioId}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="workspace-rail-build"
        data-phase={isShowcase ? surfacePhase : undefined}
        {...(isShowcase ? echoSelection?.surfaceProps : undefined)}
      >
        {isShowcase && showcaseBuild && seal ? (
          <SealShowcase
            model={railModel}
            build={showcaseBuild}
            score={score}
            grade={grade}
            tone={tone}
            avgDamage={showcaseAvgDamage}
            hidden={cardHidden}
            statsColumn={statsColumn}
            portraitCredit={portraitCredit}
            backdropCredit={backdropCredit}
            resId={railResId}
            onSequence={editable && railModel.runtime ? setSequence : undefined}
            onEditWeapon={editable && railResId && railModel.runtime ? () => openWpnCnsl(railResId, scenarioId) : undefined}
            team={(
              <TeamBlock
                variant="seal"
                teamSupports={railModel.teamSupports}
                ownerResId={railResId}
                team={railModel.runtime?.build.team ?? null}
                editable={editable}
                scenarioId={scenarioId}
              />
            )}
            onEchoOpen={editable && railResId && railModel.runtime ? onEchoOpen : undefined}
            echoSelection={echoSelection}
            blank={blank}
          />
        ) : null}
        {isShowcase && showcaseBuild && !seal ? (
          <ShowcaseBuild
            echoes={showcaseBuild.echoes}
            combatStatsView={showcaseBuild.combatStatsView}
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
            onEchoOpen={editable && railResId && railModel.runtime ? onEchoOpen : undefined}
            echoSelection={echoSelection}
            blank={blank}
          />
        ) : null}
      </div>

      {isShowcase && !seal && !cardHidden.brand ? (
        <div className="workspace-rail-brand" aria-hidden="true">
          <span className="workspace-brand-word">rendered by</span>
          <Thewuwacalculator className="workspace-brand-mark" />
          <span className="workspace-brand-word">
            thewuwacalculator<span className="workspace-brand-tld">.com</span>
          </span>
        </div>
      ) : null}

      {!seal && credits.length ? (
        <div className="workspace-rail-credit" aria-hidden="true">
          {credits.map((credit) => (
            <span key={credit.tag} className="workspace-credit-line">
              <span className="workspace-credit-tag">{credit.tag}</span>
              <span>{credit.who}</span>
            </span>
          ))}
        </div>
      ) : null}
    </aside>
  )
}

function TeamBlock({
  teamSupports,
  ownerResId,
  team,
  editable,
  scenarioId,
  variant = 'rail',
}: {
  teamSupports: TeamSupport[]
  ownerResId: string | null
  team: ResRuntime['build']['team'] | null
  editable: boolean
  scenarioId?: CombatScenarioId | null
  variant?: 'rail' | 'seal'
}) {
  const scenario = useAppStore((state) => (
    (scenarioId ? state.combat.scenariosById[scenarioId] : null)
    ?? selectedCombatScenario(state.combat)
  ))
  const { setTeam } = useTeamSlots({ scenarioId: scenario.id })
  const picker = useAppModal()
  const { hide: closePicker, show: openPicker } = picker

  const seatable = Boolean(editable && team && scenario.team.members.length < 3)

  const seats = Array.from({ length: 2 }, (_, slotIndex) => {
    const mate = teamSupports[slotIndex]
    const onPick = seatable ? () => openPicker() : undefined
    if (variant === 'seal') {
      return mate
        ? <SealMate key={mate.id} mate={mate} editable={editable} scenarioId={scenario.id} />
        : <SealEmptyMate key={`empty:${slotIndex}`} onPick={onPick} />
    }
    return mate
      ? <TeamMate key={mate.id} mate={mate} editable={editable} scenarioId={scenario.id} />
      : <EmptyTeamMate key={`empty:${slotIndex}`} onPick={onPick} />
  })

  return (
    <div className={variant === 'seal' ? 'seal-party' : 'workspace-rail-block'}>
      {variant === 'seal' ? seats : (
        <>
          <span className="workspace-eyebrow">Team</span>
          <div className="workspace-team">{seats}</div>
        </>
      )}

      {picker.visible && editable && team && ownerResId ? (
        <TeamPicker
          visible={picker.visible}
          open={picker.open}
          closing={picker.closing}
          portalTarget={mainPortal()}
          leadId={scenario.team.members[0].resonatorId}
          team={scenario.team.members.map((member) => member.resonatorId)}
          onClose={closePicker}
          onCommit={(supports) => {
            setTeam(supports)
            closePicker()
          }}
        />
      ) : null}
    </div>
  )
}

function EmptyTeamMate({ onPick }: { onPick?: () => void }) {
  const body = (
    <>
      <span className="workspace-mate-edge" aria-hidden="true" />
      <strong className="workspace-mate-name">No resonator</strong>
      <span className="workspace-mate-meta" aria-hidden="true">
        <span className="workspace-mate-seq">
          {Array.from({ length: 6 }, (_, pip) => (
            <i key={pip} />
          ))}
        </span>
      </span>
      <span className="workspace-mate-kit" aria-hidden="true">
        <span className="workspace-mate-tile workspace-mate-tile--empty" />
      </span>
    </>
  )

  return (
    <article className="workspace-mate workspace-mate--empty">
      {onPick ? (
        <button
          type="button" className="workspace-mate-content"
          aria-label="Add a resonator to this team slot"
          onClick={onPick}
        >
          {body}
        </button>
      ) : (
        <div className="workspace-mate-content">{body}</div>
      )}
    </article>
  )
}

function TeamMate({
  mate,
  editable,
  scenarioId,
}: {
  mate: TeamSupport
  editable: boolean
  scenarioId?: CombatScenarioId | null
}) {
  const body = (
    <>
      <span className="workspace-mate-edge" aria-hidden="true" />
      <strong className="workspace-mate-name">{mate.name}</strong>
      <span className="workspace-mate-meta">
        <span className="workspace-mate-seq" aria-label={`Sequence ${mate.sequence} of 6`}>
          {Array.from({ length: 6 }, (_, pip) => (
            <i key={pip} data-on={pip < mate.sequence ? 'true' : undefined} />
          ))}
        </span>
        <span className="workspace-mate-lv">Lv.<b>{mate.level ?? 1}</b></span>
      </span>
      <span className="workspace-mate-kit">
        <span
          className="workspace-mate-tile" data-kind="weapon"
          title={mate.weaponName ?? undefined}
          style={rarityVars(mate.weaponRarity)}
        >
          {mate.weaponIcon ? (
            <img src={mate.weaponIcon} alt={mate.weaponName ?? 'Weapon'} loading="lazy" onError={withDefIconM} />
          ) : null}
          {mate.weaponRank != null ? <b>R{mate.weaponRank}</b> : null}
        </span>
        {mate.sets.slice(0, 2).map((set, index) => (
          set.icon ? (
            <span key={set.id ?? set.setId ?? index} className="workspace-mate-tile" data-kind="set" title={set.name}>
              <img src={set.icon} alt={set.name} loading="lazy" onError={withDefIconM} />
              <b>{set.count ?? set.pieces}</b>
            </span>
          ) : null
        ))}
      </span>
    </>
  )

  return (
    <article className="workspace-mate"
      data-rarity={mate.rarity}
      style={{ '--browser-accent': mate.accent, '--mate-rar': getRarityColor(mate.rarity) } as CssVars}
    >
      <span className="workspace-mate-frame" aria-hidden="true">
        <img
          src={mate.sprite}
          alt="" className="workspace-mate-portrait"
          style={mate.spriteCss}
          loading="lazy"
          decoding="async"
          onError={withDefIconM}
        />
      </span>
      {editable ? (
        <button
          type="button" className="workspace-mate-content"
          aria-label={`Configure ${mate.name}, ${mate.rarity}-star`}
          onClick={() => openTeamCnsl(mate.id, 'loadout', scenarioId)}
        >
          {body}
        </button>
      ) : (
        <div className="workspace-mate-content">{body}</div>
      )}
    </article>
  )
}

function SealMate({
  mate,
  editable,
  scenarioId,
}: {
  mate: TeamSupport
  editable: boolean
  scenarioId?: CombatScenarioId | null
}) {
  const attrIcon = getAttributeIconSrc(mate.attribute)
  const set = mate.sets[0] ?? null
  const body = (
    <>
      <span className="seal-mate-art">
        <img src={mate.sprite} alt="" style={mate.spriteCss} decoding="async" onError={withDefIconM} />
      </span>
      <i className="seal-spark seal-mate-mark" aria-hidden="true" />
      {attrIcon ? <img className="seal-mate-elem" src={attrIcon} alt="" onError={withDefIconM} /> : null}
      <span className="seal-mate-weapon" style={rarityVars(mate.weaponRarity)}>
        {mate.weaponIcon ? (
          <img src={mate.weaponIcon} alt={mate.weaponName ?? 'Weapon'} onError={withDefIconM} />
        ) : null}
        {mate.weaponRank != null ? <b>R{mate.weaponRank}</b> : null}
      </span>
      {set?.icon ? (
        <span className="seal-mate-set" title={set.name}>
          <img src={set.icon} alt={set.name} onError={withDefIconM} />
          <b>{set.count ?? set.pieces}</b>
        </span>
      ) : null}
      <span className="seal-mate-rule" aria-hidden="true"><i /><i /></span>
      <span className="seal-mate-lv">Lv.<b>{mate.level ?? 1}</b></span>
      <span className="seal-stars-row" aria-label={`Sequence ${mate.sequence} of 6`}>
        {Array.from({ length: 6 }, (_, node) => (
          <i key={node} className="seal-spark" data-on={node < mate.sequence ? 'true' : undefined} />
        ))}
      </span>
      <strong className="seal-mate-name" data-fit="9">{mate.name}</strong>
    </>
  )

  return (
    <article
      className="seal-mate"
      style={{ '--mate-tint': mate.accent, ...rarityVars(mate.rarity) } as CssVars}
    >
      {editable ? (
        <button
          type="button" className="seal-mate-content"
          aria-label={`Configure ${mate.name}`}
          onClick={() => openTeamCnsl(mate.id, 'loadout', scenarioId)}
        >
          {body}
        </button>
      ) : (
        <div className="seal-mate-content">{body}</div>
      )}
    </article>
  )
}

function SealEmptyMate({ onPick }: { onPick?: () => void }) {
  const body = (
    <>
      <span className="seal-mate-art seal-mate-art--empty" aria-hidden="true" />
      <span className="seal-mate-rule" aria-hidden="true"><i /><i /></span>
      <strong className="seal-mate-name">Empty</strong>
    </>
  )

  return (
    <article className="seal-mate seal-mate--empty">
      {onPick ? (
        <button
          type="button" className="seal-mate-content"
          aria-label="Add a resonator to this team slot"
          onClick={onPick}
        >
          {body}
        </button>
      ) : (
        <div className="seal-mate-content">{body}</div>
      )}
    </article>
  )
}

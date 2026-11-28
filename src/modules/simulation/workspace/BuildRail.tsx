/*
  Author: Runor Ewhro
  description: projects a runtime into the shared build rail and coordinates
               stat-family focus, sequence changes, and scenario member edits.
*/

import { DisplayImage } from '@/shared/ui/DisplayImage'
import { ContextTrigger } from '@/application/context-menu/ContextTrigger'
import { Images, Pause, Play, Sword, UserRound } from 'lucide-react'
import { flushSync } from 'react-dom'
import { memo, useCallback, useMemo, type CSSProperties, type MouseEvent as ReactMouseEvent, type RefObject } from 'react'
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
import { StatGlyph, EvaluationSeqRail, ResonatorName, statFamily, type EvaluationEchoSelection, type CssVars } from '@/modules/simulation/workspace/ui.tsx'
import { ShowcaseBuild } from '@/modules/simulation/surfaces/showcase/Showcase.tsx'
import { DetailedCard, rarityVars } from '@/modules/simulation/surfaces/showcase/DetailedCard.tsx'
import { getRarityColor } from '@/modules/simulation/model/display.ts'
import { useShowcaseImageContrast } from '@/modules/simulation/surfaces/showcase/showcaseImageContrast.ts'
import Thewuwacalculator from '@/assets/thewuwacalculator.svg?react'
import { truncTo } from '@/shared/lib/number'

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

// stat families cross separate subtrees, so one delegated root updates their dom classes without transient react
// state
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

const RAIL_OWN_CONTROLS = 'button, a, input, select, textarea, label, [role="button"], [role="radio"], [role="switch"], [role="menuitem"]'

export const BuildRail = memo(function BuildRail({
  buildCardRef,
  onPortraitReady,
  capturePortrait,
  captureBackdrop,
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
  showcasePlacement,
  score,
  grade,
  tone,
  showcaseBuild,
  showcaseAvgDamage,
  onEchoOpen,
  echoSelection,
  blank,
  holder,
  autoImageContrast,
  layout = 'classic',
}: {
  capturePortrait?: string
  captureBackdrop?: string
  onPortraitReady?: (source: string) => void
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
  showcasePlacement: SpinePlacement
  score: number | null
  grade: string | null
  tone: string
  showcaseBuild: ShowcaseBuildModel | null
  showcaseAvgDamage: number | null
  onEchoOpen?: (slotIndex: number) => void
  echoSelection?: EvaluationEchoSelection
  blank?: boolean
  holder?: { name: string | null; uid: string | null }
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
  // layout preference is showcase-only; shared workspace rails stay classic
  const detailed = isShowcase && layout === 'seal'
  const contrastWatchKey = `${railResId ?? ''}:${JSON.stringify(backdropStyle)}:${railStyle['--bg']}:${layout}:${customCss ?? ''}`
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
  // activating the current sequence node steps back one; another node selects its prefix
  const setSequence = useCallback((node: number) => {
    if (!editable || !railResId) return
    const update = onRuntimeUpdate ?? updResRt
    update(railResId, (prev) => setResRtSequence(
      prev,
      getResDtlsBy()[prev.id],
      prev.base.sequence === node ? node - 1 : node,
    ))
  }, [editable, onRuntimeUpdate, railResId, updResRt])

  const editWeapon = useCallback(() => { if (railResId) openWpnCnsl(railResId, scenarioId) }, [railResId, scenarioId])
  const openMember = useCallback(() => { if (railResId) openTeamCnsl(railResId, 'loadout', scenarioId) }, [railResId, scenarioId])
  const canOpenMember = editable && !!railResId && !!railModel.runtime
  const railOpensMember = !isShowcase && canOpenMember
  const openMemberFromRail = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest(RAIL_OWN_CONTROLS)) return
    openMember()
  }, [openMember])
  const detailedTeam = useMemo(() => <TeamBlock variant="detailed" teamSupports={railModel.teamSupports}
    ownerResId={railResId} team={railModel.runtime?.build.team ?? null} editable={editable} scenarioId={scenarioId} />,
  [editable, railModel.runtime?.build.team, railModel.teamSupports, railResId, scenarioId])
  const weaponBlock = (
    <>
      <span className="wk-weapon-frame" data-rarity={railModel.weaponRarity ?? undefined}>
        {railModel.weaponIcon ? (
          <DisplayImage
            src={railModel.weaponIcon}
            alt={railModel.weaponName} className="wk-weapon-icon"
            loading="lazy"
            decoding="async"
            onError={withDefIconM}
          />
        ) : (
          <span className="wk-weapon-icon wk-weapon-icon--fallback">W</span>
        )}
      </span>
      <span className="wk-weapon-copy">
        <span className="wk-weapon-head">
                          <span className="wk-weapon-meta">
            <span className="wk-weapon-lv">Lv.{railModel.weaponState?.level ?? 1} • R{railModel.weaponState?.rank ?? 1}</span>
          </span>
          <strong className="wk-weapon-name">{railModel.weaponName}</strong>
        </span>
        <span className="wk-weapon-stat">
          {railModel.weapon ? (
            <>
              <span className="wk-weapon-stat-item" data-stat-family={statFamily('atk')}>
                <StatGlyph statKey="atk" size={1.25} />
                <span className="wk-weapon-stat-figure">
                  <span className="wk-weapon-stat-value">{truncTo(weaponStats?.atk ?? railModel.weapon.baseAtk)}</span>
                  <span className="wk-weapon-stat-label">Base ATK</span>
                </span>
              </span>
              <span className="wk-weapon-stat-item" data-stat-family={statFamily(railModel.weapon.statKey)}>
                <StatGlyph statKey={railModel.weapon.statKey} size={1.25} />
                <span className="wk-weapon-stat-figure">
                  <span className="wk-weapon-stat-value">
                    {formatStatKeyValue(railModel.weapon.statKey, weaponStats?.statVal ?? railModel.weapon.statValue)}
                  </span>
                  <span className="wk-weapon-stat-label">{formatStatKeyLabel(railModel.weapon.statKey)}</span>
                </span>
              </span>
            </>
          ) : (
            <span className="wk-weapon-stat--empty">No bonus stat</span>
          )}
        </span>
      </span>
    </>
  )

  return (
    <ContextTrigger
      asChild
      ariaLabel="Build rail actions"
      items={isShowcase || !editable || !railResId ? [] : [
        { id: 'rail:member', label: 'Configure resonator', icon: <UserRound size="1em" />, onSelect: openMember },
        { id: 'rail:weapon', label: 'Configure weapon', icon: <Sword size="1em" />, onSelect: editWeapon },
        ...(onEchoOpen ? [{ id: 'rail:main-echo', label: 'Edit main Echo', icon: <Images size="1em" />, onSelect: () => onEchoOpen(0) }] : []),
        ...(onAnimatedPortraitsChange ? [{
          id: 'rail:animation', label: animatedPortraits ? 'Pause portrait' : 'Play portrait',
          icon: animatedPortraits ? <Pause size="1em" /> : <Play size="1em" />,
          onSelect: () => onAnimatedPortraitsChange(!animatedPortraits),
        }] : []),
      ]}
    >
    <aside
      ref={buildCardRef} className="wk-rail wk-card"
      data-phase={railPhase}
      data-layout={detailed ? 'detailed' : undefined}
      data-edit={isShowcase ? editMode ?? undefined : undefined}
      data-opens-member={railOpensMember ? 'true' : undefined}
      style={resolvedRailStyle}
      onClick={railOpensMember ? openMemberFromRail : undefined}
      onMouseOver={isShowcase ? handleStatFocusOver : undefined}
      onMouseLeave={isShowcase ? (event) => applyStatFocus(event.currentTarget, '') : undefined}
    >
      {isShowcase && customCss ? <style>{customCss}</style> : null}
      <SpineSetupBackground
        resId={railResId}
        fallbackUrl={railModel.portraitSrc} className="wk-portrait-bg"
        style={backdropStyle}
        captureUrl={captureBackdrop}
      />

      {onAnimatedPortraitsChange ? (
        <>
          <span className="wk-portrait-scrim" aria-hidden="true" />
          <span className="wk-portrait-cue" aria-hidden="true">
            <span className={`wk-cue-glyph${animatedPortraits ? '' : ' is-paused'}`}>
              <i className="wk-cue-bar wk-cue-bar--a" />
              <i className="wk-cue-bar wk-cue-bar--b" />
            </span>
            <span className="wk-cue-word">{animatedPortraits ? 'Pause' : 'Play'}</span>
          </span>
        </>
      ) : null}
      <div className="wk-rail-port">
        <div className="wk-portrait-figure"
          data-switch={onAnimatedPortraitsChange ? 'true' : undefined}
          role={onAnimatedPortraitsChange ? 'switch' : undefined}
          aria-checked={onAnimatedPortraitsChange ? animatedPortraits : undefined}
          aria-label={onAnimatedPortraitsChange ? 'Animated portrait' : undefined}
          tabIndex={onAnimatedPortraitsChange ? 0 : undefined}
          onClick={onAnimatedPortraitsChange ? (event) => {
            // nested controls activate independently of playback
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
            onImageReady={onPortraitReady}
            animated={animatedPortraits}
            playing={railPhase === 'idle'}
            spineClassName="wk-portrait-spine"
            placement={showcasePlacement}
            overrideImageUrl={resolvedPortrait}
            captureImageUrl={capturePortrait}
            fallback={
              <DisplayImage src={railModel.portraitSrc}
                onLoad={() => onPortraitReady?.(railModel.portraitSrc)}
                fetchPriority="high"
                alt={railModel.seed?.name ?? 'Resonator'} className="wk-portrait-img"
                style={railModel.spriteCss}
                loading="eager"
                decoding="async"
                onError={withDefIconM}
              />
            }
          />
          {grade && !detailed ? (
            <span className="wk-portrait-grade" data-score={Math.floor(score ?? 0)} style={{ '--grade': tone } as CssVars}>
              {grade}
            </span>
          ) : null}
          {railResId && !detailed ? (
            <EvaluationSeqRail
              resId={railResId}
              sequence={railModel.runtime?.base.sequence ?? 0}
              hidden={seqRailHidden}
              onActivate={editable && railModel.runtime ? setSequence : undefined}
            />
          ) : null}
        </div>

        {!detailed ? (
          <div className="wk-rail-body">
            <div className="wk-portrait-meta" data-rarity={railModel.rarity}>
              <span className="wk-portrait-name"> {railModel.attrIcon ? (
                <DisplayImage
                  src={railModel.attrIcon}
                  alt="" className="wk-portrait-elem"
                  loading="lazy"
                  decoding="async"
                  onError={withDefIconM}
                />
              ) : null} <ResonatorName name={railModel.seed?.name ?? 'Resonator'} onOpen={canOpenMember ? openMember : undefined} /></span>
              <div className="wk-portrait-tags">
                <span className="wk-rarity" role="img" aria-label={`${railModel.rarity}-star resonator`}>
                  {Array.from({ length: railModel.rarity }, (_, star) => (
                    <i key={star} className="wk-rarity-star" aria-hidden="true" />
                  ))}
                </span>
                <span className="wk-portrait-lv">LV {railModel.runtime?.base.level ?? 1}</span>
              </div>
            </div>

            {editable && railResId && railModel.runtime ? (
              <button
                type="button" className="wk-weapon"
                aria-label={`Edit ${railModel.weaponName}`}
                onClick={() => openWpnCnsl(railResId, scenarioId)}
              >
                {weaponBlock}
              </button>
            ) : (
              <div className="wk-weapon">{weaponBlock}</div>
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

      <div className="wk-rail-build"
        {...(isShowcase ? echoSelection?.surfaceProps : undefined)}
      >
        {isShowcase && showcaseBuild && detailed ? (
          <DetailedCard
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
            onEditWeapon={editable && railResId && railModel.runtime ? editWeapon : undefined}
            onOpenMember={canOpenMember ? openMember : undefined}
            team={detailedTeam}
            onEchoOpen={editable && railResId && railModel.runtime ? onEchoOpen : undefined}
            echoSelection={echoSelection}
            blank={blank}
            holder={holder}
          />
        ) : null}
        {isShowcase && showcaseBuild && !detailed ? (
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

      {isShowcase && !detailed && !cardHidden.brand ? (
        <div className="wk-rail-brand" aria-hidden="true">
          <span className="wk-brand-word">rendered by</span>
          <Thewuwacalculator className="wk-brand-mark" />
          <span className="wk-brand-word">
            thewuwacalculator<span className="wk-brand-tld">.com</span>
          </span>
        </div>
      ) : null}

      {!detailed && credits.length ? (
        <div className="wk-rail-credit" aria-hidden="true">
          {credits.map((credit) => (
            <span key={credit.tag} className="wk-credit-line">
              <span className="wk-credit-tag">{credit.tag}</span>
              <span>{credit.who}</span>
            </span>
          ))}
        </div>
      ) : null}
    </aside>
    </ContextTrigger>
  )
})

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
  variant?: 'rail' | 'detailed'
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
    if (variant === 'detailed') {
      return mate
        ? <Teammate key={mate.id} mate={mate} editable={editable} scenarioId={scenario.id} />
        : <EmptyTeammate key={`empty:${slotIndex}`} onPick={onPick} />
    }
    return mate
      ? <TeamMate key={mate.id} mate={mate} editable={editable} scenarioId={scenario.id} />
      : <EmptyTeamMate key={`empty:${slotIndex}`} onPick={onPick} />
  })

  return (
    <div className={variant === 'detailed' ? 'showcase-detail-team' : 'wk-rail-block'}>
      {variant === 'detailed' ? seats : (
        <>
          <span className="wk-eyebrow">Team</span>
          <div className="wk-team">{seats}</div>
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
            // the store write renders synchronously, so commit the closing phase first, before the new team remounts
            // an open picker
            flushSync(() => closePicker())
            setTeam(supports)
          }}
        />
      ) : null}
    </div>
  )
}

function EmptyTeamMate({ onPick }: { onPick?: () => void }) {
  const body = (
    <>
      <strong className="wk-mate-name">No resonator</strong>
      <span className="wk-mate-meta" aria-hidden="true">
        <span className="wk-mate-seq">
          {Array.from({ length: 6 }, (_, pip) => (
            <i key={pip} />
          ))}
        </span>
      </span>
      <span className="wk-mate-kit" aria-hidden="true">
        <span className="wk-mate-tile wk-mate-tile--empty" />
      </span>
    </>
  )

  return (
    <article className="wk-mate wk-mate--empty">
      {onPick ? (
        <button
          type="button" className="wk-mate-content"
          aria-label="Add a resonator to this team slot"
          onClick={onPick}
        >
          {body}
        </button>
      ) : (
        <div className="wk-mate-content">{body}</div>
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
  const Tile = editable ? 'button' : 'span'
  const mateSets = mate.sets.filter((set) => set.icon).slice(0, 3)
  const body = (
    <>
      <strong className="wk-mate-name">{mate.name}</strong>
      <span className="wk-mate-meta">
        <span className="wk-mate-seq" aria-label={`Sequence ${mate.sequence} of 6`}>
          {Array.from({ length: 6 }, (_, pip) => (
            <i key={pip} data-on={pip < mate.sequence ? 'true' : undefined} />
          ))}
        </span>
        <span className="wk-mate-lv">Lv.<b>{mate.level ?? 1}</b></span>
      </span>
    </>
  )

  return (
    <ContextTrigger asChild ariaLabel={`${mate.name} teammate actions`} items={editable ? [
      { id: `rail:mate:${mate.id}:configure`, label: 'Configure teammate', icon: <UserRound size="1em" />, onSelect: () => openTeamCnsl(mate.id, 'loadout', scenarioId) },
      { id: `rail:mate:${mate.id}:weapon`, label: 'Configure weapon', icon: <Sword size="1em" />, onSelect: () => openWpnCnsl(mate.id, scenarioId) },
      { id: `rail:mate:${mate.id}:echoes`, label: 'Configure Echoes', icon: <Images size="1em" />, onSelect: () => openTeamCnsl(mate.id, 'echoes', scenarioId) },
    ] : []}>
    <article className="wk-mate"
      data-rarity={mate.rarity}
      style={{ '--browser-accent': mate.accent, '--mate-rar': getRarityColor(mate.rarity) } as CssVars}
    >
      <span className="wk-mate-frame" aria-hidden="true">
        <DisplayImage src={mate.sprite}
          alt="" className="wk-mate-portrait"
          style={mate.spriteCss}
          loading="lazy"
          decoding="async"
          onError={withDefIconM}
        />
      </span>
      {editable ? (
        <button
          type="button" className="wk-mate-content"
          aria-label={`Configure ${mate.name}, ${mate.rarity}-star`}
          onClick={() => openTeamCnsl(mate.id, 'loadout', scenarioId)}
        >
          {body}
        </button>
      ) : (
        <div className="wk-mate-content">{body}</div>
      )}
      <span className="wk-mate-kit">
        <span className="wk-mate-kit-row" data-row="weapon">
          <Tile
            type={editable ? 'button' : undefined}
            className="wk-mate-tile" data-kind="weapon"
            aria-label={editable ? `Configure ${mate.name}'s weapon: ${mate.weaponName ?? 'Weapon'}` : undefined}
            onClick={editable ? () => openWpnCnsl(mate.id, scenarioId) : undefined}
            title={mate.weaponName ?? undefined}
            style={rarityVars(mate.weaponRarity)}
          >
            {mate.weaponIcon ? (
              <DisplayImage src={mate.weaponIcon} alt={mate.weaponName ?? 'Weapon'} loading="lazy" onError={withDefIconM} />
            ) : null}
            {mate.weaponRank != null ? <b>R{mate.weaponRank}</b> : null}
          </Tile>
        </span>
        {mateSets.length ? (
          <span className="wk-mate-kit-row" data-row="sonata">
            {mateSets.map((set, index) => (
              <Tile
                key={set.id ?? set.setId ?? index}
                type={editable ? 'button' : undefined}
                className="wk-mate-tile" data-kind="set" title={`${set.name} · ${set.count ?? set.pieces}pc`}
                aria-label={editable ? `Configure ${mate.name}'s Echoes: ${set.name}` : undefined}
                onClick={editable ? () => openTeamCnsl(mate.id, 'echoes', scenarioId) : undefined}
              >
                <DisplayImage src={set.icon ?? ''} alt={set.name} loading="lazy" onError={withDefIconM} />
                <b>{set.count ?? set.pieces}</b>
              </Tile>
            ))}
          </span>
        ) : null}
      </span>
    </article>
    </ContextTrigger>
  )
}

function Teammate({
  mate,
  editable,
  scenarioId,
}: {
  mate: TeamSupport
  editable: boolean
  scenarioId?: CombatScenarioId | null
}) {
  const attrIcon = getAttributeIconSrc(mate.attribute)
  const setRows = mate.sets
    .filter((entry) => entry.icon)
    .slice(0, 3)
    .reduce<Array<{ pieces: number, sets: SonataToken[] }>>((rows, set) => {
      const pieces = set.count ?? set.pieces ?? 0
      const row = rows.find((entry) => entry.pieces === pieces)
      if (row) row.sets.push(set)
      else rows.push({ pieces, sets: [set] })
      return rows
    }, [])
  const body = (
    <>
      <span className="showcase-detail-mate-art">
        <DisplayImage src={mate.sprite} alt="" style={mate.spriteCss} decoding="async" onError={withDefIconM} />
      </span>
      <i className="showcase-detail-star showcase-detail-mate-mark" aria-hidden="true" />
      {attrIcon ? <DisplayImage className="showcase-detail-mate-elem" src={attrIcon} alt="" onError={withDefIconM} /> : null}
      <span className="showcase-detail-mate-weapon" style={rarityVars(mate.weaponRarity)}>
        {mate.weaponIcon ? (
          <DisplayImage src={mate.weaponIcon} alt={mate.weaponName ?? 'Weapon'} onError={withDefIconM} />
        ) : null}
        {mate.weaponRank != null ? <b>R{mate.weaponRank}</b> : null}
      </span>
      {setRows.length ? (
        <span className="showcase-detail-mate-sets">
          {setRows.map((row) => (
            <span
              key={row.pieces}
              className="showcase-detail-mate-set"
              title={`${row.sets.map((set) => set.name).join(' + ')} · ${row.pieces}pc`}
            >
              {row.sets.map((set, index) => (
                <DisplayImage
                  key={set.id ?? set.setId ?? index}
                  src={set.icon ?? ''} alt={set.name}
                  onError={withDefIconM}
                />
              ))}
              <b>{row.pieces}</b>
            </span>
          ))}
        </span>
      ) : null}
      <span className="showcase-detail-mate-rule" aria-hidden="true"><i /><i /></span>
      <span className="showcase-detail-mate-lv">Lv.<b>{mate.level ?? 1}</b></span>
      <span className="showcase-detail-stars-row" aria-label={`Sequence ${mate.sequence} of 6`}>
        {Array.from({ length: 6 }, (_, node) => (
          <i key={node} className="showcase-detail-star" data-on={node < mate.sequence ? 'true' : undefined} />
        ))}
      </span>
      <strong className="showcase-detail-mate-name" data-fit="9">{mate.name}</strong>
    </>
  )

  return (
    <article
      className="showcase-detail-mate"
      style={{ '--mate-tint': mate.accent, ...rarityVars(mate.rarity) } as CssVars}
    >
      {editable ? (
        <button
          type="button" className="showcase-detail-mate-content"
          aria-label={`Configure ${mate.name}`}
          onClick={() => openTeamCnsl(mate.id, 'loadout', scenarioId)}
        >
          {body}
        </button>
      ) : (
        <div className="showcase-detail-mate-content">{body}</div>
      )}
    </article>
  )
}

function EmptyTeammate({ onPick }: { onPick?: () => void }) {
  const body = (
    <>
      <span className="showcase-detail-mate-art showcase-detail-mate-art--empty" aria-hidden="true" />
      <span className="showcase-detail-mate-rule" aria-hidden="true"><i /><i /></span>
      <strong className="showcase-detail-mate-name">Empty</strong>
    </>
  )

  return (
    <article className="showcase-detail-mate showcase-detail-mate--empty">
      {onPick ? (
        <button
          type="button" className="showcase-detail-mate-content"
          aria-label="Add a resonator to this team slot"
          onClick={onPick}
        >
          {body}
        </button>
      ) : (
        <div className="showcase-detail-mate-content">{body}</div>
      )}
    </article>
  )
}

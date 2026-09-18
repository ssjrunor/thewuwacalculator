/*
  Author: Runor Ewhro
  Description: The step and state palette, driven by the live team rather than
               a fixture. Features group by talent node, conditions reuse the
               condition browser's grouping so both surfaces agree.
*/

import { useCallback, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, Crosshair, Repeat, Search, Sparkles } from 'lucide-react'
import { Expandable } from '@/shared/ui/Expandable.tsx'
import { RichDscr } from '@/shared/ui/RichDescription.tsx'
import { formatDescription } from '@/shared/lib/formatDescription.ts'
import { ContextTrigger } from '@/shared/ui/CtxTrigger.tsx'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import { useAppStore } from '@/domain/state/store.ts'
import type { ResRuntime } from '@/domain/entities/runtime.ts'
import { selEnemyProf, selWorkDrvd } from '@/domain/state/selectors.ts'
import { isSkllVsbl, resolveSkill } from '@/engine/pipeline/resolveSkill.ts'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay.ts'
import { getEchoById } from '@/domain/services/echoCatalogService.ts'
import { withDefEchoMg, withDefIconM, withDefResMg } from '@/shared/lib/imageFallback.ts'
import {
  buildGhostPill,
  KIND_MIME,
  PALETTE_MIME,
} from '@/modules/simulation/features/rotation/program-editor/interaction/dragPayload.ts'
import type { PaletteSpec } from '@/modules/simulation/features/rotation/program-editor/model/paletteSpec.ts'
import { getEnemyIcon } from '@/domain/entities/enemy.ts'
import {
  ROT_SKILL_TABS,
  SKILL_TAB_NAMES,
  type SkillTabKey,
} from '@/modules/simulation/model/skillTabs.ts'
import {
  makeConditionChoices,
  visibleRotMembers,
} from '@/modules/simulation/features/rotation/shared/catalog.ts'
import {
  COND_KIND_META,
  getBrowserChoiceLabel,
  getCondOwnerKey,
  getCondOwnerLabel,
  groupCondChoices,
  type CondKind,
} from '@/modules/simulation/features/rotation/program-editor/components/ConditionBrowser.tsx'
import { isFormulaChoice } from '@/modules/simulation/features/rotation/shared/conditions.tsx'
import type { CondChoice, RotationMember } from '@/modules/simulation/features/rotation/shared/authoringTypes.ts'
import type { FeatDef } from '@/domain/gameData/contracts.ts'
import type { AttributeKey, SkillAggType, SkillDef } from '@/domain/entities/stats.ts'
import { skillDisplayColor } from '@/modules/simulation/features/rotation/shared/skillDisplay.ts'

type PaletteMode = 'features' | 'conditions'

export interface PaletteFeature {
  featureId: string
  resonatorId: string
  resName: string
  art: string
  echoId?: string
  label: string
  tab: SkillTabKey
  element: AttributeKey
  color: string
  aggregationType: SkillAggType
  /** the skill's own hit rows, when it breaks into them. a hit has none. */
  subHits: PaletteFeature[]
}

interface FeatureGroup {
  tab: SkillTabKey
  label: string
  entries: PaletteFeature[]
}

interface OwnerTab {
  id: string
  label: string
  profile?: string
  /** enemy art is served from a different asset tree, so it falls back apart */
  isEnemy?: boolean
}

function paletteAccent(color?: string): CSSProperties {
  return {
    '--rte-res': color ?? 'var(--muted)',
  } as CSSProperties
}

function featureArt(member: RotationMember, feature: FeatDef): Pick<PaletteFeature, 'art' | 'echoId'> {
  const echoId = feature.source.type === 'echo' ? feature.source.id : undefined
  const echo = echoId ? getEchoById(echoId) : null
  return {
    art: echo?.icon ?? (echoId ? `/assets/game/echoes/icons/${echoId}.webp` : member.profile),
    echoId,
  }
}

// one visible, resolved feature per skill, with the skill's hit rows hung
// underneath it the way the skill menu lists them: a sub-hit is a detail of a
// step, so it is reached through the step rather than beside it.
function collectFeatures(
  member: RotationMember,
  runtimesById: Record<string, ResRuntime>,
): PaletteFeature[] {
  const resolved = new Map<string, SkillDef>()
  for (const skill of member.skills) {
    resolved.set(skill.id, resolveSkill(member.runtime, skill, undefined, runtimesById))
  }

  const hitsBySkill = new Map<string, FeatDef[]>()
  for (const feature of member.features as FeatDef[]) {
    if (feature.variant !== 'subHit') {
      continue
    }
    const list = hitsBySkill.get(feature.skillId)
    if (list) list.push(feature)
    else hitsBySkill.set(feature.skillId, [feature])
  }
  for (const list of hitsBySkill.values()) {
    list.sort((left, right) => (left.hitIndex ?? 0) - (right.hitIndex ?? 0))
  }

  const owner = { resonatorId: member.id, resName: member.name }
  const out: PaletteFeature[] = []
  const claimed = new Set<string>()

  for (const feature of member.features as FeatDef[]) {
    if (feature.variant === 'subHit') {
      continue
    }

    const skill = resolved.get(feature.skillId)
    if (!skill || !isSkllVsbl(member.runtime, skill, undefined, runtimesById)) {
      continue
    }

    const tab = (skill.tab ?? 'normalAttack') as SkillTabKey
    const color = skillDisplayColor(skill, member.attribute)
    // only the first tile for a skill carries its hits, so a skill listing
    // more than one total does not repeat them
    const hits = claimed.has(feature.skillId) ? [] : hitsBySkill.get(feature.skillId) ?? []
    claimed.add(feature.skillId)

    out.push({
      ...owner,
      ...featureArt(member, feature),
      featureId: feature.id,
      label: skill.label ?? feature.label,
      tab,
      element: skill.element,
      color,
      aggregationType: skill.aggregationType,
      subHits: hits.map((hit) => ({
        ...owner,
        ...featureArt(member, hit),
        featureId: hit.id,
        label: hit.label,
        tab,
        element: skill.element,
        color,
        aggregationType: skill.aggregationType,
        subHits: [],
      })),
    })
  }

  // a skill that only ever lists its hits has no total to fold them under, so
  // those hits stand as tiles in their own right
  for (const [skillId, hits] of hitsBySkill) {
    if (claimed.has(skillId)) {
      continue
    }

    const skill = resolved.get(skillId)
    if (!skill || !isSkllVsbl(member.runtime, skill, undefined, runtimesById)) {
      continue
    }

    for (const hit of hits) {
      out.push({
        ...owner,
        ...featureArt(member, hit),
        featureId: hit.id,
        label: hit.label,
        tab: (skill.tab ?? 'normalAttack') as SkillTabKey,
        element: skill.element,
        color: skillDisplayColor(skill, member.attribute),
        aggregationType: skill.aggregationType,
        subHits: [],
      })
    }
  }

  return out
}

// a tile is picked up the same way a node is; the payload is unreadable until
// drop, so the kind travels as a bare type for dragover to check
function tileDrag(spec: PaletteSpec, art?: string) {
  return {
    draggable: true,
    onDragStart: (event: React.DragEvent) => {
      event.dataTransfer.effectAllowed = 'copy'
      event.dataTransfer.setData(PALETTE_MIME, JSON.stringify(spec))
      // the kind again as a bare type, because only types are readable while
      // the drag is in the air and some branches take conditions only
      event.dataTransfer.setData(KIND_MIME[spec.kind], '')
      // firefox refuses to start a drag without a text payload
      event.dataTransfer.setData('text/plain', spec.label)

      const host = event.currentTarget.closest('.rte-page')
      const pill = host ? buildGhostPill({ art, label: spec.label }, host) : null
      if (pill) {
        event.dataTransfer.setDragImage(pill, 14, pill.offsetHeight / 2)
        requestAnimationFrame(() => pill.remove())
      }
    },
  }
}

/*
  one tile, whether it is the skill's own step or one of its hits. a hit trades
  the portrait for its place in the sequence, since the face beside it would be
  the same face repeated down the fold.
*/
function featTile(
  entry: PaletteFeature,
  onAdd: (entry: PaletteFeature) => void,
  pickMenu: (label: string, add: () => void) => MenuEntry[],
  hitIndex?: number,
) {
  return (
    <ContextTrigger
      key={`${entry.resonatorId}:${entry.featureId}`}
      asChild
      ariaLabel={`${entry.label} palette actions`}
      getItems={() => pickMenu(entry.label, () => onAdd(entry))}
    >
    <button
      type="button"
      className={hitIndex == null ? 'rte-tile' : 'rte-tile rte-tile--hit'}
      style={paletteAccent(entry.color)}
      title={`${entry.resName} . ${entry.label}`}
      onClick={(event) => {
        // a tile inside a fold sits on the fold's trigger, and a press on it
        // is for the step it names, never for the fold
        event.stopPropagation()
        onAdd(entry)
      }}
      {...tileDrag({
        kind: 'step',
        label: entry.label,
        featureId: entry.featureId,
        resonatorId: entry.resonatorId,
        tab: entry.tab,
        color: entry.color,
        aggregationType: entry.aggregationType,
        echoId: entry.echoId,
      }, entry.art)}
    >
      {hitIndex == null ? (
        <img className="rte-tile__art"
          src={entry.art}
          alt=""
          onError={entry.echoId ? withDefEchoMg : withDefResMg}
          loading="lazy"
        />
      ) : (
        <span className="rte-tile__seq" aria-hidden="true">{hitIndex}</span>
      )}
      <span className="rte-tile__label">{entry.label}</span>
    </button>
    </ContextTrigger>
  )
}

// Extract bounded context around the first case-insensitive description match.
function mkSnippet(text: string, needle: string) {
  const at = text.toLowerCase().indexOf(needle)
  if (at < 0) {
    return null
  }

  const from = Math.max(0, at - 30)
  const to = Math.min(text.length, at + needle.length + 46)

  return (
    <p className="rte-snip">
      {from > 0 ? '\u2026' : ''}
      {text.slice(from, at)}
      <mark>{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length, to)}
      {to < text.length ? '\u2026' : ''}
    </p>
  )
}

/*
  What a state's own text says, read in the palette rather than after adding it.
  The text is not hung on a hover here: the row turns over on its mark and stays
  turned, because this is the surface where the choice is still being made and
  two states have to be able to stand open against each other.
*/
function CondTile({
  choice,
  accent,
  text,
  needle,
  turned,
  onTurn,
  onAdd,
  pickMenu,
}: {
  choice: CondChoice
  accent?: string
  /** the description as plain text, which is what a search reads */
  text?: string
  /** set only when the needle was found in the text and not in any name */
  needle?: string
  turned: boolean
  onTurn: () => void
  onAdd: (choice: CondChoice) => void
  pickMenu: (label: string, add: () => void) => MenuEntry[]
}) {
  const label = getBrowserChoiceLabel(choice)
  const meta = COND_KIND_META[choice.state.kind as CondKind]
  const KindIcon = meta?.Icon
  const keyed = Boolean(choice.description)
  const snip = needle && text ? mkSnippet(text, needle) : null

  const tile = (
    <ContextTrigger
      asChild
      ariaLabel={`${label} palette actions`}
      getItems={() => pickMenu(label, () => onAdd(choice))}
    >
    <button
      type="button"
      className={`rte-tile${keyed ? ' is-keyed' : ''}`}
      title={`${meta?.label ?? 'State'} . ${label}`}
      onClick={() => onAdd(choice)}
      {...tileDrag({
        kind: 'condition',
        label,
        choiceId: choice.id,
      })}
    >
      <span className="rte-tile__glyph" aria-hidden="true">
        {KindIcon ? <KindIcon size="0.8rem" /> : null}
      </span>
      <span className="rte-tile__label">{label}</span>
    </button>
    </ContextTrigger>
  )

  if (!keyed) {
    return (
      <div className="rte-crow" style={paletteAccent(accent)}>
        {tile}
        {snip}
      </div>
    )
  }

  return (
    <div
      className={`rte-crow has-mark${turned ? ' is-turned' : ''}`}
      style={paletteAccent(accent)}
    >
      <div className="rte-turn">
        <div className="rte-turn__inner">
          <div className="rte-turn__face rte-turn__front">{tile}</div>
          <div className="rte-turn__face rte-turn__back">
            <span className="rte-turn__src">{choice.sourceName}</span>
            <RichDscr className="rte-turn__text"
              description={choice.description ?? ''}
              params={choice.dscrPrms}
            />
          </div>
        </div>
      </div>
      <button
        type="button" className="rte-turnmark"
        aria-expanded={turned}
        aria-label={turned ? `Turn ${label} back` : `Read ${label}`}
        onClick={onTurn}
      >
        <ChevronDown size="0.7rem" aria-hidden="true" />
      </button>
      {snip}
    </div>
  )
}

export function Palette({
  onAddFeature,
  onAddCondition,
  pickMenu,
  disabled = false,
  open = true,
}: {
  onAddFeature: (entry: PaletteFeature) => void
  onAddCondition: (choice: CondChoice) => void
  /** what a right-click on a tile offers, built by the page from its actions */
  pickMenu: (label: string, add: () => void) => MenuEntry[]
  disabled?: boolean
  /** whether the page has this note out of the margin */
  open?: boolean
}) {
  const { actRt, partRtsById } = useAppStore(selWorkDrvd)
  const enemyProfile = useAppStore(selEnemyProf)

  const [mode, setMode] = useState<PaletteMode>('features')
  const [owner, setOwner] = useState<string>('all')
  const [query, setQuery] = useState('')
  /* turned rows stay turned: a state read while choosing is still being read
     after the next one is opened beside it */
  const [turned, setTurned] = useState<ReadonlySet<string>>(() => new Set())

  const members = useMemo(
    () => (actRt ? visibleRotMembers(actRt, partRtsById) : []),
    [actRt, partRtsById],
  )
  const runtimesById = useMemo(
    () => Object.fromEntries(members.map((member) => [member.id, member.runtime])),
    [members],
  )

  const features = useMemo(
    () => members.flatMap((member) => collectFeatures(member, runtimesById)),
    [members, runtimesById],
  )

  const memberAccents = useMemo(
    () => new Map(members.map((member) => [member.id, ATTR_COLORS[member.attribute]])),
    [members],
  )

  const conditions = useMemo(
    () => (actRt ? makeConditionChoices(members, actRt, enemyProfile.id) : []),
    [actRt, members, enemyProfile.id],
  )

  // Resolve description parameters before indexing so search and snippets use
  // the same concrete text as condition inspection.
  const condText = useMemo(() => {
    const byId = new Map<string, string>()
    for (const choice of conditions) {
      if (!choice.description) continue
      byId.set(choice.id, formatDescription(choice.description, choice.dscrPrms ?? []))
    }
    return byId
  }, [conditions])

  // tabs list only owners that actually contribute something in this mode
  const tabs = useMemo<OwnerTab[]>(() => {
    if (mode === 'features') {
      const seen = new Set(features.map((entry) => entry.resonatorId))
      return members
        .filter((member) => seen.has(member.id))
        .map((member) => ({ id: member.id, label: member.name, profile: member.profile }))
    }

    const list: OwnerTab[] = []
    const byKey = new Map<string, OwnerTab>()
    for (const choice of conditions) {
      const key = getCondOwnerKey(choice)
      if (byKey.has(key)) continue
      const isEnemy = key === 'enemy'
      const tab: OwnerTab = {
        id: key,
        label: getCondOwnerLabel(choice),
        // a custom enemy has no catalog art, so its tab keeps the crosshair
        profile: isEnemy
          ? getEnemyIcon(enemyProfile.id) ?? undefined
          : members.find((member) => member.id === choice.resonatorId)?.profile,
        isEnemy,
      }
      byKey.set(key, tab)
      list.push(tab)
    }
    return list
  }, [conditions, enemyProfile.id, features, members, mode])

  // an owner that vanishes when the mode flips should not strand the filter
  const activeOwner = tabs.some((tab) => tab.id === owner) ? owner : 'all'
  const needle = query.trim().toLowerCase()

  const featureGroups = useMemo<FeatureGroup[]>(() => {
    const byTab = new Map<SkillTabKey, PaletteFeature[]>()
    for (const entry of features) {
      if (activeOwner !== 'all' && entry.resonatorId !== activeOwner) continue
      // a hit is only reachable through its skill, so the skill answers for it
      if (needle && !entry.label.toLowerCase().includes(needle)
        && !entry.resName.toLowerCase().includes(needle)
        && !entry.subHits.some((hit) => hit.label.toLowerCase().includes(needle))) continue
      const list = byTab.get(entry.tab)
      if (list) list.push(entry)
      else byTab.set(entry.tab, [entry])
    }

    return ROT_SKILL_TABS
      .filter((tab) => byTab.has(tab))
      .map((tab) => ({ tab, label: SKILL_TAB_NAMES[tab], entries: byTab.get(tab) ?? [] }))
  }, [activeOwner, features, needle])

  const namesHit = useCallback((choice: CondChoice, find: string) => (
    [getBrowserChoiceLabel(choice), choice.effectName, choice.sourceName, choice.resName]
      .some((value) => value?.toLowerCase().includes(find) ?? false)
  ), [])

  const conditionGroups = useMemo(() => {
    /* a state is found by what it does as readily as by what it is called: the
       name is most of the catalogue, and the text is the rest of it */
    const matches = (choice: CondChoice) => {
      if (activeOwner !== 'all' && getCondOwnerKey(choice) !== activeOwner) return false
      if (!needle) return true
      if (namesHit(choice, needle)) return true
      return condText.get(choice.id)?.toLowerCase().includes(needle) ?? false
    }

    /*
      every formula stat shares one owner key and one browser label, so listing
      them each would be twenty-odd tiles all reading "Modifiers". the first
      stands for the group and which stat it writes is picked afterwards, the
      same way the pane's condition browser handles them.
    */
    const modifiers = conditions.filter(isFormulaChoice)
    const modifierShown = modifiers.some(matches)
    const filtered = conditions.filter((choice) => (
      isFormulaChoice(choice)
        ? choice === modifiers[0] && modifierShown
        : matches(choice)
    ))

    return groupCondChoices(filtered)
  }, [activeOwner, condText, conditions, namesHit, needle])

  const total = mode === 'features'
    ? featureGroups.reduce((sum, group) => sum + group.entries.length, 0)
    : conditionGroups.reduce((sum, group) => sum + group.choices.length, 0)

  return (
    <aside
      className={`rte-palette${disabled ? ' is-disabled' : ''}${open ? ' is-out' : ''}`}
      aria-disabled={disabled}
      inert={disabled || !open}
    >
      <div className="rte-palette__head">
        <div className="rte-palette__modes" role="group" aria-label="What to add">
          {(['features', 'conditions'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={mode === value ? 'is-on' : undefined}
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
            >
              {value}
            </button>
          ))}
        </div>

        <label className="rte-palette__search">
          <Search size="0.75rem" aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder={mode === 'features' ? 'Find a step' : 'Find a state'}
            aria-label={mode === 'features' ? 'Find a step' : 'Find a state'}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        {tabs.length > 1 ? (
          <div className="rte-palette__tabs" role="group" aria-label="Filter by owner">
            <button
              type="button"
              className={activeOwner === 'all' ? 'is-on' : undefined}
              aria-pressed={activeOwner === 'all'}
              aria-label="All owners"
              title="All owners"
              onClick={() => setOwner('all')}
            >
              <Sparkles size="0.8rem" aria-hidden="true" />
            </button>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeOwner === tab.id ? 'is-on' : undefined}
                aria-pressed={activeOwner === tab.id}
                aria-label={tab.label}
                title={tab.label}
                onClick={() => setOwner(tab.id)}
              >
                {tab.profile ? (
                  <img
                    src={tab.profile}
                    alt=""
                    onError={tab.isEnemy ? withDefIconM : withDefResMg}
                    loading="lazy"
                  />
                ) : tab.isEnemy ? (
                  <Crosshair size="0.8rem" aria-hidden="true" />
                ) : (
                  <Repeat size="0.8rem" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="rte-palette__list rte-scroll">
        {total === 0 ? (
          <p className="rte-palette__empty">
            {needle
              ? 'Nothing matches that search.'
              : mode === 'features'
                ? 'This resonator has no steps to add.'
                : 'No states are available for this rotation.'}
          </p>
        ) : mode === 'features' ? (
          featureGroups.map((group) => (
            <div key={group.tab} className="rte-grp">
              <div className="rte-grp__head">
                <span className="rte-grp__label">{group.label}</span>
                <span className="rte-grp__rule" aria-hidden="true" />
                <span className="rte-grp__count">{group.entries.length}</span>
              </div>
              <div className="rte-grp__tiles">
                {group.entries.map((entry) => {
                  const tile = featTile(entry, onAddFeature, pickMenu)
                  if (entry.subHits.length === 0) {
                    return tile
                  }

                  /*
                    the tile is grabbed anywhere on it, so the fold cannot own
                    the row: the trigger is the row only in markup, and the
                    chevron is the one part of it that answers a press.
                  */
                  return (
                    <Expandable
                      key={`${entry.resonatorId}:${entry.featureId}`}
                      style={paletteAccent(ATTR_COLORS[entry.element])}
                      triggerClass="rte-tset__head"
                      chevWrapClass="rte-tset__chev"
                      chevronSize={11}
                      innerClass="rte-tset__hits"
                      plainTrigger
                      noHeaderWrap
                      header={tile}
                    >
                      {entry.subHits.map((hit, index) => featTile(hit, onAddFeature, pickMenu, index + 1))}
                    </Expandable>
                  )
                })}
              </div>
            </div>
          ))
        ) : (
          conditionGroups.map((group) => (
            <div key={group.key} className="rte-grp">
              <div className="rte-grp__head">
                <span className="rte-grp__label">{group.label}</span>
                <span className="rte-grp__rule" aria-hidden="true" />
                <span className="rte-grp__count">{group.choices.length}</span>
              </div>
              <div className="rte-grp__tiles">
                {group.choices.map((choice) => {
                  const accent = choice.changeTarget === 'enemy' || choice.changeTarget === 'rotation'
                    ? undefined
                    : memberAccents.get(choice.resonatorId)
                  // a tile already explained by its own name has nothing to quote
                  const found = needle && !namesHit(choice, needle) ? needle : undefined
                  return (
                    <CondTile
                      key={choice.id}
                      choice={choice}
                      accent={accent}
                      text={condText.get(choice.id)}
                      needle={found}
                      turned={turned.has(choice.id)}
                      onTurn={() => setTurned((open) => {
                        const next = new Set(open)
                        if (!next.delete(choice.id)) next.add(choice.id)
                        return next
                      })}
                      onAdd={onAddCondition}
                      pickMenu={pickMenu}
                    />
                  )
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  )
}

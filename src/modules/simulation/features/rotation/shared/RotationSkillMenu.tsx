/*
  Author: Runor Ewhro
  Description: Owns rotation skill menu behavior and state transitions for the shared module.
*/

import * as Collapsible from "@radix-ui/react-collapsible";
import type {
  RotationMember,
  SkillMenuEntry,
  SkillMenuGroup
} from "@/modules/simulation/features/rotation/shared/authoringTypes.ts";
import {useAppStore} from "@/domain/state/store.ts";
import {useMemo, useRef, useState} from "react";
import type {CSSProperties as CssProps} from "react";
import {ChevronDown, Layers, Search, X} from "lucide-react";
import {isSkllVsbl, resolveSkill} from "@/engine/pipeline/resolveSkill.ts";
import type {SkillDef} from "@/domain/entities/stats.ts";
import {ROT_SKILL_TABS, SKILL_TAB_NAMES, type SkillTabKey} from "@/modules/simulation/model/skillTabs.ts";
import {AppModal} from "@/shared/ui/AppModal.tsx";
import {getSkillType} from "@/modules/simulation/model/skillTypes.ts";
import {
  getFeatVar,
  getSkllMenuL,
  getSubHitLbl,
} from "@/modules/simulation/features/rotation/shared/nodeTools.ts";
import {ATTR_COLORS} from "@/domain/gameData/attributeDisplay.ts";
import {withDefIconM, withDefResMg} from "@/shared/lib/imageFallback.ts";

interface TabGroup {
  tab: SkillTabKey
  label: string
  groups: SkillMenuGroup[]
}

export function RotationSkillMenu({
                              visible,
                              open,
                              closing = false,
                              members,
                              actMemId: actMmbrId,
                              defShowSubwy: dfltShowSubH = false,
                              onActMemChng: onActMmbrChn,
                              onClose,
                              onSlctSkll: onSlctSkll,
                            }: {
  visible: boolean
  open: boolean
  closing?: boolean
  portalTarget: HTMLElement | null
  members: RotationMember[]
  actMemId: string
  defShowSubwy?: boolean
  onActMemChng: (resonatorId: string) => void
  onClose: () => void
  onSlctSkll: (entry: SkillMenuEntry) => void
}) {
  const showSubHitsP = useAppStore((state) => state.ui.showSubHits)
  const [query, setQuery] = useState('')
  const [showHits, setShowHits] = useState(() => dfltShowSubH || showSubHitsP)
  // skills folded the other way from whatever the Hits switch is set to
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set())
  const [shutTabs, setShutTabs] = useState<Set<string>>(() => new Set())
  const [atTab, setAtTab] = useState<SkillTabKey | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)
  const sections = useRef(new Map<string, HTMLElement>())

  const activeMember = members.find((member) => member.id === actMmbrId) ?? null
  const activeAccent = activeMember ? ATTR_COLORS[activeMember.attribute] : null
  const actRt = activeMember?.runtime ?? null
  const actMemName = activeMember?.name ?? 'Active Member'
  const rslvSkllById = useMemo(() => {
    // Resolve each source skill once per member for consistent visibility and labels.
    if (!activeMember || !actRt) {
      return {}
    }

    return Object.fromEntries(
      activeMember.skills.map((skill) => [skill.id, resolveSkill(actRt, skill)]),
    ) as Record<string, SkillDef>
  }, [activeMember, actRt])
  const entries = useMemo<SkillMenuEntry[]>(() => {
    if (!activeMember) {
      return []
    }

    return activeMember.features.reduce<SkillMenuEntry[]>((list, feature) => {
      const skill = rslvSkllById[feature.skillId]
      if (!skill || (actRt && !isSkllVsbl(actRt, skill))) {
        return list
      }

      list.push({
        featureId: feature.id,
        resonatorId: activeMember.id,
        resName: activeMember.name,
        featureLabel: feature.label,
        feature,
        skill,
        variant: getFeatVar(feature),
        hitIndex: typeof feature.hitIndex === 'number' ? feature.hitIndex : undefined,
      })

      return list
    }, [])
  }, [activeMember, actRt, rslvSkllById])

  const grpdEnts = useMemo(() => {
    const grouped: Partial<Record<SkillTabKey, SkillMenuGroup[]>> = {}
    const featsBySkllI = new Map<string, SkillMenuEntry[]>()

    // Group features by source skill before separating totals from sub-hits.
    for (const entry of entries) {
      const current = featsBySkllI.get(entry.skill.id) ?? []
      current.push(entry)
      featsBySkllI.set(entry.skill.id, current)
    }

    for (const rawSkill of activeMember?.skills ?? []) {
      const skill = rslvSkllById[rawSkill.id] ?? rawSkill
      if (actRt && !isSkllVsbl(actRt, skill)) {
        continue
      }

      const skillEntries = featsBySkllI.get(skill.id) ?? []
      if (skillEntries.length === 0) {
        continue
      }

      const totalEntry = skillEntries.find((entry) => entry.variant === 'skill') ?? skillEntries[0] ?? null
      const subHitEnts = skillEntries
        .filter((entry) => entry.variant === 'subHit')
        .sort((left, right) => (left.hitIndex ?? 0) - (right.hitIndex ?? 0))
      const tabKey = skill.tab as SkillTabKey
      grouped[tabKey] = [
        ...(grouped[tabKey] ?? []),
        {
          resonatorId: activeMember?.id ?? actMmbrId,
          resName: activeMember?.name ?? actMemName,
          skill,
          totalEntry,
          subHitNtrs: subHitEnts,
        },
      ]
    }

    return grouped
  }, [activeMember, actMmbrId, actMemName, actRt, entries, rslvSkllById])

  const hasSubHitEnt = useMemo(() => entries.some((entry) => entry.variant === 'subHit'), [entries])

  // A sub-hit match retains its parent skill group.
  const shown = useMemo<TabGroup[]>(() => {
    const needle = query.trim().toLowerCase()
    const out: TabGroup[] = []

    for (const tab of ROT_SKILL_TABS) {
      const groups = (grpdEnts[tab] ?? []).filter((group) => {
        if (!needle) {
          return true
        }
        if (group.skill.label.toLowerCase().includes(needle)) {
          return true
        }
        return group.subHitNtrs.some((entry) => getSubHitLbl(entry).toLowerCase().includes(needle))
      })

      if (groups.length > 0) {
        out.push({tab, label: SKILL_TAB_NAMES[tab], groups})
      }
    }

    return out
  }, [grpdEnts, query])

  const total = shown.reduce((sum, group) => sum + group.groups.length, 0)
  // a node that filtering has taken away cannot still be the one you are at
  const atNow = shown.some((group) => group.tab === atTab) ? atTab : shown[0]?.tab ?? null

  const hitsOpen = (id: string) => (flipped.has(id) ? !showHits : showHits)

  const toggleHits = (id: string) => {
    setFlipped((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTab = (tab: SkillTabKey) => {
    setShutTabs((prev) => {
      const next = new Set(prev)
      if (next.has(tab)) next.delete(tab)
      else next.add(tab)
      return next
    })
  }

  const jumpTo = (tab: SkillTabKey) => {
    setShutTabs((prev) => {
      if (!prev.has(tab)) {
        return prev
      }
      const next = new Set(prev)
      next.delete(tab)
      return next
    })
    setAtTab(tab)

    requestAnimationFrame(() => {
      const scroller = listRef.current
      const section = sections.current.get(tab)
      if (scroller && section) {
        scroller.scrollTo({top: Math.max(0, section.offsetTop - 4)})
      }
    })
  }

  const onScroll = () => {
    const scroller = listRef.current
    if (!scroller) {
      return
    }

    let current: SkillTabKey | null = shown[0]?.tab ?? null
    for (const group of shown) {
      const section = sections.current.get(group.tab)
      if (section && section.offsetTop - scroller.scrollTop <= 12) {
        current = group.tab
      }
    }

    if (current !== atNow) {
      setAtTab(current)
    }
  }

  if (!visible) {
    return null
  }

  return (
    <AppModal
      state={{visible, open, closing}}
      variant="skill-menu"
      ariaLabel="Select a skill"
      style={activeAccent ? {
        '--modal-accent': activeAccent,
        '--resonator-accent': activeAccent,
      } as CssProps : undefined}
      onClose={onClose}
    >
      <div className="amdl skm" onClick={(event) => event.stopPropagation()}>
        <header className="amdl__head">
                    <span className="amdl__title">
                        <span className="amdl__over">Rotation</span>
                        <b>Add a step</b>
                    </span>

          <label className="amdl__find">
            <Search size="0.8rem" aria-hidden="true" />
            <input
              type="text"
              value={query}
              placeholder="Find a skill"
              aria-label="Find a skill"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {hasSubHitEnt ? (
            <button
              type="button"
              className={showHits ? 'amdl__chip is-on' : 'amdl__chip'}
              aria-pressed={showHits}
              title="Show every skill's hits"
              onClick={() => {
                setShowHits((prev) => !prev)
                setFlipped(new Set())
              }}
            >
              <Layers size="0.75rem" aria-hidden="true" />
              Hits
            </button>
          ) : null}

          {members.length > 1 ? (
            <div className="amdl__gauge" role="group" aria-label="Switch teammate">
              {members.map((member) => {
                const isCurrent = member.id === actMmbrId
                return (
                  <button
                    key={member.id}
                    type="button"
                    className={isCurrent ? 'skm__chip is-on' : 'skm__chip'}
                    style={{'--skm-tone': ATTR_COLORS[member.attribute]} as CssProps}
                    aria-pressed={isCurrent}
                    aria-label={isCurrent ? `${member.name}, showing` : `Show ${member.name}`}
                    title={isCurrent ? `${member.name}, showing` : `Show ${member.name}`}
                    onClick={() => {
                      if (!isCurrent) {
                        onActMmbrChn(member.id)
                      }
                    }}
                  >
                    <img src={member.profile} alt="" onError={withDefResMg} loading="lazy" />
                  </button>
                )
              })}
            </div>
          ) : null}

          <button type="button" className="amdl__close" aria-label="Close" onClick={onClose}>
            <X size="0.95rem" />
          </button>
        </header>

        <div className="skm__body">
          <nav className="skm__rail" aria-label="Jump to a talent node">
            {shown.map((group) => (
              <button
                key={group.tab}
                type="button"
                className={group.tab === atNow ? 'skm__jump is-on' : 'skm__jump'}
                aria-current={group.tab === atNow ? 'true' : undefined}
                onClick={() => jumpTo(group.tab)}
              >
                <span className="skm__jump-label">{group.label}</span>
                <span className="skm__jump-n">{group.groups.length}</span>
              </button>
            ))}
            <span className="skm__rail-foot">
                            {total} {total === 1 ? 'skill' : 'skills'}
                        </span>
          </nav>

          <div className="skm__list" ref={listRef} onScroll={onScroll}>
            {shown.length === 0 ? (
              <p className="skm__empty">
                <b>No skill by that name</b>
                Try a shorter word, or switch to another teammate.
              </p>
            ) : shown.map((group) => {
              const shut = shutTabs.has(group.tab)
              return (
                <section
                  key={group.tab}
                  className={shut ? 'skm-node is-shut' : 'skm-node'}
                  ref={(element) => {
                    if (element) sections.current.set(group.tab, element)
                    else sections.current.delete(group.tab)
                  }}
                >
                  <button
                    type="button" className="skm-node__head"
                    aria-expanded={!shut}
                    onClick={() => toggleTab(group.tab)}
                  >
                    <ChevronDown className="skm-node__chev" size="0.7rem" aria-hidden="true" />
                    <span className="skm-node__label">{group.label}</span>
                    <span className="skm-node__rule" aria-hidden="true" />
                    <span className="skm-node__n">{group.groups.length}</span>
                  </button>

                  {shut ? null : (
                    <div className="skm-node__rows">
                      {group.groups.map((entry) => {
                        const meta = getSkillType(entry.skill.skillType)
                        const id = `${entry.resonatorId}:${entry.skill.id}`
                        const hits = entry.subHitNtrs
                        const openHits = hits.length > 0 && hitsOpen(id)
                        const tone = getSkllMenuL(entry.skill)

                        return (
                          <Collapsible.Root
                            key={id}
                            asChild
                            open={openHits}
                            onOpenChange={() => toggleHits(id)}
                          >
                            <div
                              style={{'--skm-tone': tone} as CssProps}
                            >
                              <div className="skm-skill__row">
                                <button
                                  type="button" className="skm-skill__main"
                                  onClick={() => {
                                    if (entry.totalEntry) {
                                      onSlctSkll(entry.totalEntry)
                                    }
                                  }}
                                >
                                  {meta.icon ? (
                                    <img
                                      src={meta.icon}
                                      alt=""
                                      aria-hidden="true" className="skill-type-icon"
                                      onError={withDefIconM}
                                    />
                                  ) : (
                                    <span className="skill-type-icon" aria-hidden="true" />
                                  )}
                                  <span className="skm-skill__name">{entry.skill.label}</span>
                                  <span className="skm-skill__type">{meta.label}</span>
                                </button>

                                {hits.length > 0 ? (
                                  <Collapsible.Trigger asChild>
                                    <button
                                      type="button" className="skm-skill__hits"
                                      aria-label={`${hits.length} hits in ${entry.skill.label}`}
                                    >
                                      {hits.length} hits
                                      <ChevronDown className="skm-skill__chev" size="0.65rem" aria-hidden="true" />
                                    </button>
                                  </Collapsible.Trigger>
                                ) : <span aria-hidden="true" />}
                              </div>

                              {hits.length > 0 ? (
                                <Collapsible.Content className="expandable__content">
                                  <div className="skm-hits">
                                    {hits.map((hit, index) => (
                                      <button
                                        key={`${hit.resonatorId}:${hit.featureId}`}
                                        type="button" className="skm-hit"
                                        onClick={() => onSlctSkll(hit)}
                                      >
                                        <span className="skm-hit__i">{index + 1}</span>
                                        <span className="skm-hit__name">{getSubHitLbl(hit)}</span>
                                      </button>
                                    ))}
                                  </div>
                                </Collapsible.Content>
                              ) : null}
                            </div>
                          </Collapsible.Root>
                        )
                      })}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </AppModal>
  )
}

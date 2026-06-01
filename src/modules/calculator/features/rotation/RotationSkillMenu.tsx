/*
  Author: Runor Ewhro
  Description: Renders the rotation skill menu surface for the calculator rotation flow.
*/

import type {
    RotMemEnt,
    SkillMenuEntry,
    SkllMenuGrp
} from "@/modules/calculator/features/rotation/lib/types.ts";
import {useAppStore} from "@/domain/state/store.ts";
import {useMemo, useState} from "react";
import {isSkllVsbl, resolveSkill} from "@/engine/pipeline/resolveSkill.ts";
import type {SkillDef} from "@/domain/entities/stats.ts";
import {ROT_SKILL_TABS, SKILL_TAB_NAMES, type SkillTabKey} from "@/modules/calculator/model/skillTabs.ts";
import {AppModal} from "@/shared/ui/AppModal.tsx";
import {MdlClsBttn} from "@/shared/ui/ModalCloseButton.tsx";
import {getSkillType} from "@/modules/calculator/model/skillTypes.ts";
import {
    getFeatVar,
    getSkllMenuL,
    getSubHitLbl,
    defaultTabs,
} from "@/modules/calculator/features/rotation/lib/utils.ts";
import {withDefIconM} from "@/shared/lib/imageFallback.ts";

export function RotSkllMenu({
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
    members: RotMemEnt[]
    actMemId: string
    defShowSubwy?: boolean
    onActMemChng: (resonatorId: string) => void
    onClose: () => void
    onSlctSkll: (entry: SkillMenuEntry) => void
}) {
    const showSubHitsP = useAppStore((state) => state.ui.showSubHits)
    const [expandedTabs, setXpndTabs] = useState<Record<string, boolean>>(() => defaultTabs())
    const [showSubHits, setShowSubHi] = useState(() => dfltShowSubH || showSubHitsP)

    const activeMember = members.find((member) => member.id === actMmbrId) ?? null
    const actRt = activeMember?.runtime ?? null
    const actMemName = activeMember?.name ?? 'Active Member'
    const rslvSkllById = useMemo(() => {
        // resolving once per member keeps visibility checks and rendered labels
        // aligned with runtime state without recalculating each group row.
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
        const grouped: Partial<Record<SkillTabKey, SkllMenuGrp[]>> = {}
        const featsBySkllI = new Map<string, SkillMenuEntry[]>()

        // feature entries are keyed by source skill first so a single skill row
        // can expose both its total entry and optional sub-hit entries.
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
    const vsblSkllCnt = useMemo(
        () =>
            // count the entries that will actually render after the sub-hit
            // toggle, not the raw feature catalog size.
            Object.values(grpdEnts).reduce(
                (total, groups) =>
                    total
                    + (groups?.reduce((groupTotal, group) => {
                        const vsblSubHitCn = showSubHits || !group.totalEntry ? group.subHitNtrs.length : 0
                        return groupTotal + (group.totalEntry ? 1 : 0) + vsblSubHitCn
                    }, 0) ?? 0),
                0,
            ),
        [grpdEnts, showSubHits],
    )

    const toggleTab = (tab: SkillTabKey) => {
        setXpndTabs((prev) => ({
            ...prev,
            [tab]: !(prev[tab] ?? true),
        }))
    }

    if (!visible) {
        return null
    }

    return (
        <AppModal
            state={{visible, open, closing}}
            variant="skill-menu"
            ariaLabel="Select a skill"
            onClose={onClose}
        >
            <div onClick={(event) => event.stopPropagation()}>
                <div className="pane-section app-modal-header menu-header-with-buttons">
                    <div className="app-modal-header-top">
                        <div className="menu-header">
                            <div className="panel-overline">Rotation</div>
                            <h3 className="panel-heading-title">Add Feature Step</h3>
                        </div>
                        <div className="skill-menu-summary">
                            <div className="picker-modal__summary-pill checkbox">
                                <span className="picker-modal__summary-label">Sub-Hits</span>
                                <input
                                    type="checkbox"
                                    className="picker-modal__summary-value"
                                    checked={showSubHits}
                                    disabled={!hasSubHitEnt}
                                    onChange={(event) => setShowSubHi(event.target.checked)}
                                />
                            </div>
                            {members.length > 1 ? (
                                <div className="picker-modal__summary-pill">
                                    <span className="picker-modal__summary-label">Member</span>
                                    <span className="picker-modal__summary-value">{actMemName}</span>
                                </div>
                            ) : null}
                            <div className="picker-modal__summary-pill">
                                <span className="picker-modal__summary-label">Skills</span>
                                <span className="picker-modal__summary-value">{vsblSkllCnt}</span>
                            </div>
                            <MdlClsBttn onClick={onClose} />
                        </div>
                    </div>
                    {members.length > 1 ? (
                        <div className="rotation-view-toggle skill-menu-member-toggle">
                            {members.map((member) => (
                                <button
                                    key={member.id}
                                    type="button"
                                    className={member.id === actMmbrId ? 'view-toggle-button active' : 'view-toggle-button'}
                                    onClick={() => onActMmbrChn(member.id)}
                                >
                                    {member.name}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="skill-menu-list">
                    {ROT_SKILL_TABS.map((tabKey) => {
                        const groups = grpdEnts[tabKey]
                        if (!groups?.length) {
                            return null
                        }

                        return (
                            <div key={tabKey} className={`skill-tab-section ${expandedTabs[tabKey] ? 'open' : 'closed'}`}>
                                <button type="button" className="skill-tab-label collapsible-label" onClick={() => toggleTab(tabKey)}>
                                    <span>{SKILL_TAB_NAMES[tabKey]}</span>
                                    <span className={expandedTabs[tabKey] ? 'sequence-card-status active' : 'sequence-card-status'}>
                    {groups.length} {groups.length === 1 ? 'Skill' : 'Skills'}
                  </span>
                                </button>

                                <div className={`skill-tab-content ${expandedTabs[tabKey] ? 'open' : 'closed'}`}>
                                    {groups.map((group) => {
                                        const meta = getSkillType(group.skill.skillType)
                                        const shldShowSubH = showSubHits || !group.totalEntry

                                        return (
                                            <div key={`${group.resonatorId}:${group.skill.id}`} className="skill-option-group">
                                                {group.totalEntry ? (
                                                    <button
                                                        type="button"
                                                        className="skill-option"
                                                        onClick={() => onSlctSkll(group.totalEntry!)}
                                                    >
                                                        <div className="dropdown-item-content">
                                                            <div className="dropdown-main">
                                <span style={{ color: getSkllMenuL(group.skill) }}>
                                  {group.skill.label}
                                </span>
                                                            </div>
                                                            {group.subHitNtrs.length ? (
                                                                <span className="dropdown-icons">
                                  {group.subHitNtrs.length} Hits
                                </span>
                                                            ) : null}
                                                            <div className="dropdown-icons">
                                                                {meta.icon ? (
                                                                    <img
                                                                        src={meta.icon}
                                                                        alt=""
                                                                        aria-hidden="true"
                                                                        className="skill-type-icon"
                                                                        onError={withDefIconM}
                                                                    />
                                                                ) : null}
                                                                <span>{meta.label}</span>
                                                            </div>
                                                        </div>
                                                    </button>
                                                ) : null}

                                                {shldShowSubH && group.subHitNtrs.length ? (
                                                    <div className="skill-subhit-list">
                                                        {group.subHitNtrs.map((entry) => (
                                                            <button
                                                                key={`${entry.resonatorId}:${entry.featureId}`}
                                                                type="button"
                                                                className="skill-option skill-option--subhit"
                                                                onClick={() => onSlctSkll(entry)}
                                                            >
                                                                <div className="dropdown-item-content">
                                                                    <div className="dropdown-main">
                                    <span style={{ color: getSkllMenuL(entry.skill) }}>
                                      {getSubHitLbl(entry)}
                                    </span>
                                                                    </div>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </AppModal>
    )
}

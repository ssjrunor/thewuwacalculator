/*
  Author: Runor Ewhro
  Description: renders the saved summary surface for the calculator rotation flow.
*/

import type {InvRotEnt} from "@/domain/entities/inventoryStorage.ts";
import type {ResonatorId} from "@/domain/entities/runtime.ts";
import {useMemo} from "react";
import {xtrcRotStts} from "@/modules/calculator/features/rotation/lib/analytics.ts";
import {
    fmtSvdRotDur, fmtSvdRotNtg,
    getSvdRotDps
} from "@/modules/calculator/features/rotation/lib/savedRotations.ts";
import {fmtDateShrt, fmtPrcn} from "@/shared/lib/format.ts";
import {formatCompactNum} from "@/modules/calculator/model/statsView.ts";
import * as React from "react";

export function SavedSummary({
                          entry,
                          rslvResName: rslvResName,
                      }: {
    entry: InvRotEnt
    rslvResName?: (id: ResonatorId) => string | undefined
}) {
    const extracted = useMemo(() => xtrcRotStts(entry.items), [entry.items])
    const svdRotDps = getSvdRotDps(entry)
    const hasSvdRotNot = entry.note.trim().length > 0

    const totals = entry.summary?.total
    const avg = totals?.avg ?? 0
    const crit = totals?.crit ?? 0
    const normal = totals?.normal ?? 0

    const teamNames = useMemo(() => {
        return (entry.team ?? [])
            .flatMap((value) => {
                if (typeof value !== 'string' || value.length === 0) {
                    return []
                }

                return [rslvResName?.(value) ?? value]
            })
    }, [entry.team, rslvResName])

    const members = useMemo(() => {
        const source = entry.summary?.members ?? []
        return [...source]
            .map((member) => ({
                ...member,
                share: avg > 0 ? (member.contribution.avg / avg) * 100 : 0,
            }))
            .sort((a, b) => b.contribution.avg - a.contribution.avg)
    }, [entry.summary?.members, avg])

    const prvwCvrdCnt = extracted.preview.reduce((sum, group) => sum + group.count, 0)
    const prvwRmnnCnt = Math.max(0, extracted.totalNodes - prvwCvrdCnt)

    return (
        <div className="rotation-snapshot-v2">
        <div className="rotation-snapshot-v2__head">
        <div className="rotation-snapshot-v2__title-wrap">
        <span className="team-state-config-title">Saved Snapshot</span>
    <div className="rotation-snapshot-v2__title-row">
    <strong className="rotation-snapshot-v2__title">{entry.name}</strong>
        <span className="rotation-snapshot__team">{entry.mode === 'team' ? '‷ team' : '‷ personal'}</span>
        </div>
        </div>

        <div className="rotation-snapshot-v2__meta">
        {teamNames.length > 0 ? (
                <div className="overview-inline-buffs">
                    {teamNames.map((name) => (
                            <span key={name} className="overview-inline-buff">{name}</span>
            ))}
    </div>
) : null}
    <span className="overview-inline-buff">{fmtDateShrt(entry.updatedAt)}</span>
    </div>
    </div>

    {totals ? (
        <div className="rotation-snapshot-v2__main-grid">
        <div className="rotation-snapshot-v2__hero">
        <div className="rotation-snapshot-v2__hero-kpi">
        <span className="rotation-snapshot-v2__hero-label">AVG</span>
            <strong className="rotation-snapshot-v2__hero-value avg">
        {formatCompactNum(avg)}
        </strong>
        </div>

        <div className="rotation-snapshot-v2__hero-side">
    <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Crit</span>
        <strong className="overview-tree-leaf-value">{formatCompactNum(crit)}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Normal</span>
        <strong className="overview-tree-leaf-value">{formatCompactNum(normal)}</strong>
        </div>
        </div>
        </div>

        {members.length > 0 ? (
                <div className="rotation-snapshot__contribution">
                <div className="overview-cell--rotation rotation-snapshot-v2__member-list">
                <div className="overview-rotation-grid-header">
                <span className="rotation-snapshot-v2__section-title">Contribution</span>
                    <span>Normal</span>
                    <span>Crit</span>
                    <span>Avg</span>
                    </div>
            {members.map((member) => (
                    <div key={member.id} className="overview-rotation-grid-row">
                <div className="rotation-snapshot-v2__member-name">
                    <strong>{member.name}</strong>
                    <sup>{fmtPrcn(member.share)}</sup>
        </div>

        <div className="rotation-snapshot-v2__member-values">
            <span>{formatCompactNum(member.contribution.normal)}</span>
        <span>{formatCompactNum(member.contribution.crit)}</span>
        <span className="avg">{formatCompactNum(member.contribution.avg)}</span>
        </div>
        </div>
        ))}
            </div>
            </div>
        ) : null}
        </div>
    ) : (
        <div className="team-state-empty">No saved damage totals.</div>
    )}

    <div className="rotation-snapshot__data">
    <div className="overview-tree-branch-head">Rotation Meta</div>
    <div className="overview-tree-children overview-tree-children--grid">
        {entry.duration > 0 ? (
                <div className="overview-tree-leaf">
                <span className="overview-tree-leaf-label">Duration</span>
                    <strong className="overview-tree-leaf-value">{fmtSvdRotDur(entry.duration)}</strong>
    </div>
) : null}
    {svdRotDps != null ? (
        <div className="overview-tree-leaf">
        <span className="overview-tree-leaf-label">DPS</span>
            <strong className="overview-tree-leaf-value">{fmtSvdRotNtg(svdRotDps)}</strong>
        </div>
    ) : null}
    <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Top Level Nodes</span>
    <strong className="overview-tree-leaf-value">{extracted.topLvlNds}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Total Nodes</span>
    <strong className="overview-tree-leaf-value">{extracted.totalNodes}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Setup Nodes</span>
    <strong className="overview-tree-leaf-value">{extracted.setupNodes}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Repeat Nodes</span>
    <strong className="overview-tree-leaf-value">{extracted.repeatNodes}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Conditions Nodes</span>
    <strong className="overview-tree-leaf-value">{extracted.condNds}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Feature Nodes</span>
    <strong className="overview-tree-leaf-value">{extracted.featureNodes}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Depth</span>
        <strong className="overview-tree-leaf-value">{extracted.deepestDepth}</strong>
        </div>
        <div className="overview-tree-leaf">
    <span className="overview-tree-leaf-label">Members</span>
        <strong className="overview-tree-leaf-value">{teamNames.length || (entry.mode === 'team' ? 1 : 0)}</strong>
        </div>
        </div>
        </div>

    {hasSvdRotNot ? (
        <div className="rotation-snapshot-v2__section rotation-snapshot-v2__note-section">
        <div className="rotation-snapshot-v2__section-head">
        <span className="rotation-snapshot-v2__section-title">Note</span>
            </div>
            <p className="rotation-snapshot-v2__note">{entry.note}</p>
        </div>
    ) : null}

    {(teamNames.length > 0 || extracted.preview.length > 0) ? (
            <div className="rotation-snapshot-v2__foot">
                {extracted.preview.length > 0 ? (
                        <div className="rotation-snapshot-v2__section">
                        <div className="rotation-snapshot-v2__section-head">
                        <span className="rotation-snapshot-v2__section-title">Action Preview</span>
                        </div>
                        <div className="overview-inline-buffs">
                    {extracted.preview.map((group, index) => (
                            <React.Fragment key={`${group.kind}-${index}`}>
                    <span className="overview-inline-buff">
                        {group.label}
                        </span>
        {index < extracted.preview.length - 1 ? (
                <span className="node-arrow">⇢</span>
    ) : null}
        </React.Fragment>
    ))}
        {prvwRmnnCnt > 0 ? (
            <>                      <span className="node-arrow">⇢</span>
        <span className="overview-inline-buff">
            +{prvwRmnnCnt} Other Actions
        </span>

        </>
        ) : null}
        </div>
        </div>
    ) : null}
        </div>
    ) : null}
    </div>
)
}
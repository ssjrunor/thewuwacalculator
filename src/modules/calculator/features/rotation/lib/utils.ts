/*
  Author: Runor Ewhro
  Description: Provides shared utils helpers for the rotation surface.
*/

import type {
    CondChoice,
    FeatureMeta, NodeMemIcon, NodeTotals,
    EditConfig, SkillMenuEntry
} from "@/modules/calculator/features/rotation/lib/types.ts";
import {createElement as mkElem} from "react";
import type {MenuEntry} from "@/shared/ui/CtxMenu.tsx";
import {Clipboard, Copy, Scissors, SquareDashedMousePointer as SqrDshdMsPnt} from "lucide-react";
import {isNoWeaponId, type ResRuntime} from "@/domain/entities/runtime.ts";
import type {
    FeatDef,
    RotationNode,
    RtChng,
    SourceState
} from "@/domain/gameData/contracts.ts";
import {evalSrcStt} from "@/modules/calculator/model/sourceEval.ts";
import {listStatesFor} from "@/domain/services/gameDataService.ts";
import {getMainEchoS} from "@/domain/services/runtimeSourceService.ts";
import {countEchoSets} from "@/engine/pipeline/buildCombatContext.ts";
import {getEchoSetDe} from "@/data/gameData/echoSets/effects.ts";
import {negEffectsFor} from "@/domain/gameData/negativeEffects.ts";
import {mkCondChc} from "@/modules/calculator/features/rotation/lib/conditions.tsx";
import type {SkillAggType, SkillDef} from "@/domain/entities/stats.ts";
import {ATTR_COLORS} from "@/modules/calculator/model/display.ts";
import {getSkillType} from "@/modules/calculator/model/skillTypes.ts";
import {ROT_SKILL_TABS} from "@/modules/calculator/model/skillTabs.ts";
import type {SimResult} from "@/engine/pipeline/types.ts";
import {seedRsntById} from "@/modules/calculator/features/resonator/lib/seedData.ts";
import { formatTruncCompact } from '@/shared/lib/number.ts'

export function editMenu(config: EditConfig = {}): MenuEntry[] {
    // edit actions are built from optional callbacks so callers can expose the same menu shape while disabling actions
    // that do not apply to the current node or clipboard state.
    const entries: Array<MenuEntry | null> = [
        {
            id: 'cut',
            label: 'Cut',
            icon: mkElem(Scissors, { size: 15 }),
            disabled: config.cut?.disabled ?? !config.cut?.onSelect,
            onSelect: config.cut?.onSelect,
        },
        {
            id: 'copy',
            label: 'Copy',
            icon: mkElem(Copy, { size: 15 }),
            disabled: config.copy?.disabled ?? !config.copy?.onSelect,
            onSelect: config.copy?.onSelect,
        },
        config.paste?.hidden
            ? null
            : {
                id: 'paste',
                label: 'Paste',
                icon: mkElem(Clipboard, { size: 15 }),
                disabled: config.paste?.disabled ?? (!config.paste?.onSelect && !(config.paste?.submenu?.length)),
                ...(config.paste?.submenu ? { submenu: config.paste.submenu } : {}),
                onSelect: config.paste?.onSelect,
            },
        {
            id: 'select',
            label: 'Select',
            icon: mkElem(SqrDshdMsPnt, { size: 15 }),
            disabled: config.select?.disabled ?? !config.select?.onSelect,
            onSelect: config.select?.onSelect,
        },
    ]

    return entries.filter((entry): entry is MenuEntry => entry !== null)
}

export function withEditMenu(
    items: MenuEntry[],
    config?: EditConfig,
): MenuEntry[] {
    return [
        ...items,
        { type: 'separator' },
        ...editMenu(config),
    ]
}

export function listRotMemSt(
    memRt: ResRuntime,
    actRt: ResRuntime,
): SourceState[] {
    const states: SourceState[] = []
    const seenCntrKeys = new Set<string>()

    const pushStates = (nextStates: SourceState[]) => {
        // controls can be reachable through multiple sources; de-dupe by control key after visibility checks so the
        // editor does not show duplicate rows for the same runtime state.
        for (const state of nextStates) {
            if (seenCntrKeys.has(state.controlKey)) {
                continue
            }

            if (!evalSrcStt(memRt, memRt, state, actRt)) {
                continue
            }

            seenCntrKeys.add(state.controlKey)
            states.push(state)
        }
    }

    pushStates(listStatesFor('resonator', memRt.id))

    const weaponId = memRt.build.weapon.id
    if (!isNoWeaponId(weaponId)) {
        pushStates(listStatesFor('weapon', weaponId))
    }

    const mainEchoSrc = getMainEchoS(memRt)
    if (mainEchoSrc) {
        pushStates(listStatesFor(mainEchoSrc.type, mainEchoSrc.id))
    }

    const echoSetCnts = countEchoSets(memRt.build.echoes)
    for (const [setId, count] of Object.entries(echoSetCnts)) {
        const def = getEchoSetDe(Number(setId))
        if (!def) {
            continue
        }

        // only full set states are editable from rotation conditions; two-piece passives have no runtime control.
        const sttRqrm = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5
        if (count < sttRqrm) {
            continue
        }

        pushStates(listStatesFor('echoSet', setId))
    }

    return states
}

function mkEnemySttsS(
    id: string,
    label: string,
    path: string,
    max: number,
    description: string,
): SourceState {
    return {
        id,
        label,
        source: { type: 'enemy', id: 'target' },
        ownerKey: 'enemy:status',
        controlKey: `enemy:${id}`,
        path,
        kind: 'stack',
        min: 0,
        max,
        defaultValue: 0,
        description,
    }
}

export function enemyChoices(runtime: ResRuntime, enemyId?: string): CondChoice[] {
    // enemy status choices are modeled as synthetic source states so rotation condition editors can treat enemy stacks
    // the same way they treat resonator, weapon, echo, and set controls.
    const enemyMember = {
        id: runtime.id,
        name: 'Enemy',
        runtime,
    }
    const tuneStrain = mkEnemySttsS(
        'tuneStrain',
        'Tune Strain',
        'enemy.status.tuneStrain',
        10,
        'Set the target enemy Tune Strain stacks for following rotation actions.',
    )
    const negFfct = negEffectsFor(runtime)
        .filter((effect) => effect.sliderVisible)
        .map((effect) => mkEnemySttsS(
            effect.key,
            effect.label,
            `enemy.combat.${effect.key}`,
            effect.max,
            `Set the target enemy ${effect.label} stacks for following rotation actions.`,
        ))

    // per-enemy debuff states (toggles/stacks/selects authored in enemy source data); their
    // `enemy.status.<field>` paths route to the enemy overlay just like Tune Strain.
    const debuffStates = enemyId ? listStatesFor('enemy', enemyId) : []

    return [tuneStrain, ...negFfct, ...debuffStates].map((state) => mkCondChc(
        enemyMember,
        state,
        {
            id: `enemy:${state.id}`,
            changeTarget: 'enemy',
        },
    ))
}

const SPPR_STYL: Record<Exclude<SkillAggType, 'damage'>, { label: string; color: string }> = {
    healing: {
        label: 'Healing',
        color: 'var(--calc-support-healing-color)',
    },
    shield: {
        label: 'Shield',
        color: 'var(--calc-support-shield-color)',
    },
}

export const MPTYFEATCOND: RtChng[] = []

export function getSpprStyl(aggType?: SkillAggType) {
    if (!aggType || aggType === 'damage') {
        return null
    }

    return SPPR_STYL[aggType]
}

export function getFeatLblCl(meta?: FeatureMeta): string {
    // healing and shield features use support colors; damage features fall back to their element color.
    const supportStyle = getSpprStyl(meta?.ggrgType)
    if (supportStyle) {
        return supportStyle.color
    }

    return ATTR_COLORS[meta?.element ?? 'physical'] ?? '#6c6c6c'
}

export function getSkllMenuL(skill: SkillDef): string {
    return getFeatLblCl({
        label: skill.label,
        tab: skill.tab,
        archetype: skill.archetype,
        section: skill.sectionTitle,
        skillTypeLabel: getSkillType(skill.skillType).label,
        element: skill.element,
        ggrgType: skill.aggregationType,
        resonatorId: '',
        resName: '',
    })
}

export function defaultTabs(): Record<string, boolean> {
    return Object.fromEntries(ROT_SKILL_TABS.map((tab) => [tab, true]))
}

export function getFeatVar(feature: FeatDef): 'skill' | 'subHit' {
    return feature.variant === 'subHit' ? 'subHit' : 'skill'
}

export function getSubHitLbl(entry: SkillMenuEntry): string {
    return entry.featureLabel
}

export function formatNumber(raw: number): string {
    if (!Number.isFinite(raw) || raw === 0) {
        return '0'
    }

    const rounded = Math.floor(raw)
    if (rounded >= 1e9) return `${formatTruncCompact(rounded / 1e9, 1)}B`
    if (rounded >= 1e6) return `${formatTruncCompact(rounded / 1e6, 1)}M`
    return rounded.toLocaleString()
}

function sumTotals(entries: SimResult['perSkill']): NodeTotals {
    return entries.reduce(
        (total, entry) => {
            total.normal += entry.normal
            total.crit += entry.crit
            total.avg += entry.avg
            return total
        },
        { normal: 0, crit: 0, avg: 0 },
    )
}

function getFrstTrtnE(entries: SimResult['perSkill']): SimResult['perSkill'] {
    // repeated loop iterations are excluded from node totals so per-node damage
    // stays tied to the first executed pass rather than cumulative repeats.
    return entries.filter((entry) => {
        const loopRuns = entry.loopRuns ? Object.values(entry.loopRuns) : []
        return loopRuns.length === 0 || loopRuns.every((run) => run === 1)
    })
}

function sumFeatTtls(entries: SimResult['perSkill']): NodeTotals {
    return sumTotals(getFrstTrtnE(entries))
}

export function dsblByWhen(
    node: RotationNode,
    resultMap: Map<string, SimResult['perSkill']>,
): boolean {
    // a feature with a when rule and no first-iteration simulation entries is
    // treated as skipped even if the node itself remains enabled.
    if (node.type !== 'feature' || !node.when) {
        return false
    }

    return getFrstTrtnE(resultMap.get(node.id) ?? []).length === 0
}

export function hasTotals(totals: NodeTotals): boolean {
    return totals.normal !== 0 || totals.crit !== 0 || totals.avg !== 0
}

export function makeNodeId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}:${crypto.randomUUID()}`
    }

    return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

export function mkBlckNode(type: 'repeat' | 'uptime'): Extract<RotationNode, { type: 'repeat' | 'uptime' }> {
    if (type === 'repeat') {
        return {
            id: makeNodeId('rotation:repeat'),
            type: 'repeat',
            times: 1,
            items: [],
            enabled: true,
        }
    }

    return {
        id: makeNodeId('rotation:uptime'),
        type: 'uptime',
        ratio: 1,
        setup: [],
        items: [],
        enabled: true,
    }
}

export function getNodeTotals(node: RotationNode, resultMap: Map<string, SimResult['perSkill']>): NodeTotals {
    if (node.type === 'feature') {
        return sumFeatTtls(resultMap.get(node.id) ?? [])
    }

    if (node.type === 'condition') {
        return { normal: 0, crit: 0, avg: 0 }
    }

    if (node.type === 'loop') {
        return { normal: 0, crit: 0, avg: 0 }
    }

    const children = node.type === 'uptime' ? [...(node.setup ?? []), ...node.items] : node.items

    return children.reduce<NodeTotals>(
        (total, child) => {
            const childTotals = getNodeTotals(child, resultMap)
            total.normal += childTotals.normal
            total.crit += childTotals.crit
            total.avg += childTotals.avg
            return total
        },
        { normal: 0, crit: 0, avg: 0 },
    )
}

export function getNodeMemIc(
    node: RotationNode,
    runtime: ResRuntime,
    featMetaById: Record<string, FeatureMeta>,
    condChoices: CondChoice[],
): NodeMemIcon | null {
    if (node.type === 'condition') {
        const memberId =
            node.changes[0]?.resonatorId ??
            node.resonatorId ??
            condChoices.find((choice) => choice.state.path === node.changes[0]?.path)?.resonatorId
        const member = memberId ? seedRsntById[memberId] : null
        return member ? { name: member.name, profile: member.profile ?? '' } : null
    }

    if (runtime.rotation.view !== 'team') {
        return null
    }

    if (node.type === 'feature') {
        const memberId = node.resonatorId ?? featMetaById[node.featureId]?.resonatorId ?? runtime.id
        const member = seedRsntById[memberId]
        return member ? { name: member.name, profile: member.profile ?? '' } : null
    }

    const nodeResId = 'resonatorId' in node ? node.resonatorId : undefined
    if (!nodeResId) {
        return null
    }

    const member = seedRsntById[nodeResId]
    return member ? { name: member.name, profile: member.profile ?? '' } : null
}

export function getDjcnSkllI(skillId?: string): string | null {
    if (!skillId || !/^\d+$/.test(skillId)) {
        return null
    }

    return String(Number(skillId) + 1)
}

export function getPrvsSkllI(skillId?: string): string | null {
    if (!skillId || !/^\d+$/.test(skillId)) {
        return null
    }

    return String(Number(skillId) - 1)
}

export function isEntryNode(
    node: RotationNode | null | undefined,
): node is Extract<RotationNode, { type: 'feature' | 'condition' }> {
    return node?.type === 'feature' || node?.type === 'condition'
}

let trnsDragMg: HTMLCanvasElement | null = null

export function getTrnsDragM(): HTMLCanvasElement | null {
    if (typeof document === 'undefined') {
        return null
    }

    if (!trnsDragMg) {
        const canvas = document.createElement('canvas')
        canvas.width = 1
        canvas.height = 1
        trnsDragMg = canvas
    }

    return trnsDragMg
}


export const INLINE_MENU_WD = 184
export const INLINE_MENU_GAP = 8
export const INLINE_MENU_PAD = 12

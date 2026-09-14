/*
  Author: Runor Ewhro
  Description: Owns node tools behavior and state transitions for the shared module.
*/

import type {
    CondChoice,
    FeatureMeta, NodeTotals,
    EditConfig, SkillMenuEntry
} from "@/modules/simulation/features/rotation/shared/authoringTypes.ts";
import {createElement as mkElem} from "react";
import type {MenuEntry} from "@/shared/ui/CtxMenu.tsx";
import {Clipboard, Copy, CopyPlus, Scissors, SquareDashedMousePointer as SqrDshdMsPnt} from "lucide-react";
import type {ResRuntime} from "@/domain/entities/runtime.ts";
import type {
    FeatDef,
    RotationNode,
    RtChng,
    SourceState
} from "@/domain/gameData/contracts.ts";
import {isStateVisible} from "@/domain/services/sourceStateService.ts";
import {listStatesFor} from "@/domain/services/gameDataService.ts";
import {makeNodeId} from "@/domain/gameData/rotationNodeId.ts";
import {listEquippedSourceStates} from "@/domain/services/runtimeSourceService.ts";
import {negEffectsFor} from "@/domain/gameData/negativeEffects.ts";
import { getTuneStrainMaxForTeam } from '@/domain/gameData/tuneStrain.ts'
import {buildConditionChoices} from "@/modules/simulation/features/rotation/shared/conditions.tsx";
import type {SkillDef} from "@/domain/entities/stats.ts";
import type {SimResult} from "@/engine/pipeline/types.ts";
import { isDamageRotationEntry } from '@/engine/pipeline/rotationTotals.ts'
import { formatTruncCompact } from '@/shared/lib/number.ts'
import {
    DEFAULT_ROT_BLOCK_COLOR,
    scopeLabelAt,
} from '@/modules/simulation/features/rotation/shared/containerMeta.ts'
import {
    skillDisplayColor,
    supportSkillStyle,
} from '@/modules/simulation/features/rotation/shared/skillDisplay.ts'

function editMenu(config: EditConfig = {}): MenuEntry[] {
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
        config.duplicate
            ? {
                id: 'duplicate',
                label: 'Duplicate',
                icon: mkElem(CopyPlus, { size: 15 }),
                disabled: config.duplicate.disabled ?? !config.duplicate.onSelect,
                onSelect: config.duplicate.onSelect,
            }
            : null,
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

            if (!isStateVisible(memRt, memRt, state, actRt)) {
                continue
            }

            seenCntrKeys.add(state.controlKey)
            states.push(state)
        }
    }

    pushStates(listEquippedSourceStates(memRt))

    return states
}

function makeEnemyState(
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
    const tuneStrain = makeEnemyState(
        'tuneStrain',
        'Tune Strain',
        'enemy.status.tuneStrain',
        getTuneStrainMaxForTeam(runtime),
        'Set the target enemy Tune Strain stacks for following rotation actions.',
    )
    const negFfct = negEffectsFor(runtime)
        .filter((effect) => effect.sliderVisible)
        .map((effect) => makeEnemyState(
            effect.key,
            effect.label,
            `enemy.combat.${effect.key}`,
            effect.max,
            `Set the target enemy ${effect.label} stacks for following rotation actions.`,
        ))

    // per-enemy debuff states (toggles/stacks/selects authored in enemy source data); their
    // `enemy.status.<field>` paths route to the enemy overlay just like Tune Strain.
    const debuffStates = enemyId ? listStatesFor('enemy', enemyId) : []

    return [tuneStrain, ...negFfct, ...debuffStates].map((state) => buildConditionChoices(
        enemyMember,
        state,
        {
            id: `enemy:${state.id}`,
            changeTarget: 'enemy',
        },
    ))
}

export const EMPTY_FEATURE_CONDS: RtChng[] = []

export const getSpprStyl = supportSkillStyle

export function getFeatLblCl(meta?: FeatureMeta): string {
    // healing and shield features use support colors; damage features fall back to their element color.
    return skillDisplayColor({
        aggregationType: meta?.ggrgType ?? 'damage',
        element: meta?.element,
    })
}

export function getSkllMenuL(skill: SkillDef): string {
    return skillDisplayColor(skill)
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

function sumDamageFeatTtls(entries: SimResult['perSkill']): NodeTotals {
    return sumTotals(getFrstTrtnE(entries).filter(isDamageRotationEntry))
}

export function hasTotals(totals: NodeTotals): boolean {
    return totals.normal !== 0 || totals.crit !== 0 || totals.avg !== 0
}

export interface BlockNodeOptions {
    id?: string
    label?: string
    color?: string
    enabled?: boolean
}

export function makeBlockNode(type: 'repeat', options?: BlockNodeOptions): Extract<RotationNode, { type: 'repeat' }>
export function makeBlockNode(type: 'uptime', options?: BlockNodeOptions): Extract<RotationNode, { type: 'uptime' }>
export function makeBlockNode(type: 'repeat' | 'uptime', options?: BlockNodeOptions): Extract<RotationNode, { type: 'repeat' | 'uptime' }>
export function makeBlockNode(
    type: 'repeat' | 'uptime',
    options: BlockNodeOptions = {},
): Extract<RotationNode, { type: 'repeat' | 'uptime' }> {
    if (type === 'repeat') {
        return {
            id: options.id ?? makeNodeId('rotation:repeat'),
            type: 'repeat',
            label: options.label ?? scopeLabelAt('repeat', 1),
            color: options.color ?? DEFAULT_ROT_BLOCK_COLOR,
            times: 1,
            items: [],
            enabled: options.enabled ?? true,
        }
    }

    return {
        id: options.id ?? makeNodeId('rotation:uptime'),
        type: 'uptime',
        label: options.label ?? scopeLabelAt('uptime', 1),
        color: options.color ?? DEFAULT_ROT_BLOCK_COLOR,
        ratio: 1,
        setup: [],
        items: [],
        enabled: options.enabled ?? true,
    }
}

export function getNodeTotals(node: RotationNode, resultMap: Map<string, SimResult['perSkill']>): NodeTotals {
    if (node.type === 'feature') {
        return sumFeatTtls(resultMap.get(node.id) ?? [])
    }

    if (node.type === 'condition' || node.type === 'note') {
        return { normal: 0, crit: 0, avg: 0 }
    }

    if (node.type === 'loop') {
        return { normal: 0, crit: 0, avg: 0 }
    }

    const children = node.type === 'uptime' ? [...(node.setup ?? []), ...node.items] : node.items

    return children.reduce<NodeTotals>(
        (total, child) => {
            const childTotals = child.type === 'feature'
                ? sumDamageFeatTtls(resultMap.get(child.id) ?? [])
                : getNodeTotals(child, resultMap)
            total.normal += childTotals.normal
            total.crit += childTotals.crit
            total.avg += childTotals.avg
            return total
        },
        { normal: 0, crit: 0, avg: 0 },
    )
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

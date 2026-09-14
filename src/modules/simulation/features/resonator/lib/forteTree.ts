/*
  Author: Runor Ewhro
  Description: Owns forte tree behavior and state transitions for the lib module.
*/

import type { ResSeed } from '@/domain/entities/runtime.ts'
import { resInherentIcon, resNodeIcon } from '@/shared/lib/gameAssets.ts'
import { getResModeGroups } from '@/domain/gameData/resonatorStateGraph.ts'
import type { ResView, ResSldrSkllT } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { TRCNODEICONM, visibleTabs } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { skllLblMap } from '@/modules/simulation/features/resonator/lib/panel.ts'

type TraceNode = NonNullable<ResSeed['traceNodes']>[number]

export interface ForteTrace {
  id: string
  name: string
  value: string
  /* the sentence the catalog already authors for the node, "Crit. DMG
     increased by 5.60%.". the tree has only ever drawn the bare figure. */
  desc: string
  statIcon: string | null
}

export interface ForteInherent {
  name: string
  unlockLevel: number
  icon: string | null
}

export interface ForteBranch {
  key: ResSldrSkllT
  label: string
  icon: string
  /* how many columns out from the forte spine this branch hangs */
  rank: number
  /*
    which way round the arc it hangs, so the surface can place it without
    counting siblings. the five columns sit on a circle, one every 20 degrees,
    which is why the outer pair compresses horizontally and drops much further.
  */
  side: 'l2' | 'l1' | 'c' | 'r1' | 'r2'
  /* inner node first, then the outer one it gates */
  traces: ForteTrace[]
  inherents: ForteInherent[]
}

/*
  four of the five columns carry a pair of stat nodes and the middle one carries
  the inherents instead, which is why forteCircuit is absent from this list.
*/
const TRACE_BRANCHES: ResSldrSkllT[] = [
  'normalAttack',
  'resonanceSkill',
  'resonanceLiberation',
  'introSkill',
]

/* the middle column, which carries the inherents and docks the loose skills */
export const FORTE_SPINE: ResSldrSkllT = 'forteCircuit'

/* left to right, the way the game hangs the tree */
export const BRANCH_ORDER: ResSldrSkllT[] = [
  'normalAttack',
  'resonanceSkill',
  'forteCircuit',
  'resonanceLiberation',
  'introSkill',
]

/*
  the sigil the game hangs at the head of the tree for a resonator that fights
  in more than one resonance mode.
*/
export interface ForteMode {
  controlKey: string
  defaultValue: string
  options: Array<{ id: string; label: string; icon: string }>
}

/*
  only a mode the tree can actually draw qualifies: exactly two states the
  resonator switches between, each with its own art. that rules out phoebe,
  whose group is a status she can also be in neither of and which ships no
  icons, so her selector stays a plain control in the effects channel.
*/
export function mkForteMode(member: ResView): ForteMode | null {
  const group = getResModeGroups(member)
    .find((entry) => !entry.allowNone
      && entry.modes.length === 2
      && entry.modes.every((mode) => Boolean(mode.icon)))

  if (!group) {
    return null
  }

  return {
    controlKey: group.controlKey,
    defaultValue: group.defaultValue,
    options: group.modes.map((mode) => ({
      id: mode.id,
      label: mode.label,
      icon: mode.icon as string,
    })),
  }
}

function statIconFor(node: TraceNode, dark: boolean): string | null {
  const key = TRCNODEICONM[node.name]
  return key ? `/assets/game/skills/icons/${dark ? 'dark' : 'light'}/${key}.webp` : null
}

function toTrace(node: TraceNode, dark: boolean): ForteTrace {
  return {
    id: node.id,
    name: node.name,
    value: node.param?.[0] ?? '',
    desc: node.desc ?? '',
    statIcon: statIconFor(node, dark),
  }
}

/*
  the catalog lists every inner node before every outer one, so a column's pair
  is the node at i and the node half a list later. anything that does not divide
  cleanly is laid out as inner nodes only rather than mispaired.
*/
function traceColumns(nodes: TraceNode[], dark: boolean): ForteTrace[][] {
  const half = Math.floor(nodes.length / 2)
  if (half === 0) {
    return []
  }

  const paired = nodes.length === half * 2
  return Array.from({ length: half }, (_, index) => (
    paired
      ? [toTrace(nodes[index], dark), toTrace(nodes[index + half], dark)]
      : [toTrace(nodes[index], dark)]
  ))
}

export function mkForteTree(member: ResView, dark: boolean): ForteBranch[] {
  const columns = traceColumns(member.traceNodes ?? [], dark)
  const tabs = new Set(visibleTabs(member))
  const inherents: ForteInherent[] = (member.inherentSkills ?? []).map((skill, order) => ({
    name: skill.name,
    unlockLevel: Number(skill.unlockLevel) || 0,
    icon: resInherentIcon(member.id, order),
  }))

  const shown = BRANCH_ORDER.filter((key) => tabs.has(key))
  // the tree arches away from the spine, so every column carries how far out it
  // sits and the surface reads its own height from that instead of its position
  const spineAt = shown.indexOf(FORTE_SPINE)

  return shown.map((key, index) => {
    const traceIndex = TRACE_BRANCHES.indexOf(key)
    const step = spineAt < 0 ? 0 : index - spineAt
    const rank = Math.abs(step)
    return {
      key,
      label: skllLblMap[key] ?? key,
      icon: resNodeIcon(member.id, key),
      rank,
      side: (rank === 0 ? 'c' : `${step < 0 ? 'l' : 'r'}${rank}`) as ForteBranch['side'],
      traces: traceIndex >= 0 ? columns[traceIndex] ?? [] : [],
      inherents: key === FORTE_SPINE ? inherents : [],
    }
  })
}

/*
  the two skills the game hangs off the spine rather than in a column of their
  own. the outro skill has no level, so a docked skill states whether it is
  levelled instead of the surface guessing from the key.
*/
export interface ForteDock {
  key: ResSldrSkllT | 'outroSkill'
  label: string
  icon: string
  levelled: boolean
}

/*
  both dock nodes are drawn whatever the resonator: the outro skill carries no
  level and so never reaches the slider tabs, and tune break only survives them
  when its panel happens to hold more than one value. neither absence means the
  game stops drawing the node.
*/
export function mkForteDock(member: ResView): ForteDock[] {
  const levelled = new Set(visibleTabs(member))

  return [
    { key: 'outroSkill' as const, levelled: false },
    { key: 'tuneBreak' as const, levelled: levelled.has('tuneBreak') },
  ].map((entry) => ({
    ...entry,
    label: skllLblMap[entry.key] ?? entry.key,
    icon: resNodeIcon(member.id, entry.key),
  }))
}

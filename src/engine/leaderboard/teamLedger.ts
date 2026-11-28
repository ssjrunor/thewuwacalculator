/*
  Author: Runor Ewhro
  description: builds contribution.team from the scorer's existing run: every
               member's damage, and each teammate effect that reached the scored
               resonator with the share of its damage dealt while the effect was
               active. each hit's snapshot lists the effects reaching it; one pass
               without the stats pipeline finds them (exact for whether an effect
               is active), and each effect is labelled once, with stats, at the
               first hit it reached. hits sharing a state and skill are read once.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { SkillDef } from '@/domain/entities/stats'
import type { TeamBuff, TeamLedger } from '@/domain/leaderboard/api'
import { canonicalResonatorId } from '@/domain/rotationActions/identities'
import { makeStateSummary, type StateGroup } from '@/engine/effects/stateSummary'
import { getLoopAverageDivisor, isDamageRotationEntry, sumRotTtls } from '@/engine/pipeline/rotationTotals'
import { makeCombatGraph } from '@/engine/runtime/combatGraph'
import type { InspectEntry, ProgramResult } from '@/engine/rotation/runTypes'

// a hit the scored resonator's buffs are weighed over: every damage hit, its Tune Breaks too (fixed damage takes no
// buffs, and the state summary finds none reaching it)
const ownDamage = (entry: ProgramResult['entries'][number]) => isDamageRotationEntry(entry)

// a hit's state: who is on field and every member's controls
const stateKey = (snapshot: InspectEntry) => `${snapshot.activeResonatorId ?? ''}|${Object.values(snapshot.runtimeById ?? {})
  .map((runtime) => `${runtime.id}:${JSON.stringify(runtime.state.controls)}`).sort().join('|')}`

// "<main>X</main> <mod>Y <value>+15%</value></mod>" as its words and its value
function effectOf(label: string): { text: string; value: string } {
  const value = /effect-label-value[^>]*>([^<]*)</.exec(label)?.[1]?.trim() ?? ''
  const text = label.replace(/<span class="effect-label-value[^>]*>[^<]*<\/span>/, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return { text, value }
}

const nameOf = (label: string) => label.replace(/^Main Echo:\s*/, '')

export function teamLedger(result: ProgramResult, subject: ResRuntime, runtimesById: Record<string, ResRuntime>): TeamLedger {
  const subjectKey = canonicalResonatorId(subject.id)
  const memberIds = [...new Set([subject.id, ...Object.keys(runtimesById)])]
  const mates = memberIds.filter((id) => canonicalResonatorId(id) !== subjectKey)

  // the rotation editor's figures: one total over every damage row, Tune Break included, each loop averaged over its
  // passes (sumRotTtls), and each member's share counting the rows it cast, its Tune Breaks too
  const total = sumRotTtls(result.entries).avg
  const byMember = new Map(memberIds.map((id) => [canonicalResonatorId(id), 0]))
  for (const entry of result.entries) {
    const key = canonicalResonatorId(entry.resonatorId)
    if (isDamageRotationEntry(entry) && byMember.has(key)) byMember.set(key, byMember.get(key)! + entry.avg / getLoopAverageDivisor(entry.loopRunCounts))
  }
  // kept exact: displays truncate, never round up
  const members = memberIds.map((id) => ({ resonatorId: id, damage: byMember.get(canonicalResonatorId(id)) ?? 0 }))
  if (!mates.length) return { total, members, buffs: [] }

  const snapshots = new Map<string, InspectEntry[]>()
  for (const entry of result.inspection) {
    if (!entry.executed || !entry.runtimeById) continue
    const list = snapshots.get(entry.nodeId)
    if (list) list.push(entry)
    else snapshots.set(entry.nodeId, [entry])
  }

  const read = (snapshot: InspectEntry, skill: SkillDef, withoutStats: boolean, graph = null as ReturnType<typeof makeCombatGraph> | null): StateGroup[] => {
    const runtimes = snapshot.runtimeById!
    const target = runtimes[subject.id] ?? subject
    const active = runtimes[snapshot.activeResonatorId ?? target.id] ?? target
    return makeStateSummary(target, runtimes, graph, snapshot.selectedTargetsByRuntimeId?.[target.id] ?? null, {
      enemyProfile: snapshot.enemy, activeRuntime: active, skillTarget: { resonatorId: target.id, skill },
      sourceIds: mates, withoutStats,
    })
  }

  const onAt = new Map<string, string[]>()
  const weight = new Map<string, number>()
  const first = new Map<string, { snapshot: InspectEntry; skill: SkillDef }>()
  let weighed = 0
  for (const entry of result.entries) {
    if (!ownDamage(entry) || canonicalResonatorId(entry.resonatorId) !== subjectKey) continue
    const damage = entry.avg / getLoopAverageDivisor(entry.loopRunCounts)
    weighed += damage
    const runs = entry.nodeId ? snapshots.get(entry.nodeId) ?? [] : []
    for (const snapshot of runs) {
      const key = `${stateKey(snapshot)}|${entry.skill.id}`
      let on = onAt.get(key)
      if (!on) {
        on = read(snapshot, entry.skill, true).flatMap((group) => group.scopes.flatMap((scope) =>
          scope.nodes.filter((node) => node.effectLabels.length).map((node) => `${group.sourceId}|${node.id}`)))
        onAt.set(key, on)
      }
      for (const id of on) {
        weight.set(id, (weight.get(id) ?? 0) + damage / runs.length)
        if (!first.has(id)) first.set(id, { snapshot, skill: entry.skill })
      }
    }
  }

  // each effect labelled with stats once, at the first hit it reached; one read labels every effect on at that hit
  const buffs = new Map<string, TeamBuff>()
  for (const [id, { snapshot, skill }] of first) {
    if (buffs.has(id)) continue
    const runtimes = snapshot.runtimeById!
    const active = runtimes[snapshot.activeResonatorId ?? subject.id] ?? runtimes[subject.id] ?? subject
    const graph = makeCombatGraph({ actRt: active, partRts: runtimes,
      targetsByRes: { [active.id]: snapshot.selectedTargetsByRuntimeId?.[active.id] ?? {} } })
    for (const group of read(snapshot, skill, false, graph)) {
      for (const scope of group.scopes) {
        for (const node of scope.nodes) {
          const key = `${group.sourceId}|${node.id}`
          if (!weight.has(key) || buffs.has(key) || !node.effectLabels.length) continue
          buffs.set(key, { from: group.sourceId, source: { type: node.source.type, id: node.source.id }, name: nameOf(node.ownerLabel),
            kind: scope.label, effects: node.effectLabels.map(effectOf), covers: weighed > 0 ? weight.get(key)! / weighed * 100 : 0 })
        }
      }
    }
  }
  const order = new Map(mates.map((id, at) => [id, at]))
  return { total, members, buffs: [...buffs.values()].sort((a, b) => (order.get(a.from) ?? 9) - (order.get(b.from) ?? 9) || b.covers - a.covers) }
}

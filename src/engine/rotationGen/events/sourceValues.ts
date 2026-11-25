/*
  Author: Runor Ewhro
  description: resolves source Tune Break Boost for effects that capture it on activation.
*/

import type { RuntimeValue } from '../types'

/** source-stat snapshots for trigger inputs that scale with the source's stats. */
export function sourceTuneBreakBoost(fight: RuntimeValue, member: RuntimeValue): number {
  let value = member.source.baseTuneBreakBoost ?? 0
  if (member.source.weapon.secondary?.stat === 'tuneBreakBoost') value += member.source.weapon.secondary.value
  for (const echo of member.source.echoes.equipped) {
    for (const stat of [echo.mainStats?.primary, echo.mainStats?.secondary]) if (stat?.key === 'tuneBreakBoost') value += stat.value
    value += echo.substats?.tuneBreakBoost ?? 0
  }
  // only live effects applicable to the source member contribute to the captured Tune Break Boost value.
  for (const active of fight.effects) {
    if (active.until <= fight.frame || !['team', 'self'].includes(active.recipient) ||
      active.recipient === 'self' && active.target !== member.ruleset.resonatorId) continue
    const def = fight.effectDefinitions[active.id]
    for (const modifier of def.triggerModifiers ?? []) value += modifier.value * active.stacks
    for (const modifier of def.triggerModifiersPerStack ?? []) value += modifier.value * active.stacks
    if (active.stacks >= def.maxStacks) for (const modifier of def.triggerModifiersAtMax ?? []) value += modifier.value
  }
  return value
}

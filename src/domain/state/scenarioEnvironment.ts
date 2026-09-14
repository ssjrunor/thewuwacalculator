/*
  Author: Runor Ewhro
  Description: Creates combat environments and resolves authored manual
               effects against equal scenario-member subscriptions.
*/

import type {
  CombatEnvironment,
  EnvironmentManualEffect,
  EnvironmentMemberSelector,
  EnvironmentTargetModifiers,
  ScenarioTeamMember,
  TeamMemberId,
} from '@/domain/entities/combatScenario'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { cloneBuffs } from '@/domain/state/runtimeCloning'
import type { UnifiedBuffPool } from '@/domain/entities/stats'
import { mergeModBuff } from '@/engine/resolvers/buffPool'

export function makeEmptyManualBuffs(): ManualBuffs {
  return {
    quick: {
      atk: { flat: 0, percent: 0 },
      hp: { flat: 0, percent: 0 },
      def: { flat: 0, percent: 0 },
      critRate: 0,
      critDmg: 0,
      energyRegen: 0,
      healingBonus: 0,
    },
    modifiers: [],
  }
}

export function memberManualEffectId(memberId: TeamMemberId): string {
  return `member:${memberId}:manual`
}

export function makeMemberManualEffect(
  memberId: TeamMemberId,
  buffs: ManualBuffs,
): EnvironmentManualEffect {
  return {
    id: memberManualEffectId(memberId),
    enabled: true,
    selector: { kind: 'members', memberIds: [memberId] },
    buffs: cloneBuffs(buffs),
  }
}

export function makeCombatEnvironment(
  combatState: CombatEnvironment['combatState'],
  routing: CombatEnvironment['routing'],
  manualEffects: readonly EnvironmentManualEffect[] = [],
): CombatEnvironment {
  return {
    combatState: { ...combatState },
    manualEffects: manualEffects.map((effect) => ({
      ...effect,
      selector: structuredClone(effect.selector),
      buffs: cloneBuffs(effect.buffs),
    })),
    targetModifiers: {
      defenseReduction: 0,
      resistanceReduction: {},
      damageTakenAmplification: 0,
    },
    routing,
  }
}

export function environmentSelectorMatches(
  selector: EnvironmentMemberSelector,
  member: ScenarioTeamMember,
): boolean {
  if (selector.kind === 'all') return true
  if (selector.kind === 'members') return selector.memberIds.includes(member.id)

  const seed = getResSeedBy(member.resonatorId)
  if (!seed) return false
  if (selector.kind === 'attribute') return selector.attributes.includes(seed.attribute)
  return selector.weaponTypes.includes(seed.weaponType)
}

function mergeManualBuffs(target: ManualBuffs, source: ManualBuffs): void {
  target.quick.atk.flat += source.quick.atk.flat
  target.quick.atk.percent += source.quick.atk.percent
  target.quick.hp.flat += source.quick.hp.flat
  target.quick.hp.percent += source.quick.hp.percent
  target.quick.def.flat += source.quick.def.flat
  target.quick.def.percent += source.quick.def.percent
  target.quick.critRate += source.quick.critRate
  target.quick.critDmg += source.quick.critDmg
  target.quick.energyRegen += source.quick.energyRegen
  target.quick.healingBonus += source.quick.healingBonus
  target.modifiers.push(...source.modifiers.map((modifier) => ({ ...modifier })))
}

export function resolveEnvironmentManualBuffs(
  environment: CombatEnvironment,
  member: ScenarioTeamMember,
  excludedEffectIds: ReadonlySet<string> = new Set(),
): ManualBuffs {
  const resolved = makeEmptyManualBuffs()
  for (const effect of environment.manualEffects) {
    if (!excludedEffectIds.has(effect.id)
      && effect.enabled
      && environmentSelectorMatches(effect.selector, member)) {
      mergeManualBuffs(resolved, effect.buffs)
    }
  }

  return resolved
}

/** Apply target-owned encounter modifiers without turning them into attacker buffs. */
export function applyEnvironmentTargetModifiers(
  pool: UnifiedBuffPool,
  modifiers: EnvironmentTargetModifiers,
): void {
  pool.defShred += modifiers.defenseReduction
  pool.dmgVuln += modifiers.damageTakenAmplification
  for (const [attribute, value] of Object.entries(modifiers.resistanceReduction)) {
    if (!value) continue
    mergeModBuff(pool.attribute[attribute as keyof typeof pool.attribute], {
      resShred: value,
      dmgBonus: 0,
      amplify: 0,
      defIgnore: 0,
    })
  }
}

function subtractQuickBuffs(target: ManualBuffs, contribution: ManualBuffs): void {
  target.quick.atk.flat -= contribution.quick.atk.flat
  target.quick.atk.percent -= contribution.quick.atk.percent
  target.quick.hp.flat -= contribution.quick.hp.flat
  target.quick.hp.percent -= contribution.quick.hp.percent
  target.quick.def.flat -= contribution.quick.def.flat
  target.quick.def.percent -= contribution.quick.def.percent
  target.quick.critRate -= contribution.quick.critRate
  target.quick.critDmg -= contribution.quick.critDmg
  target.quick.energyRegen -= contribution.quick.energyRegen
  target.quick.healingBonus -= contribution.quick.healingBonus
}

/** Reverse the aggregate UI projection back into one member-authored source. */
export function extractMemberManualBuffs(
  environment: CombatEnvironment,
  member: ScenarioTeamMember,
  projected: ManualBuffs,
): ManualBuffs {
  const memberEffectId = memberManualEffectId(member.id)
  const other = resolveEnvironmentManualBuffs(
    environment,
    member,
    new Set([memberEffectId]),
  )
  const authored = cloneBuffs(projected)
  subtractQuickBuffs(authored, other)

  for (const contribution of other.modifiers) {
    let index = authored.modifiers.findIndex(
      (candidate) => JSON.stringify(candidate) === JSON.stringify(contribution),
    )
    if (index >= 0) {
      authored.modifiers.splice(index, 1)
      continue
    }

    // If the old UI edited the projected value, retain only its delta from
    // the environment source so the next aggregate projection reproduces the
    // value the user saw instead of double-applying the shared contribution.
    index = authored.modifiers.findIndex((candidate) => (
      candidate.id === contribution.id && candidate.scope === contribution.scope
    ))
    if (index < 0) continue
    const candidate = authored.modifiers[index]
    const value = candidate.value - contribution.value
    if (value === 0) authored.modifiers.splice(index, 1)
    else authored.modifiers[index] = { ...candidate, value }
  }
  return authored
}

export function replaceMemberManualEffect(
  environment: CombatEnvironment,
  memberId: TeamMemberId,
  buffs: ManualBuffs,
): CombatEnvironment {
  const id = memberManualEffectId(memberId)
  const effect = makeMemberManualEffect(memberId, buffs)
  const index = environment.manualEffects.findIndex((candidate) => candidate.id === id)
  const manualEffects = [...environment.manualEffects]
  if (index >= 0) manualEffects[index] = effect
  else manualEffects.push(effect)
  return { ...environment, manualEffects }
}

export function removeMemberEnvironmentState(
  environment: CombatEnvironment,
  memberId: TeamMemberId,
): CombatEnvironment {
  const manualEffects = environment.manualEffects
    .map((effect): EnvironmentManualEffect | null => {
      if (effect.id === memberManualEffectId(memberId)) return null
      if (effect.selector.kind !== 'members') return effect
      const memberIds = effect.selector.memberIds.filter((id) => id !== memberId)
      return memberIds.length > 0
        ? { ...effect, selector: { ...effect.selector, memberIds } }
        : null
    })
    .filter((effect): effect is EnvironmentManualEffect => Boolean(effect))

  const bySourceMemberId = { ...environment.routing.bySourceMemberId }
  delete bySourceMemberId[memberId]
  const routing = {
    bySourceMemberId: Object.fromEntries(Object.entries(bySourceMemberId).map(([sourceId, routes]) => [
      sourceId,
      Object.fromEntries(Object.entries(routes).filter(([, targetId]) => targetId !== memberId)),
    ])),
  } as CombatEnvironment['routing']

  return { ...environment, manualEffects, routing }
}

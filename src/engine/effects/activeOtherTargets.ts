/*
  Author: Runor Ewhro
  description: groups recipient-pinned effects by their source activation controls.
*/
import type { CondExpr, EffectDef } from '@/domain/gameData/contracts'

// activation conditions read source state; recipient eligibility and enemy state are evaluated when the buff applies.
function sourceCondition(condition?: CondExpr): CondExpr | undefined {
  if (!condition || condition.type === 'always') return condition
  if (condition.type === 'and' || condition.type === 'or') {
    const values = condition.values.map(sourceCondition).filter((value): value is CondExpr => !!value)
    return values.length ? { type: condition.type, values } : undefined
  }
  if (condition.type === 'not') {
    const value = sourceCondition(condition.value)
    return value ? { type: 'not', value } : undefined
  }
  if (condition.from === 'sourceRuntime') return condition
  if ((!condition.from || condition.from === 'context') && /^(runtime|sourceRuntime)\./.test(condition.path)) {
    return { ...condition, from: 'sourceRuntime', path: condition.path.replace(/^(runtime|sourceRuntime)\./, '') }
  }
  return undefined
}

export interface ActiveOtherTargetGroup {
  ownerKey: string
  condition: CondExpr
  paths: Set<string>
}

// an Active Other effect without an owner key uses its stable effect id for routing and activation grouping.
export function effectTargetOwnerKey(effect: EffectDef): string {
  return effect.ownerKey ?? (effect.targetScope === 'activeOther' ? effect.id : '')
}

export function activeOtherTargetGroups(effects: readonly EffectDef[]): ActiveOtherTargetGroup[] {
  const groups = new Map<string, CondExpr[]>()
  for (const effect of effects) {
    if (effect.targetScope !== 'activeOther') continue
    const ownerKey = effectTargetOwnerKey(effect)
    const conditions = groups.get(ownerKey) ?? []
    conditions.push(sourceCondition(effect.condition) ?? { type: 'always' })
    groups.set(ownerKey, conditions)
  }
  // effects with the same owner share one activation condition; register every source path that can change that condition.
  return [...groups].map(([ownerKey, conditions]) => {
    const condition: CondExpr = { type: 'or', values: conditions }
    const paths = new Set<string>()
    const visit = (entry: CondExpr) => {
      if (entry.type === 'and' || entry.type === 'or') entry.values.forEach(visit)
      else if (entry.type === 'not') visit(entry.value)
      else if (entry.type !== 'always') paths.add(entry.path.replace(/^runtime\./, ''))
    }
    visit(condition)
    return { ownerKey, condition, paths }
  })
}

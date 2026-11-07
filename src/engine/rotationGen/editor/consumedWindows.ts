/*
  Author: Runor Ewhro
  description: normalizes control writes around features that consume an effect.
*/

import type { RuntimeValue } from '../types'

const key = (owner: RuntimeValue, path: string) => `${owner ?? ''}|${path}`
const plainSetter = (node: RuntimeValue): RuntimeValue => node?.type === 'condition' && node.enabled !== false &&
  !node.label && !node.note && node.changes?.length === 1 && node.changes[0].type === 'set'
  ? node.changes[0] : null

function withoutConditions(feature: RuntimeValue, removed: RuntimeValue[]): RuntimeValue {
  const remaining = feature.attached.conditions.filter((condition: RuntimeValue) => !removed.includes(condition))
  const next = { ...feature }
  if (remaining.length || feature.attached.features?.length) next.attached = { ...feature.attached, conditions: remaining }
  else delete next.attached
  return next
}

/** a consumed window still covers its consuming attack. replace an adjacent
 * clear + local restorations with a clear after the covered feature run. if
 * the next cast immediately restores it, keep the window continuous instead.
 * only same-owner boolean controls with plain local setters are eligible. */
export function settleConsumedWindows(items: RuntimeValue[], pinnedPaths = new Set<string>()): RuntimeValue[] {
  const values = new Map<string, RuntimeValue>(), out: RuntimeValue[] = []
  for (let index = 0; index < items.length; index++) {
    const node = items[index], change = plainSetter(node)
    const owner = change?.resonatorId ?? node.resonatorId
    const control = change && key(owner, change.path)
    if (change?.value === false && change.path.startsWith('runtime.state.controls.') &&
      values.get(control) === true && !pinnedPaths.has(control)) {
      const covered: RuntimeValue[] = []
      let end = index + 1
      for (; end < items.length; end++) {
        const feature = items[end]
        if (feature.type !== 'feature' || feature.enabled === false || String(feature.resonatorId) !== String(owner) ||
          feature.attached?.features?.length) break
        const conditions = feature.attached?.conditions ?? []
        const restores = conditions.filter((condition: RuntimeValue) => {
          const local = plainSetter(condition)
          return local?.path === change.path && local.value === true &&
            String(local.resonatorId ?? condition.resonatorId ?? feature.resonatorId) === String(owner)
        })
        if (!restores.length) break
        // conflicting writes in one attachment cannot be treated as a restoration.
        if (conditions.some((condition: RuntimeValue) => condition.changes?.some((local: RuntimeValue) =>
          local.path === change.path && !restores.includes(condition)))) break
        covered.push(withoutConditions(feature, restores))
      }
      if (covered.length) {
        out.push(...covered)
        // other control updates between the consuming attack and reactivation
        // do not observe this window. keep their order while removing the pair.
        let restoreAt = end
        while (plainSetter(items[restoreAt]) && !items[restoreAt].changes.some((write: RuntimeValue) =>
          key(write.resonatorId ?? items[restoreAt].resonatorId, write.path) === control)) restoreAt++
        const restored = plainSetter(items[restoreAt])
        const immediateRestore = restored?.path === change.path && restored.value === true &&
          String(restored.resonatorId ?? items[restoreAt].resonatorId) === String(owner)
        if (!immediateRestore) { out.push(node); values.set(control, false) }
        // leave intervening writes to the normal state-tracking path below.
        if (immediateRestore) items = [...items.slice(0, restoreAt), ...items.slice(restoreAt + 1)]
        index = end - 1
        continue
      }
    }
    // remove a repeated local setter only when its tracked value matches and no conflicting attachment writes the same path.
    const redundant = node.type === 'feature' && node.enabled !== false ? (node.attached?.conditions ?? [])
      .filter((condition: RuntimeValue) => {
        const local = plainSetter(condition)
        const localOwner = local?.resonatorId ?? condition.resonatorId ?? node.resonatorId
        const slot = local && key(localOwner, local.path)
        return local?.path.startsWith('runtime.state.controls.') && !pinnedPaths.has(slot) &&
          values.has(slot) && values.get(slot) === local.value &&
          !node.attached.conditions.some((other: RuntimeValue) => other !== condition && other.changes?.some((write: RuntimeValue) =>
            key(write.resonatorId ?? other.resonatorId ?? node.resonatorId, write.path) === slot &&
            (write.type !== 'set' || write.value !== local.value)))
      }) : []
    out.push(redundant.length ? withoutConditions(node, redundant) : node)
    if (node.type === 'condition' && node.enabled !== false) for (const write of node.changes ?? []) {
      const slot = key(write.resonatorId ?? node.resonatorId, write.path)
      if (write.type === 'set') values.set(slot, write.value)
      else values.delete(slot)
    }
  }
  return out
}

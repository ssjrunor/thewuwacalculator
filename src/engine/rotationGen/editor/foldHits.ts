/*
  Author: Runor Ewhro
  description: combines adjacent hit nodes when they reproduce a parent feature.
*/

import type { RuntimeValue } from '../types.ts'

// row ids do not identify local setter behavior. fold only setters with the
// same target, order, and value; keep notes, labels, and child attacks separate.
function attachmentKey(node: RuntimeValue): string | null {
  if (node.note || node.label) return null
  if (!node?.attached) return ''
  const { conditions, features } = node.attached
  if (!Array.isArray(conditions) || features?.length) return null
  const writes = []
  for (const condition of conditions) {
    if (condition.type !== 'condition' || condition.enabled === false || condition.note || condition.label ||
      !condition.changes?.length) return null
    for (const change of condition.changes) {
      if (change.type !== 'set' || !change.path?.startsWith('runtime.state.controls.')) return null
      const owner = change.resonatorId ?? condition.resonatorId ?? node.resonatorId
      writes.push(Object.fromEntries(Object.entries({ ...change, resonatorId: owner }).sort(([a], [b]) => a.localeCompare(b))))
    }
  }
  return JSON.stringify(writes)
}

/**
 * a sub-hit feature represents one hit-table row. combine adjacent hits into
 * the parent feature when they cover every row at its full count and have no
 * intervening condition, note, or feature. retain partial or interrupted runs.
 */
export function foldHitRuns(items: RuntimeValue[], sources: RuntimeValue): { items: RuntimeValue[], folded: number } {
  type Shape = { parent: string, need: Map<string, number>, total: number }
  const shapes = new Map<string, Shape | null>()
  const shapeFor = (owner: string, featureId: string): Shape | null => {
    const key = `${owner}|${featureId}`
    if (shapes.has(key)) return shapes.get(key) ?? null
    const source = sources[owner]?.source
    const feature = source?.features.find((entry: RuntimeValue) => entry.id === featureId)
    let shape: Shape | null = null
    if (feature?.variant === 'subHit') {
      const skill = source.skills?.find((entry: RuntimeValue) => entry.id === feature.skillId)
      const rows = skill?.hitTable ?? []
      const subHits = source.features.filter((entry: RuntimeValue) =>
        entry.skillId === feature.skillId && entry.variant === 'subHit')
      const parent = source.features.find((entry: RuntimeValue) =>
        entry.skillId === feature.skillId && entry.variant !== 'subHit')
      // require one sub-hit feature for each hit-table row.
      if (parent && rows.length && subHits.length === rows.length &&
        subHits.every((entry: RuntimeValue) => rows[entry.hitIndex] != null) &&
        new Set(subHits.map((entry: RuntimeValue) => entry.hitIndex)).size === rows.length) {
        const need = new Map<string, number>(subHits.map((entry: RuntimeValue) =>
          [entry.id, Number(rows[entry.hitIndex].count ?? 1)]))
        shape = { parent: parent.id, need, total: [...need.values()].reduce((sum, count) => sum + count, 0) }
      }
    }
    shapes.set(key, shape)
    return shape
  }
  const plain = (node: RuntimeValue, owner: string, first: boolean) => node?.type === 'feature' &&
    String(node.resonatorId) === owner && node.enabled !== false && (node.multiplier ?? 1) === 1 &&
    attachmentKey(node) !== null && (first || !node.offTuneResume)

  const out: RuntimeValue[] = []
  let folded = 0
  for (let index = 0; index < items.length;) {
    const node = items[index]
    const owner = String(node.resonatorId)
    const shape = node.type === 'feature' ? shapeFor(owner, node.featureId) : null
    if (shape && plain(node, owner, true)) {
      const attachments = attachmentKey(node)
      const run = items.slice(index, index + shape.total)
      const counts = new Map<string, number>()
      for (const hit of run) if (plain(hit, owner, hit === node) && attachmentKey(hit) === attachments) {
        counts.set(hit.featureId, (counts.get(hit.featureId) ?? 0) + 1)
      }
      if (run.length === shape.total && [...shape.need].every(([id, count]) => counts.get(id) === count) &&
        [...counts.keys()].every(id => shape.need.has(id))) {
        out.push({ ...node, featureId: shape.parent })
        folded += shape.total - 1
        index += shape.total
        continue
      }
    }
    out.push(node)
    index++
  }
  return { items: out, folded }
}

const isTuneBreak = (node: RuntimeValue) => node?.type === 'feature' && /:tune-break$/.test(node.featureId)

/** nodes after a Tune Break that no resume mark ends, where the seal counts feature nodes. */
function countedSpans(items: RuntimeValue[]): boolean[] {
  const counted = new Array<boolean>(items.length).fill(false)
  let open: number | null = null
  const close = (end: number, marked: boolean) => {
    if (open != null && !marked) for (let index = open + 1; index < end; index++) counted[index] = true
    open = null
  }
  items.forEach((node, index) => {
    if (isTuneBreak(node)) { close(index, false); open = index }
    else if (node?.type === 'feature' && node.offTuneResume) close(index, true)
  })
  close(items.length, false)
  return counted
}

/**
 * the same feature played several times in a row, with nothing between the
 * plays (no condition, note or other feature), becomes one node whose
 * multiplier is the sum of theirs: damage and Off-Tune buildup are linear in
 * the multiplier and no state changes between the plays. an Off-Tune resume
 * mark may only lead a run, and nothing folds after a Tune Break that no
 * resume mark ends, since the default resume counts feature nodes.
 */
export function foldRepeats(items: RuntimeValue[]): { items: RuntimeValue[], folded: number } {
  const counted = countedSpans(items)
  const foldable = (node: RuntimeValue) => node?.type === 'feature' && attachmentKey(node) !== null && !isTuneBreak(node) &&
    (node.multiplier ?? 1) > 0
  const out: RuntimeValue[] = []
  let folded = 0
  items.forEach((node, index) => {
    const previous = out.at(-1)
    if (!counted[index] && foldable(node) && foldable(previous) && !node.offTuneResume &&
      previous.featureId === node.featureId && String(previous.resonatorId) === String(node.resonatorId) &&
      attachmentKey(previous) === attachmentKey(node) &&
      (previous.enabled !== false) === (node.enabled !== false)) {
      out[out.length - 1] = { ...previous, multiplier: (previous.multiplier ?? 1) + (node.multiplier ?? 1) }
      folded++
      return
    }
    out.push(node)
  })
  return { items: out, folded }
}

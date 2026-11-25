/*
  Author: Runor Ewhro
  description: applies the editor's rotation cleanup to generated rotations:
               generated nodes become cleanup sections, the shared planner runs
               until nothing changes, and the result converts back.
*/

import type { RotationNode, RtChng } from '@/domain/gameData/contracts.ts'
import { ACTIVE_RESONATOR_PATH } from '@/domain/gameData/rotationPaths.ts'
import type { OpeningChoice } from '@/engine/rotation/openingChoices.ts'
import {
  applyRotationCleanup,
  cleanupCounts,
  planRotationCleanup,
  type CleanupCounts,
  type CleanupNode,
  type CleanupSection,
} from '@/engine/rotation/cleanup.ts'

interface GeneratedSection extends CleanupSection {
  marker?: RotationNode
}

// state key of a write: resonator (or owner) plus NUL plus path, the same key the planner uses
function writeKey(change: RtChng, owner?: string): string {
  return `${change.resonatorId ?? owner ?? ''}\u0000${change.path}`
}

/*
  convert generated nodes into cleanup sections, one per plan-section marker.
  a condition's prior value comes from earlier plain sets in the same section, and
  swaps, features and section markers clear the known values. no damage results or
  game-data registry are read here, so gates and source checks are off.
*/
function buildSections(items: readonly RotationNode[], choices: readonly OpeningChoice[]): GeneratedSection[] {
  const sections: GeneratedSection[] = [{ children: [] }]
  const known = new Map<string, RtChng['value']>()
  for (const sourceNode of items) {
    if (sourceNode.type === 'note' && /^__plan_section_\d+__$/.test(sourceNode.text)) {
      sections.push({ marker: sourceNode, children: [] })
      known.clear()
      continue
    }
    const base = { id: sourceNode.id, sourceNode, disabled: 'enabled' in sourceNode && sourceNode.enabled === false }
    let node: CleanupNode
    if (sourceNode.type === 'note') node = { ...base, type: 'note' }
    else if (sourceNode.type === 'condition') {
      const owner = sourceNode.resonatorId
      const active = sourceNode.changes.find(change => change.path === ACTIVE_RESONATOR_PATH)
      if (active) {
        node = { ...base, type: 'swap', sourceNode, to: String(active.value) }
        known.clear()
      } else {
        const change = sourceNode.changes.length === 1 ? sourceNode.changes[0] : undefined
        const key = change && writeKey(change, owner)
        const prior = key && known.has(key) ? { value: known.get(key)! } : undefined
        const state = choices.find(choice => choice.state.path === change?.path &&
          (choice.changeTarget || choice.resonatorId === owner))?.state
        node = { ...base, type: 'condition', owner: { kind: 'member', memberId: owner }, change, prior, state }
        if (!base.disabled) for (const write of sourceNode.changes) {
          const key = writeKey(write, owner)
          if (write.type === 'set') known.set(key, write.value)
          else known.delete(key)
        }
      }
    } else if (sourceNode.type === 'feature') {
      const memberId = sourceNode.resonatorId ?? ''
      node = { ...base, type: 'step', owner: { kind: 'member', memberId }, memberId,
        changes: sourceNode.attached?.conditions?.filter(condition => condition.enabled !== false)
          .flatMap(condition => condition.changes.map(change => ({ ...change,
            resonatorId: change.resonatorId ?? condition.resonatorId }))) }
      // features can change combat state, so clear the known values after them
      known.clear()
    } else {
      throw new Error(`Unexpected generated node before pass packing: ${sourceNode.type}`)
    }
    sections.at(-1)!.children.push(node)
  }
  return sections
}

/*
  convert a cleanup node back to its rotation node. an edited skill keeps only the
  attached conditions with a matching remaining change, and attached features are
  copied unchanged.
*/
function serialize(node: CleanupNode): RotationNode {
  const source = node.sourceNode!
  if (node.type !== 'step' || source.type !== 'feature' || !node.changesEdited) return source
  const conditions = source.attached?.conditions?.filter(condition => condition.changes.some(change =>
    node.changes?.some(remaining => remaining.type === change.type && remaining.path === change.path &&
      remaining.resonatorId === (change.resonatorId ?? condition.resonatorId) && Object.is(remaining.value, change.value)))) ?? []
  const features = source.attached?.features ?? []
  const next = { ...source }
  if (conditions.length || features.length) next.attached = { ...source.attached, conditions, features }
  else delete next.attached
  return next
}

/**
 * cleans each authored pass separately and repeats until no plan applies; packSections later stores each cleaned pass
 * as its own loop fork. activeOtherControls uses `owner|path` keys, and matching writes are not moved or merged.
 */
export function cleanupGeneratedRotation(items: RotationNode[], activeOtherControls: ReadonlySet<string> = new Set(), choices: readonly OpeningChoice[] = []): { items: RotationNode[]; counts: CleanupCounts } {
  let current = items
  const counts = { inert: 0, dead: 0, redundant: 0, reordered: 0, detached: 0, total: 0 }
  // each applied plan removes a row or an attached setter, so the input size bounds the pass count
  const limit = items.length + items.reduce((sum, node) => sum +
    (node.type === 'feature' ? node.attached?.conditions?.length ?? 0 : 0), 0)
  for (let pass = 0; pass <= limit; pass++) {
    const sections = buildSections(current, choices)
    const plan = planRotationCleanup(sections, { recipientSensitivePaths:
      new Set([...activeOtherControls].map(key => key.replace('|', '\u0000'))) })
    if (!plan.targets.length) return { items: current, counts }
    const cleaned = applyRotationCleanup(sections, plan)
    if (cleaned === sections) throw new Error('Generated rotation cleanup made no progress')
    const applied = cleanupCounts(plan)
    for (const key of Object.keys(counts) as Array<keyof CleanupCounts>) counts[key] += applied[key]
    current = cleaned.flatMap(section => [...section.marker ? [section.marker] : [], ...section.children.map(serialize)])
  }
  throw new Error('Generated rotation cleanup did not converge')
}

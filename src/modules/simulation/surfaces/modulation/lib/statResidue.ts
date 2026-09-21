/*
  Author: Runor Ewhro
  Description: Separates scoped stat modifiers into row addends and independently inspectable residue rows.
*/

import type { StatTreeNode } from '@/modules/simulation/model/statsView.ts'

export interface ScopedAddend {
  /* scope + modifier is the identity: one scope can reach several modifiers */
  id: string
  scopeKey: string
  scopeLabel: string
  color?: string
  displayValue: string
  value: number
}

export interface ResidueRow {
  key: string
  label: string
  /* null where the modifier has no unconditional form to state */
  displayValue: string | null
  value: number
  scoped: ScopedAddend[]
}

export interface StatResidue {
  rows: ResidueRow[]
  /* keyed by the sheet row's own stat key */
  scopedByStat: Map<string, ScopedAddend[]>
  /* every addend the sheet does not already state, for the group's count */
  scopedCount: number
}

/* the five combat scalars the sheet prints as Secondary rows */
const SHEET_SCALARS = new Set([
  'critRate', 'critDmg', 'energyRegen', 'healingBonus', 'tuneBreakBoost',
])

/* the scopes whose DMG Bonus the sheet already states. `all` is in both lists
   because makeStatsView folds the universal bucket into every one of its rows,
   so restating it here would count it twice. */
const SHEET_DMG_SCOPES = new Set([
  'all',
  'aero', 'glacio', 'spectro', 'fusion', 'electro', 'havoc',
  'basicAtk', 'heavyAtk', 'resonanceSkill', 'resonanceLiberation',
])

/* a modifier that qualifies a row the sheet already prints goes under it */
const ON_SHEET_ROW: Record<string, string> = {
  critRate: 'critRate',
  critDmg: 'critDmg',
}

const SCOPE_BRANCHES = new Set(['attribute', 'skillType'])

export function makeStatResidue(statsTree: StatTreeNode[]): StatResidue {
  const rows = new Map<string, ResidueRow>()
  const scopedByStat = new Map<string, ScopedAddend[]>()
  let scopedCount = 0

  const ensureRow = (key: string, label: string): ResidueRow => {
    let row = rows.get(key)
    if (!row) {
      row = { key, label, displayValue: null, value: 0, scoped: [] }
      rows.set(key, row)
    }
    return row
  }

  /* the unconditional half: every combat scalar the sheet leaves unsaid */
  for (const node of statsTree) {
    if (node.kind !== 'branch' || node.key !== 'combat') continue
    for (const leaf of node.children) {
      if (leaf.kind !== 'leaf' || SHEET_SCALARS.has(leaf.key)) continue
      const row = ensureRow(leaf.key, leaf.label)
      row.displayValue = leaf.displayValue
      row.value = leaf.value
    }
  }

  /* the scoped half */
  for (const node of statsTree) {
    if (node.kind !== 'branch' || !SCOPE_BRANCHES.has(node.key)) continue
    for (const scope of node.children) {
      if (scope.kind !== 'branch') continue
      for (const leaf of scope.children) {
        if (leaf.kind !== 'leaf' || leaf.value === 0) continue
        if (leaf.key === 'dmgBonus' && SHEET_DMG_SCOPES.has(scope.key)) continue

        const addend: ScopedAddend = {
          id: `${scope.key}:${leaf.key}`,
          scopeKey: scope.key,
          scopeLabel: scope.label,
          color: scope.color,
          displayValue: leaf.displayValue,
          value: leaf.value,
        }
        scopedCount += 1

        const sheetRow = ON_SHEET_ROW[leaf.key]
        if (sheetRow) {
          const list = scopedByStat.get(sheetRow) ?? []
          list.push(addend)
          scopedByStat.set(sheetRow, list)
          continue
        }

        ensureRow(leaf.key, leaf.label).scoped.push(addend)
      }
    }
  }

  /* a row the build actually reaches reads before the dormant ones, the way the
     sheet's own groups sort what moved to the front */
  const ordered = [...rows.values()].sort((left, right) => {
    const leftLive = Number(left.value !== 0 || left.scoped.length > 0)
    const rightLive = Number(right.value !== 0 || right.scoped.length > 0)
    return rightLive - leftLive
  })

  return { rows: ordered, scopedByStat, scopedCount }
}

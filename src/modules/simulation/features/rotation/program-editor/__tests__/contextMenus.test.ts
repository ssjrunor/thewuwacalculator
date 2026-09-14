/*
  Author: Runor Ewhro
  Description: Verifies context menus logic and compatibility invariants.
*/

import { describe, expect, it, vi } from 'vitest'
import type { MenuEntry } from '@/shared/ui/CtxMenu.tsx'
import type {
  EditorBlock,
  EditorNote,
  EditorStep,
} from '@/modules/simulation/features/rotation/program-editor/model/program.ts'
import {
  makeSelectionMenu,
  makeRowMenu,
  type RowCtxActions,
} from '@/modules/simulation/features/rotation/program-editor/interaction/contextMenus.tsx'

const step: EditorStep = {
  type: 'step',
  id: 'step-1',
  owner: { kind: 'member', memberId: 'res-a' },
  label: 'Skill',
  index: 0,
  featureId: 'damage:skill',
  multiplier: 1,
  damageByRun: {},
  statsByRun: {},
  memberId: 'res-a',
  kindLabel: 'Skill',
  buffCount: 0,
}

const loop: EditorBlock = {
  type: 'loop',
  id: 'loop-1',
  loopId: 'loop-a',
  owner: { kind: 'member', memberId: 'res-a' },
  label: 'Loop',
  runs: 2,
  nodeCount: 0,
  children: [],
}

const note: EditorNote = {
  type: 'note',
  id: 'note-1',
  label: 'Timing',
  text: 'Delay this line.',
}

function rowMenu(overrides: Partial<RowCtxActions> = {}): MenuEntry[] {
  return makeRowMenu({
    node: step,
    canLift: true,
    onLoopify: vi.fn(),
    onBlockify: vi.fn(),
    onRemoveEnd: vi.fn(),
    onToggleEnabled: vi.fn(),
    onDelete: vi.fn(),
    edit: {
      copy: { onSelect: vi.fn() },
      cut: { onSelect: vi.fn() },
      paste: { onSelect: vi.fn() },
      duplicate: { onSelect: vi.fn() },
      select: { onSelect: vi.fn() },
    },
    ...overrides,
  })
}

const idsOf = (entries: MenuEntry[]) => entries.flatMap((entry) =>
  entry.type === 'separator' ? [] : [entry.id.replace(/^rte-ctx:[^:]+:/, '')])

const entryOf = (entries: MenuEntry[], name: string) => entries.find((entry) =>
  entry.type !== 'separator' && entry.id.endsWith(name))

describe('the menu a row offers', () => {
  it('offers what the inspector offers, edit actions last', () => {
    expect(idsOf(rowMenu())).toEqual([
      'loopify',
      'blockify',
      'enabled',
      'delete',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'select',
    ])
  })

  /* only a loop has an end to take away */
  it('offers removing the end on a loop and nowhere else', () => {
    expect(idsOf(rowMenu({ node: loop }))[0]).toBe('remove-end')
    expect(idsOf(rowMenu())).not.toContain('remove-end')
  })

  it('has nothing to remove on a loop already written without an end', () => {
    const entry = entryOf(rowMenu({ node: { ...loop, noEnd: true } }), 'remove-end')

    expect(entry && entry.type !== 'separator' ? entry.disabled : null).toBe(true)
  })

  it('says which way a disabled row would go', () => {
    const off = entryOf(rowMenu({ node: { ...step, disabled: true } }), ':enabled')
    const on = entryOf(rowMenu(), ':enabled')

    expect(off && off.type !== 'separator' ? off.label : null).toBe('Enable')
    expect(on && on.type !== 'separator' ? on.label : null).toBe('Disable')
  })

  /*
    a piece of a loop is not a node of its own, so it cannot be wrapped in
    something or copied whole
  */
  it('refuses to wrap a row that cannot be lifted', () => {
    const entries = rowMenu({ canLift: false })
    const loopify = entryOf(entries, 'loopify')
    const blockify = entryOf(entries, 'blockify')

    expect(loopify && loopify.type !== 'separator' ? loopify.disabled : null).toBe(true)
    expect(blockify && blockify.type !== 'separator' ? blockify.disabled : null).toBe(true)
  })

  it('has nothing to offer on a setup branch', () => {
    const setup: EditorBlock = { ...loop, type: 'setup', id: 'setup-1', label: 'Setup' }

    expect(rowMenu({ node: setup })).toEqual([])
  })

  it('offers notes only their clipboard, selection, and delete actions', () => {
    expect(idsOf(rowMenu({ node: note }))).toEqual([
      'delete',
      'cut',
      'copy',
      'paste',
      'duplicate',
      'select',
    ])
  })
})

describe('the menu a palette tile offers', () => {
  it('names what it adds and where a press would put it', () => {
    const withRow = makeSelectionMenu({
      label: 'Liberation',
      hasSelection: true,
      onAdd: vi.fn(),
      onAddAtEnd: vi.fn(),
    })
    const [add, atEnd] = withRow

    expect(add.type !== 'separator' ? add.label : null).toBe('Add Liberation')
    expect(add.type !== 'separator' ? add.hint : null).toBe('After the selected row')
    expect(atEnd.type !== 'separator' ? atEnd.disabled : null).toBe(false)
  })

  /* with nothing selected a press already adds at the end, so the second
     entry would do the same thing twice */
  it('drops the second place to add when both would be the same', () => {
    const [add, atEnd] = makeSelectionMenu({
      label: 'Liberation',
      hasSelection: false,
      onAdd: vi.fn(),
      onAddAtEnd: vi.fn(),
    })

    expect(add.type !== 'separator' ? add.hint : null).toBe('At the end')
    expect(atEnd.type !== 'separator' ? atEnd.disabled : null).toBe(true)
  })
})

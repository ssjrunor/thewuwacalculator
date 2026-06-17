import { describe, expect, it, vi } from 'vitest'
import { routeCtxBuilder } from '@/shared/context-menu/routeCtxBuilders.tsx'

describe('route context menu undo/redo builders', () => {
  it('renders labeled undo and redo submenus that target stack indexes', () => {
    const onUndoTo = vi.fn()
    const onRedoTo = vi.fn()
    const entries = routeCtxBuilder.routeChrome.undoRedo({
      canUndo: true,
      canRedo: true,
      undoHistory: [
        { label: 'Updated Equipped Echoes' },
        { label: 'Changed Theme' },
      ],
      redoHistory: [
        { label: 'Opened Optimizer' },
      ],
      onUndoTo,
      onRedoTo,
    })

    const undoEntry = entries[0]
    const redoEntry = entries[1]
    if (undoEntry?.type === 'separator' || redoEntry?.type === 'separator') {
      throw new Error('expected undo/redo menu items')
    }

    expect(undoEntry.label).toBe('Undo')
    expect(undoEntry.submenu).toMatchObject([
      { label: 'Updated Equipped Echoes' },
      { label: 'Changed Theme' },
    ])

    expect(redoEntry.label).toBe('Redo')
    expect(redoEntry.submenu).toMatchObject([
      { label: 'Opened Optimizer' },
    ])

    const undoSubmenu = undoEntry.submenu
    const redoSubmenu = redoEntry.submenu
    if (!Array.isArray(undoSubmenu) || !Array.isArray(redoSubmenu)) {
      throw new Error('expected array submenus')
    }

    if (undoSubmenu[1]?.type !== 'separator') {
      undoSubmenu[1]?.onSelect?.({
        data: null,
        eventTarget: null,
        clientX: 0,
        clientY: 0,
        close: vi.fn(),
      })
    }
    if (redoSubmenu[0]?.type !== 'separator') {
      redoSubmenu[0]?.onSelect?.({
        data: null,
        eventTarget: null,
        clientX: 0,
        clientY: 0,
        close: vi.fn(),
      })
    }

    expect(onUndoTo).toHaveBeenCalledWith(1)
    expect(onRedoTo).toHaveBeenCalledWith(0)
  })
})

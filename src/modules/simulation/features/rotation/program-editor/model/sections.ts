/*
  Author: Runor Ewhro
  Description: Keeps the editor's Preamble/Main presentation over the same
               flat node sequence consumed by the pane and simulation engine.
*/

import type { RotationNode } from '@/domain/gameData/contracts.ts'

interface RotationItemSection {
  id: string
  title: string
  meta?: string
  items: RotationNode[]
}

function withoutEditorSection(node: RotationNode): RotationNode {
  const next = { ...node }
  delete next.editorSection
  if ('note' in next && next.note) {
    next.note = withoutEditorSection(next.note) as typeof next.note
  }

  if (next.type === 'repeat') {
    next.setup = next.setup?.map(withoutEditorSection)
    next.items = next.items.map(withoutEditorSection)
  } else if (next.type === 'uptime') {
    next.setup = next.setup?.map(withoutEditorSection)
    next.items = next.items.map(withoutEditorSection)
  }
  return next
}

export function markEditorSection(
  items: RotationNode[],
  sectionId: string,
): RotationNode[] {
  return items.map((item) => {
    const next = withoutEditorSection(item)
    return sectionId === 'preamble'
      ? { ...next, editorSection: 'preamble' }
      : next
  })
}

export function splitEditorSections(items: RotationNode[]): RotationItemSection[] {
  return [
    {
      id: 'preamble',
      title: 'Preamble',
      meta: '',
      items: items.filter((item) => item.editorSection === 'preamble'),
    },
    {
      id: 'main',
      title: 'Main',
      meta: '',
      items: items.filter((item) => item.editorSection !== 'preamble'),
    },
  ]
}

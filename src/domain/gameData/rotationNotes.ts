/*
  Author: Runor Ewhro
  Description: Implements rotation notes data-flow and calculation invariants.
*/

import type { RotationNode, RotationNoteNode } from '@/domain/gameData/contracts.ts'

export type RotationNoteHost = Exclude<
  RotationNode,
  RotationNoteNode | Extract<RotationNode, { type: 'loop'; kind: 'end' }>
>

export function isRotationNote(node: RotationNode): node is RotationNoteNode {
  return node.type === 'note'
}

export function isRotationNoteHost(node: RotationNode): node is RotationNoteHost {
  return node.type !== 'note' && (node.type !== 'loop' || node.kind === 'start')
}

/** Attach once; callers must explicitly detach before assigning another note. */
export function attachRotationNote<T extends RotationNoteHost>(
  node: T,
  note: RotationNoteNode,
): T {
  return node.note ? node : { ...node, note }
}

export function detachRotationNote<T extends RotationNoteHost>(node: T): T {
  if (!node.note) {
    return node
  }
  const { note: _note, ...rest } = node
  void _note
  return rest as T
}

/** Remove standalone and attached notes while preserving executable structure. */
export function stripRotationNotes(items: readonly RotationNode[]): RotationNode[] {
  return items.flatMap((node): RotationNode[] => {
    if (isRotationNote(node)) {
      return []
    }

    let withoutNote: RotationNode = node
    if (isRotationNoteHost(node)) {
      const { note: _note, ...rest } = node
      void _note
      withoutNote = rest as RotationNode
    }
    if (withoutNote.type === 'feature' && withoutNote.attached) {
      return [{
        ...withoutNote,
        attached: {
          conditions: stripRotationNotes(withoutNote.attached.conditions) as Extract<
            RotationNode,
            { type: 'condition' }
          >[],
          features: stripRotationNotes(withoutNote.attached.features) as Extract<
            RotationNode,
            { type: 'feature' }
          >[],
        },
      }]
    }
    if (withoutNote.type === 'repeat') {
      return [{ ...withoutNote, items: stripRotationNotes(withoutNote.items) }]
    }
    if (withoutNote.type === 'uptime') {
      return [{
        ...withoutNote,
        ...(withoutNote.setup ? { setup: stripRotationNotes(withoutNote.setup) } : {}),
        items: stripRotationNotes(withoutNote.items),
      }]
    }
    if (withoutNote.type === 'loop' && withoutNote.kind === 'start' && withoutNote.passForks) {
      return [{
        ...withoutNote,
        passForks: Object.fromEntries(
          Object.entries(withoutNote.passForks).map(([run, body]) => [
            run,
            stripRotationNotes(body),
          ]),
        ),
      }]
    }
    return [withoutNote]
  })
}

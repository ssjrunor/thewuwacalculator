/*
  Author: Runor Ewhro
  Description: Shared drag payload contracts and drag-image construction for
               the rotation editor palette and node list.
*/

import type { PaletteSpec } from '@/modules/simulation/surfaces/rotation/program-editor/model/paletteSpec.ts'

export const PALETTE_MIME = 'application/x-rte-palette'

/*
  DataTransfer payloads are unreadable until drop, but `types` can be read
  during dragover. The kind is duplicated as a bare type so restricted targets
  can reject incompatible palette entries before drop.
*/
export const KIND_MIME: Record<PaletteSpec['kind'], string> = {
  step: 'application/x-rte-kind-step',
  condition: 'application/x-rte-kind-condition',
}

/** An extent drag moves where a block ends; nothing is picked up. */
export const EXTENT_MIME = 'application/x-rte-extent'

export function buildGhostPill(
  { art, label, note, accent }: { art?: string; label: string; note?: string; accent?: string },
  host: Element,
  count = 1,
): HTMLElement {
  const pill = document.createElement('div')
  pill.className = 'rte-ghost'
  if (accent) {
    pill.style.setProperty('--rte-res', accent)
  }

  if (art) {
    const image = document.createElement('img')
    image.className = 'rte-ghost__art'
    image.src = art
    image.alt = ''
    pill.appendChild(image)
  } else {
    const dot = document.createElement('i')
    dot.className = 'rte-ghost__dot'
    pill.appendChild(dot)
  }

  const name = document.createElement('span')
  name.className = 'rte-ghost__name'
  name.textContent = label
  pill.appendChild(name)

  if (note) {
    const tail = document.createElement('b')
    tail.className = 'rte-ghost__note'
    tail.textContent = note
    pill.appendChild(tail)
  }

  if (count < 2) {
    host.appendChild(pill)
    return pill
  }

  const tally = document.createElement('b')
  tally.className = 'rte-ghost__n'
  tally.textContent = String(count)
  pill.appendChild(tally)

  const stack = document.createElement('div')
  stack.className = 'rte-ghost-stack'
  if (accent) {
    stack.style.setProperty('--rte-res', accent)
  }

  for (let depth = Math.min(count - 1, 2); depth > 0; depth -= 1) {
    const sheet = document.createElement('i')
    sheet.className = 'rte-ghost-stack__sheet'
    sheet.style.setProperty('--rte-lift', `${depth * 3}px`)
    sheet.style.opacity = String(1 - depth * 0.22)
    stack.appendChild(sheet)
  }

  stack.appendChild(pill)
  host.appendChild(stack)
  return stack
}

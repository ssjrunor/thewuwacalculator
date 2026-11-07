/*
  Author: Runor Ewhro
  description: groups generated nodes into the opener and three later rotation passes.
*/

import type { RuntimeValue } from './types.ts'
/** preserve the opener and each later pass, with an independently generated preamble. */
export function packSections(items?: RuntimeValue): RuntimeValue {
  const preamble: RuntimeValue = [], sections: RuntimeValue = [[], [], [], []]
  let section = -1
  for (const node of items) {
    const match = node.type === 'note' && /^__plan_section_(\d+)__$/.exec(node.text)
    if (match) { section = Number(match[1]); continue }
    if (section < 0) preamble.push(node)
    else {
      if (!sections[section]) throw new Error(`Invalid reference section ${section}`)
      sections[section].push(node)
    }
  }
  // the first section is the loop body; later authored sections become explicit pass forks without duplicating the preamble.
  const loopId = 'plan:cycle'
  return [...preamble,
    { id: `${loopId}:start`, type: 'loop', enabled: true, kind: 'start', loopId,
      label: 'Opener and loops', runs: 4,
      passForks: Object.fromEntries(sections.slice(1).map((body?: RuntimeValue, index?: RuntimeValue): RuntimeValue => [index + 2, body])) },
    ...sections[0],
    { id: `${loopId}:end`, type: 'loop', enabled: true, kind: 'end', loopId },
  ]
}

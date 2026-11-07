/*
  Author: Runor Ewhro
  description: writes opening conditions and selects the first active resonator.
*/

import type { RuntimeValue } from '../types.ts'
import type { OpeningValue } from '../../../domain/gameData/rotationPreambleDefaults.ts'
import { openingWrites, type OpeningChoice } from '../../rotation/openingChoices.ts'
import { ACTIVE_RESONATOR_PATH } from '../../../domain/gameData/rotationPaths.ts'

/**
 * the editor's Generate Preamble over its own state choices: every opening
 * state once, then the handoff to the starting member. `values` overrides an
 * opening value (a resonance mode the rotation is built for).
 */
export function buildTeamPreamble(
  choices: readonly OpeningChoice[] | undefined,
  startOwner: RuntimeValue,
  values?: (choice: OpeningChoice) => OpeningValue | undefined,
): RuntimeValue {
  if (!choices?.length) throw new Error('Editor state choices are required')
  // enemy and team changes already identify their destination in the path; member changes also record their source id.
  const items: RuntimeValue = openingWrites(choices, values).map(({ choice, value }, index) => {
    const owner = choice.changeTarget ? null : String(choice.resonatorId)
    return { id: `kit:team:preamble:${index + 1}`, type: 'condition', enabled: true,
      ...(owner ? { resonatorId: owner } : {}),
      changes: [{ type: 'set', path: choice.state.path, value, ...(owner ? { resonatorId: owner } : {}) }],
      editorSection: 'preamble' }
  })
  // write the initial active member after all opening controls, matching the editor's preamble order.
  items.push({ id: `ruleset:team:preamble:${items.length + 1}`, type: 'condition', enabled: true,
    changes: [{ type: 'set', path: ACTIVE_RESONATOR_PATH, value: String(startOwner) }],
    editorSection: 'preamble' })
  return items
}

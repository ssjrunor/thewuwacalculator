/*
  Author: Runor Ewhro
  Description: Projects authored condition changes into runtime write summaries and cleanup evidence.
*/

import type { RtChng } from '@/domain/gameData/contracts.ts'
import type { CondChoice } from '@/modules/simulation/surfaces/rotation/shared/authoringTypes.ts'
import {
  formatStateValue,
  getCondChoice,
} from '@/modules/simulation/surfaces/rotation/shared/conditions.tsx'
import type { StateWrite } from './program.ts'

/** Project authored state changes into the compact write labels shown by rows. */
export function writesFromChanges(
  source: RtChng[] | undefined,
  condChoices: CondChoice[],
  nodeId: string,
  owner: string,
): StateWrite[] | undefined {
  const changes = source ?? []
  if (changes.length === 0) {
    return undefined
  }

  return changes.map((change, index) => {
    const choice = getCondChoice(condChoices, change, owner)
    const label = choice?.label ?? change.path.split('.').pop() ?? 'State'

    if (change.type === 'add') {
      return {
        id: `${nodeId}:w${index}`,
        label,
        value: `${change.value >= 0 ? '+' : ''}${change.value}`,
        rising: change.value >= 0,
      }
    }

    const raw = change.value
    const value = choice ? formatStateValue(choice.state, raw) : String(raw ?? '')
    return {
      id: `${nodeId}:w${index}`,
      label,
      value: value === 'True' ? 'on' : value === 'False' ? 'off' : value,
      rising: raw === true || (typeof raw === 'number' && raw > 0),
    }
  })
}

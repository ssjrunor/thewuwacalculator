/*
  Author: Runor Ewhro
  description: resonator identity for action plans and rule files: both rover
               forms are one identity, named by the male form.
*/

import { roverIdForGender, roverPairFor } from '../entities/roverGender.ts'

export const canonicalResonatorId = (id: string | number): string => roverIdForGender(String(id), 'male')

/** the ids that name the same resonator: itself first, then its other rover form. */
export function resonatorForms(id: string | number): string[] {
  const own = String(id)
  const pair = roverPairFor(own)
  return pair ? [own, pair.male === own ? pair.female : pair.male] : [own]
}

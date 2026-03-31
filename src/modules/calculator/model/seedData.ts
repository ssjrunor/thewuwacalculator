/*
  Author: Runor Ewhro
  Description: re-exports resonator seed collections for convenient access
               in ui and domain layers.
*/

import { listResonatorSeeds, resonatorSeedsById } from '@/domain/services/resonatorSeedService'

// eager list of all registered resonator seeds
export const seedResonators = listResonatorSeeds()

// direct id -> seed lookup map re-exported from the seed service
export const seedResonatorsById = resonatorSeedsById
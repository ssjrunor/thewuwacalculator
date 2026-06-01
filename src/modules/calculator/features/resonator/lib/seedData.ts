/*
  Author: Runor Ewhro
  Description: re-exports resonator seed collections for convenient access
               in ui and domain layers.
*/

import { listResSds, resSdsById } from '@/domain/services/resonatorSeedService.ts'

// eager list of all registered resonator seeds
export const seedRsnt = listResSds()

// direct id -> seed lookup map re-exported from the seed service
export const seedRsntById = resSdsById
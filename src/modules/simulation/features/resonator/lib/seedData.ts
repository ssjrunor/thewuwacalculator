/*
  Author: Runor Ewhro
  Description: Exposes resonator seed collections through the Simulation feature boundary.
*/

import { listResSds, resSdsById } from '@/data/catalog/resonatorSeedService.ts'

// eager list of all registered resonator seeds
export const seedRsnt = listResSds()

// direct id -> seed lookup map re-exported from the seed service
export const seedRsntById = resSdsById

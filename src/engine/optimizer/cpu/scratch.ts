/*
  Author: Runor Ewhro
  Description: allocates reusable cpu-side scratch buffers for combo
               evaluation so the optimizer can avoid per-iteration
               allocations during tight loops.
*/

import {
  ECHOES_PER_SET,
  SET_SLOT_COUNT,
  FULL_STAT_STRIDE,
} from '@/engine/optimizer/config/constants.ts'

export interface CpuScratch {
  comboIds: Int32Array
  cmbPstn: Int32Array
  baseCmbVctr: Float32Array
  comboVector: Float32Array
  setCounts: Uint8Array
  tchdSetIds: Uint8Array
  setMasks: Uint32Array
}

// create one reusable scratch object for cpu combo evaluation
export function makeCpuScratch(): CpuScratch {
  return {
    // current combo echo indices
    comboIds: new Int32Array(ECHOES_PER_SET),

    // optional positional mapping for combo processing
    cmbPstn: new Int32Array(ECHOES_PER_SET),

    // summed combo stats before main-echo-only buffs are applied
    baseCmbVctr: new Float32Array(FULL_STAT_STRIDE),

    // final combo stats after main-echo-only buffs are applied
    comboVector: new Float32Array(FULL_STAT_STRIDE),

    // per-set piece counts for the active combo
    setCounts: new Uint8Array(SET_SLOT_COUNT),

    // which set ids were touched so clearing can stay cheap
    tchdSetIds: new Uint8Array(ECHOES_PER_SET),

    // reusable set masks for encoded set logic
    setMasks: new Uint32Array(SET_SLOT_COUNT),
  }
}

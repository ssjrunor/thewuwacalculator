/*
  Author: Runor Ewhro
  Description: allocates reusable cpu-side scratch buffers for combo
               evaluation so the optimizer can avoid per-iteration
               allocations during tight loops.
*/

import {
  OPTIMIZER_ECHOS_PER_COMBO,
  OPTIMIZER_SET_SLOTS,
  OPTIMIZER_STATS_PER_ECHO,
} from '@/engine/optimizer/config/constants.ts'

export interface CpuScratch {
  comboIds: Int32Array
  comboPositions: Int32Array
  baseComboVector: Float32Array
  comboVector: Float32Array
  setCounts: Uint8Array
  touchedSetIds: Uint8Array
  setMasks: Uint32Array
}

// create one reusable scratch object for cpu combo evaluation
export function createCpuScratch(): CpuScratch {
  return {
    // current combo echo indices
    comboIds: new Int32Array(OPTIMIZER_ECHOS_PER_COMBO),

    // optional positional mapping for combo processing
    comboPositions: new Int32Array(OPTIMIZER_ECHOS_PER_COMBO),

    // summed combo stats before main-echo-only buffs are applied
    baseComboVector: new Float32Array(OPTIMIZER_STATS_PER_ECHO),

    // final combo stats after main-echo-only buffs are applied
    comboVector: new Float32Array(OPTIMIZER_STATS_PER_ECHO),

    // per-set piece counts for the active combo
    setCounts: new Uint8Array(OPTIMIZER_SET_SLOTS),

    // which set ids were touched so clearing can stay cheap
    touchedSetIds: new Uint8Array(OPTIMIZER_ECHOS_PER_COMBO),

    // reusable set masks for encoded set logic
    setMasks: new Uint32Array(OPTIMIZER_SET_SLOTS),
  }
}

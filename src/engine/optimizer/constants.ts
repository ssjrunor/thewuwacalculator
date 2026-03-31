/*
  Author: Runor Ewhro
  Description: Central optimizer constants for cost limits, batch sizing,
               worker counts, vector packing, execution tuning, and packed
               context field offsets shared across CPU/GPU pipelines.
*/

// hard limits and job sizing targets
export const ECHO_OPTIMIZER_MAX_COST = 12
export const ECHO_OPTIMIZER_BATCH_SIZE_CAP = 500_000_000
export const ECHO_OPTIMIZER_JOB_TARGET_COMBOS_GPU = 20_000_000
export const ECHO_OPTIMIZER_JOB_TARGET_COMBOS_ROTATION_GPU = 20_000_000

// structural packing sizes used throughout the optimizer
export const OPTIMIZER_ECHOS_PER_COMBO = 5
export const OPTIMIZER_SET_SLOTS = 32
export const OPTIMIZER_CONTEXT_FLOATS = 36
export const OPTIMIZER_STATS_PER_ECHO = 30
export const OPTIMIZER_MAIN_ECHO_BUFFS_PER_ECHO = OPTIMIZER_STATS_PER_ECHO

// packed stat-vector indices for encoded echo stats / buffs
export const OPTIMIZER_VEC_ATK_PERCENT = 0
export const OPTIMIZER_VEC_ATK_FLAT = 1
export const OPTIMIZER_VEC_HP_PERCENT = 2
export const OPTIMIZER_VEC_HP_FLAT = 3
export const OPTIMIZER_VEC_DEF_PERCENT = 4
export const OPTIMIZER_VEC_DEF_FLAT = 5
export const OPTIMIZER_VEC_CRIT_RATE = 6
export const OPTIMIZER_VEC_CRIT_DMG = 7
export const OPTIMIZER_VEC_ENERGY_REGEN = 8
export const OPTIMIZER_VEC_HEALING_BONUS = 9
export const OPTIMIZER_VEC_SHIELD_BONUS = 10
export const OPTIMIZER_VEC_DMG_BONUS = 11
export const OPTIMIZER_VEC_AMPLIFY = 12
export const OPTIMIZER_VEC_FLAT_DMG = 13
export const OPTIMIZER_VEC_SPECIAL = 14
export const OPTIMIZER_VEC_FUSION_BURST_MULTIPLIER = 15
export const OPTIMIZER_VEC_TUNE_BREAK_BOOST = 16
export const OPTIMIZER_VEC_RES_SHRED = 17
export const OPTIMIZER_VEC_DEF_IGNORE = 18
export const OPTIMIZER_VEC_DEF_SHRED = 19
export const OPTIMIZER_VEC_DMG_VULN = 20

// numeric archetype codes used by packed contexts and shader / evaluator logic
export const OPTIMIZER_ARCHETYPE_DAMAGE = 0
export const OPTIMIZER_ARCHETYPE_HEALING = 1
export const OPTIMIZER_ARCHETYPE_SHIELD = 2
export const OPTIMIZER_ARCHETYPE_TUNE_RUPTURE = 3
export const OPTIMIZER_ARCHETYPE_SPECTRO_FRAZZLE = 4
export const OPTIMIZER_ARCHETYPE_AERO_EROSION = 5
export const OPTIMIZER_ARCHETYPE_FUSION_BURST = 6

// detect available CPU cores in the browser and leave one free when possible
const detectedCores =
    typeof navigator !== 'undefined'
        ? (navigator.hardwareConcurrency ?? 4)
        : 4

const cpuWorkerTarget = Math.max(1, detectedCores - 1)

// worker counts for each backend
export const OPTIMIZER_WORKER_COUNT_GPU = 1
export const OPTIMIZER_WORKER_COUNT_CPU = Math.min(6, cpuWorkerTarget)

// derive a CPU-side per-job target that scales with worker count,
// then clamp it so work chunks stay within a practical range
const cpuJobTarget = 25_000 + OPTIMIZER_WORKER_COUNT_CPU * 5_000
export const ECHO_OPTIMIZER_JOB_TARGET_COMBOS_CPU = Math.min(75_000, cpuJobTarget)

// when low-memory mode is enabled, only keep a smaller result window
export const OPTIMIZER_LOW_MEMORY_RESULTS_LIMIT = 64

// GPU target-skill execution tuning
export const OPTIMIZER_WORKGROUP_SIZE = 256
export const OPTIMIZER_CYCLES_PER_INVOCATION = 32

// reduction fan-in used by target.wgsl and reduceCandidates.wgsl
// this must stay synchronized with the shader constants.
export const OPTIMIZER_REDUCE_K = 8

// GPU rotation execution tuning
export const OPTIMIZER_ROTATION_WORKGROUP_SIZE = 512
export const OPTIMIZER_ROTATION_CYCLES_PER_INVOCATION = 16
export const OPTIMIZER_ROTATION_REDUCE_K = 8

// packed optimizer context offsets
// these constants define the meaning of each float slot in the packed context array
export const OPTIMIZER_CTX_BASE_ATK = 0
export const OPTIMIZER_CTX_BASE_HP = 1
export const OPTIMIZER_CTX_BASE_DEF = 2
export const OPTIMIZER_CTX_BASE_ER = 3
export const OPTIMIZER_CTX_FINAL_ATK = 4
export const OPTIMIZER_CTX_FINAL_HP = 5
export const OPTIMIZER_CTX_FINAL_DEF = 6
export const OPTIMIZER_CTX_SCALING_ATK = 8
export const OPTIMIZER_CTX_SCALING_HP = 9
export const OPTIMIZER_CTX_SCALING_DEF = 10
export const OPTIMIZER_CTX_SCALING_ER = 11
export const OPTIMIZER_CTX_MULTIPLIER = 12
export const OPTIMIZER_CTX_FLAT_DMG = 13
export const OPTIMIZER_CTX_RES_MULT = 14
export const OPTIMIZER_CTX_DEF_MULT = 15
export const OPTIMIZER_CTX_DMG_REDUCTION = 16
export const OPTIMIZER_CTX_DMG_BONUS = 17
export const OPTIMIZER_CTX_DMG_AMPLIFY = 18
export const OPTIMIZER_CTX_DMG_VULN = 19
export const OPTIMIZER_CTX_CRIT_RATE = 20
export const OPTIMIZER_CTX_CRIT_DMG = 21
export const OPTIMIZER_CTX_TOGGLES = 22
export const OPTIMIZER_CTX_SKILL_ID = 23
export const OPTIMIZER_CTX_META0 = 24
export const OPTIMIZER_CTX_META1 = 25
export const OPTIMIZER_CTX_LOCKED_PACKED = 26
export const OPTIMIZER_CTX_BASE_INDEX = 27
export const OPTIMIZER_CTX_SET_RUNTIME_MASK = 28
export const OPTIMIZER_CTX_DISPATCH_WORKGROUP_BASE = 29
export const OPTIMIZER_CTX_COMBO_N = 30
export const OPTIMIZER_CTX_AUX0 = 31
export const OPTIMIZER_CTX_ARCHETYPE = 32

// aliases for fields reused under multiple semantic names
export const OPTIMIZER_CTX_SPECIAL = OPTIMIZER_CTX_DMG_VULN
export const OPTIMIZER_CTX_COMBAT_0 = OPTIMIZER_CTX_AUX0

// eh... it's convenient
export const WORKER_COUNT = {
  cpu: OPTIMIZER_WORKER_COUNT_CPU,
  gpu: OPTIMIZER_WORKER_COUNT_GPU,
} as const

// below this threshold, parallel overhead may outweigh the benefit
export const OPTIMIZER_MIN_PARALLEL_COMBOS = 20_000
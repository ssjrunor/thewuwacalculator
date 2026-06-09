/*
  Author: Runor Ewhro
  Description: Central optimizer constants for cost limits, batch sizing,
               worker counts, vector packing, execution tuning, and packed
               context field offsets shared across CPU/GPU pipelines.
*/

// hard limits and job sizing targets
export const MAX_ECHO_COST = 12
export const OPT_BATCH_SIZE = 50_000_000
export const TARGET_GPU_JOB = 20_000_000
export const ROT_GPU_JOB = 10_000_000

// structural packing sizes used throughout the optimizer
export const ECHOES_PER_SET = 5
export const SET_SLOT_COUNT = 33
export const CTX_FLOATS = 36
// ECHO_STAT_STRIDE is the live search encoding (encode/echoes.ts and the
// target/rotation cpu evaluators + gpu shaders read it): echo-rollable stats
// plus the per-element and per-skill-type damage-bonus buckets.
//
// FULL_STAT_STRIDE is the wider damage-stat vector spanning the global STAT_*
// index space (amplify, shreds, dmg vulnerability, etc.). it backs the combo
// scratch vectors and the cpu reference evaluator (cpu/computeDamage).
export const ECHO_STAT_STRIDE = 20
export const FULL_STAT_STRIDE = 30
export const MAIN_BUFF_LEN = 18
export const MAIN_FIRST = -2

// packed stat-vector indices for encoded echo stats / buffs
export const STAT_ATK_PCT = 0
export const STAT_ATK_FLAT = 1
export const STAT_HP_PCT = 2
export const STAT_HP_FLAT = 3
export const STAT_DEF_PCT = 4
export const STAT_DEF_FLAT = 5
export const STAT_CRIT_RATE = 6
export const STAT_CRIT_DMG = 7
export const STAT_ENERGY = 8
export const STAT_HEAL_BON = 9
export const STAT_SHIELD_BON = 10
export const STAT_DMG_BONUS = 11
export const STAT_AMPLIFY = 12
export const STAT_FLAT_DMG = 13
export const STAT_SPECIAL = 14
export const STAT_FUSION_RES = 15
export const STAT_TUNE_BREAK = 16
export const STAT_RES_SHRED = 17
export const STAT_DEF_IGNORE = 18
export const STAT_DEF_SHRED = 19
export const STAT_DMG_VULN = 20

// numeric archetype codes used by packed contexts and shader / evaluator logic
export const ARCH_DAMAGE = 0
export const ARCH_HEAL = 1
export const ARCH_SHIELD = 2
export const ARCH_TUNE = 3
export const ARCH_SPECTRO = 4
export const ARCH_AERO = 5
export const ARCH_FUSION = 6
export const ARCH_ELECTRO = 7
export const ARCH_GLACIO = 8
export const ARCH_HACK = 9

// detect available CPU cores in the browser and leave one free when possible
const detectedCores =
    typeof navigator !== 'undefined'
        ? (navigator.hardwareConcurrency ?? 4)
        : 4

const cpuWorkerTarget = Math.max(1, detectedCores - 1)

// worker counts for each backend
export const GPU_WORKERS = 1
export const CPU_WORKERS = Math.min(6, cpuWorkerTarget)

// derive a CPU-side per-job target that scales with worker count,
// then clamp it so work chunks stay within a practical range
const cpuJobTarget = 25_000 + CPU_WORKERS * 5_000
export const CPU_JOB_SIZE = Math.min(75_000, cpuJobTarget)
export const CPU_THEORY_JOB = 100_000
export const GPU_THEORY_JOB = 1_000_000

// GPU target-skill execution tuning
export const OPT_WG_SIZE = 256
export const CYCLES_PER_CALL = 32

// GPU rotation execution tuning
export const ROT_WG_SIZE = 512
export const ROT_CYCLES = 16

// per-workgroup reduction fan-in. must stay synchronized with REDUCE_K in
// target.wgsl, rotation.wgsl, and reduceCandidates.wgsl.
export const GPU_REDUCE_K = 8
export const OPT_RDC_K = GPU_REDUCE_K

// combo-mode flag passed to the batch shaders (COMBO_MODE_BATCH).
export const GPU_COMBO_MODE_BATCH = 3

// upper bound on candidates read back to the cpu before the gpu reduce pass
// runs. below this, every emitted candidate is read back and the cpu collector
// selects the exact top-k; the lossy gpu reduction only runs above it.
export const GPU_BATCH_MAX_READBACK = 1 << 21

// packed optimizer context offsets
// these constants define the meaning of each float slot in the packed context array
export const BASE_ATK = 0
export const BASE_HP = 1
export const BASE_DEF = 2
export const BASE_ER = 3
export const FINAL_ATK = 4
export const FINAL_HP = 5
export const FINAL_DEF = 6
export const SCALING_ATK = 8
export const SCALING_HP = 9
export const SCALING_DEF = 10
export const SCALING_ER = 11
export const MV = 12
export const FLAT_DMG = 13
export const RES_MUL = 14
export const DEF_MUL = 15
export const DMG_RED = 16
export const DMG_BNS = 17
export const DMG_AMP = 18
export const DMG_VULN = 19
export const CRIT_RATE = 20
export const CRIT_DMG = 21
export const TOGGLES = 22
export const SKILL_ID = 23
export const META0 = 24
export const META1 = 25
export const LOCKED_PACKED = 26
export const BASE_INDEX = 27
export const SET_MASK = 28
export const WORKGROUP_BASE = 29
export const COMBO_N = 30
export const AUX0 = 31
export const ARCHETYPE = 32

// aliases for fields reused under multiple semantic names
export const OPT_CTX_SPEC = DMG_VULN
export const OPT_COMBAT_AUX = AUX0

// eh... it's convenient
export const WORKER_COUNT = {
  cpu: CPU_WORKERS,
  gpu: GPU_WORKERS,
} as const

// set to false to silence all [optimizer:*] console output
// hard lock for now
export const OPT_LOGGING = false //Boolean(import.meta.env?.DEV)

// below this threshold, parallel overhead may outweigh the benefit
export const MIN_PAR_COMBOS = 20_000

export const WEAPON_OVERLAY_SLOTS = [
  BASE_ATK,
  FINAL_ATK,
  FINAL_HP,
  FINAL_DEF,
  BASE_ER,
  CRIT_RATE,
  CRIT_DMG,
  DMG_BNS,
  DMG_AMP,
  MV,
  FLAT_DMG,
  AUX0,
  RES_MUL,
  DEF_MUL,
  DMG_RED,
  DMG_VULN,
] as const
export const WEAPON_OVERLAY_STRIDE = WEAPON_OVERLAY_SLOTS.length

// packed candidate rank carries the chosen weapon in the high bits when weapon
// search is active (theory batch mode pins the main echo at slot 0, freeing the
// main-position bits). 5 bits -> up to 31 weapon candidates.
export const WEAPON_INDEX_SHIFT = 27
export const WEAPON_INDEX_BITS = 5
export const MAX_WEAPON_CANDIDATES = (1 << WEAPON_INDEX_BITS) - 1

// decode masks for the packed candidate rank when weapon search is active:
// the low bits hold the combo rank, the high bits the chosen weapon index.
export const WEAPON_RANK_MASK = (1 << WEAPON_INDEX_SHIFT) - 1
export const WEAPON_BIT_MASK = (1 << WEAPON_INDEX_BITS) - 1

/*
  Author: Runor Ewhro
  Description: Defines base damage helpers for negative-effect archetypes
               such as Spectro Frazzle, Aero Erosion, and Fusion Burst.
*/

import type { SkillDefinition } from '@/domain/entities/stats'

export type NegativeEffectArchetype = Extract<
    SkillDefinition['archetype'],
    'spectroFrazzle' | 'aeroErosion' | 'fusionBurst' | 'glacioChafe' | 'electroFlare'
>

// resolve the level scaling curve
// each range uses exponential interpolation between known breakpoints
function getLevelValue(currentLevel: number): number {
  if (currentLevel >= 1 && currentLevel <= 20) {
    return 11 * Math.exp(Math.log(24 / 11) * (currentLevel - 1) / (20 - 1))
  }

  if (currentLevel > 20 && currentLevel <= 40) {
    return 24 * Math.exp(Math.log(85 / 24) * (currentLevel - 20) / (40 - 20))
  }

  if (currentLevel > 40 && currentLevel <= 50) {
    return 85 * Math.exp(Math.log(229 / 85) * (currentLevel - 40) / (50 - 40))
  }

  if (currentLevel > 50 && currentLevel <= 60) {
    return 229 * Math.exp(Math.log(380 / 229) * (currentLevel - 50) / (60 - 50))
  }

  if (currentLevel > 60 && currentLevel <= 70) {
    return 380 * Math.exp(Math.log(1005 / 380) * (currentLevel - 60) / (70 - 60))
  }

  if (currentLevel > 70 && currentLevel <= 80) {
    return 1005 * Math.exp(Math.log(2005 / 1005) * (currentLevel - 70) / (80 - 70))
  }

  if (currentLevel > 80 && currentLevel <= 90) {
    return 2005 * Math.exp(Math.log(3674 / 2005) * (currentLevel - 80) / (90 - 80))
  }

  // unsupported levels return zero
  return 0
}

// compute the base Fusion Burst damage before external multipliers
// this depends on both the resonator level and the current stack count
export function getFusionBurstBase(level: number, stacks: number): number {
  // resolve the base value contributed by stack count
  function getStackValue(value: number): number {
    // stack growth from 1 to 10
    if (value >= 1 && value <= 10) {
      return 8403.400535464296 + (value - 1) * 6828.894046048515
    }

    // stack growth from 11 to 13
    if (value >= 11 && value <= 13) {
      return 93155.28432781024 + (value - 11) * 23285.80478599581
    }

    // unsupported stack counts return zero
    return 0
  }

  // combine stack scaling and level scaling into the final base value
  return getStackValue(stacks) * getLevelValue(level) / 10000
}

// compute the base Electro Flare damage before external multipliers
// this depends on both the resonator level and the current stack count
export function getElectroFlareBase(level: number, stacks: number): number {
  // resolve the base value contributed by stack count
  function getStackValue(value: number): number {
    switch (value) {
      case 1: return 5000;
      case 2: return 9065;
      case 3: return 13130;
      case 4: return 17195;
      case 5: return 21260;
      case 6: return 25325;
      case 7: return 29390;
      case 8: return 33455;
      case 9: return 37520;
      case 10: return 41585;
      case 11: return 55447;
      case 12: return 69308;
      case 13: return 83170;
      default: return 0;
    }
  }

  // combine stack scaling and level scaling into the final base value
  return getStackValue(stacks) * getLevelValue(level) / 10000
}

// compute the base Glacio Chafe damage before external multipliers
// this depends on both the resonator level and the current stack count
export function getGlacioChafeBase(level: number, stacks: number): number {
  // resolve the base value contributed by stack count
  function getStackValue(value: number): number {
    switch (value) {
      case 1: return 2450;
      case 2: return 4442;
      case 3: return 6434;
      case 4: return 8426;
      case 5: return 10417;
      case 6: return 12409;
      case 7: return 14401;
      case 8: return 16393;
      case 9: return 18385;
      case 10: return 20377;
      case 11: return 27169;
      case 12: return 33961;
      case 13: return 40753;
      default: return 0;
    }
  }

  // combine stack scaling and level scaling into the final base value
  return getStackValue(stacks) * getLevelValue(level) / 10000
}

// compute the base negative-effect damage for the given archetype
// this returns only the archetype-specific base amount before later
// damage bonuses, vulnerability, defense, and resistance multipliers
export function getNegativeEffectBase(
    archetype: NegativeEffectArchetype,
    level: number,
    stacks: number,
): number {
  // zero stacks means no negative-effect damage
  if (stacks <= 0) {
    return 0
  }

  // Spectro Frazzle uses a simple linear stack formula
  if (archetype === 'spectroFrazzle') {
    return 209.9 + 895.8 * stacks
  }

  // Aero Erosion has a special case for one stack and a separate
  // linear formula for two or more stacks
  if (archetype === 'aeroErosion') {
    return stacks === 1
        ? 1655.1
        : 4133.45 * stacks - 4132.37
  }

  if (archetype === 'electroFlare') {
    return getElectroFlareBase(level, stacks)
  }

  if (archetype === 'glacioChafe') {
    return getGlacioChafeBase(level, stacks)
  }

  // Fusion Burst uses its own level-and-stack scaling helper
  return getFusionBurstBase(level, stacks)
}

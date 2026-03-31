/*
  Author: Runor Ewhro
  Description: utility helpers.
*/

import type { EchoDefinition } from '@/domain/entities/catalog'
import { createEchoUid, type EchoInstance } from '@/domain/entities/runtime'
import { ECHO_PRIMARY_STATS, ECHO_SECONDARY_STATS } from '@/data/gameData/catalog/echoStats'
import { getEchoById, listEchoes, listEchoesByCost } from '@/domain/services/echoCatalogService'

export interface MainStatRecipe {
  cost: number
  primaryKey: string
}

// clone an equipped echo into a fresh slot instance with a new uid
function cloneEchoForSlot(echo: EchoInstance, slotIndex: number): EchoInstance {
  return {
    uid: createEchoUid(),
    id: echo.id,
    set: echo.set,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: { ...echo.mainStats.primary },
      secondary: { ...echo.mainStats.secondary },
    },
    substats: { ...echo.substats },
  }
}

// build a new echo instance from catalog data while optionally preserving
// substats and preferred set information from a source echo
function buildEchoFromDefinition(
    definition: EchoDefinition,
    slotIndex: number,
    primaryKey: string,
    sourceEcho?: EchoInstance | null,
    preferredSetId?: number | null,
): EchoInstance {
  const cost = definition.cost

  const setId = preferredSetId && definition.sets.includes(preferredSetId)
      ? preferredSetId
      : (definition.sets[0] ?? 0)

  return {
    uid: createEchoUid(),
    id: definition.id,
    set: setId,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: {
        key: primaryKey,
        value: ECHO_PRIMARY_STATS[cost]?.[primaryKey] ?? 0,
      },
      secondary: {
        key: ECHO_SECONDARY_STATS[cost]?.key ?? 'atkFlat',
        value: ECHO_SECONDARY_STATS[cost]?.value ?? 0,
      },
    },
    substats: { ...(sourceEcho?.substats ?? {}) },
  }
}

// reorder recipes so they line up with the original slot costs as closely as possible
function alignRecipesToOriginalSlots(
    recipes: MainStatRecipe[],
    equippedEchoes: Array<EchoInstance | null>,
): Array<MainStatRecipe | null> {
  const originalCosts = equippedEchoes.map((echo) => (
      echo ? (getEchoById(echo.id)?.cost ?? null) : null
  ))

  const remaining = recipes.map((recipe, index) => ({ ...recipe, _index: index }))
  const used = new Set<number>()
  const aligned: Array<MainStatRecipe | null> = new Array(originalCosts.length).fill(null)

  // prefer taking a recipe with the exact target cost
  const takeRecipeWithCost = (cost: number | null, preferredIndex: number) => {
    if (cost == null) {
      return null
    }

    if (
        !used.has(preferredIndex) &&
        remaining[preferredIndex] &&
        remaining[preferredIndex].cost === cost
    ) {
      used.add(preferredIndex)
      return remaining[preferredIndex]
    }

    const index = remaining.findIndex((recipe, recipeIndex) => (
        recipe &&
        !used.has(recipeIndex) &&
        recipe.cost === cost
    ))

    if (index < 0) {
      return null
    }

    used.add(index)
    return remaining[index]
  }

  // if no same-cost recipe exists, take the next unused one
  const takeAnyRemaining = () => {
    const index = remaining.findIndex((recipe, recipeIndex) => (
        recipe && !used.has(recipeIndex)
    ))

    if (index < 0) {
      return null
    }

    used.add(index)
    return remaining[index]
  }

  // walk slot by slot and assign the best matching available recipe
  for (let slotIndex = 0; slotIndex < originalCosts.length; slotIndex += 1) {
    const matched =
        takeRecipeWithCost(originalCosts[slotIndex], slotIndex)
        ?? takeAnyRemaining()

    aligned[slotIndex] = matched
        ? { cost: matched.cost, primaryKey: matched.primaryKey }
        : null
  }

  return aligned
}

// apply an unordered list of recipe choices onto the current equipped echoes
export function applyMainStatRecipesToEchoes(
    unorderedRecipes: MainStatRecipe[],
    equippedEchoes: Array<EchoInstance | null>,
): Array<EchoInstance | null> {
  const recipes = alignRecipesToOriginalSlots(unorderedRecipes, equippedEchoes)

  const usedEquippedIndices = new Set<number>()
  const usedIds = new Set<string>()
  const templates = listEchoes()

  const getEquippedEchoCost = (echo: EchoInstance | null | undefined) =>
      echo ? (getEchoById(echo.id)?.cost ?? null) : null

  // try to reuse an equipped echo of the required cost, preferring the same slot
  const takeEquippedEcho = (cost: number, preferredIndex: number | null) => {
    if (preferredIndex != null) {
      const preferredEcho = equippedEchoes[preferredIndex]
      if (
          preferredEcho &&
          !usedEquippedIndices.has(preferredIndex) &&
          getEquippedEchoCost(preferredEcho) === cost &&
          !usedIds.has(preferredEcho.id)
      ) {
        usedEquippedIndices.add(preferredIndex)
        usedIds.add(preferredEcho.id)
        return cloneEchoForSlot(preferredEcho, preferredIndex)
      }
    }

    for (let index = 0; index < equippedEchoes.length; index += 1) {
      const echo = equippedEchoes[index]

      if (!echo || usedEquippedIndices.has(index)) {
        continue
      }

      if (getEquippedEchoCost(echo) !== cost) {
        continue
      }

      if (usedIds.has(echo.id)) {
        continue
      }

      usedEquippedIndices.add(index)
      usedIds.add(echo.id)
      return cloneEchoForSlot(echo, index)
    }

    return null
  }

  // if no equipped echo can be reused, pick a matching catalog template
  const takeTemplate = (
      cost: number,
      preferredSetId: number | null,
  ) => {
    const byCost = listEchoesByCost(cost)

    const preferred = preferredSetId != null
        ? byCost.filter((entry) => entry.sets.includes(preferredSetId))
        : byCost

    const pool = preferred.length > 0 ? preferred : byCost

    return pool.find((entry) => !usedIds.has(entry.id))
        ?? pool[0]
        ?? templates.find((entry) => entry.cost === cost && !usedIds.has(entry.id))
        ?? templates.find((entry) => entry.cost === cost)
        ?? null
  }

  return recipes.map((recipe, slotIndex) => {
    if (!recipe) {
      return null
    }

    const baseAtSlot = equippedEchoes[slotIndex] ?? null
    const preferredSetId = baseAtSlot?.set ?? null

    // first try to preserve an equipped echo body and just swap main stats
    const pickedEquipped = takeEquippedEcho(recipe.cost, slotIndex)
    const sourceEcho = pickedEquipped ?? baseAtSlot

    if (pickedEquipped) {
      pickedEquipped.mainStats = {
        primary: {
          key: recipe.primaryKey,
          value: ECHO_PRIMARY_STATS[recipe.cost]?.[recipe.primaryKey]
              ?? pickedEquipped.mainStats.primary.value,
        },
        secondary: {
          key: ECHO_SECONDARY_STATS[recipe.cost]?.key
              ?? pickedEquipped.mainStats.secondary.key,
          value: ECHO_SECONDARY_STATS[recipe.cost]?.value
              ?? pickedEquipped.mainStats.secondary.value,
        },
      }

      pickedEquipped.mainEcho = slotIndex === 0
      return pickedEquipped
    }

    // otherwise fall back to a catalog echo template of the correct cost
    const template = takeTemplate(recipe.cost, preferredSetId)
    if (!template) {
      // final fallback -> clone the source echo if one exists and patch its main stats
      const fallback = sourceEcho ? cloneEchoForSlot(sourceEcho, slotIndex) : null
      if (!fallback) {
        return null
      }

      fallback.mainStats = {
        primary: {
          key: recipe.primaryKey,
          value: ECHO_PRIMARY_STATS[recipe.cost]?.[recipe.primaryKey]
              ?? fallback.mainStats.primary.value,
        },
        secondary: {
          key: ECHO_SECONDARY_STATS[recipe.cost]?.key
              ?? fallback.mainStats.secondary.key,
          value: ECHO_SECONDARY_STATS[recipe.cost]?.value
              ?? fallback.mainStats.secondary.value,
        },
      }

      fallback.mainEcho = slotIndex === 0
      return fallback
    }

    usedIds.add(template.id)

    return buildEchoFromDefinition(
        template,
        slotIndex,
        recipe.primaryKey,
        sourceEcho,
        preferredSetId,
    )
  })
}
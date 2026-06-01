/*
  Author: Runor Ewhro
  Description: utility helpers.
*/

import type { EchoDef } from '@/domain/entities/catalog'
import { makeEchoUid, type EchoInstance } from '@/domain/entities/runtime'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS } from '@/data/gameData/catalog/echoStats'
import { getEchoById, listEchoes, listChsByCos } from '@/domain/services/echoCatalogService'

export interface MainStatRecipe {
  cost: number
  primaryKey: string
}

// clone an equipped echo into a fresh slot instance with a new uid
function cloneEchoFor(echo: EchoInstance, slotIndex: number): EchoInstance {
  return {
    uid: makeEchoUid(),
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
function mkEchoFromDe(
    definition: EchoDef,
    slotIndex: number,
    primaryKey: string,
    sourceEcho?: EchoInstance | null,
    prfrSetId?: number | null,
): EchoInstance {
  const cost = definition.cost

  const setId = prfrSetId && definition.sets.includes(prfrSetId)
      ? prfrSetId
      : (definition.sets[0] ?? 0)

  return {
    uid: makeEchoUid(),
    id: definition.id,
    set: setId,
    mainEcho: slotIndex === 0,
    mainStats: {
      primary: {
        key: primaryKey,
        value: ECHO_MAIN_STATS[cost]?.[primaryKey] ?? 0,
      },
      secondary: {
        key: ECHO_SIDE_STATS[cost]?.key ?? 'atkFlat',
        value: ECHO_SIDE_STATS[cost]?.value ?? 0,
      },
    },
    substats: { ...(sourceEcho?.substats ?? {}) },
  }
}

// reorder recipes so they line up with the original slot costs as closely as possible
function lgnRcpsToRgn(
    recipes: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
): Array<MainStatRecipe | null> {
  const rgnlCsts = qppdChs.map((echo) => (
      echo ? (getEchoById(echo.id)?.cost ?? null) : null
  ))

  const remaining = recipes.map((recipe, index) => ({ ...recipe, _index: index }))
  const used = new Set<number>()
  const aligned: Array<MainStatRecipe | null> = new Array(rgnlCsts.length).fill(null)

  // prefer taking a recipe with the exact target cost
  const takeRcpWithC = (cost: number | null, preferredIndex: number) => {
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
  const takeAnyRmnn = () => {
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
  for (let slotIndex = 0; slotIndex < rgnlCsts.length; slotIndex += 1) {
    const matched =
        takeRcpWithC(rgnlCsts[slotIndex], slotIndex)
        ?? takeAnyRmnn()

    aligned[slotIndex] = matched
        ? { cost: matched.cost, primaryKey: matched.primaryKey }
        : null
  }

  return aligned
}

// apply an unordered list of recipe choices onto the current equipped echoes
export function applyMainSta(
    nrdrRcps: MainStatRecipe[],
    qppdChs: Array<EchoInstance | null>,
): Array<EchoInstance | null> {
  const recipes = lgnRcpsToRgn(nrdrRcps, qppdChs)

  const usedQppdNdcs = new Set<number>()
  const usedIds = new Set<string>()
  const templates = listEchoes()

  const getQppdEchoC = (echo: EchoInstance | null | undefined) =>
      echo ? (getEchoById(echo.id)?.cost ?? null) : null

  // try to reuse an equipped echo of the required cost, preferring the same slot
  const takeQppdEcho = (cost: number, preferredIndex: number | null) => {
    if (preferredIndex != null) {
      const prfrEcho = qppdChs[preferredIndex]
      if (
          prfrEcho &&
          !usedQppdNdcs.has(preferredIndex) &&
          getQppdEchoC(prfrEcho) === cost &&
          !usedIds.has(prfrEcho.id)
      ) {
        usedQppdNdcs.add(preferredIndex)
        usedIds.add(prfrEcho.id)
        return cloneEchoFor(prfrEcho, preferredIndex)
      }
    }

    for (let index = 0; index < qppdChs.length; index += 1) {
      const echo = qppdChs[index]

      if (!echo || usedQppdNdcs.has(index)) {
        continue
      }

      if (getQppdEchoC(echo) !== cost) {
        continue
      }

      if (usedIds.has(echo.id)) {
        continue
      }

      usedQppdNdcs.add(index)
      usedIds.add(echo.id)
      return cloneEchoFor(echo, index)
    }

    return null
  }

  // if no equipped echo can be reused, pick a matching catalog template
  const takeTemplate = (
      cost: number,
      prfrSetId: number | null,
  ) => {
    const byCost = listChsByCos(cost)

    const preferred = prfrSetId != null
        ? byCost.filter((entry) => entry.sets.includes(prfrSetId))
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

    const baseAtSlot = qppdChs[slotIndex] ?? null
    const prfrSetId = baseAtSlot?.set ?? null

    // first try to preserve an equipped echo body and just swap main stats
    const pckdQppd = takeQppdEcho(recipe.cost, slotIndex)
    const sourceEcho = pckdQppd ?? baseAtSlot

    if (pckdQppd) {
      pckdQppd.mainStats = {
        primary: {
          key: recipe.primaryKey,
          value: ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey]
              ?? pckdQppd.mainStats.primary.value,
        },
        secondary: {
          key: ECHO_SIDE_STATS[recipe.cost]?.key
              ?? pckdQppd.mainStats.secondary.key,
          value: ECHO_SIDE_STATS[recipe.cost]?.value
              ?? pckdQppd.mainStats.secondary.value,
        },
      }

      pckdQppd.mainEcho = slotIndex === 0
      return pckdQppd
    }

    // otherwise fall back to a catalog echo template of the correct cost
    const template = takeTemplate(recipe.cost, prfrSetId)
    if (!template) {
      // final fallback -> clone the source echo if one exists and patch its main stats
      const fallback = sourceEcho ? cloneEchoFor(sourceEcho, slotIndex) : null
      if (!fallback) {
        return null
      }

      fallback.mainStats = {
        primary: {
          key: recipe.primaryKey,
          value: ECHO_MAIN_STATS[recipe.cost]?.[recipe.primaryKey]
              ?? fallback.mainStats.primary.value,
        },
        secondary: {
          key: ECHO_SIDE_STATS[recipe.cost]?.key
              ?? fallback.mainStats.secondary.key,
          value: ECHO_SIDE_STATS[recipe.cost]?.value
              ?? fallback.mainStats.secondary.value,
        },
      }

      fallback.mainEcho = slotIndex === 0
      return fallback
    }

    usedIds.add(template.id)

    return mkEchoFromDe(
        template,
        slotIndex,
        recipe.primaryKey,
        sourceEcho,
        prfrSetId,
    )
  })
}
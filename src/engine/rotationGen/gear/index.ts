/*
  Author: Runor Ewhro
  description: creates gear trigger definitions for the selected environment.
*/

import type { RuntimeValue } from '../types'

/** create immutable gear triggers for each environment, rank, and piece count. */
export function createGearLibrary(data: RuntimeValue): RuntimeValue {
  if (data.schemaVersion !== 1) throw new Error('Unknown gear trigger format')
  const tables: RuntimeValue = { weapon: data.weapons, mainEcho: data.echoes, sonata: data.sonatas }
  return { module(kind: string, id: string | number, selection = 1) {
    const entry = tables[kind]?.[id]
    if (!entry) throw new Error(`Missing ${kind} trigger translation ${id}`)
    const definition = entry.variants ? entry.variants[entry.select[selection]] : entry
    if (!definition) throw new Error(`Missing ${kind} trigger variant ${id}/${selection}`)
    return structuredClone(definition)
  } }
}

export function prepareEquipment({ loadout, weaponBundle, echoCatalog, gearLibrary }: RuntimeValue): RuntimeValue {
  const equipped = loadout.echoes.map((echo: RuntimeValue) => {
    const entry = echoCatalog.find((row: RuntimeValue) => row.id === echo.id)
    if (!entry || !entry.sets.includes(echo.set)) throw new Error(`Missing Echo ${echo.id} in set ${echo.set}`)
    return { ...echo, id: Number(echo.id), main: echo.mainEcho }
  })
  if (equipped.length !== 5 || equipped.filter((echo: RuntimeValue) => echo.main).length !== 1) throw new Error('Expected five Echoes and one main Echo')
  const main = gearLibrary.module('mainEcho', equipped.find((echo: RuntimeValue) => echo.main).id)
  main.action = main.actions[main.actionId]
  const counts = new Map<number, number>()
  for (const echo of equipped) counts.set(echo.set, (counts.get(echo.set) ?? 0) + 1)
  const sets = [...counts].map(([id, pieces]) => gearLibrary.module('sonata', id, pieces))
  const weapon = gearLibrary.module('weapon', loadout.weapon.id, loadout.weapon.rank)
  weapon.secondary = { stat: weaponBundle.weapon.statKey,
    value: weaponBundle.weapon.statsByLevel[String(loadout.weapon.level)].secondaryStatValue }
  return { weapon, echoes: { equipped, main }, sonata: { sets,
    effects: Object.assign({}, ...sets.map(set => set.effects)),
    effectControls: Object.assign({}, ...sets.map(set => set.effectControls)),
    rules: sets.flatMap(set => set.rules),
    onFieldEntryEffects: sets.flatMap(set => set.onFieldEntryEffect == null ? [] : [set.onFieldEntryEffect]) } }
}

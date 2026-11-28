/*
  Author: Runor Ewhro
  description: creates gear trigger definitions for the selected environment.
*/

import type { RuntimeValue } from '../types'
import { countEchoSets } from '../../../domain/gameData/echoSetCounts'
import { stableId } from '../stableId'

// a main echo with no translation, as the trigger data writes one for an echo with untimed hits: its cast with no
// hits and no rules. a build wearing it still scores (the rotation runs with its stats and its catalog buffs);
// partial scoring omits unknown hits, and strict audits report hit-dependent gaps
export function untimedMainEcho(id: string | number): RuntimeValue {
  const n = Number.isSafeInteger(Number(id)) ? Number(id) : stableId('untimed-echo', String(id))
  return { id, effects: {}, rules: [], effectControls: {}, actionId: n, hitEventsUnavailable: true,
    actions: { [n]: { id: n, name: 'Equipped Echo', cast: 6, input: 'echo', timing: { duration: 0 }, events: [{ id: n, kind: 0, at: 0 }] } } }
}

// create immutable gear triggers for each environment, rank, and piece count
export function createGearLibrary(data: RuntimeValue): RuntimeValue {
  if (data.schemaVersion !== 1) throw new Error('Unknown gear trigger format')
  const tables: RuntimeValue = { weapon: data.weapons, mainEcho: data.echoes, sonata: data.sonatas }
  return { module(kind: string, id: string | number, selection = 1) {
    // a submitted build can wear any echo in the game, including ones released after the trigger data was written
    if (kind === 'mainEcho' && !tables.mainEcho?.[id]) return { ...untimedMainEcho(id),
      omissions: [{ code: 'missing-gear-triggers', kind, sourceId: String(id) }] }
    const entry = tables[kind]?.[id]
    if (!entry) return { id, effects: {}, rules: [], effectControls: {},
      omissions: [{ code: 'missing-gear-triggers', kind, sourceId: String(id) }] }
    const definition = entry.variants ? entry.variants[entry.select[selection]] : entry
    if (!definition) return { ...(kind === 'mainEcho' ? untimedMainEcho(id) : { id, effects: {}, rules: [], effectControls: {} }),
      omissions: [{ code: 'missing-gear-variant', kind, sourceId: String(id), selection }] }
    return structuredClone(definition)
  } }
}

export function prepareEquipment({ loadout, weaponBundle, echoCatalog, gearLibrary }: RuntimeValue): RuntimeValue {
  const omissions: RuntimeValue[] = []
  const equipped = loadout.echoes.filter((echo: RuntimeValue) => echo != null).map((echo: RuntimeValue) => {
    const entry = echoCatalog.find((row: RuntimeValue) => row.id === echo.id)
    if (!entry || !entry.sets.includes(echo.set)) omissions.push({ code: 'unknown-echo-equipment', sourceId: echo.id, set: echo.set })
    return { ...echo, id: Number.isFinite(Number(echo.id)) ? Number(echo.id) : echo.id, main: echo.mainEcho }
  })
  if (equipped.length > 5 || equipped.filter((echo: RuntimeValue) => echo.main).length > 1) throw new Error('Expected at most five Echoes and one main Echo')
  const mainEcho = equipped.find((echo: RuntimeValue) => echo.main)
  // an empty main slot provides no action or passive effects, with the gear shape unchanged for replay
  const main = mainEcho ? gearLibrary.module('mainEcho', mainEcho.id)
    : { id: null, effects: {}, rules: [], actions: {}, effectControls: {} }
  if (mainEcho) main.action = main.actions[main.actionId]
  if (main.pairedEchoId != null) {
    const paired = equipped.some((echo: RuntimeValue) => !echo.main && echo.id === main.pairedEchoId)
    main.initialGearFlags.echoPaired = paired
    if (!paired) {
      main.actions = { [main.actionId]: main.action }
      main.effects = {}; main.rules = []; main.effectControls = {}
      main.action.timing.charges = 1
    } else {
      for (const action of Object.values(main.actions) as RuntimeValue[]) {
        for (const event of action.events) if (event.damage) event.element = main.pairedElement
        if (action.recordedHit) action.recordedHit.element = main.pairedElement
      }
    }
  }
  const sets = Object.entries(countEchoSets(equipped))
    .map(([id, pieces]) => gearLibrary.module('sonata', Number(id), pieces))
  const weapon = gearLibrary.module('weapon', loadout.weapon.id, loadout.weapon.rank)
  weapon.rank = loadout.weapon.rank
  for (const effect of Object.values(weapon.effects) as RuntimeValue[]) {
    if (effect.exclusiveGroup) effect.exclusivePriority = weapon.rank
  }
  const secondary = weaponBundle?.weapon?.statsByLevel?.[String(loadout.weapon.level)]?.secondaryStatValue
  if (Number.isFinite(secondary)) weapon.secondary = { stat: weaponBundle.weapon.statKey, value: secondary }
  else omissions.push({ code: 'missing-weapon-secondary', sourceId: loadout.weapon.id })
  omissions.push(...[weapon, main, ...sets].flatMap(definition => definition.omissions ?? []))
  return { weapon, echoes: { equipped, main }, omissions, sonata: { sets,
    effects: Object.assign({}, ...sets.map(set => set.effects)),
    effectControls: Object.assign({}, ...sets.map(set => set.effectControls)),
    rules: sets.flatMap(set => set.rules),
    onFieldEntryEffects: sets.flatMap(set => set.onFieldEntryEffect == null ? [] : [set.onFieldEntryEffect]) } }
}

/*
  Author: Runor Ewhro
  description: loads game data and interpretation rules through host-provided readers.
*/

import type { RuntimeValue, InterpreterEnvironment, InterpreterLoaders, JsonLoader } from './types'
import { createCharacterRuleLibrary } from './characterRules.ts'
import { createGearLibrary } from './gear/index.ts'

/** hosts resolve these logical paths from a ruleset snapshot, assets, or memory. */
export async function createInterpreterEnvironment({ mode, gameData, interpretationData }: InterpreterLoaders): Promise<InterpreterEnvironment> {
  if (!['live', 'beta'].includes(mode)) throw new Error(`Invalid data mode ${mode}`)
  // adapt host JSON values before rule validation; independent snapshot reads run together.
  const load = async (read: JsonLoader, path: string): Promise<RuntimeValue> => read(path)
  const [index, gearTriggers, weaponSources,
    echoCatalog, echoSources, sonataDefinitions, enemySources] = await Promise.all([
    load(interpretationData, 'characters/index'), load(interpretationData, 'gear/triggers'), load(gameData, 'weapons/sources'),
    load(gameData, 'echoes/catalog'), load(gameData, 'echoes/sources'), load(gameData, 'sonata/effects'),
    load(gameData, 'enemies/sources'),
  ])
  return { mode, gameData, echoCatalog, echoSources, weaponSources, sonataDefinitions, enemySources,
    characters: createCharacterRuleLibrary(index, (id?: RuntimeValue): RuntimeValue => interpretationData(`characters/${id}`)),
    gear: createGearLibrary(gearTriggers) }
}

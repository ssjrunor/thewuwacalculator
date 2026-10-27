/*
  Author: Runor Ewhro
  description: converts Yumeo game data into app Resonators and Echo inventory.
*/

import { useAppStore } from '@/application/state'
import { ensureResonatorData, getGameDataMode } from '@/data/gameData'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { ECHO_MAIN_STATS, ECHO_SIDE_STATS, SUBSTAT_KEYS, getSbstStepP, snapToNrstSb } from '@/data/gameData/catalog/echoStats'
import { scenarioIdForContextResonator } from '@/domain/entities/scenarioLibrary'
import { roverIdForGender } from '@/domain/entities/roverGender'
import { cloneEchoFor, getEchoSignature } from '@/domain/entities/inventoryStorage'
import type { EchoInstance, ResRuntime, SkillLevels, WeaponState } from '@/domain/entities/runtime'
import { makeResProfile } from '@/engine/runtime/defaults'
import { catWpnAtk } from '@/engine/runtime/weaponState'
import { yumeoEchoStatKey } from '@/infra/imports/yumeo/echoStats'
import { parseYumeoGameData, type YumeoGameData } from '@/infra/imports/yumeo/payload'
import betaSkillNodeIds from './data/resonatorSkillNodeIds.beta.json'
import liveSkillNodeIds from './data/resonatorSkillNodeIds.live.json'

export { parseYumeoGameData } from '@/infra/imports/yumeo/payload'
export type { YumeoGameData } from '@/infra/imports/yumeo/payload'

export interface ConvertedYumeoResonator {
  id: string
  level?: number
  sequence?: number
  skillLevels: Partial<SkillLevels>
  weapon?: WeaponState
  echoes: Array<{ slotIndex: number; echo: EchoInstance }>
}

export interface ConvertedYumeoGameData {
  resonators: ConvertedYumeoResonator[]
  inventoryEchoes: EchoInstance[]
  optionalEchoes: Array<{ level: number; echo: EchoInstance }>
  conflicts: YumeoGameDataEquipmentConflicts
  skipped: { resonators: number; weapons: number; unequippedWeapons: number; echoes: number; echoEquipments: number; unlevelledEchoes: number }
  // level and wearer of every imported or optional echo, keyed by uid.
  echoMeta: Record<string, YumeoEchoMeta>
}

export interface YumeoEchoMeta {
  level: number
  ownerId?: string
  slotIndex?: number
}

export interface YumeoGameDataEquipmentConflicts {
  weapons: Array<{
    resonatorId: string
    candidates: Array<{ sourceIndex: number; instanceId?: number; weapon: WeaponState }>
  }>
  echoSlots: Array<{
    resonatorId: string
    slotIndex: number
    candidates: Array<{ sourceIndex: number; instanceId: number; echo: EchoInstance }>
  }>
}

export interface YumeoGameDataEquipmentSelections {
  weapons?: Array<{ resonatorId: string; sourceIndex: number }>
  echoSlots?: Array<{ resonatorId: string; slotIndex: number; sourceIndex: number }>
}

export interface PreparedYumeoGameData {
  mode: ReturnType<typeof getGameDataMode>
  converted: ConvertedYumeoGameData
  review: {
    resonators: ConvertedYumeoResonator[]
    inventoryEchoesToAdd: EchoInstance[]
    optionalEchoes: ConvertedYumeoGameData['optionalEchoes']
    conflicts: YumeoGameDataEquipmentConflicts
    skipped: ConvertedYumeoGameData['skipped']
    echoMeta: ConvertedYumeoGameData['echoMeta']
  }
}

export interface YumeoGameDataImportChoices {
  equipment?: YumeoGameDataEquipmentSelections
  optionalEchoUids?: readonly string[]
  // skipped resonators do not require conflict selections.
  skipResonatorIds?: readonly string[]
  // excluded level 25 Echoes must be unequipped or unselected conflict candidates.
  excludedEchoUids?: readonly string[]
}

const LEVELED_SKILL_TABS = [
  'normalAttack', 'resonanceSkill', 'resonanceLiberation', 'introSkill', 'forteCircuit',
] as const satisfies readonly (keyof SkillLevels)[]
const SKILL_NODE_IDS_BY_MODE: Record<'live' | 'beta', Record<string, Partial<Record<keyof SkillLevels, number>>>> = {
  live: liveSkillNodeIds,
  beta: betaSkillNodeIds,
}

function validInteger(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

function resolvedSubstatValue(key: string, rawValue: unknown): number {
  const steps = getSbstStepP(key)
  const value = typeof rawValue === 'number'
    || (typeof rawValue === 'string' && rawValue.trim().length > 0)
    ? Number(rawValue)
    : Number.NaN
  return Number.isFinite(value) ? snapToNrstSb(key, value) : steps[0]
}

export function convertYumeoGameData(data: YumeoGameData): ConvertedYumeoGameData {
  const byId = new Map<string, ConvertedYumeoResonator>()
  const skipped = { resonators: 0, weapons: 0, unequippedWeapons: 0, echoes: 0, echoEquipments: 0, unlevelledEchoes: 0 }
  const conflicts: YumeoGameDataEquipmentConflicts = { weapons: [], echoSlots: [] }
  for (const source of data.resonators) {
    if (!source || !validInteger(source.resonatorId, 1)) {
      skipped.resonators++
      continue
    }
    const id = String(source.resonatorId)
    if (!getResSeedBy(id) || byId.has(id)) {
      skipped.resonators++
      continue
    }
    const skillLevels: Partial<SkillLevels> = {}
    const skillsByTab = SKILL_NODE_IDS_BY_MODE[getGameDataMode()][id]
    const skillTabByNodeId = new Map<number, keyof SkillLevels>()
    for (const tab of LEVELED_SKILL_TABS) {
      const nodeId = skillsByTab?.[tab]
      if (validInteger(nodeId, 1)) skillTabByNodeId.set(nodeId, tab)
    }
    for (const skill of Array.isArray(source.skills) ? source.skills : []) {
      if (!skill || !validInteger(skill.nodeId, 1) || !validInteger(skill.level, 1, 10)) continue
      const key = skillTabByNodeId.get(skill.nodeId)
      if (key) skillLevels[key] = skill.level
    }
    byId.set(id, {
      id,
      ...(validInteger(source.level, 1, 90) ? { level: source.level } : {}),
      ...(validInteger(source.chain, 0, 6) ? { sequence: source.chain } : {}),
      skillLevels,
      echoes: [],
    })
  }

  const weaponCandidates = new Map<string, YumeoGameDataEquipmentConflicts['weapons'][number]['candidates']>()
  for (const [sourceIndex, source] of data.weapons.entries()) {
    if (source?.instanceId === 0) continue
    if (!source) {
      skipped.weapons++
      continue
    }
    if (source.equippedByResonatorId == null || source.equippedByResonatorId === 0) {
      skipped.weapons++
      skipped.unequippedWeapons++
      continue
    }
    if (!validInteger(source.equippedByResonatorId, 1)) {
      skipped.weapons++
      continue
    }
    const owner = byId.get(String(source.equippedByResonatorId))
    if (!owner || !validInteger(source.itemId, 1)) {
      skipped.weapons++
      continue
    }
    const id = String(source.itemId)
    const weapon = getWpnById(id)
    const resonator = getResSeedBy(owner.id)
    if (!weapon || !resonator || weapon.weaponType !== resonator.weaponType) {
      skipped.weapons++
      continue
    }
    const candidates = weaponCandidates.get(owner.id) ?? []
    candidates.push({
      sourceIndex,
      ...(validInteger(source.instanceId, 1) ? { instanceId: source.instanceId } : {}),
      weapon: catWpnAtk({
      id,
      level: validInteger(source.level, 1, 90) ? source.level : 1,
      rank: validInteger(source.rank, 1, 5) ? source.rank : 1,
      }),
    })
    weaponCandidates.set(owner.id, candidates)
  }
  for (const [resonatorId, candidates] of weaponCandidates) {
    if (candidates.length === 1) byId.get(resonatorId)!.weapon = candidates[0].weapon
    else conflicts.weapons.push({ resonatorId, candidates })
  }

  const inventoryEchoes: EchoInstance[] = []
  const optionalEchoes: ConvertedYumeoGameData['optionalEchoes'] = []
  const echoSlotCandidates = new Map<string, YumeoGameDataEquipmentConflicts['echoSlots'][number]>()
  const echoMeta: ConvertedYumeoGameData['echoMeta'] = {}
  const seenInstances = new Set<number>()
  for (const [sourceIndex, source] of data.echoes.entries()) {
    if (source?.instanceId === 0) continue
    if (!source || !validInteger(source.instanceId, 1) || !validInteger(source.monsterId, 1)
        || seenInstances.has(source.instanceId)) {
      skipped.echoes++
      continue
    }
    const id = String(source.monsterId)
    const definition = getEchoById(id)
    const primaryOptions = definition && ECHO_MAIN_STATS[definition.cost]
    const secondary = definition && ECHO_SIDE_STATS[definition.cost]
    const primaryEntry = primaryOptions && Object.entries(primaryOptions)[0]
    const mainStats = Array.isArray(source.mainStats)
      ? source.mainStats.map((stat) => ({ key: yumeoEchoStatKey(stat?.statId, 'main') }))
      : null
    const subStats = Array.isArray(source.subStats)
      ? source.subStats.map((stat) => ({
        key: yumeoEchoStatKey(stat?.statId, 'sub'),
        value: stat?.value,
      }))
      : null
    if (!definition || !primaryEntry || !secondary
        || !validInteger(source.echoSetId, 1) || !definition.sets.includes(source.echoSetId)
        || !mainStats
        || mainStats.some((stat) => !stat.key
          || (primaryOptions[stat.key] === undefined && stat.key !== secondary.key))
        || !subStats || subStats.length > 5
        || subStats.some((stat) => !stat.key
          || !SUBSTAT_KEYS.includes(stat.key)
          || getSbstStepP(stat.key).length === 0)
        || new Set(subStats.map((stat) => stat.key)).size !== subStats.length) {
      skipped.echoes++
      continue
    }
    const suppliedPrimary = mainStats.find((stat) => stat.key && primaryOptions[stat.key] !== undefined)
    const primaryKey = suppliedPrimary?.key ?? primaryEntry[0]
    seenInstances.add(source.instanceId)
    const echo: EchoInstance = {
      uid: `game:${source.instanceId}`,
      id,
      set: source.echoSetId,
      mainEcho: false,
      mainStats: {
        primary: { key: primaryKey, value: primaryOptions[primaryKey] },
        secondary: { key: secondary.key, value: secondary.value },
      },
      substats: Object.fromEntries(subStats.map((stat) => [stat.key, resolvedSubstatValue(stat.key!, stat.value)])),
    }
    let equipped = false
    if (source.equippedByResonatorId != null || source.slotIndex != null) {
      const owner = byId.get(String(source.equippedByResonatorId))
      if (!owner || !validInteger(source.slotIndex, 0, 4)) {
        skipped.echoEquipments++
      } else {
        const slotIndex = source.slotIndex
        const key = `${owner.id}:${slotIndex}`
        const group = echoSlotCandidates.get(key) ?? { resonatorId: owner.id, slotIndex, candidates: [] }
        group.candidates.push({ sourceIndex, instanceId: source.instanceId, echo })
        echoSlotCandidates.set(key, group)
        equipped = true
        echoMeta[echo.uid] = { level: validInteger(source.level, 0, 25) ? source.level : 25, ownerId: owner.id, slotIndex }
      }
    }
    if (equipped || source.level === 25) {
      inventoryEchoes.push(echo)
      echoMeta[echo.uid] ??= { level: 25 }
    } else if (validInteger(source.level, 1, 24)) {
      optionalEchoes.push({ level: source.level, echo })
      echoMeta[echo.uid] = { level: source.level }
    } else if (source.level === 0) {
      skipped.unlevelledEchoes++
    } else {
      skipped.echoes++
    }
  }
  for (const group of echoSlotCandidates.values()) {
    if (group.candidates.length === 1) {
      const owner = byId.get(group.resonatorId)!
      owner.echoes.push({ slotIndex: group.slotIndex, echo: cloneEchoFor(group.candidates[0].echo, group.slotIndex) })
    } else {
      conflicts.echoSlots.push(group)
    }
  }

  return { resonators: [...byId.values()], inventoryEchoes, optionalEchoes, conflicts, skipped, echoMeta }
}

/** apply explicit choices from reported equipment conflicts before importing. */
export function resolveYumeoGameDataEquipmentConflicts(
  converted: ConvertedYumeoGameData,
  selections: YumeoGameDataEquipmentSelections,
): ConvertedYumeoGameData {
  const chosenWeapons = new Map<string, WeaponState>()
  const chosenEchoes = new Map<string, Array<{ slotIndex: number; echo: EchoInstance }>>()
  const resolvedWeapons = new Set<string>()
  const resolvedEchoSlots = new Set<string>()

  for (const selection of selections.weapons ?? []) {
    const conflict = converted.conflicts.weapons.find((entry) => entry.resonatorId === selection.resonatorId)
    const candidate = conflict?.candidates.find((entry) => entry.sourceIndex === selection.sourceIndex)
    if (!candidate || resolvedWeapons.has(selection.resonatorId)) {
      throw new Error(`Invalid weapon conflict selection for resonator ${selection.resonatorId}.`)
    }
    chosenWeapons.set(selection.resonatorId, candidate.weapon)
    resolvedWeapons.add(selection.resonatorId)
  }
  for (const selection of selections.echoSlots ?? []) {
    const key = `${selection.resonatorId}:${selection.slotIndex}`
    const conflict = converted.conflicts.echoSlots.find((entry) =>
      entry.resonatorId === selection.resonatorId && entry.slotIndex === selection.slotIndex)
    const candidate = conflict?.candidates.find((entry) => entry.sourceIndex === selection.sourceIndex)
    if (!candidate || resolvedEchoSlots.has(key)) {
      throw new Error(`Invalid Echo conflict selection for slot ${key}.`)
    }
    const echoes = chosenEchoes.get(selection.resonatorId) ?? []
    echoes.push({ slotIndex: selection.slotIndex, echo: cloneEchoFor(candidate.echo, selection.slotIndex) })
    chosenEchoes.set(selection.resonatorId, echoes)
    resolvedEchoSlots.add(key)
  }

  return {
    ...converted,
    resonators: converted.resonators.map((resonator) => ({
      ...resonator,
      weapon: chosenWeapons.get(resonator.id) ?? resonator.weapon,
      echoes: [...resonator.echoes, ...(chosenEchoes.get(resonator.id) ?? [])],
    })),
    conflicts: {
      weapons: converted.conflicts.weapons.filter((entry) => !resolvedWeapons.has(entry.resonatorId)),
      echoSlots: converted.conflicts.echoSlots.filter((entry) =>
        !resolvedEchoSlots.has(`${entry.resonatorId}:${entry.slotIndex}`)),
    },
  }
}

export function applyConvertedYumeoGameData(converted: ConvertedYumeoGameData): {
  resonators: number
  echoesAdded: number
  echoesSkippedDuplicates: number
  optionalEchoes: ConvertedYumeoGameData['optionalEchoes']
  conflicts: YumeoGameDataEquipmentConflicts
  skipped: ConvertedYumeoGameData['skipped']
} {
  const importedEchoGrid = (imported: ConvertedYumeoResonator): Array<EchoInstance | null> => {
    const echoes: Array<EchoInstance | null> = [null, null, null, null, null]
    for (const { slotIndex, echo } of imported.echoes) echoes[slotIndex] = echo
    return echoes
  }

  const patchRuntime = (previous: ResRuntime, imported: ConvertedYumeoResonator): ResRuntime => {
    return {
      ...previous,
      base: {
        ...previous.base,
        level: imported.level ?? previous.base.level,
        sequence: imported.sequence ?? previous.base.sequence,
        skillLevels: { ...previous.base.skillLevels, ...imported.skillLevels },
      },
      build: {
        ...previous.build,
        weapon: imported.weapon ?? previous.build.weapon,
        echoes: importedEchoGrid(imported),
      },
    }
  }

  const state = useAppStore.getState()
  state.ensInvHydr()
  const availableEchoSignatures = new Set([
    ...useAppStore.getState().library.echoes.map((entry) => getEchoSignature(entry.echo)),
    ...converted.inventoryEchoes.map((echo) => {
      if (!getEchoById(echo.id)) throw new Error(`Unknown imported Echo ${echo.id}.`)
      return getEchoSignature(echo)
    }),
  ])
  for (const resonator of converted.resonators) {
    for (const { echo } of resonator.echoes) {
      if (!availableEchoSignatures.has(getEchoSignature(echo))) {
        throw new Error(`Equipped Echo ${echo.id} is missing from the import inventory.`)
      }
    }
  }
  const addedEchoes = state.addInvEchoes(converted.inventoryEchoes)
  const savedEchoBySignature = new Map<string, EchoInstance>()
  for (const entry of useAppStore.getState().library.echoes) {
    const signature = getEchoSignature(entry.echo)
    if (!savedEchoBySignature.has(signature)) savedEchoBySignature.set(signature, entry.echo)
  }
  const optionalSignatures = new Set(savedEchoBySignature.keys())
  const optionalEchoes = converted.optionalEchoes.filter(({ echo }) => {
    const signature = getEchoSignature(echo)
    if (optionalSignatures.has(signature)) return false
    optionalSignatures.add(signature)
    return true
  })

  for (const source of converted.resonators) {
    const imported: ConvertedYumeoResonator = {
      ...source,
      id: roverIdForGender(source.id, useAppStore.getState().ui.preferences.roverGender),
      echoes: source.echoes.map(({ slotIndex, echo }) => {
        const saved = savedEchoBySignature.get(getEchoSignature(echo))
        if (!saved) throw new Error(`Equipped Echo ${echo.id} was not saved in inventory.`)
        return { slotIndex, echo: cloneEchoFor(saved, slotIndex) }
      }),
    }
    const state = useAppStore.getState()
    const contextId = scenarioIdForContextResonator(state.combat, imported.id)
    if (!contextId) {
      const seed = getResSeedBy(imported.id)
      if (!seed) continue
      const profile = makeResProfile(seed)
      profile.runtime.progression.level = imported.level ?? profile.runtime.progression.level
      profile.runtime.progression.sequence = imported.sequence ?? profile.runtime.progression.sequence
      Object.assign(profile.runtime.progression.skillLevels, imported.skillLevels)
      if (imported.weapon) profile.runtime.build.weapon = imported.weapon
      profile.runtime.build.echoes = importedEchoGrid(imported)
      state.upsertRes([profile], 'Imported Game Resonator')
    }

    // the same resonator may also be a teammate in other working scenarios.
    for (const scenarioId of useAppStore.getState().combat.order) {
      const scenario = useAppStore.getState().combat.scenariosById[scenarioId]
      if (scenario.team.members.some((member) => member.resonatorId === imported.id)) {
        useAppStore.getState().updScenarioResRt(scenarioId, imported.id, (previous) => patchRuntime(previous, imported))
      }
      if (scenario.dormantMembersByResonatorId?.[imported.id]) {
        useAppStore.getState().commitScenarioConfig(scenarioId, (current) => {
          const dormant = current.dormantMembersByResonatorId?.[imported.id]
          if (!dormant) return current
          const member = dormant.member
          return {
            ...current,
            dormantMembersByResonatorId: {
              ...current.dormantMembersByResonatorId,
              [imported.id]: {
                ...dormant,
                member: {
                  ...member,
                  progression: {
                    ...member.progression,
                    level: imported.level ?? member.progression.level,
                    sequence: imported.sequence ?? member.progression.sequence,
                    skillLevels: { ...member.progression.skillLevels, ...imported.skillLevels },
                  },
                  loadout: {
                    ...member.loadout,
                    weapon: imported.weapon ?? member.loadout.weapon,
                    echoes: importedEchoGrid(imported),
                  },
                },
              },
            },
          }
        }, 'Imported Dormant Game Resonator')
      }
    }
  }
  return {
    resonators: converted.resonators.length,
    echoesAdded: addedEchoes.length,
    echoesSkippedDuplicates: converted.inventoryEchoes.length - addedEchoes.length,
    optionalEchoes,
    conflicts: converted.conflicts,
    skipped: converted.skipped,
  }
}

/** add only the lower-level, unequipped Echoes selected after import review. */
export function addSelectedOptionalYumeoGameDataEchoes(
  optionalEchoes: ConvertedYumeoGameData['optionalEchoes'],
  selectedUids: readonly string[],
) {
  const selected = new Set(selectedUids)
  return useAppStore.getState().addInvEchoes(
    optionalEchoes.filter(({ echo }) => selected.has(echo.uid)).map(({ echo }) => echo),
  )
}

/** prepare the Yumeo export and current inventory for review. */
export async function prepareYumeoGameData(raw: string): Promise<PreparedYumeoGameData> {
  const data = parseYumeoGameData(raw)
  const gender = useAppStore.getState().ui.preferences.roverGender
  await ensureResonatorData([...new Set(data.resonators.flatMap((entry) => (
    entry && validInteger(entry.resonatorId, 1) && getResSeedBy(String(entry.resonatorId))
      ? [String(entry.resonatorId), roverIdForGender(String(entry.resonatorId), gender)] : []
  )))])
  const converted = convertYumeoGameData(data)
  const state = useAppStore.getState()
  state.ensInvHydr()
  const knownSignatures = new Set(useAppStore.getState().library.echoes.map((entry) => getEchoSignature(entry.echo)))
  const inventoryEchoesToAdd = converted.inventoryEchoes.filter((echo) => {
    const signature = getEchoSignature(echo)
    if (knownSignatures.has(signature)) return false
    knownSignatures.add(signature)
    return true
  })
  const optionalEchoes = converted.optionalEchoes.filter(({ echo }) => {
    const signature = getEchoSignature(echo)
    if (knownSignatures.has(signature)) return false
    knownSignatures.add(signature)
    return true
  })
  return {
    mode: getGameDataMode(),
    converted,
    review: {
      resonators: converted.resonators,
      inventoryEchoesToAdd,
      optionalEchoes,
      conflicts: converted.conflicts,
      skipped: converted.skipped,
      echoMeta: converted.echoMeta,
    },
  }
}

/** drop skipped resonators, their conflicts, and the echoes the review left out. */
function narrowYumeoGameData(
  converted: ConvertedYumeoGameData,
  choices: YumeoGameDataImportChoices,
): ConvertedYumeoGameData {
  const skipped = new Set(choices.skipResonatorIds ?? [])
  const known = new Set(converted.resonators.map((resonator) => resonator.id))
  if ([...skipped].some((id) => !known.has(id))) {
    throw new Error('Invalid resonator skip. Prepare the Yumeo import again.')
  }
  const excluded = new Set(choices.excludedEchoUids ?? [])
  const inventoryUids = new Set(converted.inventoryEchoes.map((echo) => echo.uid))
  // in a slot the file fills twice, the echoes not picked to wear are bag echoes.
  const unworn = new Set(converted.conflicts.echoSlots.flatMap((entry) => {
    const pick = choices.equipment?.echoSlots?.find((one) =>
      one.resonatorId === entry.resonatorId && one.slotIndex === entry.slotIndex)
    return entry.candidates.filter((candidate) => candidate.sourceIndex !== pick?.sourceIndex).map((candidate) => candidate.echo.uid)
  }))
  for (const uid of excluded) {
    const ownerId = converted.echoMeta[uid]?.ownerId
    if (!inventoryUids.has(uid) || (ownerId && !skipped.has(ownerId) && !unworn.has(uid))) {
      throw new Error('Invalid Echo exclusion. Prepare the Yumeo import again.')
    }
  }
  if (!skipped.size && !excluded.size) return converted
  return {
    ...converted,
    resonators: converted.resonators.filter((resonator) => !skipped.has(resonator.id)),
    inventoryEchoes: converted.inventoryEchoes.filter((echo) => !excluded.has(echo.uid)),
    conflicts: {
      weapons: converted.conflicts.weapons.filter((entry) => !skipped.has(entry.resonatorId)),
      echoSlots: converted.conflicts.echoSlots.filter((entry) => !skipped.has(entry.resonatorId)),
    },
  }
}

/** apply the reviewed export after all equipment conflicts are resolved. */
export function applyPreparedYumeoGameData(
  prepared: PreparedYumeoGameData,
  choices: YumeoGameDataImportChoices = {},
) {
  if (prepared.mode !== getGameDataMode()) {
    throw new Error('Game data mode changed since this Yumeo import was prepared. Prepare it again.')
  }
  const selectedOptionalUids = new Set(choices.optionalEchoUids ?? [])
  const reviewOptionalUids = new Set(prepared.review.optionalEchoes.map(({ echo }) => echo.uid))
  if ([...selectedOptionalUids].some((uid) => !reviewOptionalUids.has(uid))) {
    throw new Error('Invalid optional Echo selection. Prepare the Yumeo import again.')
  }
  const converted = resolveYumeoGameDataEquipmentConflicts(
    narrowYumeoGameData(prepared.converted, choices),
    choices.equipment ?? {},
  )
  if (converted.conflicts.weapons.length || converted.conflicts.echoSlots.length) {
    throw new Error('Resolve every equipment conflict before importing the Yumeo data.')
  }

  const result = applyConvertedYumeoGameData(converted)
  const optionalEchoesAdded = selectedOptionalUids.size
    ? addSelectedOptionalYumeoGameDataEchoes(result.optionalEchoes, [...selectedOptionalUids]).length
    : 0
  return { ...result, optionalEchoesAdded }
}

/** import with supplied equipment selections. */
export async function importYumeoGameData(raw: string, selections?: YumeoGameDataEquipmentSelections) {
  return applyPreparedYumeoGameData(await prepareYumeoGameData(raw), { equipment: selections })
}

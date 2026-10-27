/*
  Author: Runor Ewhro
  description: describes and recognizes version 1 JSON supplied by Yumeo's app.
*/

interface YumeoSkill { nodeId: number; level: number }
interface YumeoResonator {
  resonatorId: number
  level?: number
  chain?: number
  skills?: YumeoSkill[]
}
interface YumeoWeapon {
  instanceId?: number
  itemId: number
  level: number
  rank: number
  equippedByResonatorId?: number | null
}
interface YumeoStat { statId: number; statKey?: string; value?: unknown }
interface YumeoEcho {
  instanceId: number
  monsterId: number
  echoSetId: number
  level?: number
  mainStats: YumeoStat[]
  subStats: YumeoStat[]
  equippedByResonatorId?: number | null
  slotIndex?: number | null
}

export interface YumeoGameData {
  version: 1
  resonators: YumeoResonator[]
  weapons: YumeoWeapon[]
  echoes: YumeoEcho[]
}

export function parseYumeoGameData(raw: string): YumeoGameData {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object') throw new Error('Expected a Yumeo game-data JSON object.')
  const value = parsed as Partial<YumeoGameData>
  if (value.version !== 1 || !Array.isArray(value.resonators)
      || !Array.isArray(value.weapons) || !Array.isArray(value.echoes)) {
    throw new Error('Expected a version 1 Yumeo game-data export with resonators, weapons, and echoes.')
  }
  return value as YumeoGameData
}

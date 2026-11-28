/*
  Author: Runor Ewhro
  description: weapon passives for routes that run on the core catalog, which
               stores each passive's name without its description. the full
               catalog is read once per data mode, on first need, and only its
               passives are kept.
*/

import type { GenWpn, WpnPssv } from '@/domain/entities/weapon'
import type { GameDataMode } from '@/domain/entities/gameDataMode'
import { fetchGameData, gameDataUrl, getGameDataMode } from '@/data/gameData'

// loaded passives by data mode, and the request in flight for a mode
const loaded = new Map<GameDataMode, Map<string, WpnPssv>>()
const pending = new Map<GameDataMode, Promise<Map<string, WpnPssv>>>()

// a weapon's passive if this mode's passives have loaded, else null
export function peekWpnPssv(id: string): WpnPssv | null {
  return loaded.get(getGameDataMode())?.get(id) ?? null
}

// loads this mode's passives once; a failed read can be retried
export function loadWpnPssvs(): Promise<Map<string, WpnPssv>> {
  const mode = getGameDataMode()
  const done = loaded.get(mode)
  if (done) return Promise.resolve(done)
  let request = pending.get(mode)
  if (!request) {
    request = fetchGameData(gameDataUrl(mode, 'weapons/catalog.json'))
      .then((response) => {
        if (!response.ok) throw new Error(`Weapon catalog unavailable: ${response.status}`)
        return response.json() as Promise<GenWpn[]>
      })
      .then((weapons) => {
        // weapons without passive text are left out
        const byId = new Map(weapons.flatMap((weapon) => weapon.passive?.desc ? [[weapon.id, weapon.passive] as const] : []))
        loaded.set(mode, byId)
        return byId
      })
      .finally(() => pending.delete(mode))
    pending.set(mode, request)
  }
  return request
}

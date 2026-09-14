/*
  Author: Runor Ewhro
  Description: Fetches the latest Nanoka release manifest once per session and
               resolves its character, weapon, Echo, and enemy ids against the
               local catalogs.
*/

import { getResonatorSeedById, getEchoById } from '@/domain/services/catalogService'
import { getWpnsById } from '@/data/gameData/weapons/weaponDataStore'
import { spineSetupUrl } from '@/shared/spine/spineManifest'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { WPNTYPELBLS } from '@/modules/simulation/model/display'
import type { AttributeKey } from '@/domain/entities/stats'

const MANIFEST_URL = 'https://static.nanoka.cc/manifest.json'
// Bound the third-party request so catalog coverage never waits indefinitely.
const GIVE_UP_AFTER = 6000

interface RawManifest {
  ww?: {
    live?: string
    latest?: string
    new?: {
      character?: number[]
      weapon?: number[]
      echo?: number[]
      monster?: number[]
      hotfix?: string
    }
  }
}

export interface ArrivedThing {
  id: string
  name: string
  icon: string | null
  /** Whether the id resolves in the local catalog. */
  held: boolean
}

export interface ArrivedResonator extends ArrivedThing {
  attribute: AttributeKey | null
  attributeName: string
  weaponName: string
  colour: string
  tags: string[]
  /** Preferred setup artwork and its catalog fallback. */
  art: string
  artFallback: string | null
  signature: ArrivedThing | null
}

export interface Arrivals {
  live: string
  hotfix: string | null
  resonators: ArrivedResonator[]
  weapons: ArrivedThing[]
  echoes: ArrivedThing[]
  enemies: number
}

const capitalise = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)

function readWeapon(id: string): ArrivedThing {
  const weapon = getWpnsById()[id]
  return {
    id,
    name: weapon?.name ?? `Weapon ${id}`,
    icon: weapon?.icon ?? null,
    held: Boolean(weapon),
  }
}

function readEcho(id: string): ArrivedThing {
  const echo = getEchoById(id)
  return {
    id,
    name: echo?.name ?? `Echo ${id}`,
    icon: echo?.icon ?? null,
    held: Boolean(echo),
  }
}

function readResonator(id: string): ArrivedResonator {
  const seed = getResonatorSeedById(id)
  const attribute = seed?.attribute ?? null
  const signature = seed?.defaultWeaponId ? readWeapon(seed.defaultWeaponId) : null

  return {
    id,
    name: seed?.name ?? `Resonator ${id}`,
    icon: seed?.profile ?? null,
    held: Boolean(seed),
    attribute,
    attributeName: attribute ? capitalise(attribute) : '',
    weaponName: seed ? (WPNTYPELBLS[seed.weaponType] ?? '') : '',
    colour: attribute ? ATTR_COLORS[attribute] : 'var(--accent)',
    tags: (seed?.tags ?? []).map((tag) => tag.name),
    art: spineSetupUrl(id, 'luckdraw'),
    artFallback: seed?.sprite ?? null,
    signature,
  }
}

function shape(raw: RawManifest): Arrivals | null {
  const ww = raw.ww
  const arrived = ww?.new
  if (!ww || !arrived) return null

  const resonators = (arrived.character ?? []).map((id) => readResonator(String(id)))
  // Remove signatures already paired with their arriving resonator.
  const signed = new Set(resonators.map((one) => one.signature?.id).filter(Boolean))

  return {
    live: ww.live ?? ww.latest ?? '',
    hotfix: arrived.hotfix ?? null,
    resonators,
    weapons: (arrived.weapon ?? [])
        .map((id) => readWeapon(String(id)))
        .filter((weapon) => !signed.has(weapon.id)),
    echoes: (arrived.echo ?? []).map((id) => readEcho(String(id))),
    enemies: (arrived.monster ?? []).length,
  }
}

let pending: Promise<Arrivals | null> | null = null

/* Cache one request per session. Network, timeout, and parse failures resolve
   to null so unavailable remote data cannot fail the route. */
export function loadArrivals(): Promise<Arrivals | null> {
  if (pending) return pending

  const stop = new AbortController()
  const timer = window.setTimeout(() => stop.abort(), GIVE_UP_AFTER)

  pending = fetch(MANIFEST_URL, { signal: stop.signal })
      .then((response) => (response.ok ? (response.json() as Promise<RawManifest>) : null))
      .then((raw) => (raw ? shape(raw) : null))
      .catch(() => null)
      .finally(() => window.clearTimeout(timer))

  return pending
}

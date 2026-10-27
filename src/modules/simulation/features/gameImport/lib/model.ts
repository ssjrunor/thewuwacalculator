/*
  Author: Runor Ewhro
  description: builds resonator and Echo review rows from a prepared game data import.
*/

import type { YumeoGameDataImportChoices } from '@/application/imports/yumeoGameData'
import type { YumeoGameDataImportSession } from '@/application/imports/yumeo/session'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getEchoSignature } from '@/domain/entities/inventoryStorage'
import { makeResProfile } from '@/engine/runtime/defaults'
import { roverIdForGender } from '@/domain/entities/roverGender'
import type { EchoInstance, ResRuntime, SkillLevels, WeaponState } from '@/domain/entities/runtime'
import type { AttributeKey } from '@/domain/entities/stats'

type Review = YumeoGameDataImportSession['review']
export type WeaponConflict = Review['conflicts']['weapons'][number]
export type EchoSlotConflict = Review['conflicts']['echoSlots'][number]

export const REVIEW_SKILLS = [
  'normalAttack', 'resonanceSkill', 'resonanceLiberation', 'introSkill', 'forteCircuit',
] as const satisfies readonly (keyof SkillLevels)[]

const ATTR_ORDER: AttributeKey[] = ['glacio', 'fusion', 'electro', 'aero', 'spectro', 'havoc']

export type RowKind = 'changed' | 'new' | 'same'

export interface BuildDetails {
  level: number
  sequence: number
  skills: number[]
  weapon: WeaponState | null
  echoes: Array<EchoInstance | null>
}

export interface ReviewRow {
  id: string
  name: string
  attribute: AttributeKey
  sprite: string
  profile: string
  file: BuildDetails
  now: BuildDetails | null
  kind: RowKind
  conflict: WeaponConflict | null
  // false when the import retains the current weapon
  weaponFromFile: boolean
  // slots that require an Echo selection
  echoConflicts: EchoSlotConflict[]
}

export interface ReviewEcho {
  echo: EchoInstance
  level: number
  ownerId?: string
  slotIndex?: number
  optional: boolean
  // source index for a contested Echo slot
  sourceIndex?: number
}

export interface ReviewEchoGroup {
  id: string
  label: string
  level: number | null
  items: ReviewEcho[]
}

export interface GameImportReview {
  rows: ReviewRow[]
  groups: ReviewEchoGroup[]
  unlevelled: number
  echoTotal: number
  weaponTotal: number
}

export function resSprite(id: string): string {
  return getResSeedBy(id)?.sprite ?? `/assets/game/resonators/sprites/${id}.webp`
}

export function resProfile(id: string): string {
  return getResSeedBy(id)?.profile ?? `/assets/game/resonators/profiles/${id}.webp`
}

export function attrIcon(attribute: string): string {
  return `/assets/game/attributes/icons/${attribute}.webp`
}

function detailsOf(runtime: ResRuntime): BuildDetails {
  return {
    level: runtime.base.level,
    sequence: runtime.base.sequence,
    skills: REVIEW_SKILLS.map((key) => runtime.base.skillLevels[key]),
    weapon: runtime.build.weapon?.id ? runtime.build.weapon : null,
    echoes: Array.from({ length: 5 }, (_, slot) => runtime.build.echoes[slot] ?? null),
  }
}

const sameWeapon = (a: WeaponState | null, b: WeaponState | null) =>
  (a?.id ?? null) === (b?.id ?? null) && (!a || !b || (a.level === b.level && a.rank === b.rank))

const echoSig = (echo: EchoInstance | null) => (echo ? getEchoSignature(echo) : '')

function kindOf(file: BuildDetails, now: BuildDetails | null, contested: boolean): RowKind {
  if (!now) return 'new'
  if (contested) return 'changed'
  const same = file.level === now.level
    && file.sequence === now.sequence
    && file.skills.every((level, index) => level === now.skills[index])
    && sameWeapon(file.weapon, now.weapon)
    && file.echoes.every((echo, slot) => echoSig(echo) === echoSig(now.echoes[slot]))
  return same ? 'same' : 'changed'
}

export function buildGameImportReview(
  review: Review,
  runtimesById: Record<string, ResRuntime>,
  roverGender: Parameters<typeof roverIdForGender>[1],
): GameImportReview {
  const conflicts = new Map(review.conflicts.weapons.map((entry) => [entry.resonatorId, entry]))
  const rows: ReviewRow[] = []
  for (const resonator of review.resonators) {
    const seed = getResSeedBy(resonator.id)
    if (!seed) continue
    const current = runtimesById[roverIdForGender(resonator.id, roverGender)]
    const now = current ? detailsOf(current) : null
    const echoes: Array<EchoInstance | null> = [null, null, null, null, null]
    for (const { slotIndex, echo } of resonator.echoes) echoes[slotIndex] = echo
    const conflict = conflicts.get(resonator.id) ?? null
    const echoConflicts = review.conflicts.echoSlots.filter((entry) => entry.resonatorId === resonator.id)
    // use the current or default weapon when the file has none.
    const fallbackWeapon = now ? now.weapon : makeResProfile(seed).runtime.build.weapon
    const file: BuildDetails = {
      level: resonator.level ?? now?.level ?? 1,
      sequence: resonator.sequence ?? now?.sequence ?? 0,
      skills: REVIEW_SKILLS.map((key, index) => resonator.skillLevels[key] ?? now?.skills[index] ?? 1),
      weapon: resonator.weapon ?? (fallbackWeapon?.id ? fallbackWeapon : null),
      echoes,
    }
    rows.push({
      id: resonator.id,
      name: seed.name,
      attribute: seed.attribute,
      sprite: resSprite(resonator.id),
      profile: resProfile(resonator.id),
      file,
      now,
      kind: kindOf(file, now, conflict != null || echoConflicts.length > 0),
      conflict,
      weaponFromFile: resonator.weapon != null,
      echoConflicts,
    })
  }
  rows.sort((a, b) => ATTR_ORDER.indexOf(a.attribute) - ATTR_ORDER.indexOf(b.attribute)
    || (getResSeedBy(b.id)?.rarity ?? 4) - (getResSeedBy(a.id)?.rarity ?? 4))

  // group equipped and contested Echoes before bag Echoes.
  const equipped: ReviewEcho[] = rows.flatMap((row) => [
    ...row.file.echoes.flatMap((echo, slotIndex) => (
      echo ? [{ echo, level: review.echoMeta[echo.uid]?.level ?? 25, ownerId: row.id, slotIndex, optional: false }] : []
    )),
    ...row.echoConflicts.flatMap((entry) => entry.candidates.map(({ sourceIndex, echo }) => (
      { echo, level: review.echoMeta[echo.uid]?.level ?? 25, ownerId: row.id, slotIndex: entry.slotIndex, optional: false, sourceIndex }
    ))),
  ])
  const worn = new Set(equipped.map((entry) => entry.echo.uid))
  const bag: ReviewEcho[] = [
    ...review.inventoryEchoesToAdd
      .filter((echo) => !worn.has(echo.uid) && !review.echoMeta[echo.uid]?.ownerId)
      .map((echo) => ({ echo, level: review.echoMeta[echo.uid]?.level ?? 25, optional: false })),
    ...review.optionalEchoes.map(({ level, echo }) => ({ echo, level, optional: true })),
  ]
  const levels = [...new Set(bag.map((entry) => entry.level))].sort((a, b) => b - a)
  const groups: ReviewEchoGroup[] = [
    { id: 'eq', label: 'Equipped', level: null, items: equipped },
    ...levels.map((level) => ({
      id: `l${level}`,
      label: `Lv ${level}`,
      level,
      items: bag.filter((entry) => entry.level === level),
    })),
  ].filter((group) => group.items.length > 0)

  const weaponTotal = rows.filter((row) => row.weaponFromFile).length
    + review.conflicts.weapons.reduce((total, entry) => total + entry.candidates.length, 0)
    + review.skipped.weapons

  return {
    rows,
    groups,
    unlevelled: review.skipped.unlevelledEchoes,
    echoTotal: equipped.length + bag.length + review.skipped.unlevelledEchoes,
    weaponTotal,
  }
}

export const slotKey = (resonatorId: string, slotIndex: number) => `${resonatorId}:${slotIndex}`

/** initially selected Echoes include level 25 bag items and contested slot candidates. */
export function defaultEchoSelection(model: GameImportReview): Set<string> {
  return new Set(model.groups.flatMap((group) => group.items)
    .filter((entry) => (!entry.ownerId && entry.level === 25) || entry.sourceIndex != null)
    .map((entry) => entry.echo.uid))
}

export interface ReviewPicks {
  skip: ReadonlySet<string>
  weapons: ReadonlyMap<string, number>
  // contested slot key to selected source index
  slots: ReadonlyMap<string, number>
  echoes: ReadonlySet<string>
}

/** whether an Echo is equipped by a retained resonator. */
export function echoLocked(entry: ReviewEcho, picks: Pick<ReviewPicks, 'skip' | 'slots'>): boolean {
  if (entry.ownerId == null || picks.skip.has(entry.ownerId)) return false
  if (entry.sourceIndex == null) return true
  return picks.slots.get(slotKey(entry.ownerId, entry.slotIndex!)) === entry.sourceIndex
}

export type OpenConflict = { row: ReviewRow; slotIndex: number | null }

/** unresolved weapon and Echo choices in review order. */
export function openConflicts(model: GameImportReview, picks: ReviewPicks): OpenConflict[] {
  return model.rows.filter((row) => !picks.skip.has(row.id)).flatMap((row) => [
    ...(row.conflict && !picks.weapons.has(row.id) ? [{ row, slotIndex: null }] : []),
    ...row.echoConflicts
      .filter((entry) => !picks.slots.has(slotKey(row.id, entry.slotIndex)))
      .map((entry) => ({ row, slotIndex: entry.slotIndex })),
  ])
}

/** selected Echoes for a resonator row. */
export function rowEchoes(row: ReviewRow, picks: ReviewPicks): Array<EchoInstance | null> {
  if (!row.echoConflicts.length) return row.file.echoes
  const echoes = [...row.file.echoes]
  for (const entry of row.echoConflicts) {
    const sourceIndex = picks.slots.get(slotKey(row.id, entry.slotIndex))
    echoes[entry.slotIndex] = entry.candidates.find((candidate) => candidate.sourceIndex === sourceIndex)?.echo ?? null
  }
  return echoes
}

export function reviewChoices(
  review: Review,
  model: GameImportReview,
  picks: ReviewPicks,
): YumeoGameDataImportChoices {
  const entries = model.groups.flatMap((group) => group.items)
  return {
    skipResonatorIds: [...picks.skip],
    equipment: {
      weapons: [...picks.weapons]
        .filter(([resonatorId]) => !picks.skip.has(resonatorId))
        .map(([resonatorId, sourceIndex]) => ({ resonatorId, sourceIndex })),
      echoSlots: review.conflicts.echoSlots
        .filter((entry) => !picks.skip.has(entry.resonatorId) && picks.slots.has(slotKey(entry.resonatorId, entry.slotIndex)))
        .map((entry) => ({
          resonatorId: entry.resonatorId,
          slotIndex: entry.slotIndex,
          sourceIndex: picks.slots.get(slotKey(entry.resonatorId, entry.slotIndex))!,
        })),
    },
    excludedEchoUids: entries
      .filter((entry) => !entry.optional && !echoLocked(entry, picks) && !picks.echoes.has(entry.echo.uid))
      .map((entry) => entry.echo.uid),
    optionalEchoUids: entries
      .filter((entry) => entry.optional && picks.echoes.has(entry.echo.uid))
      .map((entry) => entry.echo.uid),
  }
}

/** selected weapon for a resonator row. */
export function rowWeapon(row: ReviewRow, picks: Pick<ReviewPicks, 'weapons'>): WeaponState | null {
  if (!row.conflict) return row.file.weapon
  const sourceIndex = picks.weapons.get(row.id)
  return row.conflict.candidates.find((candidate) => candidate.sourceIndex === sourceIndex)?.weapon ?? null
}

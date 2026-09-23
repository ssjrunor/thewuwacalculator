/*
  Author: Runor Ewhro
  Description: Groups visible source states by canonical ownership scope for the selected member.
*/

import type { SourceState, SrcOwnDef } from '@/domain/gameData/contracts'
import { isNoWeaponId, type ResRuntime } from '@/domain/entities/runtime'
import { listOwnersFor, listSttsForO } from '@/data/catalog/gameDataService'
import { getMainEchoS } from '@/engine/services/runtimeSourceService'
import { isStateVisible } from '@/engine/services/sourceStateService'
import { isSrcSttOn } from '@/modules/simulation/features/controls/lib/runtimeStateUtils'
import { getStateText } from '@/modules/simulation/model/sourceStateDisplay'
import { getSntSetIco, getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { getEchoById } from '@/data/catalog/echoCatalogService'
import { getWeapon } from '@/modules/simulation/features/weapons/lib/weapon'
import { resInherentIcon, resNodeIcon, resSeqIcon } from '@/shared/lib/gameAssets'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { getResonator } from '@/modules/simulation/features/resonator/lib/resonator.ts'
import { mkForteMode } from '@/modules/simulation/features/resonator/lib/forteTree.ts'
import { getSrcSttNct } from '@/engine/gameData/controlOptions'
import { sourceOptions } from '@/engine/services/sourceStateService'
import { resPssvPrms } from '@/modules/simulation/features/weapons/lib/weapon'

/* a bay's glyph is either a real asset or a white node icon used as a mask */
export interface BayGlyph {
  img?: string
  mask?: string
}

export interface BayRow {
  state: SourceState
  label: string
  description: string | null
  /** the control's own reading: on/off, the stack count, the number */
  value: boolean | number | string
  /** dependencies met, so the control accepts input */
  enabled: boolean
  /** the state is actually contributing right now */
  lit: boolean
  max: number
  /** the art of whatever produced this effect, worn on its own port */
  glyph: BayGlyph
  /** what the build still has to reach before this can be switched on */
  gate: string | null
  /** authored placeholders the description needs filled, weapon rank and such */
  params: Array<string | number>
  options: Array<{ value: string | number | boolean; label: string }>
}

export interface ModulationBay {
  id: string
  label: string
  /**
   * the rarity the section's accent takes, when the thing it stands for has
   * one. the console tints its weapon block by the weapon's rarity, so the
   * weapon reads gold at 5-star rather than taking the resonator's colour.
   */
  rarity: number | null
  /** the small caption on the right of the bay head: which thing this came from */
  source: string
  glyph: BayGlyph
  rows: BayRow[]
}

/* three sections, in the order they are drawn */
const BAY_ORDER = ['resonator', 'weapon', 'echoes'] as const
type BayId = (typeof BAY_ORDER)[number]

const BAY_LABEL: Record<BayId, string> = {
  resonator: 'RESONATOR',
  weapon: 'WEAPON',
  echoes: 'ECHOES',
}

function bayFor(owner: SrcOwnDef): BayId {
  if (owner.source.type === 'weapon') return 'weapon'
  if (owner.source.type === 'echo' || owner.source.type === 'echoSet') return 'echoes'
  return 'resonator'
}

const BY_KIND: Record<string, number> = {
  stateGroup: 0,
  inherent: 1,
  outroSkill: 2,
  combatState: 3,
  sequence: 4,
}

/*
  a teamBuff and a buffWindow name how an effect is applied, not what bought it,
  so those owners are placed by the key instead: qingxiao's s4 is authored as a
  team buff and is still a chain node, and the port already reads its art the
  same way.
*/
const BY_KEY: Record<string, number> = {
  resonator: 0,
  self: 0,
  inherent: 1,
  outroSkill: 2,
  team: 2,
  combatState: 3,
  sequence: 4,
}

function resOwnerRank(owner: SrcOwnDef): number {
  const byKind = BY_KIND[owner.kind]
  if (byKind !== undefined) return byKind

  return BY_KEY[owner.ownerKey.split(':')[0]] ?? Object.keys(BY_KEY).length
}

/* which sequence tier an owner hangs off, if it is a chain node at all */
function seqTier(ownerKey: string): number | null {
  const tier = Number(/:s(\d)\b/.exec(ownerKey)?.[1])
  return Number.isFinite(tier) && tier > 0 ? tier : null
}

function rowGlyph(owner: SrcOwnDef, srcRt: ResRuntime, weaponIcon: string | null): BayGlyph {
  if (owner.source.type === 'weapon') {
    return { img: weaponIcon ?? undefined }
  }

  if (owner.source.type === 'echoSet') {
    return { img: getSntSetIco(Number(owner.source.id)) ?? undefined }
  }

  if (owner.source.type === 'echo') {
    return { img: getEchoById(owner.source.id)?.icon ?? undefined }
  }

  const tier = seqTier(owner.ownerKey)
  if (tier) {
    return { mask: resSeqIcon(srcRt.id, tier) }
  }

  if (owner.scope === 'inherent') {
    const level = Number(/:lvl(\d+)/.exec(owner.ownerKey)?.[1])
    const order = getResonator(srcRt.id)?.inherentSkills
      ?.findIndex((skill) => Number(skill.unlockLevel) === level) ?? -1
    const icon = order >= 0 ? resInherentIcon(srcRt.id, order) : null
    return { mask: icon ?? resNodeIcon(srcRt.id, 'forteCircuit') }
  }

  if (owner.scope === 'outroSkill' || owner.scope === 'team') {
    return { mask: resNodeIcon(srcRt.id, 'outroSkill') }
  }

  return { mask: resNodeIcon(srcRt.id, 'forteCircuit') }
}

/*
  a state the build has not unlocked yet is worth drawing rather than hiding: a
  greyed row with its gate printed says what a sequence or a level would buy.
  only an unmet level or sequence gate qualifies -- anything else genuinely does
  not apply to this build and stays out.
*/
function gateOf(state: SourceState): { label: string; met: (rt: ResRuntime) => boolean } | null {
  const cond = state.visibleWhen
  if (!cond || !('type' in cond) || cond.type !== 'gte' || !('path' in cond)) {
    return null
  }

  const need = Number((cond as { value?: unknown }).value)
  if (!Number.isFinite(need)) return null

  if (cond.path === 'base.sequence') {
    return { label: `S${need}`, met: (rt) => rt.base.sequence >= need }
  }

  if (cond.path === 'base.level') {
    return { label: `Lv ${need}`, met: (rt) => rt.base.level >= need }
  }

  return null
}

function readValue(runtime: ResRuntime, state: SourceState): boolean | number | string {
  const raw = runtime.state.controls[state.controlKey]
  if (raw !== undefined) {
    return raw as boolean | number | string
  }

  return (state.defaultValue ?? (state.kind === 'toggle' ? false : 0)) as boolean | number | string
}

function stackMax(srcRt: ResRuntime, tgtRt: ResRuntime, state: SourceState, actRt: ResRuntime): number {
  const authored = Number(state.max ?? state.maxValue)
  if (Number.isFinite(authored) && authored > 0) {
    return authored
  }

  const natural = Number(getSrcSttNct(srcRt, tgtRt, state, actRt))
  return Number.isFinite(natural) && natural > 0 ? natural : 1
}

function modulationOwners(srcRt: ResRuntime): SrcOwnDef[] {
  const weaponId = srcRt.build.weapon.id
  const mainEcho = getMainEchoS(srcRt)
  const setIds = new Set(
    srcRt.build.echoes
      .filter((echo): echo is NonNullable<typeof echo> => Boolean(echo))
      .map((echo) => String(echo.set)),
  )

  return [
    ...[...listOwnersFor('resonator', srcRt.id)].sort(
      (a, b) => resOwnerRank(a) - resOwnerRank(b),
    ),
    ...(isNoWeaponId(weaponId) ? [] : listOwnersFor('weapon', weaponId)),
    ...(mainEcho ? listOwnersFor(mainEcho.type, mainEcho.id) : []),
    ...[...setIds].flatMap((setId) => listOwnersFor('echoSet', setId)),
  ]
}

function forteModeControlKey(srcRt: ResRuntime): string | null {
  const member = getResonator(srcRt.id)
  return member ? mkForteMode(member)?.controlKey ?? null : null
}

function stateVisibility(
  srcRt: ResRuntime,
  actRt: ResRuntime,
  state: SourceState,
): { drawn: boolean; visible: boolean } {
  const gate = gateOf(state)
  const visible = isStateVisible(srcRt, srcRt, state, actRt)
  return {
    visible,
    drawn: visible || Boolean(gate && !gate.met(srcRt)),
  }
}

/** Counts active and available effects without materializing row metadata. */
export function countModulationEffects(
  srcRt: ResRuntime,
  actRt: ResRuntime,
): { on: number; all: number } {
  const treeModeControlKey = forteModeControlKey(srcRt)
  let on = 0
  let all = 0

  for (const owner of modulationOwners(srcRt)) {
    for (const state of listSttsForO(owner.ownerKey)) {
      if (treeModeControlKey && state.controlKey === treeModeControlKey) continue
      const { drawn, visible } = stateVisibility(srcRt, actRt, state)
      if (!drawn) continue

      all += 1
      if (!visible || !isSrcSttOn(srcRt, srcRt, state, actRt)) continue
      const value = readValue(srcRt, state)
      const lit = state.kind === 'toggle'
        ? value === true
        : Number(value) > Number(state.min ?? 0)
      if (lit) on += 1
    }
  }

  return { on, all }
}

/*
  the shown resonator's own switches, in bays.

  teammates are deliberately absent: their states belong to the member console,
  which already owns them, and this surface is about the resonator on the rail.
*/
export function makeModulationBays(
  srcRt: ResRuntime,
  actRt: ResRuntime,
): ModulationBay[] {
  const weaponId = srcRt.build.weapon.id
  const weapon = getWeapon(weaponId)
  const mainEcho = getMainEchoS(srcRt)
  const setIds = Array.from(
    new Set(
      srcRt.build.echoes
        .filter((echo): echo is NonNullable<typeof echo> => Boolean(echo))
        .map((echo) => String(echo.set)),
    ),
  )

  const owners = modulationOwners(srcRt)

  /*
    a resonator whose modes the tree can draw gets its sigil at the crown, so
    the panel would be the second place to set one thing. one whose group the
    tree declines (phoebe: a status she can also be in neither of, and no art)
    keeps it here as an ordinary cell.
  */
  const treeModeControlKey = forteModeControlKey(srcRt)
  const weaponIcon = weapon?.icon ?? null

  const byBay = new Map<BayId, { owners: SrcOwnDef[]; rows: BayRow[] }>()

  for (const owner of owners) {
    const bay = bayFor(owner)
    const entry = byBay.get(bay) ?? { owners: [], rows: [] }
    entry.owners.push(owner)

    for (const state of listSttsForO(owner.ownerKey)) {
      if (treeModeControlKey && state.controlKey === treeModeControlKey) {
        continue
      }

      const gate = gateOf(state)
      const { drawn, visible } = stateVisibility(srcRt, actRt, state)

      // hidden and not merely gated: this state does not apply to the build
      if (!drawn) {
        continue
      }

      const text = getStateText(state)
      const value = readValue(srcRt, state)
      const max = state.kind === 'stack' || state.kind === 'number'
        ? stackMax(srcRt, srcRt, state, actRt)
        : 1
      const lit = state.kind === 'toggle'
        ? value === true
        : Number(value) > Number(state.min ?? 0)

      entry.rows.push({
        state,
        label: state.label,
        description: text.description ?? state.description ?? null,
        value,
        enabled: visible && isSrcSttOn(srcRt, srcRt, state, actRt),
        lit: lit && visible,
        max,
        gate: visible ? null : gate?.label ?? null,
        glyph: rowGlyph(owner, srcRt, weaponIcon),
        params: state.source.type === 'weapon' && weapon
          ? resPssvPrms(weapon.passive.params, srcRt.build.weapon.rank)
          : [],
        options: state.kind === 'select'
          ? sourceOptions(srcRt, srcRt, state, actRt).map((option) => ({
            value: option.id,
            label: option.label,
          }))
          : [],
      })
    }

    byBay.set(bay, entry)
  }

  const setNames = setIds.map((setId) => getSntSetNam(Number(setId))).filter(Boolean)
  const mainEchoName = mainEcho ? getEchoById(mainEcho.id)?.name ?? null : null
  const seed = getResSeedBy(srcRt.id)

  const caption: Record<BayId, string> = {
    resonator: seed?.name ?? 'Resonator',
    weapon: weapon?.name ?? 'Weapon',
    echoes: [mainEchoName, ...setNames].filter(Boolean).join(' / ') || 'Echoes',
  }

  const sectionGlyph: Record<BayId, BayGlyph> = {
    resonator: { img: seed?.profile ?? undefined },
    weapon: { img: weapon?.icon ?? undefined },
    echoes: {
      img: mainEcho
        ? getEchoById(mainEcho.id)?.icon ?? undefined
        : getSntSetIco(Number(setIds[0])) ?? undefined,
    },
  }

  return BAY_ORDER.flatMap((id) => {
    const entry = byBay.get(id)
    if (!entry || entry.rows.length === 0) {
      return []
    }

    return [{
      id,
      label: BAY_LABEL[id],
      source: caption[id],
      glyph: sectionGlyph[id],
      rarity: id === 'weapon' ? weapon?.rarity ?? null : null,
      rows: entry.rows,
    }]
  })
}

/** how many of the drawn switches are actually contributing */
export function countLive(bays: ModulationBay[]): { on: number; all: number } {
  let on = 0
  let all = 0
  for (const bay of bays) {
    for (const row of bay.rows) {
      all += 1
      if (row.lit && row.enabled) on += 1
    }
  }
  return { on, all }
}

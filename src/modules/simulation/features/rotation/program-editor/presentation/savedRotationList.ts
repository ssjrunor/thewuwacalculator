/*
  Author: Runor Ewhro
  Description: resolves saved rotations into the marks the saved list draws.
               a saved rotation is one run from zero to its average, cut into
               the members who dealt it, so everything here exists to turn an
               entry into those runs and to work out the window the field is
               currently read through.
*/

import {
  savedRotationContextMember,
  type SavedRotation,
} from '@/domain/entities/inventoryStorage'
import type { RotationComparisonSummary } from '@/domain/entities/rotationSummary'
import type { ResonatorId } from '@/domain/entities/runtime'
import type { UiState } from '@/domain/entities/appState'
import { ATTR_COLORS } from '@/domain/gameData/attributeDisplay'
import { getResSeedBy } from '@/domain/services/resonatorSeedService'
import { isLiveRotEntId } from '@/domain/state/liveRotationEntry'
import { DEF_ICON_SRC } from '@/shared/lib/imageFallback'
import { formatTrunc, formatTruncCompact } from '@/shared/lib/number.ts'

export const CMP_MAX = 4

export function formatDuration(durationSeconds: number): string {
  return `${formatTruncCompact(Math.max(0, durationSeconds), 1)}s`
}

export type SavedListView = 'list' | 'groups'
type SavedPrefs = Pick<
  UiState['savedRotationPreferences'],
  'sortBy' | 'sortOrder' | 'contributionFilter'
>

export interface SavedMember {
  id: ResonatorId
  name: string
  accent: string
  profile: string
  /* the standing art, and where the face sits inside it. the picked row's cut
     lands every member's face on the same spot, so it needs the point rather
     than the picture alone */
  sprite: string
  faceX: number
  faceY: number
  faceScale: number
  /* the member's cut of the average, 0 to 1 */
  share: number
  /* the member's own run on the shared axis, cumulative in team order, so the
     row's line reads as one mark and still says who dealt which part of it */
  from: number
  to: number
  /** precision-aware display allocation; all members sum to the displayed total */
  figure?: number
}

export interface SavedEntry {
  id: string
  /* what the take is called once the squad it names is taken off the front */
  label: string
  /* the members other than the lead, named, for the row's own line */
  mates: SavedMember[]
  members: SavedMember[]
  lead: SavedMember
  normal: number
  avg: number
  crit: number
  duration: number
  dps: number | null
  updatedAt: number
  entry: SavedRotation
  /* the last completed live take rather than one that was kept. it is resolved
     and ranked exactly like the rest, and drawn as the row it would become */
  live: boolean
}

/** Members that dealt damage, independent of who merely occupied a team slot. */
export function savedContributors(row: Pick<SavedEntry, 'members'>): SavedMember[] {
  return row.members.filter((member) => member.to > member.from)
}

export interface SavedAxis {
  lo: number
  hi: number
  /* 0 to 1 along the track */
  at: (value: number) => number
}

export interface SavedGroup {
  lead: SavedMember
  takes: SavedEntry[]
  best: number
}

export interface SavedRosterMember {
  id: ResonatorId
  name: string
  accent: string
  profile: string
  damage: number
  entries: number
}

export interface SavedMemberTake {
  id: string
  label: string
  lead: SavedMember
  damage: number
  share: number
  total: number
  /* the take's own snapshot, so the ledger can open one and read the build the
     figure was made with rather than only the figure */
  entry: SavedRotation
}

const PROFILE_ROOT = '/assets/game/resonators/profiles'
const SPRITE_ROOT = '/assets/game/resonators/sprites'
/*
  where a face sits in a sprite when the catalog has not been told otherwise.
  the shipped art frames every resonator the same way, so one point covers the
  roster and the catalog's own spriteFace fields correct the exceptions.
*/
const DEF_FACE_X = 48
const DEF_FACE_Y = 31

// the app uses the profile for every small portrait and the shared default
// asset when a resonator has no art shipped yet
function savedFace(resonatorId: ResonatorId | undefined): string {
  if (!resonatorId) {
    return DEF_ICON_SRC
  }

  return getResSeedBy(resonatorId)?.profile ?? `${PROFILE_ROOT}/${resonatorId}.webp`
}

// the standing art, which is the only portrait large enough to be cut into
function savedSprite(resonatorId: ResonatorId | undefined): string {
  if (!resonatorId) {
    return DEF_ICON_SRC
  }

  const seed = getResSeedBy(resonatorId)
  return seed?.sprite ?? seed?.profile ?? `${SPRITE_ROOT}/${resonatorId}.webp`
}

function faceAt(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Number(value))) / 100 : fallback / 100
}

function savedAccent(resonatorId: ResonatorId | undefined): string {
  const attribute = resonatorId ? getResSeedBy(resonatorId)?.attribute : null
  return attribute ? ATTR_COLORS[attribute] : ATTR_COLORS.physical
}

function makeSavedMember(
  resonatorId: ResonatorId,
  fallbackName: string,
  share: number,
  from = 0,
  to = 0,
): SavedMember {
  const seed = getResSeedBy(resonatorId)
  const scale = Number(seed?.spriteFaceScale)
  return {
    id: resonatorId,
    name: seed?.name ?? fallbackName,
    accent: savedAccent(resonatorId),
    profile: savedFace(resonatorId),
    sprite: savedSprite(resonatorId),
    faceX: faceAt(seed?.spriteFaceX, DEF_FACE_X),
    faceY: faceAt(seed?.spriteFaceY, DEF_FACE_Y),
    faceScale: Number.isFinite(scale) ? Math.max(0.5, Math.min(2, scale)) : 1,
    share,
    from,
    to,
  }
}

function apportionMemberFigures(
  members: SavedMember[],
  total: number,
  decimals: number,
): SavedMember[] {
  const places = Math.min(Math.max(Math.trunc(decimals), 0), 4)
  const factor = 10 ** places
  const safeTotal = Number.isFinite(total) ? total : 0
  const target = Math.max(0, Math.round(safeTotal * factor))
  const values = members.map((member) => Math.max(0, member.to - member.from))
  const valueTotal = values.reduce((sum, value) => sum + value, 0)
  if (members.length === 0) return members
  if (valueTotal <= 0) {
    return members.map((member, index) => ({
      ...member,
      figure: index === 0 ? target / factor : 0,
    }))
  }

  const quotas = values.map((value) => (value / valueTotal) * target)
  const figures = quotas.map(Math.floor)
  let remainder = target - figures.reduce((sum, value) => sum + value, 0)
  const order = quotas
    .map((quota, index) => ({ index, fraction: quota - figures[index]! }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    figures[order[index]!.index]! += 1
    remainder -= 1
  }

  return members.map((member, index) => ({
    ...member,
    figure: (figures[index] ?? 0) / factor,
  }))
}

/*
  the lead column already says who a rotation was written for, so the row only
  has to say what is left of the name. entries are saved as "A/B/C Rotation 2",
  and a bare "Rotation" says nothing at all once the squad is off the front.
*/
export function savedEntryLabel(entry: SavedRotation, members: SavedMember[]): string {
  const name = entry.name.trim()
  const squad = members.map((member) => member.name).join('/')
  const context = savedRotationContextMember(entry)
  const contextName = getResSeedBy(context.resonatorId)?.name ?? context.resonatorId
  const heads = [squad, contextName, members[0]?.name ?? '']

  for (const head of heads) {
    if (head && name.startsWith(head)) {
      const rest = name.slice(head.length).trim()
      if (rest) {
        return rest
      }
    }
  }

  return name
}

// one saved rotation, resolved into the row that draws it
export function makeSavedEntry(
  entry: SavedRotation,
  summary?: RotationComparisonSummary,
  decimals = 0,
): SavedEntry {
  const totals = summary?.total
  const avg = totals?.avg ?? 0
  const contributions = summary?.members ?? []

  /* the runs are laid end to end in team order, so the last one closes on the
     entry's own average and the row stays one mark on the shared axis */
  let cursor = 0
  const context = savedRotationContextMember(entry)
  const contextName = getResSeedBy(context.resonatorId)?.name ?? context.resonatorId
  const rawMembers: SavedMember[] = contributions.length > 0
    ? contributions.map((member) => {
      const from = cursor
      cursor += Math.max(0, member.contribution.avg)
      return makeSavedMember(
        member.id,
        member.name,
        avg > 0 ? member.contribution.avg / avg : 0,
        from,
        cursor,
      )
    })
    : [makeSavedMember(context.resonatorId, contextName, 1, 0, avg)]
  const members = apportionMemberFigures(rawMembers, avg, decimals)

  const lead = members.find((member) => member.id === context.resonatorId)
    ?? makeSavedMember(context.resonatorId, contextName, members.length === 0 ? 1 : 0)

  return {
    id: entry.id,
    label: savedEntryLabel(entry, members),
    members,
    mates: members.filter((member) => member.id !== lead.id),
    lead,
    normal: totals?.normal ?? 0,
    avg,
    crit: totals?.crit ?? 0,
    duration: entry.duration,
    dps: entry.duration > 0 && avg > 0 ? avg / entry.duration : null,
    updatedAt: entry.updatedAt,
    entry,
    live: isLiveRotEntId(entry.id),
  }
}

export function makeSavedEntries(
  entries: SavedRotation[],
  prefs: SavedPrefs,
  query = '',
  summariesById?: ReadonlyMap<string, RotationComparisonSummary>,
  decimals = 0,
): SavedEntry[] {
  const needle = query.trim().toLowerCase()
  const kept = entries.filter((entry) => {
    const summary = summariesById?.get(entry.id)
    if (!summary) return false

    if (!needle) {
      return true
    }

    return entry.name.toLowerCase().includes(needle)
      || (getResSeedBy(savedRotationContextMember(entry).resonatorId)?.name
        ?? savedRotationContextMember(entry).resonatorId).toLowerCase().includes(needle)
      || summary.members?.some((member) => member.name.toLowerCase().includes(needle))
  })

  const contributorCount = prefs.contributionFilter === 'solo'
    ? 1
    : prefs.contributionFilter === 'duo'
      ? 2
      : prefs.contributionFilter === 'trio'
        ? 3
        : null
  const rows = kept.map((entry) => makeSavedEntry(
    entry,
    summariesById?.get(entry.id),
    decimals,
  )).filter((row) => (
    contributorCount == null || savedContributors(row).length === contributorCount
  ))
  rows.sort((a, b) => {
    let cmp = 0
    switch (prefs.sortBy) {
      case 'name':
        cmp = a.entry.name.localeCompare(b.entry.name)
        break
      case 'avg':
        cmp = a.avg - b.avg
        break
      case 'dps':
        // a rotation nobody timed has no rate, so it sorts last either way
        if (a.dps != null && b.dps == null) return -1
        if (a.dps == null && b.dps != null) return 1
        cmp = (a.dps ?? 0) - (b.dps ?? 0)
        break
      case 'date':
      default:
        cmp = a.updatedAt - b.updatedAt
        break
    }

    return prefs.sortOrder === 'desc' ? -cmp : cmp
  })

  return rows
}

/*
  what a row prints where the order goes. the archive is numbered by what is
  actually in it, so the live take never takes a number off a saved one: it
  prints the rank it would take once it is kept, and every take below it keeps
  the rank it already has.
*/
export function rankSavedEntries(rows: SavedEntry[]): ReadonlyMap<string, number> {
  const ranks = new Map<string, number>()
  let kept = 0
  rows.forEach((row, index) => {
    if (row.live) {
      ranks.set(row.id, index + 1)
      return
    }

    kept += 1
    ranks.set(row.id, kept)
  })

  return ranks
}

/*
  one axis, from zero to the highest ceiling in the filter. it is the same in
  both views, which is what lets the gridlines behind the rows be one backdrop
  rather than a set that rebuilds itself section by section. starting at zero
  also means the scale needs no declaring: the gridlines say it.
*/
export function makeSavedScale(lo: number, hi: number): SavedAxis {
  const floor = Math.min(0, lo)
  const span = hi - floor > 0 ? hi - floor : 1
  return {
    lo: floor,
    hi,
    /* deliberately unclamped: a zoomed window has to be able to say that a
       take fell off one of its ends */
    at: (value) => (value - floor) / span,
  }
}

export function makeSavedAxis(rows: SavedEntry[]): SavedAxis {
  const ceilings = rows.map((row) => row.crit).filter((value) => value > 0)
  const hi = (ceilings.length > 0 ? Math.max(...ceilings) : 1) * 1.02

  return makeSavedScale(0, hi)
}

/*
  the window the field is read through while an entry is selected. zero stays
  fixed so the selected entry's complete run remains visible; its highest
  rendered value opens the ceiling, and a take just above it is pulled in when
  it is close enough to compare.

  The reach is what keeps the zoom a zoom. An archive usually holds one take
  worth several of the others, and reaching for that one whatever the distance
  hands the window straight back to the full range.
*/
const WIN_PAD = 0.06
const WIN_REACH = 1

export function savedAxisWindow(
  rows: SavedEntry[],
  selected: SavedEntry | null,
  full: SavedAxis,
): SavedAxis {
  if (!selected || selected.avg <= 0) {
    return full
  }

  let hi = Math.max(selected.normal, selected.avg, selected.crit)
  /* an entry with no normal-to-crit spread still gets something to reach with */
  const floor = selected.normal > 0 ? selected.normal : selected.avg
  const reach = Math.max(hi - floor, selected.avg * 0.1) * WIN_REACH

  const others = rows.filter((row) => row.id !== selected.id).map((row) => row.avg)
  const above = others.filter((value) => value > hi).sort((a, b) => a - b)[0]
  if (above !== undefined && above - hi <= reach) {
    hi = above
  }

  const padded = hi + hi * WIN_PAD
  hi = Math.max(hi, Math.min(full.hi, padded))

  return makeSavedScale(0, hi)
}

export function resolveSavedAxis(
  rows: SavedEntry[],
  selected: SavedEntry | null,
  full: SavedAxis,
  scaleToSelected: boolean,
): SavedAxis {
  return scaleToSelected ? savedAxisWindow(rows, selected, full) : full
}

// round gridline values, five or so across the field
export function makeSavedTicks(axis: SavedAxis): number[] {
  const span = axis.hi - axis.lo
  if (!Number.isFinite(span) || span <= 0) {
    return []
  }

  const raw = span / 7
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10]
    .map((factor) => factor * magnitude)
    .find((candidate) => candidate >= raw) ?? magnitude

  const out: number[] = []
  for (let tick = Math.ceil(axis.lo / step) * step; tick <= axis.hi; tick += step) {
    out.push(Math.round(tick))
  }

  return out
}

/*
  grouped by the active resonator, not by team: everything written for one lead
  together, sections ordered by their own best so the strongest work is first.
*/
export function groupSavedEntries(rows: SavedEntry[]): SavedGroup[] {
  const byLead = new Map<ResonatorId, SavedEntry[]>()
  for (const row of rows) {
    const bucket = byLead.get(row.lead.id)
    if (bucket) {
      bucket.push(row)
    } else {
      byLead.set(row.lead.id, [row])
    }
  }

  const groups: SavedGroup[] = []
  for (const [, takes] of byLead) {
    /* a bank is placed by the work kept in it. the live take stands in its
       lead's bank, but an unsaved figure cannot be what the bank is worth */
    const kept = takes.filter((take) => !take.live)
    const ranked = kept.length > 0 ? kept : takes
    groups.push({
      lead: takes[0]!.lead,
      takes,
      best: Math.max(...ranked.map((take) => take.avg)),
    })
  }

  groups.sort((a, b) => b.best - a.best)
  return groups
}

/* Every member who appears anywhere in the archive, accumulated from the
   same average-damage segments the field draws. */
export function makeSavedRoster(rows: SavedEntry[]): SavedRosterMember[] {
  const roster = new Map<ResonatorId, SavedRosterMember>()

  for (const row of rows) {
    for (const member of row.members) {
      const damage = member.figure ?? Math.max(0, member.to - member.from)
      const current = roster.get(member.id)
      if (current) {
        current.damage += damage
        current.entries += 1
      } else {
        roster.set(member.id, {
          id: member.id,
          name: member.name,
          accent: member.accent,
          profile: member.profile,
          damage,
          entries: 1,
        })
      }
    }
  }

  return [...roster.values()].sort((left, right) => (
    right.damage - left.damage || left.name.localeCompare(right.name)
  ))
}

/* One selected member's damage in every saved entry that contains them. The
   row order is preserved so the ledger can be read directly against the field. */
export function makeMemberTakes(
  rows: SavedEntry[],
  memberId: ResonatorId | null,
): SavedMemberTake[] {
  if (!memberId) {
    return []
  }

  const takes: SavedMemberTake[] = []
  for (const row of rows) {
    const member = row.members.find((candidate) => candidate.id === memberId)
    if (!member) {
      continue
    }

    takes.push({
      id: row.id,
      label: row.entry.name,
      lead: row.lead,
      damage: member.figure ?? Math.max(0, member.to - member.from),
      share: member.share,
      total: row.avg,
      entry: row.entry,
    })
  }

  return takes
}

const SVD_LST_AT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function formatSavedTime(updatedAt: number): string {
  return SVD_LST_AT.format(updatedAt)
}

export function formatSavedFigure(value: number, decimals = 0): string {
  const places = Math.min(Math.max(Math.trunc(decimals), 0), 4)
  if (!Number.isFinite(value)) return '0'
  return value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })
}

export function formatSavedTick(value: number, decimals = 0): string {
  const places = Math.min(Math.max(Math.trunc(decimals), 0), 4)
  if (Math.abs(value) >= 1e6) {
    return `${formatTrunc(value / 1e6, places)}M`
  }

  return `${formatTrunc(value / 1e3, places)}K`
}

/*
  Author: Runor Ewhro
  description: converts the card parser's output into a leaderboard read, with
               stricter rules than the app's import: every guessed value (a
               snapped roll, a single uid read, an unidentified echo) becomes an
               issue, and a read with any issue produces no snapshot. a corrected
               digit (exactly one legal value fits) is accepted and listed for
               review, and an accepted read's other doubts (a missing name, an
               unread level, a guessed match) are flagged for staff.
*/

import type { BuildSnapshot, SnapshotEcho } from '@/domain/leaderboard/snapshot'
import type {
  CardReadConfidence,
  CardReadFlag,
  CardReadIssue,
  CardReadOutcome,
  CardReadResult,
  CardReadReview,
  EchoReadConfidence,
} from '@/domain/leaderboard/read'
import { getResSeedBy } from '@/data/catalog/resonatorSeedService'
import { mkEchoNstnFr } from '@/engine/echoParser/echoBuilder'
import type { ParsedBuildScreenshot, RawPrsdEcho } from '@/engine/echoParser/ocrParsing'
import { readSbstDtl } from '@/engine/echoParser/statReading'
import { CARD_PARSER_VER } from '@/engine/echoParser/version'

export const CARD_ECHO_SLOTS = 5

function isEmptyPanel(echo: RawPrsdEcho): boolean {
  return echo.echoName === null && echo.mainStatLbl === '' && echo.substats.length === 0
}

// the parser leaves the id null when only gender variants of one resonator
// match (Rover: Aero 1406/1408). those score identically, so the first
// variant is selected; any other ambiguity stays unresolved
function settleResonator(parsed: ParsedBuildScreenshot): string | null {
  if (parsed.resonator.id) return parsed.resonator.id
  const candidates = parsed.resonator.candidateIds
  if (candidates.length < 2) return null
  const names = new Set(candidates.map((id) => getResSeedBy(id)?.name ?? `#${id}`))
  return names.size === 1 ? [...candidates].sort()[0] : null
}

function readEchoConfidence(raw: RawPrsdEcho, slot: number, resolved: boolean): EchoReadConfidence {
  const values = raw.substatValues ?? []
  const readings = readSbstDtl(raw.substats, values)
  // a printed row is lost when it fails to read or collapses into a duplicate key
  const printedRows = raw.substats.filter((row, index) => row.trim() !== '' || (values[index] ?? '').trim() !== '').length
  return {
    slot,
    resolved,
    substats: Object.fromEntries(readings.map((reading) => [reading.key, reading.fix])),
    unreadRows: Math.max(0, printedRows - readings.length),
  }
}

function outcomeFor(issues: CardReadIssue[]): CardReadOutcome {
  if (issues.length === 0) return 'ok'
  if (issues.includes('not_bot_card')) return 'unreadable'
  if (issues.includes('uid_unverified')) return 'uid_unreadable'
  return 'unreadable'
}

// punctuation a name decoration ("~", a star, a note) can come back as
const NAME_EDGE = /^[-_.'/:]|[-_.'/:]$/

// doubts about an accepted read: fields it kept without reading them, and matches it had to guess
function readFlags(parsed: ParsedBuildScreenshot): CardReadFlag[] {
  const flags: CardReadFlag[] = []
  const { player, resonator, weapon } = parsed
  if (player.id === null) {
    flags.push(player.nameInk === 'none' ? 'name_blank' : player.nameInk === 'obscured' ? 'name_obscured' : 'name_unread')
  } else {
    if (NAME_EDGE.test(player.id)) flags.push('name_edge')
    if (player.nameUnconfirmed) flags.push('name_unconfirmed')
  }
  if (resonator.byArt) flags.push('resonator_by_art')
  if (weapon.id === null) flags.push('weapon_unread')
  if (weapon.iconOverrode) flags.push('weapon_disagrees')
  if (resonator.level === null) flags.push('level_unread')
  if (weapon.level === null) flags.push('weapon_level_unread')
  if (Object.values(resonator.skillLevels).some((level) => level === null)) flags.push('skill_unread')
  return flags
}

// a read that never reached the parser's result, e.g. a wrong image size
export function failedCardRead(error: string, ms: number): CardReadResult {
  return {
    parserVer: CARD_PARSER_VER,
    outcome: 'unreadable',
    uid: null,
    resonatorId: null,
    snapshot: null,
    confidence: {
      frameScore: Number.POSITIVE_INFINITY,
      botFrame: false,
      uidAgreed: false,
      resonatorCandidates: [],
      echoes: [],
      issues: ['not_bot_card'],
    },
    ms,
    error,
  }
}

// build the leaderboard read for one parsed card. `gameVer` is the game
// data version the parser resolved names against
export function makeCardRead(parsed: ParsedBuildScreenshot, gameVer: string, ms: number): CardReadResult {
  const issues = new Set<CardReadIssue>()
  if (!parsed.source.botFrame) issues.add('not_bot_card')

  // a leaderboard UID requires two agreeing reads; a single valid OCR read is not enough
  const uidAgreed = parsed.player.uidAgreed === true && parsed.player.uid !== null
  if (!uidAgreed) issues.add('uid_unverified')

  const resonatorId = settleResonator(parsed)
  if (!resonatorId) issues.add('resonator_unresolved')
  // boards score with their scenario's weapon, so a weapon the card left out (a blank panel) refuses nothing

  const built = mkEchoNstnFr(parsed.echoes)
  const echoes: SnapshotEcho[] = []
  const echoConfidence: EchoReadConfidence[] = []
  const review: CardReadReview[] = []

  parsed.echoes.slice(0, CARD_ECHO_SLOTS).forEach((raw, slot) => {
    if (isEmptyPanel(raw)) {
      echoConfidence.push({ slot, resolved: false, substats: {}, unreadRows: 0 })
      return
    }
    const echo = built[slot]
    const confidence = readEchoConfidence(raw, slot, echo !== null)
    echoConfidence.push(confidence)
    if (!echo) {
      issues.add('echo_unresolved')
      return
    }
    for (const [key, fix] of Object.entries(confidence.substats)) {
      if (fix === 'snapped') issues.add('substat_not_exact')
      else if (fix === 'corrected') review.push({ slot, key })
    }
    if (confidence.unreadRows > 0) issues.add('substat_unread')
    echoes.push({
      slot,
      id: echo.id,
      set: echo.set,
      mainEcho: echo.mainEcho,
      main: {
        primary: { ...echo.mainStats.primary },
        secondary: { ...echo.mainStats.secondary },
      },
      substats: { ...echo.substats },
    })
  })

  const issueList = [...issues]
  const outcome = outcomeFor(issueList)
  const flags = outcome === 'ok' ? readFlags(parsed) : []
  const confidence: CardReadConfidence = {
    frameScore: parsed.source.frameScore,
    botFrame: parsed.source.botFrame,
    uidAgreed,
    resonatorCandidates: parsed.resonator.id ? [] : [...parsed.resonator.candidateIds],
    echoes: echoConfidence,
    issues: issueList,
    ...(review.length ? { review } : {}),
    ...(flags.length ? { flags } : {}),
  }

  // keep recognized details in confidence output, and create a scoring snapshot only when every required read is
  // exact
  const buildAs = (uid: string): BuildSnapshot => ({
    v: 1,
    gameVer,
    uid,
    name: parsed.player.id,
    resonator: {
      id: resonatorId!,
      level: parsed.resonator.level,
      sequence: parsed.resonator.sequence,
      skillLevels: { ...parsed.resonator.skillLevels },
    },
    weapon: { id: parsed.weapon.id || null, level: parsed.weapon.level },
    echoes,
  })
  const snapshot = outcome === 'ok' ? buildAs(parsed.player.uid!) : null
  // the uid alone kept the card out: everything else is exact, so staff can place it once they read the uid
  const awaitingUid = issueList.length === 1 && issueList[0] === 'uid_unverified' ? buildAs(parsed.player.uid ?? '') : null

  return {
    parserVer: CARD_PARSER_VER,
    outcome,
    uid: uidAgreed ? parsed.player.uid : null,
    resonatorId,
    snapshot,
    ...(awaitingUid ? { awaitingUid } : {}),
    confidence,
    ms,
  }
}

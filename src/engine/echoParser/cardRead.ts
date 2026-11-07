/*
  Author: Runor Ewhro
  description: turns the card parser's output into a leaderboard read. stricter
               than the app's import: any value the parser had to guess (a
               corrected digit, a snapped roll, a single uid read, an
               unidentified echo) becomes an issue, and a read with any issue
               produces no snapshot.
*/

import type { BuildSnapshot, SnapshotEcho } from '@/domain/leaderboard/snapshot'
import type {
  CardReadConfidence,
  CardReadIssue,
  CardReadOutcome,
  CardReadResult,
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

/* the parser leaves the id null when only gender variants of one resonator
   match (Rover: Aero 1406/1408). those score identically, so the first
   variant is selected; any other ambiguity stays unresolved. */
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

/** a read that never reached the parser's result, e.g. a wrong image size. */
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

/** build the leaderboard read for one parsed card. `gameVer` is the game
    data version the parser resolved names against. */
export function makeCardRead(parsed: ParsedBuildScreenshot, gameVer: string, ms: number): CardReadResult {
  const issues = new Set<CardReadIssue>()
  if (!parsed.source.botFrame) issues.add('not_bot_card')

  // a leaderboard UID requires two agreeing reads; a single valid OCR result remains insufficient evidence.
  const uidAgreed = parsed.player.uidAgreed === true && parsed.player.uid !== null
  if (!uidAgreed) issues.add('uid_unverified')

  const resonatorId = settleResonator(parsed)
  if (!resonatorId) issues.add('resonator_unresolved')
  if (!parsed.weapon.id) issues.add('weapon_unresolved')

  const built = mkEchoNstnFr(parsed.echoes)
  const echoes: SnapshotEcho[] = []
  const echoConfidence: EchoReadConfidence[] = []
  if (parsed.echoes.length < CARD_ECHO_SLOTS) issues.add('echo_missing')

  parsed.echoes.slice(0, CARD_ECHO_SLOTS).forEach((raw, slot) => {
    if (isEmptyPanel(raw)) {
      issues.add('echo_missing')
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
    if (Object.values(confidence.substats).some((fix) => fix !== 'exact')) issues.add('substat_not_exact')
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
  const confidence: CardReadConfidence = {
    frameScore: parsed.source.frameScore,
    botFrame: parsed.source.botFrame,
    uidAgreed,
    resonatorCandidates: parsed.resonator.id ? [] : [...parsed.resonator.candidateIds],
    echoes: echoConfidence,
    issues: issueList,
  }

  // preserve recognized details in confidence output, but create a scoring snapshot only when every required read is exact.
  const snapshot: BuildSnapshot | null = outcome === 'ok' ? {
    v: 1,
    gameVer,
    uid: parsed.player.uid!,
    name: parsed.player.id,
    resonator: {
      id: resonatorId!,
      level: parsed.resonator.level,
      sequence: parsed.resonator.sequence,
      skillLevels: { ...parsed.resonator.skillLevels },
    },
    weapon: { id: parsed.weapon.id!, level: parsed.weapon.level },
    echoes,
  } : null

  return {
    parserVer: CARD_PARSER_VER,
    outcome,
    uid: uidAgreed ? parsed.player.uid : null,
    resonatorId,
    snapshot,
    confidence,
    ms,
  }
}

/*
  Author: Runor Ewhro
  description: the result of reading one card, as the reader page returns it
               and as a card_reads row stores it.
*/

import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'

/** matches card_reads.outcome. */
export type CardReadOutcome = 'ok' | 'uid_unreadable' | 'unreadable' | 'unsupported'

/** why a read was not accepted; several can apply to one card. */
export type CardReadIssue =
  | 'not_bot_card'          // the fixed card frame does not match the bot's
  | 'uid_unverified'        // the two uid reads were not both complete and equal
  | 'resonator_unresolved'  // no single resonator matched
  | 'weapon_unresolved'
  | 'echo_unresolved'       // an echo, its set or its main stat could not be identified
  | 'echo_missing'          // legacy readers rejected empty slots; current reads accept them
  | 'substat_not_exact'     // a value had to be snapped to the nearest roll
  | 'substat_unread'        // a printed substat row produced no reading

export interface EchoReadConfidence {
  slot: number
  resolved: boolean
  /** per substat key: exact, corrected or snapped. */
  substats: Record<string, 'exact' | 'corrected' | 'snapped'>
  /** printed rows that produced no reading. */
  unreadRows: number
}

export interface CardReadConfidence {
  frameScore: number
  botFrame: boolean
  uidAgreed: boolean
  /** set when the resonator was only known up to a gender variant. */
  resonatorCandidates: string[]
  echoes: EchoReadConfidence[]
  issues: CardReadIssue[]
  /** values read one character off where exactly one legal value fits; the read is accepted and each value is listed
        for optional moderator review. */
  review?: CardReadReview[]
}

export interface CardReadReview {
  slot: number
  /** the substat key, e.g. 'defPercent'. */
  key: string
}

export interface CardReadResult {
  parserVer: string
  outcome: CardReadOutcome
  uid: string | null
  resonatorId: string | null
  /** present only when outcome is 'ok'. */
  snapshot: BuildSnapshot | null
  confidence: CardReadConfidence
  /** milliseconds the parse took in the page. */
  ms: number
  /** milliseconds of the whole read as the service saw it (browser start to close); set by the service, not the page. */
  wallMs?: number
  /** set when the parser threw (e.g. 'invalid_image_size'). */
  error?: string
}

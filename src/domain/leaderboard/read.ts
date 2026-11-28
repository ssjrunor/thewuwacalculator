/*
  Author: Runor Ewhro
  description: the result of reading one card, as the reader page returns it
               and as a card_reads row stores it.
*/

import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'

// matches card_reads.outcome
export type CardReadOutcome = 'ok' | 'uid_unreadable' | 'unreadable' | 'unsupported'

// why a read was not accepted; several can apply to one card
export type CardReadIssue =
  | 'not_bot_card'          // the fixed card frame does not match the bot's
  | 'uid_unverified'        // the two uid reads were not both complete and equal
  | 'resonator_unresolved'  // no single resonator matched
  | 'weapon_unresolved'
  | 'echo_unresolved'       // an echo, its set or its main stat could not be identified
  | 'echo_missing'          // an empty echo slot; found on stored reads, and the reader accepts empty slots
  | 'substat_not_exact'     // a value had to be snapped to the nearest roll
  | 'substat_unread'        // a printed substat row produced no reading

// a doubt about an accepted read; none refuses the card, and staff are sent each one with the build
export type CardReadFlag =
  | 'name_blank'           // the card prints no player name
  | 'name_obscured'        // portrait art sits behind the name, so the name is not read
  | 'name_unread'          // the name was printed but no text came back
  | 'name_edge'            // the name starts or ends with punctuation, which a decoration may have been read as
  | 'name_unconfirmed'     // the name is one model's guess (a script only one model reads), which no second read confirmed
  | 'resonator_by_art'     // the name line matched no resonator, so the portrait selected it
  | 'weapon_disagrees'     // the weapon's name and icon matched different weapons, and the icon selected it
  | 'weapon_unread'        // no weapon was read (the card can draw a blank panel); scenarios score with their own
  | 'level_unread'         // the resonator level was not read
  | 'weapon_level_unread'
  | 'skill_unread'         // at least one skill level was not read

export interface EchoReadConfidence {
  slot: number
  resolved: boolean
  // per substat key: exact, corrected or snapped
  substats: Record<string, 'exact' | 'corrected' | 'snapped'>
  // printed rows that produced no reading
  unreadRows: number
}

export interface CardReadConfidence {
  frameScore: number
  botFrame: boolean
  uidAgreed: boolean
  // set when the resonator was only known up to a gender variant
  resonatorCandidates: string[]
  echoes: EchoReadConfidence[]
  issues: CardReadIssue[]
  // values read one character off where exactly one legal value fits; the read is accepted and each value is listed
  // for optional moderator review
  review?: CardReadReview[]
  // doubts about an accepted read's other fields; absent when there are none
  flags?: CardReadFlag[]
}

export interface CardReadReview {
  slot: number
  // the substat key, e.g. 'defPercent'
  key: string
}

export interface CardReadResult {
  parserVer: string
  outcome: CardReadOutcome
  uid: string | null
  resonatorId: string | null
  // present only when outcome is 'ok'
  snapshot: BuildSnapshot | null
  // a card refused for its uid alone: the build as read, its uid the reader's best read ('' for none). staff who
  // read the uid off the image place it under that uid
  awaitingUid?: BuildSnapshot
  confidence: CardReadConfidence
  // milliseconds the parse took in the page
  ms: number
  // milliseconds of the whole read as the service saw it (browser start to close); set by the service
  wallMs?: number
  // set when the parser threw (e.g. 'invalid_image_size')
  error?: string
}

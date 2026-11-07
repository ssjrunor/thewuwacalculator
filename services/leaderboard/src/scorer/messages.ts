/*
  Author: Runor Ewhro
  description: lb-score message shapes. a fan-out names a build and a ruleset
               and expands into one scenario message per scenario of the
               build's resonator. delivery is at least once, so every handler
               is an upsert.
*/

export type ScoreMessage =
  | { kind: 'fanout'; buildId: string; rulesetId: string }
  | { kind: 'scenario'; buildId: string; rulesetId: string; scenarioId: string }

export function isScoreMessage(value: unknown): value is ScoreMessage {
  const message = value as ScoreMessage
  return !!message && typeof message.buildId === 'string' && typeof message.rulesetId === 'string' &&
    (message.kind === 'fanout' || (message.kind === 'scenario' && typeof message.scenarioId === 'string'))
}

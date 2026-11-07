/*
  Author: Runor Ewhro
  description: loads and caches verified ruleset scoring sessions per Worker isolate.
*/

import { openRuleset, openScoringSession, type RulesetFiles, type ScoringSession } from '@/engine/leaderboard'
import { getRuleset, rulesetKey } from '../db/rulesets.ts'
import type { ScorerEnv } from '../env.ts'

export function bucketFiles(bucket: R2Bucket, rulesetId: string): RulesetFiles {
  return {
    async read(path) {
      const object = await bucket.get(rulesetKey(rulesetId, path))
      return object ? new Uint8Array(await object.arrayBuffer()) : null
    },
  }
}

// share in-flight verification and initialization between messages for the same ruleset.
const sessions = new Map<string, Promise<ScoringSession>>()

export function loadScoringSession(env: ScorerEnv, rulesetId: string): Promise<ScoringSession> {
  let session = sessions.get(rulesetId)
  if (!session) {
    session = (async () => {
      const row = await getRuleset(env.LB, rulesetId)
      if (!row) throw new Error(`ruleset ${rulesetId} is not published`)
      // the published database hash authenticates the manifest before individual file hashes are checked.
      const ruleset = await openRuleset(bucketFiles(env.LB_DATA, rulesetId), { expectedManifestSha256: row.manifest_sha256 })
      return openScoringSession(ruleset)
    })()
    // a failed load is retried by the next message, not remembered.
    session.catch(() => sessions.delete(rulesetId))
    sessions.set(rulesetId, session)
  }
  return session
}

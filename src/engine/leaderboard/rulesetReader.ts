/*
  Author: Runor Ewhro
  description: loads verified ruleset files and exposes versioned calculation inputs.
*/

import type { RulesetManifest, RulesetRefsFile, ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'
import type { ActionPlan } from '@/domain/rotationActions/types'
import { assertActionPlan } from '@/domain/rotationActions/actionPlan'
import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import { indexTeammateBuilds, type ResolvedTeammate, type TeammateBuildsFile } from './teammateBuilds'
import { LEADERBOARD_ENGINE_VER, ROTATION_GEN_VER } from './version'

/** reads one file of a ruleset by its path relative to the ruleset root; null when absent. */
export interface RulesetFiles {
  read(path: string): Promise<Uint8Array<ArrayBuffer> | null>
}

export class RulesetError extends Error {
  readonly code: 'missing' | 'hash_mismatch' | 'manifest' | 'version'

  constructor(code: RulesetError['code'], message: string) {
    super(message)
    this.name = 'RulesetError'
    this.code = code
  }
}

export interface OpenedRuleset {
  manifest: RulesetManifest
  manifestSha256: string
  defs: ScenarioDef[]
  defById: Map<string, ScenarioDef>
  plans: Record<string, ActionPlan>
  teammates: Map<string, ResolvedTeammate>
  /** null until the reference step has run. */
  refs: Map<string, ScenarioRefs> | null
  /** game data json by logical path (`weapons/catalog`). */
  gameData(path: string): Promise<unknown>
  /** rotation generator data json by logical path (`characters/index`). */
  interpretationData(path: string): Promise<unknown>
  /** answers the app's game data requests (`/data/<mode>/<file>`) from the snapshot. */
  gameDataReader(url: string): Promise<Response>
  /** identifies the game data snapshot: rulesets with equal fingerprints load identical data. */
  gameDataFingerprint: string
}

export const refsKey = (scenarioId: string, sequence: number): string => `${scenarioId}#${sequence}`

/** the versions this code can score, against those the ruleset was built for. */
export function rulesetVersionIssues(manifest: Pick<RulesetManifest, 'engineVer' | 'rotationVer'>): string[] {
  const issues: string[] = []
  if (manifest.engineVer !== LEADERBOARD_ENGINE_VER) issues.push(`engine ${manifest.engineVer}, scorer ${LEADERBOARD_ENGINE_VER}`)
  if (manifest.rotationVer !== ROTATION_GEN_VER) issues.push(`rotation ${manifest.rotationVer}, scorer ${ROTATION_GEN_VER}`)
  return issues
}

const decoder = new TextDecoder()

// verify the published manifest and expose hash-checked JSON readers with retryable promise caches.
export async function openRuleset(files: RulesetFiles, options: {
  /** the manifest hash recorded when the ruleset was published. */
  expectedManifestSha256?: string
  /** refuse a ruleset built for another engine or generator version (default true). */
  checkVersions?: boolean
} = {}): Promise<OpenedRuleset> {
  const manifestBytes = await files.read('manifest.json')
  if (!manifestBytes) throw new RulesetError('missing', 'ruleset has no manifest.json')
  const manifestSha256 = await sha256Hex(manifestBytes)
  if (options.expectedManifestSha256 && manifestSha256 !== options.expectedManifestSha256) {
    throw new RulesetError('hash_mismatch', `manifest.json hashes ${manifestSha256}, expected ${options.expectedManifestSha256}`)
  }
  const manifest = JSON.parse(decoder.decode(manifestBytes)) as RulesetManifest
  if (manifest.schema !== 1 || !Array.isArray(manifest.scenarios) || !manifest.hashes) {
    throw new RulesetError('manifest', 'unsupported ruleset manifest')
  }
  if (options.checkVersions ?? true) {
    const issues = rulesetVersionIssues(manifest)
    if (issues.length) throw new RulesetError('version', `ruleset ${manifest.id} was built for another scorer: ${issues.join('; ')}`)
  }

  const cache = new Map<string, Promise<unknown>>()
  // the manifest must list every requested file, and both its byte count and SHA-256 must match before decoding.
  const readVerified = async (path: string): Promise<Uint8Array<ArrayBuffer>> => {
    const expected = manifest.hashes[path]
    if (!expected) throw new RulesetError('missing', `${path} is not part of ruleset ${manifest.id}`)
    const bytes = await files.read(path)
    if (!bytes) throw new RulesetError('missing', `${path} is missing from ruleset ${manifest.id}`)
    if (bytes.byteLength !== expected.bytes || await sha256Hex(bytes) !== expected.sha256) {
      throw new RulesetError('hash_mismatch', `${path} does not match ruleset ${manifest.id}`)
    }
    return bytes
  }
  // cache the in-flight decode promise by snapshot path; failed reads are removed for a later retry.
  const json = (path: string): Promise<unknown> => {
    let entry = cache.get(path)
    if (!entry) {
      entry = readVerified(path).then((bytes) => JSON.parse(decoder.decode(bytes)))
      // a failed read is not remembered, so a retry reads again.
      entry.catch(() => cache.delete(path))
      cache.set(path, entry)
    }
    return entry
  }

  const [actions, teammatesFile, refsFile] = await Promise.all([
    json(manifest.files.recipes) as Promise<{ schema: 1; plans: Record<string, unknown> }>,
    json(manifest.files.teammates) as Promise<TeammateBuildsFile>,
    manifest.files.refs ? json(manifest.files.refs) as Promise<RulesetRefsFile> : Promise.resolve(null),
  ])
  const plans = Object.fromEntries(Object.entries(actions.plans).map(([teamId, plan]) => [teamId, assertActionPlan(plan)]))
  const refs = refsFile ? new Map(refsFile.refs.map((entry) => [refsKey(entry.scenarioId, entry.sequence), entry])) : null

  const dataRoot = manifest.files.gameData.replace(/\/?$/, '/')
  const interpreterRoot = manifest.files.interpreter.replace(/\/?$/, '/')
  const urlPrefix = `/data/${manifest.dataMode}/`
  // fingerprint only game-data files and the mode; rulesets with identical calculation inputs may share one process.
  const gameDataHashes = Object.fromEntries(Object.entries(manifest.hashes).filter(([path]) => path.startsWith(dataRoot)))

  return {
    manifest,
    manifestSha256,
    defs: manifest.scenarios,
    defById: new Map(manifest.scenarios.map((def) => [def.id, def])),
    plans,
    teammates: indexTeammateBuilds(teammatesFile),
    refs,
    gameData: (path) => json(`${dataRoot}${path}.json`),
    interpretationData: (path) => json(`${interpreterRoot}${path}.json`),
    async gameDataReader(url) {
      const path = url.split(/[?#]/)[0]
      if (!path.startsWith(urlPrefix)) return new Response(`not ${manifest.dataMode} game data: ${url}`, { status: 404 })
      const file = `${dataRoot}${decodeURIComponent(path.slice(urlPrefix.length))}`
      if (!manifest.hashes[file]) return new Response(`not in ruleset ${manifest.id}: ${file}`, { status: 404 })
      return new Response(await readVerified(file), { headers: { 'content-type': 'application/json' } })
    },
    gameDataFingerprint: await sha256Hex(canonicalJson({ mode: manifest.dataMode, files: gameDataHashes })),
  }
}

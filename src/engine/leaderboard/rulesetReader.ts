/*
  Author: Runor Ewhro
  description: loads verified ruleset files and exposes versioned calculation inputs.
*/

import type { RulesetManifest, RulesetRefsFile, ScenarioAnchorsFile, ScenarioDef, ScenarioRefs } from '@/domain/leaderboard/ruleset'
import type { ActionPlan } from '@/domain/rotationActions/types'
import { assertActionPlan } from '@/domain/rotationActions/actionPlan'
import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import { indexTeammateBuilds, type ResolvedTeammate, type TeammateBuildsFile } from './teammateBuilds'
import { LEADERBOARD_ENGINE_VER, ROTATION_GEN_VER } from './version'
import { hasScoringData } from './coverage'

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
  /** a scenario's offline anchors, or null when the ruleset has none for it. */
  anchorsFor(scenarioId: string): Promise<ScenarioAnchorsFile | null>
  /** the package's unit hashes, or null without units. */
  units(): Promise<ReadonlyMap<string, string> | null>
  /** the rotation generator's code hash the package was made with (units.json), or null. */
  generatorSha(): Promise<string | null>
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

// a json value's end from its first character: strings (with escapes), objects and arrays (by depth), or a bare
// literal; this finds boundaries only, and JSON.parse validates each piece
function valueEnd(text: string, at: number): number {
  const first = text[at]
  if (first === '"') {
    let index = at + 1
    while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1
    if (index >= text.length) throw new SyntaxError('unterminated string')
    return index + 1
  }
  if (first === '{' || first === '[') {
    let depth = 0
    for (let index = at; index < text.length; index += 1) {
      const char = text[index]
      if (char === '"') index = valueEnd(text, index) - 1
      else if (char === '{' || char === '[') depth += 1
      else if (char === '}' || char === ']') {
        depth -= 1
        if (depth === 0) return index + 1
      }
    }
    throw new SyntaxError('unterminated object')
  }
  let index = at
  while (index < text.length && !',}] \t\n\r'.includes(text[index]!)) index += 1
  if (index === at) throw new SyntaxError(`unexpected ${first ?? 'end'}`)
  return index
}

const skipSpace = (text: string, at: number) => {
  while (at < text.length && ' \t\n\r'.includes(text[at]!)) at += 1
  return at
}

/** an object's members as [key, start, end] of each value's text. */
function members(text: string, at: number): Array<[string, number, number]> {
  if (text[at] !== '{') throw new SyntaxError('expected an object')
  const out: Array<[string, number, number]> = []
  let index = skipSpace(text, at + 1)
  if (text[index] === '}') return out
  for (;;) {
    const keyEnd = valueEnd(text, index)
    const key = JSON.parse(text.slice(index, keyEnd)) as unknown
    if (typeof key !== 'string') throw new SyntaxError('expected a key')
    index = skipSpace(text, keyEnd)
    if (text[index] !== ':') throw new SyntaxError('expected :')
    const start = skipSpace(text, index + 1)
    const end = valueEnd(text, start)
    out.push([key, start, end])
    index = skipSpace(text, end)
    if (text[index] === ',') { index = skipSpace(text, index + 1); continue }
    if (text[index] === '}') return out
    throw new SyntaxError('expected , or }')
  }
}

/**
 * an actions file's plans, each as its own json text, found without parsing the whole file (most of a ruleset's
 * bytes); files the scan cannot follow are parsed whole, which throws on invalid json.
 */
export function planTexts(text: string): Map<string, string> {
  try {
    const start = skipSpace(text, 0)
    if (skipSpace(text, valueEnd(text, start)) !== text.length) throw new SyntaxError('trailing text')
    // a repeated key is the last one, as JSON.parse reads it.
    const plans = members(text, start).filter(([key]) => key === 'plans').at(-1)
    if (!plans) throw new SyntaxError('no plans')
    return new Map(members(text, plans[1]).map(([key, from, to]) => [key, text.slice(from, to)]))
  } catch {
    const parsed = JSON.parse(text) as { plans?: Record<string, unknown> }
    return new Map(Object.entries(parsed.plans ?? {}).map(([key, plan]) => [key, JSON.stringify(plan)]))
  }
}

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

  const [actionsText, teammatesFile, refsFile] = await Promise.all([
    readVerified(manifest.files.recipes).then((bytes) => decoder.decode(bytes)),
    json(manifest.files.teammates) as Promise<TeammateBuildsFile>,
    manifest.files.refs ? json(manifest.files.refs) as Promise<RulesetRefsFile> : Promise.resolve(null),
  ])
  if (refsFile && refsFile.schema !== 2) throw new RulesetError('manifest', 'references must use total damage (schema 2)')
  // parsed plans for every team would be most of a session's memory and a scenario reads one, so each plan is
  // validated here, stored as its own json text, and parsed into a fresh copy per scenario request
  const plans: Record<string, ActionPlan> = {}
  for (const [teamId, text] of planTexts(actionsText)) {
    assertActionPlan(JSON.parse(text))
    Object.defineProperty(plans, teamId, { enumerable: true, configurable: true, get: () => assertActionPlan(JSON.parse(text)) })
  }
  const refs = refsFile ? new Map(refsFile.refs.map((entry) => [refsKey(entry.scenarioId, entry.sequence), entry])) : null

  const unitsFile = () => manifest.files.units
    ? json(manifest.files.units) as Promise<{ generator?: string; units: Record<string, string> }>
    : Promise.resolve(null)

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
    async anchorsFor(scenarioId) {
      const path = anchorsPath(manifest, scenarioId)
      return path && manifest.hashes[path] ? json(path) as Promise<ScenarioAnchorsFile> : null
    },
    async units() {
      const file = await unitsFile()
      return file ? new Map(Object.entries(file.units)) : null
    },
    async generatorSha() {
      return (await unitsFile())?.generator ?? null
    },
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

/** where a scenario's offline anchors are in a package (anchors/<resonator>/<team>-<weapon>.json); null without an
    anchors folder. */
export function anchorsPath(manifest: Pick<RulesetManifest, 'files'>, scenarioId: string): string | null {
  const folder = manifest.files.anchors
  if (!folder) return null
  const [resonatorId, teamId, weaponId] = scenarioId.slice(scenarioId.indexOf(':') + 1).split(':')
  return `${folder.replace(/\/?$/, '/')}${resonatorId}/${teamId}-${weaponId}.json`
}

/** verified scenarios (hasScoringData) of a package without an offline anchors file; every build on them searches
    its own anchors, about a minute per cell. */
export function scenariosWithoutAnchors(manifest: Pick<RulesetManifest, 'files' | 'hashes' | 'scenarios'>): string[] {
  return manifest.scenarios.filter((def) => hasScoringData(def)).map((def) => def.id)
    .filter((id) => { const path = anchorsPath(manifest, id); return !path || !manifest.hashes[path] })
}

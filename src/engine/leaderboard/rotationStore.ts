/*
  Author: Runor Ewhro
  description: stored rotations. generating a team's program is most of a
               score's time, and it is a pure function of the action plan, the
               combat scenario, the game data the interpreter loads and the
               generator's code. within the scenario, a build changes only the
               scored seat's form, sequence and echoes, and the generator reads
               only the echo fields named in domain/leaderboard/programKey.ts. a
               stored program is keyed by the scenario with the scored seat's
               echoes reduced to that key, and every build matching it, in any
               ruleset where the program's data is unchanged, reuses the stored
               program (rotationGen rebaseInterpretation). scenarios that copy
               build stats into the program (ScenarioDef.share false) key on the
               full echoes, which limits reuse to the same build.

               game data in the key: each member's resonator forms and weapon,
               and every echo, set and shared unit (the interpreter receives the
               whole echo catalog and gear library). the generator code hash comes
               from the caller and matches the running generator: the local
               scorer hashes its bundled generator, and a deployed worker has its
               hash injected at deploy. callers without one fall back to the
               package's (units.json), written by the packaging checkout and stale
               after later generator changes; with neither, nothing is stored.
               programs read from the store are also cached in the isolate
               (PROGRAM_CACHE_CHARS), so a build group or the next message reads
               each once.
*/

import type { ActionPlan } from '@/engine/rotationGen'
import type { InterpretedProgram } from '@/engine/rotationGen'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import { programEchoKey } from '@/domain/leaderboard/programKey'
import { resonatorForms } from '@/domain/rotationActions/identities'
import type { OpenedRuleset } from './rulesetReader'
import type { ScenarioScoringContext } from './scoreScenario'

export interface RotationStore {
  get(key: string): Promise<string | null>
  put(key: string, text: string): Promise<void>
}

/** a scoring context's program lookup and storage (read by scoreGroup.ts). */
export interface ProgramShelf {
  /** the store key of the program `scenario` gets; null when nothing can be stored (no generator hash). */
  keyOf(plan: ActionPlan, scenario: CombatScenario, share: boolean): Promise<string | null>
  get(key: string): Promise<InterpretedProgram | null>
  put(key: string, program: InterpretedProgram): Promise<void>
  /** hits: programs read from the store; misses: keys looked up and not found. */
  stats: { hits: number; misses: number }
}

/** the key format version, bumped with any change to the key's contents, which keeps old entries from matching. */
const KEY_VERSION = 3

/** stored program text kept in this isolate, by total characters (programs are tens of KB of JSON). */
const PROGRAM_CACHE_CHARS = 24_000_000

const catalogUnit = (unit: string) => unit.startsWith('echo:') || unit.startsWith('set:') || unit.startsWith('shared:') ||
  unit.startsWith('enemy:')

/** isolate-wide, by store key: keys name the generator code and data, so one cache serves every ruleset. */
const cached = new Map<string, string>()
let cachedChars = 0

function remember(key: string, text: string): void {
  if (text.length > PROGRAM_CACHE_CHARS) return
  const old = cached.get(key)
  if (old != null) { cached.delete(key); cachedChars -= old.length }
  cached.set(key, text)
  cachedChars += text.length
  for (const [oldest, value] of cached) {
    if (cachedChars <= PROGRAM_CACHE_CHARS) break
    cached.delete(oldest)
    cachedChars -= value.length
  }
}

function recall(key: string): string | null {
  const text = cached.get(key)
  if (text == null) return null
  cached.delete(key)
  cached.set(key, text)
  return text
}

/**
 * the scenario in key form: the scored seat's echoes reduced to the generator's reads, and no id (it names the ruleset
 * and the generator never reads it), which lets later rulesets find the program; unshared scenarios stay whole.
 */
function keyedScenario(scenario: CombatScenario, share: boolean) {
  if (!share) return scenario
  return { ...scenario, id: null, team: { members: scenario.team.members.map((member) => member.id !== scenario.contextMemberId ? member
    : { ...member, loadout: { ...member.loadout, echoes: programEchoKey(member.loadout.echoes.map((echo) => echo && {
      id: echo.id, set: echo.set, mainEcho: echo.mainEcho, stats: [echo.mainStats?.primary, echo.mainStats?.secondary], substats: echo.substats,
    })) } }) } }
}

/**
 * a scoring context whose programs go through a store; `generator` is the running generator's code hash
 * (fingerprint.mjs generatorBundleHash), with the package's hash used without it.
 */
export function withStoredRotations(context: ScenarioScoringContext, store: RotationStore, ruleset: OpenedRuleset,
  generator: string | null = null) {
  const programs = programShelf(store, ruleset, generator)
  return { context: { ...context, programs }, stats: programs.stats }
}

export function programShelf(store: RotationStore, ruleset: OpenedRuleset, running: string | null): ProgramShelf {
  const stats = { hits: 0, misses: 0 }
  const heads = new WeakMap<ActionPlan, Promise<string>>()
  // the part of every key a ruleset shares: the generator's code and the catalog units.
  let base: Promise<{ code: string; catalog: string; units: ReadonlyMap<string, string> } | null> | null = null
  const baseKey = () => base ??= (async () => {
    const [units, packaged] = await Promise.all([ruleset.units(), running ? null : ruleset.generatorSha()])
    const code = running ?? packaged
    if (!units || !code) return null
    const catalog = await sha256Hex(canonicalJson([...units].filter(([unit]) => catalogUnit(unit)).sort()))
    return { code, catalog, units }
  })()

  return {
    stats,
    async keyOf(plan, scenario, share) {
      const shared = await baseKey()
      if (!shared) return null
      const members = scenario.team.members.flatMap((member) => [
        ...resonatorForms(member.resonatorId).map((form) => `resonator:${form}`), `weapon:${member.loadout.weapon.id}`])
      const data = [...new Set(members)].sort().map((unit) => [unit, shared.units.get(unit) ?? null])
      // the plan is one object for every build of a scenario, and its text the largest part of a key: hashed once.
      let head = heads.get(plan)
      if (!head) heads.set(plan, head = sha256Hex(canonicalJson({ v: KEY_VERSION, code: shared.code, catalog: shared.catalog, plan })))
      const keyed = keyedScenario(scenario, share)
      return sha256Hex(canonicalJson({ head: await head, data, scenario: keyed }))
    },
    async get(key) {
      const text = recall(key) ?? await store.get(key)
      if (text == null) { stats.misses += 1; return null }
      remember(key, text)
      stats.hits += 1
      return JSON.parse(text) as InterpretedProgram
    },
    async put(key, program) {
      const text = JSON.stringify(program)
      remember(key, text)
      await store.put(key, text)
    },
  }
}

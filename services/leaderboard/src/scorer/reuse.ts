/*
  Author: Runor Ewhro
  description: decides per score which of a build's scores on the replaced
               ruleset a rollout keeps, without running the engine. the board
               sends a build's job as one reuse message with its old numbers
               (BoardDO.send), and the build's old detail object lists each
               score's reads (CellDetail.deps). against the new ruleset:

                 rescore   the units it reads now differ from the ones it read (a
                           catalog change picked another echo), one of them
                           hashes differently, the new ruleset's offline anchors
                           have no exact state for the build's measured energy
                           regen (or it was never measured), the energy regen
                           target of its repair (anchorErRequirement) changed,
                           or its repair fell short under an older repair rule
                           (ER_REPAIR_RULE)
                 rescale   only its anchors changed (offline state or refs): the
                           score is the stored damage over the new anchors
                           (scoreFormula.ts buildScore) with every other part
                           kept; a short repair stays 0
                 keep      no read changed and its anchors are the same; anchors
                           the executor searched itself read only compared
                           values, so they still apply

               a cell offered by program (OldCellBody.program: the new scorer is
               the old one with another generator) is kept or rescaled only when
               the build's program from the new generator hashes like the old
               score's; otherwise it is scored.

               scorer changes are checked by the board, which offers old scores
               only for the same scorer or one a sample check found scoring the
               same (BoardDO.syncCatalog). kept and rescaled cells go to the
               board as results, and the rest go out as bulk-lane cell messages
               under the same job.
*/

import {
  anchorErRequirement, anchorStateFor, buildScore, ER_REPAIR_RULE, overPerfect, scenarioProgramSha, scenarioReads, sha256Hex,
  SHARED_UNITS, type ErRepair, type ProgramMemo, type ScoreAnchors, type ScoringSession,
} from '@lb/scoring'
import type { ScenarioDef } from '@lb/contract/ruleset'
import type { BuildSnapshot } from '@lb/contract/snapshot'
import type { RulesetManifest, ScenarioAnchorsFile } from '@lb/contract/ruleset'
import { getRuleset } from '../db/rulesets.ts'
import { formatBuildId } from '../lib/ids.ts'
import { unpackSnapshot } from '../lib/snapshotPack.ts'
import type { ScorerEnv } from '../env.ts'
import type { CellResult } from '../board/types.ts'
import { bucketFiles, loadScoringSession } from './loadRuleset.ts'
import { SCORE_FLAGS, storedContext } from './job.ts'
import {
  detailKey, fromBase64, gunzipJson, type CellDetail, type DetailObject, type OldCellBody, type ReuseMessage,
} from './messages.ts'

type Deps = NonNullable<CellDetail['deps']>

export interface ReuseOutcome {
  /** kept and rescaled cells, for the board. */
  results: CellResult[]
  /** the job's cells to score (the board scores them in groups). */
  rescore: ReuseMessage['cells']
  kept: number
  rescaled: number
}

/** what one old score becomes on the new ruleset: kept as it is, rescaled to new anchors, or null to score again. */
export type CellDecision =
  | { kind: 'keep' }
  | { kind: 'rescale'; score: number; flags: number; anchors: ScoreAnchors; deps: Deps }
  | null

const sharedUnit = (unit: string) => unit.startsWith('shared:') || unit.startsWith('enemy:')

/** whether every unit a score reads hashes alike in both rulesets. */
export function readsHold(reads: readonly string[], before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): boolean {
  for (const unit of reads) {
    if (unit === SHARED_UNITS) {
      for (const [name, hash] of after) if (sharedUnit(name) && before.get(name) !== hash) return false
      for (const name of before.keys()) if (sharedUnit(name) && !after.has(name)) return false
    } else if ((before.get(unit) ?? null) !== (after.get(unit) ?? null)) return false
  }
  return true
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((unit, i) => unit === b[i])

const sameAnchors = (a: ScoreAnchors, b: CellDetail['anchors']) => !!b && a.baselineDamage === b.baselineDamage &&
  a.benchDamage === b.benchDamage && a.perfectDamage === b.perfectDamage

export interface DecideInput {
  /** the units the score would read on the new ruleset (scenarioReads). */
  reads: readonly string[]
  /** unit hashes of the old ruleset and the new one. */
  before: ReadonlyMap<string, string>
  after: ReadonlyMap<string, string>
  old: Pick<OldCellBody, 'status' | 'damage' | 'flags'>
  detail: Pick<CellDetail, 'deps' | 'anchors'>
  /** the new ruleset's offline anchors for the scenario, or null. */
  file: ScenarioAnchorsFile | null
  sequence: number
  /** the new ruleset's reference values for the scenario at this sequence. */
  refs: { status: string; baselineDamage: number; benchDamage: number; perfectDamage: number } | null
}

/** the rules in the header, for one score. */
export function decideCell({ reads, before, after, old, detail, file, sequence, refs }: DecideInput): CellDecision {
  const deps = detail.deps
  if (!deps) return null
  if (!sameList(reads, deps.reads) || !readsHold(reads, before, after)) return null
  const erRepair = (deps.erRepair ?? null) as ErRepair | null
  // the energy regen repair required now must match the scored one: none, or the same target
  const submittedEr = erRepair?.from ?? deps.energyRegen
  const requirement = file ? anchorErRequirement(file, sequence) : null
  const needsRepair = requirement != null && submittedEr != null && submittedEr < requirement.below
  if (old.status === 'ok' && (needsRepair !== Boolean(erRepair) || (erRepair && erRepair.target !== requirement?.target))) return null
  // a repair rule change moves short repairs only: a later rule may repair past the budget where an older was short.
  if (erRepair?.short && erRepair.rule !== ER_REPAIR_RULE) return null
  const hit = file && deps.energyRegen != null ? anchorStateFor(file, sequence, deps.energyRegen) : null
  let anchors: ScoreAnchors | null = null
  let anchorKey: string | null = null
  if (old.status !== 'ok' || !deps.anchorSource) {
    // unsupported, or no anchors at all: nothing about anchors to follow.
  } else if (hit?.state.exact) {
    anchors = { baselineDamage: hit.state.baseline, benchDamage: hit.state.bench, perfectDamage: hit.state.perfect }
    anchorKey = hit.key
  } else if (file || deps.anchorSource === 'offline') {
    // score the build when the offline anchors do not fit it or its energy regen was never measured
    return null
  } else if (deps.anchorSource === 'refs') {
    if (refs?.status !== 'ok') return null
    anchors = { baselineDamage: refs.baselineDamage, benchDamage: refs.benchDamage, perfectDamage: refs.perfectDamage }
  }
  if (!anchors || sameAnchors(anchors, detail.anchors)) return { kind: 'keep' }
  const score = erRepair?.short ? 0 : old.damage == null ? null : buildScore(old.damage, anchors)
  if (score == null) return null
  // recheck the rescaled score against perfect and preserve every other flag
  const flags = (old.flags & ~SCORE_FLAGS.overPerfect) | (overPerfect(score) ? SCORE_FLAGS.overPerfect : 0)
  return { kind: 'rescale', score, flags, anchors, deps: { ...deps, anchorKey, anchorSource: anchorKey ? 'offline' : deps.anchorSource } }
}

// a ruleset's units, read once per isolate: the manifest checked against the published hash, then units.json against
// the manifest; null for rulesets without units
const unitsCache = new Map<string, Promise<ReadonlyMap<string, string> | null>>()
function unitsOf(env: ScorerEnv, rulesetId: string, manifestSha256: string): Promise<ReadonlyMap<string, string> | null> {
  let units = unitsCache.get(rulesetId)
  if (!units) {
    units = (async () => {
      const files = bucketFiles(env.LB_DATA, rulesetId)
      const manifestBytes = await files.read('manifest.json')
      if (!manifestBytes || await sha256Hex(manifestBytes) !== manifestSha256) throw new Error(`ruleset ${rulesetId}: manifest does not match`)
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as RulesetManifest
      const path = manifest.files.units
      if (!path) return null
      const bytes = await files.read(path)
      if (!bytes || await sha256Hex(bytes) !== manifest.hashes[path]?.sha256) throw new Error(`ruleset ${rulesetId}: ${path} does not match`)
      return new Map(Object.entries((JSON.parse(new TextDecoder().decode(bytes)) as { units: Record<string, string> }).units))
    })()
    units.catch(() => unitsCache.delete(rulesetId))
    unitsCache.set(rulesetId, units)
  }
  return units
}

/** the reuse message's job: what is kept, what is rescaled, and what goes on to be scored. */
export async function reuseCells(env: ScorerEnv, message: ReuseMessage): Promise<ReuseOutcome> {
  const everything: ReuseOutcome = { results: [], rescore: message.cells, kept: 0, rescaled: 0 }
  const fromRow = await getRuleset(env.LB, message.fid)
  if (!fromRow) return everything
  const buildId = formatBuildId({ resonator: message.res, local: message.local })
  const [session, before, object] = await Promise.all([
    loadScoringSession(env, message.rid),
    unitsOf(env, message.fid, fromRow.manifest_sha256),
    env.LB_DATA.get(detailKey(message.did ?? message.fid, message.res, buildId)),
  ])
  const after = await session.ruleset.units()
  // no units to compare, or no record of what the old scores read: everything is scored.
  if (!before || !after || !object) return everything
  const detail = await gunzipJson<DetailObject>(await object.arrayBuffer())
  // the programs are made only for cells offered on them, and from the stored rotations, as scoring makes them.
  const memos = new Map<string, ProgramMemo>()
  const programOf: ProgramHash = (def, snapshot) => {
    let memo = memos.get(def.id)
    if (!memo) memos.set(def.id, memo = new Map())
    return scenarioProgramSha(snapshot, def, storedContext(env, session), memo)
  }
  return decideAll(message, session, detail, before, after, programOf)
}

/** the hash of the program a build would be scored with in a scenario (scenarioProgramSha), or null. */
export type ProgramHash = (def: ScenarioDef, snapshot: BuildSnapshot) => Promise<string | null>

/** each cell of the job against its old score and detail. */
export async function decideAll(message: ReuseMessage, session: ScoringSession, detail: DetailObject,
  before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>, programOf?: ProgramHash): Promise<ReuseOutcome> {
  const outcome: ReuseOutcome = { results: [], rescore: [], kept: 0, rescaled: 0 }
  const snapshot = unpackSnapshot(fromBase64(message.snap))
  const old = new Map(message.old.map((cell) => [cell.key, cell]))
  const context = session.context(async () => ({ status: 'unsupported', reason: 'reuse' }))
  const rescore: ReuseMessage['cells'] = []
  for (const cell of message.cells) {
    const oldCell = old.get(cell.key)
    const stored = detail.cells[cell.key]
    const def = session.ruleset.defById.get(`${message.rid}:${cell.key}`)
    if (!oldCell || !stored || !def) { rescore.push(cell); continue }
    // the scored seat's sequence, as the score ran it.
    const input = stored.input
    const sequence = input?.members.find((member) => member.slot === input.scoredSlot)?.sequence ?? snapshot.resonator.sequence
    const decision = decideCell({
      reads: scenarioReads(def, session.ruleset.teammates, context.deps, snapshot.echoes), before, after, old: oldCell, detail: stored,
      file: await session.ruleset.anchorsFor(def.id), sequence, refs: context.refsFor(def.id, sequence),
    })
    if (!decision) { rescore.push(cell); continue }
    // offered on its program: held only while the new generator makes the program the old score ran.
    if (oldCell.program && !(stored.program && programOf && await programOf(def, snapshot) === stored.program)) { rescore.push(cell); continue }
    const rescaled = decision.kind === 'rescale'
    const kept: CellDetail = rescaled ? { ...stored, anchors: decision.anchors, deps: decision.deps } : stored
    outcome.results.push({
      rs: message.rs, local: message.local, gen: message.gen, cell: cell.cell, status: oldCell.status,
      score: rescaled ? decision.score : oldCell.score, damage: oldCell.damage, dpr: oldCell.dpr,
      flags: rescaled ? decision.flags : oldCell.flags, reason: oldCell.reason, weapon: Number(cell.key.split(':')[2]),
      stats: oldCell.stats ? fromBase64(oldCell.stats) : null, detail: JSON.stringify(kept),
    })
    if (rescaled) outcome.rescaled += 1
    else outcome.kept += 1
  }
  outcome.rescore = rescore
  // every cell kept: the old object already has this job's detail, so no detail is sent or written
  if (!rescore.length && !outcome.rescaled && outcome.results.length === message.cells.length) {
    for (const result of outcome.results) {
      result.detail = null
      result.detailFrom = message.did ?? message.fid
    }
  }
  return outcome
}

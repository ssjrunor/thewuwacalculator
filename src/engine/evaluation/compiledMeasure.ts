/*
  Author: Runor Ewhro
  description: measures builds on a prepared program evaluation with the
               program compiled once (rotation/portable/compiler.ts), skipping
               the per-build replay (rotationScoring.ts). the compile reads which
               echoes may be worn, so it is built for a known set of (echo, set)
               pairs, and builds wearing others are replayed. it matches the
               replay to the last bits of a double for nearly every program, with
               a few weapon kits off by parts in ten thousand, so callers compare
               it against the replay before use (sameMeasure).
*/

import type { EchoInstance } from '@/domain/entities/runtime'
import { exportRotationCandidateCompilation } from '@/engine/rotation/candidateScorer'
import { fillPortableInputs } from '@/engine/rotation/portable/cpu'
import { executeScalarProgram } from '@/engine/rotation/portable/ir'
import { TEAM_INPUT } from '@/engine/rotation/portable/layout'
import { encEchoRows } from '@/engine/search/encode/echoes'
import { ECHO_STAT_STRIDE } from '@/engine/search/layout/echoLayout'
import { canonicalResonatorId } from '@/domain/rotationActions/identities'
import { ignoresEr } from './energyRegenPolicy'
import type { ProgramEvaluation, ProgramMeasure, ProgramMeasurement } from './report'

/** the display program's outputs: total damage, then the subject's sheet at rest (ATK, HP, DEF, CR, CD, ER, ...). */
const OUT_DAMAGE = 0
const OUT_ENERGY_REGEN = 6

/** maximum relative difference between compiled and replayed measurements for a match: rounding only. */
const DAMAGE_TOLERANCE = 1e-12
const ENERGY_REGEN_TOLERANCE = 1e-9

/** an echo as the compiler takes a candidate: its identity and set, no stats. */
const candidate = (id: string, set: number): EchoInstance => ({ uid: `compiled:${id}:${set}`, id, set, mainEcho: false,
  mainStats: { primary: { key: 'atkFlat', value: 0 }, secondary: { key: 'hpFlat', value: 0 } }, substats: {} })

/**
 * the program compiled for builds wearing only `worn` (echo id and set pairs); null when the context has no compiled
 * form (not a rotation context). builds wearing anything else, or nothing, are measured by `replay`.
 */
export function compileProgramMeasure(prepared: ProgramEvaluation, worn: Iterable<readonly [string, number]>,
  replay: ProgramMeasure): ProgramMeasure | null {
  const ctx = prepared.evaluationContext
  if (ctx.mode !== 'rotation' || !ctx.candidatePlan) return null
  const pairs = new Map<string, EchoInstance>()
  for (const [id, set] of worn) pairs.set(`${id}|${set}`, candidate(id, set))
  if (!pairs.size) return null
  const { program, symbols: symbolList } = exportRotationCandidateCompilation({ ...ctx.candidatePlan, candidates: [...pairs.values()], shown: true })
  const symbols = new Map(symbolList)
  const display = program.displayScalar
  const inputs = new Float64Array(TEAM_INPUT.count)
  const scratch = new Float64Array(display.registers)
  const output = new Float64Array(display.outputs.length)
  const noEr = ignoresEr(ctx.runtime.id)
  // the subject's damage as its run's breakdown states it: the leaderboard's DPR (leaderboard/execute.ts).
  const subject = program.participantIds.findIndex((id) => canonicalResonatorId(id) === canonicalResonatorId(ctx.runtime.id))

  return (equipped) => {
    const echoes = equipped.filter((echo): echo is EchoInstance => echo != null)
    if (!echoes.length || echoes.some((echo) => !pairs.has(`${echo.id}|${echo.set}`))) return replay(equipped)
    // the replay's encoding (evaluation/echoDiscovery.ts buildEvaluationFrame), the main echo's row first.
    const { stats, sets, kinds } = encEchoRows(echoes, ctx.selectedSkill, 'self')
    const combo = Int32Array.from(echoes, (_, row) => row)
    const main = Math.max(0, echoes.findIndex((echo) => echo.mainEcho))
    const rows = [main, ...combo.filter((row) => row !== main)]
    inputs.fill(0)
    fillPortableInputs({ stats: new Float32Array(echoes.length * ECHO_STAT_STRIDE), sets, kinds },
      { ...program, echoSymbols: Uint32Array.from(echoes, (echo) => symbols.get(echo.id)!) }, combo, main, inputs)
    inputs[TEAM_INPUT.selfMainEchoEffects] = 1
    rows.forEach((row, slot) => {
      for (let stat = 0; stat < ECHO_STAT_STRIDE; stat += 1) {
        const value = stats[row * ECHO_STAT_STRIDE + stat] ?? 0
        inputs[slot * ECHO_STAT_STRIDE + stat] = value
        inputs[TEAM_INPUT.totals + stat] += value
      }
    })
    executeScalarProgram(display, inputs, scratch, output)
    return { damage: output[OUT_DAMAGE]!, energyRegen: noEr ? 0 : Math.max(0, output[OUT_ENERGY_REGEN]!),
      ...(subject >= 0 && program.shownOffset >= 0 ? { dpr: output[program.shownOffset + subject]! } : {}) }
  }
}

/** two measurements of one build agree: the compiled model may stand in for the replay. */
export function sameMeasure(a: ProgramMeasurement, b: ProgramMeasurement): boolean {
  const scale = Math.max(Math.abs(a.damage), Math.abs(b.damage))
  return Number.isFinite(a.damage) && Number.isFinite(b.damage)
    && Math.abs(a.damage - b.damage) <= DAMAGE_TOLERANCE * scale
    && Math.abs(a.energyRegen - b.energyRegen) <= ENERGY_REGEN_TOLERANCE
}

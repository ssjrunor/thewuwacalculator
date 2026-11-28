/*
  Author: Runor Ewhro
  description: searches build anchors on a verified team's generated program using fixed teammate builds.
*/

import type { BuildSnapshot } from '@/domain/leaderboard/snapshot'
import { ensureResonatorData } from '@/data/gameData'
import { hasScoringData } from './coverage'
import { createScenario, scenarioResonatorIds } from './scenario'
import { buildScenarioInput, teammateEchoes } from './scenarioInput'
import { interpretTeamActions } from '@/engine/rotationGen'
import { canonicalJson, sha256Hex } from '@/domain/leaderboard/canonical'
import type { ProgramDocument } from './scoreScenario'
import type { ScoringSession } from './scoringSession'
import type { ReferenceSearch } from './references'
import { executeScoringRotation } from './execute'

// offline diagnostics use the authored context build; submitted cards compute their own anchors through the app
// evaluator, including their ER and utility gear
export function createReferenceSearch(session: ScoringSession): ReferenceSearch {
  return async ({ def, sequence, plan }) => {
    if (!hasScoringData(def)) return { status: 'unsupported', reason: 'insufficient_data' }
    const seat = def.members.find((member) => member.isContext)
    const template = seat && session.ruleset.teammates.get(`${def.teamId}:${seat.slot}`)
    if (!template) return { status: 'unsupported', reason: 'insufficient_data' }
    const context = session.context(async () => ({ status: 'unsupported', reason: 'reference_search' }))
    const echoes = teammateEchoes(template, `${def.teamId}:${seat!.slot}`, context.deps, [])
    const snapshot: BuildSnapshot = {
      v: 1, gameVer: session.ruleset.manifest.gameVer, uid: '', name: null,
      resonator: { id: def.resonatorId, level: 90, sequence, skillLevels: {} },
      weapon: { id: def.weapon.id, level: 90 },
      echoes: echoes.map((echo, slot) => ({
        slot, id: echo.id, set: echo.set, mainEcho: echo.mainEcho,
        main: structuredClone(echo.mainStats), substats: { ...echo.substats },
      })),
    }
    const built = buildScenarioInput(snapshot, def, context.teammates, context.deps, { allowPartial: true })
    if (!built.ok) return { status: 'unsupported', reason: 'insufficient_data' }
    await ensureResonatorData(scenarioResonatorIds(built.input))
    const interpreted = await interpretTeamActions(session.interpreter, plan, createScenario(built.input), { allowPartial: true })
    if (interpreted.status !== 'interpreted') return { status: 'unsupported', reason: 'insufficient_data' }
    const { scenario } = interpreted
    const executed = await executeScoringRotation({ def, input: built.input, scenario })
    if (executed.status !== 'ok' || !executed.anchors) return { status: 'unsupported', reason: 'insufficient_data' }
    const program: ProgramDocument = {
      v: 1, scenarioId: def.id, teamId: def.teamId,
      initialOnFieldMemberId: scenario.initialOnFieldMemberId,
      members: scenario.team.members.map((member) => ({ id: member.id, resonatorId: member.resonatorId })),
      program: scenario.program.program,
      ...(interpreted.diagnostics.omissions?.length ? { omissions: interpreted.diagnostics.omissions } : {}),
    }
    const hash = await sha256Hex(canonicalJson(program))
    return { status: 'ok', ...executed.anchors, programs: { baseline: hash, bench: hash, perfect: hash } }
  }
}

/*
  Author: Runor Ewhro
  description: draws a leaderboard card from the exact team input stored with
               its score. members start at the peaks used for scoring, so combat
               stats show every condition the rotation reaches, and build stats
               clear them. an unscored build draws the submitted build alone: its
               own weapon, no teammates, and the score pending.
*/

import type { BuildDetailResponse, ScenarioCell } from '@/domain/leaderboard/api'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import type { ResRuntime } from '@/domain/entities/runtime'
import type { CombatScenario } from '@/domain/entities/combatScenario'
import { ensureResonatorData } from '@/data/gameData'
import { getResSeedBy, resResBaseSt } from '@/data/catalog/resonatorSeedService'
import { getSntSetNam } from '@/data/gameData/catalog/sonataSets'
import { canonicalResonatorId, cardScenarioInput, createScenario } from '@/engine/leaderboard'
import { mkActRt, mkPartRtLkp } from '@/engine/runtime/runtimeAdapters'
import { getBuildStats } from '@/engine/pipeline/buildStats'
import { getMaxEchoSc } from '@/engine/evaluation/echoScoring'
import { computeShowcaseStats } from '@/engine/evaluation/showcaseStats'
import { makeStatsView } from '@/modules/simulation/model/statsView'
import { makeRailModel } from '@/modules/simulation/workspace/railModel'
import { buildSonataPlan } from '@/modules/simulation/workspace/ui'
import type { BuildRailModel, ShowcaseBuildModel } from '@/modules/simulation/workspace/BuildRail'

/** an expected card display failure with a message safe to show in the build panel. */
export class CardBuildError extends Error {}

export interface CardBuild {
  scenario: CombatScenario
  runtime: ResRuntime
  partRts: Record<string, ResRuntime>
  rail: BuildRailModel
  showcase: ShowcaseBuildModel
}

/** the input a cell was scored with: the detail's own for the best cell, or one fetched for other cells
    (GET /builds/:id/scenarios/:sid/input). */
export function cardInput(detail: BuildDetailResponse, cell: ScenarioCell, input: ScenarioInput | null | undefined = detail.scoredInput): ScenarioInput {
  if (!input) throw new CardBuildError("hmm... we can't show this build's card right now. try again later :(")
  const scored = input.members.find(member => member.slot === input.scoredSlot && member.role === 'scored')
  if (input.scenarioId !== cell.scenario.id || !scored
    || canonicalResonatorId(scored.resonatorId) !== canonicalResonatorId(detail.snapshot.resonator.id)
    || scored.weapon.id !== cell.scenario.weaponId) {
    throw new CardBuildError("hmm... we can't show the card for this team and weapon right now. try another available option or check back later :(")
  }
  return structuredClone(input)
}

export function loadCardBuild(detail: BuildDetailResponse, cell: ScenarioCell, input?: ScenarioInput | null): Promise<CardBuild> {
  return drawCard(detail, cardInput(detail, cell, input === undefined ? detail.scoredInput : input))
}

/** the card before any scenario scores the build: the submitted build alone. */
export function loadPendingCard(detail: BuildDetailResponse): Promise<CardBuild> {
  return drawCard(detail, cardScenarioInput(detail.snapshot))
}

async function drawCard(detail: BuildDetailResponse, input: ScenarioInput): Promise<CardBuild> {
  const ids = [...new Set(input.members.map(member => member.resonatorId))]
  await ensureResonatorData(ids)
  const scenario = createScenario({ ...input, scenarioId: `card:${detail.buildId}:${input.scenarioId}` })
  const runtime = mkActRt(scenario)
  if (!runtime) throw new CardBuildError("oopsies... we couldn't display this build. refresh the page and try again :(")
  const partRts = mkPartRtLkp(scenario)
  const seed = getResSeedBy(runtime.id)
  const stats = seed ? getBuildStats(runtime, resResBaseSt(seed, runtime.base.level)) : null
  const combat = computeShowcaseStats({ runtime, runtimesById: partRts, enemy: scenario.target, selectedTargets: {} })
  const rail = makeRailModel(runtime.id, { actResId: runtime.id, runtime, partRtsById: partRts, initRtsById: partRts })
  const showcase: ShowcaseBuildModel = {
    combatStatsView: combat ? makeStatsView(runtime, combat) : null,
    buildStatsView: stats ? makeStatsView(runtime, stats) : null,
    charId: runtime.id,
    hasWeights: getMaxEchoSc(runtime.id) > 0,
    echoes: runtime.build.echoes,
    sonataSets: buildSonataPlan(runtime.build.echoes).map((entry) => ({
      setId: entry.id, pieces: entry.count, icon: entry.icon, name: getSntSetNam(entry.id),
    })),
  }
  return { scenario, runtime, partRts, rail, showcase }
}

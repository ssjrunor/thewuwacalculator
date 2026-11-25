/*
  Author: Runor Ewhro
  description: a scored build's stats as the showcase card's build column shows
               them: a scenario's scored seat (level 90, the scenario weapon, the
               card's echoes and sequence) before team and rotation buffs, used to
               compare builds on boards. the members' resonator data is loaded
               first, as for createScenario.
*/

import type { BuildStats } from '@/domain/leaderboard/api'
import type { ScenarioInput } from '@/domain/leaderboard/scenarioInput'
import { getResSeedBy, resResBaseSt } from '@/data/catalog/resonatorSeedService'
import { getBuildStats } from '@/engine/pipeline/buildStats'
import { cmptEchoCritAll, cmptBldCritGr } from '@/engine/evaluation/critValue'
import { mkActRt } from '@/engine/runtime/runtimeAdapters'
import { createScenario } from './scenario'

const round = (value: number, places: number) => Math.round(value * 10 ** places) / 10 ** places

/** `scenario` is createScenario(input) when the caller has made it already; it is only read. */
export function scenarioBuildStats(input: ScenarioInput, scenario = createScenario(input)): BuildStats {
  const scored = input.members.find((member) => member.slot === input.scoredSlot)
  if (!scored) throw new Error(`${input.scenarioId}: no scored seat`)
  const seed = getResSeedBy(scored.resonatorId)
  if (!seed) throw new Error(`Resonator ${scored.resonatorId} is not loaded`)
  const runtime = mkActRt(scenario)
  if (!runtime) throw new Error(`${input.scenarioId}: no runtime for the scored seat`)
  const stats = getBuildStats(runtime, resResBaseSt(seed, runtime.base.level))
  const critValue = scored.echoes.reduce((sum, echo) => sum + (echo ? cmptEchoCritAll(echo) : 0), 0)
  const skill = (key: keyof typeof stats.skillType) => stats.skillType[key].dmgBonus + stats.skillType.all.dmgBonus
  // whole stats truncate, as the card prints them.
  return {
    atk: Math.floor(stats.atk.final),
    hp: Math.floor(stats.hp.final),
    def: Math.floor(stats.def.final),
    energyRegen: round(stats.energyRegen, 1),
    critRate: round(stats.critRate, 1),
    critDmg: round(stats.critDmg, 1),
    attributeBonus: round(stats.attribute[seed.attribute].dmgBonus + stats.attribute.all.dmgBonus, 1),
    basicAttack: round(skill('basicAtk'), 1),
    heavyAttack: round(skill('heavyAtk'), 1),
    resonanceSkill: round(skill('resonanceSkill'), 1),
    resonanceLiberation: round(skill('resonanceLiberation'), 1),
    critValue: round(critValue, 1),
    critGrade: round(cmptBldCritGr(scored.echoes), 1),
  }
}

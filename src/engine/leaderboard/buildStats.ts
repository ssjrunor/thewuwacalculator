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

// `scenario` is createScenario(input) when the caller has made it already; it is only read
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
  // kept exact: displays truncate, never round up
  return {
    atk: stats.atk.final,
    hp: stats.hp.final,
    def: stats.def.final,
    energyRegen: stats.energyRegen,
    critRate: stats.critRate,
    critDmg: stats.critDmg,
    attributeBonus: stats.attribute[seed.attribute].dmgBonus + stats.attribute.all.dmgBonus,
    basicAttack: skill('basicAtk'),
    heavyAttack: skill('heavyAtk'),
    resonanceSkill: skill('resonanceSkill'),
    resonanceLiberation: skill('resonanceLiberation'),
    critValue: critValue,
    critGrade: cmptBldCritGr(scored.echoes),
  }
}

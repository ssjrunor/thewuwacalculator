/*
  Author: Runor Ewhro
  description: replays retained evaluation builds through the numeric rotation
               path and extracts their damage, stats, and feature totals.
*/
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import type { OptResultStats } from '@/engine/search/score/core'
import type { RotSuggCtx } from '@/engine/suggestions/types'
import type { EncodedEvaluationBuild } from './scoring'
import { prepareResSimulation } from '@/engine/pipeline'
import { countEchoSets } from '@/engine/pipeline/buildCombatContext'
import { maxEchoStts, echoSetPieceReq } from '@/engine/runtime/sourceStateInit'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import { executeRotationScore, prepareRunEnv, prepareEchoCandidateRunEnv, prepareRotationProgram, type DamageInvocation } from '@/engine/rotation/execute'
import { ECHO_STAT_KEYS } from '@/engine/rotation/portable/layout'
import { ECHO_STAT_STRIDE } from '@/engine/search/layout/echoLayout'
import { EVALUATION_REPLAY_FRAMES } from './config'
import { finalCoreCell, finalTopCell, finalAttributeCell, finalSkillTypeCell } from '@/engine/rotation/numericLayout'

interface Details {
  total: number
  stats: OptResultStats | null
  features: Array<Pick<DamageInvocation['skill'], 'id' | 'label' | 'tab' | 'skillType'> & { resonatorId: string; damage: number }>
}
const contexts = new WeakMap<RotSuggCtx, ReturnType<typeof prepareRunEnv>>()
const frames = new WeakMap<RotSuggCtx, Map<string, (stats: Float32Array) => Details>>()

function invocationStats({ finalPlane: plane, finalOffset: offset, skill }: DamageInvocation): OptResultStats {
  const at = (cell: number) => plane[offset + cell] ?? 0
  const layered = (field: 'dmgBonus' | 'amplify') =>
    at(finalTopCell(field)) + at(finalAttributeCell('all', field)) + at(finalAttributeCell(skill.element, field))
    + at(finalSkillTypeCell('all', field)) + [...new Set(skill.skillType)].filter(type => type !== 'all')
      .reduce((total, type) => total + at(finalSkillTypeCell(type, field)), 0) + (skill.skillBuffs?.[field] ?? 0)
  return { atk: at(finalCoreCell('atk', 'final')), hp: at(finalCoreCell('hp', 'final')), def: at(finalCoreCell('def', 'final')),
    // Anchor stat columns share the combat sheet's Crit Rate and Crit DMG.
    // Element, skill-type, and individual attack bonuses belong to damage only.
    cr: at(finalTopCell('critRate')), cd: at(finalTopCell('critDmg')),
    er: at(finalTopCell('energyRegen')), bonus: layered('dmgBonus'), amp: layered('amplify') }
}

export function evaluationRotationDetails(ctx: RotSuggCtx, build: Omit<EncodedEvaluationBuild, 'stats' | 'echoes' | 'mainEchoBuffs'> & { echoes: readonly EchoInstance[] }, stats: Float32Array): Details {
  const plan = ctx.candidatePlan!, source = ctx.teamDamagePlan!
  let cache = frames.get(ctx)
  if (!cache) { cache = new Map(); frames.set(ctx, cache) }
  const key = JSON.stringify([build.echoes.map(echo => [echo.id, echo.set]), [...build.sets], [...build.comboIds], build.mainIndex])
  let evaluate = cache.get(key)
  if (!evaluate) {
    let environment = contexts.get(ctx)
    if (!environment) {
      const prepared = prepareResSimulation(source.runtime, source.seed, source.enemy,
        { ...source.runtimesById, [source.runtime.id]: source.runtime }, source.selectedTargets, source.combatSetup)
      environment = prepareRunEnv(prepared.context, source.seed)
      contexts.set(ctx, environment)
    }
    build = { ...build, echoes: [...build.echoes], sets: build.sets.slice(), comboIds: build.comboIds.slice() }
    const base = environment, program = prepareRotationProgram(plan.items)
    let template: typeof environment | undefined, previous: Float32Array | undefined, result: Details | undefined
    let previousControls = ''
    evaluate = values => {
      if (previous?.length === values.length && previous.every((value, index) => Object.is(value, values[index]))) return result!
      const echoes = [...build.comboIds].flatMap(row => {
        const original = build.echoes[row]
        if (!original) return []
        const substats = Object.fromEntries(ECHO_STAT_KEYS.map((stat, column) => [stat, values[row * ECHO_STAT_STRIDE + column] ?? 0]))
        return [{ ...original, set: build.sets[row] ?? original.set, mainEcho: row === build.mainIndex,
          mainStats: { primary: { key: 'atkFlat', value: 0 }, secondary: { key: 'atkFlat', value: 0 } }, substats } satisfies EchoInstance]
      })
      let runtime: ResRuntime = { ...source.runtime, build: { ...source.runtime.build, echoes } }
      runtime = maxEchoStts(runtime)
      const controls = { ...runtime.state.controls }, counts = countEchoSets(echoes)
      for (const [control, value] of Object.entries(plan.setControls ?? {})) {
        const match = /^echoSet:(\d+):bonus:/.exec(control), def = match ? getEchoSetDe(Number(match[1])) : null
        if (value === undefined || (def && (counts[def.id] ?? 0) < echoSetPieceReq(def))) delete controls[control]
        else controls[control] = value
      }
      for (const [set, parts] of Object.entries(plan.disabledSetParts)) for (const part of parts) delete controls[`echoSet:${set}:bonus:${part}`]
      runtime = { ...runtime, state: { ...runtime.state, controls } }
      const signature = JSON.stringify(controls)
      const next = prepareEchoCandidateRunEnv(template ?? base, runtime, !!template && signature === previousControls)
      template = next; previousControls = signature
      const features = new Map<string, Details['features'][number]>()
      let invocation: DamageInvocation | undefined, display: OptResultStats | null = null, total = 0
      executeRotationScore(next, program, { aggregationType: 'damage', allowedFeatureKeys: plan.featureKeys,
        onDamageInvocation: current => { invocation = current },
        onDamageScore: (eventKey, resonatorId, damage) => {
          if (!plan.damageEventKeys.has(eventKey) || !invocation) return
          total += damage
          if (resonatorId === source.runtime.id && invocation.skill.archetype === 'skillDamage' && !display) display = invocationStats(invocation)
          const featureKey = `${resonatorId}:${invocation.skill.id}`, feature = features.get(featureKey)
          if (feature) feature.damage += damage
          else features.set(featureKey, { id: invocation.skill.id, label: invocation.skill.label, tab: invocation.skill.tab,
            skillType: invocation.skill.skillType, resonatorId, damage })
        },
      })
      previous = values.slice(); result = { total, stats: display, features: [...features.values()] }
      return result
    }
    cache.set(key, evaluate)
    if (cache.size > EVALUATION_REPLAY_FRAMES) cache.delete(cache.keys().next().value!)
  }
  return evaluate(stats)
}

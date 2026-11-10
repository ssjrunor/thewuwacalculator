/*
  Author: Runor Ewhro
  description: the states a rotation can write, as the rotation editor offers
               them: each team member's visible equipped states, Unison Boon
               when a member can build it, and the target enemy's statuses.
               the editor labels these for its menus; the rotation generator
               writes only these, so both author the same preamble.
*/

import type { ResRuntime } from '@/domain/entities/runtime'
import type { SourceState } from '@/domain/gameData/contracts'
import { UNISON_BOON_TEAM_PATH, unisonBoonMaxForRuntimes, unisonBoonState } from '@/domain/gameData/unisonBoon'
import { openingConditionChoices, openingConditionValue, type OpeningValue } from '@/domain/gameData/rotationPreambleDefaults'
import { listStatesFor } from '@/data/catalog/gameDataService'
import { canStateBeVisible, isStateVisible } from '@/engine/services/sourceStateService'
import { listEquippedSourceStates } from '@/engine/services/runtimeSourceService'
import { negEffectsFor, NEG_EFFECT_CATS } from '@/engine/gameData/negativeEffects'
import { getTuneStrainMaxForTeam } from '@/engine/gameData/tuneStrain'

export interface OpeningChoice {
  /** the member the write belongs to; enemy and team writes carry the active member. */
  resonatorId: string
  state: SourceState
  /** where the write lands; members' own states leave it unset. */
  changeTarget?: 'enemy' | 'rotation'
  /** hidden as the rotation opens; it shows once the controls it depends on are written. */
  hidden?: true
}

/** the team in seat order: the active runtime first, then its teammates. */
export function rotationTeamIds(runtime: ResRuntime): string[] {
  return Array.from(new Set([runtime.id, ...runtime.build.team.filter((id): id is string => Boolean(id))]))
}

/**
 * a member's equipped states the editor lists, one per control: every state a
 * rotation could see, including one hidden at the opening by a control it can
 * write (Suisui's Ceaseless Landscape dependants while the Landscape is off).
 * a written state whose conditions do not hold simply has no effect.
 */
export function rotationMemberStates(memRt: ResRuntime, actRt: ResRuntime): SourceState[] {
  const seen = new Set<string>()
  return listEquippedSourceStates(memRt).filter((state) => {
    if (seen.has(state.controlKey) || !canStateBeVisible(memRt, memRt, state, actRt)) return false
    seen.add(state.controlKey)
    return true
  })
}

/** whether a member's state is visible as the rotation opens. */
export function openingVisible(memRt: ResRuntime, actRt: ResRuntime, state: SourceState): boolean {
  return isStateVisible(memRt, memRt, state, actRt)
}

function enemyStack(id: string, label: string, path: string, max: number, description: string): SourceState {
  return {
    id, label, path, max, description,
    source: { type: 'enemy', id: 'target' },
    ownerKey: 'enemy:status',
    controlKey: `enemy:${id}`,
    kind: 'stack',
    min: 0,
    defaultValue: 0,
  }
}

/**
 * the enemy's writable statuses: Tune Strain, the negative effects the team
 * stacks by hand (a fixed-max effect such as Glacio Bite has no slider and is
 * not offered), and the target's own debuff controls.
 */
export function rotationEnemyStates(
  runtime: ResRuntime,
  enemyId?: string,
  runtimesById?: Record<string, ResRuntime>,
): SourceState[] {
  const tuneStrain = enemyStack('tuneStrain', 'Tune Strain', 'enemy.status.tuneStrain',
    getTuneStrainMaxForTeam(runtime, enemyId ? { id: enemyId } : undefined),
    'Set the target enemy Tune Strain stacks for following rotation actions.')
  // the opening counter can hide a linked negative effect even when later rotation writes can enable it.
  const resolved = negEffectsFor(runtime, runtimesById)
  // a linked status can become relevant after the rotation writes its parent.
  // retain the condition when the opening parent counter is zero.
  for (const definition of Object.values(NEG_EFFECT_CATS)) {
    if (!definition.linkedTo || resolved.some(effect => effect.key === definition.key)) continue
    const parent = resolved.find(effect => effect.key === definition.linkedTo)
    if (parent) resolved.push({ ...definition, max: Math.max(definition.defaultMax, parent.max),
      stackMode: 'manual', sliderVisible: true })
  }
  const negative = resolved
    .filter((effect) => effect.sliderVisible)
    .map((effect) => enemyStack(effect.key, effect.label, `enemy.combat.${effect.key}`, effect.max,
      `Set the target enemy ${effect.label} stacks for following rotation actions.`))
  return [tuneStrain, ...negative, ...(enemyId ? listStatesFor('enemy', enemyId) : [])]
}

/** Unison Boon, offered only when a member that builds it is on the team. */
export function rotationTeamStates(runtimes: readonly ResRuntime[]): SourceState[] {
  return runtimes.some((runtime) => runtime.id === '1311' || runtime.id === '1312')
    ? [{ ...unisonBoonState, path: UNISON_BOON_TEAM_PATH, max: unisonBoonMaxForRuntimes(runtimes) }]
    : []
}

/** every state the editor lets a rotation write, in the editor's order. */
export function rotationStateChoices(
  actRt: ResRuntime,
  runtimesById: Record<string, ResRuntime>,
  enemyId?: string,
): OpeningChoice[] {
  const runtimes = rotationTeamIds(actRt)
    .map((id) => (id === actRt.id ? actRt : runtimesById[id]))
    .filter((runtime): runtime is ResRuntime => Boolean(runtime))
  const lookup = Object.fromEntries(runtimes.map((runtime) => [runtime.id, runtime]))
  return [
    ...runtimes.flatMap((runtime) => rotationMemberStates(runtime, actRt)
      .map((state) => ({ resonatorId: runtime.id, state,
        ...(openingVisible(runtime, actRt, state) ? {} : { hidden: true as const }) }))),
    ...rotationTeamStates(runtimes).map((state) => ({ resonatorId: 'team', state, changeTarget: 'rotation' as const })),
    ...rotationEnemyStates(actRt, enemyId, lookup)
      .map((state) => ({ resonatorId: actRt.id, state, changeTarget: 'enemy' as const })),
  ]
}

/**
 * values the preamble opens with when nothing overrides them: a choice that
 * must be one of its options (a resonance mode has no "neither") uses the
 * member's current value; other choices use their default.
 */
export function scenarioOpeningValues(
  runtimesById: Record<string, ResRuntime>,
): (choice: Pick<OpeningChoice, 'resonatorId' | 'state'>) => OpeningValue | undefined {
  // required named modes retain the scenario value; optional toggles and counters use their declared opening defaults.
  return (choice) => {
    const runtime = runtimesById[choice.resonatorId]
    return runtime ? openingConditionValue(choice.state, runtime.state.controls[choice.state.controlKey]) : undefined
  }
}

export interface OpeningWrite {
  choice: OpeningChoice
  value: OpeningValue
}

/**
 * the editor's Generate Preamble: every opening state once, at its opening
 * value. `values` overrides a choice's value (return undefined to keep it).
 */
export function openingWrites<T extends Pick<OpeningChoice, 'resonatorId' | 'state'>>(
  choices: readonly T[],
  values?: (choice: T) => OpeningValue | undefined,
): Array<{ choice: T; value: OpeningValue }> {
  return openingConditionChoices(choices).map((choice) => ({
    choice,
    value: values?.(choice) ?? openingConditionValue(choice.state),
  }))
}

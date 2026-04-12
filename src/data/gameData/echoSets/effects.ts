/*
  Author: Runor Ewhro
  Description: Builds data-driven echo set source packages from cached
               JSON definitions loaded during calculator bootstrap.
*/

import type {
  SourcePackage,
  DataSourceRef,
  SourceOwnerDefinition,
  SourceStateDefinition,
  EffectDefinition,
  EffectOperation,
  FormulaExpression,
  ConditionExpression,
  BaseStatKey,
  BaseStatField,
  TopBuffStatKey,
} from '@/domain/gameData/contracts.ts'
import type { AttributeKey, SkillTypeKey } from '@/domain/entities/stats.ts'

type Buff = {
  value: number
  path: string[]
  targetScope?: EffectDefinition['targetScope']
}

type StateEntry = {
  perStack?: Buff[]
  perStep?: Buff[]
  max: Buff[]
}

export interface SetPart {
  key: string
  label: string
  trigger: string
}

export interface SetDef {
  id: number
  name: string
  setMax: 3 | 5
  desc: {
    twoPiece?: string
    threePiece?: string
    fivePiece?: string
  }
  twoPiece: Buff[] | null
  fivePiece: Buff[] | null
  states: Record<string, StateEntry>
  parts: SetPart[]
  extraEffects?: Array<{
    id: string
    label: string
    operations: EffectOperation[]
    condition: ConditionExpression
    targetScope?: EffectDefinition['targetScope']
  }>
}

export let ECHO_SET_DEFS: SetDef[] = []
export let sonataSetSources: SourcePackage[] = []

let setDefsById: Record<number, SetDef> = {}

// build a source reference for an echo set id
function makeSource(setId: number): DataSourceRef {
  return { type: 'echoSet', id: String(setId) }
}

// build the shared owner key for an echo set package
function ownerKey(setId: number): string {
  return `echoSet:${setId}:bonus`
}

// build a control key for one state under an echo set owner
function controlKey(setId: number, stateId: string): string {
  return `${ownerKey(setId)}:${stateId}`
}

// build the single owner definition used by an echo set package
function makeOwner(setId: number, name: string): SourceOwnerDefinition {
  return {
    id: 'bonus',
    label: name,
    source: makeSource(setId),
    scope: 'resonator',
    kind: 'inherent',
    ownerKey: ownerKey(setId),
  }
}

// build a toggle state definition for an echo set control
function makeToggle(
    setId: number,
    stateId: string,
    label: string,
    desc?: string,
): SourceStateDefinition {
  const ck = controlKey(setId, stateId)

  return {
    id: stateId,
    label,
    source: makeSource(setId),
    ownerKey: ownerKey(setId),
    controlKey: ck,
    path: `runtime.state.controls.${ck}`,
    kind: 'toggle',
    defaultValue: false,
    ...(desc ? { description: desc } : {}),
  }
}

// build a stack state definition for an echo set control
function makeStackState(
    setId: number,
    stateId: string,
    label: string,
    max: number,
    desc?: string,
): SourceStateDefinition {
  const ck = controlKey(setId, stateId)

  return {
    id: stateId,
    label,
    source: makeSource(setId),
    ownerKey: ownerKey(setId),
    controlKey: ck,
    path: `runtime.state.controls.${ck}`,
    kind: 'stack',
    defaultValue: 0,
    min: 0,
    max,
    ...(desc ? { description: desc } : {}),
  }
}

// create a constant formula expression
function constVal(value: number): FormulaExpression {
  return { type: 'const', value }
}

// read one echo set control value from source runtime controls
function readCtrl(setId: number, stateId: string): FormulaExpression {
  return {
    type: 'read',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey(setId, stateId)}`,
    default: 0,
  }
}

// multiply two formula expressions
function mul(a: FormulaExpression, b: FormulaExpression): FormulaExpression {
  return { type: 'mul', values: [a, b] }
}

// clamp a formula expression to a maximum value
function clamp(value: FormulaExpression, max: number): FormulaExpression {
  return { type: 'clamp', value, max }
}

// build a truthy condition for an echo set state control
function truthyCond(setId: number, stateId: string): ConditionExpression {
  return {
    type: 'truthy',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey(setId, stateId)}`,
  }
}

// require that the runtime has at least the given set count equipped
function setGte(setId: number, min: number): ConditionExpression {
  return {
    type: 'gte',
    from: 'context',
    path: `echoSetCounts.${setId}`,
    value: min,
  }
}

// combine multiple conditions with logical and
function andCond(...values: ConditionExpression[]): ConditionExpression {
  return { type: 'and', values }
}

// create a base stat add operation
function addBaseStat(
    stat: BaseStatKey,
    field: BaseStatField,
    value: FormulaExpression,
): EffectOperation {
  return { type: 'add_base_stat', stat, field, value }
}

// create a top-level stat add operation
function addTopStat(stat: TopBuffStatKey, value: FormulaExpression): EffectOperation {
  return { type: 'add_top_stat', stat, value }
}

// create an attribute modifier add operation
function addAttributeMod(
    attribute: AttributeKey | 'all',
    mod: string,
    value: FormulaExpression,
): EffectOperation {
  return { type: 'add_attribute_mod', attribute, mod, value } as EffectOperation
}

// create a skill-type modifier add operation
function addSkilltypeMod(
    skillType: SkillTypeKey,
    mod: string,
    value: FormulaExpression,
): EffectOperation {
  return { type: 'add_skilltype_mod', skillType, mod, value } as EffectOperation
}

// resolve a string path spec into the correct effect operation type
function pathOp(path: string[], value: FormulaExpression): EffectOperation {
  if (path.length === 2 && (path[0] === 'atk' || path[0] === 'hp' || path[0] === 'def')) {
    return addBaseStat(path[0] as BaseStatKey, path[1] as BaseStatField, value)
  }

  if (path.length === 1) {
    return addTopStat(path[0] as TopBuffStatKey, value)
  }

  if (path[0] === 'attribute') {
    return addAttributeMod(path[1] as AttributeKey, path[2], value)
  }

  if (path[0] === 'skillType') {
    return addSkilltypeMod(path[1] as SkillTypeKey, path[2], value)
  }

  throw new Error(`Unknown echo set path: ${path.join('.')}`)
}

// create a full effect definition for one echo set effect
function makeEffect(
    setId: number,
    effectId: string,
    label: string,
    operations: EffectOperation[],
    condition?: ConditionExpression,
    targetScope: EffectDefinition['targetScope'] = 'self',
): EffectDefinition {
  return {
    id: `echoSet:${setId}:${effectId}`,
    label,
    source: makeSource(setId),
    ownerKey: ownerKey(setId),
    trigger: 'runtime',
    targetScope,
    ...(condition ? { condition } : {}),
    operations,
  }
}

// build one complete source package from a set definition
function buildSetPackage(def: SetDef): SourcePackage {
  const effects: EffectDefinition[] = []
  const states: SourceStateDefinition[] = []
  const pieceReq = def.setMax === 3 ? 3 : 5

  // group buffs by target scope so each scope becomes its own effect
  function groupBuffsByScope<T extends Buff>(buffs: T[]) {
    const grouped = new Map<EffectDefinition['targetScope'], T[]>()

    for (const buff of buffs) {
      const scope = buff.targetScope ?? 'self'
      const existing = grouped.get(scope)

      if (existing) {
        existing.push(buff)
      } else {
        grouped.set(scope, [buff])
      }
    }

    return [...grouped.entries()]
  }

  // build the base 2-piece effect if present
  if (def.twoPiece) {
    for (const [targetScope, buffs] of groupBuffsByScope(def.twoPiece)) {
      effects.push(
          makeEffect(
              def.id,
              '2pc',
              `${def.name} 2pc`,
              buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
              setGte(def.id, 2),
              targetScope,
          ),
      )
    }
  }

  // build the main 3-piece or 5-piece effect if present
  if (def.fivePiece) {
    for (const [targetScope, buffs] of groupBuffsByScope(def.fivePiece)) {
      effects.push(
          makeEffect(
              def.id,
              `${pieceReq}pc`,
              `${def.name} ${pieceReq}pc`,
              buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
              setGte(def.id, pieceReq),
              targetScope,
          ),
      )
    }
  }

  // build all toggle or stack-driven state effects for this set
  for (const [stateId, state] of Object.entries(def.states)) {
    const perStep = state.perStep ?? state.perStack ?? state.max
    const isToggle = perStep.every((ps, index) => ps.value === state.max[index].value)
    const part = def.parts.find((entry) => entry.key === stateId)

    // toggle state: one on/off control that grants the full max values
    if (isToggle) {
      states.push(makeToggle(def.id, stateId, part?.label ?? stateId, part?.trigger))

      for (const [targetScope, buffs] of groupBuffsByScope(state.max)) {
        effects.push(
            makeEffect(
                def.id,
                stateId,
                part?.label ?? stateId,
                buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
                andCond(setGte(def.id, pieceReq), truthyCond(def.id, stateId)),
                targetScope,
            ),
        )
      }
    } else {
      // stack/step state: derive the maximum reachable value from the step and max values.
      // perStep is still rendered like a stack control for now, but it stays distinct in data.
      const maxStacks = Math.round(
          Math.max(...perStep.map((ps, index) => state.max[index].value / ps.value)),
      )

      states.push(
          makeStackState(def.id, stateId, part?.label ?? stateId, maxStacks, part?.trigger),
      )

      // group per-stack/max pairs by scope so we can generate one effect per scope
      const pairsByScope = new Map<
          EffectDefinition['targetScope'],
          Array<{ perStack: Buff; max: Buff }>
      >()

      for (let index = 0; index < perStep.length; index += 1) {
        const perStackBuff = perStep[index]
        const maxBuff = state.max[index]
        const scope = perStackBuff.targetScope ?? maxBuff.targetScope ?? 'self'
        const existing = pairsByScope.get(scope)
        const pair = { perStack: perStackBuff, max: maxBuff }

        if (existing) {
          existing.push(pair)
        } else {
          pairsByScope.set(scope, [pair])
        }
      }

      // build the stack-scaled effect using read * perStack value, clamped to max
      for (const [targetScope, pairs] of pairsByScope.entries()) {
        effects.push(
            makeEffect(
                def.id,
                stateId,
                part?.label ?? stateId,
                pairs.map(({ perStack, max }) =>
                    pathOp(
                        perStack.path,
                        clamp(mul(readCtrl(def.id, stateId), constVal(perStack.value)), max.value),
                    ),
                ),
                andCond(setGte(def.id, pieceReq), truthyCond(def.id, stateId)),
                targetScope,
            ),
        )
      }
    }
  }

  // build any extra custom effects that are not covered by normal piece or state rules
  for (const effect of def.extraEffects ?? []) {
    effects.push(
        makeEffect(
            def.id,
            effect.id,
            effect.label,
            effect.operations,
            andCond(setGte(def.id, pieceReq), effect.condition),
            effect.targetScope,
        ),
    )
  }

  // return the final source package for this set
  return {
    source: makeSource(def.id),
    owners: [makeOwner(def.id, def.name)],
    states,
    effects,
  }
}

export function initEchoSetDefinitions(defs: SetDef[]): void {
  ECHO_SET_DEFS = defs
  setDefsById = Object.fromEntries(defs.map((def) => [def.id, def])) as Record<number, SetDef>
  sonataSetSources = defs.map(buildSetPackage)
}

export function getEchoSetDef(id: number): SetDef | undefined {
  return setDefsById[id]
}

export function getEchoSetControlKey(setId: number, stateId: string): string {
  return controlKey(setId, stateId)
}

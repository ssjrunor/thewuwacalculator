/*
  Author: Runor Ewhro
  Description: Builds data-driven echo set source packages from cached
               JSON definitions loaded during calculator bootstrap.
*/

import type {
  SrcPkg,
  DataSrcRef,
  SrcOwnDef,
  SourceState,
  EffectDef,
  EffectOp,
  FormExpr,
  CondExpr,
  BaseStatKey,
  BaseStatFld,
  TopBuffStatK,
} from '@/domain/gameData/contracts.ts'
import type { AttributeKey, SkillTypeKey } from '@/domain/entities/stats.ts'

type Buff = {
  value: number
  path: string[]
  targetScope?: EffectDef['targetScope']
}

type StateEntry = {
  perStack?: Buff[]
  perStep?: Buff[]
  max: Buff[]
  atMax?: Buff[]
  requiresMax?: string
}

export interface SetPart {
  key: string
  label: string
  description?: string
  trigger: string
}

export interface SetDef {
  id: number
  name: string
  type?: 'utility'
  setMax: 1 | 3 | 5
  desc: {
    onePiece?: string
    twoPiece?: string
    threePiece?: string
    fivePiece?: string
  }
  onePiece: Buff[] | null
  twoPiece: Buff[] | null
  fivePiece: Buff[] | null
  states: Record<string, StateEntry>
  parts: SetPart[]
  extraEffects?: Array<{
    id: string
    label: string
    operations: EffectOp[]
    condition: CondExpr
    targetScope?: EffectDef['targetScope']
  }>
}

export let ECHO_SET_DEFS: SetDef[] = []
export let sntSetSrcs: SrcPkg[] = []

let setDefsById: Record<number, SetDef> = {}

// build a source reference for an echo set id
function makeSource(setId: number): DataSrcRef {
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
function makeOwner(setId: number, name: string): SrcOwnDef {
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
): SourceState {
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
function mkStckStt(
  setId: number,
  stateId: string,
  label: string,
  max: number,
  desc?: string,
): SourceState {
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
function constVal(value: number): FormExpr {
  return { type: 'const', value }
}

// read one echo set control value from source runtime controls
function readCtrl(setId: number, stateId: string): FormExpr {
  return {
    type: 'read',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey(setId, stateId)}`,
    default: 0,
  }
}

// multiply two formula expressions
function mul(a: FormExpr, b: FormExpr): FormExpr {
  return { type: 'mul', values: [a, b] }
}

// clamp a formula expression to a maximum value
function clamp(value: FormExpr, max: number): FormExpr {
  return { type: 'clamp', value, max }
}

// build a truthy condition for an echo set state control
function truthyCond(setId: number, stateId: string): CondExpr {
  return {
    type: 'truthy',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey(setId, stateId)}`,
  }
}

function eqCtrl(setId: number, stateId: string, value: number | boolean): CondExpr {
  return {
    type: 'eq',
    from: 'sourceRuntime',
    path: `state.controls.${controlKey(setId, stateId)}`,
    value,
  }
}

// require that the runtime has at least the given set count equipped
function setGte(setId: number, min: number): CondExpr {
  return {
    type: 'gte',
    from: 'context',
    path: `echoSetCounts.${setId}`,
    value: min,
  }
}

// combine multiple conditions with logical and
function andCond(...values: CondExpr[]): CondExpr {
  return { type: 'and', values }
}

function stateMaxVal(state: StateEntry): number | boolean {
  const perStep = state.perStep ?? state.perStack ?? state.max
  const isToggle = perStep.every((step, index) => step.value === state.max[index].value)

  if (isToggle) {
    return true
  }

  return Math.round(
    Math.max(...perStep.map((step, index) => state.max[index].value / step.value)),
  )
}

function stateReq(def: SetDef, state: StateEntry): CondExpr | undefined {
  if (!state.requiresMax) {
    return undefined
  }

  const required = def.states[state.requiresMax]
  if (!required) {
    throw new Error(`${def.name} state requires missing state: ${state.requiresMax}`)
  }

  return eqCtrl(def.id, state.requiresMax, stateMaxVal(required))
}

// create a base stat add operation
function addBaseStat(
  stat: BaseStatKey,
  field: BaseStatFld,
  value: FormExpr,
): EffectOp {
  return { type: 'add_base_stat', stat, field, value }
}

// create a top-level stat add operation
function addTopStat(stat: TopBuffStatK, value: FormExpr): EffectOp {
  return { type: 'add_top_stat', stat, value }
}

// create an attribute modifier add operation
function addAttrMod(
  attribute: AttributeKey | 'all',
  mod: string,
  value: FormExpr,
): EffectOp {
  return { type: 'add_attribute_mod', attribute, mod, value } as EffectOp
}

// create a skill-type modifier add operation
function addSkillMod(
  skillType: SkillTypeKey,
  mod: string,
  value: FormExpr,
): EffectOp {
  return { type: 'add_skilltype_mod', skillType, mod, value } as EffectOp
}

// resolve a string path spec into the correct effect operation type
function pathOp(path: string[], value: FormExpr): EffectOp {
  if (path.length === 2 && (path[0] === 'atk' || path[0] === 'hp' || path[0] === 'def')) {
    return addBaseStat(path[0] as BaseStatKey, path[1] as BaseStatFld, value)
  }

  if (path.length === 1) {
    return addTopStat(path[0] as TopBuffStatK, value)
  }

  if (path[0] === 'attribute') {
    return addAttrMod(path[1] as AttributeKey, path[2], value)
  }

  if (path[0] === 'skillType') {
    return addSkillMod(path[1] as SkillTypeKey, path[2], value)
  }

  throw new Error(`Unknown echo set path: ${path.join('.')}`)
}

// create a full effect definition for one echo set effect
function makeEffect(
  setId: number,
  effectId: string,
  label: string,
  operations: EffectOp[],
  condition?: CondExpr,
  targetScope: EffectDef['targetScope'] = 'self',
  description?: string,
): EffectDef {
  return {
    id: `echoSet:${setId}:${effectId}`,
    label,
    source: makeSource(setId),
    ownerKey: ownerKey(setId),
    trigger: 'runtime',
    targetScope,
    ...(condition ? { condition } : {}),
    ...(description ? { description } : {}),
    operations,
  }
}

function findPart(def: SetDef, key: string): SetPart | undefined {
  return def.parts.find((entry) => entry.key === key)
}

function partLabel(def: SetDef, key: string, fallback: string): string {
  return findPart(def, key)?.label ?? fallback
}

function partDescription(def: SetDef, key: string, fallback?: string): string | undefined {
  const part = findPart(def, key)
  return part?.description ?? fallback ?? part?.label
}

function mainPieceKey(pieceReq: number): 'onePiece' | 'threePiece' | 'fivePiece' {
  if (pieceReq === 1) return 'onePiece'
  if (pieceReq === 3) return 'threePiece'
  return 'fivePiece'
}

function mainPieceDescription(def: SetDef, pieceReq: number): string | undefined {
  if (pieceReq === 1) return def.desc.onePiece
  if (pieceReq === 3) return def.desc.threePiece
  return def.desc.fivePiece
}

// build one complete source package from a set definition
function mkSetPkg(def: SetDef): SrcPkg {
  const effects: EffectDef[] = []
  const states: SourceState[] = []
  const pieceReq = def.setMax === 1 ? 1 : def.setMax === 3 ? 3 : 5

  // group buffs by target scope so each scope becomes its own effect
  function grpBffsByScp<T extends Buff>(buffs: T[]) {
    const grouped = new Map<EffectDef['targetScope'], T[]>()

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

  // build the base 1-piece effect if present
  if (def.onePiece) {
    for (const [targetScope, buffs] of grpBffsByScp(def.onePiece)) {
      effects.push(
        makeEffect(
          def.id,
          '1pc',
          partLabel(def, 'onePiece', '1pc Effect'),
          buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
          setGte(def.id, 1),
          targetScope,
          partDescription(def, 'onePiece', def.desc.onePiece),
        ),
      )
    }
  }

  // build the base 2-piece effect if present
  if (def.twoPiece) {
    for (const [targetScope, buffs] of grpBffsByScp(def.twoPiece)) {
      effects.push(
        makeEffect(
          def.id,
          '2pc',
          partLabel(def, 'twoPiece', '2pc Effect'),
          buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
          setGte(def.id, 2),
          targetScope,
          partDescription(def, 'twoPiece', def.desc.twoPiece),
        ),
      )
    }
  }

  // build the main 1-piece, 3-piece or 5-piece effect if present
  if (def.fivePiece) {
    const pieceKey = mainPieceKey(pieceReq)

    for (const [targetScope, buffs] of grpBffsByScp(def.fivePiece)) {
      effects.push(
        makeEffect(
          def.id,
          `${pieceReq}pc`,
          partLabel(def, pieceKey, `${pieceReq}pc Effect`),
          buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
          setGte(def.id, pieceReq),
          targetScope,
          partDescription(def, pieceKey, mainPieceDescription(def, pieceReq)),
        ),
      )
    }
  }

  // build all toggle or stack-driven state effects for this set
  for (const [stateId, state] of Object.entries(def.states)) {
    const perStep = state.perStep ?? state.perStack ?? state.max
    const isToggle = perStep.every((ps, index) => ps.value === state.max[index].value)
    const part = def.parts.find((entry) => entry.key === stateId)
    const requirement = stateReq(def, state)
    const effectCond = (active: CondExpr) => andCond(
      setGte(def.id, pieceReq),
      active,
      ...(requirement ? [requirement] : []),
    )

    // toggle state: one on/off control that grants the full max values
    if (isToggle) {
      const sourceState = makeToggle(
        def.id,
        stateId,
        part?.label ?? stateId,
        part?.description ?? part?.trigger,
      )
      if (requirement && state.requiresMax) {
        sourceState.enabledWhen = requirement
        sourceState.controlDependencies = [controlKey(def.id, state.requiresMax)]
      }
      states.push(sourceState)

      for (const [targetScope, buffs] of grpBffsByScp(state.max)) {
        effects.push(
          makeEffect(
            def.id,
            stateId,
            part?.label ?? stateId,
            buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
            effectCond(truthyCond(def.id, stateId)),
            targetScope,
            part?.description,
          ),
        )
      }
    } else {
      // stack/step state: derive the maximum reachable value from the step and max values.
      // perStep is still rendered like a stack control for now, but it stays distinct in data.
      const maxStacks = stateMaxVal(state) as number

      const sourceState = mkStckStt(
        def.id,
        stateId,
        part?.label ?? stateId,
        maxStacks,
        part?.description ?? part?.trigger,
      )
      if (requirement && state.requiresMax) {
        sourceState.enabledWhen = requirement
        sourceState.controlDependencies = [controlKey(def.id, state.requiresMax)]
      }
      states.push(sourceState)

      // group per-stack/max pairs by scope so we can generate one effect per scope
      const pairsByScope = new Map<
        EffectDef['targetScope'],
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
            effectCond(truthyCond(def.id, stateId)),
            targetScope,
            part?.description,
          ),
        )
      }
    }

    for (const [targetScope, buffs] of grpBffsByScp(state.atMax ?? [])) {
      effects.push(
        makeEffect(
          def.id,
          `${stateId}:max`,
          `${part?.label ?? stateId} Max Stacks`,
          buffs.map((buff) => pathOp(buff.path, constVal(buff.value))),
          andCond(setGte(def.id, pieceReq), eqCtrl(def.id, stateId, stateMaxVal(state))),
          targetScope,
          part?.description,
        ),
      )
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

export function initEchoSetD(defs: SetDef[]): void {
  ECHO_SET_DEFS = defs
  setDefsById = Object.fromEntries(defs.map((def) => [def.id, def])) as Record<number, SetDef>
  sntSetSrcs = defs.map(mkSetPkg)
}

export function getEchoSetDe(id: number): SetDef | undefined {
  return setDefsById[id]
}

export function getEchoSetCn(setId: number, stateId: string): string {
  return controlKey(setId, stateId)
}

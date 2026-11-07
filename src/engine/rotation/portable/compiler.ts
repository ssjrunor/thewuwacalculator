/*
  Author: Runor Ewhro
  description: lowers authored rotations and runtime catalogs into transferable
               scalar programs shared by CPU and GPU candidate backends.
*/
import type { CondExpr, RotationNode, RtChng, RotVl, FeatDef } from '@/domain/gameData/contracts'
import type { SkillDef } from '@/domain/entities/stats'
import type { EchoInstance, ResRuntime } from '@/domain/entities/runtime'
import { normalizeFeatureAttachments } from '@/domain/gameData/rotationAttached'
import { getRotFormulaStatKey, type RotFormulaStatKey } from '@/domain/gameData/rotationFormulaStats'
import { extractLoopExecutionBody, resolveLoopPassBody } from '@/domain/gameData/loopPasses'
import { UNISON_BOON_TEAM_PATH, UNISON_BOON_RUNTIME_PATH, unisonBoonMaxForRuntimes } from '@/domain/gameData/unisonBoon'
import { getScopedTargetSelection, splitScopedTargetOwnerKey } from '@/domain/gameData/targetRouting'
import { getTuneStrainMaxForTeam } from '@/engine/gameData/tuneStrain'
import { getNegFfctCm, getNegFfctEn, NEG_EFFECT_KEYS, type NegativeSourceEvaluator } from '@/engine/gameData/negativeEffects'
import { resolveSkill } from '@/engine/pipeline/resolveSkill'
import type { RunEnvironment } from '../execute'
import { compileRotationPlan, type CompiledRotationPlan } from '../compiler'
import { finalCoreCell, finalTopCell, finalAttributeCell, finalSkillTypeCell } from '../numericLayout'
import { ScalarOp, specializeScalarProgram, type Scalar, type ScalarProgram } from './ir'
import { TEAM_INPUT, ECHO_STAT_KEYS } from './layout'
import { type PortableValue, type ScopeReader } from './dsl'
import { PortableTeam, type TeamSnapshot } from './team'
import { lowerSkill, lowerDamage, type PortableSkill } from './damage'

export interface PortableRotationProgram {
  scalar: ScalarProgram
  /** outputs: total damage, the sheet's ATK/HP/DEF/CR/CD/ER/bonus/amp, then
   * participant totals. the sheet is the searched build at rest, before any hit. */
  displayScalar: ScalarProgram
  /** catalog string symbols, indexed by encoded inventory/theory row. */
  echoSymbols: Uint32Array
  participantIds: string[]
}
/** the packed rows a portable program scores; the optimizer's rotation payload is one. */
export interface PortablePayload {
  stats: Float32Array
  sets: Uint8Array
  kinds: Uint16Array
  costs: Uint8Array
  constraints: Float32Array
  rotationProgram: PortableRotationProgram
  weaponPrograms?: PortableRotationProgram[]
}
/** the compiler only consumes immutable, transferable preparation data. */
export type PortableRotationEnvironment = Pick<RunEnvironment,
  'graph' | 'enemy' | 'prmrResId' | 'catalogByResonator' | 'stateDefsByResonator' | 'enemyStateDefs'>
export interface RotationCandidateOptions {
  echoCount?: number
  lockedMainId?: string | null
  /** suggestions and grading vary numeric rows after preparation. */
  dynamicStats?: boolean
  selfMainEchoEffects?: boolean | 'dynamic'
  setControls?: Readonly<Record<string, boolean | number | string | undefined>>
}
interface Snapshot { team: TeamSnapshot; formula: Map<RotFormulaStatKey, Scalar> }
interface AppliedWrite { change: RtChng; lane: number }
type EvaluateCondition = (condition: CondExpr | undefined, read: ScopeReader, authored?: boolean) => boolean
class ConditionBranch {
  readonly condition: CondExpr
  readonly expression: Scalar
  constructor(condition: CondExpr, expression: Scalar) { this.condition = condition; this.expression = expression }
}
class RuntimeBranch {
  readonly key: string
  readonly value: PortableValue
  constructor(key: string, value: PortableValue) { this.key = key; this.value = value }
}

// lower rotation nodes into scalar operations after capturing the standing sheet and initializing rotation recipients.
export function compilePortableRotation(
  environment: PortableRotationEnvironment,
  items: readonly RotationNode[],
  candidates: readonly EchoInstance[],
  featureKeys: ReadonlySet<string>,
  disabledSetParts: Readonly<Record<string, readonly string[]>> = {},
  constraints?: Float32Array,
  damageEventKeys?: ReadonlySet<string>,
  staticInputs: RotationCandidateOptions = {},
): PortableRotationProgram {
  const compiler = new RotationLowering(environment, candidates, featureKeys, damageEventKeys, staticInputs.dynamicStats, staticInputs.selfMainEchoEffects)
  compiler.team.initializeEchoControls(disabledSetParts, staticInputs.setControls)
  compiler.captureSheet()
  compiler.team.beginRotationTargets()
  compiler.walk(items, compiler.team.sourceLane)
  return compiler.finish(candidates, constraints, staticInputs)
}

class RotationLowering {
  readonly team: PortableTeam
  readonly environment: PortableRotationEnvironment
  readonly featureKeys: ReadonlySet<string>
  private formula = new Map<RotFormulaStatKey, Scalar>()
  private readonly ordinals = new Map<string, Scalar>()
  private readonly totals: Scalar[]
  private sheet: Scalar[] = []
  private readonly damageEventKeys: ReadonlySet<string> | undefined
  private readonly loopPlans = new WeakMap<readonly RotationNode[], CompiledRotationPlan>()
  constructor(environment: PortableRotationEnvironment, candidates: readonly EchoInstance[], featureKeys: ReadonlySet<string>, damageEventKeys?: ReadonlySet<string>, dynamicStats = false, selfMainEchoEffects: boolean | 'dynamic' = true) {
    this.environment = environment; this.featureKeys = featureKeys
    this.damageEventKeys = damageEventKeys
    this.team = new PortableTeam(environment.graph, environment.enemy, environment.prmrResId, candidates, dynamicStats, selfMainEchoEffects)
    this.totals = this.team.runtimes.map(() => this.team.ir.zero)
  }
  finish(candidates: readonly EchoInstance[], constraints?: Float32Array, staticInputs: RotationCandidateOptions = {}): PortableRotationProgram {
    const { team } = this, { ir, dsl } = team
    team.sync()
    const sheet = this.sheet
    const bindings = new Map<number, number>()
    if (staticInputs.echoCount !== undefined) {
      for (let slot = 0; slot < 5; slot++) bindings.set(TEAM_INPUT.presence + slot, slot < staticInputs.echoCount ? 1 : 0)
      for (let stat = 0; !staticInputs.dynamicStats && stat < 20; stat++) {
        const key = ECHO_STAT_KEYS[stat]!
        const valueOf = (echo: EchoInstance) => Math.fround(Math.fround(Math.fround(echo.mainStats.primary.key === key ? echo.mainStats.primary.value : 0) + (echo.mainStats.secondary.key === key ? echo.mainStats.secondary.value : 0)) + (echo.substats[key] ?? 0))
        const first = candidates[0] ? valueOf(candidates[0]) : 0
        if (candidates.every((echo) => Object.is(valueOf(echo), first))) {
          for (let slot = 0; slot < 5; slot++) bindings.set(slot * 20 + stat, slot < staticInputs.echoCount ? first : 0)
          bindings.set(TEAM_INPUT.totals + stat, first * staticInputs.echoCount)
        }
      }
    }
    if (staticInputs.lockedMainId) {
      const symbol = ir.value(dsl.literal(staticInputs.lockedMainId).data)!
      bindings.set(TEAM_INPUT.mainId, symbol); bindings.set(TEAM_INPUT.echoIds, symbol)
    }
    return {
      scalar: specializeScalarProgram(ir.finish([ir.sum(this.totals), ...sheet.slice(0, 7).map((value, index) => constraints && (constraints[index * 2] ?? 1) <= (constraints[index * 2 + 1] ?? 0) ? value : ir.zero)]), bindings),
      displayScalar: specializeScalarProgram(ir.finish([ir.sum(this.totals), ...sheet, ...this.totals]), bindings),
      echoSymbols: Uint32Array.from(candidates, (echo) => ir.value(dsl.literal(echo.id).data)!),
      participantIds: team.runtimes.map((runtime) => runtime.id),
    }
  }
  private snapshot(): Snapshot { return { team: this.team.snapshot(), formula: new Map(this.formula) } }
  private restore(snapshot: Snapshot) { this.team.restore(snapshot.team); this.formula = snapshot.formula }
  private lane(id: string | undefined, fallback: number) {
    const lane = id ? this.team.runtimes.findIndex((runtime) => runtime.id === id) : fallback
    return lane >= 0 ? lane : fallback
  }
  private value(value: RotVl, lane: number, primaryActive = false): Scalar {
    const { team } = this
    const read = team.scope(lane)
    return typeof value === 'number' ? team.ir.constant(value) : team.dsl.formula(value, (from, path) => {
      // rotation values use the authored runtime scope, which has no derived
      // pool/final plane. uptime shares resolve activeRuntime to the context
      // resonator, as the detailed executor does.
      if (from === 'pool' || from === 'baseStats' || from === 'finalStats' || from === 'sourceFinalStats') return team.dsl.literal(undefined)
      if (primaryActive && from === 'activeRuntime') return team.runtime(team.sourceLane, path)
      if (primaryActive && from === 'context' && path.startsWith('activeRuntime.')) return team.runtime(team.sourceLane, path.slice(14))
      if (primaryActive && from === 'context' && path === 'activeResonatorId') return team.dsl.literal(team.runtimes[team.sourceLane]!.id)
      return read(from, path)
    }, true)
  }
  private repetitions(value: RotVl, lane: number): { expression: Scalar; maximum: number } {
    const { ir } = this.team
    const expression = ir.max(ir.zero, ir.operation(ScalarOp.floor, this.value(value, lane)))
    const maximum = ir.range(expression)[1]
    if (!Number.isFinite(maximum)) throw new Error('Rotation repetition count has no finite bound in the candidate space')
    return { expression, maximum }
  }
  private conditional(gate: Scalar, run: () => void) {
    const { ir } = this.team, known = ir.value(gate)
    if (known === 0) return
    if (known !== undefined) { run(); return }
    const parent = this.snapshot(), totals = [...this.totals], ordinals = new Map(this.ordinals)
    run()
    this.mergeConditional(parent, gate)
    for (let lane = 0; lane < totals.length; lane++) this.totals[lane] = ir.select(gate, this.totals[lane]!, totals[lane]!)
    for (const [key, value] of this.ordinals) this.ordinals.set(key, ir.select(gate, value, ordinals.get(key) ?? ir.zero))
  }
  walk(items: readonly RotationNode[], fallback: number, setupScale?: Scalar) {
    for (let index = 0; index < items.length; index++) {
      const node = items[index]!
      if (node.type === 'note' || node.enabled === false) continue
      const lane = this.lane('resonatorId' in node ? node.resonatorId : undefined, fallback)
      if (node.type === 'condition') { for (const change of node.changes) this.write(change, lane, setupScale); continue }
      if (node.type === 'feature') { this.feature(node, lane); continue }
      if (node.type === 'loop') {
        if (setupScale !== undefined || node.kind === 'end') continue
        index = this.loop(items, index, fallback)
        continue
      }
      const { ir } = this.team
      const count = node.type === 'repeat' ? this.repetitions(node.times, lane) : { expression: ir.one, maximum: 1 }
      const ratio = ir.clamp(node.type === 'repeat' && (!node.setup?.length || node.ratio === undefined) ? ir.one : this.value(node.ratio ?? 1, lane, true), 0, 1)
      if (setupScale !== undefined && node.type === 'uptime') {
        const formula = new Map(this.formula)
        this.conditional(ir.operation(ScalarOp.lt, ir.zero, ratio), () => {
          this.walkSetup(node.setup ?? [], lane, ir.mul(setupScale, ratio))
          this.walkSetup(node.items, lane, ir.mul(setupScale, ratio))
        })
        this.formula = formula
      } else if (node.setup?.length || node.type === 'uptime') {
        const parent = this.snapshot()
        this.walkSetup(node.setup ?? [], lane, ratio)
        const setup = this.snapshot()
        for (let run = 0; run < count.maximum; run++) this.conditional(ir.operation(ScalarOp.lt, ir.constant(run), count.expression), () => this.walk(node.items, lane))
        this.mergeBody(parent, setup)
      } else for (let run = 0; run < count.maximum; run++) this.conditional(ir.operation(ScalarOp.lt, ir.constant(run), count.expression), () => this.walk(node.items, lane))
    }
  }
  private walkSetup(items: readonly RotationNode[], lane: number, scale: Scalar) {
    const totals = [...this.totals]
    this.walk(items, lane, scale)
    // setup features advance authored state and occurrence identities. their
    // damage is discarded before the block body, as in the detailed executor.
    for (let index = 0; index < totals.length; index++) this.totals[index] = totals[index]!
  }
  /** the marker walker preserves overlapping and wrap-around loop calls. only
   * ordinary structured loops use pre-resolved pass bodies. */
  private loop(items: readonly RotationNode[], startIndex: number, fallback: number): number {
    const start = items[startIndex]
    if (start?.type !== 'loop' || start.kind !== 'start') return startIndex
    let plan = this.loopPlans.get(items)
    if (!plan) { plan = compileRotationPlan(items as RotationNode[]); this.loopPlans.set(items, plan) }
    const lowered = plan.root.loopsByIndex[startIndex]
    if (lowered) {
      for (const pass of lowered.passBlocks) this.walk(pass.items, fallback)
      return lowered.circular ? items.length - 1 : lowered.endIndex ?? startIndex
    }
    if (Object.keys(start.passForks ?? {}).length) {
      const { body, endIndex, circular } = extractLoopExecutionBody(items, startIndex)
      for (let pass = 1; pass <= Math.max(1, Math.floor(start.runs ?? 1)); pass++) this.walk(resolveLoopPassBody(body, start.passForks, pass), fallback)
      return circular ? items.length - 1 : endIndex ?? startIndex
    }
    interface Frame { start: number; cursor: number; id: string; run: number; runs: number; finished: Set<string> }
    const next = (index: number) => (index + 1) % items.length
    const frame = (index: number): Frame => {
      const node = items[index] as Extract<RotationNode, { type: 'loop'; kind: 'start' }>
      return { start: index, cursor: next(index), id: node.loopId, run: 1, runs: Math.max(1, Math.floor(node.runs ?? 1)), finished: new Set() }
    }
    const stack = [frame(startIndex)]
    let furthest = startIndex
    const close = () => {
      const current = stack.at(-1)!
      if (current.run < current.runs) { current.run++; current.cursor = next(current.start); current.finished.clear() }
      else { stack.pop(); stack.at(-1)?.finished.add(current.id) }
    }
    while (stack.length) {
      const current = stack.at(-1)!
      if (current.cursor === current.start) { close(); continue }
      furthest = Math.max(furthest, current.cursor)
      const node = items[current.cursor]!
      if (node.type === 'loop' && node.loopId === current.id) { close(); continue }
      if (node.type === 'note' || node.enabled === false) { current.cursor = next(current.cursor); continue }
      if (node.type !== 'loop') { this.walk([node], fallback); current.cursor = next(current.cursor); continue }
      if (node.kind === 'end' || current.finished.has(node.loopId)) { current.cursor = next(current.cursor); continue }
      if (stack.some((entry) => entry.id === node.loopId)) { close(); continue }
      const nestedIndex = current.cursor
      if (Object.keys(node.passForks ?? {}).length) {
        const resume = this.loop(items, nestedIndex, fallback)
        furthest = Math.max(furthest, resume)
        current.finished.add(node.loopId); current.cursor = next(Math.max(current.cursor, resume)); continue
      }
      const end = items.findIndex((item) => item.type === 'loop' && item.kind === 'end' && item.loopId === node.loopId)
      current.cursor = next(end > nestedIndex ? end : nestedIndex)
      stack.push(frame(nestedIndex))
    }
    return furthest
  }
  private mergeConditional(parent: Snapshot, gate: Scalar) {
    const { team } = this, child = this.snapshot(), { ir, dsl } = team
    this.restore(parent)
    child.team.writes.forEach((writes, lane) => { for (const [path, value] of writes) team.assign(lane, path, value, gate) })
    child.team.scales.forEach((scales, lane) => { for (const [path, value] of scales) team.state.scales[lane]!.set(path, ir.select(gate, value, team.state.scales[lane]!.get(path) ?? ir.one)) })
    child.team.routes.forEach((routes, lane) => { for (const [path, value] of routes) team.state.routes[lane]!.set(path, dsl.choose(gate, value, team.state.routes[lane]!.get(path) ?? dsl.literal(undefined))) })
    child.team.routeOverrides.forEach((routes, lane) => { for (const [path, value] of routes) team.state.routeOverrides[lane]!.set(path, ir.select(gate, value, team.state.routeOverrides[lane]!.get(path) ?? ir.zero)) })
    for (const [path, value] of child.team.enemyWrites) team.state.enemyWrites.set(path, dsl.choose(gate, value, team.state.enemyWrites.get(path) ?? dsl.literal(readPath(team.enemy, path))))
    team.state.active = ir.select(gate, child.team.active, team.state.active)
    team.state.activeSelected = ir.select(gate, child.team.activeSelected, team.state.activeSelected)
    for (const [key, value] of child.formula) this.formula.set(key, ir.select(gate, value, this.formula.get(key) ?? ir.zero))
    team.invalidate()
  }
  private mergeBody(parent: Snapshot, setup: Snapshot) {
    const { team } = this, body = this.snapshot(), { ir, dsl } = team
    const differs = (a: PortableValue, b: PortableValue) => ir.not(ir.and(ir.eq(a.kind, b.kind), ir.eq(a.data, b.data)))
    const setupValue = (lane: number, path: string) => { team.restore(setup.team); const value = team.runtime(lane, path); team.restore(parent.team); return value }
    this.restore(parent)
    body.team.writes.forEach((writes, lane) => { for (const [path, value] of writes) {
      const before = setupValue(lane, path)
      team.assign(lane, path, value, differs(value, before))
    } })
    body.team.scales.forEach((scales, lane) => { for (const [path, value] of scales) {
      const before = setup.team.scales[lane]!.get(path) ?? ir.one
      team.state.scales[lane]!.set(path, ir.select(ir.not(ir.eq(before, value)), value, parent.team.scales[lane]!.get(path) ?? ir.one))
    } })
    body.team.routes.forEach((routes, lane) => { for (const [path, value] of routes) {
      const before = setup.team.routes[lane]!.get(path) ?? dsl.literal(undefined)
      team.state.routes[lane]!.set(path, dsl.choose(differs(value, before), value, parent.team.routes[lane]!.get(path) ?? dsl.literal(undefined)))
    } })
    body.team.routeOverrides.forEach((routes, lane) => { for (const [path, value] of routes) {
      const bodyValue = body.team.routes[lane]!.get(path) ?? dsl.literal(undefined), setupValue = setup.team.routes[lane]!.get(path) ?? dsl.literal(undefined)
      const changed = ir.or(differs(bodyValue, setupValue), ir.not(ir.eq(value, setup.team.routeOverrides[lane]!.get(path) ?? ir.zero)))
      team.state.routeOverrides[lane]!.set(path, ir.select(changed, value, parent.team.routeOverrides[lane]!.get(path) ?? ir.zero))
    } })
    for (const [path, value] of body.team.enemyWrites) team.state.enemyWrites.set(path, dsl.choose(differs(value, setup.team.enemyWrites.get(path) ?? dsl.literal(undefined)), value, parent.team.enemyWrites.get(path) ?? dsl.literal(readPath(team.enemy, path))))
    team.state.active = ir.select(ir.not(ir.eq(body.team.active, setup.team.active)), body.team.active, parent.team.active)
    team.state.activeSelected = ir.select(ir.not(ir.eq(body.team.activeSelected, setup.team.activeSelected)), body.team.activeSelected, parent.team.activeSelected)
    for (const [key, value] of body.formula) this.formula.set(key, ir.select(ir.not(ir.eq(value, setup.formula.get(key) ?? ir.zero)), value, parent.formula.get(key) ?? ir.zero))
    team.invalidate()
  }
  /** runtime views resolve dynamic metadata through finite IR branches. */
  private runtimeViews(forced: ReadonlyMap<string, unknown>): ResRuntime[] {
    const { team } = this
    return team.runtimes.map((runtime, lane) => {
      const cache = new Map<string, object>()
      const view = (object: object, path: string): object => {
        const found = cache.get(path)
        if (found) return found
        const proxy = new Proxy(object, { get: (target, property, receiver) => {
          if (typeof property !== 'string' || property === 'toJSON') return Reflect.get(target, property, receiver)
          const childPath = path ? `${path}.${property}` : property
          const raw = Reflect.get(target, property, receiver)
          if (typeof raw === 'function') return raw
          if (raw && typeof raw === 'object') return view(raw, childPath)
          const key = `${lane}:${childPath}`
          if (forced.has(key)) return forced.get(key)
          const value = team.runtime(lane, childPath), kind = team.ir.value(value.kind), data = team.ir.value(value.data)
          if (kind === undefined || data === undefined) throw new RuntimeBranch(key, value)
          if (kind === 0) return undefined
          if (kind === 1) return data
          if (kind === 2) return data !== 0
          if (kind === 3) return value.raw ?? [...team.dsl.symbols].find(([, symbol]) => symbol === data)?.[0]
          return raw
        } })
        cache.set(path, proxy)
        return proxy
      }
      return view(runtime, '') as ResRuntime
    })
  }
  private runtimeComputation(compute: (runtimes: ResRuntime[], evaluate: EvaluateCondition) => Scalar): Scalar {
    const { team } = this, { ir, dsl } = team, forced = new Map<string, unknown>()
    const forcedConditions = new Map<Scalar, boolean>()
    const evaluate: EvaluateCondition = (condition, read, authored) => {
      if (!condition) return true
      const expression = dsl.condition(condition, read, authored), known = ir.value(expression)
      if (known !== undefined) return known !== 0
      if (forcedConditions.has(expression)) return forcedConditions.get(expression)!
      throw new ConditionBranch(condition, expression)
    }
    const visit = (): Scalar => {
      try { return compute(this.runtimeViews(forced), evaluate) } catch (error) {
        if (error instanceof ConditionBranch) {
          forcedConditions.set(error.expression, true); const yes = visit()
          forcedConditions.set(error.expression, false); const no = visit()
          forcedConditions.delete(error.expression)
          return ir.select(error.expression, yes, no)
        }
        if (!(error instanceof RuntimeBranch)) throw error
        let output = ir.zero
        const kinds = ir.possibleValues(error.value.kind), data = ir.possibleValues(error.value.data)
        for (const kind of kinds) for (const value of kind === 0 ? [0] : data) {
          const literal = kind === 0 ? undefined : kind === 1 ? value : kind === 2 ? value !== 0 : [...dsl.symbols].find(([, symbol]) => symbol === value)?.[0]
          const matches = ir.and(ir.eq(error.value.kind, ir.constant(kind)), kind === 0 ? ir.one : ir.eq(error.value.data, ir.constant(value)))
          forced.set(error.key, literal)
          output = ir.select(matches, visit(), output)
        }
        forced.delete(error.key)
        return output
      }
    }
    return visit()
  }
  private negativeEvaluator(evaluate: EvaluateCondition): NegativeSourceEvaluator {
    return (condition, source, target) => {
      const { team } = this, sourceLane = this.lane(source.id, team.sourceLane), targetLane = this.lane(target.id, team.sourceLane)
      const read = team.scope(sourceLane, targetLane)
      return evaluate(condition, (from, path) => {
        if (from === 'pool' || from === 'baseStats' || from === 'finalStats' || from === 'sourceFinalStats') return team.dsl.literal(undefined)
        if (from === 'activeRuntime') return team.runtime(targetLane, path)
        if (from === 'context' && path.startsWith('activeRuntime.')) return team.runtime(targetLane, path.slice(14))
        if (from === 'context' && path === 'activeResonatorId') return team.dsl.literal(target.id)
        return read(from, path)
      }, true)
    }
  }
  private write(change: RtChng, fallback: number, scale?: Scalar): AppliedWrite {
    const { team } = this, { ir, dsl } = team, lane = this.lane(change.resonatorId, fallback)
    const path = change.path.replace(/^runtime\./, '').replace(/^context\.(?=enemy\.)/, ''), formulaKey = getRotFormulaStatKey(path)
    const enemyPath = path.startsWith('enemy.') ? path.slice(6) : undefined
    const combatPath = enemyPath?.startsWith('combat.') ? `state.${enemyPath}` : undefined
    const unison = path === UNISON_BOON_TEAM_PATH
    const previous = formulaKey ? { kind: ir.one, data: this.formula.get(formulaKey) ?? ir.zero }
      : enemyPath && !combatPath ? team.state.enemyWrites.get(enemyPath) ?? dsl.literal(readPath(team.enemy, enemyPath))
        : team.runtime(combatPath ? team.sourceLane : lane, unison ? UNISON_BOON_RUNTIME_PATH : combatPath ?? path)
    let value = dsl.literal(change.type === 'toggle' ? change.value ?? true : change.value)
    const scaled = scale !== undefined, control = path.startsWith('state.controls.')
    const gate = scaled ? ir.operation(ScalarOp.lt, ir.zero, scale) : ir.one
    if (scaled && !control && typeof change.value === 'number') {
      const amount = ir.mul(ir.constant(change.value), scale)
      value = { kind: ir.one, data: change.type === 'add' ? amount : ir.add(dsl.number(previous), ir.mul(ir.sub(ir.constant(change.value), dsl.number(previous)), scale)) }
    }
    if (change.type === 'add') value = { kind: ir.one, data: ir.add(ir.select(ir.operation(ScalarOp.finite, dsl.number(previous)), dsl.number(previous), ir.zero), dsl.number(value)) }
    if (formulaKey) { this.formula.set(formulaKey, ir.select(gate, ir.select(ir.operation(ScalarOp.finite, dsl.number(value)), dsl.number(value), ir.zero), previous.data)); return { change, lane } }
    if (path === 'rotation.activeResonatorId') { team.setActive(this.lane(String(change.value), team.sourceLane), gate); return { change, lane } }
    // source-qualified route keys can target a different source lane from the condition node's current member.
    if (path.startsWith('routing.selectedTargetsByOwnerKey.')) {
      const scoped = splitScopedTargetOwnerKey(path.slice('routing.selectedTargetsByOwnerKey.'.length))
      const targetLane = scoped.sourceRuntimeId ? this.lane(scoped.sourceRuntimeId, lane) : lane
      const key = scoped.ownerKey
      const base = getScopedTargetSelection(team.participants[targetLane]!.slot.routing.selectedTargetsByOwnerKey, team.runtimes[targetLane]!.id, key)?.value
      const pinned = team.sources.some(row => row.lane === targetLane && row.effects.some(effect => effect.ownerKey === key && effect.targetScope === 'activeOther'))
      const routed = pinned ? dsl.choose(ir.eq(value.kind, ir.constant(3)), value, team.otherTargetFallback(targetLane)) : value
      team.state.routes[targetLane]!.set(key, dsl.choose(gate, routed, team.state.routes[targetLane]!.get(key) ?? dsl.literal(base)))
      team.state.routeOverrides[targetLane]!.set(key, ir.select(gate, ir.one, team.state.routeOverrides[targetLane]!.get(key) ?? ir.zero))
      team.invalidate(); return { change, lane }
    }
    const definition = enemyPath ? this.environment.enemyStateDefs[`enemy.${enemyPath}`] : this.environment.stateDefsByResonator[team.runtimes[lane]!.id]?.[`runtime.${path}`]
    if (definition?.kind === 'select' && typeof value.raw === 'string') {
      let raw = value.raw || definition.defaultValue
      const options = [...definition.options ?? [], ...(definition.optionsWhen ?? []).flatMap((entry) => entry.options)].map((option) => option.id)
      if (typeof raw === 'string' && raw.trim() !== '' && options.length && options.every((id) => id.trim() !== '' && Number.isFinite(Number(id))) && options.includes(raw)) raw = Number(raw)
      value = dsl.literal(raw ?? '')
    }
    if (ir.value(value.kind) === 1) {
      let number = value.data
      const min = unison || combatPath || enemyPath === 'status.tuneStrain' ? 0 : definition?.min ?? (definition?.kind === 'stack' ? 0 : undefined)
      let max = definition?.max === undefined ? undefined : ir.constant(definition.max)
      if (definition) for (const entry of [...definition.maxWhen ?? []].reverse()) max = ir.select(dsl.condition(entry.when, team.scope(lane, lane, definition.source), true), ir.constant(entry.max), max ?? ir.constant(Infinity))
      if (unison) max = this.runtimeComputation((runtimes) => ir.constant(unisonBoonMaxForRuntimes(runtimes)))
      if (enemyPath === 'status.tuneStrain') max = ir.constant(getTuneStrainMaxForTeam(team.runtimes[team.sourceLane], team.enemy))
      if (combatPath) {
        max = this.runtimeComputation((runtimes, evaluate) => {
          const runtime = runtimes[team.sourceLane]!
          const negative = getNegFfctEn(runtime, enemyPath!.slice(7) as typeof NEG_EFFECT_KEYS[number], Object.fromEntries(runtimes.map((rt) => [rt.id, rt])), this.negativeEvaluator(evaluate))
          return negative ? ir.constant(negative.max) : max ?? ir.constant(Infinity)
        })
      }
      if (min !== undefined) number = ir.max(ir.constant(min), number)
      if (max !== undefined) number = ir.min(max, number)
      value = { kind: ir.one, data: number }
    }
    const lanes = unison || combatPath ? team.runtimes.map((_, index) => index) : [lane]
    if (enemyPath && !combatPath) team.state.enemyWrites.set(enemyPath, dsl.choose(gate, value, previous))
    else for (const target of lanes) team.assign(target, unison ? UNISON_BOON_RUNTIME_PATH : combatPath ?? path, value, gate)
    if (scaled && (control || change.type === 'toggle' || (change.type === 'set' && typeof change.value !== 'number'))) team.state.scales[lane]!.set(path, ir.min(team.state.scales[lane]!.get(path) ?? ir.one, ir.select(gate, scale, ir.one)))
    team.invalidate()
    return { change, lane }
  }
  private feature(original: Extract<RotationNode, { type: 'feature' }>, fallback: number, parentMultiplier = 1, attachedWrites: AppliedWrite[] = [], attachment = false) {
    const { ir } = this.team
    const ordinal = this.ordinals.get(original.id) ?? ir.zero
    this.ordinals.set(original.id, ir.add(ordinal, ir.one))
    const known = ir.value(ordinal)
    if (known !== undefined && !this.featureKeys.has(`${original.id}|${known}`)) return
    let admitted = ir.one
    if (known === undefined) {
      admitted = ir.zero
      for (const key of this.featureKeys) if (key.startsWith(`${original.id}|`)) admitted = ir.or(admitted, ir.eq(ordinal, ir.constant(Number(key.slice(original.id.length + 1)))))
    }
    this.conditional(admitted, () => this.featureBody(original, fallback, parentMultiplier, attachedWrites, attachment, ordinal))
  }
  private featureBody(original: Extract<RotationNode, { type: 'feature' }>, fallback: number, parentMultiplier: number, attachedWrites: AppliedWrite[], attachment: boolean, ordinal: Scalar) {
    const node = attachment ? { ...original, attached: undefined, changes: undefined } : normalizeFeatureAttachments(original)
    const lane = this.lane(node.resonatorId, fallback), snapshot = node.attached ? this.snapshot() : undefined
    const writes = [...attachedWrites]
    for (const condition of node.attached?.conditions ?? []) if (condition.enabled !== false) for (const change of condition.changes) writes.push(this.write(change, this.lane(condition.resonatorId, lane)))
    const multiplier = parentMultiplier * (node.multiplier ?? 1)
    const ids = [lane, ...this.team.runtimes.map((_, index) => index).filter((index) => index !== lane)]
    for (const owner of ids) {
      const catalog = this.environment.catalogByResonator[this.team.runtimes[owner]!.id]
      const feature = catalog?.featuresById[node.featureId], skill = feature ? catalog.skillsById[feature.skillId] : undefined
      if (!feature || !skill) continue
      this.resolveAndScore(owner, feature, skill, node, multiplier, writes, ordinal)
      break
    }
    for (const child of node.attached?.features ?? []) if (child.enabled !== false) this.feature(child, lane, multiplier, writes, true)
    if (snapshot) this.restore(snapshot)
  }
  private resolveAndScore(lane: number, feature: FeatDef, raw: SkillDef, node: Extract<RotationNode, { type: 'feature' }>, multiplier: number, writes: AppliedWrite[], ordinal: Scalar) {
    const { team } = this, { ir, dsl } = team
    const score = this.runtimeComputation((runtimes, evaluate) => {
      const lookup = Object.fromEntries(runtimes.map((runtime) => [runtime.id, runtime]))
      const resolved = resolveSkill(runtimes[lane]!, raw, (condition) => evaluate(condition, team.scope(lane)), lookup, this.negativeEvaluator(evaluate))
      if (resolved.aggregationType !== 'damage') return ir.zero
      const skill = lowerSkill(team, lane, resolved, feature)
      const plane = this.applyFormula(lane, skill)
      const combat = Object.fromEntries(NEG_EFFECT_KEYS.map((key) => [key, dsl.number(team.runtime(lane, `state.combat.${key}`))]))
      const negative = getNegFfctCm(resolved.archetype)
      const attached = negative && writes.some((write) => (write.lane === lane && write.change.path.replace(/^runtime\./, '') === `state.combat.${negative}`) || write.change.path.replace(/^context\./, '') === `enemy.combat.${negative}`)
      const start = negative ? resolved.stackMode === 'fixedMax' ? ir.constant(resolved.stackMax ?? 0) : !attached && Number.isFinite(node.negativeEffectStacks) ? ir.constant(Math.max(0, Math.floor(node.negativeEffectStacks!))) : ir.max(ir.zero, ir.operation(ScalarOp.floor, combat[negative]!)) : ir.zero
      let damage = ir.zero
      const instances = negative && resolved.stackMode !== 'fixedMax' ? Math.max(1, Math.floor(node.negativeEffectInstances ?? 1)) : 1
      const width = Math.max(1, Math.floor(node.negativeEffectStableWidth ?? 1))
      for (let instance = 0; instance < instances; instance++) {
        const stacks = ir.sub(start, ir.constant(Math.floor(instance / width)))
        const value = lowerDamage(team, lane, skill, plane, negative ? { ...combat, [negative]: stacks } : combat, ir.constant(multiplier))
        let admitted = ir.one
        if (this.damageEventKeys) {
          admitted = ir.zero
          for (const key of this.damageEventKeys) {
            if (!key.startsWith(`${node.id}|`) || !key.endsWith(`|${instance}`)) continue
            const number = Number(key.slice(node.id.length + 1, key.lastIndexOf('|')))
            admitted = ir.or(admitted, ir.eq(ordinal, ir.constant(number)))
          }
        }
        if (negative && resolved.stackMode !== 'fixedMax') admitted = ir.and(admitted, ir.operation(ScalarOp.lt, ir.zero, stacks))
        damage = ir.add(damage, ir.select(admitted, value, ir.zero))
      }
      return resolved.visible === false ? ir.zero : damage
    })
    this.totals[lane] = ir.add(this.totals[lane]!, score)

  }
  // the build at rest, before any node runs: the same final cells Modulation's
  // sheet reads, with no skill layered in. limits and result rows both read it
  captureSheet(): void {
    const { team } = this
    team.sync()
    const plane = team.finals[team.sourceLane]!
    this.sheet = [finalCoreCell('atk', 'final'), finalCoreCell('hp', 'final'), finalCoreCell('def', 'final'), finalTopCell('critRate'),
      finalTopCell('critDmg'), finalTopCell('energyRegen'), finalTopCell('dmgBonus'), finalTopCell('amplify')].map((cell) => plane[cell]!)
  }
  private applyFormula(lane: number, skill: PortableSkill): Scalar[] {
    const { team } = this, { ir } = team
    team.sync()
    const plane = [...team.finals[lane]!], f = (key: RotFormulaStatKey) => this.formula.get(key) ?? ir.zero
    const add = (cell: number, value: Scalar) => { plane[cell] = ir.add(plane[cell]!, value) }
    for (const key of ['atk', 'hp', 'def'] as const) add(finalCoreCell(key, 'final'), ir.add(ir.mul(plane[finalCoreCell(key, 'base')]!, ir.div(f(`${key}Percent`), ir.constant(100))), f(`${key}Flat`)))
    for (const key of ['energyRegen', 'healingBonus', 'shieldBonus', 'dmgVuln', 'tuneBreakBoost', 'finalDmg', 'flatDmg'] as const) add(finalTopCell(key), f(key))
    add(finalTopCell('amplify'), f('dmgAmp')); add(finalAttributeCell('all', 'resShred'), f('resIgnore'))
    const negative = getNegFfctCm(skill.definition.archetype)
    if (skill.definition.archetype === 'skillDamage') for (const key of ['critRate', 'critDmg', 'dmgBonus'] as const) add(finalTopCell(key), f(key))
    else if (skill.definition.archetype === 'tuneRupture' || skill.definition.archetype === 'hack') add(finalSkillTypeCell(skill.definition.archetype, 'dmgBonus'), f('dmgBonus'))
    else if (negative) { add(finalTopCell('defShred'), f('defIgnore')); for (const key of new Set(skill.definition.skillType)) if (key !== 'all') add(finalSkillTypeCell(key, 'dmgBonus'), f('dmgBonus')) }
    if (!negative) add(finalTopCell('defIgnore'), f('defIgnore'))
    const scale = ir.add(ir.one, ir.div(f('mvScale'), ir.constant(100)))
    if (negative && skill.definition.fixedMv !== undefined) skill.scalars.fixedMv = ir.mul(ir.add(skill.scalars.fixedMv!, f('mvAdd')), scale)
    else if ((skill.definition.archetype === 'tuneRupture' || skill.definition.archetype === 'hack') && !skill.hits.length) skill.scalars.tuneRuptureScale = ir.mul(ir.add(ir.constant(skill.definition.tuneRuptureScale ?? 16), f('mvAdd')), scale)
    else {
      const ratio = ir.select(ir.operation(ScalarOp.lt, ir.zero, skill.multiplier), ir.div(ir.add(skill.multiplier, f('mvAdd')), skill.multiplier), ir.one)
      if (skill.hits.length) { skill.hits = skill.hits.map((hit) => ({ ...hit, multiplier: ir.mul(ir.mul(hit.multiplier, ratio), scale) })); skill.multiplier = ir.sum(skill.hits.map((hit) => ir.mul(hit.multiplier, ir.constant(hit.count)))) }
      else skill.multiplier = ir.mul(ir.select(ir.operation(ScalarOp.lt, ir.zero, skill.multiplier), ir.add(skill.multiplier, f('mvAdd')), skill.multiplier), scale)
    }
    skill.scalars.fixedDmg = ir.add(skill.scalars.fixedDmg!, f('fixedDmg'))
    if (negative && this.formula.has('fixedMv')) { skill.definition = { ...skill.definition, fixedMv: skill.definition.fixedMv ?? 0 }; skill.scalars.fixedMv = ir.add(skill.scalars.fixedMv!, f('fixedMv')) }
    const critPrefix = negative ? 'negativeEffect' : skill.definition.archetype === 'tuneRupture' ? 'tuneRupture' : undefined
    if (critPrefix) for (const key of ['Rate', 'Dmg'] as const) skill.scalars[`${critPrefix}Crit${key}`] = ir.add(skill.scalars[`${critPrefix}Crit${key}`]!, ir.div(f(`crit${key}`), ir.constant(100)))
    return plane
  }
}

function readPath(value: unknown, path: string): unknown {
  for (const key of path.split('.')) value = value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  return value
}

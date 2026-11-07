/*
  Author: Runor Ewhro
  description: lowers team state, source effects, and ordered runtime writes into
               immutable scalar expressions for candidate scoring.
*/
import type { CombatGraph } from '@/domain/entities/combatGraph'
import type { ResRuntime, EchoInstance } from '@/domain/entities/runtime'
import type { EnemyProfile } from '@/domain/entities/appState'
import { isNoEnemy } from '@/domain/entities/appState'
import type { DataSrcRef, EffectDef, EffectOp, EvalScpRoot, SourceState } from '@/domain/gameData/contracts'
import type { ManualBuffs } from '@/domain/entities/manualBuffs'
import { getScopedTargetSelection } from '@/domain/gameData/targetRouting'
import { activeOtherTargetGroups, effectTargetOwnerKey, type ActiveOtherTargetGroup } from '@/engine/effects/activeOtherTargets'
import { getGameData } from '@/data/gameData'
import { getResDtlsBy } from '@/data/gameData/resonators/resonatorDataStore'
import { listEffects } from '@/data/gameData/registry'
import { listStatesFor } from '@/data/catalog/gameDataService'
import { getEchoSetDe } from '@/data/gameData/echoSets/effects'
import { makeTeamComp } from '@/engine/gameData/teamComposition'
import { makeParticipantBasePool, countEchoSets, mkRtSttcBuff } from '@/engine/pipeline/buildCombatContext'
import { getWpnById } from '@/data/catalog/weaponCatalogService'
import { wpnAtkAt } from '@/engine/runtime/weaponState'
import { DIRECT_RUNTIME_POOL_CELL } from '@/engine/effects/numericTeam'
import { echoSetMax, echoSetPieceReq } from '@/engine/runtime/sourceStateInit'
import {
  NUMERIC_POOL_CELL_COUNT, NUMERIC_FINAL_CELL_COUNT, NUMERIC_BASE_KEYS, NUMERIC_TOP_STATS,
  POOL_ATTRIBUTE_OFFSET, FINAL_ATTRIBUTE_OFFSET, packBuffPool, poolBaseCell, poolFixedCell,
  poolTopCell, poolAttributeCell, poolSkillTypeCell, poolNegativeCell,
  finalCoreCell, finalTopCell, finalAttributeCell, finalSkillTypeCell, finalNegativeCell,
} from '../numericLayout'
import { ScalarBuilder, ScalarOp, type Scalar } from './ir'
import { PortableDsl, readObjectPath, type PortableValue, type ScopeReader } from './dsl'

import { TEAM_INPUT, ECHO_STAT_KEYS } from './layout'
export { TEAM_INPUT, ECHO_STAT_KEYS } from './layout'

const echoCells = [poolBaseCell('atk', 'percent'), poolBaseCell('atk', 'flat'), poolBaseCell('hp', 'percent'), poolBaseCell('hp', 'flat'), poolBaseCell('def', 'percent'), poolBaseCell('def', 'flat'), poolTopCell('critRate'), poolTopCell('critDmg'), poolTopCell('energyRegen'), poolTopCell('healingBonus'), poolSkillTypeCell('basicAtk', 'dmgBonus'), poolSkillTypeCell('heavyAtk', 'dmgBonus'), poolSkillTypeCell('resonanceSkill', 'dmgBonus'), poolSkillTypeCell('resonanceLiberation', 'dmgBonus'), poolAttributeCell('aero', 'dmgBonus'), poolAttributeCell('spectro', 'dmgBonus'), poolAttributeCell('fusion', 'dmgBonus'), poolAttributeCell('glacio', 'dmgBonus'), poolAttributeCell('havoc', 'dmgBonus'), poolAttributeCell('electro', 'dmgBonus')]

export interface PortableSource { lane: number; source: DataSrcRef; gate: Scalar; effects: EffectDef[]; states: SourceState[] }
export interface TeamSnapshot {
  writes: Map<string, PortableValue>[]
  scales: Map<string, Scalar>[]
  routes: Map<string, PortableValue>[]
  routeOverrides: Map<string, Scalar>[]
  basePools: Scalar[][]
  active: Scalar
  activeSelected: Scalar
  enemyWrites: Map<string, PortableValue>
}

export class PortableTeam {
  readonly ir = new ScalarBuilder()
  readonly dsl = new PortableDsl(this.ir)
  readonly participants: NonNullable<CombatGraph['participants'][keyof CombatGraph['participants']]>[]
  readonly runtimes: ResRuntime[]
  readonly sourceLane: number
  readonly sources: PortableSource[] = []
  readonly initialActive: Scalar
  state: TeamSnapshot
  sourceFinals: Scalar[][] = []
  preFinals: Scalar[][] = []
  finals: Scalar[][] = []
  immunities: Array<Array<{ gate: Scalar; scope: Extract<EffectOp, { type: 'add_immunity' }>['scope'] }>> = []
  private syncing = false
  private dirty = true
  private rotationTargets = false
  private currentPool: Scalar[] | undefined
  private readonly selfMainEchoGate: Scalar
  private readonly otherGroupsByPath = new Map<string, Array<ActiveOtherTargetGroup & { lane: number }>>()
  readonly graph: CombatGraph
  readonly enemy: EnemyProfile
  constructor(graph: CombatGraph, enemy: EnemyProfile, searchedId: string, candidates: readonly EchoInstance[], dynamicStats = false, selfMainEchoEffects: boolean | 'dynamic' = true) {
    this.graph = graph; this.enemy = enemy
    const { ir, dsl } = this
    this.selfMainEchoGate = selfMainEchoEffects === 'dynamic' ? ir.input(TEAM_INPUT.selfMainEchoEffects) : ir.constant(Number(selfMainEchoEffects))
    ir.inputRange(TEAM_INPUT.selfMainEchoEffects, 0, 1)
    ir.inputDomain(TEAM_INPUT.selfMainEchoEffects, [0, 1])
    for (let set = 0; set < 39; set++) { ir.inputRange(TEAM_INPUT.setCounts + set, 0, 5); ir.inputDomain(TEAM_INPUT.setCounts + set, [0, 1, 2, 3, 4, 5]) }
    for (let slot = 0; slot < 5; slot++) {
      ir.inputRange(TEAM_INPUT.echoIds + slot, 0, Number.MAX_SAFE_INTEGER)
      ir.inputRange(TEAM_INPUT.echoSets + slot, 0, 38)
      ir.inputRange(TEAM_INPUT.presence + slot, 0, 1)
      ir.inputDomain(TEAM_INPUT.presence + slot, [0, 1])
    }
    ir.inputRange(TEAM_INPUT.mainId, 0, Number.MAX_SAFE_INTEGER)
    ir.inputRange(TEAM_INPUT.mainPosition, 0, 0)
    ir.inputDomain(TEAM_INPUT.mainPosition, [0])
    for (let stat = 0; !dynamicStats && stat < 20; stat++) {
      const key = ECHO_STAT_KEYS[stat]!
      const values = candidates.map((echo) => Math.fround(Math.fround(Math.fround(echo.mainStats.primary.key === key ? echo.mainStats.primary.value : 0) + (echo.mainStats.secondary.key === key ? echo.mainStats.secondary.value : 0)) + (echo.substats[key] ?? 0)))
      const min = values.reduce((a, b) => Math.min(a, b), 0), max = values.reduce((a, b) => Math.max(a, b), 0)
      for (let slot = 0; slot < 5; slot++) { ir.inputRange(slot * 20 + stat, min, max); ir.inputDomain(slot * 20 + stat, [...new Set([0, ...values])]) }
      ir.inputRange(TEAM_INPUT.totals + stat, min * 5, max * 5)
      ir.lazyInputDomain(TEAM_INPUT.totals + stat, () => {
        let sums = new Set([0])
        const domain = [...new Set([0, ...values])]
        for (let slot = 0; slot < 5; slot++) {
          const next = new Set<number>()
          for (const sum of sums) for (const value of domain) next.add(sum + value)
          sums = next
        }
        return [...sums]
      })
    }
    this.participants = Object.values(graph.participants)
    this.runtimes = this.participants.map((part) => part.runtime)
    this.sourceLane = this.runtimes.findIndex((runtime) => runtime.id === searchedId)
    if (this.sourceLane < 0) throw new Error(`Missing search participant ${searchedId}`)
    this.initialActive = ir.constant(Math.max(0, this.participants.findIndex((part) => part.slotId === graph.activeSlotId)))
    this.state = {
      writes: this.runtimes.map(() => new Map()), scales: this.runtimes.map((runtime) => new Map(Object.entries(graph.effectScalesByRuntimePath?.[runtime.id] ?? {}).map(([path, scale]) => [path.replace(/^runtime\./, ''), ir.constant(scale)]))),
      routes: this.participants.map(() => new Map()), routeOverrides: this.participants.map(() => new Map()),
      basePools: this.participants.map((part, lane) => {
        const pool = lane === this.sourceLane ? mkRtSttcBuff(part.runtime) : makeParticipantBasePool(graph, part)
        const cells = Array.from(packBuffPool(pool), (value) => ir.constant(value))
        if (lane === this.sourceLane) for (let stat = 0; stat < 20; stat++) {
          const cell = echoCells[stat]!
          cells[cell] = ir.add(cells[cell]!, ir.input(TEAM_INPUT.totals + stat))
        }
        return cells
      }), active: this.initialActive, activeSelected: ir.zero, enemyWrites: new Map(),
    }
    for (let lane = 0; lane < this.runtimes.length; lane++) {
      const runtime = this.runtimes[lane]!
      const add = (source: DataSrcRef, gate: Scalar) => this.sources.push({ lane, source, gate, effects: listEffects(getGameData(), source), states: listStatesFor(source.type, source.id) })
      add({ type: 'resonator', id: runtime.id }, ir.one)
      const sets = lane === this.sourceLane ? [...new Set(candidates.map((echo) => echo.set))] : Object.keys(countEchoSets(runtime.build.echoes)).map(Number)
      for (const id of sets.sort((a, b) => a - b)) add({ type: 'echoSet', id: String(id) }, ir.operation(ScalarOp.lt, ir.zero, this.setCount(lane, id)))
      if (runtime.build.weapon.id) add({ type: 'weapon', id: runtime.build.weapon.id }, ir.one)
      // enemy effects have no team owner: apply one self-scoped row per
      // recipient, just as the numeric team executor does.
      if (!isNoEnemy(enemy)) add({ type: 'enemy', id: enemy.id }, ir.one)
      const mainIds = lane === this.sourceLane ? [...new Set(candidates.map((echo) => echo.id))] : [runtime.build.echoes.find((echo) => echo?.mainEcho)?.id ?? runtime.build.echoes[0]?.id].filter((id): id is string => !!id)
      for (const id of mainIds) add({ type: 'echo', id }, lane === this.sourceLane ? ir.eq(ir.input(TEAM_INPUT.mainId), dsl.literal(id).data) : ir.one)
    }
    for (let lane = 0; lane < this.runtimes.length; lane++) {
      const source: DataSrcRef = { type: 'teamEffect', id: 'unisonBoon' }
      this.sources.push({ lane, source, gate: ir.one, effects: listEffects(getGameData(), source), states: [] })
    }
    for (const row of this.sources) for (const group of activeOtherTargetGroups(row.effects)) {
      const original = getScopedTargetSelection(this.participants[row.lane]!.slot.routing.selectedTargetsByOwnerKey,
        this.runtimes[row.lane]!.id, group.ownerKey)?.value
      if (typeof original !== 'string') {
        this.state.routes[row.lane]!.set(group.ownerKey, this.otherTargetFallback(row.lane))
        this.state.routeOverrides[row.lane]!.set(group.ownerKey, ir.constant(2))
      }
      for (const path of group.paths) {
        const key = `${row.lane}:${path}`, entries = this.otherGroupsByPath.get(key) ?? []
        entries.push({ ...group, lane: row.lane }); this.otherGroupsByPath.set(key, entries)
      }
    }
    const symbols = [...new Set(candidates.map((echo) => ir.value(dsl.literal(echo.id).data)!))]
    const sets = [...new Set(candidates.map((echo) => echo.set))]
    ir.inputDomain(TEAM_INPUT.mainId, [0, ...symbols])
    for (let slot = 0; slot < 5; slot++) { ir.inputDomain(TEAM_INPUT.echoIds + slot, [0, ...symbols]); ir.inputDomain(TEAM_INPUT.echoSets + slot, [0, ...sets]) }
    const subject = this.participants[this.sourceLane]!
    const buffs = graph.environmentBuffsByMemberId?.[subject.memberId]
    if (buffs) this.applyManual(this.state.basePools[this.sourceLane]!, buffs)
    const modifiers = graph.environmentTargetModifiers
    if (modifiers) {
      const pool = this.state.basePools[this.sourceLane]!
      pool[poolTopCell('defShred')] = ir.add(pool[poolTopCell('defShred')]!, ir.constant(modifiers.defenseReduction))
      pool[poolTopCell('dmgVuln')] = ir.add(pool[poolTopCell('dmgVuln')]!, ir.constant(modifiers.damageTakenAmplification))
      for (const [attribute, value] of Object.entries(modifiers.resistanceReduction)) {
        const cell = poolAttributeCell(attribute as Parameters<typeof poolAttributeCell>[0], 'resShred')
        pool[cell] = ir.add(pool[cell]!, ir.constant(value))
      }
    }
  }
  private applyManual(pool: Scalar[], buffs: ManualBuffs) {
    const add = (cell: number, value: number) => { pool[cell] = this.ir.add(pool[cell]!, this.ir.constant(value)) }
    for (const stat of NUMERIC_BASE_KEYS) { add(poolBaseCell(stat, 'flat'), buffs.quick[stat].flat); add(poolBaseCell(stat, 'percent'), buffs.quick[stat].percent) }
    for (const stat of ['critRate', 'critDmg', 'energyRegen', 'healingBonus'] as const) add(poolTopCell(stat), buffs.quick[stat])
    for (const row of buffs.modifiers) {
      if (!row.enabled || !Number.isFinite(row.value) || row.value === 0) continue
      if (row.scope === 'baseStat') add(poolBaseCell(row.stat, row.field), row.value)
      else if (row.scope === 'topStat') add(poolTopCell(row.stat), row.value)
      else if (row.scope === 'attribute') add(poolAttributeCell(row.attribute, row.mod), row.value)
      else if (row.scope === 'skillType') add(poolSkillTypeCell(row.skillType, row.mod), row.value)
      else if (row.scope === 'negativeEffect') add(poolNegativeCell(row.negativeEffect, row.mod), row.value)
    }
  }
  initializeEchoControls(off: Readonly<Record<string, readonly string[]>> = {}, controls: Readonly<Record<string, boolean | number | string | undefined>> = {}) {
    const { ir, dsl } = this, lane = this.sourceLane
    for (const row of this.sources.filter((row) => row.lane === lane && row.source.type === 'echo')) this.initializeSource(row)
    for (const row of this.sources.filter((row) => row.lane === lane && row.source.type === 'echoSet')) this.initializeSource(row)
    for (const row of this.sources.filter((row) => row.lane === lane && row.source.type === 'echoSet')) {
      const def = getEchoSetDe(Number(row.source.id))
      if (!def) continue
      const gate = ir.operation(ScalarOp.le, ir.constant(echoSetPieceReq(def)), this.setCount(lane, def.id))
      for (const [key, state] of Object.entries(def.states)) this.assign(lane, `state.controls.echoSet:${def.id}:bonus:${key}`, dsl.literal(echoSetMax(state)), gate)
    }
    for (const [key, value] of Object.entries(controls)) {
      const match = /^echoSet:(\d+):bonus:/.exec(key)
      const def = match ? getEchoSetDe(Number(match[1])) : null
      const gate = def ? ir.operation(ScalarOp.le, ir.constant(echoSetPieceReq(def)), this.setCount(lane, def.id)) : ir.one
      this.state.writes[lane]!.set(`state.controls.${key}`, dsl.choose(gate, dsl.literal(value), dsl.literal(undefined)))
    }
    for (const [set, parts] of Object.entries(off)) for (const part of parts) this.state.writes[lane]!.set(`state.controls.echoSet:${set}:bonus:${part}`, dsl.literal(undefined))
    this.invalidate()
  }
  private initializeSource(row: PortableSource) {
    const { ir, dsl } = this, read = this.scope(row.lane, row.lane, row.source)
    for (const state of row.states) {
      let gate = ir.and(row.gate, ir.and(dsl.condition(state.visibleWhen, read, true), dsl.condition(state.enabledWhen, read, true)))
      for (const dependency of state.requires ?? state.controlDependencies ?? []) {
        const value = this.runtime(row.lane, `state.controls.${dependency}`)
        const fallback = dsl.literal(row.states.find((state) => state.controlKey === dependency)?.defaultValue)
        gate = ir.and(gate, dsl.truthy(dsl.choose(ir.eq(value.kind, ir.zero), fallback, value)))
      }
      const value = this.maximum(state, row.lane)
      this.assign(row.lane, state.path, value, gate)
      if (state.kind === 'toggle') for (const reset of state.resets ?? []) this.assign(row.lane, `state.controls.${reset}`, dsl.literal(false), ir.and(gate, dsl.truthy(value)))
    }
  }
  maximum(state: SourceState, lane: number): PortableValue {
    const { ir, dsl } = this, read = this.scope(lane, lane, state.source)
    if (state.kind === 'toggle') return dsl.literal(typeof state.maxValue === 'boolean' ? state.maxValue : true)
    if (state.kind === 'select') {
      const select = (options: NonNullable<SourceState['options']>) => state.maxValue !== undefined && options.some((option) => String(option.id) === String(state.maxValue)) ? state.maxValue : options.at(-1)?.id ?? state.defaultValue ?? ''
      let value = dsl.literal(select(state.options ?? []))
      for (const options of [...state.optionsWhen ?? []].reverse()) value = dsl.choose(dsl.condition(options.when, read, true), dsl.literal(select(options.options)), value)
      return value
    }
    let maximum = ir.constant(Number(state.max ?? state.maxValue ?? state.defaultValue ?? state.min ?? 0))
    for (const entry of [...state.maxWhen ?? []].reverse()) maximum = ir.select(dsl.condition(entry.when, read, true), ir.constant(entry.max), maximum)
    return { kind: ir.one, data: ir.max(ir.constant(state.min ?? 0), maximum) }
  }
  assign(lane: number, path: string, value: PortableValue, gate = this.ir.one) {
    path = path.replace(/^runtime\./, '')
    const groups = this.otherGroupsByPath.get(`${lane}:${path}`) ?? []
    const before = groups.map(group => this.dsl.condition(group.condition, this.scope(lane, lane)))
    const previous = this.runtime(lane, path)
    const next = this.dsl.choose(gate, value, previous)
    this.state.writes[lane]!.set(path, next)
    groups.forEach((group, position) => {
      const original = getScopedTargetSelection(this.participants[lane]!.slot.routing.selectedTargetsByOwnerKey,
        this.runtimes[lane]!.id, group.ownerKey)?.value
      if (!this.rotationTargets && typeof original === 'string') return
      const override = this.state.routeOverrides[lane]!.get(group.ownerKey) ?? this.ir.zero
      const activated = this.ir.and(gate, this.ir.and(this.ir.not(this.ir.eq(override, this.ir.one)),
        this.ir.and(this.ir.not(before[position]!), this.dsl.condition(group.condition, this.scope(lane, lane)))))
      this.state.routes[lane]!.set(group.ownerKey, this.dsl.choose(activated, this.otherTargetFallback(lane),
        this.state.routes[lane]!.get(group.ownerKey) ?? this.otherTargetFallback(lane)))
      this.state.routeOverrides[lane]!.set(group.ownerKey, this.ir.select(activated, this.ir.constant(2), override))
    })
    const cell = DIRECT_RUNTIME_POOL_CELL[path] ?? (path === 'state.combat.havocBane' ? poolTopCell('defShred') : undefined)
    if (cell !== undefined) this.state.basePools[lane]![cell] = this.ir.add(this.state.basePools[lane]![cell]!, this.ir.mul(this.ir.sub(this.dsl.number(next), this.dsl.number(previous)), this.ir.constant(path === 'state.combat.havocBane' ? 2 : 1)))
    this.invalidate()
  }
  snapshot(): TeamSnapshot {
    return { ...this.state, writes: this.state.writes.map((writes) => new Map(writes)), scales: this.state.scales.map((scales) => new Map(scales)), routes: this.state.routes.map((routes) => new Map(routes)), routeOverrides: this.state.routeOverrides.map((routes) => new Map(routes)), basePools: this.state.basePools.map((pool) => [...pool]), enemyWrites: new Map(this.state.enemyWrites) }
  }
  restore(snapshot: TeamSnapshot) { this.state = snapshot; this.dirty = true }
  invalidate() { this.dirty = true }
  /** start rotation routing after capturing the standing calculator sheet. */
  // standing scenario routes do not select authored-rotation recipients; initialize them from the rotation opening.
  beginRotationTargets(): void {
    this.rotationTargets = true
    this.resetOtherTargets(this.ir.one)
  }
  setActive(lane: number, gate: Scalar): void {
    const first = this.ir.and(gate, this.ir.not(this.state.activeSelected))
    this.state.active = this.ir.select(gate, this.ir.constant(lane), this.state.active)
    this.state.activeSelected = this.ir.or(this.state.activeSelected, gate)
    // initially enabled buffs belong to the rotation's first authored active
    // member. Later activations capture the active member independently.
    this.resetOtherTargets(first)
    this.invalidate()
  }
  private resetOtherTargets(gate: Scalar): void {
    const { ir, dsl } = this
    if (ir.value(gate) === 0) return
    for (const row of this.sources) for (const group of activeOtherTargetGroups(row.effects)) {
      const override = this.state.routeOverrides[row.lane]!.get(group.ownerKey) ?? ir.zero
      const reset = ir.and(gate, ir.not(ir.eq(override, ir.one)))
      const fallback = this.otherTargetFallback(row.lane)
      this.state.routes[row.lane]!.set(group.ownerKey, dsl.choose(reset, fallback,
        this.state.routes[row.lane]!.get(group.ownerKey) ?? fallback))
      this.state.routeOverrides[row.lane]!.set(group.ownerKey, ir.select(reset, ir.constant(2), override))
    }
    this.invalidate()
  }
  otherTargetFallback(source: number): PortableValue {
    let value = this.dsl.literal(this.runtimes.find((_, lane) => lane !== source)?.id)
    for (let lane = 0; lane < this.runtimes.length; lane++) if (lane !== source) {
      value = this.dsl.choose(this.ir.eq(this.state.active, this.ir.constant(lane)), this.dsl.literal(this.runtimes[lane]!.id), value)
    }
    return value
  }
  setCount(lane: number, set: number): Scalar {
    return lane === this.sourceLane ? this.ir.input(TEAM_INPUT.setCounts + set) : this.ir.constant(countEchoSets(this.runtimes[lane]!.build.echoes)[set] ?? 0)
  }
  runtime(lane: number, path: string): PortableValue {
    path = path.replace(/^runtime\./, '')
    const written = this.state.writes[lane]?.get(path)
    if (written) return written
    if (lane === this.sourceLane) {
      if (/^state\.controls\.(echo|echoSet):/.test(path)) return this.dsl.literal(undefined)
      const match = /^build\.echoes\.(\d+)\.(id|set)$/.exec(path)
      if (match) return { kind: this.ir.select(this.ir.input(TEAM_INPUT.presence + Number(match[1])), this.ir.constant(match[2] === 'id' ? 3 : 1), this.ir.zero), data: this.ir.input((match[2] === 'id' ? TEAM_INPUT.echoIds : TEAM_INPUT.echoSets) + Number(match[1])) }
    }
    return this.dsl.literal(readObjectPath(this.runtimes[lane], path))
  }
  private activeRead(path: string): PortableValue {
    let value = this.dsl.literal(undefined)
    for (let lane = this.runtimes.length - 1; lane >= 0; lane--) value = this.dsl.choose(this.ir.eq(this.state.active, this.ir.constant(lane)), this.runtime(lane, path), value)
    return value
  }
  scope(source: number, target = source, sourceRef: DataSrcRef = { type: 'resonator', id: this.runtimes[source]!.id }, sourceReady = true, finalReady = true): ScopeReader {
    return (from, path) => {
      const numeric = (data: Scalar): PortableValue => ({ kind: this.ir.one, data })
      if (from === 'sourceRuntime' || from === 'targetRuntime') return this.runtime(from === 'sourceRuntime' ? source : target, path)
      if (from === 'activeRuntime') return this.activeRead(path)
      if (from === 'pool') return numeric(this.currentPool?.[poolPathCell(path)] ?? this.ir.zero)
      if (from === 'baseStats') return this.dsl.literal(readObjectPath(this.participants[target]!.baseStats, path))
      if (from === 'sourceFinalStats' || from === 'finalStats') {
        if (!this.syncing) this.sync()
        const bank = from === 'sourceFinalStats' ? this.sourceFinals : this.preFinals
        const ready = from === 'sourceFinalStats' ? sourceReady : finalReady
        return ready ? numeric(bank[from === 'sourceFinalStats' ? source : target]?.[finalPathCell(path)] ?? this.ir.zero) : this.dsl.literal(undefined)
      }
      if (/^(sourceRuntime|targetRuntime|activeRuntime)\./.test(path)) {
        const separator = path.indexOf('.')
        return this.scope(source, target, sourceRef, sourceReady, finalReady)(path.slice(0, separator) as EvalScpRoot, path.slice(separator + 1))
      }
      if (path.startsWith('echoSetCounts.')) return numeric(this.setCount(source, Number(path.slice(14))))
      if (path.startsWith('enemy.')) return this.state.enemyWrites.get(path.slice(6)) ?? this.dsl.literal(readObjectPath(this.enemy, path.slice(6)))
      if (path === 'activeResonatorId') {
        let id = this.dsl.literal(undefined)
        for (let lane = 0; lane < this.runtimes.length; lane++) id = this.dsl.choose(this.ir.eq(this.state.active, this.ir.constant(lane)), this.dsl.literal(this.runtimes[lane]!.id), id)
        return id
      }
      const ids = this.runtimes.map((runtime) => runtime.id)
      const details = getResDtlsBy()
      return this.dsl.literal(readObjectPath({ source: { ...sourceRef, negativeEffectSources: sourceRef.type === 'resonator' ? details[sourceRef.id]?.negativeEffectSources : undefined }, target: { type: 'resonator', id: this.runtimes[target]!.id, negativeEffectSources: sourceRef.type === 'teamEffect' ? undefined : details[this.runtimes[target]!.id]?.negativeEffectSources }, targetRuntimeId: ids[target], teamMemberIds: ids, team: makeTeamComp(ids) }, path))
    }
  }
  scaleReader(source: number, target: number) {
    return (from: EvalScpRoot, path: string): Scalar => {
      if (from === 'context' && /^(sourceRuntime|targetRuntime|activeRuntime)\./.test(path)) {
        const split = path.indexOf('.')
        return this.scaleReader(source, target)(path.slice(0, split) as EvalScpRoot, path.slice(split + 1))
      }
      if (from === 'sourceRuntime' || from === 'targetRuntime') return this.state.scales[from === 'sourceRuntime' ? source : target]!.get(path) ?? this.ir.one
      if (from === 'activeRuntime') return this.runtimes.reduce((value, _, lane) => this.ir.select(this.ir.eq(this.state.active, this.ir.constant(lane)), this.state.scales[lane]!.get(path) ?? this.ir.one, value), this.ir.one)
      return this.ir.one
    }
  }
  sourceGate(row: PortableSource, effect: EffectDef, target: number): Scalar {
    const { ir, dsl } = this, scope = effect.targetScope ?? 'self'
    if (scope === 'self') return row.lane === target ? row.gate : ir.zero
    if (scope === 'teamWide') return row.gate
    if (scope === 'otherTeammates') return row.lane !== target ? row.gate : ir.zero
    if (scope === 'activeOther' && row.lane === target) return ir.zero
    const owner = effectTargetOwnerKey(effect)
    const original = getScopedTargetSelection(this.participants[row.lane]!.slot.routing.selectedTargetsByOwnerKey, this.runtimes[row.lane]!.id, owner)?.value
    const explicit = this.state.routeOverrides[row.lane]!.get(owner) ?? ir.zero
    const routing = dsl.choose(explicit, this.state.routes[row.lane]!.get(owner) ?? dsl.literal(original), dsl.literal(original))
    const rotationActive = ir.and(ir.not(ir.eq(this.state.active, this.initialActive)), ir.not(explicit))
    let fallback = this.state.active
    if (scope === 'activeOther') fallback = ir.select(ir.eq(fallback, ir.constant(row.lane)), ir.constant(row.lane === 0 && this.runtimes.length > 1 ? 1 : 0), fallback)
    const routedTarget = ir.select(ir.eq(routing.kind, ir.constant(3)), ir.eq(routing.data, dsl.literal(this.runtimes[target]!.id).data), ir.eq(fallback, ir.constant(target)))
    if (scope === 'activeOther') return ir.and(row.gate, routedTarget)
    return ir.and(row.gate, ir.select(rotationActive, ir.eq(this.state.active, ir.constant(target)), routedTarget))
  }
  effectAmount(row: PortableSource, effect: EffectDef, target: number, operation: Extract<EffectOp, { value: unknown }>, sourceReady = true, finalReady = true): Scalar {
    const read = this.scope(row.lane, target, row.source, sourceReady, finalReady)
    const scaleReader = this.scaleReader(row.lane, target)
    const scale = this.ir.min(this.dsl.scale(effect.condition, read, scaleReader), this.dsl.formulaScale(operation.value, scaleReader))
    return this.ir.mul(this.dsl.formula(operation.value, read), scale)
  }
  effectGate(row: PortableSource, effect: EffectDef, target: number, sourceReady = true, finalReady = true): Scalar {
    return this.ir.and(this.sourceGate(row, effect, target), this.dsl.condition(effect.condition, this.scope(row.lane, target, row.source, sourceReady, finalReady)))
  }
  sync(): void {
    if (!this.dirty || this.syncing) return
    this.syncing = true
    this.dirty = false
    this.sourceFinals = this.runtimes.map(() => Array(NUMERIC_FINAL_CELL_COUNT).fill(this.ir.zero))
    this.preFinals = this.runtimes.map(() => Array(NUMERIC_FINAL_CELL_COUNT).fill(this.ir.zero))
    this.immunities = this.runtimes.map(() => [])
    for (let lane = 0; lane < this.runtimes.length; lane++) {
      const pool = [...this.state.basePools[lane]!]
      this.stage(lane, pool, 'preStats', false)
      this.sourceFinals[lane] = this.derive(lane, pool)
    }
    this.finals = this.runtimes.map((_, lane) => {
      this.immunities[lane] = []
      const pool = [...this.state.basePools[lane]!]
      this.stage(lane, pool, 'preStats', true)
      this.preFinals[lane] = this.derive(lane, pool)
      this.stage(lane, pool, 'postStats', true)
      this.preFinals[lane] = this.derive(lane, pool)
      this.stage(lane, pool, 'finalStats', true)
      return this.derive(lane, pool)
    })
    this.currentPool = undefined
    this.syncing = false
  }
  private stage(lane: number, pool: Scalar[], stage: EffectDef['stage'], ready: boolean) {
    const { ir } = this
    this.currentPool = pool
    for (const row of this.sources) for (const effect of row.effects) {
      if (effect.trigger !== 'runtime' || (effect.stage ?? 'preStats') !== stage) continue
      let gate = this.effectGate(row, effect, lane, ready, stage !== 'preStats')
      if (this.selfMainEchoGate !== ir.one && lane === this.sourceLane && row.lane === this.sourceLane && row.source.type === 'echo') gate = ir.and(gate, this.selfMainEchoGate)
      if (ir.value(gate) === 0) continue
      for (const operation of effect.operations) {
        if (operation.type === 'add_immunity') { this.immunities[lane]!.push({ gate, scope: operation.scope }); continue }
        if (!('value' in operation)) continue
        const value = this.effectAmount(row, effect, lane, operation, ready, stage !== 'preStats')
        for (const cell of operationCells(operation)) pool[cell] = ir.select(gate, operation.type === 'set_final_stat' ? value : ir.add(pool[cell]!, value), pool[cell]!)
      }
    }
  }
  private derive(lane: number, pool: Scalar[]): Scalar[] {
    const { ir } = this, base = this.participants[lane]!.baseStats, runtime = this.runtimes[lane]!
    const weapon = runtime.build.weapon.id ? getWpnById(runtime.build.weapon.id) : null
    const weaponAttack = weapon ? wpnAtkAt(runtime.build.weapon.id, runtime.build.weapon.level) : 0
    const out = Array<Scalar>(NUMERIC_FINAL_CELL_COUNT).fill(ir.zero)
    for (const stat of NUMERIC_BASE_KEYS) {
      const intrinsic = ir.constant(base[stat] + (stat === 'atk' ? weaponAttack : 0))
      out[finalCoreCell(stat, 'base')] = intrinsic
      const fixed = pool[poolFixedCell(stat)]!
      const computed = ir.add(ir.mul(intrinsic, ir.add(ir.one, ir.div(pool[poolBaseCell(stat, 'percent')]!, ir.constant(100)))), pool[poolBaseCell(stat, 'flat')]!)
      out[finalCoreCell(stat, 'final')] = ir.select(ir.operation(ScalarOp.nan, fixed), computed, fixed)
    }
    for (const stat of NUMERIC_TOP_STATS) {
      const extra = stat === 'critRate' ? base.critRate : stat === 'critDmg' ? base.critDmg : stat === 'energyRegen' ? base.energyRegen : stat === 'healingBonus' ? base.healingBonus : stat === 'offTuneBuildupRate' ? 1 : stat === 'tuneBreakBoost' ? base.tuneBreakBoost : 0
      out[finalTopCell(stat)] = ir.add(pool[poolTopCell(stat)]!, ir.constant(extra))
    }
    for (let cell = POOL_ATTRIBUTE_OFFSET; cell < NUMERIC_POOL_CELL_COUNT; cell++) out[FINAL_ATTRIBUTE_OFFSET + cell - POOL_ATTRIBUTE_OFFSET] = pool[cell]!
    return out
  }
}

export function poolPathCell(path: string): number {
  const keys = path.split('.')
  if (keys[0] === 'atk' || keys[0] === 'hp' || keys[0] === 'def') return poolBaseCell(keys[0], keys[1] as 'percent' | 'flat')
  if (keys[0] === 'fixedStats') return poolFixedCell(keys[1] as Parameters<typeof poolFixedCell>[0])
  if (keys[0] === 'attribute') return poolAttributeCell(keys[1] as Parameters<typeof poolAttributeCell>[0], keys[2] as Parameters<typeof poolAttributeCell>[1])
  if (keys[0] === 'skillType') return poolSkillTypeCell(keys[1] as Parameters<typeof poolSkillTypeCell>[0], keys[2] as Parameters<typeof poolSkillTypeCell>[1])
  if (keys[0] === 'negativeEffect') return poolNegativeCell(keys[1] as Parameters<typeof poolNegativeCell>[0], keys[2] as Parameters<typeof poolNegativeCell>[1])
  if (!NUMERIC_TOP_STATS.includes(keys[0] as typeof NUMERIC_TOP_STATS[number])) throw new Error(`Unknown portable pool path ${path}`)
  return poolTopCell(keys[0] as typeof NUMERIC_TOP_STATS[number])
}
export function finalPathCell(path: string): number {
  const keys = path.split('.')
  if (keys[0] === 'atk' || keys[0] === 'hp' || keys[0] === 'def') return finalCoreCell(keys[0], keys[1] as 'base' | 'final')
  if (keys[0] === 'attribute') return finalAttributeCell(keys[1] as Parameters<typeof finalAttributeCell>[0], keys[2] as Parameters<typeof finalAttributeCell>[1])
  if (keys[0] === 'skillType') return finalSkillTypeCell(keys[1] as Parameters<typeof finalSkillTypeCell>[0], keys[2] as Parameters<typeof finalSkillTypeCell>[1])
  if (keys[0] === 'negativeEffect') return finalNegativeCell(keys[1] as Parameters<typeof finalNegativeCell>[0], keys[2] as Parameters<typeof finalNegativeCell>[1])
  return finalTopCell((keys[0] === 'tbb' ? 'tuneBreakBoost' : keys[0]) as typeof NUMERIC_TOP_STATS[number])
}
function operationCells(operation: EffectOp): number[] {
  if (operation.type === 'add_base_stat') return [poolBaseCell(operation.stat, operation.field)]
  if (operation.type === 'set_final_stat') return [poolFixedCell(operation.stat)]
  if (operation.type === 'add_top_stat') return [poolTopCell(operation.stat)]
  if (operation.type === 'add_attribute_mod') return [operation.attribute].flat().map((key) => poolAttributeCell(key, operation.mod))
  if (operation.type === 'add_skilltype_mod') return [operation.skillType].flat().map((key) => poolSkillTypeCell(key, operation.mod))
  if (operation.type === 'add_negative_effect_mod') return [operation.negativeEffect].flat().map((key) => poolNegativeCell(key, operation.mod))
  return []
}

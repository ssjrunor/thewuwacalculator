/*
  Author: Runor Ewhro
  description: defines the scalar search IR shared by CPU execution and native
               GPU lowering.
*/

export const ScalarOp = {
  constant: 0, input: 1, add: 2, sub: 3, mul: 4, div: 5,
  min: 6, max: 7, floor: 8, ceil: 9, round: 10, abs: 11,
  eq: 12, ne: 13, lt: 14, le: 15, select: 16, pow: 17,
  finite: 18, nan: 19,
} as const
export type ScalarOpcode = typeof ScalarOp[keyof typeof ScalarOp]
export type Scalar = number
interface Node { op: ScalarOpcode; a: number; b: number; c: number; value: number }

export interface ScalarProgram {
  /** five words per instruction: opcode, destination, a, b, c/value bits. */
  instructions: Uint32Array
  constants: Float64Array
  outputs: Uint32Array
  registers: number
  inputCount: number
}

function calculate(op: ScalarOpcode, a: number, b: number, c: number): number {
  switch (op) {
    case ScalarOp.add: return a + b
    case ScalarOp.sub: return a - b
    case ScalarOp.mul: return a * b
    case ScalarOp.div: return a / b
    case ScalarOp.min: return Math.min(a, b)
    case ScalarOp.max: return Math.max(a, b)
    case ScalarOp.floor: return Math.floor(a)
    case ScalarOp.ceil: return Math.ceil(a)
    case ScalarOp.round: return Math.round(a)
    case ScalarOp.abs: return Math.abs(a)
    case ScalarOp.eq: return Object.is(a, b) ? 1 : 0
    case ScalarOp.ne: return Object.is(a, b) ? 0 : 1
    case ScalarOp.lt: return a < b ? 1 : 0
    case ScalarOp.le: return a <= b ? 1 : 0
    case ScalarOp.select: return a !== 0 ? b : c
    case ScalarOp.pow: return a ** b
    case ScalarOp.finite: return Number.isFinite(a) ? 1 : 0
    case ScalarOp.nan: return Number.isNaN(a) ? 1 : 0
    default: throw new Error(`Invalid scalar arithmetic opcode ${op}`)
  }
}

/** immutable expression identities allow common-subexpression elimination and
 * constant folding while the compiler walks ordered mutable rotation state. */
export class ScalarBuilder {
  private readonly nodes: Node[] = []
  // value identities: constants (Map keys are SameValueZero, which separates -0), inputs by index, and operations in an
  // open-addressed table of node ids compared on (op, a, b, c); numbering matches keying each node by text
  private readonly constantIds = new Map<number, Scalar>()
  private negativeZero: Scalar | undefined
  private readonly inputIds = new Map<number, Scalar>()
  private operationIds = new Int32Array(1 << 12).fill(-1)
  private operationCount = 0
  private inputs = 0
  private readonly inputRanges = new Map<number, readonly [number, number]>()
  private readonly inputDomains = new Map<number, readonly number[]>()
  private readonly lazyInputDomains = new Map<number, () => readonly number[]>()
  private readonly domains = new Map<Scalar, readonly number[]>()
  readonly zero: Scalar
  readonly one: Scalar
  constructor() { this.zero = this.constant(0); this.one = this.constant(1) }
  constant(value: number): Scalar {
    if (Object.is(value, -0)) return this.negativeZero ??= this.append({ op: ScalarOp.constant, a: -1, b: -1, c: -1, value })
    const found = this.constantIds.get(value)
    if (found !== undefined) return found
    const id = this.append({ op: ScalarOp.constant, a: -1, b: -1, c: -1, value })
    this.constantIds.set(value, id)
    return id
  }
  input(index: number): Scalar {
    this.inputs = Math.max(this.inputs, index + 1)
    const found = this.inputIds.get(index)
    if (found !== undefined) return found
    const id = this.append({ op: ScalarOp.input, a: index, b: -1, c: -1, value: 0 })
    this.inputIds.set(index, id)
    return id
  }
  value(id: Scalar): number | undefined { return this.nodes[id]?.op === ScalarOp.constant ? this.nodes[id]!.value : undefined }
  inputRange(index: number, min: number, max: number) { this.inputRanges.set(index, [min, max]) }
  inputDomain(index: number, values: readonly number[]) { this.inputDomains.set(index, values); this.domains.clear() }
  lazyInputDomain(index: number, values: () => readonly number[]) { this.lazyInputDomains.set(index, values) }
  possibleValues(id: Scalar): readonly number[] {
    const known = this.domains.get(id)
    if (known) return known
    const node = this.nodes[id]!
    let values: readonly number[]
    if (node.op === ScalarOp.constant) values = [node.value]
    else if (node.op === ScalarOp.input) {
      let domain = this.inputDomains.get(node.a)
      if (!domain && this.lazyInputDomains.has(node.a)) { domain = this.lazyInputDomains.get(node.a)!(); this.inputDomains.set(node.a, domain) }
      if (!domain) throw new Error(`Missing finite domain for rotation input ${node.a}`)
      values = domain
    } else {
      const result = new Map<string, number>()
      const a = this.possibleValues(node.a), b = this.possibleValues(node.b), c = this.possibleValues(node.c)
      for (const av of a) for (const bv of b) for (const cv of c) {
        const value = calculate(node.op, av, bv, cv)
        result.set(Object.is(value, -0) ? '-0' : String(value), value)
      }
      values = [...result.values()]
    }
    this.domains.set(id, values)
    return values
  }
  /** conservative bounds are used to lower finite dynamic repetition counts.
   * there is no guessed iteration limit or candidate truncation. */
  range(id: Scalar): readonly [number, number] {
    const ranges: Array<readonly [number, number]> = []
    for (let index = 0; index <= id; index++) {
      const node = this.nodes[index]!
      if (node.op === ScalarOp.constant) { ranges.push([node.value, node.value]); continue }
      if (node.op === ScalarOp.input) { ranges.push(this.inputRanges.get(node.a) ?? [-Infinity, Infinity]); continue }
      const a = ranges[node.a]!, b = ranges[node.b]!, c = ranges[node.c]!
      let range: readonly [number, number] = [-Infinity, Infinity]
      switch (node.op) {
        case ScalarOp.add: range = [a[0] + b[0], a[1] + b[1]]; break
        case ScalarOp.sub: range = [a[0] - b[1], a[1] - b[0]]; break
        case ScalarOp.mul: { const values = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]]; range = [Math.min(...values), Math.max(...values)]; break }
        case ScalarOp.div: if (b[0] > 0 || b[1] < 0) { const values = [a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]]; range = [Math.min(...values), Math.max(...values)] }; break
        case ScalarOp.min: range = [Math.min(a[0], b[0]), Math.min(a[1], b[1])]; break
        case ScalarOp.max: range = [Math.max(a[0], b[0]), Math.max(a[1], b[1])]; break
        case ScalarOp.select: range = [Math.min(b[0], c[0]), Math.max(b[1], c[1])]; break
        case ScalarOp.floor: range = [Math.floor(a[0]), Math.floor(a[1])]; break
        case ScalarOp.ceil: range = [Math.ceil(a[0]), Math.ceil(a[1])]; break
        case ScalarOp.round: range = [Math.round(a[0]), Math.round(a[1])]; break
        case ScalarOp.abs: range = [a[0] <= 0 && a[1] >= 0 ? 0 : Math.min(Math.abs(a[0]), Math.abs(a[1])), Math.max(Math.abs(a[0]), Math.abs(a[1]))]; break
        case ScalarOp.eq: case ScalarOp.ne: case ScalarOp.lt: case ScalarOp.le: case ScalarOp.finite: case ScalarOp.nan: range = [0, 1]; break
      }
      ranges.push(range)
    }
    return ranges[id]!
  }
  operation(op: ScalarOpcode, a: Scalar, b = this.zero, c = this.zero): Scalar {
    const av = this.value(a), bv = this.value(b), cv = this.value(c)
    if (av !== undefined && bv !== undefined && cv !== undefined) return this.constant(calculate(op, av, bv, cv))
    if (op === ScalarOp.mul) { if (av === 1) return b; if (bv === 1) return a }
    if (op === ScalarOp.div && bv === 1) return a
    if (op === ScalarOp.sub && Object.is(bv, 0)) return a
    if ((op === ScalarOp.min || op === ScalarOp.max) && a === b) return a
    if (a === b && op === ScalarOp.eq) return this.one
    if (a === b && (op === ScalarOp.ne || op === ScalarOp.lt)) return this.zero
    if (op === ScalarOp.select) {
      if (av !== undefined) return av !== 0 ? b : c
      if (b === c) return b
    }
    return this.internOperation(op, a, b, c)
  }
  add(a: Scalar, b: Scalar) { return this.operation(ScalarOp.add, a, b) }
  sub(a: Scalar, b: Scalar) { return this.operation(ScalarOp.sub, a, b) }
  mul(a: Scalar, b: Scalar) { return this.operation(ScalarOp.mul, a, b) }
  div(a: Scalar, b: Scalar) { return this.operation(ScalarOp.div, a, b) }
  min(a: Scalar, b: Scalar) { return this.operation(ScalarOp.min, a, b) }
  max(a: Scalar, b: Scalar) { return this.operation(ScalarOp.max, a, b) }
  eq(a: Scalar, b: Scalar) { return this.operation(ScalarOp.eq, a, b) }
  not(a: Scalar) { return this.eq(a, this.zero) }
  and(a: Scalar, b: Scalar) { return this.select(a, b, this.zero) }
  or(a: Scalar, b: Scalar) { return this.select(a, this.one, b) }
  select(condition: Scalar, yes: Scalar, no: Scalar) { return this.operation(ScalarOp.select, condition, yes, no) }
  clamp(value: Scalar, min: number, max: number) { return this.min(this.constant(max), this.max(this.constant(min), value)) }
  sum(values: readonly Scalar[]) { return values.filter((value) => this.value(value) !== 0).reduce((a, b) => this.add(a, b), this.zero) }
  product(values: readonly Scalar[]) { return values.reduce((a, b) => this.mul(a, b), this.one) }
  table(index: Scalar, values: readonly number[]): Scalar {
    const integer = this.operation(ScalarOp.floor, index)
    let value = this.zero
    for (let i = values.length - 1; i >= 0; i--) value = this.select(this.eq(integer, this.constant(i)), this.constant(values[i]!), value)
    return value
  }
  private append(node: Node): Scalar {
    const id = this.nodes.length
    this.nodes.push(node)
    return id
  }
  private slotOf(table: Int32Array, op: number, a: number, b: number, c: number): number {
    let hash = Math.imul(op + 0x9e3779b9, 0x85ebca6b)
    hash = Math.imul(hash ^ a, 0xc2b2ae35)
    hash = Math.imul(hash ^ b, 0x27d4eb2f)
    hash = Math.imul(hash ^ c, 0x165667b1)
    hash ^= hash >>> 15
    const mask = table.length - 1
    let slot = hash & mask
    for (;;) {
      const id = table[slot]!
      if (id < 0) return slot
      const node = this.nodes[id]!
      if (node.op === op && node.a === a && node.b === b && node.c === c) return slot
      slot = (slot + 1) & mask
    }
  }
  private internOperation(op: ScalarOpcode, a: Scalar, b: Scalar, c: Scalar): Scalar {
    const slot = this.slotOf(this.operationIds, op, a, b, c)
    const found = this.operationIds[slot]!
    if (found >= 0) return found
    const id = this.append({ op, a, b, c, value: 0 })
    this.operationIds[slot] = id
    if (++this.operationCount * 2 > this.operationIds.length) {
      const grown = new Int32Array(this.operationIds.length * 2).fill(-1)
      for (const entry of this.operationIds) {
        if (entry < 0) continue
        const node = this.nodes[entry]!
        grown[this.slotOf(grown, node.op, node.a, node.b, node.c)] = entry
      }
      this.operationIds = grown
    }
    return id
  }
  finish(outputs: readonly Scalar[]): ScalarProgram {
    const live = new Uint8Array(this.nodes.length)
    const pending = [...outputs]
    while (pending.length) {
      const id = pending.pop()!
      if (live[id]) continue
      live[id] = 1
      const node = this.nodes[id]!
      if (node.op !== ScalarOp.constant && node.op !== ScalarOp.input) {
        pending.push(node.a, node.b, node.c)
      }
    }
    const uses = new Uint32Array(this.nodes.length)
    for (let id = 0; id < this.nodes.length; id++) {
      const node = this.nodes[id]!
      if (live[id] && node.op !== ScalarOp.constant && node.op !== ScalarOp.input) {
        uses[node.a]++; uses[node.b]++; uses[node.c]++
      }
    }
    outputs.forEach((id) => uses[id]++)
    const slots = new Int32Array(this.nodes.length).fill(-1)
    const free: number[] = [], words: number[] = [], constants: number[] = []
    let registers = 0
    for (let id = 0; id < this.nodes.length; id++) {
      if (!live[id]) continue
      const node = this.nodes[id]!
      const destination = free.pop() ?? registers++
      slots[id] = destination
      if (node.op === ScalarOp.constant) {
        words.push(node.op, destination, constants.length, 0, 0)
        constants.push(node.value)
      } else if (node.op === ScalarOp.input) words.push(node.op, destination, node.a, 0, 0)
      else {
        words.push(node.op, destination, slots[node.a]!, slots[node.b]!, slots[node.c]!)
        for (const input of [node.a, node.b, node.c]) if (--uses[input] === 0) free.push(slots[input]!)
      }
    }
    return { instructions: Uint32Array.from(words), constants: Float64Array.from(constants), outputs: Uint32Array.from(outputs, (id) => slots[id]!), registers, inputCount: this.inputs }
  }
}

/** the CPU backend executes the same instruction stream as the GPU. */
export function executeScalarProgram(program: ScalarProgram, inputs: ArrayLike<number>, scratch: Float64Array = new Float64Array(program.registers), output: Float64Array = new Float64Array(program.outputs.length)): Float64Array {
  const code = program.instructions
  for (let pc = 0; pc < code.length; pc += 5) {
    const op = code[pc]! as ScalarOpcode, destination = code[pc + 1]!, a = code[pc + 2]!, b = code[pc + 3]!, c = code[pc + 4]!
    scratch[destination] = op === ScalarOp.constant ? program.constants[a]!
      : op === ScalarOp.input ? inputs[a]!
      : calculate(op, scratch[a]!, scratch[b]!, scratch[c]!)
  }
  for (let index = 0; index < output.length; index++) output[index] = scratch[program.outputs[index]!]!
  return output
}

/** exact structural equivalence after binding selected inputs. one builder is
 * shared by all variants, so equal output identities prove the variants have
 * the same remaining arithmetic for every unbound candidate input. */
export function scalarSpecializer(program: ScalarProgram) {
  const builder = new ScalarBuilder(), registers = new Uint32Array(program.registers)
  const length = program.instructions.length / 5
  const previousA = new Float64Array(length).fill(NaN), previousB = previousA.slice(), previousC = previousA.slice()
  const previousOutputs = new Uint32Array(length)
  return (bindings: ReadonlyMap<number, number>): string => {
    const code = program.instructions
    for (let pc = 0; pc < code.length; pc += 5) {
      const op = code[pc]! as ScalarOpcode, destination = code[pc + 1]!, a = code[pc + 2]!, b = code[pc + 3]!, c = code[pc + 4]!
      const index = pc / 5
      if (op === ScalarOp.constant) {
        if (Number.isNaN(previousA[index]!)) { previousOutputs[index] = builder.constant(program.constants[a]!); previousA[index] = 0 }
      } else if (op === ScalarOp.input) {
        previousOutputs[index] = bindings.has(a) ? builder.constant(bindings.get(a)!) : builder.input(a)
      } else if (previousA[index] !== registers[a] || previousB[index] !== registers[b] || previousC[index] !== registers[c]) {
        previousA[index] = registers[a]!; previousB[index] = registers[b]!; previousC[index] = registers[c]!
        previousOutputs[index] = builder.operation(op, registers[a]!, registers[b]!, registers[c]!)
      }
      registers[destination] = previousOutputs[index]!
    }
    return Array.from(program.outputs, (slot) => registers[slot]!).join(',')
  }
}

export function specializeScalarProgram(program: ScalarProgram, bindings: ReadonlyMap<number, number>): ScalarProgram {
  if (!bindings.size) return program
  const builder = new ScalarBuilder(), registers = new Uint32Array(program.registers), code = program.instructions
  for (let pc = 0; pc < code.length; pc += 5) {
    const op = code[pc]! as ScalarOpcode, destination = code[pc + 1]!, a = code[pc + 2]!, b = code[pc + 3]!, c = code[pc + 4]!
    registers[destination] = op === ScalarOp.constant ? builder.constant(program.constants[a]!)
      : op === ScalarOp.input ? bindings.has(a) ? builder.constant(bindings.get(a)!) : builder.input(a)
        : builder.operation(op, registers[a]!, registers[b]!, registers[c]!)
  }
  return builder.finish(Array.from(program.outputs, (slot) => registers[slot]!))
}

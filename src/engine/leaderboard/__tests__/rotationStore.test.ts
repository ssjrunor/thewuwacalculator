/*
  Author: Runor Ewhro
  description: tests the stored program cache. programs are keyed by the running
               generator (a ruleset packaged before a generator fix gets no
               program made by the old code) and by the scenario with the scored
               seat's echoes reduced to the generator's reads: builds differing
               only in substats or echo stats share one program, a different main
               echo, set count or tune break boost gets its own, and an unshared
               key includes the full echoes.
*/

import { describe, expect, it } from 'vitest'
import { programShelf, type RotationStore } from '@/engine/leaderboard'
import type { OpenedRuleset } from '@/engine/leaderboard/rulesetReader'
import type { InterpretedProgram } from '@/engine/rotationGen'

const PACKAGED = 'packaged-generator'

function memoryStore(): RotationStore & { keys: () => string[]; reads: number } {
  const entries = new Map<string, string>()
  const store = {
    reads: 0,
    async get(key: string) { store.reads += 1; return entries.get(key) ?? null },
    async put(key: string, text: string) { entries.set(key, text) },
    keys: () => [...entries.keys()],
  }
  return store
}

const ruleset = { units: async () => new Map([['shared:a.json', 'a1'], ['resonator:1506', 'r1']]), generatorSha: async () => PACKAGED } as
  unknown as OpenedRuleset

type Echo = { id: string; set: number; mainEcho: boolean; mainStats: { primary: { key: string; value: number }; secondary: { key: string; value: number } };
  substats: Record<string, number> }

const echo = (id: string, set: number, patch: Partial<Echo> = {}): Echo => ({ id, set, mainEcho: false,
  mainStats: { primary: { key: 'critDmg', value: 44 }, secondary: { key: 'atkFlat', value: 150 } }, substats: { critRate: 8.1 }, ...patch })

/** the 1506 seat's echoes: a flagged main echo and a 3+2 split, unless patched. */
const echoes = (patch: (list: Echo[]) => void = () => undefined) => {
  const list = [echo('6000038', 7, { mainEcho: true }), echo('6000040', 7), echo('6000041', 7), echo('6000050', 9), echo('6000051', 9)]
  patch(list)
  return list
}

const scenarioOf = (seat: Echo[], id = 'ruleset-a:1506:t1:21050046') => ({ id, contextMemberId: 'm0', team: { members: [
  { id: 'm0', resonatorId: '1506', loadout: { weapon: { id: '21050046' }, echoes: seat } },
  { id: 'm1', resonatorId: '1102', loadout: { weapon: { id: '21010011' }, echoes: [] } },
] } }) as never

const plan = { team: [] } as never
const program = (made: string) => ({ initialOnFieldMemberId: 'm0', program: { made }, duration: 1, diagnostics: {} }) as unknown as InterpretedProgram

describe('the program shelf', () => {
  it('keys by the running generator, else the packaged one', async () => {
    const store = memoryStore()
    const scenario = scenarioOf(echoes())
    const key = (running: string | null) => programShelf(store, ruleset, running).keyOf(plan, scenario, true)
    expect(await key('old-generator')).not.toBe(await key('fixed-generator'))
    expect(await key(null)).toBe(await key(PACKAGED))
    const none = { units: async () => new Map(), generatorSha: async () => null } as unknown as OpenedRuleset
    expect(await programShelf(store, none, null).keyOf(plan, scenario, true)).toBeNull()
  })

  it('shares a key across builds that differ only in what the generator does not read', async () => {
    const shelf = programShelf(memoryStore(), ruleset, 'gen')
    const key = (seat: Echo[], share = true, id?: string) => shelf.keyOf(plan, scenarioOf(seat, id), share)
    const base = await key(echoes())
    // substats, echo main stats, a repeated echo's slot order and another ruleset's scenario id: the same program.
    expect(await key(echoes((list) => { list[1].substats = { critDmg: 21 } }))).toBe(base)
    expect(await key(echoes((list) => { list[2].mainStats.primary = { key: 'atkPercent', value: 33 } }))).toBe(base)
    expect(await key(echoes((list) => { [list[3], list[4]] = [list[4], list[3]] }))).toBe(base)
    expect(await key(echoes(), true, 'ruleset-b:1506:t1:21050046')).toBe(base)
    // what it reads: the main echo, a set's distinct pieces, tune break boost.
    expect(await key(echoes((list) => { list[0].mainEcho = false; list[1].mainEcho = true }))).not.toBe(base)
    expect(await key(echoes((list) => { list[2].id = list[1].id }))).not.toBe(base)
    expect(await key(echoes((list) => { list[4].set = 7 }))).not.toBe(base)
    expect(await key(echoes((list) => { list[3].substats = { tuneBreakBoost: 4 } }))).not.toBe(base)
    // unshared, any echo change is another key.
    const whole = await key(echoes(), false)
    expect(whole).not.toBe(base)
    expect(await key(echoes((list) => { list[1].substats = { critDmg: 21 } }), false)).not.toBe(whole)
  })

  it('puts and gets a program, and keeps it in the isolate for the next shelf', async () => {
    const store = memoryStore()
    const first = programShelf(store, ruleset, 'cached-gen')
    const key = (await first.keyOf(plan, scenarioOf(echoes()), true))!
    expect(await first.get(key)).toBeNull()
    expect(first.stats).toEqual({ hits: 0, misses: 1 })
    await first.put(key, program('first'))
    expect(store.keys()).toEqual([key])
    // a later message's cache reads it from the isolate, skipping the store
    const reads = store.reads
    const second = programShelf(store, ruleset, 'cached-gen')
    expect(await second.get(key)).toEqual(program('first'))
    expect([second.stats, store.reads]).toEqual([{ hits: 1, misses: 0 }, reads])
  })
})

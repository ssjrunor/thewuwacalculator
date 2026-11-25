/*
  Author: Runor Ewhro
  description: lean scores and fills. a lean bulk score has no breakdown; a
               board page read requests its lean rows' breakdowns from the scorer
               (SCORER, POST /fill) in the alarm, and a build or cell read fills
               its own cell at once. each fill is written once into the build's
               detail object and clears the lean mark.
*/

import { describe, expect, it } from 'vitest'
import { boardOf } from '../src/api/stubs.ts'
import { detailKey, gunzipJson, type CellDetail, type DetailObject, type GroupMessage } from '../src/scorer/messages.ts'
import { LEAN } from '../src/board/store.ts'
import type { CellResult } from '../src/board/types.ts'
import { A, B, call, env, placeScored, SCENARIO, settle, setUpAccountHarness, takeCells } from './accountHarness.ts'

setUpAccountHarness()

const KEY = SCENARIO.slice('ruleset:'.length)

/** a lean score for every queued cell, as a bulk group leaves it. */
async function scoreLean(score: number) {
  for (const message of takeCells()) {
    const detail: CellDetail = { contribution: null, input: null, anchors: null, deps: null, program: 'sha', lean: true }
    await boardOf(env, message.res).recordScores(message.res, [{ rs: message.rs, local: message.local, gen: message.gen, cell: message.cell,
      status: 'ok', score, damage: score * 100, dpr: score * 10, flags: LEAN, reason: null, weapon: 21020086, stats: null,
      detail: JSON.stringify(detail) }])
  }
  await settle()
}

/** a fake scorer: each fill returns every build of the group with its breakdown; `hold` delays the response. */
function fakeScorer() {
  const fills: GroupMessage[] = []
  let release: () => void = () => undefined
  let held: Promise<void> | null = null
  env.SCORER = { fetch: async (_url: string, init: RequestInit) => {
    const message = JSON.parse(String(init.body)) as GroupMessage
    fills.push(message)
    if (held) await held
    return Response.json(message.builds.map((build): CellResult => ({ rs: message.rs, local: build.local, gen: build.gen, cell: message.cell,
      status: 'ok', score: 1, damage: 1, dpr: 1, flags: 0, reason: null, weapon: 21020086, stats: null,
      detail: JSON.stringify({ contribution: { damage: 1200, features: [] }, input: null, anchors: null, deps: null, program: 'sha' } satisfies CellDetail) })))
  } } as unknown as Fetcher
  return { fills, hold: () => { held = new Promise((done) => { release = done }) }, release: () => { held = null; release() } }
}

async function leanBuild(uid: string, name: string, score: number) {
  env.LB.sqlite.prepare(`INSERT OR IGNORE INTO players (uid, region, last_name, hide_uid, first_seen_at, last_seen_at) VALUES (?, '5', ?, 0, 1, 1)`)
    .run(uid, name)
  const id = await placeScored(uid, null)
  await scoreLean(score)
  return id
}

const objectOf = async (buildId: string) => {
  const found = await env.LB_DATA.get(detailKey('ruleset', 1108, buildId))
  return found ? gunzipJson<DetailObject>(await found.arrayBuffer()) : null
}

describe('lean scores', () => {
  it('fills the lean rows a board page shows, once, in the build\'s detail object', async () => {
    const scorer = fakeScorer()
    const first = await leanBuild(A, 'Alpha', 120)
    const second = await leanBuild(B, 'Beta', 110)
    expect((await objectOf(first))!.cells[KEY]).toMatchObject({ contribution: null, lean: true })
    const rows = (await call('GET', '/boards/1108')).body.rows as Array<{ buildId: string; dpr: number }>
    expect(rows.map((row) => [row.buildId, row.dpr])).toEqual([[first, 1200], [second, 1100]])
    await settle()
    // one fill for the page: both rows' cell, as one group.
    expect(scorer.fills.map((fill) => fill.builds.length)).toEqual([2])
    for (const id of [first, second]) expect((await objectOf(id))!.cells[KEY].contribution).toEqual({ damage: 1200, features: [] })
    // filled cells are no longer lean, so another read requests nothing
    await call('GET', '/boards/1108?limit=50')
    await settle()
    expect(scorer.fills).toHaveLength(1)
    // the cell's score is what the lean score said.
    expect((await call('GET', `/builds/${first}`)).body.cells[0]).toMatchObject({ score: 120, dpr: 1200 })
  })

  it('fills a lean cell a build page or cell read asks for at once, and a read during a fill waits on it', async () => {
    const scorer = fakeScorer()
    const id = await leanBuild(A, 'Alpha', 120)
    scorer.hold()
    const reads = [call('GET', `/builds/${id}/cells/${SCENARIO}`), call('GET', `/builds/${id}/cells/${SCENARIO}`)]
    await new Promise((done) => setTimeout(done, 20))
    scorer.release()
    for (const read of await Promise.all(reads)) expect(read.body.contribution).toEqual({ damage: 1200, features: [] })
    expect(scorer.fills).toHaveLength(1)
    expect((await call('GET', `/builds/${id}`)).body.bestContribution).toEqual({ damage: 1200, features: [] })
    expect(scorer.fills).toHaveLength(1)
    expect((await objectOf(id))!.cells[KEY].lean).toBeUndefined()
  })

  it('leaves a cell lean when its fill fails, and asks again on the next read', async () => {
    let calls = 0
    env.SCORER = { fetch: async () => { calls += 1; return new Response('down', { status: 500 }) } } as unknown as Fetcher
    const id = await leanBuild(A, 'Alpha', 120)
    expect((await call('GET', `/builds/${id}/cells/${SCENARIO}`)).body.contribution).toBeNull()
    expect((await call('GET', `/builds/${id}/cells/${SCENARIO}`)).body.contribution).toBeNull()
    expect(calls).toBe(2)
    expect((await objectOf(id))!.cells[KEY].lean).toBe(true)
  })
})

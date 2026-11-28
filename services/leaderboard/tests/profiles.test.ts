/*
  Author: Runor Ewhro
  description: the profiles index (GET /profiles) through the real routes and
               sql: who it lists, its four orders and their reverse, the
               server and search filters, and the build counts the 0014
               triggers keep on each players row.
*/

import { describe, expect, it } from 'vitest'
import { A, B, C, call, env, seedPlayer, setUpAccountHarness, buildOf } from './accountHarness.ts'

setUpAccountHarness()

type Row = { uid: string | null; buildId: string; name: string | null; region: string | null; builds: number; resonators: string[] }
const list = async (query = '') => {
  const response = await call('GET', `/profiles${query}`)
  expect(response.status).toBe(200)
  return response.body as { total: number; offset: number; rows: Row[] }
}
const names = async (query = '') => (await list(query)).rows.map((row) => row.name)
const seen = (uid: string, first: number, last: number) =>
  env.LB.sqlite.prepare('UPDATE players SET first_seen_at = ?, last_seen_at = ? WHERE uid = ?').run(first, last, uid)

describe('profiles index', () => {
  it('lists uids with a listed build, in each order and its reverse', async () => {
    await seedPlayer(A, 'alpha', 120)
    await seedPlayer(A, 'alpha', 121)
    await seedPlayer(B, 'Beta', 110)
    await seedPlayer(C, 'carol', 100)
    seen(A, 30, 40)
    seen(B, 10, 60)
    seen(C, 20, 50)

    const all = await list()
    expect(all.total).toBe(3)
    // last upload, newest first by default
    expect(all.rows.map((row) => row.name)).toEqual(['Beta', 'carol', 'alpha'])
    expect(all.rows[2]).toMatchObject({ uid: A, region: '5', builds: 2, resonators: ['1108'] })
    expect(await names('?reverse=1')).toEqual(['alpha', 'carol', 'Beta'])
    // profile age, oldest first
    expect(await names('?sort=age')).toEqual(['Beta', 'carol', 'alpha'])
    expect(await names('?sort=builds')).toEqual(['alpha', 'Beta', 'carol'])
    // names compare without case
    expect(await names('?sort=name')).toEqual(['alpha', 'Beta', 'carol'])
    expect(await names('?sort=name&reverse=1')).toEqual(['carol', 'Beta', 'alpha'])

    const paged = await list('?sort=name&offset=1&limit=1')
    expect(paged).toMatchObject({ total: 3, offset: 1 })
    expect(paged.rows.map((row) => row.name)).toEqual(['Beta'])
    expect((await call('GET', '/profiles?sort=best')).status).toBe(400)
    expect((await call('GET', '/boards')).body.profiles).toBe(3)
  })

  it('searches names and uid prefixes, excluding hidden and anonymous uids', async () => {
    await seedPlayer(A, 'alpha', 120)
    await seedPlayer(B, 'Beta', 110, { hide: true })
    await seedPlayer(C, 'carol', 100)

    // a hidden uid lists without its uid or server, reached through its build
    const hidden = (await list()).rows.find((row) => row.name === 'Beta')
    expect(hidden).toMatchObject({ uid: null, region: null, buildId: buildOf(B) })
    expect(await names('?q=AR')).toEqual(['carol'])
    expect(await names(`?q=${A.slice(0, 7)}`)).toEqual(expect.arrayContaining(['alpha', 'carol']))
    // neither its digits nor a server filter find a hidden uid
    expect(await names(`?q=${B}`)).toEqual([])
    expect((await list('?region=5')).total).toBe(2)
    expect((await list('?region=6')).total).toBe(0)
    expect(await names('?q=50%25')).toEqual([])

    env.LB.sqlite.prepare('UPDATE players SET anonymous = 1 WHERE uid = ?').run(C)
    expect(await names('?sort=name')).toEqual(['alpha', 'Beta'])
  })

  it('drops a uid once it has no listed build', async () => {
    await seedPlayer(A, 'alpha', 120)
    expect((await list()).total).toBe(1)
    env.LB.sqlite.prepare('DELETE FROM player_boards WHERE uid = ?').run(A)
    expect(env.LB.sqlite.prepare('SELECT builds, listed_boards FROM players WHERE uid = ?').get(A)).toEqual({ builds: 0, listed_boards: 0 })
    expect((await list()).total).toBe(0)
  })
})

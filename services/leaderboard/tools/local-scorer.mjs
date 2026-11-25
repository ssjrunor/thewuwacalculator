/*
  Author: Runor Ewhro
  description: local dev only: scores scenarios in plain node for the local
               scorer worker, which keeps long anchor searches out of workerd,
               where they stall the api and have crashed the dev server. one
               process runs a pool of worker threads sized to the machine (a
               thread per spare core, 2 GB of memory each; lib/pool.mjs), so the
               queue consumer can send a whole batch at once. the worker posts
               each scenario (LOCAL_SCORER_URL, set by dev:full) and records the
               result itself, and this server never opens the database. rulesets
               are read from .wrangler/rulesets/<id>, written by `lb build`.
  usage: node tools/local-scorer.mjs [--port 8790] [--threads N]
*/

import { createServer } from 'node:http'
import { existsSync } from 'node:fs'
import { availableParallelism, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { poolSize } from './lib/pool.mjs'

const service = resolve(import.meta.dirname, '..')

if (isMainThread) {
  const { values } = parseArgs({ options: { port: { type: 'string', default: '8790' }, threads: { type: 'string' } } })
  if (values.threads !== undefined && !/^[1-9]\d*$/.test(values.threads)) {
    process.stderr.write(`--threads takes a whole number of threads, not ${values.threads}\n`)
    process.exit(1)
  }
  const size = values.threads ? Number(values.threads) : poolSize(availableParallelism(), totalmem())

  // each thread scores one scenario at a time; requests wait for the next free one, a player's (interactive)
  // ahead of any rescore's (bulk).
  const idle = []
  const waiting = { interactive: [], bulk: [] }
  const pending = new Map()
  let nextId = 0
  const threads = Array.from({ length: size }, (_, index) => {
    const thread = new Worker(new URL(import.meta.url), { workerData: { index } })
    thread.on('message', ({ id, result, error }) => {
      const task = pending.get(id)
      pending.delete(id)
      if (error) task.reject(new Error(error))
      else task.resolve(result)
      release(thread)
    })
    thread.on('error', (error) => {
      process.stderr.write(`scorer thread ${index} failed: ${error.stack ?? error}\n`)
      process.exit(1)
    })
    idle.push(thread)
    return thread
  })
  const release = (thread) => {
    const next = waiting.interactive.shift() ?? waiting.bulk.shift()
    if (next) next(thread)
    else idle.push(thread)
  }
  // remove a waiting request whose caller disconnected (the dev server reloaded and dropped its queue), which frees
  // the thread; scores already running finish
  const take = (lane, gone) => idle.length ? Promise.resolve(idle.pop())
    : new Promise((resolveThread, reject) => {
      const line = waiting[lane === 'bulk' ? 'bulk' : 'interactive']
      line.push(resolveThread)
      gone.then(() => {
        const at = line.indexOf(resolveThread)
        if (at >= 0) { line.splice(at, 1); reject(new Error('caller went away')) }
      })
    })
  async function score(request, gone) {
    const thread = await take(request.lane, gone)
    const id = nextId++
    return new Promise((resolveScore, reject) => {
      pending.set(id, { resolve: resolveScore, reject })
      thread.postMessage({ id, request })
    })
  }

  const server = createServer((request, response) => {
    const reply = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)) }
    if (request.method === 'GET' && request.url === '/health') {
      return reply(200, { ok: true, threads: size, busy: size - idle.length,
        waiting: { interactive: waiting.interactive.length, bulk: waiting.bulk.length } })
    }
    // /score: one build in one scenario; /score-group: builds that share a program, on one thread (bulk).
    const group = request.url === '/score-group'
    if (request.method !== 'POST' || (request.url !== '/score' && !group)) return reply(404, { error: 'not found' })
    const chunks = []
    const gone = new Promise((resolveGone) => response.on('close', () => { if (!response.writableFinished) resolveGone() }))
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      // reply with an error to a non-json body and keep serving other requests
      let body
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (error) {
        reply(400, { error: `not json: ${error instanceof Error ? error.message : String(error)}` })
        return
      }
      score(group ? { ...body, lane: 'bulk', group: true } : body, gone)
        .then((result) => reply(200, result), (error) => {
          if (response.destroyed) return
          process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
          reply(500, { error: error instanceof Error ? error.message : String(error) })
        })
    })
  })
  const stop = () => { for (const thread of threads) void thread.terminate(); server.close() }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop(); process.exit(130) })
  // a scorer left from an earlier dev session holds the port and would score with that session's engine code, so
  // print a plain message on the error
  server.on('error', (error) => {
    if (error.code !== 'EADDRINUSE') throw error
    process.stderr.write(`\nlocal scorer: port ${values.port} is taken, most likely by a scorer from an earlier dev:full still running`
      + ` with older engine code. stop it (lsof -nP -iTCP:${values.port} -sTCP:LISTEN shows its pid) and start dev:full again.\n\n`)
    stop()
    process.exit(1)
  })
  server.listen(Number(values.port), '127.0.0.1',
    () => process.stdout.write(`local scorer on http://127.0.0.1:${values.port}, ${size} threads\n`))
} else {
  const { loadEngine } = await import('./lib/engine.mjs')
  const { readFile } = await import('node:fs/promises')
  const engine = await loadEngine(['openRuleset', 'openScoringSession', 'scoreScenario', 'scoreScenarioGroup', 'offlineAnchorExecutor',
    'withStoredRotations'])
  // key stored rotations by the generator this thread just bundled; the package's generator would return rotations
  // made by old code for a ruleset packaged before a generator fix
  const { generatorBundleHash } = await import('./lib/fingerprint.mjs')
  const generator = await generatorBundleHash()
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  // stored rotations (rotationStore.ts), one file per key, written to a temp file and renamed, which keeps readers
  // from seeing partial files
  const rotations = join(service, '.wrangler/rotations')
  await mkdir(rotations, { recursive: true })
  const rotationStore = {
    async get(key) {
      try { return await readFile(join(rotations, `${key}.json`), 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    },
    async put(key, text) {
      const temp = join(rotations, `${key}.${process.pid}.${workerData.index}.tmp`)
      await writeFile(temp, text)
      await rename(temp, join(rotations, `${key}.json`))
    },
  }

  // one session per ruleset in each thread, shared by every scenario it scores.
  const sessions = new Map()
  const sessionFor = (rulesetId, manifestSha256) => {
    let session = sessions.get(rulesetId)
    if (!session) {
      session = (async () => {
        const folder = join(service, '.wrangler/rulesets', rulesetId)
        if (!existsSync(join(folder, 'manifest.json'))) throw new Error(`ruleset ${rulesetId} is not in .wrangler/rulesets`)
        // read files on request from the engine; openRuleset checks the manifest against the published hash and every file
        // against the manifest
        const files = { read: async (path) => {
          try {
            return new Uint8Array(await readFile(join(folder, path)))
          } catch (error) {
            if (error.code === 'ENOENT') return null
            throw error
          }
        } }
        const ruleset = await engine.openRuleset(files, { expectedManifestSha256: manifestSha256 })
        return engine.openScoringSession(ruleset)
      })()
      session.catch(() => sessions.delete(rulesetId))
      sessions.set(rulesetId, session)
    }
    return session
  }

  parentPort.on('message', async ({ id, request: { rulesetId, manifestSha256, scenarioId, lane, snapshot, snapshots, group, programCheck, damageCheck, detail } }) => {
    try {
      const session = await sessionFor(rulesetId, manifestSha256)
      const def = session.ruleset.defById.get(scenarioId)
      if (!def) throw new Error(`scenario ${scenarioId} is not in ruleset ${rulesetId}`)
      const started = Date.now()
      // offline anchors where the ruleset has them; the executor searches its own for other scenarios
      const { context, stats } = engine.withStoredRotations(
        session.context(engine.offlineAnchorExecutor((id) => session.ruleset.anchorsFor(id))), rotationStore, session.ruleset, generator)
      if (group) {
        const results = await engine.scoreScenarioGroup(snapshots, def, context, { programCheck: programCheck ?? 0, damageCheck: damageCheck ?? 0, detail: detail ?? 'full' })
        const counts = {}
        for (const result of results) counts[result.programSource ?? 'none'] = (counts[result.programSource ?? 'none'] ?? 0) + 1
        process.stdout.write(`[${workerData.index}] group ${scenarioId} ${results.length} builds ${Date.now() - started}ms programs ${JSON.stringify(counts)}`
          + `${results.some((result) => result.programMismatch) ? ' PROGRAM MISMATCH' : ''}\n`)
        parentPort.postMessage({ id, result: results.map((result) => ({ ...result, program: null })) })
        return
      }
      const result = await engine.scoreScenario(snapshot, def, context)
      process.stdout.write(`[${workerData.index}] ${lane ?? 'interactive'} ${scenarioId} ${result.status}${result.reason ? ` ${result.reason}` : ''} ${Date.now() - started}ms${stats.hits ? ' (stored rotation)' : ''}\n`)
      // the worker stores the program text, so the parsed document is dropped
      parentPort.postMessage({ id, result: { ...result, program: null } })
    } catch (error) {
      parentPort.postMessage({ id, error: error instanceof Error ? error.stack ?? error.message : String(error) })
    }
  })
}

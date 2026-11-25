/*
  Author: Runor Ewhro
  description: local dev only: runs `wrangler dev` for dev:full and restarts it
               when it exits on an error. wrangler 4.114 exits when one proxied
               request loses its connection to the worker (an empty
               "✘ [ERROR]"), which stopped the local scorer and sweep too. a
               restart drops the local queues, so each restart runs the startup
               sweep (tools/dev-sweep.mjs --once), which resumes every lost score
               job and card read. MAX_QUICK_EXITS exits in a row within
               MIN_UPTIME_MS of starting mean a config or build error, and this
               gives up. ctrl-c or `x` in wrangler exits cleanly (code 0) and
               stops everything; only error exits restart.
               wrangler 4.165 (miniflare 5 beta) can hang: its main thread waits
               forever on a synchronous call into workerd, the port's proxy stops
               responding, and nothing exits. a watchdog requests the api's
               /healthz (no storage access, so only a stuck thread blocks it)
               every WATCH_EVERY_MS, and after WATCH_MISSES misses in a row kills
               wrangler and its workerd and restarts them like a crash. board
               background work runs in bounded steps that yield to requests
               (src/board/pace.ts), so a slow board is not a hang; the watchdog
               logs whether the thread was busy with one at its last response.
  usage: node tools/dev-wrangler.mjs <wrangler dev args>...
*/

import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { patchWrangler } from './patch-wrangler.mjs'

const MIN_UPTIME_MS = 15_000
const MAX_QUICK_EXITS = 3
/** watchdog settings: request interval, response timeout, and consecutive misses that count as a hang. */
const WATCH_EVERY_MS = 20_000
const WATCH_TIMEOUT_MS = 30_000
// LB_WATCH_MISSES raises the miss count for intentionally long work (a seed purge's board is one write)
const WATCH_MISSES = Math.max(1, Number(process.env.LB_WATCH_MISSES) || 3)
/** a starting wrangler builds and migrates first; the watchdog waits this long before its first question. */
const WATCH_GRACE_MS = 60_000
let quickExits = 0
const args = process.argv.slice(2)
const sweep = fileURLToPath(new URL('./dev-sweep.mjs', import.meta.url))
const portArg = args[args.indexOf('--port') + 1]
let stopping = false
let child = null

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopping = true
    child?.kill(signal)
  })
}

const say = (text) => process.stderr.write(`\n[dev-wrangler] ${text}\n`)

/** every process under `pid` (wrangler's workerd and esbuild), deepest first. */
function descendants(pid) {
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).trim().split('\n')
    .map((line) => line.trim().split(/\s+/).map(Number))
  const under = (parent) => rows.filter(([, ppid]) => ppid === parent).flatMap(([child]) => [...under(child), child])
  return under(pid)
}

/** kills a hung wrangler and its child processes, freeing the port for the next start. */
function killTree(pid) {
  for (const id of [...descendants(pid), pid]) {
    try { process.kill(id, 'SIGKILL') } catch { /* already gone */ }
  }
}

/** polls the api through wrangler's proxy and kills the wrangler that started it once it stops responding. */
function watch(target, started) {
  let misses = 0
  let last = null
  const timer = setInterval(async () => {
    if (child !== target || stopping) return clearInterval(timer)
    if (Date.now() - started < WATCH_GRACE_MS) return
    const answer = await fetch(`http://127.0.0.1:${portArg ?? 8787}/api/lb/healthz`, { signal: AbortSignal.timeout(WATCH_TIMEOUT_MS) })
      .then((response) => response.ok ? response.json() : null, () => null)
    if (child !== target || stopping) return clearInterval(timer)
    if (answer) last = answer
    misses = answer ? 0 : misses + 1
    if (misses >= WATCH_MISSES) {
      clearInterval(timer)
      const busy = last?.heavy ? ' (a board step was running at its last answer)' : ''
      say(`the api has not answered for ${Math.round(WATCH_MISSES * WATCH_EVERY_MS / 1000)} s${busy}; wrangler is hung, killing it`)
      killTree(target.pid)
    }
  }, WATCH_EVERY_MS)
  timer.unref()
}

function run(restart) {
  // patch before every start, which covers a wrangler reinstalled while dev:full runs
  const patched = patchWrangler()
  if (patched) say(`patched wrangler: a dropped proxied request no longer exits it (${patched} site(s))`)
  const started = Date.now()
  child = spawn('wrangler', ['dev', ...args], { stdio: 'inherit' })
  watch(child, started)
  if (restart) {
    spawn(process.execPath, [sweep, '--once', ...(args.includes('--port') ? ['--port', portArg] : [])], { stdio: 'inherit' })
  }
  child.on('exit', (code, signal) => {
    child = null
    // wrangler reads the terminal in raw mode, so ctrl-c and `x` arrive as keys and it exits cleanly (code 0); only
    // error exits restart
    if (stopping || code === 0 || signal === 'SIGINT' || signal === 'SIGTERM') process.exit(code ?? 0)
    const uptime = Date.now() - started
    quickExits = uptime < MIN_UPTIME_MS ? quickExits + 1 : 0
    if (quickExits >= MAX_QUICK_EXITS) {
      say(`wrangler exited within ${MIN_UPTIME_MS / 1000} s of starting ${quickExits} times in a row (code ${code}); not restarting`)
      process.exit(code || 1)
    }
    say(`wrangler exited (code ${code}) after ${Math.round(uptime / 1000)} s; starting it again`)
    run(true)
  })
}

run(false)

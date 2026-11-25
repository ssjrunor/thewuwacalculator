/*
  Author: Runor Ewhro
  description: local dev only: runs the cron that wrangler dev skips. once
               wrangler dev responds, it runs the api worker's maintenance with
               cron "startup", whose upkeep on every board resumes each
               unfinished score job at once (a restart drops the local queue and
               its messages) and sends unsent orders; then every --every minutes
               it runs cron "dev": the hourly work (board upkeep, rollouts) with a
               3 minute stall window, since every hot reload drops the local
               queue's waiting messages. requests go through the running worker,
               and the database is never opened. the startup sweep also waits for
               the local scorer, since a sweep with the scorer down skips stalled
               jobs. --once runs only the startup sweep and exits
               (tools/dev-wrangler.mjs, after restarting wrangler).
  usage: node tools/dev-sweep.mjs [--port 8787] [--scorer-port 8790] [--every 5] [--once]
*/

import { parseArgs } from 'node:util'
import { setTimeout as wait } from 'node:timers/promises'

const { values } = parseArgs({ options: { port: { type: 'string', default: '8787' }, 'scorer-port': { type: 'string', default: '8790' },
  every: { type: 'string', default: '5' }, once: { type: 'boolean', default: false } } })
const base = `http://127.0.0.1:${values.port}/__scheduled?cron=`
const until = Date.now() + 180_000
const run = async (cron) => (await fetch(`${base}${encodeURIComponent(cron)}`)).ok
const scorerUp = async () => (await fetch(`http://127.0.0.1:${values['scorer-port']}/health`)).ok

let started = false
while (Date.now() < until) {
  try {
    if (await scorerUp() && await run('startup')) {
      process.stdout.write('startup sweep ran; see "maintenance" in the wrangler log for what it resumed\n')
      started = true
      break
    }
  } catch { /* wrangler is not up yet */ }
  await wait(2000)
}
if (!started) {
  process.stderr.write(`startup sweep: ${base}startup or the local scorer did not answer within 3 minutes; no jobs were resumed\n`)
  process.exit(1)
}
if (values.once) process.exit(0)
for (const every = Math.max(1, Number(values.every)) * 60_000; ;) {
  await wait(every)
  try { await run('dev') } catch { /* wrangler restarting; the next tick tries again */ }
}

/*
  Author: Runor Ewhro
  description: deploys the scorer worker with the hash of its bundled rotation
               generator, which keys stored rotations by the running code instead
               of the ruleset's packaged generator
               (src/engine/leaderboard/rotationStore.ts). extra arguments go to
               wrangler deploy.
  usage: node tools/deploy-scorer.mjs [wrangler args...]
*/

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { generatorBundleHash } from './lib/fingerprint.mjs'

const service = resolve(import.meta.dirname, '..')
const generator = await generatorBundleHash()
process.stdout.write(`rotation generator ${generator.slice(0, 12)}\n`)
const run = spawnSync('npx', ['wrangler', 'deploy', '-c', 'wrangler.scorer.jsonc', '--define', `LB_GENERATOR_SHA:"${generator}"`,
  ...process.argv.slice(2)], { cwd: service, stdio: 'inherit' })
process.exit(run.status ?? 1)

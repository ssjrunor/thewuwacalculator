/*
  Author: Runor Ewhro
  description: local dev only: writes wrangler.scorer.dev.jsonc, the scorer
               config with a bulk batch size that keeps the local pool busy under
               miniflare (tools/lib/devScorerConfig.mjs). npm run dev:full runs
               it first, which regenerates the copy from wrangler.scorer.jsonc.
  usage: node tools/dev-scorer-config.mjs
*/

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEV_SCORER_CONFIG, devScorerConfig } from './lib/devScorerConfig.mjs'

const root = join(import.meta.dirname, '..')
writeFileSync(join(root, DEV_SCORER_CONFIG), devScorerConfig(readFileSync(join(root, 'wrangler.scorer.jsonc'), 'utf8')))

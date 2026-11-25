/*
  Author: Runor Ewhro
  description: local dev only: patches wrangler dev to stay up when one proxied
               request loses its connection to the worker. wrangler's
               ProxyController turns every "error" message from its ProxyWorker
               into a fatal error event, so one dropped request ("Network
               connection lost", an empty "✘ [ERROR]") stops the dev server.
               the ProxyWorker has already answered that request with a 500, so
               this rewrites the event into a warning. it edits
               node_modules/wrangler in place, is idempotent, and runs from
               dev-wrangler.mjs before every start, which reapplies it after a
               reinstall. it throws when wrangler's code no longer matches, which
               requires a manual check after an upgrade.
  usage: node tools/patch-wrangler.mjs (or import { patchWrangler })
*/

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FATAL = 'this.emitErrorEvent("Error inside ProxyWorker", message.error);'
const MARK = '/* twc: dropped request is not fatal */'
const WARNING = `${MARK} console.warn("[dev-wrangler] a proxied request lost its connection to the worker (" + ` +
  `(message.error && message.error.message) + "); it answered 500 and wrangler keeps running");`

/** patches wrangler's cli in place and returns the number of changed sites (0 when already patched). */
export function patchWrangler() {
  const require = createRequire(import.meta.url)
  const cli = join(dirname(require.resolve('wrangler/package.json')), 'wrangler-dist', 'cli.js')
  const source = readFileSync(cli, 'utf8')
  const sites = source.split(FATAL).length - 1
  if (sites === 0) {
    if (source.includes(MARK)) return 0
    throw new Error(`patch-wrangler: ${cli} has no "${FATAL}" and no patch mark; wrangler changed, check ProxyController.onProxyWorkerMessage by hand`)
  }
  writeFileSync(cli, source.split(FATAL).join(WARNING))
  return sites
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sites = patchWrangler()
  process.stdout.write(sites ? `patched ${sites} site(s) in wrangler\n` : 'wrangler already patched\n')
}

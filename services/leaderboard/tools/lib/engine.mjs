/*
  Author: Runor Ewhro
  description: bundles the engine's public exports for node, used by the local
               scorer and the scorer deploy (fingerprint.mjs): canonical json,
               rover forms, the scorer versions, and loadEngine for other
               exports. ruleset assembly is in the offline tools
               (scripts/leaderboard/tools/lib/ruleset.mjs).
*/

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// bundle the app's public surface for Node; no dev server or global fetch shim.
export const engineTools = await build({
  stdin: { contents: `export { scenarioDefs, indexTeammateBuilds, teammateEchoes, canonicalJson,
    canonicalResonatorId, assertActionPlan, resonatorForms, LEADERBOARD_ENGINE_VER, ROTATION_GEN_VER } from '@/engine/leaderboard'`, resolveDir: root },
  alias: { '@': join(root, 'src') }, bundle: true, write: false,
  platform: 'node', format: 'esm', logLevel: 'silent',
}).then((result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`))

/** the engine's canonical JSON: sorted object keys, preserved array order, one trailing newline. */
export const rulesetJson = (value) => engineTools.canonicalJson(value)
/** the ids that name one resonator: itself, then its other rover form. */
export const resonatorForms = (id) => engineTools.resonatorForms(id)

/** the versions this checkout's scorer accepts, stamped on rulesets by default. */
export const SCORER_VERSIONS = { engineVersion: engineTools.LEADERBOARD_ENGINE_VER, rotationVersion: engineTools.ROTATION_GEN_VER }

/**
 * bundles more engine exports for a node tool; `also` maps other app modules to names, bundled together so the app's
 * module state exists once.
 */
export async function loadEngine(names, also = {}) {
  const exports = [`export { ${names.join(', ')} } from '@/engine/leaderboard'`,
    ...Object.entries(also).map(([module, moduleNames]) => `export { ${moduleNames.join(', ')} } from '${module}'`)]
  const result = await build({
    stdin: { contents: exports.join('\n'), resolveDir: root },
    alias: { '@': join(root, 'src') }, bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`)
}

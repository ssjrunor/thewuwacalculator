/*
  Author: Runor Ewhro
  description: assembles and validates an offline leaderboard ruleset (without
               running rotation generation or damage evaluation), attaches
               reference values, and reads and writes ruleset folders. local
               tools bundle the engine's public surface through loadEngine.
*/

import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const sourceData = join(root, 'services/leaderboard/data')
const roles = new Set(['signature', 'primary', 'alternative', 'standard'])
const record = (value) => value != null && typeof value === 'object' && !Array.isArray(value)
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

// bundle the app's public surface for Node; no dev server or global fetch shim.
const tools = await build({
  stdin: { contents: `export { scenarioDefs, indexTeammateBuilds, teammateEchoes, canonicalJson,
    canonicalResonatorId, assertActionPlan, resonatorForms, LEADERBOARD_ENGINE_VER, ROTATION_GEN_VER } from '@/engine/leaderboard'`, resolveDir: root },
  alias: { '@': join(root, 'src') }, bundle: true, write: false,
  platform: 'node', format: 'esm', logLevel: 'silent',
}).then((result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`))

/** the engine's canonical JSON: sorted object keys, preserved array order, one trailing newline. */
export const rulesetJson = (value) => tools.canonicalJson(value)

/** the versions this checkout's scorer accepts; a ruleset is stamped with them unless told otherwise. */
export const SCORER_VERSIONS = { engineVersion: tools.LEADERBOARD_ENGINE_VER, rotationVersion: tools.ROTATION_GEN_VER }

async function readJson(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) }
  catch (error) { throw new Error(`Cannot read JSON ${file}: ${error.message}`) }
}

/** snapshot JSON only; symlinks cannot silently pull in data outside the source tree. */
async function snapshotJson(directory) {
  const files = new Map()
  async function visit(relative) {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const path = relative ? `${relative}/${entry.name}` : entry.name
      requireValue(!entry.isSymbolicLink(), `Snapshot contains a symlink: ${join(directory, path)}`)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile() && entry.name.endsWith('.json')) files.set(path, await readJson(join(directory, path)))
    }
  }
  await visit('')
  return files
}

function validateSelections(selections) {
  requireValue(selections?.schema === 1 && record(selections.teams) && record(selections.resonators), 'Invalid scenarios file')
  requireValue(Object.keys(selections.resonators).length > 0, 'No scored resonators')
  const used = new Set()
  for (const [id, entry] of Object.entries(selections.resonators)) {
    requireValue(/^\d{4}$/.test(id) && Array.isArray(entry.teams) && entry.teams.length > 0 &&
      new Set(entry.teams).size === entry.teams.length, `Invalid teams for ${id}`)
    requireValue(Array.isArray(entry.weapons) && entry.weapons.length > 0 &&
      new Set(entry.weapons.map((weapon) => weapon.id)).size === entry.weapons.length, `Invalid weapons for ${id}`)
    for (const weapon of entry.weapons) requireValue(typeof weapon.id === 'string' && /^\d+$/.test(weapon.id) &&
      integer(weapon.rank, 1, 5) && roles.has(weapon.role), `Invalid scenario weapon for ${id}`)
    for (const teamId of entry.teams) {
      const seats = selections.teams[teamId]
      requireValue(Array.isArray(seats) && seats.length === 3 && new Set(seats.map((seat) => seat.resonatorId)).size === 3 &&
        seats.every((seat) => /^\d{4}$/.test(seat.resonatorId) &&
          (seat.mode === null || typeof seat.mode === 'string' && seat.mode.length > 0)), `Invalid team ${teamId}`)
      used.add(teamId)
    }
  }
  requireValue(Object.keys(selections.teams).every((id) => used.has(id)), 'Scenarios file contains an unlisted team')
}

function requiredJson(files, path) {
  requireValue(files.has(path), `Missing snapshot file: ${path}`)
  return files.get(path)
}

function validateGameData(gameData) {
  for (const path of ['resonators/catalog.json', 'resonators/picker-catalog.json', 'resonators/details.json',
    'resonators/sources.json', 'resonators/damage-entries.json', 'resonators/feature-ids.json',
    'weapons/catalog.json', 'weapons/core-catalog.json', 'weapons/sources.json',
    'echoes/catalog.json', 'echoes/stats.json', 'echoes/sources.json',
    'sonata/sets.json', 'sonata/effects.json', 'enemies/catalog.json', 'enemies/sources.json', 'source-manifest.json']) {
    requiredJson(gameData, path)
  }
  const byId = (path) => new Map(requiredJson(gameData, path).map((entry) => [String(entry.id), entry]))
  return { resonators: byId('resonators/catalog.json'), weapons: byId('weapons/catalog.json'),
    echoes: byId('echoes/catalog.json'), sets: byId('sonata/sets.json'), stats: requiredJson(gameData, 'echoes/stats.json') }
}

function validateWeapon(resonatorId, weapon, catalogs, gameData) {
  const resonator = catalogs.resonators.get(resonatorId)
  const definition = catalogs.weapons.get(weapon.id)
  requireValue(resonator && definition && resonator.weaponType === definition.weaponType &&
    integer(weapon.rank, 1, 5), `Unavailable or incompatible weapon ${weapon.id} for ${resonatorId}`)
  const bundle = requiredJson(gameData, `weapons/runtime-bundles/${weapon.id}.json`)
  requireValue(String(bundle.weapon?.id) === weapon.id && bundle.weapon.statsByLevel?.['90']?.atk > 0,
    `Invalid weapon runtime bundle ${weapon.id}`)
}

function validateTeammate(teammate, slot, catalogs, gameData, tools) {
  requireValue(integer(teammate.sequence, 0, 6) && teammate.echoes.length === 5 &&
    teammate.echoes.filter((echo) => echo.mainEcho).length === 1 &&
    teammate.echoes.reduce((sum, echo) => sum + echo.cost, 0) <= 12, `Invalid teammate build ${slot}`)
  validateWeapon(teammate.resonatorId, teammate.weapon, catalogs, gameData)
  for (const echo of teammate.echoes) {
    requireValue(catalogs.stats.primaryStats[echo.cost]?.[echo.main[0]] === echo.main[1], `Invalid main stat for ${slot}`)
    requireValue(Object.keys(echo.substats).length === 5 && Object.entries(echo.substats).every(([key, value]) => {
      const range = catalogs.stats.substatRanges[key]
      if (!range || !Number.isFinite(value)) return false
      // flat HP's discrete values are the same explicit tiers as the calculator.
      if (key === 'hpFlat') return [320, 360, 390, 430, 470, 510, 540, 580].includes(value)
      return Array.from({ length: range.divisions + 1 }, (_, index) => {
        const roll = range.min + (range.max - range.min) * index / range.divisions
        return key.endsWith('Flat') ? Math.ceil(roll / 10) * 10 : Number(roll.toFixed(1))
      }).includes(value)
    }), `Invalid substats for ${slot}`)
  }
  requireValue(new Set(teammate.sets.map((set) => set.id)).size === teammate.sets.length &&
    teammate.sets.every((set) => catalogs.sets.has(String(set.id)) && integer(set.pieces, 1, 5)) &&
    teammate.sets.reduce((sum, set) => sum + set.pieces, 0) <= 5, `Invalid sets for ${slot}`)
  const echoes = tools.teammateEchoes(teammate, slot, {
    echoes: [...catalogs.echoes.values()].map((echo) => ({ ...echo, id: String(echo.id) })),
    secondaryByCost: catalogs.stats.secondaryStats,
  })
  requireValue(echoes.find((echo) => echo.mainEcho)?.id === teammate.mainEchoId &&
    teammate.sets.every((set) => echoes.filter((echo) => echo.set === set.id).length >= set.pieces),
  `Cannot materialize teammate sets/main Echo for ${slot}`)
}

/** produce a candidate package. Reference scores are deliberately absent until refs.mjs runs. */
export async function assembleRuleset({ id, mode = 'beta', gameVersion,
  engineVersion = SCORER_VERSIONS.engineVersion, rotationVersion = SCORER_VERSIONS.rotationVersion,
  scenariosFile = join(sourceData, 'scenarios.json'), teammatesFile = join(sourceData, 'teammate-builds.json'),
  actionsFile = join(sourceData, 'actions.json'),
  gameDataDir = join(root, 'public/data', mode),
  interpreterDataDir = join(root, 'src/data/rotationGen') } = {}) {
  requireValue(typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id), 'A valid ruleset id is required')
  requireValue(['live', 'beta'].includes(mode), 'Mode must be live or beta')
  for (const [name, value] of Object.entries({ gameVersion, engineVersion, rotationVersion })) {
    requireValue(typeof value === 'string' && value.trim().length > 0, `${name} is required`)
  }
  const [selections, teammates, actions, gameData, interpreter] = await Promise.all([
    readJson(scenariosFile), readJson(teammatesFile), readJson(actionsFile),
    snapshotJson(gameDataDir), snapshotJson(interpreterDataDir),
  ])
  requireValue(actions?.schema === 1 && record(actions.plans), 'Invalid action plans file')
  validateSelections(selections)
  requireValue(teammates?.schema === 1 && record(teammates.resonators), 'Invalid teammate builds file')
  const catalogs = validateGameData(gameData)
  const plans = {}, recipeHashes = {}
  for (const teamId of Object.keys(selections.teams).sort()) {
    requireValue(record(actions.plans[teamId]), `No action plan for team ${teamId}`)
    const plan = tools.assertActionPlan(actions.plans[teamId])
    requireValue(plan.teamId === teamId, `Action plan ${plan.teamId} is filed under team ${teamId}`)
    const seats = selections.teams[teamId]
    requireValue(plan.team.length === seats.length && plan.team.every((member, slot) =>
      tools.canonicalResonatorId(member.resonatorId) === tools.canonicalResonatorId(seats[slot].resonatorId)),
    `Action plan seats disagree with authored team ${teamId}`)
    plans[teamId] = plan
    recipeHashes[teamId] = sha256(rulesetJson(plan))
  }
  const scenarios = tools.scenarioDefs({ rulesetId: id, scenarios: selections, recipeHashes })
  requireValue(new Set(scenarios.map((scenario) => scenario.id)).size === scenarios.length, 'Duplicate scenario identity')
  const teammateIndex = tools.indexTeammateBuilds(teammates)
  const checkedSlots = new Set(), checkedResonators = new Set()
  const characterIndex = requiredJson(interpreter, 'characters/index.json')
  requireValue(requiredJson(interpreter, 'gear/triggers.json').schemaVersion === 1, 'Invalid gear trigger definitions')
  for (const scenario of scenarios) {
    validateWeapon(scenario.resonatorId, scenario.weapon, catalogs, gameData)
    for (const member of scenario.members) {
      if (!checkedResonators.has(member.resonatorId)) {
        for (const kind of ['runtime', 'worker']) {
          const bundle = requiredJson(gameData, `resonators/${kind}-bundles/${member.resonatorId}.json`)
          requireValue(String(bundle.seed?.id) === member.resonatorId &&
            String(bundle.source?.source?.id) === member.resonatorId, `Invalid resonator bundle ${member.resonatorId}`)
        }
        // a rover's rules are filed under one of its two forms.
        const ruleId = tools.resonatorForms(member.resonatorId).find((form) => characterIndex.rulesets?.[form]) ?? member.resonatorId
        const rules = requiredJson(interpreter, `characters/${ruleId}.json`)
        requireValue(characterIndex.rulesets?.[ruleId] && rules.schemaVersion === 2 && String(rules.resonatorId) === ruleId,
          `Missing character interpretation facts for ${member.resonatorId}`)
        checkedResonators.add(member.resonatorId)
      }
      if (member.isContext) continue
      const teammate = teammateIndex.get(member.teamSlot)
      requireValue(teammate && tools.canonicalResonatorId(teammate.resonatorId) === tools.canonicalResonatorId(member.resonatorId),
        `Missing or mismatched teammate ${member.teamSlot}`)
      if (!checkedSlots.has(member.teamSlot)) {
        validateTeammate(teammate, member.teamSlot, catalogs, gameData, tools)
        checkedSlots.add(member.teamSlot)
      }
    }
  }
  requireValue([...teammateIndex.keys()].every((key) => checkedSlots.has(key)), 'Authored teammate build points at an unused slot')
  const files = new Map()
  const add = (path, value) => files.set(path, rulesetJson(value))
  add('actions.json', { schema: 1, plans })
  add('scenarios.json', selections)
  add('teammates.json', teammates)
  for (const [path, value] of gameData) add(`data/${path}`, value)
  for (const [path, value] of interpreter) add(`interpreter/${path}`, value)
  return sealPackage({ schema: 1, id, gameVer: gameVersion, engineVer: engineVersion, rotationVer: rotationVersion,
    dataMode: mode, files: { recipes: 'actions.json', scenarios: 'scenarios.json', teammates: 'teammates.json',
      refs: null, gameData: 'data/', interpreter: 'interpreter/' }, scenarios }, files)
}

/** package files as a RulesetFiles store for the engine's openRuleset. */
export function packageFiles(pkg) {
  return { read: async (path) => (pkg.files.has(path) ? new Uint8Array(Buffer.from(pkg.files.get(path))) : null) }
}

/**
 * bundle more of the engine's public surface for a Node tool. `also` maps other app
 * modules to names, bundled together so the app's module state exists once.
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

/** hash every file and write manifest.json last, over the hashes of the rest. */
function sealPackage(base, files) {
  files.delete('manifest.json')
  const hashes = Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, bytes]) => [path, { sha256: sha256(bytes), bytes: Buffer.byteLength(bytes) }]))
  const manifest = { ...base, hashes }
  files.set('manifest.json', rulesetJson(manifest))
  return { manifest, files, manifestSha256: sha256(files.get('manifest.json')) }
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)

/** a package with reference values (the refs step's output). Replaces any earlier refs.json. */
export function attachRefs({ manifest, files }, refs) {
  const scenarioIds = new Set(manifest.scenarios.map((scenario) => scenario.id))
  const seen = new Set()
  for (const entry of refs) {
    const key = `${entry.scenarioId}#${entry.sequence}`
    requireValue(scenarioIds.has(entry.scenarioId), `Refs name an unknown scenario ${entry.scenarioId}`)
    requireValue(integer(entry.sequence, 0, 6) && !seen.has(key), `Invalid or repeated refs ${key}`)
    requireValue(entry.status === 'ok' || entry.status === 'unsupported', `Invalid refs status ${key}`)
    requireValue(entry.status !== 'ok' || (finite(entry.baselineDps) && entry.baselineDps >= 0 &&
      entry.baselineDps < entry.benchDps && entry.benchDps < entry.perfectDps && finite(entry.perfectDps)),
    `Refs ${key} must rise from baseline to bench to perfect`)
    seen.add(key)
  }
  const ordered = [...refs].sort((a, b) => a.scenarioId < b.scenarioId ? -1 : a.scenarioId > b.scenarioId ? 1 : a.sequence - b.sequence)
  const next = new Map(files)
  next.set('refs.json', rulesetJson({ schema: 1, refs: ordered }))
  const { hashes: _hashes, ...base } = manifest
  return sealPackage({ ...base, files: { ...manifest.files, refs: 'refs.json' } }, next)
}

/** read a ruleset folder back into the package shape ({ manifest, files }). */
export async function readRulesetFolder(directory) {
  const manifest = await readJson(join(directory, 'manifest.json'))
  const files = new Map()
  for (const path of [...Object.keys(manifest.hashes), 'manifest.json']) {
    const text = await readFile(join(directory, path), 'utf8')
    requireValue(path === 'manifest.json' || sha256(text) === manifest.hashes[path].sha256, `${path} does not match its manifest hash`)
    files.set(path, text)
  }
  return { manifest, files, manifestSha256: sha256(files.get('manifest.json')) }
}

/** write a package into a new directory; existing rulesets are never overwritten. */
export async function writeRulesetFolder(output, pkg) {
  const directory = resolve(output)
  try {
    await lstat(directory)
    throw new Error(`Output already exists: ${directory}`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(dirname(directory), { recursive: true })
  await mkdir(directory)
  try {
    for (const [path, bytes] of pkg.files) {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(join(directory, path), bytes)
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true })
    throw error
  }
  return directory
}

/** a validated package gets a new directory; existing rulesets are never overwritten. */
export async function buildRuleset({ output, ...options } = {}) {
  requireValue(typeof output === 'string' && output.length > 0, 'An output directory is required')
  try {
    await lstat(resolve(output))
    throw new Error(`Output already exists: ${resolve(output)}`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const result = await assembleRuleset(options)
  const directory = await writeRulesetFolder(output, result)
  return { output: directory, id: result.manifest.id, manifestSha256: result.manifestSha256,
    plans: Object.keys(JSON.parse(result.files.get('actions.json')).plans).length,
    scenarios: result.manifest.scenarios.length, files: result.files.size, references: 'pending' }
}

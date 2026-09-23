import { readFile, readdir, mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

// Worker calculations need control/trace semantics, not skill prose or tables.
function runtimeDetails(detail) {
  if (!detail) return null
  const stripped = JSON.parse(JSON.stringify(detail, (key, value) =>
    ['body', 'desc', 'description', 'keywords', 'descriptionKeywords', 'param'].includes(key) ? undefined : value))
  stripped.skillsByTab = Object.fromEntries(Object.keys(detail.skillsByTab).map((tab) => [tab, {
    name: detail.skillsByTab[tab].name, desc: '', param: [], multipliers: [],
  }]))
  return stripped
}

const publicDir = fileURLToPath(new URL('../../public/', import.meta.url))

for (const mode of ['beta', 'live']) {
  const resonatorDir = join(publicDir, 'data', mode, 'resonators')
  const [sources, damageEntries, details, catalog] = await Promise.all([
    readFile(join(resonatorDir, 'sources.json'), 'utf8').then(JSON.parse),
    readFile(join(resonatorDir, 'damage-entries.json'), 'utf8').then(JSON.parse),
    readFile(join(resonatorDir, 'details.json'), 'utf8').then(JSON.parse),
    readFile(join(resonatorDir, 'catalog.json'), 'utf8').then(JSON.parse),
  ])
  await writeFile(join(resonatorDir, 'picker-catalog.json'), JSON.stringify(catalog.map((seed) => {
    const metadata = { ...seed }
    delete metadata.baseStatsByLevel
    delete metadata.traceNodes
    return metadata
  })))
  await writeFile(join(resonatorDir, 'feature-ids.json'), JSON.stringify(sources.flatMap((source) => (source.features ?? []).map((feature) => feature.id))))
  const entriesById = new Map()
  for (const entry of damageEntries) {
    const entries = entriesById.get(entry.resonatorId) ?? []
    entries.push(entry)
    entriesById.set(entry.resonatorId, entries)
  }
  const bundleDir = join(resonatorDir, 'worker-bundles')
  await mkdir(bundleDir, { recursive: true })
  const runtimeDir = join(resonatorDir, 'runtime-bundles')
  await mkdir(runtimeDir, { recursive: true })
  for (const source of sources) {
    const id = source.source.id
    await writeFile(join(bundleDir, `${id}.json`), JSON.stringify({
      source: { ...source, damageEntries: entriesById.get(id) ?? [] },
      details: details[id] ?? null,
      seed: catalog.find((entry) => entry.id === id),
    }))
    await writeFile(join(runtimeDir, `${id}.json`), JSON.stringify({
      source: { ...source, damageEntries: entriesById.get(id) ?? [] },
      details: runtimeDetails(details[id]),
      seed: catalog.find((entry) => entry.id === id),
    }))
  }
  const weaponDir = join(publicDir, 'data', mode, 'weapons')
  const [weaponCatalog, weaponSources] = await Promise.all([
    readFile(join(weaponDir, 'catalog.json'), 'utf8').then(JSON.parse),
    readFile(join(weaponDir, 'sources.json'), 'utf8').then(JSON.parse),
  ])
  const weaponRuntimeDir = join(weaponDir, 'runtime-bundles')
  await mkdir(weaponRuntimeDir, { recursive: true })
  for (const weapon of weaponCatalog) {
    await writeFile(join(weaponRuntimeDir, `${weapon.id}.json`), JSON.stringify({
      weapon: { ...weapon, passive: { name: weapon.passive.name, desc: '', params: [] } },
      source: weaponSources.find((source) => source.source.id === weapon.id) ?? null,
    }))
  }

  const enemyDir = join(publicDir, 'data', mode, 'enemies')
  const enemies = JSON.parse(await readFile(join(enemyDir, 'catalog.json'), 'utf8'))
  const summary = Object.fromEntries(enemies.flatMap((entry) => {
    const id = String(entry.Id ?? entry.id ?? '').trim()
    const name = String(entry.Name ?? entry.name ?? '').trim()
    const enemyClass = Number(entry.Class ?? entry.class ?? 0)
    if (!id || !name || ![1, 2, 3, 4].includes(enemyClass)) return []
    const rawElement = entry.Element ?? entry.element
    const rawId = typeof rawElement === 'object' && rawElement !== null
      ? rawElement.Id ?? rawElement.id
      : rawElement
    const element = rawId == null || rawId === '' ? NaN : Number(rawId)
    return [[id, {
      name,
      element: Number.isInteger(element) && element >= 0 && element <= 6 ? element : null,
    }]]
  }))
  await writeFile(join(enemyDir, 'summary.json'), JSON.stringify(summary))
}

const sourceDir = join(publicDir, 'assets', 'game', 'resonators', 'sprites')
const pickerDir = join(publicDir, 'assets', 'game', 'resonators', 'picker')
await mkdir(pickerDir, { recursive: true })
for (const filename of await readdir(sourceDir)) {
  if (!filename.endsWith('.webp')) continue
  const source = join(sourceDir, filename)
  const output = join(pickerDir, filename)
  const sourceStats = await stat(source)
  const outputStats = await stat(output).catch(() => null)
  if (outputStats && outputStats.mtimeMs >= sourceStats.mtimeMs) continue
  await sharp(source)
    .resize({ width: 320, withoutEnlargement: true })
    .webp({ quality: 85, effort: 5 })
    .toFile(output)
}

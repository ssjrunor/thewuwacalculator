/*
  Author: Runor Ewhro
  description: produces content-addressed display images without changing the
               canonical art used by saved builds and high-resolution exports.
*/
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../../', import.meta.url))
const defaultPublicDir = join(root, 'public')
const defaultManifestPath = join(root, 'src/shared/lib/displayAssets.generated.json')
const groups = [
  ['attributes/icons', false], ['echoes/icons', false], ['weapons/icons', false],
  ['resonators/profiles', false], ['enemies/icons', false],
  ['resonators/sprites', true],
]

export function displayFingerprint(bytes, settings) {
  return createHash('sha256').update(bytes).update(JSON.stringify(settings)).digest('hex').slice(0, 20)
}

async function writeAtomic(file, data) {
  const temporary = `${file}.tmp`
  await writeFile(temporary, data)
  await rename(temporary, file)
}

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  return (await Promise.all(entries.map((entry) => entry.isDirectory()
    ? filesUnder(join(dir, entry.name))
    : /\.(webp|png|jpe?g)$/i.test(entry.name) ? [join(dir, entry.name)] : []))).flat().sort()
}

export async function buildDisplayAssets({ publicDir = defaultPublicDir, manifestPath = defaultManifestPath, assetGroups = groups } = {}) {
  const outputDir = join(publicDir, 'assets/display')
  await mkdir(outputDir, { recursive: true })
  const raw = JSON.parse(await readFile(manifestPath, 'utf8').catch(() => '{}'))
  const previous = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value)
    ? { fingerprint: value[0], variants: value[1].map(([width, height]) => ({ src: `/assets/display/${value[0]}-${width}.webp`, width, height })) }
    : value]))
  const manifest = {}
  let written = 0
  for (const [directory, portrait] of assetGroups) {
    for (const source of await filesUnder(join(publicDir, 'assets/game', directory))) {
      const bytes = await readFile(source)
      const settings = { widths: portrait ? [320, 640, 960] : [64, 128, 256], quality: portrait ? 85 : 90, alphaQuality: 100, effort: 5, encoder: sharp.versions.vips, version: 2 }
      const fingerprint = displayFingerprint(bytes, settings)
      const key = '/' + relative(publicDir, source).split('\\').join('/')
      const cached = previous[key]
      if (cached?.fingerprint === fingerprint && (await Promise.all(cached.variants.map((v) => stat(join(publicDir, v.src)).then(() => true, () => false)))).every(Boolean)) {
        manifest[key] = cached
        continue
      }
      const metadata = await sharp(bytes, { animated: true }).metadata()
      if (!metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) continue
      const widths = [...new Set(settings.widths.map((width) => Math.min(width, metadata.width)))].sort((a, b) => a - b)
      const variants = []
      for (const width of widths) {
        const filename = `${fingerprint}-${width}.webp`
        const target = join(outputDir, filename)
        const existing = await stat(target).catch(() => null)
        // a previous interrupted generation may already have completed this
        // content-addressed file. decode it before trusting that partial run.
        if (existing?.size) {
          const decoded = await sharp(target).raw().toBuffer({ resolveWithObject: true }).catch(() => null)
          if (decoded?.info.width === width) {
            variants.push({ src: `/assets/display/${filename}`, width, height: decoded.info.height })
            continue
          }
        }
        const { data, info } = await sharp(bytes).resize({ width, withoutEnlargement: true })
          .webp({ quality: settings.quality, alphaQuality: settings.alphaQuality, effort: settings.effort }).toBuffer({ resolveWithObject: true })
        // avoid adding another lossy generation when the authored webp is
        // already smaller at the same resolution.
        const output = metadata.format === 'webp' && width === metadata.width && bytes.length <= data.length ? bytes : data
        await writeAtomic(target, output)
        variants.push({ src: `/assets/display/${filename}`, width: info.width, height: info.height })
        written += 1
      }
      manifest[key] = { fingerprint, variants }
    }
  }
  if (publicDir === defaultPublicDir) await buildLoaderAssets(outputDir)
  const compact = Object.fromEntries(Object.entries(manifest).map(([source, entry]) => [source, [entry.fingerprint, entry.variants.map(({ width, height }) => [width, height])]]))
  const json = JSON.stringify(compact) + '\n'
  if (json !== await readFile(manifestPath, 'utf8').catch(() => '')) await writeAtomic(manifestPath, json)
  console.log(`display assets: ${Object.keys(manifest).length} sources, ${written} variants written`)
}

export async function buildLoaderAssets(outputDir) {
  const rules = []
  for (const [filename, variable] of [['phoebe.webp', '--loader-mascot'], ['phoebe-still.webp', '--loader-mascot-still']]) {
    const source = await readFile(join(defaultPublicDir, 'assets/app/loader', filename))
    const metadata = await sharp(source, { animated: true }).metadata()
    const settings = { quality: 85, alphaQuality: 100, effort: 5, loop: metadata.loop, delay: metadata.delay }
    const hash = displayFingerprint(source, { ...settings, encoder: sharp.versions.vips, version: 1 })
    const name = `loader-${hash}.webp`
    const target = join(outputDir, name)
    if (!await stat(target).catch(() => null)) {
      const encoded = await sharp(source, { animated: true }).webp(settings).toBuffer()
      const result = await sharp(encoded, { animated: true }).metadata()
      const preserved = ['width', 'height', 'pages', 'loop', 'delay', 'hasAlpha'].every((key) => JSON.stringify(metadata[key]) === JSON.stringify(result[key]))
      await writeAtomic(target, preserved && encoded.length < source.length ? encoded : source)
    }
    rules.push(`  ${variable}: url('/assets/display/${name}');`)
  }
  const css = ':root {\n' + rules.join('\n') + '\n}\n'
  const path = join(root, 'src/styles/ui/loader-assets.generated.css')
  if (css !== await readFile(path, 'utf8').catch(() => '')) await writeAtomic(path, css)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await buildDisplayAssets()

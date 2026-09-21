import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = process.cwd()
const SRC = path.join(ROOT, 'src')
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])
const LAYERS = new Set([
  'app',
  'application',
  'cloudflare',
  'data',
  'domain',
  'engine',
  'infra',
  'modules',
  'shared',
])

const ALLOWED = {
  shared: new Set(['shared']),
  domain: new Set(['domain', 'shared']),
  data: new Set(['data', 'domain', 'shared']),
  engine: new Set(['engine', 'data', 'domain', 'shared']),
  infra: new Set(['infra', 'domain', 'shared']),
  application: new Set(['application', 'infra', 'engine', 'data', 'domain', 'shared']),
  modules: new Set(['modules', 'application', 'engine', 'data', 'domain', 'shared']),
  app: new Set(['app', 'application', 'modules', 'infra', 'engine', 'data', 'domain', 'shared']),
  cloudflare: new Set(['cloudflare', 'application', 'infra', 'data', 'domain', 'shared']),
}

function listFiles(directory, result = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!['__tests__', '__benchmarks__'].includes(entry.name)) listFiles(absolute, result)
      continue
    }
    if (!CODE_EXTENSIONS.has(path.extname(entry.name))) continue
    if (/\.(?:test|spec|invariants)(?:\.[^.]+)?\.[cm]?[jt]sx?$/.test(entry.name)) continue
    result.push(absolute)
  }
  return result
}

function importSpecifiers(sourceFile) {
  const specifiers = []
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function resolveSourceImport(sourceFile, specifier) {
  const clean = specifier.split('?')[0]
  if (clean.startsWith('@/')) return path.join(SRC, clean.slice(2))
  if (clean.startsWith('.')) return path.resolve(path.dirname(sourceFile), clean)
  return null
}

function sourceRelative(absolute) {
  return path.relative(SRC, absolute).split(path.sep).join('/')
}

function layerOf(absolute) {
  const first = sourceRelative(absolute).split('/')[0]
  return LAYERS.has(first) ? first : null
}

function moduleName(absolute) {
  const parts = sourceRelative(absolute).split('/')
  return parts[0] === 'modules' ? parts[1] : null
}

function isPublicModuleEntry(absolute) {
  const relative = sourceRelative(absolute)
  return relative.includes('/api/') || relative.includes('/pages/')
}

const errors = []

for (const file of listFiles(SRC)) {
  const sourceLayer = layerOf(file)
  if (!sourceLayer) continue

  const sourceText = fs.readFileSync(file, 'utf8')
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true)

  for (const specifier of importSpecifiers(sourceFile)) {
    const target = resolveSourceImport(file, specifier)
    if (!target) continue
    const targetLayer = layerOf(target)
    if (!targetLayer) continue

    if (!ALLOWED[sourceLayer].has(targetLayer)) {
      errors.push(`${sourceRelative(file)} -> ${specifier}: ${sourceLayer} cannot import ${targetLayer}`)
      continue
    }

    if (sourceLayer === 'app' && targetLayer === 'modules' && !isPublicModuleEntry(target)) {
      errors.push(`${sourceRelative(file)} -> ${specifier}: app must use a module api/ or pages/ entry`)
      continue
    }

    if (sourceLayer === 'modules' && targetLayer === 'modules') {
      const sourceModule = moduleName(file)
      const targetModule = moduleName(target)
      if (sourceModule !== targetModule && !isPublicModuleEntry(target)) {
        errors.push(`${sourceRelative(file)} -> ${specifier}: cross-module imports must use api/ or pages/`)
      }
    }
  }
}

if (errors.length) {
  console.error(`Architecture import check failed (${errors.length}):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exitCode = 1
} else {
  console.log('Architecture import check passed.')
}

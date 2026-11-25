/*
  Author: Runor Ewhro
  description: configures eslint for project source and excludes generated files, build output, and local archives.
*/

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import path from 'node:path'

/** relative imports must resolve inside their root: the app outside services/ and scripts/, the service outside the app. */
const boundaries = {
  rules: {
    'stay-inside': {
      meta: { type: 'problem', schema: [{ type: 'object', properties: { root: { type: 'string' }, also: { type: 'array', items: { type: 'string' } }, message: { type: 'string' } } }] },
      create(context) {
        const { root, also = [], message } = context.options[0]
        const bases = [root, ...also].map((dir) => path.resolve(context.cwd, dir))
        const check = (node) => {
          const spec = node?.source?.value
          if (typeof spec !== 'string' || !spec.startsWith('.')) return
          const target = path.resolve(path.dirname(context.filename), spec.replace(/\?.*$/, ''))
          if (!bases.some((base) => target === base || target.startsWith(base + path.sep))) context.report({ node: node.source, message: `${spec}: ${message}` })
        }
        return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check, ImportExpression: check }
      },
    },
  },
}

export default defineConfig([
  globalIgnores(['dist', 'legacy/**', '**/.wrangler/**', 'scripts/ingest/reference/**', 'src/data/generated/**', 'src/data/resonators/generated.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/engine/**/*.{ts,tsx}', 'src/domain/**/*.{ts,tsx}', 'src/data/gameData/**/*.{ts,tsx}'],
    ignores: ['**/__tests__/**', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'core modules cannot import React.' },
          { name: 'react-dom', message: 'core modules cannot import react-dom.' },
          { name: 'react-router-dom', message: 'core modules cannot import router APIs; pass route-dependent policy as an argument.' },
        ],
        patterns: [
          {
            group: ['@/app', '@/app/*', '@/modules', '@/modules/*', '@/application', '@/application/*', '@/infra', '@/infra/*'],
            message: 'core and domain modules cannot import app or infrastructure modules.',
          },
          {
            // WorkerChannel has no app-layer imports and is used by browser worker clients.
            regex: '^@/shared/(?!lib/WorkerChannel(\\.ts)?$)',
            message: 'import the helper from an engine or domain module.',
          },
        ],
      }],
    },
  },
  {
    files: ['services/leaderboard/**/*.{ts,tsx}'],
    // tools/ are node scripts run from a checkout (local dev and the scorer deploy), not worker code.
    ignores: ['services/leaderboard/tools/**'],
    languageOptions: { globals: globals.worker },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'the leaderboard service cannot import React.' },
          { name: 'react-dom', message: 'the leaderboard service cannot import react-dom.' },
          { name: 'react-router-dom', message: 'the leaderboard service cannot import router APIs.' },
        ],
        // the service imports the app only through the @lb aliases (tsconfig.json paths), and lifting it out repoints those
        // three; @lb/parser-version is one constant with no imports and adds no engine code
        patterns: [{
          regex: '^@/',
          message: 'import the app only through @lb/contract/*, @lb/scoring and @lb/parser-version.',
        }],
      }],
      'boundaries/stay-inside': ['error', { root: 'services/leaderboard', message: 'the service reaches the app only through the @lb aliases.' }],
    },
    plugins: { boundaries },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    rules: {
      'boundaries/stay-inside': ['error', { root: 'src', also: ['public'], message: 'app code and its tests stay inside src and public (services/ and scripts/ are not part of the app).' }],
    },
  },
])

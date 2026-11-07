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

export default defineConfig([
  globalIgnores(['dist', 'legacy/**', 'wip/**', 'scripts/ingest/reference/**', 'src/data/generated/**', 'src/data/resonators/generated.ts']),
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
    languageOptions: { globals: globals.worker },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'react', message: 'the leaderboard service cannot import React.' },
          { name: 'react-dom', message: 'the leaderboard service cannot import react-dom.' },
          { name: 'react-router-dom', message: 'the leaderboard service cannot import router APIs.' },
        ],
        patterns: [{
          regex: '^@/(?!engine/leaderboard(/index(\\.ts)?)?$|domain/leaderboard(/[A-Za-z]+(\\.ts)?)?$)',
          message: 'import only @/engine/leaderboard and @/domain/leaderboard modules.',
        }],
      }],
    },
  },
])

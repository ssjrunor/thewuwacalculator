#!/usr/bin/env node
/*
  Author: Runor Ewhro
  description: exports the remote leaderboard database (schema and data) and
               keeps it gzipped in the private twc-lb-backups bucket as
               d1/<utc timestamp>.sql.gz; the bucket's lifecycle rule expires
               copies after 90 days. d1 time travel already restores any minute
               of the last 30 days (7 on the free plan); this copy is for older
               points and for leaving cloudflare. card images are not copied:
               the database names them by hash and they are evidence, not state.

  node services/leaderboard/tools/backup.mjs [--keep-local DIR] [--dry-run]

  restore: gunzip, then `wrangler d1 execute twc-leaderboard --remote --file dump.sql`
  into an empty database (see README, Backups).
*/

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const { values } = parseArgs({ options: { 'keep-local': { type: 'string' }, 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } } })
if (values.help) {
  process.stdout.write('Usage: backup.mjs [--keep-local DIR] [--dry-run]\n')
  process.exit(0)
}

const DATABASE = 'twc-leaderboard'
const BUCKET = 'twc-lb-backups'
const service = fileURLToPath(new URL('..', import.meta.url))
const wrangler = (args) => execFileSync('npx', ['wrangler', ...args, '-c', 'wrangler.jsonc'], { cwd: service, stdio: ['ignore', 'pipe', 'inherit'] })

const scratch = mkdtempSync(join(tmpdir(), 'lb-backup-'))
try {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dump = join(scratch, `${stamp}.sql`)
  wrangler(['d1', 'export', DATABASE, '--remote', '--output', dump])
  const sql = readFileSync(dump)
  if (!/CREATE TABLE/i.test(sql.toString('utf8', 0, Math.min(sql.length, 1 << 20)))) throw new Error('the export has no schema; refusing to keep it')
  const packed = join(scratch, `${stamp}.sql.gz`)
  writeFileSync(packed, gzipSync(sql, { level: 9 }))
  const key = `d1/${stamp}.sql.gz`
  console.log(`exported ${(sql.length / 1024).toFixed(1)} KiB, ${(statSync(packed).size / 1024).toFixed(1)} KiB gzipped`)
  if (values['keep-local']) {
    const dir = resolve(values['keep-local'])
    mkdirSync(dir, { recursive: true })
    copyFileSync(packed, join(dir, `${stamp}.sql.gz`))
    console.log(`kept ${join(dir, `${stamp}.sql.gz`)}`)
  }
  if (values['dry-run']) console.log(`dry run: not uploaded (${BUCKET}/${key})`)
  else {
    wrangler(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', packed, '--content-type', 'application/gzip', '--remote'])
    console.log(`stored ${BUCKET}/${key}`)
  }
} finally {
  rmSync(scratch, { recursive: true, force: true })
}

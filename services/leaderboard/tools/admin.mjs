#!/usr/bin/env node
/*
  Author: Runor Ewhro
  description: the moderation and health desk from a terminal, over the
               deployed api's /admin routes (lib/admin.mjs: an access service
               token and LB_API_ORIGIN). every write is audited by the api with
               the service token's identity.

  node services/leaderboard/tools/admin.mjs <command> [args] [--api ORIGIN] [--json]
    health [--hours N]                    pipeline numbers for the last N hours (default 24)
    reports                               open reports, oldest first
    resolve <reportId> [--hide] [--block] [--note TEXT]
    dismiss <reportId> [--note TEXT]
    hide <buildId>                        take a build off every board
    restore <buildId>                     a hidden build returns as history; its owner may make it active again
    block <cardId>                        refuse the card's link for good (hide its build separately)
*/

import { parseArgs } from 'node:util'
import { adminClient } from './lib/admin.mjs'

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  api: { type: 'string' }, json: { type: 'boolean' }, hours: { type: 'string' }, hide: { type: 'boolean' },
  block: { type: 'boolean' }, note: { type: 'string' }, help: { type: 'boolean' },
} })

const USAGE = `Usage: admin.mjs <command> [args] [--api ORIGIN] [--json]
  health [--hours N]
  reports
  resolve <reportId> [--hide] [--block] [--note TEXT]
  dismiss <reportId> [--note TEXT]
  hide <buildId>
  restore <buildId>
  block <cardId>
`

const [command, subject] = positionals
const needsSubject = ['resolve', 'dismiss', 'hide', 'restore', 'block']
if (values.help || !command || (needsSubject.includes(command) && !subject)) {
  process.stdout.write(USAGE)
  process.exit(values.help ? 0 : 1)
}

const admin = adminClient(values.api)
const print = (value) => console.log(JSON.stringify(value, null, 2))

function printHealth(report) {
  const counts = (record) => Object.entries(record).map(([key, n]) => `${key} ${n}`).join(', ') || 'none'
  console.log(`last ${report.windowHours}h`)
  console.log(`  cards     ${counts(report.cards.submitted)}; stuck pending ${report.cards.stuckPending}`)
  console.log(`  reads     ${counts(report.reads.outcomes)}; reader errors ${report.reads.readerErrors}; ` +
    `wall ms avg ${report.reads.wallMs.avg ?? '-'} max ${report.reads.wallMs.max ?? '-'}`)
  console.log(`  dead      ${counts(report.deadLetters)}`)
  const { jobs } = report.scoring
  console.log(`  scoring   ${report.scoring.rulesetId ?? 'no live ruleset'}: ${jobs.scored} scored, ${jobs.failed} failed, ` +
    `${jobs.scoring} scoring (${report.scoring.stale} stale); error rows ${report.scoring.errorRows}`)
  console.log(`  reports   ${report.reports.open} open`)
  console.log(`  sessions  ${report.sessions.live} live`)
  const alarms = [
    report.cards.stuckPending && 'cards stuck pending',
    Object.keys(report.deadLetters).length && 'dead letters',
    report.scoring.stale && 'stale score jobs',
    report.reads.readerErrors && 'reader errors',
  ].filter(Boolean)
  console.log(alarms.length ? `  look at: ${alarms.join(', ')}` : '  all quiet')
  return alarms.length
}

function printReports({ reports }) {
  if (!reports.length) return console.log('no open reports')
  for (const report of reports) {
    console.log(`${report.id}  ${new Date(report.created_at).toISOString()}  ${report.reason}  build ${report.build_id}` +
      (report.details ? `\n    ${report.details}` : ''))
  }
}

switch (command) {
  case 'health': {
    const report = await admin('GET', `/health${values.hours ? `?hours=${Number(values.hours)}` : ''}`)
    if (values.json) print(report)
    // exits 3 when something needs looking at, so a scheduled check can alert on it.
    else if (printHealth(report)) process.exitCode = 3
    break
  }
  case 'reports': {
    const reports = await admin('GET', '/reports')
    if (values.json) print(reports)
    else printReports(reports)
    break
  }
  case 'resolve':
  case 'dismiss':
    print(await admin('POST', `/reports/${subject}`, {
      status: command === 'resolve' ? 'resolved' : 'dismissed', resolution: values.note ?? null,
      hideBuild: values.hide === true, blockCard: values.block === true,
    }))
    break
  case 'hide': print(await admin('POST', `/builds/${subject}/hide`, {})); break
  case 'restore': print(await admin('POST', `/builds/${subject}/restore`, {})); break
  case 'block': print(await admin('POST', `/cards/${subject}/block`, {})); break
  default:
    process.stdout.write(USAGE)
    process.exitCode = 1
}

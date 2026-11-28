#!/usr/bin/env node
/*
  Author: Runor Ewhro
  description: the moderation and health desk from a terminal, over the
               deployed api's /admin routes (lib/admin.mjs: an access service
               token and LB_API_ORIGIN). every write is audited by the api with
               the service token's identity.

  node services/leaderboard/tools/admin.mjs <command> [args] [--api ORIGIN] [--json]
    health [--hours N]                    pipeline numbers for the last N hours (default 24)
    submit <link or card name> [--wait]   submit a card without turnstile; --wait polls until the read finishes
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
  block: { type: 'boolean' }, wait: { type: 'boolean' }, note: { type: 'string' }, help: { type: 'boolean' },
} })

const USAGE = `Usage: admin.mjs <command> [args] [--api ORIGIN] [--json]
  health [--hours N]
  submit <link or card name> [--wait]
  reports
  resolve <reportId> [--hide] [--block] [--note TEXT]
  dismiss <reportId> [--note TEXT]
  hide <buildId>
  restore <buildId>
  block <cardId>
`

const [command, subject] = positionals
const needsSubject = ['submit', 'resolve', 'dismiss', 'hide', 'restore', 'block']
if (values.help || !command || (needsSubject.includes(command) && !subject)) {
  process.stdout.write(USAGE)
  process.exit(values.help ? 0 : 1)
}

const admin = adminClient(values.api)
const print = (value) => console.log(JSON.stringify(value, null, 2))

function printHealth(report) {
  const counts = (record) => Object.entries(record ?? {}).map(([key, n]) => `${key} ${n}`).join(', ') || 'none'
  const when = (at) => new Date(at).toISOString().replace('T', ' ').slice(0, 16)
  console.log(`last ${report.windowHours}h`)
  console.log(`  cards     stuck pending ${report.cards.stuckPending}; refused ${counts(report.cards.refused)}`)
  for (const card of report.cards.recentRefused ?? []) {
    console.log(`    ${when(card.at)}  ${card.id}  ${card.reason}${card.uid ? `  uid ${card.uid}` : ''}` +
      `${card.evidence ? `  ${card.evidence}` : ''}${card.imageKept ? '' : '  (image erased)'}`)
  }
  console.log(`  dead      ${counts(report.deadLetters)}`)
  const { jobs } = report.scoring
  console.log(`  scoring   ${report.scoring.rulesetId ?? 'no live ruleset'}` +
    (jobs ? `: ${jobs.scored} scored, ${jobs.failed} failed, ${jobs.scoring} scoring` : '') + `; error rows ${report.scoring.errorRows}`)
  console.log(`  reports   ${report.reports.open} open`)
  console.log(`  sessions  ${report.sessions.live} live`)
  const alarms = [
    report.cards.stuckPending && 'cards stuck pending',
    report.cards.refused?.read_failed && 'reads failing',
    Object.keys(report.deadLetters).length && 'dead letters',
  ].filter(Boolean)
  console.log(alarms.length ? `  look at: ${alarms.join(', ')}` : '  all quiet')
  return alarms.length
}

function printReports({ reports }) {
  if (!reports.length) return console.log('no open reports')
  for (const report of reports) {
    console.log(`${report.id}  ${new Date(report.createdAt).toISOString()}  ${report.reason}  build ${report.buildId}` +
      (report.assignedTo ? `  taken by ${report.assignedTo}` : '') +
      (report.details ? `\n    ${report.details}` : ''))
  }
}

switch (command) {
  case 'health': {
    const report = await admin('GET', `/health${values.hours ? `?hours=${Number(values.hours)}` : ''}`)
    if (values.json) print(report)
    // exits 3 when something needs attention, so a scheduled check can alert on it
    else if (printHealth(report)) process.exitCode = 3
    break
  }
  case 'submit': {
    const started = Date.now()
    let status = await admin('POST', '/cards', { input: subject })
    console.log(`card ${status.cardId}: ${status.status}${status.duplicate ? ' (already known)' : ''}`)
    if (values.wait) {
      // the public status route needs no access token; poll it every 2s while the card is pending or reading, and
      // stop after 180s
      const origin = (values.api ?? process.env.LB_API_ORIGIN).replace(/\/$/, '')
      while ((status.status === 'pending' || status.status === 'reading') && Date.now() - started < 180_000) {
        await new Promise((resolve) => setTimeout(resolve, 2000))
        status = await (await fetch(`${origin}/api/lb/cards/${status.cardId}`)).json()
      }
      console.log(`${status.status}${status.rejectReason ? ` (${status.rejectReason})` : ''} after ${((Date.now() - started) / 1000).toFixed(1)}s`)
      if (status.buildId) console.log(`build ${status.buildId}`)
    }
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

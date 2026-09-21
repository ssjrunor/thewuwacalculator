/*
  Author: Runor Ewhro
  Description: Runs the real build-card parser inside the dev server on every
               card in a folder and scores each field against expected.json.
               Needs `npm run dev` up and the cached Playwright Chromium.

  node tools/analysis/importCardBench.mjs [--dir ref/import-cards] [--port 5174] [--only name] [--raw]
      [--shift dx,dy] [--scale WxH] [--jpeg quality]

  --shift moves each card's content inside the same frame (a crop on one side,
  padding on the other); --scale resizes the whole card; --jpeg re-encodes it.
*/

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}
const DIR = flag('dir', 'ref/import-cards')
const PORT = Number(flag('port', '5174'))
const ONLY = flag('only', null)
const RAW = args.includes('--raw')
const SHIFT = flag('shift', null)?.split(',').map(Number) ?? null
const SCALE = flag('scale', null)?.split('x').map(Number) ?? null
const JPEG = flag('jpeg', null) === null ? null : Number(flag('jpeg', null))
const TRANSFORM = { shift: SHIFT, scale: SCALE, jpeg: JPEG }
const ORIGIN = `http://localhost:${PORT}`

function findChrome() {
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  const builds = existsSync(cache)
    ? readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse()
    : []
  for (const build of builds) {
    const path = join(cache, build, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    if (existsSync(path)) return path
  }
  throw new Error('no cached Playwright Chromium; run `npx playwright install chromium`')
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function openPage() {
  const profile = mkdtempSync(join(tmpdir(), 'import-bench-'))
  const port = 9300 + Math.floor(Math.random() * 500)
  const chrome = spawn(findChrome(), [
    '--headless=new',
    '--disable-gpu',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let target = null
  for (let attempt = 0; attempt < 50 && !target; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
      target = targets.find((entry) => entry.type === 'page') ?? null
    } catch {
      // chrome is still starting
    }
    if (!target) await wait(200)
  }
  if (!target) throw new Error('chromium did not open a page')

  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve) => socket.addEventListener('open', resolve))
  const pending = new Map()
  let nextId = 0
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    nextId += 1
    pending.set(nextId, resolve)
    socket.send(JSON.stringify({ id: nextId, method, params }))
  })

  const close = () => {
    socket.close()
    chrome.kill()
    rmSync(profile, { recursive: true, force: true })
  }
  return { send, close }
}

// one card per evaluate, so a slow card never trips the CDP timeout
const PARSE_CARD = (url) => `(async () => {
  const ocr = await import('/src/engine/echoParser/ocrParsing.ts')
  const builder = await import('/src/engine/echoParser/echoBuilder.ts')
  const transform = ${JSON.stringify(TRANSFORM)}
  let blob = await (await fetch(${JSON.stringify(url)})).blob()
  if (transform.shift || transform.scale || transform.jpeg !== null) {
    const bitmap = await createImageBitmap(blob)
    const [width, height] = transform.scale ?? [bitmap.width, bitmap.height]
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    context.fillStyle = '#15121c'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingQuality = 'high'
    const [dx, dy] = transform.shift ?? [0, 0]
    context.drawImage(bitmap, dx * width / bitmap.width, dy * height / bitmap.height, width, height)
    blob = await new Promise((resolve) => canvas.toBlob(
      resolve,
      transform.jpeg !== null ? 'image/jpeg' : 'image/png',
      transform.jpeg ?? undefined,
    ))
  }
  const file = new File([blob], 'card', { type: blob.type })
  const started = performance.now()
  try {
    const parsed = await ocr.prsBldFromMg(file)
    const built = builder.mkEchoNstnFr(parsed.echoes)
    return JSON.stringify({
      ms: Math.round(performance.now() - started),
      player: parsed.player,
      resonator: parsed.resonator,
      weapon: parsed.weapon,
      raw: parsed.echoes,
      built: built.map((echo) => echo && {
        main: echo.mainStats.primary.key,
        substats: echo.substats,
      }),
    })
  } catch (error) {
    return JSON.stringify({ error: String(error && error.message || error) })
  }
})()`

function scoreCard(expected, got) {
  const checks = []
  const check = (field, want, have) => {
    checks.push({ field, ok: String(want) === String(have), want, have })
  }

  if (got.error) {
    checks.push({ field: 'parse', ok: false, want: 'a result', have: got.error })
    return checks
  }

  check('resonator', expected.resonator.name, got.resonator.name)
  check('level', expected.resonator.level, got.resonator.level)
  check('sequence', expected.resonator.sequence, got.resonator.sequence)
  for (const [skill, level] of Object.entries(expected.resonator.skillLevels)) {
    check(`skill.${skill}`, level, got.resonator.skillLevels[skill])
  }
  check('player.id', expected.player.id, got.player.id)
  check('player.uid', expected.player.uid, got.player.uid)
  check('weapon', expected.weapon.name, got.weapon.name)
  check('weapon.level', expected.weapon.level, got.weapon.level)

  expected.echoes.forEach((echo, index) => {
    const slot = `slot${index + 1}`
    const built = got.built[index]
    if (echo === null) {
      check(`${slot}.empty`, 'empty', built ? `an echo (${got.raw[index].echoName})` : 'empty')
      return
    }
    check(`${slot}.cost`, echo.cost, got.raw[index].cost)
    check(`${slot}.main`, echo.main, built?.main ?? 'no echo')
    for (const [key, value] of Object.entries(echo.substats)) {
      check(`${slot}.${key}`, value, built?.substats[key] ?? 'missing')
    }
    for (const key of Object.keys(built?.substats ?? {})) {
      if (!(key in echo.substats)) {
        checks.push({ field: `${slot}.${key}`, ok: false, want: 'absent', have: built.substats[key] })
      }
    }
  })
  return checks
}

// fields fold into groups so the totals read at a glance
function groupOf(field) {
  if (field.startsWith('skill.')) return 'skill levels'
  if (/^slot\d\.(cost)$/.test(field)) return 'echo cost'
  if (/^slot\d\.(main)$/.test(field)) return 'echo main stat'
  if (/^slot\d\.empty$/.test(field)) return 'empty slot'
  if (field.startsWith('slot')) return 'substats'
  return field
}

async function main() {
  const manifest = JSON.parse(readFileSync(join(DIR, 'expected.json'), 'utf8'))
  const cards = manifest.cards.filter((card) => !ONLY || card.file.includes(ONLY))

  try {
    await fetch(ORIGIN)
  } catch {
    throw new Error(`no dev server on ${ORIGIN}; start it with npm run dev`)
  }

  const active = Object.entries(TRANSFORM).filter(([, value]) => value !== null)
  if (active.length > 0) console.log(`transform ${active.map(([key, value]) => `${key}=${value}`).join(' ')}\n`)

  const page = await openPage()
  const totals = new Map()
  const misses = []
  let cardsClean = 0

  try {
    await page.send('Page.enable')
    await page.send('Page.navigate', { url: `${ORIGIN}/` })
    await wait(5000)

    for (const card of cards) {
      const url = `/${DIR}/${encodeURIComponent(card.file)}`
      const response = await page.send('Runtime.evaluate', {
        expression: PARSE_CARD(url),
        awaitPromise: true,
        timeout: 120000,
      })
      const value = response.result?.result?.value
      const got = value ? JSON.parse(value) : { error: JSON.stringify(response.result?.exceptionDetails ?? response).slice(0, 300) }
      const checks = scoreCard(card, got)
      const passed = checks.filter((entry) => entry.ok).length
      if (passed === checks.length) cardsClean += 1

      for (const entry of checks) {
        const group = groupOf(entry.field)
        const tally = totals.get(group) ?? { ok: 0, all: 0 }
        tally.all += 1
        if (entry.ok) tally.ok += 1
        totals.set(group, tally)
        if (!entry.ok) misses.push({ card: card.file, ...entry })
      }

      if (RAW && passed !== checks.length) {
        console.log(JSON.stringify({ player: got.player, resonator: got.resonator, weapon: got.weapon }))
        got.raw?.forEach((echo, index) => console.log(`  slot${index + 1}`, JSON.stringify(echo)))
      }
      const mark = passed === checks.length ? 'ok ' : 'MISS'
      console.log(`${mark} ${String(passed).padStart(3)}/${String(checks.length).padEnd(3)} ${String(got.ms ?? '-').padStart(5)}ms  ${card.resonator.name.padEnd(18)} ${card.file}`)
    }
  } finally {
    page.close()
  }

  console.log('\nby field')
  let ok = 0
  let all = 0
  for (const [group, tally] of totals) {
    ok += tally.ok
    all += tally.all
    const rate = ((tally.ok / tally.all) * 100).toFixed(1)
    console.log(`  ${group.padEnd(16)} ${String(tally.ok).padStart(4)}/${String(tally.all).padEnd(4)} ${rate.padStart(5)}%`)
  }
  console.log(`  ${'all fields'.padEnd(16)} ${String(ok).padStart(4)}/${String(all).padEnd(4)} ${((ok / all) * 100).toFixed(1).padStart(5)}%`)
  console.log(`  ${'clean cards'.padEnd(16)} ${String(cardsClean).padStart(4)}/${String(cards.length).padEnd(4)}`)

  if (misses.length > 0) {
    console.log('\nmisses')
    for (const miss of misses) {
      console.log(`  ${miss.card.slice(0, 24).padEnd(24)} ${miss.field.padEnd(30)} want ${JSON.stringify(miss.want)}  got ${JSON.stringify(miss.have)}`)
    }
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 2
})

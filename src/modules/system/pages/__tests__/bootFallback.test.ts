/*
  Author: Runor Ewhro
  Description: Ensures the HTML emergency notice appears when the entry module
               never executes, and stays hidden after the app starts.
*/

import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const script = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .find((source) => source.includes('boot-fallback-message'))

function runGuard() {
  if (!script) throw new Error('HTML boot guard is missing')
  const message = { textContent: '' }
  const stack = { textContent: '' }
  const fallback = { hidden: true }
  const root = { childElementCount: 0 }
  const documentElement = {
    dataset: { appEntryStarted: '' },
  }
  const elements: Record<string, unknown> = {
    root,
    'boot-fallback': fallback,
    'boot-fallback-message': message,
    'boot-fallback-stack': stack,
    'boot-fallback-reload': { addEventListener: () => undefined },
    'boot-fallback-copy': { addEventListener: () => undefined },
  }
  const timers: Array<{ callback: () => void; delay: number }> = []
  const events: string[] = []
  const document = {
    documentElement,
    getElementById: (id: string) => elements[id],
  }
  runInNewContext(script, {
    document,
    window: {
      addEventListener: () => undefined,
      dispatchEvent: (event: { type: string }) => events.push(event.type),
    },
    Event: class {
      type: string
      constructor(type: string) { this.type = type }
    },
    location: { origin: 'http://localhost', href: 'http://localhost/', reload: () => undefined },
    setTimeout: (callback: () => void, delay: number) => timers.push({ callback, delay }),
  })
  return { documentElement, fallback, message, stack, timers, events }
}

describe('HTML boot fallback', () => {
  it('shows a diagnostic when the entry module never executes', () => {
    const guard = runGuard()
    guard.timers.find((timer) => timer.delay === 5000)?.callback()

    expect(guard.fallback.hidden).toBe(false)
    expect(guard.message.textContent).toContain('entry module did not start')
    expect(guard.stack.textContent).toContain('entry module did not start')
    expect(guard.events).toContain('app:startup-notice')
  })

  it('stays hidden once the app has started', () => {
    const guard = runGuard()
    guard.documentElement.dataset.appEntryStarted = 'true'
    guard.timers.find((timer) => timer.delay === 5000)?.callback()

    expect(guard.fallback.hidden).toBe(true)
  })
})

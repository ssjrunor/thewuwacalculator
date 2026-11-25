/*
  Author: Runor Ewhro
  description: the on/off switch and output of the timing logs
               (requestTiming.ts), free of the query library so the app entry can
               mark its own steps. on in dev; elsewhere set localStorage
               'lb.timing' to '1' ('0' turns it off in dev).
*/

export const timingOn = (() => {
  try {
    const flag = typeof localStorage !== 'undefined' ? localStorage.getItem('lb.timing') : null
    return flag === '1' || (flag !== '0' && import.meta.env.DEV)
  } catch {
    return import.meta.env.DEV
  }
})()

export const timingMs = (value: number) => `${Math.round(value).toLocaleString()}ms`

/** one timing line in the console. */
export function timingLine(text: string): void {
  console.info(`%c[timing]%c ${text}`, 'color:#4fb8a8', 'color:inherit')
}

/** marks a page loading step (code started, game data loaded, a page mounted), shown beside data timings in the logs. */
export function markPage(label: string): void {
  if (!timingOn) return
  // dev's StrictMode mounts twice in a row: one line for the pair.
  const at = performance.now()
  if (last.label === label && at - last.at < 100) return
  last = { label, at }
  timingLine(`page: ${label} at +${timingMs(at)}`)
}

let last = { label: '', at: 0 }

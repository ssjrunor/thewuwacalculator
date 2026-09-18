/*
  Author: Runor Ewhro
  Description: Remembers beta notice acknowledgement for the local calendar day.
*/

const BETA_NOTICE_STORE = 'seen-beta-notice-day'

// Local date components expire acknowledgement at local midnight, not UTC midnight.
function dayKey(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function isBetaNoticeAcknowledgedToday(now = new Date()): boolean {
  try {
    return localStorage.getItem(BETA_NOTICE_STORE) === dayKey(now)
  } catch {
    return false
  }
}

export function acknowledgeBetaNotice(now = new Date()): void {
  try {
    localStorage.setItem(BETA_NOTICE_STORE, dayKey(now))
  } catch {
    // Storage restrictions must not prevent entry after acknowledgement.
  }
}

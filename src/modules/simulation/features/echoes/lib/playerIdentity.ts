/*
  Author: Runor Ewhro
  Description: Compares the account a build card carries against the saved one
               and says what the prompt should ask.
*/

import type { ParsedBuildMetadata } from '@/engine/echoParser/buildMetadata'

export interface PlayerIdentity {
  playerId: string
  playerUid: string
}

export type IdentityCase = 'first' | 'renamed' | 'blank' | 'misread' | 'different'

export interface IdentityAsk {
  kase: IdentityCase
  title: string
  lead: string
  /** the door that leads, and what it does */
  confirmLabel: string
  cancelLabel: string
  confirmKeeps: boolean
  tone: 'info' | 'warn'
  verdict: string
}

// Group numeric UIDs into stable three-digit segments without changing other ids.
export function groupUid(uid: string): string {
  return /^\d+$/.test(uid) ? uid.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') : uid
}

export function readIdentity(player: ParsedBuildMetadata['player']): PlayerIdentity {
  return { playerId: player.id ?? '', playerUid: player.uid ?? '' }
}

export function idntyDffrs(saved: PlayerIdentity, card: PlayerIdentity): boolean {
  return saved.playerId !== card.playerId || saved.playerUid !== card.playerUid
}

// how many places two UIDs disagree in, padded so a dropped digit still counts
export function uidDgtDff(left: string, right: string): number {
  const width = Math.max(left.length, right.length)
  let count = 0
  for (let index = 0; index < width; index += 1) {
    if (left[index] !== right[index]) count += 1
  }
  return count
}

function nameOf(identity: PlayerIdentity): string {
  return identity.playerId || 'no name read'
}

export function askForIdntty(saved: PlayerIdentity, card: PlayerIdentity): IdentityAsk {
  const hadSaved = Boolean(saved.playerId || saved.playerUid)
  const digits = uidDgtDff(saved.playerUid, card.playerUid)

  if (!hadSaved) {
    return {
      kase: 'first',
      title: 'Ouu, new player ID spotted~',
      lead: `Hey uh.. ${nameOf(card)}, we don't have this id on here yet, wanna save it or nah?`,
      confirmLabel: `Save ${nameOf(card)}`,
      cancelLabel: "I'll pass",
      confirmKeeps: false,
      tone: 'info',
      verdict: 'new id (,; ⩌ ;,)',
    }
  }

  if (card.playerUid === saved.playerUid && !card.playerId) {
    return {
      kase: 'blank',
      title: "Hmm... we couldn't get that id..",
      lead: 'The UID matches! but the player name came back empty. Saving it would wipe the name you have. You cool with that or nah?',
      confirmLabel: `Nah, Keep ${nameOf(saved)}`,
      cancelLabel: 'Yessir, Clear it!',
      confirmKeeps: true,
      tone: 'warn',
      verdict: "couldn't get the name (ᵕ⸝⸝• ᴗ •)",
    }
  }

  if (card.playerUid === saved.playerUid) {
    return {
      kase: 'renamed',
      title: `Oh? Shall i call you ${nameOf(card)} now~?`,
      lead: 'Hmm.. i\'ll have to get used to calling you that now.. unless you don\'t wanna save it..?.',
      confirmLabel: `I'M ${nameOf(card).toUpperCase()} NOW!`,
      cancelLabel: `Keep ${nameOf(saved)}`,
      confirmKeeps: false,
      tone: 'info',
      verdict: `hey ${nameOf(card)}~`,
    }
  }

  if (digits <= 2) {
    return {
      kase: 'misread',
      title: 'Something\'s not quite right, buddy...',
      lead: `Oh! Found it! ${digits === 1 ? 'One digit differs' : 'Two digits differ'}, I'm not sure what this means... wanna save it anyway?`,
      confirmLabel: `Keep ${nameOf(saved)}`,
      cancelLabel: 'Use the card\'s UID',
      confirmKeeps: true,
      tone: 'warn',
      verdict: `${digits} of ${Math.max(saved.playerUid.length, card.playerUid.length)} ${digits === 1 ? 'digit differs' : 'digits differ'}`,
    }
  }

  return {
    kase: 'different',
    title: 'Oh? This you?',
    lead: '*sniff* *sniff* Smells like an entirely different account! Does this call for an update to OUR saved data?',
    confirmLabel: `IT IS I ${nameOf(card).toUpperCase()}!!`,
    cancelLabel: `Nope, Keep ${nameOf(saved)}`,
    confirmKeeps: false,
    tone: 'warn',
    verdict: `${digits} of ${Math.max(saved.playerUid.length, card.playerUid.length)} digits differ`,
  }
}

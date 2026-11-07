/*
  Author: Runor Ewhro
  description: turns what a user gives us into the kuro card address. accepts
               the kuro address itself, the same address wrapped in discord's
               media proxy, or just the card's file name (typed, pasted, or
               taken from an uploaded file: only the name is used, never the
               uploaded bytes). returns only the kuro address with no query
               string; anything else is refused, so the fetch that follows can
               only ever reach kuro's card path.
*/

export interface CardLinkRules {
  host: string
  pathPrefix: string
}

export const DEFAULT_CARD_LINK_RULES: CardLinkRules = {
  host: 'wutheringwaves-dc.kurogames-global.com',
  pathPrefix: '/back/',
}

export type CardLinkError = 'bad_link' | 'not_kuro'

/** how the kuro address was found. */
export type CardInputKind = 'kuro' | 'discord_proxy' | 'file_name'

export type CardLinkResult =
  | { ok: true; url: string; via: CardInputKind }
  | { ok: false; code: CardLinkError }

const MAX_INPUT_LENGTH = 2048
const DISCORD_PROXY_HOST = /^images-ext-\d+\.discordapp\.net$/
/* /back/<2 hex>/<40 hex>.<ext>, where the folder is the file's first two
   characters, as on every observed card. */
const CARD_FILE = /^([0-9a-f]{2})\/(\1[0-9a-f]{38})\.(jpe?g|png)$/
/* a saved card keeps kuro's 40-character name, though the extension may change
   (discord's proxy re-encodes to webp) and a browser may add " (1)" to a
   repeated download. */
const CARD_NAME = /^([0-9a-f]{40})(?:\s*\(\d{1,3}\))?(?:\.(?:jpe?g|png|webp))?$/i
/** every observed kuro card is a .jpeg, whatever the saved copy is called. */
const KURO_EXTENSION = 'jpeg'

function parseUrl(text: string): URL | null {
  try {
    return new URL(text)
  } catch {
    return null
  }
}

function checkKuroPath(pathname: string, rules: CardLinkRules): boolean {
  if (!pathname.startsWith(rules.pathPrefix)) return false
  return CARD_FILE.test(pathname.slice(rules.pathPrefix.length))
}

/* discord proxy paths look like
   /external/<token>/https/<host>/<path>, with an optional encoded query
   segment (starting with %3F) before the scheme when the original had one. */
function unwrapDiscordProxy(url: URL): { host: string; pathname: string } | null {
  const segments = url.pathname.split('/').slice(1)
  if (segments[0] !== 'external' || segments.length < 5) return null
  let index = 2
  if (segments[index]?.toUpperCase().startsWith('%3F')) index += 1
  if (segments[index] !== 'https') return null
  const host = segments[index + 1]
  const rest = segments.slice(index + 2)
  if (!host || rest.length === 0) return null
  return { host: host.toLowerCase(), pathname: `/${rest.join('/')}` }
}

function parseAddress(text: string, rules: CardLinkRules): CardLinkResult {
  const url = parseUrl(text)
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port) {
    return { ok: false, code: 'bad_link' }
  }

  const host = url.hostname.toLowerCase()
  let target: { host: string; pathname: string } | null = null
  let via: CardInputKind = 'kuro'
  if (host === rules.host) {
    target = { host, pathname: url.pathname }
  } else if (DISCORD_PROXY_HOST.test(host)) {
    target = unwrapDiscordProxy(url)
    via = 'discord_proxy'
  }

  if (!target || target.host !== rules.host || !checkKuroPath(target.pathname, rules)) {
    return { ok: false, code: 'not_kuro' }
  }
  return { ok: true, url: `https://${rules.host}${target.pathname}`, via }
}

/** the kuro address for a card's file name, or null when it is not one. a
    path is reduced to its last segment, so a dropped file's full path works. */
export function cardUrlFromName(name: string, rules: CardLinkRules = DEFAULT_CARD_LINK_RULES): string | null {
  const base = name.trim().split(/[\\/]/).pop() ?? ''
  const match = CARD_NAME.exec(base)
  if (!match) return null
  const hash = match[1].toLowerCase()
  return `https://${rules.host}${rules.pathPrefix}${hash.slice(0, 2)}/${hash}.${KURO_EXTENSION}`
}

/** accept a card link, a discord proxy link, or a card file name. */
export function parseCardInput(input: string, rules: CardLinkRules = DEFAULT_CARD_LINK_RULES): CardLinkResult {
  // discord wraps pasted links in angle brackets to suppress embeds
  const text = input.trim().replace(/^<(.*)>$/, '$1').trim()
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH) return { ok: false, code: 'bad_link' }

  // anything with a scheme is an address; plain http is refused there
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return parseAddress(text, rules)

  const url = cardUrlFromName(text, rules)
  return url ? { ok: true, url, via: 'file_name' } : { ok: false, code: 'bad_link' }
}

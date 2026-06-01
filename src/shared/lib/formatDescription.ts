/*
  Author: Runor Ewhro
  Description: Formats rich description text by resolving placeholders,
               preserving highlight markup, and applying keyword-based
               coloring for elemental and status-related terms.
*/

import { ATTR_COLORS } from '@/modules/calculator/model/display'

const FIXED_MARKS: Record<string, string> = {
  'Spectro Frazzle': ATTR_COLORS.spectro,
  'Aero Erosion': ATTR_COLORS.aero,
  'Havoc Bane': ATTR_COLORS.havoc,
  'Fusion Burst': ATTR_COLORS.fusion,
  'Electro Flare': ATTR_COLORS.electro,
  'Electro Rage': ATTR_COLORS.electro,
  'Glacio Chafe': ATTR_COLORS.glacio,
  'Glacio Bite': ATTR_COLORS.glacio
}

const ELEM_WORDS = ['glacio', 'spectro', 'havoc', 'electro', 'aero', 'fusion'] as const

// phrases that should be highlighted case-insensitively in formatted descriptions
const ELEM_PHRASES = ELEM_WORDS.flatMap((element) => [
  `${element} dmg bonus`,
  `${element} damage bonus`,
  `${element} dmg`,
  `${element} damage`,
  `${element} erosion dmg`,
  `${element} frazzle dmg`,
  `${element} bane dmg`,
  `${element} flare dmg`,
  `${element} burst dmg`,
  `${element} chafe dmg`,
  `${element} rage dmg`,
  `${element} bite dmg`,
  element,
])

// escape text so it can be safely used inside a regular expression
function escapeRegex(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}

function rstrPrtcSgmn(html: string, prtcSgmn: Map<string, string>): string {
  let processed = html

  for (const [token, replacement] of prtcSgmn) {
    processed = processed.replaceAll(token, replacement)
  }

  return processed
}

function prtcFxdHghl(
    prtcSgmn: Map<string, string>,
    color: string,
    match: string,
): string {
  const token = `__WWCALC_FIXED_${prtcSgmn.size}__`
  prtcSgmn.set(
      token,
      `<strong style="color: ${color}; font-weight: bold;">${match}</strong>`,
  )
  return token
}

function prtcFxdHghbr(html: string): { html: string, prtcSgmn: Map<string, string> } {
  const prtcSgmn = new Map<string, string>()
  let processed = html
  const hghlOpen = '(?:<span class="highlight">|<strong class="highlight">)'
  const hghlCls = '</(?:span|strong)>'

  for (const [word, color] of Object.entries(FIXED_MARKS)) {
    const fxdPhrsPttr = `${escapeRegex(word)}(?:\\s+(?:DMG|Damage))?`
    const wrppTermRgx = new RegExp(
        `${hghlOpen}\\s*(${fxdPhrsPttr})\\s*${hghlCls}(?:\\s+(?:${hghlOpen}\\s*(DMG|Damage)\\s*${hghlCls}|(DMG|Damage)))?`,
        'gi',
    )
    const wrppSffxRgx = new RegExp(
        `\\b(${escapeRegex(word)})\\s+${hghlOpen}\\s*(DMG|Damage)\\s*${hghlCls}`,
        'gi',
    )
    const plainRegex = new RegExp(`\\b${fxdPhrsPttr}\\b`, 'gi')

    processed = processed.replace(wrppTermRgx, (_, term: string, suffixOne?: string, suffixTwo?: string) => {
      const suffix = suffixOne ?? suffixTwo
      return prtcFxdHghl(
          prtcSgmn,
          color,
          suffix ? `${term} ${suffix}` : term,
      )
    })
    processed = processed.replace(wrppSffxRgx, (_, term: string, suffix: string) => (
      prtcFxdHghl(prtcSgmn, color, `${term} ${suffix}`)
    ))
    processed = processed.replace(plainRegex, (match) => (
      prtcFxdHghl(prtcSgmn, color, match)
    ))
  }

  return { html: processed, prtcSgmn: prtcSgmn }
}

// inject highlight markup into HTML while preserving existing formatting
function hghlKywrInHt(html: string, xtrKywr: string[] = []): string {
  if (!html) {
    return html
  }

  // elemental RES phrases get handled first so they are protected from later replacements
  const resPhrases = ELEM_WORDS.map(
      (element) => `${element.charAt(0).toUpperCase() + element.slice(1)} RES`,
  )
  const scpdResPhrs = resPhrases.map(escapeRegex)
  const resRegex = new RegExp(`(${scpdResPhrs.join('|')})`, 'g')

  // case-insensitive highlight targets plus generic percentage values
  const scpdNsnsKywr = ELEM_PHRASES.map(escapeRegex)
  const prcnPttr = '\\d+(\\.\\d+)?%'
  const ciRegex = new RegExp(`(${[...scpdNsnsKywr, prcnPttr].join('|')})`, 'gi')

  let processed = html
  const prtcSgmn = new Map<string, string>()

  // protect elemental resistance phrases with their own explicit colored markup
  processed = processed.replace(resRegex, (match) => {
    const elementKey = match.split(' ')[0].toLowerCase() as keyof typeof ATTR_COLORS
    const color = ATTR_COLORS[elementKey] ?? 'inherit'
    const token = `__WWCALC_RES_${prtcSgmn.size}__`
    prtcSgmn.set(
        token,
        `<strong style="color: ${color}; font-weight: bold;">${match}</strong>`,
    )
    return token
  })

  // apply exact-case keyword highlights before the broad case-insensitive pass
  if (xtrKywr.length > 0) {
    const scpdSnstKywr = [...xtrKywr]
        .sort((left, right) => right.length - left.length)
        .map(escapeRegex)
    const csRegex = new RegExp(`(${scpdSnstKywr.join('|')})`, 'g')

    processed = processed.replace(
        csRegex,
        (match) => `<strong class="highlight">${match}</strong>`,
    )
  }

  // apply general keyword highlighting and element coloring
  processed = processed.replace(ciRegex, (match) => {
    // plain percentages always use the generic highlight style
    if (/^\d+(\.\d+)?%$/.test(match)) {
      return `<strong class="highlight">${match}</strong>`
    }

    // element-prefixed phrases use the element color
    const lower = match.toLowerCase()
    const elemPrfx = ELEM_WORDS.find((element) => lower.startsWith(element))
    if (elemPrfx) {
      const color = ATTR_COLORS[elemPrfx]
      return `<strong style="color: ${color}; font-weight: bold;">${match}</strong>`
    }

    // everything else falls back to generic highlight styling
    return `<strong class="highlight">${match}</strong>`
  })

  return rstrPrtcSgmn(processed, prtcSgmn)
}

export interface FmtDscrPtns {
  xtrKywr?: string[]
}

// check whether a raw HTML tag contains a font-bold class
function hasFontBoldC(tag: string): boolean {
  const qtdClssMtch = tag.match(/\bclass\s*=\s*(['"])(.*?)\1/i)
  if (qtdClssMtch && /\bfont-bold\b/i.test(qtdClssMtch[2])) {
    return true
  }

  const nqtdClssMtch = tag.match(/\bclass\s*=\s*([^\s>]+)/i)
  return Boolean(nqtdClssMtch && /\bfont-bold\b/i.test(nqtdClssMtch[1]))
}

// strip incoming bold markup and normalize it to the app's highlight spans
function strpNjctMrkp(text: string): string {
  // first normalize line breaks to literal newlines so we can rebuild them cleanly later
  const normalized = text.replace(/(?:<br\s*\/?>\s*)+/gi, '\n')
  const tagRegex = /<\/?[^>]+>/gi
  const spanStack: boolean[] = []
  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  for (match = tagRegex.exec(normalized); match; match = tagRegex.exec(normalized)) {
    result += normalized.slice(lastIndex, match.index)
    const tag = match[0]

    // preserve only meaningful bold wrappers and discard everything else
    if (/^<span\b/i.test(tag)) {
      const isBoldSpan = hasFontBoldC(tag)
      spanStack.push(isBoldSpan)
      if (isBoldSpan) {
        result += '<span class="highlight">'
      }
    } else if (/^<\/span\s*>/i.test(tag)) {
      const isBoldSpan = spanStack.pop()
      if (isBoldSpan) {
        result += '</span>'
      }
    } else if (/^<strong\b[^>]*>/i.test(tag)) {
      result += '<strong class="highlight">'
    } else if (/^<\/strong\s*>/i.test(tag)) {
      result += '</strong>'
    }

    lastIndex = tagRegex.lastIndex
  }

  result += normalized.slice(lastIndex)
  return result
}

// format description text into highlighted HTML
export function fmtDscr(
    desc: string,
    param: Array<string | number> = [],
    curSldrClr = '#888',
    options: FmtDscrPtns = {},
): string {
  if (!desc) {
    return ''
  }

  // kept for call-site compatibility even though this formatter no longer uses it directly
  void curSldrClr

  // normalize line endings first
  let formatted = desc
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')

  // strip injected markup, trim messy whitespace around lines, then convert newlines to <br>
  formatted = strpNjctMrkp(formatted)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/\n/g, '<br>')

  // resolve pluralization custom tags of the form {Cus:... S=... P=... SapTag=n ...}
  formatted = formatted.replace(
      /\{Cus:[^}]*S=([^ ]+)\s+P=([^ ]+)\s+SapTag=(\d+)[^}]*\}/g,
      (_, singular: string, plural: string, tagIndex: string) => {
        const value = parseFloat(String(param[Number.parseInt(tagIndex, 10)] ?? '0'))
        return value === 1 ? singular : plural
      },
  )

  // fixed status phrases can include trailing damage labels and must stay atomic
  // through the later generic keyword pass.
  const fxdHghl = prtcFxdHghbr(formatted)
  formatted = fxdHghl.html

  // replace indexed placeholders like {0}, {1}, ...
  formatted = formatted.replace(
      /\{(\d+)}/g,
      (_, index: string) => String(param[Number(index)] ?? `{${index}}`),
  )

  // resolve input prompt custom tags by joining unique device labels
  formatted = formatted.replace(
      /\{Cus:Ipt,[^}]*Touch=([^ ]+)\s+PC=([^ ]+)\s+Gamepad=([^ }]+)[^}]*\}/g,
      (_, touch: string, pc: string, gamepad: string) => {
        const inputs = new Set([touch, pc, gamepad])
        return Array.from(inputs).join('/')
      },
  )

  // finally apply keyword-based highlight formatting
  return rstrPrtcSgmn(
      hghlKywrInHt(formatted, options.xtrKywr),
      fxdHghl.prtcSgmn,
  )
}

// format description text and return a plain-text version without HTML
export function fmtDscrText(
    desc: string,
    param: Array<string | number> = [],
    curSldrClr = '#888',
    options: FmtDscrPtns = {},
): string {
  return fmtDscr(desc, param, curSldrClr, options)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim()
}

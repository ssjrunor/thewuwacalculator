/*
  Author: Runor Ewhro
  Description: Formats rich description text by resolving placeholders,
               preserving highlight markup, and applying keyword-based
               coloring for elemental and status-related terms.
*/

const FIXED_HIGHLIGHTS: Record<string, string> = {
  'Spectro Frazzle': 'rgb(202,179,63)',
  'Aero Erosion': 'rgb(15,205,160)',
  'Havoc Bane': 'rgb(172,9,96)',
  'Fusion Burst': 'rgb(197,52,79)',
  'Electro Flare': 'rgb(167,13,209)',
  'Glacio Chafe': 'rgb(62,189,227)',
}

const ATTRIBUTE_COLORS: Record<string, string> = {
  glacio: 'rgb(62,189,227)',
  spectro: 'rgb(202,179,63)',
  havoc: 'rgb(172,9,96)',
  electro: 'rgb(167,13,209)',
  aero: 'rgb(15,205,160)',
  fusion: 'rgb(197,52,79)',
}

const ELEMENT_KEYWORDS = Object.keys(ATTRIBUTE_COLORS)

// phrases that should be highlighted case-insensitively in formatted descriptions
const ELEMENT_PHRASES = ELEMENT_KEYWORDS.flatMap((element) => [
  `${element} dmg bonus`,
  `${element} damage bonus`,
  `${element} dmg`,
  `${element} damage`,
  `${element} erosion dmg`,
  `${element} frazzle dmg`,
  `${element} erosion`,
  `${element} frazzle`,
  `${element} bane dmg`,
  `${element} bane`,
  `${element} flare dmg`,
  `${element} flare`,
  element,
])

// escape text so it can be safely used inside a regular expression
function escapeRegex(value: string): string {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}

// inject highlight markup into HTML while preserving existing formatting
function highlightKeywordsInHtml(html: string, extraKeywords: string[] = []): string {
  if (!html) {
    return html
  }

  // elemental RES phrases get handled first so they are protected from later replacements
  const resPhrases = ELEMENT_KEYWORDS.map(
      (element) => `${element.charAt(0).toUpperCase() + element.slice(1)} RES`,
  )
  const escapedResPhrases = resPhrases.map(escapeRegex)
  const resRegex = new RegExp(`(${escapedResPhrases.join('|')})`, 'g')

  // case-insensitive highlight targets plus generic percentage values
  const escapedInsensitiveKeywords = ELEMENT_PHRASES.map(escapeRegex)
  const percentPattern = '\\d+(\\.\\d+)?%'
  const ciRegex = new RegExp(`(${[...escapedInsensitiveKeywords, percentPattern].join('|')})`, 'gi')

  let processed = html
  const protectedSegments = new Map<string, string>()

  // protect elemental resistance phrases with their own explicit colored markup
  processed = processed.replace(resRegex, (match) => {
    const color = ATTRIBUTE_COLORS[match.split(' ')[0].toLowerCase()] ?? 'inherit'
    const token = `__WWCALC_RES_${protectedSegments.size}__`
    protectedSegments.set(
        token,
        `<strong style="color: ${color}; font-weight: bold;">${match}</strong>`,
    )
    return token
  })

  // apply exact-case keyword highlights before the broad case-insensitive pass
  if (extraKeywords.length > 0) {
    const escapedSensitiveKeywords = [...extraKeywords]
        .sort((left, right) => right.length - left.length)
        .map(escapeRegex)
    const csRegex = new RegExp(`(${escapedSensitiveKeywords.join('|')})`, 'g')

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
    const elementPrefix = ELEMENT_KEYWORDS.find((element) => lower.startsWith(element))
    if (elementPrefix) {
      const color = ATTRIBUTE_COLORS[elementPrefix]
      return `<strong style="color: ${color}; font-weight: bold;">${match}</strong>`
    }

    // everything else falls back to generic highlight styling
    return `<strong class="highlight">${match}</strong>`
  })

  // restore the protected resistance phrases
  for (const [token, replacement] of protectedSegments) {
    processed = processed.replaceAll(token, replacement)
  }

  return processed
}

export interface FormatDescriptionOptions {
  extraKeywords?: string[]
}

// check whether a raw HTML tag contains a font-bold class
function hasFontBoldClass(tag: string): boolean {
  const quotedClassMatch = tag.match(/\bclass\s*=\s*(['"])(.*?)\1/i)
  if (quotedClassMatch && /\bfont-bold\b/i.test(quotedClassMatch[2])) {
    return true
  }

  const unquotedClassMatch = tag.match(/\bclass\s*=\s*([^\s>]+)/i)
  return Boolean(unquotedClassMatch && /\bfont-bold\b/i.test(unquotedClassMatch[1]))
}

// strip incoming bold markup and normalize it to the app's highlight spans
function stripInjectedMarkup(text: string): string {
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
      const isBoldSpan = hasFontBoldClass(tag)
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
      result += '<span class="highlight">'
    } else if (/^<\/strong\s*>/i.test(tag)) {
      result += '</span>'
    }

    lastIndex = tagRegex.lastIndex
  }

  result += normalized.slice(lastIndex)
  return result
}

// format description text into highlighted HTML
export function formatDescription(
    desc: string,
    param: Array<string | number> = [],
    currentSliderColor = '#888',
    options: FormatDescriptionOptions = {},
): string {
  if (!desc) {
    return ''
  }

  // kept for call-site compatibility even though this formatter no longer uses it directly
  void currentSliderColor

  // normalize line endings first
  let formatted = desc
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')

  // strip injected markup, trim messy whitespace around lines, then convert newlines to <br>
  formatted = stripInjectedMarkup(formatted)
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

  // apply fixed-status phrase highlighting before generic placeholder substitution
  for (const [word, color] of Object.entries(FIXED_HIGHLIGHTS)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi')
    formatted = formatted.replace(
        regex,
        `<span style="color: ${color}; font-weight: bold;">${word}</span>`,
    )
  }

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
  return highlightKeywordsInHtml(formatted, options.extraKeywords)
}

// format description text and return a plain-text version without HTML
export function formatDescriptionText(
    desc: string,
    param: Array<string | number> = [],
    currentSliderColor = '#888',
    options: FormatDescriptionOptions = {},
): string {
  return formatDescription(desc, param, currentSliderColor, options)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .trim()
}
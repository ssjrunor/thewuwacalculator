/*
  Author: Runor Ewhro
  Description: Renders tokenized console-style text with lightweight semantic
               color treatment for formulas, traces, and debug output.
*/

import { useMemo } from 'react'

type TokenType =
    | 'plain'
    | 'keyword'
    | 'string'
    | 'number'
    | 'comment'
    | 'property'
    | 'type'
    | 'accent'
    | 'heading'
    | 'label'
    | 'operator'
    | 'result'
    | 'muted'

type Token = {
    text: string
    type: TokenType
}

type DtrCnslPrps = {
    text: string
    language?: 'ts' | 'tsx' | 'js' | 'json' | 'plain' | 'formula'
    showLineNmbr?: boolean
    title?: string
    className?: string
}

const FORMNMBRPTTR = '-?\\d[\\d,]*(?:\\.\\d+)?%?'
const FORMNMBRRGX = new RegExp(`^${FORMNMBRPTTR}$`)

const TS_KEYWORDS = new Set([
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'switch',
    'case',
    'break',
    'continue',
    'import',
    'from',
    'export',
    'default',
    'type',
    'interface',
    'extends',
    'implements',
    'new',
    'class',
    'try',
    'catch',
    'finally',
    'throw',
    'async',
    'await',
    'true',
    'false',
    'null',
    'undefined',
])

function tknzFormExpr(expression: string): Token[] {
    const parts =
        expression.match(new RegExp(`(${FORMNMBRPTTR}|[A-Za-z][A-Za-z0-9]*|[()+\\-x/*=,:|]|\\s+|.)`, 'g')) ?? [expression]

    return parts.map((part) => {
        if (/^\s+$/.test(part)) {
            return { text: part, type: 'plain' as const }
        }

        if (part === 'x') {
            return { text: part, type: 'operator' as const }
        }

        if (FORMNMBRRGX.test(part)) {
            return { text: part, type: 'number' as const }
        }

        if (/^[()+\-x/*=,:|]$/.test(part)) {
            return { text: part, type: 'operator' as const }
        }

        if (/^[A-Z][A-Za-z0-9]*$/.test(part)) {
            return { text: part, type: 'property' as const }
        }

        if (/^[a-z]+$/.test(part)) {
            return { text: part, type: 'muted' as const }
        }

        return { text: part, type: 'plain' as const }
    })
}

function tknzFormLine(line: string): Token[] {
    const trimmed = line.trim()

    if (!trimmed) {
        return []
    }

    if (trimmed.startsWith('//')) {
        return [{ text: trimmed, type: 'comment' }]
    }

    if (!trimmed.includes('=') && !trimmed.includes(':')) {
        if (/[.!?]$/.test(trimmed)) {
            return [{ text: trimmed, type: 'muted' }]
        }

        return [{ text: trimmed, type: 'heading' }]
    }

    const colonIndex = line.indexOf(':')
    const equalIndex = line.indexOf('=')

    if (colonIndex !== -1 && (equalIndex === -1 || colonIndex < equalIndex)) {
        return [
            { text: line.slice(0, colonIndex).trimEnd(), type: 'label' },
            { text: ':', type: 'operator' },
            ...tknzFormExpr(line.slice(colonIndex + 1)),
        ]
    }

    if (equalIndex !== -1) {
        const left = line.slice(0, equalIndex)
        const right = line.slice(equalIndex + 1)
        const leftTrimmed = left.trim()

        if (FORMNMBRRGX.test(leftTrimmed)) {
            return [
                { text: leftTrimmed, type: 'result' },
                { text: ' =', type: 'operator' },
                ...tknzFormExpr(right),
            ]
        }

        return [
            { text: leftTrimmed, type: 'label' },
            { text: ' =', type: 'operator' },
            ...tknzFormExpr(right),
        ]
    }

    return tknzFormExpr(line)
}

function tokenizeLine(line: string, language: DtrCnslPrps['language']): Token[] {
    if (language === 'plain') {
        return [{ text: line, type: 'plain' }]
    }

    if (language === 'formula') {
        return tknzFormLine(line)
    }

    const trimmed = line.trim()

    if (trimmed.startsWith('//')) {
        return [{ text: line, type: 'comment' }]
    }

    const tokens: Token[] = []
    const regex =
        /(".*?"|'.*?'|`.*?`|\b\d+(\.\d+)?\b|\b[A-Za-z_$][\w$]*\b|\/\/.*|[^\sA-Za-z0-9_$]+|\s+)/g

    const matches = line.match(regex) ?? [line]

    for (const part of matches) {
        if (part.startsWith('//')) {
            tokens.push({ text: part, type: 'comment' })
            continue
        }

        if (
            (part.startsWith('"') && part.endsWith('"')) ||
            (part.startsWith("'") && part.endsWith("'")) ||
            (part.startsWith('`') && part.endsWith('`'))
        ) {
            tokens.push({ text: part, type: 'string' })
            continue
        }

        if (/^\d+(\.\d+)?$/.test(part)) {
            tokens.push({ text: part, type: 'number' })
            continue
        }

        if (TS_KEYWORDS.has(part)) {
            tokens.push({ text: part, type: 'keyword' })
            continue
        }

        if (/^[A-Z][A-Za-z0-9_]*$/.test(part)) {
            tokens.push({ text: part, type: 'type' })
            continue
        }

        tokens.push({ text: part, type: 'plain' })
    }

    return tokens
}

export function DtrCnsl({
                                  text,
                                  language = 'tsx',
                                  showLineNmbr: showLineNmbr = true,
                                  title,
                                  className = '',
                              }: DtrCnslPrps) {
    const lines = useMemo(() => text.replace(/\r\n/g, '\n').split('\n'), [text])
    const rootClssName = [
        'editor-console',
        language === 'formula' ? 'editor-console--formula' : '',
        className,
    ].filter(Boolean).join(' ')

    return (
        <div className={rootClssName}>
            {title && (
             <div className="editor-console__topbar">
                  <div className="editor-console__dots">
                      <span />
                      <span />
                      <span />
                  </div>
                <div className="editor-console__title">{title}</div>
              </div>
            )}


            <div className="editor-console__body">
                {lines.map((line, index) => {
                    const tokens = tokenizeLine(line, language)

                    return (
                        <div className="editor-console__line" key={`${index}-${line}`}>
                            {showLineNmbr && (
                                <span className="editor-console__line-number">{index + 1}</span>
                            )}

                            <span className="editor-console__line-content">
                {tokens.length === 0 ? (
                    '\u00A0'
                ) : (
                    tokens.map((token, tokenIndex) => (
                        <span
                            key={`${index}-${tokenIndex}`}
                            className={`editor-token editor-token--${token.type}`}
                        >
                      {token.text}
                    </span>
                    ))
                )}
              </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

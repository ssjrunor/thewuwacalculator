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

type EditorConsoleProps = {
    text: string
    language?: 'ts' | 'tsx' | 'js' | 'json' | 'plain' | 'formula'
    showLineNumbers?: boolean
    title?: string
    className?: string
}

const FORMULA_NUMBER_PATTERN = '-?\\d[\\d,]*(?:\\.\\d+)?%?'
const FORMULA_NUMBER_REGEX = new RegExp(`^${FORMULA_NUMBER_PATTERN}$`)

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

function tokenizeFormulaExpression(expression: string): Token[] {
    const parts =
        expression.match(new RegExp(`(${FORMULA_NUMBER_PATTERN}|[A-Za-z][A-Za-z0-9]*|[()+\\-x/*=,:|]|\\s+|.)`, 'g')) ?? [expression]

    return parts.map((part) => {
        if (/^\s+$/.test(part)) {
            return { text: part, type: 'plain' as const }
        }

        if (part === 'x') {
            return { text: part, type: 'operator' as const }
        }

        if (FORMULA_NUMBER_REGEX.test(part)) {
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

function tokenizeFormulaLine(line: string): Token[] {
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
            ...tokenizeFormulaExpression(line.slice(colonIndex + 1)),
        ]
    }

    if (equalIndex !== -1) {
        const left = line.slice(0, equalIndex)
        const right = line.slice(equalIndex + 1)
        const leftTrimmed = left.trim()

        if (FORMULA_NUMBER_REGEX.test(leftTrimmed)) {
            return [
                { text: leftTrimmed, type: 'result' },
                { text: ' =', type: 'operator' },
                ...tokenizeFormulaExpression(right),
            ]
        }

        return [
            { text: leftTrimmed, type: 'label' },
            { text: ' =', type: 'operator' },
            ...tokenizeFormulaExpression(right),
        ]
    }

    return tokenizeFormulaExpression(line)
}

function tokenizeLine(line: string, language: EditorConsoleProps['language']): Token[] {
    if (language === 'plain') {
        return [{ text: line, type: 'plain' }]
    }

    if (language === 'formula') {
        return tokenizeFormulaLine(line)
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

export function EditorConsole({
                                  text,
                                  language = 'tsx',
                                  showLineNumbers = true,
                                  title,
                                  className = '',
                              }: EditorConsoleProps) {
    const lines = useMemo(() => text.replace(/\r\n/g, '\n').split('\n'), [text])
    const rootClassName = [
        'editor-console',
        language === 'formula' ? 'editor-console--formula' : '',
        className,
    ].filter(Boolean).join(' ')

    return (
        <div className={rootClassName}>
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
                            {showLineNumbers && (
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

/*
  Author: Runor Ewhro
  Description: Defines pluggable import handlers that recognize, describe, and apply shared payloads.
*/

import type { ReactNode } from 'react'

export interface ImportReview {
  title: string
  summary: ReactNode
  primaryLabel: string
  // Secondary is another import mutation, not cancel; absence keeps a single
  // commit path for payload kinds that have no meaningful split.
  secondaryLabel?: string
}

export type ImportApplyVariant = 'primary' | 'secondary'

// Detection and application are split so every payload is reviewed before any
// domain state changes, even when it arrived from a URL.
export interface ImportHandler<P = unknown> {
  kind: string
  detect: (parsed: unknown) => P | null | Promise<P | null>
  review: (payload: P) => ImportReview
  apply: (payload: P, variant: ImportApplyVariant) => void | Promise<void>
}

// Type erasure lets the registry hold many payload shapes while preserving the
// validated payload inside the bound apply callback.
export interface RegisteredImport {
  kind: string
  tryResolve: (parsed: unknown) => Promise<{
    kind: string
    review: ImportReview
    apply: (variant: ImportApplyVariant) => void | Promise<void>
  } | null>
}

export function defineImport<P>(handler: ImportHandler<P>): RegisteredImport {
  return {
    kind: handler.kind,
    tryResolve: async (parsed) => {
      const payload = await handler.detect(parsed)
      if (payload == null) return null
      return {
        kind: handler.kind,
        review: handler.review(payload),
        apply: (variant) => handler.apply(payload, variant),
      }
    },
  }
}

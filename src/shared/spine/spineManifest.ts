export type SpineVariant = 'portrait' | 'luckdraw'

interface SpineVariantFiles {
  skel: string
  atlas: string
  pages: string[]
}

export interface SpineManifestEntry {
  slug: string
  slugs?: Partial<Record<SpineVariant, string>>
  portrait?: SpineVariantFiles
  luckdraw?: SpineVariantFiles
}

export type SpineManifest = Record<string, SpineManifestEntry>

const MANIFEST_URL = '/assets/spine/manifest.json'

let manifestPromise: Promise<SpineManifest> | null = null
let manifestValue: SpineManifest | null = null

export function loadSpineManifest(): Promise<SpineManifest> {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL)
      .then((response) => (response.ok ? (response.json() as Promise<SpineManifest>) : {}))
      .catch(() => ({}))
      .then((manifest) => {
        manifestValue = manifest
        return manifest
      })
  }
  return manifestPromise
}

// Synchronous accessor for the already-resolved manifest, so portraits mounting
// after the first fetch know spine availability on their first render and never
// paint the sprite fallback during an unknown window.
export function getLoadedSpineManifest(): SpineManifest | null {
  return manifestValue
}

export function spineBaseUrl(resId: string, variant: SpineVariant): string {
  return `/assets/spine/${variant}/${resId}/`
}

export function spineSetupUrl(resId: string, variant: SpineVariant): string {
  return `/assets/spine/setup/${variant}/${resId}.webp`
}

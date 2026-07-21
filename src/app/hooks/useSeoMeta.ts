/*
  Author: Runor Ewhro
  Description: Synchronizes route-specific SEO metadata for the client-routed
               app shell.
*/

import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { buildStructuredData, resolveSeoRoute, SEO_CONFIG } from '@/shared/lib/seoMetadata'

function upsertMetaByName(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('name', name)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertMetaByProperty(property: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute('property', property)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

function upsertLink(rel: string, href: string): void {
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
  if (!el) {
    el = document.createElement('link')
    el.setAttribute('rel', rel)
    document.head.appendChild(el)
  }
  el.setAttribute('href', href)
}

function upsertJsonLd(id: string, data: unknown): void {
  let el = document.head.querySelector<HTMLScriptElement>(`script[type="application/ld+json"][data-seo-id="${id}"]`)
  if (!el) {
    el = document.createElement('script')
    el.setAttribute('type', 'application/ld+json')
    el.setAttribute('data-seo-id', id)
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
}

export function useSeoMeta() {
  const location = useLocation()

  useEffect(() => {
    if (typeof document === 'undefined') return

    const route = resolveSeoRoute(location.pathname)
    const robots = route.indexable ? 'index,follow' : 'noindex,follow'

    document.title = route.fullTitle
    upsertMetaByName('description', route.description)
    upsertMetaByName('robots', robots)
    upsertMetaByName('theme-color', SEO_CONFIG.themeColor)
    upsertMetaByName('category', SEO_CONFIG.siteCategory)
    upsertMetaByName('classification', SEO_CONFIG.siteClassification)
    upsertMetaByName('keywords', SEO_CONFIG.siteKeywords.join(', '))

    upsertLink('canonical', route.canonicalUrl)

    upsertMetaByProperty('og:type', 'website')
    upsertMetaByProperty('og:site_name', SEO_CONFIG.siteName)
    upsertMetaByProperty('og:title', route.fullTitle)
    upsertMetaByProperty('og:description', route.description)
    upsertMetaByProperty('og:url', route.canonicalUrl)
    upsertMetaByProperty('og:image', route.imageUrl)
    upsertMetaByProperty('og:image:alt', route.imageAlt)
    upsertMetaByProperty('og:image:width', '1200')
    upsertMetaByProperty('og:image:height', '630')
    upsertMetaByProperty('og:locale', 'en_US')

    upsertMetaByName('twitter:card', 'summary_large_image')
    upsertMetaByName('twitter:title', route.fullTitle)
    upsertMetaByName('twitter:description', route.description)
    upsertMetaByName('twitter:image', route.imageUrl)
    upsertMetaByName('twitter:image:alt', route.imageAlt)

    upsertJsonLd('app-route', buildStructuredData(route))
  }, [location.pathname])
}

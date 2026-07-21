/*
  Author: Runor Ewhro
  Description: Resolves route metadata and structured-data payloads used by
               static SEO output and the client head synchronizer.
*/

import seoConfig from '@/shared/lib/seoRoutes.json'

export interface SeoRoute {
  path: string
  title: string
  description: string
  priority: string
  socialImage?: string
  socialImageAlt?: string
}

interface SeoConfig {
  siteUrl: string
  siteName: string
  defaultTitle: string
  defaultDescription: string
  siteCategory: string
  siteClassification: string
  siteKeywords: string[]
  socialImage: string
  socialImageAlt?: string
  themeColor: string
  routes: SeoRoute[]
}

export interface ResolvedSeoRoute {
  path: string
  title: string
  fullTitle: string
  description: string
  canonicalUrl: string
  imageUrl: string
  imageAlt: string
  indexable: boolean
}

export const SEO_CONFIG = seoConfig as SeoConfig

const routeByPath = new Map(SEO_CONFIG.routes.map((route) => [route.path, route]))

export function makeAbsoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${SEO_CONFIG.siteUrl}${path.startsWith('/') ? path : `/${path}`}`
}

export function resolveSeoRoute(pathname: string): ResolvedSeoRoute {
  const normalized = pathname === '/' ? '/calculator' : pathname.replace(/\/+$/, '') || '/calculator'
  const route = routeByPath.get(normalized)
  const title = route?.title ?? SEO_CONFIG.defaultTitle
  const description = route?.description ?? SEO_CONFIG.defaultDescription
  const path = route?.path ?? normalized
  const imageAlt = route?.socialImageAlt ?? SEO_CONFIG.socialImageAlt ?? `${title} preview image`

  return {
    path,
    title,
    fullTitle: title === SEO_CONFIG.defaultTitle ? title : `${title} | ${SEO_CONFIG.siteName}`,
    description,
    canonicalUrl: makeAbsoluteUrl(path),
    imageUrl: makeAbsoluteUrl(route?.socialImage ?? SEO_CONFIG.socialImage),
    imageAlt,
    indexable: Boolean(route),
  }
}

export function buildStructuredData(route: ResolvedSeoRoute) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${SEO_CONFIG.siteUrl}/#website`,
        url: SEO_CONFIG.siteUrl,
        name: SEO_CONFIG.siteName,
        alternateName: SEO_CONFIG.defaultTitle,
        description: SEO_CONFIG.defaultDescription,
        inLanguage: 'en',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SEO_CONFIG.siteUrl}/#app`,
        name: SEO_CONFIG.siteName,
        applicationCategory: 'ReferenceApplication',
        applicationSubCategory: SEO_CONFIG.siteClassification,
        operatingSystem: 'Web',
        url: SEO_CONFIG.siteUrl,
        image: route.imageUrl,
        description: SEO_CONFIG.defaultDescription,
        genre: SEO_CONFIG.siteKeywords,
        keywords: SEO_CONFIG.siteKeywords.join(', '),
        isAccessibleForFree: true,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
      {
        '@type': 'WebPage',
        '@id': `${route.canonicalUrl}#webpage`,
        url: route.canonicalUrl,
        name: route.title,
        description: route.description,
        genre: SEO_CONFIG.siteCategory,
        keywords: SEO_CONFIG.siteKeywords.join(', '),
        isPartOf: {
          '@id': `${SEO_CONFIG.siteUrl}/#website`,
        },
        about: {
          '@id': `${SEO_CONFIG.siteUrl}/#app`,
        },
        inLanguage: 'en',
      },
    ],
  }
}

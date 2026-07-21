import fs from 'node:fs'
import path from 'node:path'

/*
  Author: Runor Ewhro
  Description: Vite builds this app as a single-page bundle, so every browser route starts
               from the same HTML shell unless we create route-specific copies after the
               client build. This script keeps crawlers, link unfurlers, and no-JavaScript
               readers pointed at the same metadata that the runtime uses once React loads.
*/
const root = process.cwd()
const configPath = path.join(root, 'src/shared/lib/seoRoutes.json')
const publicDir = path.join(root, 'public')
const distDir = path.join(root, 'dist')
const syncPublic = process.argv.includes('--sync-public')

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const routeByPath = new Map(config.routes.map((route) => [route.path, route]))

// HTML escaping is split by destination so route copy can safely pass through
// both element text and quoted attributes without over-escaping generated tags.
function escapeAttr(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function absoluteUrl(pathname) {
  if (/^https?:\/\//i.test(pathname)) return pathname
  return `${config.siteUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`
}

// A missing route is treated as non-indexable fallback content instead of a hard
// failure. That lets direct unknown URLs still receive a valid shell while known
// routes get the stronger canonical and social metadata from seoRoutes.json.
function resolveRoute(pathname) {
  const normalized = pathname === '/' ? '/calculator' : pathname.replace(/\/+$/, '') || '/calculator'
  const route = routeByPath.get(normalized)
  const title = route?.title ?? config.defaultTitle
  const description = route?.description ?? config.defaultDescription
  const pathValue = route?.path ?? normalized
  const imageAlt = route?.socialImageAlt ?? config.socialImageAlt ?? `${title} preview image`

  return {
    path: pathValue,
    title,
    fullTitle: title === config.defaultTitle ? title : `${title} | ${config.siteName}`,
    description,
    canonicalUrl: absoluteUrl(pathValue),
    imageUrl: absoluteUrl(route?.socialImage ?? config.socialImage),
    imageAlt,
    indexable: Boolean(route),
  }
}

// JSON-LD mirrors the visible route metadata while describing the app once at
// site scope. Route pages point back to the same SoftwareApplication node so
// search engines can connect calculator, guide, changelog, and policy pages.
function structuredData(route) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${config.siteUrl}/#website`,
        url: config.siteUrl,
        name: config.siteName,
        alternateName: config.defaultTitle,
        description: config.defaultDescription,
        inLanguage: 'en',
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${config.siteUrl}/#app`,
        name: config.siteName,
        applicationCategory: 'ReferenceApplication',
        applicationSubCategory: config.siteClassification,
        operatingSystem: 'Web',
        url: config.siteUrl,
        image: route.imageUrl,
        description: config.defaultDescription,
        genre: config.siteKeywords,
        keywords: config.siteKeywords.join(', '),
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
        genre: config.siteCategory,
        keywords: config.siteKeywords.join(', '),
        isPartOf: {
          '@id': `${config.siteUrl}/#website`,
        },
        about: {
          '@id': `${config.siteUrl}/#app`,
        },
        inLanguage: 'en',
      },
    ],
  }
}

// Vite owns the baseline index.html. These helpers make the postbuild pass
// idempotent by replacing existing tags when present and inserting missing tags
// near the title when a local HTML edit has not already provided them.
function upsertHeadTag(html, matcher, fallbackBefore, replacement) {
  if (matcher.test(html)) return html.replace(matcher, replacement)
  return html.replace(fallbackBefore, `${replacement}\n    $&`)
}

function setTitle(html, title) {
  return html.replace(/<title>.*?<\/title>/s, `<title>${escapeText(title)}</title>`)
}

function setMetaName(html, name, content) {
  return upsertHeadTag(
    html,
    new RegExp(`<meta\\s+name="${name}"\\s+content="[^"]*"\\s*/?>`, 'i'),
    /<title>/i,
    `<meta name="${name}" content="${escapeAttr(content)}" />`,
  )
}

function setMetaProperty(html, property, content) {
  return upsertHeadTag(
    html,
    new RegExp(`<meta\\s+property="${property}"\\s+content="[^"]*"\\s*/?>`, 'i'),
    /<title>/i,
    `<meta property="${property}" content="${escapeAttr(content)}" />`,
  )
}

function setCanonical(html, href) {
  return upsertHeadTag(
    html,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
    /<title>/i,
    `<link rel="canonical" href="${escapeAttr(href)}" />`,
  )
}

function setJsonLd(html, route) {
  const json = JSON.stringify(structuredData(route))
  return upsertHeadTag(
    html,
    /<script\s+type="application\/ld\+json"\s+data-seo-id="app-route">.*?<\/script>/s,
    /<title>/i,
    `<script type="application/ld+json" data-seo-id="app-route">${json}</script>`,
  )
}

// The app is still client-rendered, but this small noscript payload gives
// crawlers and users without JavaScript a truthful route label instead of a
// blank root node.
function setNoScript(html, route) {
  const content = `<noscript data-seo-route="${escapeAttr(route.path)}"><main><h1>${escapeText(route.title)}</h1><p>${escapeText(route.description)}</p></main></noscript>`
  if (/<noscript data-seo-route=/.test(html)) {
    return html.replace(/<noscript data-seo-route="[^"]*">.*?<\/noscript>/s, content)
  }
  return html.replace(/<div id="root"><\/div>/, `<div id="root"></div>\n    ${content}`)
}

// Each route receives the same client bundle and a different head. The runtime
// can still update metadata during navigation, while direct requests and social
// previews get the right page identity before JavaScript executes.
function htmlForRoute(baseHtml, route) {
  let html = baseHtml
  html = setTitle(html, route.fullTitle)
  html = setMetaName(html, 'description', route.description)
  html = setMetaName(html, 'robots', route.indexable ? 'index,follow' : 'noindex,follow')
  html = setMetaName(html, 'theme-color', config.themeColor)
  html = setMetaName(html, 'category', config.siteCategory)
  html = setMetaName(html, 'classification', config.siteClassification)
  html = setMetaName(html, 'keywords', config.siteKeywords.join(', '))
  html = setCanonical(html, route.canonicalUrl)
  html = setMetaProperty(html, 'og:type', 'website')
  html = setMetaProperty(html, 'og:site_name', config.siteName)
  html = setMetaProperty(html, 'og:title', route.fullTitle)
  html = setMetaProperty(html, 'og:description', route.description)
  html = setMetaProperty(html, 'og:url', route.canonicalUrl)
  html = setMetaProperty(html, 'og:image', route.imageUrl)
  html = setMetaProperty(html, 'og:image:alt', route.imageAlt)
  html = setMetaProperty(html, 'og:image:width', '1200')
  html = setMetaProperty(html, 'og:image:height', '630')
  html = setMetaProperty(html, 'og:locale', 'en_US')
  html = setMetaName(html, 'twitter:card', 'summary_large_image')
  html = setMetaName(html, 'twitter:title', route.fullTitle)
  html = setMetaName(html, 'twitter:description', route.description)
  html = setMetaName(html, 'twitter:image', route.imageUrl)
  html = setMetaName(html, 'twitter:image:alt', route.imageAlt)
  html = setJsonLd(html, route)
  html = setNoScript(html, route)
  return html
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

// Public discovery files are generated from the route config so sitemap,
// robots, runtime metadata, and static route output cannot drift separately.
function buildSitemap() {
  const urls = config.routes.map((route) => [
    '  <url>',
    `    <loc>${escapeText(absoluteUrl(route.path))}</loc>`,
    `    <priority>${escapeText(route.priority)}</priority>`,
    '  </url>',
  ].join('\n'))

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n')
}

function buildRobots() {
  return [
    'User-agent: *',
    'Allow: /',
    `Sitemap: ${config.siteUrl}/sitemap.xml`,
    '',
  ].join('\n')
}

// The --sync-public mode updates source-controlled public files. The normal
// postbuild path writes the same discovery files into dist so deploy artifacts
// are complete even when public files were not regenerated in the same command.
if (syncPublic) {
  writeFile(path.join(publicDir, 'sitemap.xml'), buildSitemap())
  writeFile(path.join(publicDir, 'robots.txt'), buildRobots())
}

// During postbuild, Vite has already copied static assets and emitted the root
// HTML shell. Mutating dist keeps the source template simple while producing
// route-addressable files for static hosts and crawlers.
if (fs.existsSync(distDir)) {
  writeFile(path.join(distDir, 'sitemap.xml'), buildSitemap())
  writeFile(path.join(distDir, 'robots.txt'), buildRobots())

  const indexPath = path.join(distDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    const baseHtml = fs.readFileSync(indexPath, 'utf8')
    const rootRoute = resolveRoute('/calculator')
    writeFile(indexPath, htmlForRoute(baseHtml, rootRoute))

    // Nested index.html files let static hosting serve clean URLs without a
    // JavaScript redirect, while the React router still owns in-app navigation.
    for (const route of config.routes) {
      const resolved = resolveRoute(route.path)
      const routePath = path.join(distDir, route.path.replace(/^\/+/, ''), 'index.html')
      writeFile(routePath, htmlForRoute(baseHtml, resolved))
    }
  }
}

import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const configPath = path.join(root, 'src/shared/lib/seoRoutes.json')
const publicDir = path.join(root, 'public')
const distDir = path.join(root, 'dist')
const syncPublic = process.argv.includes('--sync-public')

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const routeByPath = new Map(config.routes.map((route) => [route.path, route]))

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

function resolveRoute(pathname) {
  const normalized = pathname === '/' ? '/calculator' : pathname.replace(/\/+$/, '') || '/calculator'
  const route = routeByPath.get(normalized)
  const title = route?.title ?? config.defaultTitle
  const description = route?.description ?? config.defaultDescription
  const pathValue = route?.path ?? normalized

  return {
    path: pathValue,
    title,
    fullTitle: title === config.defaultTitle ? title : `${title} | ${config.siteName}`,
    description,
    canonicalUrl: absoluteUrl(pathValue),
    imageUrl: absoluteUrl(config.socialImage),
    indexable: Boolean(route),
  }
}

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
        operatingSystem: 'Web',
        url: config.siteUrl,
        image: route.imageUrl,
        description: config.defaultDescription,
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

function setNoScript(html, route) {
  const content = `<noscript data-seo-route="${escapeAttr(route.path)}"><main><h1>${escapeText(route.title)}</h1><p>${escapeText(route.description)}</p></main></noscript>`
  if (/<noscript data-seo-route=/.test(html)) {
    return html.replace(/<noscript data-seo-route="[^"]*">.*?<\/noscript>/s, content)
  }
  return html.replace(/<div id="root"><\/div>/, `<div id="root"></div>\n    ${content}`)
}

function htmlForRoute(baseHtml, route) {
  let html = baseHtml
  html = setTitle(html, route.fullTitle)
  html = setMetaName(html, 'description', route.description)
  html = setMetaName(html, 'robots', route.indexable ? 'index,follow' : 'noindex,follow')
  html = setMetaName(html, 'theme-color', config.themeColor)
  html = setCanonical(html, route.canonicalUrl)
  html = setMetaProperty(html, 'og:type', 'website')
  html = setMetaProperty(html, 'og:site_name', config.siteName)
  html = setMetaProperty(html, 'og:title', route.fullTitle)
  html = setMetaProperty(html, 'og:description', route.description)
  html = setMetaProperty(html, 'og:url', route.canonicalUrl)
  html = setMetaProperty(html, 'og:image', route.imageUrl)
  html = setMetaProperty(html, 'og:image:width', '1200')
  html = setMetaProperty(html, 'og:image:height', '630')
  html = setMetaProperty(html, 'og:locale', 'en_US')
  html = setMetaName(html, 'twitter:card', 'summary_large_image')
  html = setMetaName(html, 'twitter:title', route.fullTitle)
  html = setMetaName(html, 'twitter:description', route.description)
  html = setMetaName(html, 'twitter:image', route.imageUrl)
  html = setJsonLd(html, route)
  html = setNoScript(html, route)
  return html
}

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

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

if (syncPublic) {
  writeFile(path.join(publicDir, 'sitemap.xml'), buildSitemap())
  writeFile(path.join(publicDir, 'robots.txt'), buildRobots())
}

if (fs.existsSync(distDir)) {
  writeFile(path.join(distDir, 'sitemap.xml'), buildSitemap())
  writeFile(path.join(distDir, 'robots.txt'), buildRobots())

  const indexPath = path.join(distDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    const baseHtml = fs.readFileSync(indexPath, 'utf8')
    const rootRoute = resolveRoute('/calculator')
    writeFile(indexPath, htmlForRoute(baseHtml, rootRoute))

    for (const route of config.routes) {
      const resolved = resolveRoute(route.path)
      const routePath = path.join(distDir, route.path.replace(/^\/+/, ''), 'index.html')
      writeFile(routePath, htmlForRoute(baseHtml, resolved))
    }
  }
}

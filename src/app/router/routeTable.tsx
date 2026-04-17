/*
  Author: Runor Ewhro
  Description: Defines the application's root route table and lazy-loaded
               page mappings.
*/

import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { RouteChrome } from '@/shared/ui/RouteChrome'
import AppLoaderOverlay from '@/shared/ui/AppLoaderOverlay'

// lazy-loaded route pages
const CalculatorPage = lazy(async () => ({
  default: (await import('@/modules/calculator/pages/CalculatorPage')).CalculatorPage,
}))
const SettingsPage = lazy(async () => ({
  default: (await import('@/modules/settings/pages/SettingsPage')).SettingsPage,
}))
const InfoPage = lazy(async () => ({
  default: (await import('@/modules/content/pages/InfoPage')).InfoPage,
}))
const GuidesPage = lazy(async () => ({
  default: (await import('@/modules/content/pages/GuidesPage')).GuidesPage,
}))
const ChangelogPage = lazy(async () => ({
  default: (await import('@/modules/content/pages/ChangelogPage')).ChangelogPage,
}))
const PrivacyPolicyPage = lazy(async () => ({
  default: (await import('@/modules/content/pages/PrivacyPolicyPage')).PrivacyPolicyPage,
}))
const TermsOfServicePage = lazy(async () => ({
  default: (await import('@/modules/content/pages/TermsOfServicePage')).TermsOfServicePage,
}))
const NotFoundPage = lazy(async () => ({
  default: (await import('@/modules/system/pages/NotFoundPage')).NotFoundPage,
}))

// shared suspense fallback for lazy routes
const routeFallback = <AppLoaderOverlay mode="centered" text="Loading..." />

function renderLazyRoute(node: ReactNode) {
  return <Suspense fallback={routeFallback}>{node}</Suspense>
}

// root application routes
export const rootRoutes = [
  {
    path: '/',
    element: <RouteChrome />,
    children: [
      { index: true, element: renderLazyRoute(<CalculatorPage />) },
      { path: 'settings', element: renderLazyRoute(<SettingsPage />) },
      { path: 'info', element: renderLazyRoute(<InfoPage />) },
      { path: 'guides', element: renderLazyRoute(<GuidesPage />) },
      { path: 'changelog', element: renderLazyRoute(<ChangelogPage />) },
      { path: 'privacy', element: renderLazyRoute(<PrivacyPolicyPage />) },
      { path: 'terms', element: renderLazyRoute(<TermsOfServicePage />) },
      { path: '*', element: renderLazyRoute(<NotFoundPage />) },
    ],
  },
]

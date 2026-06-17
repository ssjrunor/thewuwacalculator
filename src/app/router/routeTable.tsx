/*
  Author: Runor Ewhro
  Description: Defines the application's root route table and lazy-loaded
               page mappings.
*/

import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { RouteChrome } from '@/shared/ui/RouteChrome'
import AppLdrVrly from '@/shared/ui/AppLoaderOverlay'

// lazy-loaded route pages
const CalcPage = lazy(async () => ({
  default: (await import('@/modules/calculator/pages/CalculatorPage')).CalcPage,
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
const ChngPage = lazy(async () => ({
  default: (await import('@/modules/content/pages/ChangelogPage')).ChngPage,
}))
const PrvcPlcyPage = lazy(async () => ({
  default: (await import('@/modules/content/pages/PrivacyPolicyPage')).PrvcPlcyPage,
}))
const TrmsOfSrvcPa = lazy(async () => ({
  default: (await import('@/modules/content/pages/TermsOfServicePage')).TrmsOfSrvcPa,
}))
const NotFoundPage = lazy(async () => ({
  default: (await import('@/modules/system/pages/NotFoundPage')).NotFoundPage,
}))

// shared suspense fallback for lazy routes
const rtFllb = <AppLdrVrly mode="centered" text="Loading..." />

function viewLazyRt(node: ReactNode) {
  return <Suspense fallback={rtFllb}>{node}</Suspense>
}

// root application routes
export const rootRoutes = [
  {
    path: '/',
    element: <RouteChrome />,
    children: [
      { index: true, element: <Navigate to="/calculator" replace /> },
      { path: 'calculator', element: viewLazyRt(<CalcPage surface="calculator" />) },
      { path: 'calculator/optimizer', element: viewLazyRt(<CalcPage surface="optimizer" />) },
      { path: 'calculator/overview', element: viewLazyRt(<CalcPage surface="overview" />) },
      { path: 'settings', element: viewLazyRt(<SettingsPage />) },
      { path: 'info', element: viewLazyRt(<InfoPage />) },
      { path: 'guides', element: viewLazyRt(<GuidesPage />) },
      { path: 'changelog', element: viewLazyRt(<ChngPage />) },
      { path: 'privacy', element: viewLazyRt(<PrvcPlcyPage />) },
      { path: 'terms', element: viewLazyRt(<TrmsOfSrvcPa />) },
      { path: '*', element: viewLazyRt(<NotFoundPage />) },
    ],
  },
]

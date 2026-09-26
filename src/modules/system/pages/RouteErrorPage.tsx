/*
  Author: Runor Ewhro
  Description: Adapts React Router failures to the shared diagnostic notice and
               stays in the eager route graph so lazy-chunk failures remain visible.
*/

import { isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom'
import { useNavX } from '@/shared/navigation/useNavX'
import { APP_ROUTES } from '@/shared/lib/appRoutes'
import { ErrorNotice, readNoticeError, type NoticeError } from './ErrorNotice'

function readError(error: unknown): NoticeError {
  if (isRouteErrorResponse(error)) {
    return { message: `${error.status} ${error.statusText}`.trim(), stack: null }
  }
  return readNoticeError(error)
}

export function RouteErrorPage({ bare = false }: { bare?: boolean }) {
  const error = readError(useRouteError())
  const location = useLocation()
  const navigate = useNavX()

  return (
    <ErrorNotice
      error={error}
      route={`${location.pathname}${location.search}`}
      bare={bare}
      onHome={location.pathname !== APP_ROUTES.home ? () => navigate(APP_ROUTES.home) : undefined}
    />
  )
}

/*
  Author: Runor Ewhro
  description: a small method + path router for /api/lb/v1. a route's `:name`
               segments arrive as params; the handler gets the request, the
               env, the execution context and one `now` per request.
*/

import type { ApiEnv } from '../env.ts'
import { HttpError } from '../lib/http.ts'
import type { CardReader } from './read/dispatch.ts'

/** what a handler reaches beyond the bindings; tests and local runs substitute these. */
export interface ApiServices {
  /** reads a card image; browser rendering on READER_URL by default. */
  reader?: CardReader
}

export interface RouteContext {
  request: Request
  env: ApiEnv
  ctx: ExecutionContext
  url: URL
  params: Record<string, string>
  now: number
  services: ApiServices
}

export type Handler = (context: RouteContext) => Promise<Response>

interface Route {
  method: string
  segments: string[]
  handler: Handler
}

export class Router {
  private readonly routes: Route[] = []

  on(method: string, path: string, handler: Handler): this {
    this.routes.push({ method, segments: path.split('/').filter(Boolean), handler })
    return this
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } {
    const parts = path.split('/').filter(Boolean)
    // remember a matching path independently of its method so unsupported methods return 405 and unknown paths return 404.
    let pathMatched = false
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue
      const params: Record<string, string> = {}
      const ok = route.segments.every((segment, index) => {
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(parts[index])
          return true
        }
        return segment === parts[index]
      })
      if (!ok) continue
      pathMatched = true
      if (route.method === method) return { handler: route.handler, params }
    }
    throw pathMatched ? new HttpError('bad_request', `${method} is not allowed here`, 405) : new HttpError('not_found', 'no such route')
  }
}

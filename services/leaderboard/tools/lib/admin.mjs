/*
  Author: Runor Ewhro
  description: calls the deployed api's /admin routes from a local tool,
               through cloudflare access with a service token
               (CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET from the gitignored
               .env or the shell). LB_API_ORIGIN names the api.
*/

export function adminClient(origin = process.env.LB_API_ORIGIN) {
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (!origin) throw new Error('set LB_API_ORIGIN (or pass --api) to the leaderboard api origin')
  if (!id || !secret) throw new Error('set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (an access service token)')
  return async function admin(method, path, body) {
    const response = await fetch(`${origin.replace(/\/$/, '')}/api/lb/v1/admin${path}`, {
      method,
      headers: { 'cf-access-client-id': id, 'cf-access-client-secret': secret,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    const value = text ? JSON.parse(text) : null
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${value?.error?.code ?? ''} ${value?.error?.message ?? text}`)
    return value
  }
}

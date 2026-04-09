function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const body = await readJsonBody(request)
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!refreshToken) {
    return jsonResponse({ error: 'Missing refresh token' }, 400)
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return jsonResponse({ error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    const tokenPayload = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    })

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenPayload.toString(),
    })

    const tokens = await tokenResponse.json()
    if (!tokenResponse.ok) {
      return jsonResponse({
        error: 'Failed to refresh Google access token',
        details: tokens,
      }, 400)
    }

    return jsonResponse(tokens)
  } catch (error) {
    console.error('google token refresh failed', error)
    return jsonResponse({ error: 'Token refresh failed' }, 500)
  }
}

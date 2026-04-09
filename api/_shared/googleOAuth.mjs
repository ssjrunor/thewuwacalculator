function jsonHeaders() {
  return {
    'Content-Type': 'application/json',
  }
}

export async function readGoogleAuthRequestBody(requestLike) {
  if (requestLike instanceof Request) {
    try {
      return await requestLike.json()
    } catch {
      return {}
    }
  }

  if (typeof requestLike?.body === 'string') {
    try {
      return JSON.parse(requestLike.body)
    } catch {
      return {}
    }
  }

  return requestLike?.body ?? {}
}

export async function exchangeGoogleCode({ code, redirectUri }) {
  const tokenPayload = new URLSearchParams({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID,
    client_secret: process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri || process.env.GOOGLE_REDIRECT_URI || '',
    grant_type: 'authorization_code',
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
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Failed to exchange Google authorization code',
        details: tokens,
      },
    }
  }

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
    },
  })
  const user = await userResponse.json()

  return {
    ok: true,
    status: 200,
    body: { ...tokens, user },
  }
}

export async function refreshGoogleToken(refreshToken) {
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
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Failed to refresh Google access token',
        details: tokens,
      },
    }
  }

  return {
    ok: true,
    status: 200,
    body: tokens,
  }
}

export function validateGoogleServerCredentials() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

export function createJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: jsonHeaders(),
  })
}

export function sendNodeJson(res, body, status = 200) {
  return res.status(status).json(body)
}

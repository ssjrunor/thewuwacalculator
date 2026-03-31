function getRequestBody(req) {
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }

  return req.body ?? {}
}

export default async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { refresh_token: refreshToken } = getRequestBody(req)
  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refresh token' })
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth server credentials are not configured' })
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
      return res.status(400).json({
        error: 'Failed to refresh Google access token',
        details: tokens,
      })
    }

    return res.status(200).json(tokens)
  } catch (error) {
    console.error('google token refresh failed', error)
    return res.status(500).json({ error: 'Token refresh failed' })
  }
}

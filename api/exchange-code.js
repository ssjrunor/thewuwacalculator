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

  const { code, redirectUri } = getRequestBody(req)
  if (!code) {
    return res.status(400).json({ error: 'Missing authorization code' })
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth server credentials are not configured' })
  }

  try {
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
      return res.status(400).json({
        error: 'Failed to exchange Google authorization code',
        details: tokens,
      })
    }

    const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    })
    const user = await userResponse.json()

    return res.status(200).json({ ...tokens, user })
  } catch (error) {
    console.error('google auth code exchange failed', error)
    return res.status(500).json({ error: 'Token exchange failed' })
  }
}

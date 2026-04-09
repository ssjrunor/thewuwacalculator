import {
  readGoogleAuthRequestBody,
  refreshGoogleToken,
  sendNodeJson,
  validateGoogleServerCredentials,
} from './_shared/googleOAuth.mjs'

export default async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    return sendNodeJson(res, { error: 'Method not allowed' }, 405)
  }

  const body = await readGoogleAuthRequestBody(req)
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : ''
  if (!refreshToken) {
    return sendNodeJson(res, { error: 'Missing refresh token' }, 400)
  }

  if (!validateGoogleServerCredentials()) {
    return sendNodeJson(res, { error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    const result = await refreshGoogleToken(refreshToken)
    return sendNodeJson(res, result.body, result.status)
  } catch (error) {
    console.error('google token refresh failed', error)
    return sendNodeJson(res, { error: 'Token refresh failed' }, 500)
  }
}

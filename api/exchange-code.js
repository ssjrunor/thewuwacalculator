import {
  exchangeGoogleCode,
  readGoogleAuthRequestBody,
  sendNodeJson,
  validateGoogleServerCredentials,
} from './_shared/googleOAuth.mjs'

export default async function handler(req, res) {
  if (req.method && req.method !== 'POST') {
    return sendNodeJson(res, { error: 'Method not allowed' }, 405)
  }

  const { code, redirectUri } = await readGoogleAuthRequestBody(req)
  if (typeof code !== 'string' || code.length === 0) {
    return sendNodeJson(res, { error: 'Missing authorization code' }, 400)
  }

  if (!validateGoogleServerCredentials()) {
    return sendNodeJson(res, { error: 'Google OAuth server credentials are not configured' }, 500)
  }

  try {
    const result = await exchangeGoogleCode({ code, redirectUri })
    return sendNodeJson(res, result.body, result.status)
  } catch (error) {
    console.error('google auth code exchange failed', error)
    return sendNodeJson(res, { error: 'Token exchange failed' }, 500)
  }
}

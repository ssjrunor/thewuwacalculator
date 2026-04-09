export function getGoogleAuthEndpoint(path: 'exchange-code' | 'refresh-token'): string {
  return `/api/${path}`
}

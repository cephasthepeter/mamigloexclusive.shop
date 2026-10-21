import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { HttpRequest } from '@azure/functions'
import { RequestError } from './http.js'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
let jwksTenant: string | undefined

export async function requireAdmin(request: HttpRequest): Promise<string> {
  const tenantId = process.env.ENTRA_TENANT_ID
  const audience = process.env.ENTRA_API_CLIENT_ID
  const configuredAdmins = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
  if (!tenantId || !audience || configuredAdmins.length === 0) {
    throw new RequestError(503, 'Admin sign-in is not configured. Set up the store administrator identity first.')
  }
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  if (!token) throw new RequestError(401, 'Administrator sign-in is required.')

  if (!jwks || jwksTenant !== tenantId) {
    jwks = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
    jwksTenant = tenantId
  }
  let payload
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      audience,
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    }))
  } catch {
    throw new RequestError(401, 'The administrator session is invalid or has expired.')
  }
  const email = String(payload.email || payload.preferred_username || '').toLowerCase()
  if (!email || !configuredAdmins.includes(email)) {
    throw new RequestError(403, 'This account is not authorised to manage the store.')
  }
  return email
}

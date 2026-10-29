import { createClient } from '@supabase/supabase-js'

const env = import.meta.env

export const supabaseConfigured = Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_PUBLISHABLE_KEY)
export const googleAuthEnabled = env.VITE_ENABLE_GOOGLE_AUTH === 'true'
export const phoneAuthEnabled = env.VITE_ENABLE_PHONE_AUTH === 'true'

export const supabase = createClient(
  env.VITE_SUPABASE_URL || 'https://not-configured.supabase.co',
  env.VITE_SUPABASE_PUBLISHABLE_KEY || 'not-configured',
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  },
)

export function normalizeEmail(value?: string | null) {
  return String(value ?? '').trim().toLowerCase()
}

export function isAdminEmail(email?: string | null, allowlist: string[] = []) {
  const normalized = normalizeEmail(email)
  if (!normalized) return false
  return allowlist.some((candidate) => normalizeEmail(candidate) === normalized)
}

export class AdminEligibilityCheckError extends Error {
  constructor() {
    super('Administrator access could not be verified. The server-side permission check is unavailable.')
    this.name = 'AdminEligibilityCheckError'
  }
}

export class AdminNotAuthorizedError extends Error {
  constructor() {
    super('This account is not on the authorised administrator list.')
    this.name = 'AdminNotAuthorizedError'
  }
}

export class AdminEmailNotVerifiedError extends Error {
  constructor() {
    super('Confirm your email address before signing in to administrator access.')
    this.name = 'AdminEmailNotVerifiedError'
  }
}

export async function getAdminEligibility(email?: string | null) {
  const normalized = normalizeEmail(email)
  if (!normalized || !supabaseConfigured) return false

  try {
    const { data, error } = await supabase.rpc('is_current_user_store_admin')

    if (error) {
      console.warn('Admin allowlist lookup failed.', error.message)
      throw new AdminEligibilityCheckError()
    }

    return data === true
  } catch (error) {
    if (error instanceof AdminEligibilityCheckError) throw error
    console.warn('Admin eligibility check failed.', error)
    throw new AdminEligibilityCheckError()
  }
}

export async function signInAdministrator(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  })
  if (error) throw error
  if (!data.user?.email || !data.session?.access_token) {
    throw new Error('Administrator sign-in did not return an active session.')
  }
  if (!data.user.email_confirmed_at) {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) console.warn('Could not clear the unconfirmed admin session.', signOutError.message)
    throw new AdminEmailNotVerifiedError()
  }

  const eligible = await getAdminEligibility(data.user.email)
  if (!eligible) {
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) console.warn('Could not clear the non-admin session.', signOutError.message)
    throw new AdminNotAuthorizedError()
  }

  return { email: data.user.email, token: data.session.access_token }
}

export function getAuthRedirectUrl(path = '/account') {
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

export function requireSupabase() {
  if (!supabaseConfigured) {
    throw new Error('The store database is not configured yet. Add the Supabase project URL and publishable key to the frontend environment.')
  }
}

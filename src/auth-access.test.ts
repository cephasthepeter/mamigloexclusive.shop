import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminEligibilityCheckError, AdminNotAuthorizedError, getAdminEligibility, isAdminEmail, normalizeEmail, signInAdministrator, supabase } from './supabase'
import { adminRedirectForState, pageFromPath } from './App'
import { storeApi } from './api'

afterEach(() => vi.restoreAllMocks())

describe('admin allowlist checks', () => {
  it('normalises admin email values before comparison', () => {
    expect(normalizeEmail('  Admin@Example.com  ')).toBe('admin@example.com')
  })

  it('accepts only allowlisted administrator addresses', () => {
    expect(isAdminEmail('admin@example.com', ['admin@example.com', 'owner@example.com'])).toBe(true)
    expect(isAdminEmail('customer@example.com', ['admin@example.com', 'owner@example.com'])).toBe(false)
    expect(isAdminEmail('', ['admin@example.com'])).toBe(false)
  })

  it('uses the server-side authorization check for a signed-in admin', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: true, error: null } as never)

    await expect(getAdminEligibility('admin@example.com')).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith('is_current_user_store_admin')
  })

  it('denies a signed-in customer when the server-side check returns false', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: false, error: null } as never)

    await expect(getAdminEligibility('customer@example.com')).resolves.toBe(false)
  })

  it('surfaces an unavailable server-side check instead of misreporting access denied', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: null, error: { message: 'function missing' } } as never)

    await expect(getAdminEligibility('admin@example.com')).rejects.toBeInstanceOf(AdminEligibilityCheckError)
  })

  it.each(['Invalid login credentials', 'User not found'])(
    'preserves Supabase credential errors: %s', async (message) => {
      vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({ data: { user: null, session: null }, error: { message } } as never)

      await expect(signInAdministrator('admin@example.com', 'not-a-real-password')).rejects.toMatchObject({ message })
    },
  )

  it('returns the active session only after the database authorizes the admin', async () => {
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
      data: { user: { email: 'admin@example.com' }, session: { access_token: 'test-session-token' } },
      error: null,
    } as never)
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: true, error: null } as never)

    await expect(signInAdministrator(' ADMIN@example.com ', 'test-password')).resolves.toEqual({
      email: 'admin@example.com',
      token: 'test-session-token',
    })
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'admin@example.com', password: 'test-password' })
  })

  it('signs out an authenticated user who is not authorized as an admin', async () => {
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
      data: { user: { email: 'customer@example.com' }, session: { access_token: 'test-session-token' } },
      error: null,
    } as never)
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: false, error: null } as never)
    const signOut = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null } as never)

    await expect(signInAdministrator('customer@example.com', 'test-password')).rejects.toBeInstanceOf(AdminNotAuthorizedError)
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('blocks unauthenticated users from admin product operations', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({ data: { user: null }, error: null } as never)

    await expect(storeApi.admin.products('')).rejects.toMatchObject({ status: 401 })
  })

  it('blocks authenticated customers from admin product operations', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { email: 'customer@example.com' } },
      error: null,
    } as never)
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: false, error: null } as never)

    await expect(storeApi.admin.products('')).rejects.toMatchObject({ status: 403 })
  })
})

describe('administrator routes', () => {
  it('recognizes the dedicated admin login path before the admin dashboard path', () => {
    expect(pageFromPath('/admin/login')).toBe('admin-login')
    expect(pageFromPath('/admin')).toBe('admin')
  })

  it('sends guests to login and verified administrators to the dashboard', () => {
    expect(adminRedirectForState('admin', 'guest')).toBe('admin-login')
    expect(adminRedirectForState('admin-login', 'admin')).toBe('admin')
  })

  it('restores an authorized session on refresh without redirecting away from the dashboard', () => {
    expect(adminRedirectForState('admin', 'admin')).toBeNull()
  })

  it('sends expired or logged-out sessions back to admin login', () => {
    expect(adminRedirectForState('admin', 'guest')).toBe('admin-login')
  })

  it('does not redirect customers or unresolved authorization checks into the dashboard', () => {
    expect(adminRedirectForState('admin', 'customer')).toBeNull()
    expect(adminRedirectForState('admin-login', 'loading')).toBeNull()
    expect(adminRedirectForState('admin-login', 'error')).toBeNull()
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdminEligibilityCheckError, AdminEmailNotVerifiedError, AdminNotAuthorizedError, getAdminEligibility, isAdminEmail, normalizeEmail, signInAdministrator, supabase } from './supabase'
import { adminRedirectForState, checkoutValidationError, pageFromPath } from './App'
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
      data: { user: { email: 'admin@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }, session: { access_token: 'test-session-token' } },
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
      data: { user: { email: 'customer@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }, session: { access_token: 'test-session-token' } },
      error: null,
    } as never)
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: false, error: null } as never)
    const signOut = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null } as never)

    await expect(signInAdministrator('customer@example.com', 'test-password')).rejects.toBeInstanceOf(AdminNotAuthorizedError)
    expect(signOut).toHaveBeenCalledOnce()
  })

  it('signs out an allowlisted account until its email is confirmed', async () => {
    vi.spyOn(supabase.auth, 'signInWithPassword').mockResolvedValue({
      data: { user: { email: 'admin@example.com' }, session: { access_token: 'test-session-token' } },
      error: null,
    } as never)
    const signOut = vi.spyOn(supabase.auth, 'signOut').mockResolvedValue({ error: null } as never)

    await expect(signInAdministrator('admin@example.com', 'test-password')).rejects.toBeInstanceOf(AdminEmailNotVerifiedError)
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

  it('blocks authenticated customers from changing payment status', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { email: 'customer@example.com' } },
      error: null,
    } as never)
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: false, error: null } as never)

    await expect(storeApi.admin.updatePaymentStatus('', 'order-id', 'Paid'))
      .rejects.toMatchObject({ status: 403 })
  })

  it('blocks authenticated customers from reviewing payments or updating shipping', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { email: 'customer@example.com' } },
      error: null,
    } as never)
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: false, error: null } as never)

    await expect(storeApi.admin.reviewPayment('', 'order-id', 'confirm'))
      .rejects.toMatchObject({ status: 403 })
    await expect(storeApi.admin.updateShipping('', 'order-id', 'Courier', 'TRACK-1'))
      .rejects.toMatchObject({ status: 403 })
  })

  it('submits a customer-owned OPay payment reference as pending verification only', async () => {
    vi.spyOn(supabase.auth, 'getUser').mockResolvedValue({
      data: { user: { id: 'customer-user-id', email: 'customer@example.com' } },
      error: null,
    } as never)
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: { orderId: 'order-id', paymentStatus: 'Pending Verification', submittedAt: '2026-03-01T10:00:00.000Z', amount: 12000 },
      error: null,
    } as never)

    await expect(storeApi.customer.submitPaymentConfirmation('order-id', ' OP-123 ', 12000))
      .resolves.toEqual({ submittedAt: '2026-03-01T10:00:00.000Z' })
    expect(rpc).toHaveBeenCalledWith('submit_order_payment_confirmation', {
      p_order_id: 'order-id',
      p_customer_user_id: 'customer-user-id',
      p_payment_reference: 'OP-123',
      p_payment_amount: 12000,
      p_payment_method: 'opay_transfer',
    })
  })
})

describe('administrator routes', () => {
  it('recognizes the dedicated admin login path before the admin dashboard path', () => {
    expect(pageFromPath('/admin/login')).toBe('admin-login')
    expect(pageFromPath('/admin')).toBe('admin')
  })

  it('sends guests to login and verified administrators to the dashboard', () => {
    expect(adminRedirectForState('admin', 'guest')).toBe('admin-login')
    expect(adminRedirectForState('admin-login', 'admin')).toBeNull()
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
    expect(adminRedirectForState('admin', 'unverified')).toBe('admin-login')
    expect(adminRedirectForState('admin-login', 'unverified')).toBeNull()
  })

  it('recognizes the journal homepage and individual article routes', () => {
    expect(pageFromPath('/journal')).toBe('journal')
    expect(pageFromPath('/journal/choose-the-perfect-tie-for-every-occasion')).toBe('journal-article')
    expect(pageFromPath('/journal/choose-the-perfect-tie-for-every-occasion/')).toBe('journal-article')
  })
})

describe('checkout validation', () => {
  const customer = {
    fullName: 'Test Customer',
    phone: '+234 801 234 5678',
    email: 'customer@example.com',
    address: '12 Test Street',
    state: 'Lagos',
    city: 'Ikeja',
    deliveryMethod: 'Courier delivery',
  }
  const items = [{ productId: '11111111-1111-4111-8111-111111111111', quantity: 1 }]

  it('accepts valid checkout details and item quantities', () => {
    expect(checkoutValidationError(customer, items)).toBe('')
  })

  it('explains invalid phone number formats before sending the order', () => {
    expect(checkoutValidationError({ ...customer, phone: 'call me' }, items)).toContain('phone number')
  })

  it('blocks item quantities above the server limit', () => {
    expect(checkoutValidationError(customer, [{ ...items[0], quantity: 21 }])).toContain('between 1 and 20')
  })

  it('rejects malformed optional email addresses', () => {
    expect(checkoutValidationError({ ...customer, email: 'not-an-email' }, items)).toContain('valid email')
  })
})

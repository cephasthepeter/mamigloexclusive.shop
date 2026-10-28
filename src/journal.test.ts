import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./supabase', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./supabase')>()
  return { ...actual, requireSupabase: vi.fn() }
})
import { subscribeToJournal, validateJournalEmail } from './journal'
import { supabase } from './supabase'

afterEach(() => vi.restoreAllMocks())

describe('journal newsletter validation', () => {
  it('normalizes valid email addresses', () => {
    expect(validateJournalEmail('  Reader@Example.com ')).toBe('reader@example.com')
  })

  it.each(['', 'not-an-email', 'reader@', '@example.com', 'reader@example', 'reader @example.com'])(
    'rejects malformed email addresses: %s', (email) => {
      expect(validateJournalEmail(email)).toBe('')
    },
  )

  it('reports a new subscription only after the backend confirms it', async () => {
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: 'subscribed', error: null } as never)

    await expect(subscribeToJournal('Reader@Example.com')).resolves.toBe('subscribed')
    expect(rpc).toHaveBeenCalledWith('subscribe_to_journal', { p_email: 'reader@example.com' })
  })

  it('returns the backend duplicate result without claiming a new subscription', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: 'already_subscribed', error: null } as never)

    await expect(subscribeToJournal('reader@example.com')).resolves.toBe('already_subscribed')
  })

  it('does not call the backend for malformed addresses', async () => {
    const rpc = vi.spyOn(supabase, 'rpc')

    await expect(subscribeToJournal('invalid')).rejects.toThrow('Enter a valid email address.')
    expect(rpc).not.toHaveBeenCalled()
  })
})
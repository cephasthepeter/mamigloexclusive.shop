import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, Home, ShieldCheck, Sparkles } from 'lucide-react'
import { ApiError } from '../api'
import { getAuthRedirectUrl, googleAuthEnabled, phoneAuthEnabled, supabase } from '../supabase'
import type { CustomerAddressInput, Product } from '../types'
import { CustomerAccountDashboard } from './CustomerAccountDashboard'

type AuthMode = 'sign-in' | 'sign-up'
interface CustomerAccountProps {
  initialMode?: AuthMode
  checkoutRequired?: boolean
  products: Product[]
  cartItemCount: number
  onAddToCart: (product: Product) => void
  onNavigate?: (target: 'home' | 'shop' | 'checkout' | 'contact' | 'returns' | 'login' | 'register' | 'account') => void
  onOpenProduct?: (product: Product) => void
  onUseAddress?: (address: CustomerAddressInput) => void
  onOpenCart?: () => void
}

function passwordStrength(value: string) {
  const checks = {
    length: value.length >= 8,
    number: /\d/.test(value),
    symbol: /[^A-Za-z0-9]/.test(value),
  }
  const passed = Object.values(checks).filter(Boolean).length
  if (!value) return { label: 'Password guidance', score: 0, checks }
  if (passed <= 1) return { label: 'Weak', score: 1, checks }
  if (passed === 2) return { label: 'Fair', score: 2, checks }
  if (passed === 3) return { label: 'Strong', score: 3, checks }
  return { label: 'Excellent', score: 4, checks }
}

export function CustomerAccount({ initialMode = 'sign-in', checkoutRequired = false, products, cartItemCount, onAddToCart, onNavigate, onOpenProduct, onUseAddress, onOpenCart }: CustomerAccountProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState('')
  const [mode, setMode] = useState<AuthMode>(initialMode)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [initialising, setInitialising] = useState(true)
  const [acceptTerms, setAcceptTerms] = useState(false)
  const strength = useMemo(() => passwordStrength(password), [password])

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  useEffect(() => {
    if (!signedInEmail || sessionStorage.getItem('mamigloexclusive.checkout-return') !== '1') return
    sessionStorage.removeItem('mamigloexclusive.checkout-return')
    onNavigate?.('checkout')
  }, [onNavigate, signedInEmail])

  useEffect(() => {
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setSignedInEmail(session?.user.email || '')
      setInitialising(false)
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSignedInEmail(data.session?.user.email || '')
      setInitialising(false)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  async function handleGoogleSignIn() {
    if (!googleAuthEnabled) {
      setError(`Google ${mode === 'sign-up' ? 'signup' : 'sign-in'} is not configured yet. Configure the Google provider in Supabase Auth and set VITE_ENABLE_GOOGLE_AUTH=true.`)
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: getAuthRedirectUrl('/account') },
      })
      if (oauthError) throw oauthError
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google sign-in could not be started.')
      setBusy(false)
    }
  }

  async function handlePhoneLogin() {
    if (!phoneAuthEnabled) {
      setError('Phone sign-in is not configured for this project. Enable phone auth in Supabase Auth and set VITE_ENABLE_PHONE_AUTH=true to enable it.')
      return
    }

    const trimmed = phoneNumber.trim()
    if (!trimmed) {
      setError('Enter the phone number you want to use for verification.')
      return
    }

    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: otpError } = await supabase.auth.signInWithOtp({
        phone: trimmed,
        options: { shouldCreateUser: false },
      })
      if (otpError) throw otpError
      setNotice('A verification code has been sent to your phone number.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Phone sign-in could not be started.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (mode === 'sign-up') {
        const trimmedName = fullName.trim()
        const trimmedEmail = email.trim()
        if (!trimmedName) throw new Error('Please enter your full name.')
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error('Enter a valid email address.')
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.')
        if (password !== confirmPassword) throw new Error('Your passwords do not match.')
        if (!acceptTerms) throw new Error('Please accept the terms and privacy policy to continue.')

        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: { full_name: trimmedName },
            emailRedirectTo: getAuthRedirectUrl('/account'),
          },
        })
        if (signUpError) throw signUpError
        if (data.session) {
          setSignedInEmail(data.user?.email || trimmedEmail)
          const returningToCheckout = sessionStorage.getItem('mamigloexclusive.checkout-return') === '1'
          if (returningToCheckout) sessionStorage.removeItem('mamigloexclusive.checkout-return')
          onNavigate?.(returningToCheckout ? 'checkout' : 'account')
        }
        else setNotice('Check your email to confirm your account, then sign in here.')
        setPassword('')
        setConfirmPassword('')
      } else {
        const trimmedEmail = email.trim()
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) throw new Error('Enter a valid email address.')
        const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: trimmedEmail, password })
        if (signInError) throw signInError
        setSignedInEmail(data.user.email || trimmedEmail)
        const returningToCheckout = sessionStorage.getItem('mamigloexclusive.checkout-return') === '1'
        if (returningToCheckout) sessionStorage.removeItem('mamigloexclusive.checkout-return')
        onNavigate?.(returningToCheckout ? 'checkout' : 'account')
        setPassword('')
      }
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : reason instanceof Error ? reason.message : 'Your account request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function requestPasswordReset() {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter your email address to receive a password reset link.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmed, {
        redirectTo: getAuthRedirectUrl('/account'),
      })
      if (resetError) throw resetError
      setNotice('Password reset instructions have been sent to your email address.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Your password reset request could not be completed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setError('')
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
    setSignedInEmail('')
  }

  if (initialising) return <main className="content-page auth-page"><section className="auth-shell auth-shell--loading"><div className="auth-panel"><p className="eyebrow">CUSTOMER ACCOUNT</p><h1>Loading your account.</h1><p className="auth-copy">Checking your session securely…</p></div></section></main>

  if (signedInEmail) return <CustomerAccountDashboard
    email={signedInEmail}
    products={products}
    cartItemCount={cartItemCount}
    onAddToCart={onAddToCart}
    onNavigate={(target) => onNavigate?.(target)}
    onOpenProduct={(product) => onOpenProduct?.(product)}
    onUseAddress={(address) => onUseAddress?.(address)}
    onOpenCart={() => onOpenCart?.()}
    onSignOut={signOut}
  />

  return <main className="content-page auth-page">
    <section className="auth-shell">
      <div className="auth-visual">
        <div className="auth-visual-overlay" />
        <div className="auth-brand-mark"><span>M</span><div><strong>Mamigloexclusive</strong><small>Menswear essentials</small></div></div>
        <div className="auth-visual-copy">
          <p className="eyebrow">STYLE THAT SPEAKS.</p>
          <h1>CONFIDENCE<br />THAT LASTS.</h1>
          <p>Discover timeless accessories and elevate every look with Mamigloexclusive.</p>
        </div>
        <button className="auth-back-link" type="button" onClick={() => onNavigate ? onNavigate('home') : window.location.assign('/')}>
          <Home size={15} /> Continue shopping
        </button>
      </div>

      <div className="auth-panel">
        <div className="auth-header">
          <p className="eyebrow">CUSTOMER ACCOUNT</p>
          <h2>{mode === 'sign-in' ? 'Welcome Back' : 'Create Your Account'}</h2>
          <p>{mode === 'sign-in' ? 'Sign in to continue your shopping experience.' : 'Join Mamigloexclusive for a seamless shopping experience.'}</p>
        </div>

        {checkoutRequired && <p className="success-message" role="status">Create an account or sign in to complete your purchase. Your bag and checkout details will be here when you return.</p>}

        {error && <div className="error-notice" role="alert">{error}</div>}
        {notice && <p className="success-message" role="status">{notice}</p>}

        <div className="auth-method-switch" role="tablist" aria-label="Authentication mode">
          <button type="button" className={mode === 'sign-in' ? 'selected' : ''} onClick={() => { setMode('sign-in'); setError(''); setNotice(''); }}>Sign in</button>
          <button type="button" className={mode === 'sign-up' ? 'selected' : ''} onClick={() => { setMode('sign-up'); setError(''); setNotice(''); }}>Create account</button>
        </div>

        <form className="auth-form" onSubmit={submit} noValidate>
          {mode === 'sign-up' && (
            <label className="field">
              <span>Full name</span>
              <input type="text" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" required />
            </label>
          )}

          <label className="field">
            <span>Email address</span>
            <input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required />
          </label>

          <label className="field">
            <span>Password</span>
            <div className="password-field">
              <input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
              <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((current) => !current)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          {mode === 'sign-up' && (
            <>
              <label className="field">
                <span>Confirm password</span>
                <div className="password-field">
                  <input type={showConfirmPassword ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Re-enter your password" required />
                  <button type="button" className="password-toggle" aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} onClick={() => setShowConfirmPassword((current) => !current)}>
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>

              <div className="password-strength" aria-live="polite">
                <div className="password-strength-header"><span>Password strength</span><strong>{strength.label}</strong></div>
                <div className="password-strength-meter">
                  {[1, 2, 3].map((step) => <span key={step} className={step <= strength.score ? 'active' : ''} />)}
                </div>
                <ul>
                  <li className={strength.checks.length ? 'ok' : ''}>At least 8 characters</li>
                  <li className={strength.checks.number ? 'ok' : ''}>Contains a number</li>
                  <li className={strength.checks.symbol ? 'ok' : ''}>Contains a symbol</li>
                </ul>
              </div>
            </>
          )}

          {mode === 'sign-in' && (
            <div className="auth-row">
              <button type="button" className="text-link text-link--inline" onClick={requestPasswordReset}>Forgot password?</button>
            </div>
          )}

          {mode === 'sign-up' && (
            <label className="checkbox-row checkbox-row--wide">
              <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} />
              <span>I agree to the <a href="/terms" target="_blank" rel="noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span>
            </label>
          )}

          <button type="submit" className="button button-dark auth-submit" disabled={busy}>
            {busy ? (mode === 'sign-in' ? 'Signing in…' : 'Creating account…') : mode === 'sign-in' ? 'Sign In' : 'Create Account'}
            <ArrowRight size={16} />
          </button>
        </form>

        <div className="auth-divider"><span>OR CONTINUE WITH</span></div>

        <div className="auth-provider-list">
          <button type="button" className="auth-provider" onClick={handleGoogleSignIn} disabled={busy}>
            <Sparkles size={16} /> {mode === 'sign-up' ? 'Sign up with Google' : 'Continue with Google'}
          </button>
          {!googleAuthEnabled && <p className="auth-provider-note">Google sign-in and signup require Google OAuth credentials in Supabase Auth and VITE_ENABLE_GOOGLE_AUTH=true.</p>}

          {phoneAuthEnabled ? (
            <div className="phone-auth-box">
              <label className="field field--compact">
                <span>Phone number</span>
                <input type="tel" value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+234 800 000 0000" />
              </label>
              <button type="button" className="auth-provider auth-provider--secondary" onClick={handlePhoneLogin} disabled={busy}>
                <ShieldCheck size={16} /> Continue with phone
              </button>
            </div>
          ) : null}
        </div>

        <p className="auth-footer-text">
          {mode === 'sign-in' ? 'New to Mamigloexclusive?' : 'Already have an account?'}{' '}
          <button type="button" className="text-link text-link--inline" onClick={() => {
            setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
            setError('')
            setNotice('')
            if (onNavigate) onNavigate(mode === 'sign-in' ? 'register' : 'login')
          }}>
            {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
          </button>
        </p>
      </div>
    </section>
  </main>
}

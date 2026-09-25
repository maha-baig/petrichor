import { useEffect, useState } from 'react'
import { Feather } from 'lucide-react'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'

/**
 * Who's writing. Returns undefined while we're still asking, null when nobody
 * is signed in, and the session once there is one — so a page can tell
 * "loading" apart from "signed out" and not flash a sign-in form at her.
 */
export function useSession() {
  const [session, setSession] = useState(isSupabaseConfigured ? undefined : null)

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let alive = true
    supabase.auth.getSession().then(({ data }) => alive && setSession(data?.session || null))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => alive && setSession(s || null))
    return () => {
      alive = false
      sub?.subscription?.unsubscribe()
    }
  }, [])

  return session
}

/**
 * True once she's arrived from a "reset your password" email: Supabase has
 * signed her in for that one purpose, and the app should ask for a new one.
 */
export function usePasswordRecovery() {
  const [recovering, setRecovering] = useState(
    typeof window !== 'undefined' && /type=recovery/.test(window.location.hash),
  )
  useEffect(() => {
    if (!isSupabaseConfigured) return
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
    })
    return () => sub?.subscription?.unsubscribe()
  }, [])
  return [recovering, () => setRecovering(false)]
}

export async function signOut() {
  await supabase?.auth.signOut()
}

/**
 * A link that didn't work (an expired reset or confirmation email) comes back
 * as an error in the URL fragment. Read it once, say it plainly, and clear it
 * from the address bar so a refresh doesn't repeat it.
 */
function readLinkError() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash || !hash.includes('error')) return null
  const p = new URLSearchParams(hash.slice(1))
  const code = p.get('error_code')
  const raw = p.get('error_description')?.replace(/\+/g, ' ')
  if (!p.get('error') && !code) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  if (code === 'otp_expired') return 'That email link has expired. Request a fresh one below.'
  return raw || 'That email link could not be used. Request a fresh one below.'
}

export const linkError = readLinkError()

// Supabase's messages are written for developers; say the common ones plainly.
function plain(message) {
  if (/invalid login credentials/i.test(message)) return 'That email and password don’t match. Try again, or reset your password.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email first: open the link we sent you, then sign in.'
  if (/already registered|already been registered/i.test(message)) return 'There’s already an account with that email. Sign in instead.'
  if (/password should be at least/i.test(message)) return 'Use a password of at least 8 characters.'
  if (/rate limit/i.test(message)) return 'Too many tries. Wait a minute and try again.'
  return message
}

const field =
  'w-full rounded-full border border-line bg-card px-5 py-3 text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none'
const primary =
  'w-full rounded-full bg-fuchsia px-6 py-3 font-grotesk font-bold text-white transition-transform hover:scale-[1.01] disabled:opacity-60'

/**
 * The one way in. Email and password; a new account from the same form; a
 * reset link for a forgotten password; and, arriving from that link, a place
 * to choose the new one.
 */
export default function SignIn({ recovering = false, onRecovered }) {
  const [mode, setMode] = useState(recovering ? 'new-password' : 'sign-in') // sign-in | sign-up | reset | new-password
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(linkError)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (recovering) setMode('new-password')
  }, [recovering])

  // Off to Google and back: Supabase returns her here with a session in the URL.
  async function withGoogle() {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(
        /provider is not enabled|Unsupported provider/i.test(error.message)
          ? 'Google sign-in isn’t switched on yet. Use your email and password for now.'
          : plain(error.message),
      )
      setBusy(false)
    }
  }

  function go(next) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'sign-up') {
        if (password.length < 8) throw new Error('Use a password of at least 8 characters.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        // With email confirmation on, there's no session until she clicks the link.
        if (!data.session) {
          setNotice(`Almost there. Open the link we sent to ${email.trim()}, then sign in here.`)
          setMode('sign-in')
        }
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: window.location.origin,
        })
        if (error) throw error
        setNotice(`If there's an account for ${email.trim()}, a reset link is on its way.`)
      } else if (mode === 'new-password') {
        if (password.length < 8) throw new Error('Use a password of at least 8 characters.')
        const { error } = await supabase.auth.updateUser({ password })
        if (error) throw error
        window.history.replaceState(null, '', window.location.pathname + window.location.search)
        onRecovered?.()
      }
    } catch (err) {
      setError(plain(err.message || String(err)))
    } finally {
      setBusy(false)
    }
  }

  if (!isSupabaseConfigured) {
    return (
      <p className="mx-auto mt-16 max-w-md rounded-sm border border-dashed border-line p-8 text-center text-sm text-muted">
        Sign-in needs Supabase. Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to{' '}
        <code>.env</code>.
      </p>
    )
  }

  const heading = {
    'sign-in': 'Welcome back',
    'sign-up': 'Make an account',
    reset: 'Reset your password',
    'new-password': 'Choose a new password',
  }[mode]

  return (
    <section className="mx-auto mt-10 w-full max-w-sm animate-rise sm:mt-16">
      <div className="text-center">
        <Feather size={28} className="mx-auto text-fuchsia" />
        <h1 className="mt-4 font-serif text-4xl italic text-ink">{heading}</h1>
        {mode === 'sign-in' && <p className="mt-2 text-sm text-muted">Your books and workspaces are waiting.</p>}
        {mode === 'reset' && <p className="mt-2 text-sm text-muted">We'll email you a link to choose a new one.</p>}
      </div>

      {(mode === 'sign-in' || mode === 'sign-up') && (
        <>
          <button
            type="button"
            onClick={withGoogle}
            disabled={busy}
            className="mt-8 flex w-full items-center justify-center gap-3 rounded-full border border-line bg-card px-6 py-3 font-grotesk font-bold text-body transition-colors hover:border-fuchsia disabled:opacity-60"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7z" />
              <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.4 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9h-4v3.1A12 12 0 0 0 12 24z" />
              <path fill="#FBBC05" d="M5.4 14.4a7.2 7.2 0 0 1 0-4.7V6.6h-4a12 12 0 0 0 0 10.9l4-3.1z" />
              <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.4 6.6l4 3.1C6.3 6.9 8.9 4.8 12 4.8z" />
            </svg>
            Continue with Google
          </button>
          <div className="mt-6 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            or with email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} className={'flex flex-col gap-3 ' + (mode === 'sign-in' || mode === 'sign-up' ? 'mt-6' : 'mt-8')}>
        {mode !== 'new-password' && (
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email"
            className={field}
          />
        )}
        {mode !== 'reset' && (
          <input
            type="password"
            required
            minLength={mode === 'sign-in' ? undefined : 8}
            autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'sign-in' ? 'Password' : 'At least 8 characters'}
            aria-label="Password"
            className={field}
          />
        )}
        <button type="submit" disabled={busy} className={primary + ' mt-2'}>
          {busy
            ? 'One moment…'
            : { 'sign-in': 'Sign in', 'sign-up': 'Create account', reset: 'Send reset link', 'new-password': 'Save password' }[mode]}
        </button>
      </form>

      {error && <p className="mt-4 text-center text-sm text-fuchsia">{error}</p>}
      {notice && <p className="mt-4 text-center text-sm text-body">{notice}</p>}

      <div className="mt-6 flex flex-col items-center gap-2 text-sm text-muted">
        {mode === 'sign-in' && (
          <>
            <button onClick={() => go('reset')} className="hover:text-fuchsia">
              Forgot your password?
            </button>
            <span>
              New here?{' '}
              <button onClick={() => go('sign-up')} className="text-body underline underline-offset-2 hover:text-fuchsia">
                Make an account
              </button>
            </span>
          </>
        )}
        {(mode === 'sign-up' || mode === 'reset') && (
          <button onClick={() => go('sign-in')} className="hover:text-fuchsia">
            ← Back to sign in
          </button>
        )}
      </div>
    </section>
  )
}

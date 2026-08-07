import { useEffect, useState } from 'react'
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

export async function signOut() {
  await supabase?.auth.signOut()
}

/**
 * A link that didn't work comes back as an error in the URL fragment, e.g.
 *   #error=access_denied&error_code=otp_expired&error_description=...
 * Supabase can't turn that into a session, so nothing happens on screen unless
 * we read it ourselves. Read it once, say it plainly, and clear it from the URL
 * so a refresh doesn't accuse her twice.
 */
function readLinkError() {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash || !hash.includes('error')) return null

  const p = new URLSearchParams(hash.slice(1))
  const code = p.get('error_code')
  const raw = p.get('error_description')?.replace(/\+/g, ' ')
  if (!p.get('error') && !code) return null

  // Tidy the address bar — the error has been read.
  window.history.replaceState(null, '', window.location.pathname + window.location.search)

  if (code === 'otp_expired')
    return 'That link has expired. They only last an hour, and each one can be opened once. Send yourself a fresh one below.'
  if (code === 'access_denied')
    return 'That link could not be used. It may already have been opened. Send yourself a fresh one below.'
  return raw || 'That link could not be used. Send yourself a fresh one below.'
}

// Read at import, before anything renders: the link lands on whatever page she
// was on, which usually isn't the one holding the sign-in form. Keeping the
// answer here lets the app send her somewhere that can actually explain it.
export const linkError = readLinkError()

/**
 * Magic link only — no password to choose, forget, or leak. Supabase mails a
 * link; clicking it comes back here with a session already in hand.
 */
export default function SignIn({ title = 'Keep your work', blurb }) {
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState('idle') // idle | sending | sent
  // A dead link should explain itself the moment she lands, not sit silent
  // while she wonders whether anything happened.
  const [error, setError] = useState(linkError)

  async function send(e) {
    e.preventDefault()
    if (!email.trim()) return
    setPhase('sending')
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setPhase('idle')
      return
    }
    setPhase('sent')
  }

  if (phase === 'sent') {
    return (
      <div className="mt-10 rounded-sm border border-dashed border-line p-10 text-center">
        <p className="font-serif text-lg italic text-body">Check your inbox.</p>
        <p className="mt-2 text-sm text-muted">
          A link is on its way to <span className="text-body">{email}</span>. Open it on this
          device and your work will be here.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-10 rounded-sm border border-dashed border-line p-10">
      <h2 className="font-serif text-2xl italic text-ink">{title}</h2>
      <p className="mt-2 max-w-lg text-sm text-muted">
        {blurb ||
          'Sign in and every workspace, with its words, its images, its poem, follows you to any browser. No password: a link arrives by email.'}
      </p>
      <form onSubmit={send} className="mt-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full max-w-sm rounded-full border border-line bg-card px-6 py-2.5 text-body placeholder:text-muted/70 focus:border-fuchsia focus:outline-none"
        />
        <button
          type="submit"
          disabled={phase === 'sending'}
          className="rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
        >
          {phase === 'sending' ? 'Sending…' : 'Send me a link'}
        </button>
      </form>
      {error && <p className="mt-3 text-sm text-fuchsia">{error}</p>}
    </div>
  )
}

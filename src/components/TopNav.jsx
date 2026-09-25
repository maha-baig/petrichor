import { useEffect, useRef, useState } from 'react'
import { Feather, Menu, X } from 'lucide-react'
import { isSupabaseConfigured } from '../lib/supabase.js'
import { signOut, useSession } from '../auth.jsx'

// Her writing first, then the tools, then what friends see. Anyone who isn't
// the owner only gets Home and Read.
const OWNER_LINKS = [
  { l: 'Home', t: 'home' },
  { l: 'Books', t: 'library' },
  { l: 'Poems', t: 'poems' },
  { l: 'Inspiration', t: 'inspire' },
  { l: 'Image', t: 'image' },
  { l: 'Read', t: 'read' },
]
const READER_LINKS = [
  { l: 'Home', t: 'home' },
  { l: 'Read', t: 'read' },
]

/** Signed out: a Sign in button. Signed in: her initial, opening a small menu. */
function Account({ onVideo, active, onNavigate, role, unseen = 0 }) {
  const session = useSession()
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => !box.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  if (!isSupabaseConfigured || session === undefined) return null

  if (!session)
    return (
      <button
        onClick={() => onNavigate('account')}
        className={
          'shrink-0 rounded-full px-4 py-1.5 font-grotesk text-sm font-bold transition-colors ' +
          (active === 'account'
            ? 'bg-fuchsia text-white'
            : onVideo
              ? 'border border-white/40 text-white hover:border-white'
              : 'border border-line text-body hover:border-fuchsia hover:text-fuchsia')
        }
      >
        Sign in
      </button>
    )

  const email = session.user.email || ''
  return (
    <div ref={box} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={`Account: ${email}`}
        aria-expanded={open}
        className="relative grid h-8 w-8 place-items-center rounded-full bg-fuchsia font-grotesk text-sm font-bold uppercase text-white"
      >
        {email[0] || '·'}
        {unseen > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ink px-1 text-[0.6rem] text-paper">
            {unseen}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-sm border border-line bg-paper p-1.5 shadow-xl">
          <p className="truncate px-3 py-2 text-xs text-muted">{email}</p>
          {role === 'owner' ? (
            <button
              onClick={() => {
                setOpen(false)
                onNavigate('people')
              }}
              className="flex w-full items-center justify-between rounded-sm px-3 py-2 text-left text-sm text-body hover:bg-body/5 hover:text-fuchsia"
            >
              Readers &amp; comments
              {unseen > 0 && <span className="rounded-full bg-fuchsia/10 px-2 text-xs text-fuchsia">{unseen} new</span>}
            </button>
          ) : (
            <button
              onClick={() => {
                setOpen(false)
                onNavigate('read')
              }}
              className="block w-full rounded-sm px-3 py-2 text-left text-sm text-body hover:bg-body/5 hover:text-fuchsia"
            >
              Read
            </button>
          )}
          <button
            onClick={async () => {
              setOpen(false)
              await signOut()
            }}
            className="block w-full rounded-sm px-3 py-2 text-left text-sm text-body hover:bg-body/5 hover:text-fuchsia"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// One navbar for the whole site. tone="video" = white (over the hero video);
// tone="app" = theme-aware (adapts to dark/light), fuchsia on the active page.
export default function TopNav({ tone = 'app', active, onNavigate, wide = false, role, unseen = 0 }) {
  const LINKS = role === 'owner' ? OWNER_LINKS : READER_LINKS
  const [open, setOpen] = useState(false)
  const onVideo = tone === 'video'
  const brand = onVideo ? 'text-white' : 'text-body'
  const linkCls = (isActive) =>
    'font-grotesk text-sm font-medium transition-colors ' +
    (isActive
      ? 'text-fuchsia'
      : onVideo
        ? 'text-white/80 hover:text-white'
        : 'text-muted hover:text-body')

  const go = (t) => {
    setOpen(false)
    onNavigate(t)
  }

  return (
    <nav className={'relative z-20 py-6 ' + (wide ? '' : 'px-6')}>
      {/* `wide` lines the nav up with the hero's wider layout: same width, same padding. */}
      <div
        className={
          'mx-auto flex items-center justify-between gap-4 ' + (wide ? 'max-w-[88rem] px-6 lg:px-10' : 'max-w-5xl')
        }
      >
        <button onClick={() => go('home')} className="flex shrink-0 items-center gap-2">
          <Feather size={24} className="text-fuchsia" />
          <span className={'font-grotesk text-lg font-semibold ' + brand}>Petrichor</span>
        </button>

        {/* Desktop / tablet: inline links. Hidden on phones, where they'd overflow. */}
        <div className="hidden items-center gap-5 sm:flex sm:gap-7">
          {LINKS.map((n) => (
            <button key={n.t} onClick={() => go(n.t)} className={linkCls(active === n.t)}>
              {n.l}
            </button>
          ))}
          <Account onVideo={onVideo} active={active} onNavigate={go} role={role} unseen={unseen} />
        </div>

        {/* Phones: the account button, then a hamburger for the links. */}
        <div className="flex items-center gap-3 sm:hidden">
          <Account onVideo={onVideo} active={active} onNavigate={go} role={role} unseen={unseen} />
          <button
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className={'shrink-0 ' + (onVideo ? 'text-white' : 'text-body')}
          >
            {open ? <X size={26} /> : <Menu size={26} />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown. Solid themed surface so links stay legible over the
          hero video or a light app page. */}
      {open && (
        <div
          className={
            'absolute inset-x-4 top-full mt-1 flex flex-col overflow-hidden rounded-2xl border shadow-xl sm:hidden ' +
            (onVideo ? 'border-white/15 bg-black/90 backdrop-blur' : 'border-line bg-paper')
          }
        >
          {LINKS.map((n) => {
            const isActive = active === n.t
            return (
              <button
                key={n.t}
                onClick={() => go(n.t)}
                className={
                  'px-5 py-3.5 text-left font-grotesk text-base font-medium transition-colors ' +
                  (isActive
                    ? 'text-fuchsia'
                    : onVideo
                      ? 'text-white/85 hover:bg-white/10'
                      : 'text-body hover:bg-body/5')
                }
              >
                {n.l}
              </button>
            )
          })}
        </div>
      )}
    </nav>
  )
}

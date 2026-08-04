import { useEffect, useMemo, useState } from 'react'
import CircularGallery from './CircularGallery.jsx'
import { workspaceCards } from '../galleryCards.js'
import {
  listWorkspaces,
  deleteWorkspace,
  workspaceTitle,
  localCount,
  importLocalWorkspaces,
} from '../store.js'
import { downloadWorkspaceZip } from '../download.js'
import { isSupabaseConfigured } from '../lib/supabase.js'
import SignIn, { useSession, signOut } from '../auth.jsx'
import { Reveal } from '../motion.jsx'
import { useTheme } from '../theme.js'

function when(iso) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString()
}

export default function Workspaces({ onOpen, onNew }) {
  const [items, setItems] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [waiting, setWaiting] = useState(0) // local workspaces not yet brought across
  const [imported, setImported] = useState(null)

  const session = useSession()
  const needsSignIn = isSupabaseConfigured && session === null
  const theme = useTheme()

  // Building the cards paints a canvas per workspace — and waits on its picture
  // to decode — while handing the gallery a new array tears down its WebGL
  // scene. So only rebuild when the workspaces themselves change, or when the
  // light does: paint can't follow a token the way CSS can.
  const cardsKey = [
    theme,
    ...(items || []).map(
      (w) => `${w.id}:${w.images?.[0]?.id || ''}:${w.words?.evocative?.length || 0}`,
    ),
  ].join('|')
  const [cards, setCards] = useState([])
  useEffect(() => {
    let alive = true
    workspaceCards(items || [], workspaceTitle)
      .then((built) => {
        if (alive) setCards(built)
      })
      .catch(() => {
        // Whatever went wrong in the painting, the drawer still opens.
        if (!alive) return
        setCards(
          (items || []).map((w) => ({
            image: w.images?.[0]?.img || '',
            text: workspaceTitle(w),
            id: w.id,
          })),
        )
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsKey])

  // Labels under the cards sit on the page, not the picture, so they follow
  // the theme rather than always being white.
  const inkColor = useMemo(() => {
    if (typeof window === 'undefined') return '#ede7df'
    return getComputedStyle(document.documentElement).getPropertyValue('--body').trim() || '#ede7df'
  }, [theme])

  async function refresh() {
    setError(null)
    try {
      setItems(await listWorkspaces())
      setWaiting(await localCount())
    } catch (e) {
      setError(e.message)
      setItems([])
    }
  }

  useEffect(() => {
    if (session === undefined) return // still asking who's signed in
    if (needsSignIn) {
      setItems([])
      return
    }
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function bringLocalAcross() {
    setBusy('import')
    setError(null)
    try {
      const moved = await importLocalWorkspaces({ clearAfter: true })
      setImported(moved)
      await refresh()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  async function remove(id) {
    await deleteWorkspace(id)
    setConfirming(null)
    refresh()
  }

  async function zip(ws) {
    setBusy(ws.id)
    setError(null)
    try {
      await downloadWorkspaceZip(ws)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <Reveal order={0} className="mb-5">
        <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
          Workspaces
        </span>
      </Reveal>
      <Reveal
        as="h1"
        order={1}
        className="font-serif text-4xl font-normal italic leading-[0.95] tracking-tight text-ink sm:text-5xl"
      >
        Everything you've begun
      </Reveal>
      <Reveal as="p" order={2} className="mt-4 max-w-xl text-muted">
        Each prompt you choose keeps its own room: its words, the images you gathered, the poem
        that came of it.{' '}
        {session
          ? 'Signed in, so they follow you to any browser.'
          : needsSignIn
            ? 'Sign in and they follow you to any browser.'
            : 'Nothing here leaves your browser.'}
      </Reveal>

      {session && (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{session.user.email}</span>
          <span>·</span>
          <button onClick={signOut} className="underline hover:text-fuchsia">
            sign out
          </button>
        </p>
      )}

      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}

      {/* Signed out, with Supabase configured: the list is behind the link. */}
      {needsSignIn && <SignIn />}

      {/* Signed in, but work is still sitting in this browser from before. */}
      {session && waiting > 0 && (
        <div className="mt-8 flex flex-wrap items-center gap-3 rounded-sm border border-fuchsia/40 bg-card/40 px-4 py-3">
          <p className="text-sm text-body">
            {waiting} workspace{waiting === 1 ? '' : 's'} from this browser {waiting === 1 ? 'is' : 'are'}{' '}
            not in your account yet.
          </p>
          <button
            onClick={bringLocalAcross}
            disabled={busy === 'import'}
            className="rounded-full bg-fuchsia px-4 py-1.5 font-grotesk text-xs font-bold text-white disabled:opacity-60"
          >
            {busy === 'import' ? 'bringing across…' : 'bring them across'}
          </button>
        </div>
      )}

      {imported > 0 && (
        <p className="mt-3 text-sm text-muted">
          Brought {imported} across. They live in your account now.
        </p>
      )}

      {!needsSignIn && (items === null || session === undefined) && (
        <p className="mt-10 font-serif italic text-muted">Opening the drawer…</p>
      )}

      {!needsSignIn && items?.length === 0 && (
        <div className="mt-10 rounded-sm border border-dashed border-line p-10 text-center">
          <p className="font-serif text-lg italic text-muted">Nothing kept yet.</p>
          <button
            onClick={onNew}
            className="mt-4 rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02]"
          >
            Find a prompt
          </button>
        </div>
      )}

      {items?.length > 0 && (
        <>
          {/* The rooms themselves, as a ribbon you can push through. */}
          <div className="-mx-6 mt-8 h-[62vh] min-h-[420px]">
            {cards.length > 0 && (
              <CircularGallery
                items={cards}
                onItemClick={(i) => items[i] && onOpen(items[i].id)}
                bend={2}
                borderRadius={0.04}
                scrollEase={0.03}
                textColor={inkColor}
                font='italic 30px "Iowan Old Style", Georgia, serif'
              />
            )}
          </div>
          <p className="text-center text-xs text-muted">
            {items.length > 1
              ? 'Drag to browse · click a card to open it · arrow keys and Enter work too'
              : 'Click the card to open it · Enter works too'}
          </p>

          {/* Keeping and letting go. The gallery is for looking; this is for
              the housekeeping that used to live on each card. */}
          <details className="mt-10 border-t border-line pt-5">
            <summary className="cursor-pointer font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.18em] text-muted">
              Manage ({items.length})
            </summary>
            <ul className="mt-4 flex flex-col gap-1">
              {items.map((ws) => (
                <li
                  key={ws.id}
                  className="group flex flex-wrap items-center gap-3 border-b border-line/60 py-2 text-sm"
                >
                  <button
                    onClick={() => onOpen(ws.id)}
                    className="text-left font-serif italic text-body hover:text-fuchsia"
                  >
                    {workspaceTitle(ws)}
                  </button>
                  <span className="font-grotesk text-[0.65rem] uppercase tracking-[0.16em] text-muted">
                    {ws.mood} · {when(ws.updatedAt)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => zip(ws)}
                      disabled={busy === ws.id}
                      className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
                    >
                      {busy === ws.id ? 'zipping…' : 'download'}
                    </button>
                    {confirming === ws.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-muted">delete for good?</span>
                        <button
                          onClick={() => remove(ws.id)}
                          className="rounded-full bg-fuchsia px-3 py-1 font-bold text-white"
                        >
                          yes
                        </button>
                        <button onClick={() => setConfirming(null)} className="text-muted underline">
                          no
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirming(ws.id)}
                        className="rounded-full border border-transparent px-3 py-1 text-xs text-muted transition-colors hover:text-fuchsia"
                      >
                        delete
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}

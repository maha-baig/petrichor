import { useEffect, useRef, useState } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import Spark from './components/Spark.jsx'
import Workspace from './components/Workspace.jsx'
import Workspaces from './components/Workspaces.jsx'
import Books from './components/Books.jsx'
import Book from './components/Book.jsx'
import ChapterEditor from './components/ChapterEditor.jsx'
import WordMap from './components/WordMap.jsx'
import Poems from './components/Poems.jsx'
import Read from './components/Read.jsx'
import People from './components/People.jsx'
import PoemOverlay from './components/PoemOverlay.jsx'
import Hero from './components/Hero.jsx'
import TopNav from './components/TopNav.jsx'
import MorphTransition from './components/MorphTransition.jsx'
import { blankWorkspace, saveWorkspace, getWorkspace, pruneEmpty, workspaceTitle } from './store.js'
import SignIn, { linkError, usePasswordRecovery } from './auth.jsx'
import { useAccess } from './access.js'
import { createPoem, htmlToText, listPoems } from './library.js'
import { textToHtml } from './importDoc.js'
import { unseenCount } from './reading.js'
import { isSupabaseConfigured } from './lib/supabase.js'

function ThemeToggle() {
  function toggle() {
    const root = document.documentElement
    const cur = root.getAttribute('data-theme') || 'dark'
    const next = cur === 'dark' ? 'light' : 'dark'
    root.setAttribute('data-theme', next)
    localStorage.setItem('petrichor-theme', next)
  }
  return (
    <button
      onClick={toggle}
      aria-label="Toggle light and dark theme"
      // A floating button on a phone always sits over something as the page
      // scrolls, so there it waits at the foot of the page instead.
      className="mb-6 ml-auto mr-6 block rounded-full border border-line bg-card px-4 py-2.5 font-grotesk text-xs font-bold tracking-[0.08em] text-body sm:fixed sm:bottom-4 sm:right-4 sm:z-[10000] sm:m-0 sm:px-3.5 sm:py-1.5 sm:shadow-lg"
    >
      ◐ THEME
    </button>
  )
}

// Writing and making are the owner's; everyone else reads.
const OWNER_TABS = new Set(['library', 'poems', 'inspire', 'work', 'image', 'people'])

const INSPIRE = [
  { t: 'prompts', l: 'Prompts' },
  { t: 'map', l: 'Word map' },
  { t: 'boards', l: 'Mood boards' },
]

// ── the address bar ──────────────────────────────────────────────────────────
// Every page gets its own address (#/books/…, #/read/…), pushed onto the
// browser's history, so Back and Forward move around the site instead of
// leaving it, and a refresh stays put. Sign-in links arrive as "#access_token…"
// or "#error…", not "#/", so they're left alone for Supabase.

function toHash(s) {
  if (!s.entered) return '#/'
  switch (s.tab) {
    case 'library':
      return '#/books' + (s.workId ? `/${s.workId}` + (s.pieceId ? `/${s.pieceId}` : '') : '')
    case 'poems':
      return '#/poems' + (s.poem ? `/${s.poem.work_id}/${s.poem.id}` : '')
    case 'inspire':
      return `#/inspire/${s.inspire}` + (s.inspire === 'boards' && s.boardId ? `/${s.boardId}` : '')
    case 'read':
      return '#/read' + (s.read.pieceId ? `/p/${s.read.pieceId}` : s.read.bookId ? `/b/${s.read.bookId}` : '')
    default:
      return `#/${s.tab}`
  }
}

function fromHash(hash) {
  if (!hash.startsWith('#/')) return null
  const [a, b, c] = hash.slice(2).split('/')
  const none = { workId: null, pieceId: null, poem: null, inspire: 'prompts', boardId: null, read: {} }
  if (!a) return { ...none, entered: false, tab: 'read' }
  const at = { ...none, entered: true }
  if (a === 'books') return { ...at, tab: 'library', workId: b || null, pieceId: (b && c) || null }
  if (a === 'poems') return { ...at, tab: 'poems', poem: b && c ? { work_id: b, id: c } : null }
  if (a === 'inspire') {
    const sub = INSPIRE.some((x) => x.t === b) ? b : 'prompts'
    return { ...at, tab: 'inspire', inspire: sub, boardId: (sub === 'boards' && c) || null }
  }
  if (a === 'read') return { ...at, tab: 'read', read: b === 'p' && c ? { pieceId: c } : b === 'b' && c ? { bookId: c } : {} }
  if (['image', 'people', 'account'].includes(a)) return { ...at, tab: a }
  return null
}

export default function App() {
  const { session, role, refresh } = useAccess()
  const owner = role === 'owner'
  const [recovering, doneRecovering] = usePasswordRecovery()
  // An email link (a password reset, or one that failed) lands on whatever
  // page was left open — usually the hero. Open the sign-in page instead,
  // where it can be finished or explained.
  const [start] = useState(() => (linkError || recovering ? null : fromHash(window.location.hash)))
  const [entered, setEntered] = useState(start ? start.entered : Boolean(linkError || recovering))
  const [tab, setTab] = useState(start ? start.tab : linkError || recovering ? 'account' : 'read')
  const [inspire, setInspire] = useState(start?.inspire || 'prompts') // which tool under Inspiration
  const [mood, setMood] = useState('melancholy')
  const [workspace, setWorkspace] = useState(null) // the mood board currently open
  const [boardId, setBoardId] = useState(start?.boardId || null) // a board to open once it's fetched
  const [workId, setWorkId] = useState(start?.workId || null) // the book open on the Books tab
  const [pieceId, setPieceId] = useState(start?.pieceId || null) // the chapter open in the editor
  const [poem, setPoem] = useState(start?.poem || null) // { id, work_id } open on the Poems tab
  const [readView, setReadView] = useState(start?.read || {}) // { bookId } or { pieceId } on Read
  const [myPoems, setMyPoems] = useState(null) // for Image
  const [unseen, setUnseen] = useState(0)

  // A board named in the address is fetched, then opened.
  useEffect(() => {
    if (!boardId || workspace?.id === boardId) return
    let alive = true
    getWorkspace(boardId).then((w) => {
      if (!alive) return
      setWorkspace(w || null)
      setBoardId(null)
    })
    return () => {
      alive = false
    }
  }, [boardId, workspace])

  // Keep the address in step with the page. Moves the app makes on its own
  // (after signing in, or sending a reader away from a writing page) replace
  // the entry rather than add one, so Back doesn't bounce into them again.
  const replaceNext = useRef(false)
  const hash = toHash({ entered, tab, workId, pieceId, poem, inspire, boardId: workspace?.id || boardId, read: readView })
  useEffect(() => {
    const current = window.location.hash
    if (current && !current.startsWith('#/')) return // a sign-in link still being read
    const replace = replaceNext.current
    replaceNext.current = false
    if ((current || '#/') === hash) return
    const url = hash === '#/' ? window.location.pathname + window.location.search : hash
    if (replace) window.history.replaceState(null, '', url)
    else window.history.pushState(null, '', url)
  }, [hash])

  // Back and Forward: show the page the address names.
  useEffect(() => {
    const onPop = () => {
      const r = fromHash(window.location.hash || '#/')
      if (!r) return
      setEntered(r.entered)
      setTab(r.tab)
      setWorkId(r.workId)
      setPieceId(r.pieceId)
      setPoem(r.poem)
      setInspire(r.inspire)
      setReadView(r.read)
      setBoardId(r.boardId)
      setWorkspace((w) => (r.boardId && w?.id === r.boardId ? w : null))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (!recovering) return
    setEntered(true)
    setTab('account')
  }, [recovering])

  // Signed in from the sign-in page: the owner to the books, friends to Read.
  useEffect(() => {
    if (session && tab === 'account' && !recovering && role !== undefined) {
      replaceNext.current = true
      setTab(owner ? 'library' : 'read')
    }
    if (session === null) {
      setWorkId(null)
      setPieceId(null)
      setPoem(null)
    }
  }, [session, tab, recovering, role, owner])

  // Anything for writing is the owner's alone; everyone else is sent to Read.
  useEffect(() => {
    if (role !== undefined && !owner && OWNER_TABS.has(tab)) {
      replaceNext.current = true
      setTab('read')
    }
  }, [role, owner, tab])

  // New comments, counted on the account button.
  useEffect(() => {
    if (owner && isSupabaseConfigured) unseenCount().then(setUnseen, () => {})
  }, [owner, tab])

  // Image offers her own poems to set on a picture.
  useEffect(() => {
    if (tab !== 'image' || !owner) return
    listPoems()
      .then(({ poems }) =>
        setMyPoems(poems.map((p) => ({ id: p.id, title: p.title?.trim() || 'Untitled poem', text: htmlToText(p.body) }))),
      )
      .catch(() => setMyPoems([]))
  }, [tab, owner])

  // Choosing a prompt gives it a room of its own, and sweeps away any empty
  // rooms left behind by browsing.
  async function startWorkspace(prompt) {
    const created = await saveWorkspace(blankWorkspace({ prompt, mood }))
    pruneEmpty(created.id)
    setWorkspace(created)
    setInspire('boards')
    setTab('inspire')
  }

  async function openWorkspace(id) {
    const found = await getWorkspace(id)
    if (found) {
      setWorkspace(found)
      setInspire('boards')
      setTab('inspire')
    }
  }

  // A poem drafted beside a mood board becomes a real one, in Poems.
  async function makePoem(text) {
    const created = await createPoem({ title: workspace ? workspaceTitle(workspace) : '', body: textToHtml(text) })
    setPoem({ id: created.id, work_id: created.work_id })
    setTab('poems')
  }

  const navigate = (t) => {
    if (t === 'home') {
      setEntered(false)
      return
    }
    // each tab opens on its list, never the last thing left open
    if (t === 'inspire') setWorkspace(null)
    if (t === 'library') {
      setWorkId(null)
      setPieceId(null)
    }
    if (t === 'poems') setPoem(null)
    if (t === 'read') setReadView({})
    setTab(t)
  }

  const homeView = (
    <Hero
      role={role}
      onEnter={(payload = {}) => {
        if (payload.feeling) {
          startWorkspace({ text: payload.feeling, seed_image: '' })
        } else if (payload.tab) {
          navigate(payload.tab)
        }
        setEntered(true)
      }}
    />
  )

  const editing = (tab === 'library' && pieceId) || (tab === 'poems' && poem)

  const appView = (
      <div className="relative z-[1] min-h-screen">
            <TopNav tone="app" active={tab === 'work' ? 'inspire' : tab === 'poems' ? 'library' : tab} role={role} unseen={unseen} onNavigate={navigate} />

            {/* A book page wants more room than a tool; the editor takes the full width. */}
            <div
              className={
                editing
                  ? 'px-6 pt-4'
                  : 'mx-auto px-6 pb-16 pt-4 ' + ((tab === 'library' && workId) || tab === 'read' ? 'max-w-5xl' : 'max-w-4xl')
              }
            >
              <MorphTransition
                activeKey={tab}
                transition="melt"
                intensity={0.34}
                aberration={0.2}
                drift={0.26}
                duration={0.55}
                ease="power2.inOut"
                scale={2.4}
                radius={16}
                render={(t) => (
                  // CSS-driven: a JS entrance here can stall while the page is
                  // hidden and strand the panel invisible.
                  <div key={t} className="tab-enter">
                    {t === 'account' && (
                      <SignIn recovering={recovering} onRecovered={() => {
                        doneRecovering()
                        setTab(owner ? 'library' : 'read')
                      }} />
                    )}

                    {OWNER_TABS.has(t) && !owner && <p className="font-serif italic text-muted">One moment…</p>}

                    {t === 'library' && owner &&
                      (workId && pieceId ? (
                        <ChapterEditor
                          key={pieceId}
                          workId={workId}
                          pieceId={pieceId}
                          onBack={() => setPieceId(null)}
                          onOpen={(p) => setPieceId(p.id)}
                        />
                      ) : workId ? (
                        <Book workId={workId} onBack={() => setWorkId(null)} onWrite={(p) => setPieceId(p.id)} />
                      ) : (
                        <Books onOpen={setWorkId} onPoems={() => navigate('poems')} />
                      ))}

                    {t === 'poems' && owner &&
                      (poem ? (
                        <ChapterEditor
                          key={poem.id}
                          mode="poem"
                          workId={poem.work_id}
                          pieceId={poem.id}
                          onBack={() => setPoem(null)}
                          onOpen={(p) => setPoem({ id: p.id, work_id: p.work_id || poem.work_id })}
                        />
                      ) : (
                        <Poems onOpen={(p) => setPoem({ id: p.id, work_id: p.work_id })} onBooks={() => navigate('library')} />
                      ))}

                    {t === 'inspire' && owner && (
                      <>
                        <div className="mb-6 flex flex-wrap gap-2 text-sm sm:mb-8" role="tablist" aria-label="Inspiration">
                          {INSPIRE.map((s) => (
                            <button
                              key={s.t}
                              role="tab"
                              aria-selected={inspire === s.t}
                              onClick={() => {
                                if (s.t === 'boards') setWorkspace(null)
                                setInspire(s.t)
                              }}
                              className={
                                'rounded-full border px-4 py-2.5 font-grotesk font-medium transition-colors sm:py-1.5 ' +
                                (inspire === s.t ? 'border-fuchsia bg-fuchsia/10 text-fuchsia' : 'border-line text-muted hover:text-body')
                              }
                            >
                              {s.l}
                            </button>
                          ))}
                        </div>
                        {inspire === 'prompts' && <Spark mood={mood} setMood={setMood} onChoose={startWorkspace} />}
                        {inspire === 'map' && <WordMap mood={mood} setMood={setMood} />}
                        {inspire === 'boards' &&
                          (workspace ? (
                            <Workspace
                              workspace={workspace}
                              // Saves are async, so one can land after the poet has
                              // already closed the workspace. Only accept an update
                              // for the workspace that is still open, or a late save
                              // would reopen what they just left.
                              onChange={(next) =>
                                setWorkspace((cur) =>
                                  cur && next && cur.id === next.id ? next : cur,
                                )
                              }
                              onBack={() => setWorkspace(null)}
                              onMakePoem={makePoem}
                            />
                          ) : (
                            <Workspaces onOpen={openWorkspace} onNew={() => setInspire('prompts')} />
                          ))}
                      </>
                    )}

                    {t === 'image' && owner && <PoemOverlay standalone myPoems={myPoems} />}

                    {t === 'people' && owner && (
                      <People
                        onSeen={() => setUnseen(0)}
                        onOpenPiece={(id) => {
                          setReadView({ pieceId: id })
                          setTab('read')
                        }}
                      />
                    )}

                    {t === 'read' && <Read role={role} session={session} refresh={refresh} view={readView} onView={setReadView} />}
                  </div>
                )}
              />

            </div>
            <ThemeToggle />
      </div>
  )

  return (
    <MotionConfig reducedMotion="user">
      {/* The same melt carries the hero ⇄ app swap — a touch slower and softer,
          since it's the whole page dissolving rather than one panel. */}
      <MorphTransition
        activeKey={entered ? 'app' : 'home'}
        transition="melt"
        intensity={0.3}
        aberration={0.16}
        drift={0.2}
        duration={0.75}
        ease="power2.inOut"
        scale={2.4}
        radius={0}
        render={(k) => (k === 'app' ? appView : homeView)}
      />
    </MotionConfig>
  )
}

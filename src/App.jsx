import { useEffect, useState } from 'react'
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
      className="fixed bottom-4 right-4 z-[10000] rounded-full border border-line bg-card px-3.5 py-1.5 font-grotesk text-xs font-bold tracking-[0.08em] text-body shadow-lg"
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

export default function App() {
  const { session, role, refresh } = useAccess()
  const owner = role === 'owner'
  const [recovering, doneRecovering] = usePasswordRecovery()
  // An email link (a password reset, or one that failed) lands on whatever
  // page was left open — usually the hero. Open the sign-in page instead,
  // where it can be finished or explained.
  const [entered, setEntered] = useState(Boolean(linkError || recovering))
  const [tab, setTab] = useState(linkError || recovering ? 'account' : 'read')
  const [inspire, setInspire] = useState('prompts') // which tool under Inspiration
  const [mood, setMood] = useState('melancholy')
  const [workspace, setWorkspace] = useState(null) // the mood board currently open
  const [workId, setWorkId] = useState(null) // the book open on the Books tab
  const [pieceId, setPieceId] = useState(null) // the chapter open in the editor
  const [poem, setPoem] = useState(null) // { id, work_id } open on the Poems tab
  const [readPiece, setReadPiece] = useState(null) // a piece to open on Read
  const [myPoems, setMyPoems] = useState(null) // for Image
  const [unseen, setUnseen] = useState(0)

  useEffect(() => {
    if (!recovering) return
    setEntered(true)
    setTab('account')
  }, [recovering])

  // Signed in from the sign-in page: the owner to the books, friends to Read.
  useEffect(() => {
    if (session && tab === 'account' && !recovering && role !== undefined) setTab(owner ? 'library' : 'read')
    if (session === null) {
      setWorkId(null)
      setPieceId(null)
      setPoem(null)
    }
  }, [session, tab, recovering, role, owner])

  // Anything for writing is the owner's alone; everyone else is sent to Read.
  useEffect(() => {
    if (role !== undefined && !owner && OWNER_TABS.has(tab)) setTab('read')
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
    if (t === 'read') setReadPiece(null)
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
            <ThemeToggle />
            <TopNav tone="app" active={tab === 'work' ? 'inspire' : tab} role={role} unseen={unseen} onNavigate={navigate} />

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
                        <Books onOpen={setWorkId} />
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
                        <Poems onOpen={(p) => setPoem({ id: p.id, work_id: p.work_id })} />
                      ))}

                    {t === 'inspire' && owner && (
                      <>
                        <div className="mb-8 flex flex-wrap gap-2 text-sm" role="tablist" aria-label="Inspiration">
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
                                'rounded-full border px-4 py-1.5 font-grotesk font-medium transition-colors ' +
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
                          setReadPiece(id)
                          setTab('read')
                        }}
                      />
                    )}

                    {t === 'read' && <Read role={role} session={session} refresh={refresh} openPieceId={readPiece} />}
                  </div>
                )}
              />

            </div>
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

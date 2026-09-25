import { useEffect, useState } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import Spark from './components/Spark.jsx'
import Workspace from './components/Workspace.jsx'
import Workspaces from './components/Workspaces.jsx'
import Books from './components/Books.jsx'
import Book from './components/Book.jsx'
import ChapterEditor from './components/ChapterEditor.jsx'
import WordMap from './components/WordMap.jsx'
import Reviewer from './components/Reviewer.jsx'
import PoemOverlay from './components/PoemOverlay.jsx'
import Hero from './components/Hero.jsx'
import TopNav from './components/TopNav.jsx'
import MorphTransition from './components/MorphTransition.jsx'
import { blankWorkspace, saveWorkspace, getWorkspace, pruneEmpty } from './store.js'
import SignIn, { linkError, usePasswordRecovery, useSession } from './auth.jsx'
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

export default function App() {
  const session = useSession()
  const [recovering, doneRecovering] = usePasswordRecovery()
  // An email link (a password reset, or one that failed) lands on whatever
  // page she left from — usually the hero. Open the sign-in page instead,
  // where it can be finished or explained.
  const [entered, setEntered] = useState(Boolean(linkError || recovering))
  const [tab, setTab] = useState(linkError || recovering ? 'account' : 'spark')
  const [mood, setMood] = useState('melancholy')
  const [workspace, setWorkspace] = useState(null) // the one currently open
  const [workId, setWorkId] = useState(null) // the book open on the Books tab
  const [pieceId, setPieceId] = useState(null) // the chapter open in the editor

  useEffect(() => {
    if (!recovering) return
    setEntered(true)
    setTab('account')
  }, [recovering])

  // Signed in from the sign-in page: straight to her books.
  useEffect(() => {
    if (session && tab === 'account' && !recovering) setTab('library')
    if (session === null) {
      setWorkId(null)
      setPieceId(null)
    }
  }, [session, tab, recovering])

  // One sign-in for everything that's hers: Books, and the Workspaces list.
  const needsAccount = (t) =>
    isSupabaseConfigured && session === null && (t === 'library' || (t === 'work' && !workspace))

  // Choosing a prompt gives it a room of its own, and sweeps away any empty
  // rooms left behind by browsing.
  async function startWorkspace(prompt) {
    const created = await saveWorkspace(blankWorkspace({ prompt, mood }))
    pruneEmpty(created.id)
    setWorkspace(created)
    setTab('work')
  }

  async function openWorkspace(id) {
    const found = await getWorkspace(id)
    if (found) {
      setWorkspace(found)
      setTab('work')
    }
  }

  const homeView = (
    <Hero
      onEnter={(payload = {}) => {
        if (payload.feeling) {
          startWorkspace({ text: payload.feeling, seed_image: '' })
        } else if (payload.tab) {
          setTab(payload.tab)
        }
        setEntered(true)
      }}
    />
  )

  const appView = (
      <div className="relative z-[1] min-h-screen">
            <ThemeToggle />
            <TopNav
              tone="app"
              active={tab}
              onNavigate={(t) => {
                if (t === 'home') {
                  setEntered(false)
                  return
                }
                // the Workspaces tab always opens on the list, never the last room
                if (t === 'work') setWorkspace(null)
                if (t === 'library') {
                  setWorkId(null)
                  setPieceId(null)
                }
                setTab(t)
              }}
            />

            {/* A book page wants more room than a tool; the editor takes the full width. */}
            <div
              className={
                tab === 'library' && pieceId
                  ? 'px-6 pt-4'
                  : 'mx-auto px-6 pb-16 pt-4 ' + (tab === 'library' && workId ? 'max-w-5xl' : 'max-w-4xl')
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
                    {(t === 'account' || needsAccount(t)) && (
                      <SignIn recovering={recovering} onRecovered={() => {
                        doneRecovering()
                        setTab('library')
                      }} />
                    )}
                    {t === 'spark' && (
                      <Spark
                        mood={mood}
                        setMood={setMood}
                        onChoose={startWorkspace}
                      />
                    )}

                    {t === 'work' && !needsAccount(t) &&
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
                        />
                      ) : (
                        <Workspaces onOpen={openWorkspace} onNew={() => setTab('spark')} />
                      ))}

                    {t === 'library' && !needsAccount(t) &&
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

                    {t === 'map' && <WordMap mood={mood} setMood={setMood} />}
                    {t === 'review' && <Reviewer />}
                    {t === 'overlay' && <PoemOverlay standalone />}
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

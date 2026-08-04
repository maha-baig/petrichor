import { useState } from 'react'
import { MotionConfig, motion } from 'framer-motion'
import Spark from './components/Spark.jsx'
import Words from './components/Words.jsx'
import WordMap from './components/WordMap.jsx'
import Reviewer from './components/Reviewer.jsx'
import PoemOverlay from './components/PoemOverlay.jsx'
import Hero from './components/Hero.jsx'
import TopNav from './components/TopNav.jsx'
import FeedbackMarkup from './components/FeedbackMarkup.jsx'
import MorphTransition from './components/MorphTransition.jsx'
import { pageV } from './motion.jsx'

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
  const [entered, setEntered] = useState(false)
  const [tab, setTab] = useState('spark')
  const [mood, setMood] = useState('melancholy')
  const [chosen, setChosen] = useState(null) // { text, seed_image }
  const [autoFind, setAutoFind] = useState(false)

  const homeView = (
    <Hero
      mood={mood}
      setMood={setMood}
      onEnter={(payload = {}) => {
        if (payload.feeling) {
          setChosen({ text: payload.feeling, seed_image: '' })
          setTab('spark')
        } else {
          if (payload.tab) setTab(payload.tab)
          if (payload.find) setAutoFind(true)
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
                setTab(t)
                setChosen(null)
              }}
            />

            <div className="mx-auto max-w-4xl px-6 pb-16 pt-4">
              <MorphTransition
                activeKey={tab}
                transition="melt"
                intensity={0.34}
                aberration={0.2}
                drift={0.26}
                overlayColor="#05060a"
                duration={0.55}
                ease="power2.inOut"
                scale={2.4}
                radius={16}
                render={(t) => (
                  // CSS-driven: a JS entrance here can stall while the page is
                  // hidden and strand the panel invisible.
                  <div key={t} className="tab-enter">
                    {t === 'spark' &&
                      (!chosen ? (
                        <Spark
                          mood={mood}
                          setMood={setMood}
                          onChoose={setChosen}
                          autoRun={autoFind}
                          onAutoRunDone={() => setAutoFind(false)}
                        />
                      ) : (
                        <Words prompt={chosen} mood={mood} onBack={() => setChosen(null)} />
                      ))}

                    {t === 'map' && <WordMap mood={mood} setMood={setMood} />}
                    {t === 'review' && <Reviewer />}
                    {t === 'overlay' && <PoemOverlay standalone />}
                  </div>
                )}
              />

              <footer className="mt-20 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-6 text-sm text-muted">
                <span className="font-serif italic text-body">Verse</span>
                <span>·</span>
                <span>a companion, never the author</span>
                <span>·</span>
                <span className="font-grotesk text-xs tracking-[0.04em]">verse.mahabaig.com</span>
              </footer>
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
        overlayColor="#05060a"
        duration={0.75}
        ease="power2.inOut"
        scale={2.4}
        radius={0}
        render={(k) => (k === 'app' ? appView : homeView)}
      />

      <FeedbackMarkup />
    </MotionConfig>
  )
}

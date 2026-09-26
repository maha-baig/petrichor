import { useEffect, useRef, useState } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import TopNav from './TopNav.jsx'

// The hero background: pink flowers blooming out of true black, traced with
// fine white measuring lines. A local, self-contained clip (public/hero-flowers.mp4,
// 600px portrait, 24fps, no audio, faststart so it plays before it's fully
// downloaded). The previous dot-matrix flower is still at public/hero-bg.mp4.
const BG_SRC = '/hero-flowers.mp4'
const FADE_MS = 500
const TAIL_S = 0.5 // fade out this long before the end, then loop with a fade in

// The hero's words, typed out one after another. `cps` is characters per
// second: the title is struck slowly, the prose runs on quicker.
const LINES = [
  { key: 'title', text: 'Where flowers bloom', cps: 14, pause: 0.45 },
]

// Lines that keep a writer company: poems, novels, films and old sayings.
// Typed in one at a time under the title, held for a while, then let go.
const QUOTES = [
  { q: 'Hope is the thing with feathers.', by: 'Emily Dickinson' },
  { q: 'We are such stuff as dreams are made on.', by: 'Shakespeare, The Tempest' },
  { q: 'I am not afraid of storms, for I am learning how to sail my ship.', by: 'Louisa May Alcott, Little Women' },
  { q: 'So we beat on, boats against the current, borne back ceaselessly into the past.', by: 'F. Scott Fitzgerald, The Great Gatsby' },
  { q: 'Whatever our souls are made of, his and mine are the same.', by: 'Emily Brontë, Wuthering Heights' },
  { q: 'Not all those who wander are lost.', by: 'J.R.R. Tolkien' },
  { q: 'Here’s looking at you, kid.', by: 'Casablanca' },
  { q: 'After all, tomorrow is another day.', by: 'Gone with the Wind' },
  { q: 'The world breaks everyone, and afterward many are strong at the broken places.', by: 'Ernest Hemingway, A Farewell to Arms' },
  { q: 'Carpe diem. Seize the day.', by: 'Dead Poets Society' },
  { q: 'I wandered lonely as a cloud.', by: 'William Wordsworth' },
  { q: 'Do I dare disturb the universe?', by: 'T.S. Eliot' },
  { q: 'Be patient toward all that is unsolved in your heart.', by: 'Rainer Maria Rilke' },
  { q: 'There is no greater agony than bearing an untold story inside you.', by: 'Maya Angelou' },
  { q: 'In the midst of winter, I found there was, within me, an invincible summer.', by: 'Albert Camus' },
  { q: 'Just keep swimming.', by: 'Finding Nemo' },
  { q: 'Still waters run deep.', by: 'A proverb' },
  { q: 'Tell me, what is it you plan to do with your one wild and precious life?', by: 'Mary Oliver' },
]

const shuffled = (a) => {
  const b = [...a]
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[b[i], b[j]] = [b[j], b[i]]
  }
  return b
}

/**
 * The quotes, one after another: typed in, held, then erased quickly for the
 * next. The box keeps the height of the longest line so nothing below jumps.
 * Reduced motion: each quote simply fades in, and changes less often.
 */
function Quotes({ start, className }) {
  const reduce = useReducedMotion()
  const [order] = useState(() => shuffled(QUOTES))
  const [i, setI] = useState(0)
  const [n, setN] = useState(0)
  const [phase, setPhase] = useState('typing') // typing · holding · erasing
  const { q, by } = order[i % order.length]
  const text = `“${q}”`

  useEffect(() => {
    if (!start) return
    if (reduce) {
      const t = setTimeout(() => setI((k) => k + 1), 9000)
      return () => clearTimeout(t)
    }
    let t
    if (phase === 'typing') {
      if (n < text.length) t = setTimeout(() => setN(n + 1), 34 + Math.random() * 30)
      else t = setTimeout(() => setPhase('holding'), 0)
    } else if (phase === 'holding') {
      t = setTimeout(() => setPhase('erasing'), 3200 + text.length * 45)
    } else if (n > 0) {
      t = setTimeout(() => setN(n - 1), 12)
    } else {
      t = setTimeout(() => {
        setI((k) => k + 1)
        setPhase('typing')
      }, 350)
    }
    return () => clearTimeout(t)
  }, [start, reduce, phase, n, text.length])

  const shown = reduce ? text.length : n
  return (
    <figure className={className} aria-live="off">
      {/* Every quote laid out invisibly in one grid cell: the box is as tall as the longest. */}
      <div className="grid">
        {QUOTES.map((x) => (
          <span key={x.q} aria-hidden="true" className="invisible col-start-1 row-start-1">
            “{x.q}”
            <span className="mt-3 block text-sm">— {x.by}</span>
          </span>
        ))}
        <motion.blockquote
          key={reduce ? i : 'typed'}
          initial={reduce ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.8 }}
          className="col-start-1 row-start-1"
        >
          <span className="sr-only">{text}</span>
          <span aria-hidden="true">
            {start ? text.slice(0, shown) : ''}
            {start && !reduce && <Caret typing={phase !== 'holding'} />}
          </span>
          <motion.figcaption
            animate={{ opacity: phase === 'holding' || reduce ? 1 : 0, y: phase === 'holding' || reduce ? 0 : 4 }}
            transition={{ duration: 0.5 }}
            className="mt-3 block font-sans text-sm not-italic tracking-wide text-white/50"
          >
            — {by}
          </motion.figcaption>
        </motion.blockquote>
      </div>
    </figure>
  )
}

/** A blinking typewriter caret: solid while typing, blinking once it rests. */
function Caret({ typing }) {
  return (
    <motion.span
      aria-hidden="true"
      className="ml-[0.06em] inline-block h-[0.95em] w-[0.08em] min-w-[2px] translate-y-[0.12em] bg-fuchsia"
      animate={typing ? { opacity: 1 } : { opacity: [1, 1, 0, 0] }}
      transition={typing ? { duration: 0 } : { duration: 1.05, repeat: Infinity, times: [0, 0.5, 0.5, 1], ease: 'linear' }}
    />
  )
}

/**
 * One line, typed. A Framer motion value counts the characters in; the typed
 * part is shown, the rest is laid out but invisible — so the block never
 * reflows as it types.
 */
function Typed({ as: Tag = 'p', text, cps, pause = 0, start, caret, onDone, className }) {
  const reduce = useReducedMotion()
  const count = useMotionValue(reduce ? text.length : 0)
  const [n, setN] = useState(reduce ? text.length : 0)
  useMotionValueEvent(count, 'change', (v) => setN(Math.round(v)))

  useEffect(() => {
    if (!start) return
    if (reduce) {
      onDone?.()
      return
    }
    const controls = animate(count, text.length, {
      duration: text.length / cps,
      ease: 'linear',
      onComplete: () => setTimeout(() => onDone?.(), pause * 1000),
    })
    return () => controls.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start])

  return (
    // The untyped rest is only invisible, not absent, so the element's text
    // (for screen readers, and for anything reading the page) is whole and
    // said once. The caret is decoration and hidden from them.
    <Tag className={className}>
      {text.slice(0, n)}
      {caret && <Caret typing={n < text.length} />}
      <span className="opacity-0">{text.slice(n)}</span>
    </Tag>
  )
}

export default function Hero({ onEnter, role }) {
  // Which line is typing now; LINES.length once everything is on the page.
  const [step, setStep] = useState(0)
  const next = () => setStep((s) => s + 1)
  const reduce = useReducedMotion()
  const typed = (i, props) => (
    <Typed
      {...LINES[i]}
      start={step >= i}
      // the caret follows the typing, then moves on to the quotes
      caret={step === i}
      onDone={step === i ? next : undefined}
      {...props}
    />
  )

  const videoRef = useRef(null)
  const rafRef = useRef(0)
  const fadingOutRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    // Reduced motion: hold a still frame partway into the bloom, no playback.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      const still = () => {
        video.currentTime = Math.min(6, (video.duration || 12) * 0.55)
        video.style.opacity = '1'
      }
      if (video.readyState >= 1) still()
      else video.addEventListener('loadedmetadata', still, { once: true })
      return
    }

    function fadeTo(target) {
      cancelAnimationFrame(rafRef.current)
      const from = parseFloat(video.style.opacity || '0')
      const start = performance.now()
      const step = (now) => {
        const t = Math.min(1, (now - start) / FADE_MS)
        video.style.opacity = String(from + (target - from) * t)
        if (t < 1) rafRef.current = requestAnimationFrame(step)
      }
      rafRef.current = requestAnimationFrame(step)
    }
    function onLoaded() {
      video.style.opacity = '0'
      video.play().catch(() => {})
      fadingOutRef.current = false
      fadeTo(1)
    }
    // A hard loop cut would jump; fade out over the tail and back in instead.
    function onTimeUpdate() {
      if (!video.duration) return
      if (video.duration - video.currentTime <= TAIL_S && !fadingOutRef.current) {
        fadingOutRef.current = true
        fadeTo(0)
      }
    }
    function onEnded() {
      video.style.opacity = '0'
      setTimeout(() => {
        video.currentTime = 0
        video.play().catch(() => {})
        fadingOutRef.current = false
        fadeTo(1)
      }, 100)
    }

    video.style.opacity = '0'
    video.addEventListener('loadeddata', onLoaded)
    video.addEventListener('timeupdate', onTimeUpdate)
    video.addEventListener('ended', onEnded)
    if (video.readyState >= 2) onLoaded()
    return () => {
      cancelAnimationFrame(rafRef.current)
      video.removeEventListener('loadeddata', onLoaded)
      video.removeEventListener('timeupdate', onTimeUpdate)
      video.removeEventListener('ended', onEnded)
    }
  }, [])

  // The owner goes to the books; everyone else to the reading room, which
  // takes care of signing in and asking to read.
  const owner = role === 'owner'
  const getToWork = () => onEnter?.({ tab: owner ? 'library' : 'read' })

  // A pointer-following light: overlay-blended white brightens the flower's dots
  // where you touch/hover and leaves the black untouched. Positioned via transform
  // (compositor-friendly) rather than repainting a full-screen gradient each move.
  const glowRef = useRef(null)

  // The flowers lean toward the pointer: a soft spring, a few degrees of tilt
  // and a little drift, so the clip feels held in space rather than pasted on.
  const px = useMotionValue(0)
  const py = useMotionValue(0)
  const sx = useSpring(px, { stiffness: 60, damping: 18, mass: 0.8 })
  const sy = useSpring(py, { stiffness: 60, damping: 18, mass: 0.8 })
  const rotateY = useTransform(sx, [-0.5, 0.5], [-9, 9])
  const rotateX = useTransform(sy, [-0.5, 0.5], [7, -7])
  const driftX = useTransform(sx, [-0.5, 0.5], [-22, 22])
  const driftY = useTransform(sy, [-0.5, 0.5], [-16, 16])
  const moveGlow = (e) => {
    const g = glowRef.current
    if (!g) return
    const r = e.currentTarget.getBoundingClientRect()
    // -0.5 … 0.5 across the hero, for the flowers' parallax
    px.set((e.clientX - r.left) / r.width - 0.5)
    py.set((e.clientY - r.top) / r.height - 0.5)
    g.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0) translate(-50%, -50%)`
    g.style.opacity = '1'
  }
  const hideGlow = () => {
    if (glowRef.current) glowRef.current.style.opacity = '0'
    px.set(0)
    py.set(0)
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-black isolate"
      onPointerMove={moveGlow}
      onPointerLeave={hideGlow}
      onPointerCancel={hideGlow}
    >
      {/* Pointer light — overlay-blended, so it lifts the flowers' colour where
          you hover and leaves the black untouched. Below the z-10 content. */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-[1] h-[42vmax] w-[42vmax] rounded-full opacity-0 transition-opacity duration-300 ease-out"
        style={{
          background:
            'radial-gradient(circle, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.15) 32%, rgba(255,255,255,0) 62%)',
          mixBlendMode: 'overlay',
          willChange: 'transform, opacity',
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopNav
          tone="video"
          wide
          active="home"
          role={role}
          onNavigate={(t) => t !== 'home' && onEnter?.({ tab: t })}
        />

        {/* Words on one side, the flowers on the other. On phones they stack. */}
        <main className="mx-auto grid w-full max-w-[88rem] flex-1 items-center gap-6 px-6 pb-10 md:grid-cols-[1fr_1fr] md:gap-8 lg:px-10">
          <div className="order-2 text-center md:order-1 md:text-left">
            {typed(0, {
              as: 'h1',
              className:
                'font-serif text-[min(11vw,3rem)] italic leading-[1.05] tracking-tight text-white md:text-5xl lg:text-6xl',
            })}
            <Quotes
              start={step >= LINES.length}
              className="mx-auto mt-6 max-w-md font-serif text-xl italic leading-snug text-white/80 md:mx-0 md:text-2xl"
            />
            {/* The button doesn't wait for all the prose: it rises in once the title is set. */}
            <motion.button
              onClick={getToWork}
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.96 }}
              animate={step >= 1 ? { opacity: 1, y: 0, scale: 1 } : undefined}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-fuchsia px-7 py-3 font-grotesk text-base font-bold text-white"
            >
              {owner ? 'Get to work' : 'Start reading'} <ArrowRight size={18} />
            </motion.button>
          </div>

          <div className="order-1 flex justify-center [perspective:1200px] md:order-2">
            {/* Blooms in, then floats; leans toward the pointer (see px/py above). */}
            <motion.div
              initial={reduce ? false : { opacity: 0, scale: 0.9, filter: 'blur(14px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
              style={reduce ? undefined : { rotateX, rotateY, x: driftX, y: driftY }}
            >
              <motion.div
                animate={reduce ? undefined : { y: [0, -14, 0], rotate: [0, 0.8, 0] }}
                transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
                className="relative aspect-[740/920] h-[48vh] max-h-[48vh] md:h-[88vh] md:max-h-[88vh]"
              >
                <video
                  ref={videoRef}
                  src={BG_SRC}
                  muted
                  playsInline
                  autoPlay
                  loop={false}
                  preload="auto"
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover"
                  style={{ opacity: 0 }}
                />
                {/* soften the clip's edges into the page */}
                <div className="pointer-events-none absolute inset-0 [background:radial-gradient(ellipse_at_center,transparent_55%,#000_100%)]" />
              </motion.div>
            </motion.div>
          </div>
        </main>
      </div>
    </div>
  )
}

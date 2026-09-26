import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import TopNav from './TopNav.jsx'
import { heroLines } from '../library.js'
import { isSupabaseConfigured } from '../lib/supabase.js'

// The hero background: pink flowers blooming out of true black, traced with
// fine white measuring lines. A local, self-contained clip (public/hero-flowers.mp4,
// 600px portrait, 24fps, no audio, faststart so it plays before it's fully
// downloaded). The previous dot-matrix flower is still at public/hero-bg.mp4.
const BG_SRC = '/hero-flowers.mp4'
const FADE_MS = 500
const TAIL_S = 0.5 // fade out this long before the end, then loop with a fade in

/**
 * Her own lines, drifting down the page from the top to the bottom: each one
 * once per pass, with no names attached. When the last has passed, a new pass
 * begins, in a fresh order, from the top. Reduced motion: the lines stand still.
 */
function Drift({ poems }) {
  const reduce = useReducedMotion()
  const box = useRef(null)
  const track = useRef(null)
  const [pass, setPass] = useState(0)
  const [size, setSize] = useState(null) // { box, track } heights in px

  // Every distinct line, poems kept whole but in a random order each pass.
  const lines = useMemo(() => {
    const order = [...poems]
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const seen = new Set()
    const out = []
    for (const p of order) {
      const mine = p.lines.filter((l) => {
        const k = l.toLowerCase()
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      if (mine.length) out.push(mine)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poems, pass])

  useEffect(() => {
    const measure = () => box.current && track.current && setSize({ box: box.current.offsetHeight, track: track.current.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    box.current && ro.observe(box.current)
    track.current && ro.observe(track.current)
    return () => ro.disconnect()
  }, [lines])

  const PX_PER_S = 26
  const moving = !reduce && size
  const seconds = size ? (size.box + size.track) / PX_PER_S : 0

  return (
    <div
      ref={box}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-full overflow-hidden px-6 md:w-1/2 lg:px-10"
      style={{
        maskImage: 'linear-gradient(to bottom, transparent 0%, transparent 9%, #000 24%, #000 66%, transparent 84%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, transparent 9%, #000 24%, #000 66%, transparent 84%)',
      }}
    >
      {moving && (
        <style>{`@keyframes hero-drift-${pass} { from { transform: translateY(-100%) } to { transform: translateY(${size.box}px) } }`}</style>
      )}
      <div
        key={pass}
        ref={track}
        onAnimationEnd={() => setPass((n) => n + 1)}
        className="mx-auto flex max-w-xl flex-col gap-5 md:ml-auto md:mr-0 md:max-w-none"
        style={
          moving
            ? { animation: `hero-drift-${pass} ${seconds}s linear 1 both` }
            : { transform: reduce ? 'translateY(12vh)' : 'translateY(-100%)' }
        }
      >
        {lines.map((poem, i) => (
          <div key={i} className="flex flex-col gap-5 pb-10">
            {poem.map((l) => (
              <p key={l} className="font-serif text-2xl italic leading-snug text-white/85 md:text-3xl">
                {l}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Hero({ onEnter, role }) {
  // Lines from her homepage poems: undefined while asking, [] if there are none.
  const [poems, setPoems] = useState(undefined)
  const reduce = useReducedMotion()
  useEffect(() => {
    if (!isSupabaseConfigured) return setPoems([])
    heroLines().then(setPoems, () => setPoems([]))
  }, [])
  const drifting = poems?.length > 0
  const ready = poems !== undefined

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

      {drifting && <Drift poems={poems} />}

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
          <div
            className={
              'order-2 text-center md:order-1 md:text-left ' + (drifting ? 'relative z-10 md:self-end md:pb-6' : '')
            }
          >
            {drifting ? (
              <h1 className="sr-only">Petrichor: where flowers bloom</h1>
            ) : (
              <motion.h1
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={ready ? { opacity: 1, y: 0 } : undefined}
                transition={{ duration: 0.8 }}
                className="font-serif text-[min(11vw,3rem)] italic leading-[1.05] tracking-tight text-white md:text-5xl lg:text-6xl"
              >
                Where flowers bloom
              </motion.h1>
            )}
            {/* The button rises in once the page knows what it's showing. */}
            <motion.button
              onClick={getToWork}
              initial={reduce ? false : { opacity: 0, y: 16, scale: 0.96 }}
              animate={ready ? { opacity: 1, y: 0, scale: 1 } : undefined}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 260, damping: 22 }}
              className={(drifting ? '' : 'mt-10 ') + 'inline-flex items-center gap-2 rounded-full bg-fuchsia px-7 py-3 font-grotesk text-base font-bold text-white shadow-[0_0_40px_12px_rgba(0,0,0,0.6)]'}
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

import { useEffect, useRef, useState } from 'react'
import TopNav from './TopNav.jsx'

// The hero background is a shimmering dot-matrix flower, shipped with the site
// as a local, self-contained clip (public/hero-bg.mp4). It plays as a <video>
// rather than a WebP frame sequence: this clip's high-frequency sparkle doesn't
// compress to frames well (8-12MB of WebP vs a 1.8MB 720p h264), and a
// progressive video starts before it's fully downloaded.
const BG_SRC = '/hero-bg.mp4'
const FADE_MS = 500
const TAIL_S = 0.5 // fade out this long before the end, then loop with a fade in

export default function Hero({ onEnter }) {
  const [feeling, setFeeling] = useState('')
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

  const findPrompt = () => onEnter?.({ tab: 'spark' })
  const useFeeling = () => feeling.trim() && onEnter?.({ feeling: feeling.trim() })

  // A pointer-following light: overlay-blended white brightens the flower's dots
  // where you touch/hover and leaves the black untouched. Positioned via transform
  // (compositor-friendly) rather than repainting a full-screen gradient each move.
  const glowRef = useRef(null)
  const moveGlow = (e) => {
    const g = glowRef.current
    if (!g) return
    const r = e.currentTarget.getBoundingClientRect()
    g.style.transform = `translate3d(${e.clientX - r.left}px, ${e.clientY - r.top}px, 0) translate(-50%, -50%)`
    g.style.opacity = '1'
  }
  const hideGlow = () => {
    if (glowRef.current) glowRef.current.style.opacity = '0'
  }

  return (
    <div
      className="relative min-h-screen overflow-hidden bg-black isolate"
      onPointerMove={moveGlow}
      onPointerLeave={hideGlow}
      onPointerCancel={hideGlow}
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
        className="absolute inset-0 h-full w-full translate-y-[16%] object-contain sm:translate-y-[32%] sm:object-cover"
        style={{ opacity: 0 }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/70" />

      {/* Pointer light — brightens the flower where you touch. z-[1] keeps it above
          the video/gradient but below the z-10 content, so it never touches the text. */}
      <div
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-[1] h-[42vmax] w-[42vmax] rounded-full opacity-0 transition-opacity duration-300 ease-out"
        style={{
          background:
            'radial-gradient(circle, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.18) 32%, rgba(255,255,255,0) 62%)',
          mixBlendMode: 'overlay',
          willChange: 'transform, opacity',
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <TopNav
          tone="video"
          active="home"
          onNavigate={(t) => t !== 'home' && onEnter?.({ tab: t })}
        />

        {/* Hero content = the app's entry, filmed — compact, top-aligned */}
        <main className="relative z-10 flex flex-1 flex-col items-center justify-start px-6 pb-12 pt-2 text-center">
          <h1 className="whitespace-nowrap font-serif text-5xl italic tracking-tight text-white md:text-6xl lg:text-7xl">
            Where poems begin
          </h1>

          {/* the input + Use this on top; Find me a prompt + label on the row below */}
          <div className="mt-9 flex w-full max-w-xl flex-col items-center gap-4">
            <div className="flex w-full gap-2">
              <input
                value={feeling}
                onChange={(e) => setFeeling(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && useFeeling()}
                placeholder="the ache of a summer that's ending"
                className="liquid-glass liquid-glass--fuchsia min-w-0 flex-1 rounded-full px-6 py-2.5 font-grotesk text-white placeholder:text-white/40 focus:outline-none"
              />
              <button
                onClick={useFeeling}
                className="liquid-glass shrink-0 rounded-full px-6 py-2.5 font-grotesk font-medium text-white transition-colors hover:bg-fuchsia/10"
              >
                Use this
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                onClick={findPrompt}
                className="shrink-0 rounded-full bg-fuchsia px-7 py-3 font-grotesk font-bold text-white transition-transform hover:scale-[1.03]"
              >
                Find me a prompt
              </button>
              <span className="shrink-0 font-serif italic text-white/70">…or bring your own feeling</span>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

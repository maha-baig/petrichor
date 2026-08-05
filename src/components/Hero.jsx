import { useEffect, useRef, useState } from 'react'
import TopNav from './TopNav.jsx'

// The hero motion is a blooming-flower timelapse, delivered as a WebP frame
// sequence (public/hero/f_001..f_274) played on a canvas rather than a <video>.
// Frames autoplay-loop everywhere without the codec/autoplay quirks of <video>,
// and there's no external CDN dependency — the clip ships with the site.
const FRAME_COUNT = 274
const FPS = 20
const FADE_MS = 500 // gentle cross-fade at the loop seam, matching the old video
const CYCLE_MS = (FRAME_COUNT / FPS) * 1000
// Vertical framing bias: 0 centres the bloom; positive nudges it down (echoing
// the old clip's translate-y-[17%]). The new clip is centred, so 0 reads best.
const Y_BIAS = 0
const frameUrl = (i) => `/hero/f_${String(i + 1).padStart(3, '0')}.webp`

export default function Hero({ onEnter }) {
  const [feeling, setFeeling] = useState('')
  const canvasRef = useRef(null)
  const rafRef = useRef(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')

    const reduce =
      window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false

    // Preload every frame; decode() best-effort so the first paint never blanks.
    const frames = Array.from({ length: FRAME_COUNT }, (_, i) => {
      const img = new Image()
      img.src = frameUrl(i)
      img.decode?.().catch(() => {})
      return img
    })

    // Cover-fit the current frame into the canvas box (like object-cover).
    function draw(img) {
      if (!img || !img.complete || !img.naturalWidth) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const cw = canvas.clientWidth
      const ch = canvas.clientHeight
      if (canvas.width !== Math.round(cw * dpr)) canvas.width = Math.round(cw * dpr)
      if (canvas.height !== Math.round(ch * dpr)) canvas.height = Math.round(ch * dpr)
      const scale = Math.max((cw * dpr) / img.naturalWidth, (ch * dpr) / img.naturalHeight)
      const dw = img.naturalWidth * scale
      const dh = img.naturalHeight * scale
      const dx = (canvas.width - dw) / 2
      const dy = (canvas.height - dh) / 2 + Y_BIAS * canvas.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, dx, dy, dw, dh)
    }

    let start = performance.now()
    let lastIndex = -1

    function tick(now) {
      const t = (now - start) % CYCLE_MS
      const index = Math.min(FRAME_COUNT - 1, Math.floor((t / 1000) * FPS))
      if (index !== lastIndex) {
        draw(frames[index])
        lastIndex = index
      }
      // Fade in from the seam, fade back out just before it, so the loop point
      // is a soft dip to black rather than a hard cut.
      let opacity = 1
      if (t < FADE_MS) opacity = t / FADE_MS
      else if (CYCLE_MS - t < FADE_MS) opacity = (CYCLE_MS - t) / FADE_MS
      canvas.style.opacity = String(opacity)
      rafRef.current = requestAnimationFrame(tick)
    }

    // Reduced motion: hold a single open-bloom frame, no animation.
    if (reduce) {
      const still = frames[Math.floor(FRAME_COUNT * 0.55)]
      const paint = () => (still.complete ? (draw(still), (canvas.style.opacity = '1')) : still.addEventListener('load', paint, { once: true }))
      paint()
      return () => cancelAnimationFrame(rafRef.current)
    }

    const first = frames[0]
    const begin = () => {
      start = performance.now()
      rafRef.current = requestAnimationFrame(tick)
    }
    if (first.complete) begin()
    else first.addEventListener('load', begin, { once: true })

    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  const findPrompt = () => onEnter?.({ tab: 'spark' })
  const useFeeling = () => feeling.trim() && onEnter?.({ feeling: feeling.trim() })

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0 }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/70" />

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

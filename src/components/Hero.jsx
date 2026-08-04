import { useEffect, useRef, useState } from 'react'
import TopNav from './TopNav.jsx'

const VIDEO_SRC =
  'https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260328_115001_bcdaa3b4-03de-47e7-ad63-ae3e392c32d4.mp4'

const FADE_MS = 500
const TAIL_S = 0.55

const MOODS = [
  'melancholy',
  'longing',
  'tenderness',
  'wonder',
  'grief',
  'nostalgia',
  'quiet rage',
  'restless',
]

export default function Hero({ mood, setMood, onEnter }) {
  const [feeling, setFeeling] = useState('')
  const videoRef = useRef(null)
  const rafRef = useRef(0)
  const fadingOutRef = useRef(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    function fadeTo(target) {
      cancelAnimationFrame(rafRef.current)
      const start = performance.now()
      const from = parseFloat(video.style.opacity || '0')
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

  const findPrompt = () => onEnter?.({ tab: 'spark', find: true })
  const useFeeling = () => feeling.trim() && onEnter?.({ feeling: feeling.trim() })

  return (
    <div className="relative min-h-screen overflow-hidden bg-black">
      <video
        ref={videoRef}
        src={VIDEO_SRC}
        muted
        playsInline
        autoPlay
        preload="auto"
        className="absolute inset-0 h-full w-full translate-y-[17%] object-cover"
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

          {/* "in a register of" + chips, all on one line (scrolls when narrow) */}
          <div className="mt-5 max-w-full overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="mx-auto flex w-max items-center gap-1.5">
              <span className="mr-1 shrink-0 font-serif italic text-white/70">in a register of</span>
              {MOODS.map((m) => {
                const active = m === mood
                return (
                  <button
                    key={m}
                    onClick={() => setMood(m)}
                    className={
                      'shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[0.8rem] transition-colors ' +
                      (active
                        ? 'border-fuchsia bg-fuchsia text-white'
                        : 'liquid-glass text-white/80 hover:text-white')
                    }
                  >
                    {m}
                  </button>
                )
              })}
            </div>
          </div>

          {/* the input + Use this on top; Find me a prompt + label on the row below */}
          <div className="mt-7 flex w-full max-w-xl flex-col items-center gap-4">
            <div className="flex w-full gap-2">
              <input
                value={feeling}
                onChange={(e) => setFeeling(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && useFeeling()}
                placeholder="the ache of a summer that's ending"
                className="liquid-glass min-w-0 flex-1 rounded-full px-6 py-2.5 font-grotesk text-white placeholder:text-white/40 focus:outline-none"
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

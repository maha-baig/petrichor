import { useEffect, useId, useRef, useState } from 'react'

// A DOM port of the MorphSlider "melt" transition, for swapping tab panels.
// The original morphs WebGL textures; DOM content can't be textured, so the same
// look is rebuilt with an SVG filter: fractal-noise displacement (the melt),
// an RGB channel split (the aberration) and a vertical drift + colour wash.
//
// Props mirror the slider's, minus the image-only ones (autoplay, loop,
// captions, controls, indicators) which have nothing to act on here.

const EASES = {
  linear: (t) => t,
  'power2.in': (t) => t * t,
  'power2.out': (t) => 1 - (1 - t) * (1 - t),
  'power2.inOut': (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  'power3.out': (t) => 1 - (1 - t) ** 3,
  'power3.inOut': (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
}

export default function MorphTransition({
  activeKey,
  render,
  transition = 'melt',
  intensity = 0.55,
  aberration = 0.35,
  drift = 0.4,
  overlayColor = '#05060a',
  duration = 1.1,
  ease = 'power2.inOut',
  scale = 2.4,
  radius = 16,
  className,
}) {
  const uid = useId().replace(/:/g, '')
  const [shownKey, setShownKey] = useState(activeKey)
  // 0 = settled, 1 = fully melted. Kept in a ref + written straight to the DOM
  // so the filter animates without a re-render per frame.
  const [melting, setMelting] = useState(false)

  const wrapRef = useRef(null)
  const turbRef = useRef(null)
  const dispRef = useRef(null)
  const offRRef = useRef(null)
  const offBRef = useRef(null)
  const washRef = useRef(null)
  const rafRef = useRef(0)
  // What's on screen right now, as a ref: the swap must not re-enter this
  // effect mid-flight, or the cleanup would cancel the loop while the panel
  // is still fully melted and leave the filter stuck on.
  const shownRef = useRef(activeKey)

  useEffect(() => {
    if (activeKey === shownRef.current) return

    const reduced =
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduced || transition !== 'melt') {
      shownRef.current = activeKey
      setShownKey(activeKey)
      return
    }

    const easeFn = EASES[ease] || EASES['power2.inOut']
    const half = (duration * 1000) / 2
    let start = null
    let swapped = false
    setMelting(true)

    const frame = (now) => {
      if (start === null) start = now
      const elapsed = now - start
      // out: 0 → 1 while the old panel melts away, in: 1 → 0 as the new one re-forms
      const raw = Math.min(elapsed / half, 1)
      const p = elapsed < half ? easeFn(raw) : 1 - easeFn(Math.min((elapsed - half) / half, 1))

      if (elapsed >= half && !swapped) {
        swapped = true
        shownRef.current = activeKey
        setShownKey(activeKey)
      }

      if (elapsed < half * 2) {
        paint(p)
        rafRef.current = requestAnimationFrame(frame)
      } else {
        settle()
      }
    }

    const paint = (p) => {
      const wrap = wrapRef.current
      if (turbRef.current) {
        const bf = 0.004 + p * 0.02 * intensity
        turbRef.current.setAttribute('baseFrequency', `${(bf * 0.6).toFixed(5)} ${bf.toFixed(5)}`)
      }
      dispRef.current?.setAttribute('scale', String(p * intensity * scale * 60))
      const ab = p * aberration * 14
      offRRef.current?.setAttribute('dx', String(ab))
      offBRef.current?.setAttribute('dx', String(-ab))
      if (wrap) {
        wrap.style.transform = `translate3d(0, ${(-p * drift * 60).toFixed(2)}px, 0) scale(${(1 - p * 0.02 * intensity).toFixed(4)})`
        wrap.style.opacity = String(1 - p * 0.75)
      }
      if (washRef.current) washRef.current.style.opacity = String(p * intensity)
    }

    // Hand the panel back to the browser completely: every inline style is
    // removed, not zeroed. A leftover transform (even an identity one) keeps
    // the layer composited and the text renders soft.
    const settle = () => {
      const wrap = wrapRef.current
      if (wrap) {
        wrap.style.transform = ''
        wrap.style.opacity = ''
        wrap.style.filter = ''
        wrap.style.willChange = ''
      }
      if (washRef.current) washRef.current.style.opacity = '0'
      // Zero the filter primitives too, so the next melt can't flash a stale frame.
      dispRef.current?.setAttribute('scale', '0')
      offRRef.current?.setAttribute('dx', '0')
      offBRef.current?.setAttribute('dx', '0')
      setMelting(false)
    }

    rafRef.current = requestAnimationFrame(frame)

    // Watchdog. requestAnimationFrame stops firing whenever the page is hidden
    // (background tab, occluded window), which would freeze the melt half-done
    // and leave the panel dimmed and pointer-events:none for good. setTimeout
    // still fires in that state, so it force-settles on wall-clock time.
    const guard = setTimeout(() => {
      if (!swapped) {
        swapped = true
        shownRef.current = activeKey
        setShownKey(activeKey)
      }
      cancelAnimationFrame(rafRef.current)
      settle()
    }, duration * 1000 + 200)

    return () => {
      cancelAnimationFrame(rafRef.current)
      clearTimeout(guard)
      // Interrupted (rapid tab clicks, unmount) — never leave it mid-melt.
      settle()
    }
  }, [activeKey, transition, intensity, aberration, drift, duration, ease, scale])

  const fid = `morph-melt-${uid}`

  return (
    <div className={className} style={{ position: 'relative' }}>
      <svg aria-hidden width="0" height="0" style={{ position: 'absolute' }}>
        <filter id={fid} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
          <feTurbulence ref={turbRef} type="fractalNoise" baseFrequency="0.0024 0.004" numOctaves="2" seed="7" result="noise" />
          <feDisplacementMap ref={dispRef} in="SourceGraphic" in2="noise" scale="0" xChannelSelector="R" yChannelSelector="G" result="melted" />
          {/* chromatic aberration: pull the red and blue channels apart */}
          <feColorMatrix in="melted" type="matrix" result="red"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feOffset ref={offRRef} in="red" dx="0" dy="0" result="redOff" />
          <feColorMatrix in="melted" type="matrix" result="blue"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" />
          <feOffset ref={offBRef} in="blue" dx="0" dy="0" result="blueOff" />
          <feColorMatrix in="melted" type="matrix" result="green"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" />
          <feBlend in="redOff" in2="green" mode="screen" result="rg" />
          <feBlend in="rg" in2="blueOff" mode="screen" />
        </filter>
      </svg>

      <div
        ref={wrapRef}
        style={{
          borderRadius: radius,
          filter: melting ? `url(#${fid})` : undefined,
          willChange: melting ? 'transform, opacity, filter' : undefined,
          pointerEvents: melting ? 'none' : undefined,
        }}
      >
        {render(shownKey)}
      </div>

      <div
        ref={washRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          background: overlayColor,
          opacity: 0,
          pointerEvents: 'none',
          mixBlendMode: 'soft-light',
        }}
      />
    </div>
  )
}

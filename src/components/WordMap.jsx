import { useEffect, useMemo, useRef, useState } from 'react'
import MoodSelector from './MoodSelector.jsx'
import { getWordMap } from '../api.js'
import { motion } from 'framer-motion'
import { Reveal, EASE } from '../motion.jsx'

// kind → brand pigment
const KIND = {
  sense: { color: 'var(--cobalt)', label: 'sense' },
  emotion: { color: 'var(--fuchsia)', label: 'emotion' },
  image: { color: 'var(--amber)', label: 'image' },
  action: { color: 'var(--body)', label: 'action' },
}
// weight 1..5 → font size (px)
const FS = { 1: 18, 2: 26, 3: 36, 4: 50, 5: 66 }

function boxesOverlap(a, b, pad) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  )
}

// Circular spiral packing: the heaviest word sits at the centre and each next
// word walks outward along a tight Archimedean spiral, taking the first slot
// that collides with nothing already placed. Guarantees no overlap, and the
// result reads as a circular cloud rather than a rectangle.
function packCloud(words, W, H) {
  if (!W || !H || !words.length) return []
  const cx = W / 2
  const cy = H / 2
  const placed = []
  const sorted = [...words].sort((a, b) => (b.weight || 1) - (a.weight || 1))
  const maxR = Math.min(W, H) / 2 // keep the cloud circular, not rectangular

  sorted.forEach((w, i) => {
    const fontPx = FS[w.weight] || 26
    const wpx = Math.max(w.text.length * fontPx * 0.56, fontPx)
    const hpx = fontPx * 1.12

    let spot = null
    // start each word at a different angle so the ring fills evenly
    const t0 = i * 1.4
    for (let t = t0; t < t0 + 240; t += 0.12) {
      const r = 5 * (t - t0) // spiral tightness
      if (r > maxR * 1.35) break
      // squash vertically so the cloud fills a landscape area as an ellipse
      const x = cx + r * 1.35 * Math.cos(t) - wpx / 2
      const y = cy + r * Math.sin(t) - hpx / 2
      if (x < 4 || y < 4 || x + wpx > W - 4 || y + hpx > H - 4) continue
      const box = { x, y, w: wpx, h: hpx }
      if (!placed.some((p) => boxesOverlap(p, box, 10))) {
        spot = box
        break
      }
    }
    if (spot) placed.push({ ...spot, word: w, fontPx, order: i })
  })
  return placed
}

export default function WordMap({ mood, setMood }) {
  const [feeling, setFeeling] = useState('')
  const [words, setWords] = useState([])
  const [kept, setKept] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const canvasRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!canvasRef.current) return
    const el = canvasRef.current
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [words.length > 0])

  const placed = useMemo(() => packCloud(words, size.w, size.h), [words, size.w, size.h])

  async function draw() {
    if (!feeling.trim()) return
    setLoading(true)
    setError(null)
    setKept({})
    try {
      const { words } = await getWordMap({ feeling: feeling.trim(), mood })
      setWords(words || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function toggle(w) {
    navigator.clipboard?.writeText(w.text)
    setKept((k) => ({ ...k, [w.text]: !k[w.text] }))
  }

  const hasCloud = words.length > 0

  return (
    <section className="flex min-h-[80vh] flex-col">
      {/* Slim control bar — stays out of the cloud's way */}
      <div className="flex flex-col gap-3">
        <Reveal order={0} className="flex flex-wrap items-center gap-2.5">
          <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
            Word map
          </span>
          {hasCloud && (
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1">
              {Object.values(KIND).map((k) => (
                <span key={k.label} className="flex items-center gap-1.5 text-xs text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: k.color }} />
                  {k.label}
                </span>
              ))}
            </div>
          )}
        </Reveal>

        {!hasCloud && (
          <Reveal
            as="h1"
            order={1}
            className="font-serif text-4xl font-normal italic leading-[0.95] tracking-tight text-ink sm:text-5xl"
          >
            Map a feeling
          </Reveal>
        )}
        {!hasCloud && (
          <Reveal as="p" order={2} className="max-w-xl text-muted">
            Name what you're writing about, and watch its words gather across the page — biggest at
            the heart, radiating out. Click any to keep it (and copy it).
          </Reveal>
        )}

        {!hasCloud && (
          <Reveal order={3}>
            <MoodSelector mood={mood} onChange={setMood} />
          </Reveal>
        )}

        <Reveal order={4} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={feeling}
            onChange={(e) => setFeeling(e.target.value)}
            placeholder="the quiet after everyone leaves"
            className="flex-1 rounded-sm border border-line bg-card px-4 py-2.5 text-body placeholder:text-muted/70 focus:border-fuchsia focus:outline-none"
            onKeyDown={(e) => e.key === 'Enter' && draw()}
          />
          <button
            onClick={draw}
            disabled={loading}
            className="rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {loading ? 'Gathering…' : hasCloud ? 'Remap' : 'Map it'}
          </button>
        </Reveal>
        {error && <p className="text-sm text-fuchsia">{error}</p>}
      </div>

      {/* The cloud fills the rest of the page */}
      {hasCloud && (
        <div ref={canvasRef} className="relative mt-4 min-h-[62vh] flex-1">
          {placed.map(({ x, y, fontPx, word }, i) => {
            const k = KIND[word.kind] || KIND.action
            const isKept = kept[word.text]
            return (
              <button
                key={word.text + i}
                onClick={() => toggle(word)}
                title="Click to keep & copy"
                className="word-bloom absolute origin-center whitespace-nowrap font-serif italic leading-none transition-transform duration-200 hover:z-10 hover:scale-110"
                style={{
                  left: `${x}px`,
                  top: `${y}px`,
                  fontSize: `${fontPx}px`,
                  color: k.color,
                  fontWeight: (word.weight || 2) >= 4 ? 700 : 400,
                  borderBottom: isKept ? `2px solid ${k.color}` : '2px solid transparent',
                  // bloom outward along the spiral
                  animationDelay: `${i * 0.055}s`,
                }}
              >
                {word.text}
              </button>
            )
          })}
        </div>
      )}

      {hasCloud && Object.values(kept).some(Boolean) && (
        <p className="mt-2 border-t border-line pt-3 text-sm text-muted">
          Kept:{' '}
          <span className="text-body">
            {Object.keys(kept)
              .filter((t) => kept[t])
              .join(' · ')}
          </span>
        </p>
      )}
    </section>
  )
}

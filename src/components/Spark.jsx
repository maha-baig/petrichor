import { useEffect, useState } from 'react'
import MoodSelector from './MoodSelector.jsx'
import { getPrompts } from '../api.js'
import { Reveal } from '../motion.jsx'

export default function Spark({ mood, setMood, onChoose, autoRun = false, onAutoRunDone }) {
  const [prompts, setPrompts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [ownFeeling, setOwnFeeling] = useState('')

  async function draw() {
    setLoading(true)
    setError(null)
    try {
      const { prompts } = await getPrompts({ mood, count: 4 })
      setPrompts(prompts || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // auto-generate once when arriving from the hero's "Find me a prompt"
  useEffect(() => {
    if (autoRun) {
      draw()
      onAutoRunDone?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section>
      <header className="mb-8">
        <Reveal order={0} className="mb-5 flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-fuchsia" />
          <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
            Verse · Petrichor
          </span>
        </Reveal>
        <Reveal
          as="h1"
          order={1}
          className="font-serif text-5xl font-normal italic leading-[0.95] tracking-tight text-ink sm:text-6xl"
        >
          Petrichor
        </Reveal>
        <Reveal as="p" order={2} className="mt-4 max-w-xl text-lg text-muted">
          A gentle way past the blank page. Choose a register, and let a prompt find you.
        </Reveal>
      </header>

      <div className="mb-6">
        <MoodSelector mood={mood} onChange={setMood} />
      </div>

      <button
        onClick={draw}
        disabled={loading}
        className="rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold tracking-tight text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
      >
        {loading ? 'Listening…' : prompts.length ? 'Give me more' : 'Find me a prompt'}
      </button>

      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}

      {prompts.length > 0 && (
        <ul className="stagger mt-8 grid gap-3 sm:grid-cols-2">
          {prompts.map((p, i) => (
            <li key={i}>
              <button
                onClick={() => onChoose(p)}
                className="group h-full w-full rounded-sm border border-line bg-card p-5 text-left transition-colors hover:border-fuchsia"
              >
                <p className="font-serif text-lg italic leading-relaxed text-body">{p.text}</p>
                {p.seed_image && (
                  <span className="mt-3 inline-block font-grotesk text-xs uppercase tracking-[0.12em] text-muted group-hover:text-fuchsia">
                    {p.seed_image}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-10 border-t border-line pt-6">
        <p className="mb-2 font-serif italic text-muted">…or bring your own feeling</p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={ownFeeling}
            onChange={(e) => setOwnFeeling(e.target.value)}
            placeholder="the ache of a summer that's ending"
            className="flex-1 rounded-sm border border-line bg-card px-4 py-2.5 text-body placeholder:text-muted/70 focus:border-fuchsia focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && ownFeeling.trim())
                onChoose({ text: ownFeeling.trim(), seed_image: '' })
            }}
          />
          <button
            onClick={() => ownFeeling.trim() && onChoose({ text: ownFeeling.trim(), seed_image: '' })}
            className="rounded-sm border border-line px-5 py-2.5 text-body transition-colors hover:border-fuchsia"
          >
            Use this
          </button>
        </div>
      </div>
    </section>
  )
}

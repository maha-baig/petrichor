import { useState } from 'react'
import { getReview } from '../api.js'
import { Reveal } from '../motion.jsx'

export default function Reviewer() {
  const [poem, setPoem] = useState('')
  const [review, setReview] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function run() {
    if (!poem.trim()) return
    setLoading(true)
    setError(null)
    setReview(null)
    try {
      setReview(await getReview({ poem }))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <header className="mb-6">
        <Reveal order={0} className="mb-5 flex items-center gap-2.5">
          <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
            Poem reviewer
          </span>
        </Reveal>
        <Reveal
          as="h1"
          order={1}
          className="font-serif text-4xl font-normal italic leading-[0.95] tracking-tight text-ink sm:text-5xl"
        >
          A reading, not a rewrite
        </Reveal>
        <Reveal as="p" order={2} className="mt-3 max-w-xl text-muted">
          Paste a poem. I'll tell you what I understand it to be doing, what's working, and where you
          might push it further — the words stay yours.
        </Reveal>
      </header>

      <Reveal
        as="textarea"
        order={3}
        value={poem}
        onChange={(e) => setPoem(e.target.value)}
        placeholder={'Paste your poem here…'}
        rows={10}
        className="w-full resize-y rounded-sm border border-line bg-card px-4 py-3 font-serif text-lg leading-relaxed text-body placeholder:font-sans placeholder:text-base placeholder:not-italic placeholder:text-muted/70 focus:border-fuchsia focus:outline-none"
      />
      <div className="mt-3 flex items-center gap-4">
        <button
          onClick={run}
          disabled={loading || !poem.trim()}
          className="rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
        >
          {loading ? 'Reading…' : 'Read my poem'}
        </button>
        {poem.trim() && (
          <span className="text-xs text-muted">
            {poem.trim().split(/\s+/).length} words · {poem.split('\n').length} lines
          </span>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}
      {loading && <p className="mt-6 font-serif italic text-muted">Sitting with your poem…</p>}

      {review && (
        <div className="mt-10 animate-rise space-y-8">
          <div>
            <h3 className="mb-2 font-grotesk text-lg font-extrabold tracking-tight text-body">
              What I understand
            </h3>
            <p className="border-l-2 border-fuchsia pl-4 font-serif text-lg leading-relaxed text-body">
              {review.reading}
            </p>
          </div>

          {review.strengths?.length > 0 && (
            <div>
              <h3 className="mb-3 font-grotesk text-lg font-extrabold tracking-tight text-body">
                What's working
              </h3>
              <ul className="space-y-2">
                {review.strengths.map((s, i) => (
                  <li key={i} className="flex gap-3 text-body">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-cobalt" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.suggestions?.length > 0 && (
            <div>
              <h3 className="mb-3 font-grotesk text-lg font-extrabold tracking-tight text-body">
                Where you might push it
              </h3>
              <ul className="space-y-4">
                {review.suggestions.map((s, i) => (
                  <li key={i} className="rounded-sm border border-line bg-card p-4">
                    <p className="font-grotesk text-sm font-bold uppercase tracking-[0.08em] text-amber">
                      {s.point}
                    </p>
                    <p className="mt-1.5 leading-relaxed text-body">{s.try}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

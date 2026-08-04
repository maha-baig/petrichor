import { useEffect, useRef, useState } from 'react'
import { getWords, getMoreWords } from '../api.js'
import MoodBoard from './MoodBoard.jsx'

// "give me more of these" — same pill as the Cosmos link, quiet until wanted.
function MoreButton({ onClick, busy, children }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-3 rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
    >
      {busy ? 'gathering…' : children}
    </button>
  )
}

function Chip({ children, copyable }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={
        copyable
          ? () => {
              navigator.clipboard?.writeText(children)
              setCopied(true)
              setTimeout(() => setCopied(false), 1100)
            }
          : undefined
      }
      className={
        'rounded-full border px-3 py-1.5 text-sm transition-colors ' +
        (copyable
          ? 'cursor-copy border-line text-body hover:border-fuchsia hover:text-fuchsia'
          : 'cursor-default border-line font-serif italic text-body')
      }
      title={copyable ? 'Click to copy for Cosmos' : undefined}
    >
      {copied ? 'copied ✓' : children}
    </button>
  )
}

export default function Words({ prompt, mood, onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    getWords({ prompt: prompt.text, mood })
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [prompt, mood])

  const cosmosUrl =
    'https://www.cosmos.so/search?q=' +
    encodeURIComponent((data?.searchTerms || []).slice(0, 3).join(' '))

  return (
    <section className="animate-rise">
      <button onClick={onBack} className="mb-6 text-sm text-muted hover:text-fuchsia">
        ← other prompts
      </button>

      <p className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
        your prompt
      </p>
      <h2 className="mt-2 max-w-2xl border-l-2 border-fuchsia pl-4 font-serif text-2xl italic leading-relaxed text-ink">
        {prompt.text}
      </h2>

      {loading && <p className="mt-8 font-serif italic text-muted">Gathering words…</p>}
      {error && <p className="mt-8 text-fuchsia">{error}</p>}

      {data && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 font-grotesk text-lg font-extrabold tracking-tight text-body">
              Words to write with
            </h3>
            <p className="mb-3 text-sm text-muted">The raw ore — for you, not the search box.</p>
            <div className="flex flex-wrap gap-2">
              {data.evocative?.map((w, i) => (
                <Chip key={i}>{w}</Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between gap-3">
              <h3 className="font-grotesk text-lg font-extrabold tracking-tight text-body">
                Search terms for Cosmos
              </h3>
              <a
                href={cosmosUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-body hover:border-fuchsia hover:text-fuchsia"
              >
                Open Cosmos ↗
              </a>
            </div>
            <p className="mb-3 text-sm text-muted">Click any to copy, then paste into Cosmos.</p>
            <div className="flex flex-wrap gap-2">
              {data.searchTerms?.map((w, i) => (
                <Chip key={i} copyable>
                  {w}
                </Chip>
              ))}
            </div>
          </div>

          {data.palette?.length > 0 && (
            <div className="lg:col-span-2">
              <h3 className="mb-3 font-grotesk text-lg font-extrabold tracking-tight text-body">
                A palette to begin
              </h3>
              <div className="flex flex-wrap gap-4">
                {data.palette.map((c, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span
                      className="h-10 w-10 rounded-sm border border-black/10"
                      style={{ background: c.hex }}
                    />
                    <div className="leading-tight">
                      <div className="text-sm text-body">{c.name}</div>
                      <div className="font-grotesk text-xs text-muted">{c.hex}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {data && (
        <MoodBoard
          feeling={prompt.text}
          paletteNames={(data.palette || []).map((c) => c.name)}
        />
      )}
    </section>
  )
}

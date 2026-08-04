import { useEffect, useRef, useState } from 'react'
import { getWords, getMoreWords } from '../api.js'
import { patchWorkspace, workspaceTitle } from '../store.js'
import {
  downloadWorkspaceZip,
  downloadBoardImage,
  downloadPalette,
  downloadPoem,
} from '../download.js'
import MoodBoard from './MoodBoard.jsx'

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

function Pill({ onClick, busy, children, title }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={title}
      className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
    >
      {busy ? 'working…' : children}
    </button>
  )
}

/**
 * One workspace: the prompt, its words, the mood board, and the poem —
 * every change written straight back to the store.
 */
export default function Workspace({ workspace, onChange, onBack }) {
  const ws = workspace
  const [loadingWords, setLoadingWords] = useState(false)
  const [asking, setAsking] = useState(null)
  const [error, setError] = useState(null)
  const [savedAt, setSavedAt] = useState(null)
  const [editingTitle, setEditingTitle] = useState(false)
  const [busy, setBusy] = useState(null) // which download is running
  const firstBatch = useRef({ evocative: 0, searchTerms: 0 })
  const poemTimer = useRef(null)

  // Every save goes through here: store first, then tell the app what changed.
  async function update(patch) {
    const next = await patchWorkspace(ws.id, patch)
    if (next) {
      onChange?.(next)
      setSavedAt(Date.now())
    }
    return next
  }

  // The word engine runs once per workspace — after that the words are saved.
  useEffect(() => {
    if (ws.words || !ws.prompt?.text) return
    let alive = true
    setLoadingWords(true)
    setError(null)
    getWords({ prompt: ws.prompt.text, mood: ws.mood })
      .then((d) => {
        if (!alive) return
        firstBatch.current = {
          evocative: d.evocative?.length || 0,
          searchTerms: d.searchTerms?.length || 0,
        }
        update({ words: d })
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoadingWords(false))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ws.id])

  async function askMore(want) {
    setAsking(want)
    setError(null)
    try {
      const res = await getMoreWords({
        prompt: ws.prompt.text,
        mood: ws.mood,
        want,
        count: 8,
        exclude: ws.words?.[want] || [],
      })
      const added = res[want] || []
      if (!added.length) {
        setError('No new ground there — try another prompt.')
        return
      }
      await update({ words: { ...ws.words, [want]: [...(ws.words?.[want] || []), ...added] } })
    } catch (e) {
      setError(e.message)
    } finally {
      setAsking(null)
    }
  }

  // The writing pane autosaves a beat after the poet stops typing.
  const [poem, setPoem] = useState(ws.poem || '')
  useEffect(() => setPoem(ws.poem || ''), [ws.id])
  function onPoem(value) {
    setPoem(value)
    clearTimeout(poemTimer.current)
    poemTimer.current = setTimeout(() => update({ poem: value }), 700)
  }
  useEffect(() => () => clearTimeout(poemTimer.current), [])

  async function run(kind, fn) {
    setBusy(kind)
    setError(null)
    try {
      await fn(ws)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const cosmosUrl =
    'https://www.cosmos.so/search?q=' +
    encodeURIComponent((ws.words?.searchTerms || []).slice(0, 3).join(' '))

  const hasPalette = (ws.words?.palette?.length || 0) + (ws.boardPalette?.length || 0) > 0

  return (
    <section className="animate-rise">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="text-sm text-muted hover:text-fuchsia">
          ← all workspaces
        </button>
        {savedAt && <span className="text-xs text-muted/70">saved</span>}
      </div>

      {/* Title — the workspace's own name, or the prompt until you give it one */}
      <div className="mt-5">
        {editingTitle ? (
          <input
            autoFocus
            defaultValue={ws.title || ''}
            placeholder={workspaceTitle(ws)}
            onBlur={(e) => {
              update({ title: e.target.value })
              setEditingTitle(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            className="w-full max-w-2xl rounded-sm border border-line bg-card px-4 py-2 font-serif text-3xl italic text-ink focus:border-fuchsia focus:outline-none"
          />
        ) : (
          <h1
            onClick={() => setEditingTitle(true)}
            title="Click to rename"
            className="max-w-3xl cursor-text font-serif text-3xl italic leading-tight text-ink sm:text-4xl"
          >
            {workspaceTitle(ws)}
          </h1>
        )}
        <p className="mt-2 font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
          {ws.mood} · started {new Date(ws.createdAt).toLocaleDateString()}
        </p>
      </div>

      {ws.title?.trim() && (
        <p className="mt-4 max-w-2xl border-l-2 border-fuchsia pl-4 font-serif italic text-muted">
          {ws.prompt?.text}
        </p>
      )}

      {/* Take it with you */}
      <div className="mt-6 flex flex-wrap items-center gap-2 border-y border-line py-3">
        <span className="mr-1 font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
          download
        </span>
        <Pill
          onClick={() => run('zip', downloadWorkspaceZip)}
          busy={busy === 'zip'}
          title="Images, words, palette, poem and a readme — as one .zip"
        >
          everything (.zip)
        </Pill>
        <Pill
          onClick={() => run('board', downloadBoardImage)}
          busy={busy === 'board'}
          title="The mood board flattened into a single PNG"
        >
          mood board (.png)
        </Pill>
        <Pill
          onClick={() => run('palette', downloadPalette)}
          busy={busy === 'palette'}
          title="Every colour, labelled with its hex"
        >
          palette (.png)
        </Pill>
        {poem.trim() && (
          <Pill onClick={() => run('poem', downloadPoem)} busy={busy === 'poem'}>
            poem (.txt)
          </Pill>
        )}
      </div>

      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}
      {loadingWords && <p className="mt-8 font-serif italic text-muted">Gathering words…</p>}

      {ws.words && (
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="mb-1 font-grotesk text-lg font-extrabold tracking-tight text-body">
              Words to write with
            </h3>
            <p className="mb-3 text-sm text-muted">The raw ore — for you, not the search box.</p>
            <div className="flex flex-wrap gap-2">
              {ws.words.evocative?.map((w, i) => (
                <span key={i} className={i >= firstBatch.current.evocative ? 'animate-rise' : ''}>
                  <Chip>{w}</Chip>
                </span>
              ))}
            </div>
            <div className="mt-3">
              <Pill onClick={() => askMore('evocative')} busy={asking === 'evocative'}>
                + more words to write with
              </Pill>
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
              {ws.words.searchTerms?.map((w, i) => (
                <span key={i} className={i >= firstBatch.current.searchTerms ? 'animate-rise' : ''}>
                  <Chip copyable>{w}</Chip>
                </span>
              ))}
            </div>
            <div className="mt-3">
              <Pill onClick={() => askMore('searchTerms')} busy={asking === 'searchTerms'}>
                + more terms to search in Cosmos
              </Pill>
            </div>
          </div>

          {hasPalette && (
            <div className="lg:col-span-2">
              <h3 className="mb-3 font-grotesk text-lg font-extrabold tracking-tight text-body">
                A palette to begin
              </h3>
              <div className="flex flex-wrap gap-4">
                {ws.words.palette?.map((c, i) => (
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

      <MoodBoard
        feeling={ws.prompt?.text}
        paletteNames={(ws.words?.palette || []).map((c) => c.name)}
        tiles={ws.images || []}
        onTilesChange={(tiles) => update({ images: tiles })}
        onPaletteChange={(p) => update({ boardPalette: p })}
        onReadingChange={(r) => update({ reading: r })}
        onGeneratedChange={(g) => update({ generated: g })}
        initial={{ reading: ws.reading, generated: ws.generated }}
      />

      {/* The writing pane — the point of all of it */}
      <div className="mt-12 border-t border-line pt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h3 className="font-grotesk text-lg font-extrabold tracking-tight text-body">The poem</h3>
          <span className="text-xs text-muted">
            {poem.trim() ? `${poem.trim().split(/\s+/).length} words · saves itself` : 'saves itself as you write'}
          </span>
        </div>
        <textarea
          value={poem}
          onChange={(e) => onPoem(e.target.value)}
          rows={14}
          placeholder="Begin anywhere…"
          className="mt-3 w-full resize-y rounded-sm border border-line bg-card px-5 py-4 font-serif text-lg leading-relaxed text-body placeholder:italic placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
        />
      </div>
    </section>
  )
}

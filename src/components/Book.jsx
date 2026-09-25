import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, BookOpen, Download, ImagePlus, Plus, Trash2 } from 'lucide-react'
import BookCover from './BookCover.jsx'
import {
  bookTitle,
  deletePiece,
  deleteWork,
  getManuscript,
  getWork,
  insertPiece,
  numberContents,
  pieceLabel,
  removeCover,
  reorderPieces,
  updateWork,
  uploadCover,
} from '../library.js'
import { TRIMS, downloadEpub, downloadText, printManuscript } from '../manuscriptExport.js'

const STATUS_DOT = { draft: 'bg-line', revising: 'bg-amber', final: 'bg-fuchsia' }
const COVER_COLORS = ['#2a1f2d', '#1f2a2a', '#3a2418', '#1d2438', '#33202a', '#23301f', '#6b1d3a', '#c9bfae']
const fmt = (n) => Number(n || 0).toLocaleString()

/** A textarea that grows with what's written in it. */
function GrowingText({ value, onCommit, className, ...rest }) {
  const ref = useRef(null)
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [text])
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      className={'block w-full resize-none overflow-hidden bg-transparent focus:outline-none ' + className}
      {...rest}
    />
  )
}

function ExportMenu({ workId }) {
  const [open, setOpen] = useState(false)
  const [trim, setTrim] = useState('6x9')
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function run(kind) {
    setBusy(kind)
    setError(null)
    try {
      const data = await getManuscript(workId)
      if (kind === 'epub') await downloadEpub(data)
      if (kind === 'pdf') printManuscript(data, trim)
      if (kind === 'txt' || kind === 'md') downloadText(data, kind)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  const item = 'block w-full rounded-sm px-3 py-2 text-left text-sm text-body transition-colors hover:bg-body/5 hover:text-fuchsia'
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2 font-grotesk text-sm font-bold text-body transition-colors hover:border-fuchsia hover:text-fuchsia"
      >
        <Download size={15} /> Export
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-sm border border-line bg-paper p-1.5 shadow-xl">
          <button onClick={() => run('epub')} className={item}>
            {busy === 'epub' ? 'Binding…' : 'E-book (.epub)'}
          </button>
          <div className="flex items-center gap-1 px-1">
            <button onClick={() => run('pdf')} className={item}>
              {busy === 'pdf' ? 'Laying out…' : 'Print / PDF'}
            </button>
            <select
              value={trim}
              onChange={(e) => setTrim(e.target.value)}
              aria-label="Trim size"
              className="shrink-0 rounded-sm border border-line bg-card px-1.5 py-1 text-xs text-muted focus:border-fuchsia focus:outline-none"
            >
              {Object.entries(TRIMS).map(([k, t]) => (
                <option key={k} value={k}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <button onClick={() => run('txt')} className={item}>
            Plain text (.txt)
          </button>
          <button onClick={() => run('md')} className={item}>
            Markdown (.md)
          </button>
          {error && <p className="px-3 py-2 text-xs text-fuchsia">{error}</p>}
        </div>
      )}
    </div>
  )
}

/**
 * One book: the cover and what it's about, then its table of contents —
 * parts, chapters and sections — each of which opens in the editor.
 */
export default function Book({ workId, onBack, onWrite }) {
  const [work, setWork] = useState(null)
  const [pieces, setPieces] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(null)
  const [confirming, setConfirming] = useState(null) // piece id, or 'book'
  const fileInput = useRef(null)

  useEffect(() => {
    let alive = true
    getWork(workId)
      .then((found) => {
        if (!alive) return
        if (!found) return setError('This book could not be found.')
        setWork(found.work)
        setPieces(found.pieces)
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [workId])

  if (error && !work)
    return (
      <section>
        <button onClick={onBack} className="text-sm text-muted hover:text-fuchsia">
          ← all books
        </button>
        <p className="mt-6 max-w-2xl text-sm text-fuchsia">{error}</p>
      </section>
    )
  if (!work) return <p className="font-serif italic text-muted">Opening the book…</p>

  const contents = numberContents(pieces)
  const chapters = contents.filter((p) => p.kind === 'chapter')
  const totalWords = pieces.reduce((n, p) => n + (p.words || 0), 0)
  const writable = contents.filter((p) => p.kind !== 'part')
  const lastTouched = [...writable].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0]
  const started = totalWords > 0

  async function change(patch) {
    setWork((w) => ({ ...w, ...patch }))
    try {
      setWork(await updateWork(work.id, patch))
    } catch (e) {
      setError(e.message)
    }
  }

  async function add(kind, index = pieces.length) {
    setBusy(kind + index)
    setError(null)
    try {
      setPieces(await insertPiece(work.id, pieces, index, kind))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  // A new section goes after its chapter's last section.
  function addSection(chapterIndex) {
    let i = chapterIndex + 1
    while (i < contents.length && contents[i].kind === 'section') i++
    add('section', i)
  }

  function move(index, dir) {
    const j = index + dir
    if (j < 0 || j >= contents.length) return
    const ids = contents.map((p) => p.id)
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    setPieces((ps) => ps.map((p) => ({ ...p, position: ids.indexOf(p.id) })))
    reorderPieces(ids).catch((e) => setError(e.message))
  }

  async function remove(piece) {
    try {
      await deletePiece(piece.id)
      setPieces((ps) => ps.filter((p) => p.id !== piece.id))
      setConfirming(null)
    } catch (e) {
      setError(e.message)
    }
  }

  async function onCoverFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('A cover has to be an image.')
    if (file.size > 8 * 1024 * 1024) return setError('That image is over 8 MB. Try a smaller one.')
    setBusy('cover')
    setError(null)
    try {
      setWork(await uploadCover(work.id, file))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="animate-rise">
      <button onClick={onBack} className="text-sm text-muted hover:text-fuchsia">
        ← all books
      </button>

      {/* ── The book itself ─────────────────────────────────────────────── */}
      <div className="mt-6 grid gap-10 md:grid-cols-[15rem_1fr]">
        <div className="mx-auto w-48 md:mx-0 md:w-full">
          <BookCover work={work} size="lg" />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input ref={fileInput} type="file" accept="image/*" onChange={onCoverFile} className="hidden" />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={busy === 'cover'}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
            >
              <ImagePlus size={13} /> {busy === 'cover' ? 'Uploading…' : work.cover_path ? 'Change cover' : 'Upload cover'}
            </button>
            {work.cover_path && (
              <button
                onClick={async () => setWork(await removeCover(work.id, work.cover_path))}
                className="text-xs text-muted hover:text-fuchsia"
              >
                remove
              </button>
            )}
          </div>
          {!work.cover_path && (
            <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Cover colour">
              {COVER_COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={work.cover_color === c}
                  aria-label={`Cover colour ${c}`}
                  onClick={() => change({ cover_color: c })}
                  className={
                    'h-5 w-5 rounded-full border transition-transform hover:scale-110 ' +
                    (work.cover_color === c ? 'border-fuchsia ring-2 ring-fuchsia/40' : 'border-line')
                  }
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <GrowingText
            value={work.title}
            onCommit={(v) => change({ title: v })}
            placeholder="Untitled book"
            aria-label="Title"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            className="font-serif text-4xl italic leading-tight text-ink placeholder:text-ink/40 sm:text-5xl"
          />
          <GrowingText
            value={work.subtitle}
            onCommit={(v) => change({ subtitle: v })}
            placeholder="Add a subtitle"
            aria-label="Subtitle"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            className="mt-1 font-serif text-xl italic text-muted placeholder:text-muted/40"
          />
          <div className="mt-3 flex items-center gap-2 text-sm text-muted">
            <span>by</span>
            <input
              defaultValue={work.author}
              key={work.author}
              onBlur={(e) => e.target.value !== work.author && change({ author: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              placeholder="your name"
              aria-label="Author"
              className="min-w-0 flex-1 bg-transparent text-body placeholder:text-muted/50 focus:outline-none"
            />
          </div>

          <div className="mt-6 border-t border-line pt-5">
            <span className="font-grotesk text-[0.65rem] font-bold uppercase tracking-[0.2em] text-muted">About this book</span>
            <GrowingText
              value={work.description}
              onCommit={(v) => change({ description: v })}
              placeholder="What is this book? A few lines for the back cover — or just for you."
              aria-label="Description"
              className="mt-2 font-serif text-lg leading-relaxed text-body placeholder:italic placeholder:text-muted/50"
            />
          </div>

          <p className="mt-5 text-xs text-muted">
            {chapters.length} {chapters.length === 1 ? 'chapter' : 'chapters'} · {fmt(totalWords)}
            {work.goal_words ? ` of ${fmt(work.goal_words)}` : ''} words
          </p>
          {work.goal_words > 0 && (
            <div className="mt-2 h-[3px] w-full max-w-sm overflow-hidden rounded-full bg-line">
              <div className="h-full bg-fuchsia" style={{ width: `${Math.min(100, (totalWords / work.goal_words) * 100)}%` }} />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {writable.length > 0 && (
              <button
                onClick={() => onWrite((started && lastTouched) || writable[0])}
                className="inline-flex items-center gap-2 rounded-full bg-fuchsia px-5 py-2 font-grotesk text-sm font-bold text-white transition-transform hover:scale-[1.02]"
              >
                <BookOpen size={15} /> {started ? `Continue: ${pieceLabel(lastTouched)}` : 'Start writing'}
              </button>
            )}
            <ExportMenu workId={work.id} />
          </div>
        </div>
      </div>

      {error && <p className="mt-6 max-w-2xl text-sm text-fuchsia">{error}</p>}

      {/* ── Table of contents ───────────────────────────────────────────── */}
      <div className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-3">
          <h2 className="font-serif text-3xl italic text-ink">Contents</h2>
          <div className="flex flex-wrap gap-2">
            {[
              ['part', 'Part'],
              ['chapter', 'Chapter'],
            ].map(([k, l]) => (
              <button
                key={k}
                onClick={() => add(k)}
                disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs font-bold text-body transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
              >
                <Plus size={13} /> {l}
              </button>
            ))}
          </div>
        </div>

        {contents.length === 0 && (
          <div className="mt-6 rounded-sm border border-dashed border-line p-10 text-center">
            <p className="font-serif text-lg italic text-muted">No chapters yet.</p>
            <button onClick={() => add('chapter')} className="mt-4 rounded-full bg-fuchsia px-5 py-2 font-grotesk text-sm font-bold text-white">
              Add the first chapter
            </button>
          </div>
        )}

        <ol className="mt-2">
          {contents.map((p, i) => {
            const isPart = p.kind === 'part'
            const pad = p.depth === 2 ? 'pl-12' : p.depth === 1 ? 'pl-6' : ''
            return (
              <li
                key={p.id}
                className={
                  'group flex items-center gap-3 border-b border-line/50 ' +
                  (isPart ? 'mt-6 pb-2 pt-3' : 'py-2.5') +
                  ' ' +
                  pad
                }
              >
                <button onClick={() => onWrite(p)} className="flex min-w-0 flex-1 items-baseline gap-3 text-left">
                  {isPart ? (
                    <>
                      <span className="font-grotesk text-[0.7rem] font-bold uppercase tracking-[0.22em] text-muted">Part {p.number}</span>
                      <span className="truncate font-serif text-xl italic text-ink group-hover:text-fuchsia">
                        {p.title?.trim() || 'Untitled part'}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={'w-10 shrink-0 font-grotesk text-xs tabular-nums text-muted ' + (p.kind === 'section' ? 'opacity-70' : '')}>
                        {p.number}
                      </span>
                      <span
                        className={
                          'truncate font-serif italic group-hover:text-fuchsia ' +
                          (p.kind === 'section' ? 'text-base text-body' : 'text-lg text-ink')
                        }
                      >
                        {pieceLabel(p)}
                      </span>
                    </>
                  )}
                </button>

                {!isPart && (
                  <span className="hidden shrink-0 items-center gap-2 text-xs text-muted sm:flex">
                    <span className={'h-1.5 w-1.5 rounded-full ' + STATUS_DOT[p.status]} title={p.status} />
                    {fmt(p.words)} words
                  </span>
                )}

                <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {confirming === p.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-muted">delete{p.words ? ` ${fmt(p.words)} words` : ''}?</span>
                      <button onClick={() => remove(p)} className="rounded-full bg-fuchsia px-2.5 py-0.5 font-bold text-white">
                        yes
                      </button>
                      <button onClick={() => setConfirming(null)} className="text-muted underline">
                        no
                      </button>
                    </span>
                  ) : (
                    <>
                      {p.kind === 'chapter' && (
                        <button
                          onClick={() => addSection(i)}
                          className="rounded-full px-2 py-1 text-xs text-muted hover:text-fuchsia"
                          title="Add a section to this chapter"
                        >
                          + section
                        </button>
                      )}
                      {isPart && (
                        <button onClick={() => add('chapter', i + 1)} className="rounded-full px-2 py-1 text-xs text-muted hover:text-fuchsia">
                          + chapter
                        </button>
                      )}
                      <button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" className="rounded-full p-1.5 text-muted hover:text-fuchsia disabled:opacity-30">
                        <ArrowUp size={14} />
                      </button>
                      <button
                        onClick={() => move(i, 1)}
                        disabled={i === contents.length - 1}
                        aria-label="Move down"
                        className="rounded-full p-1.5 text-muted hover:text-fuchsia disabled:opacity-30"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <button onClick={() => setConfirming(p.id)} aria-label={`Delete ${pieceLabel(p)}`} className="rounded-full p-1.5 text-muted hover:text-fuchsia">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ol>
      </div>

      {/* ── The rest of the title page ──────────────────────────────────── */}
      <details className="mt-14 border-t border-line pt-5">
        <summary className="cursor-pointer font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.18em] text-muted">
          Dedication, epigraph and word target
        </summary>
        <div className="mt-5 grid max-w-2xl gap-5">
          <label className="block">
            <span className="text-xs text-muted">Dedication</span>
            <GrowingText
              value={work.dedication}
              onCommit={(v) => change({ dedication: v })}
              placeholder="for …"
              className="mt-1 rounded-sm border border-line bg-card px-3 py-2 font-serif italic text-body"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Epigraph</span>
            <GrowingText
              value={work.epigraph}
              onCommit={(v) => change({ epigraph: v })}
              placeholder="a line borrowed, and whose it is"
              className="mt-1 rounded-sm border border-line bg-card px-3 py-2 font-serif italic text-body"
            />
          </label>
          <label className="block">
            <span className="text-xs text-muted">Word target for the book</span>
            <input
              type="number"
              min="0"
              step="1000"
              defaultValue={work.goal_words || ''}
              onBlur={(e) => change({ goal_words: Math.max(0, parseInt(e.target.value, 10) || 0) })}
              placeholder="none"
              className="mt-1 block w-40 rounded-sm border border-line bg-card px-3 py-2 text-body focus:border-fuchsia focus:outline-none"
            />
          </label>
        </div>

        <div className="mt-10 text-sm">
          {confirming === 'book' ? (
            <span className="flex flex-wrap items-center gap-3">
              <span className="text-muted">
                Delete “{bookTitle(work)}”, every chapter in it, and all their history? This can't be undone.
              </span>
              <button
                onClick={async () => {
                  await deleteWork(work.id)
                  onBack()
                }}
                className="rounded-full bg-fuchsia px-4 py-1.5 font-bold text-white"
              >
                delete it
              </button>
              <button onClick={() => setConfirming(null)} className="text-muted underline">
                keep it
              </button>
            </span>
          ) : (
            <button onClick={() => setConfirming('book')} className="text-muted hover:text-fuchsia">
              Delete this book…
            </button>
          )}
        </div>
      </details>
    </section>
  )
}

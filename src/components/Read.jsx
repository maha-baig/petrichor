import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import SignIn, { signOut } from '../auth.jsx'
import BookCover from './BookCover.jsx'
import { requestAccess } from '../access.js'
import { bookTitle, numberContents, pieceLabel } from '../library.js'
import { addComment, deleteComment, listComments, listPublished } from '../reading.js'

const NAME_KEY = 'petrichor-comment-name'
const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

function when(iso) {
  const d = new Date(iso)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return d.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

// ── asking to read ───────────────────────────────────────────────────────────

function Gate({ role, session, onAsked }) {
  const [name, setName] = useState(readName())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const intro = (
    <div className="mx-auto mt-10 max-w-md text-center">
      <h1 className="font-serif text-4xl italic text-ink">Read</h1>
      <p className="mt-3 text-muted">
        Chapters and poems, shared with friends. Reading is by invitation: sign in, ask, and you’ll be let in once
        you’re approved.
      </p>
    </div>
  )

  if (role === 'signedOut')
    return (
      <>
        {intro}
        <SignIn />
      </>
    )

  if (role === 'pending' || role === 'blocked')
    return (
      <div className="mx-auto mt-16 max-w-md rounded-sm border border-dashed border-line p-8 text-center">
        <p className="font-serif text-2xl italic text-ink">
          {role === 'pending' ? 'Your request is waiting.' : 'Reading isn’t open to this account.'}
        </p>
        <p className="mt-2 text-sm text-muted">
          {role === 'pending' ? 'You’ll be able to read here as soon as it’s approved. Nothing else to do.' : 'If you think that’s a mistake, get in touch directly.'}
        </p>
        <button onClick={signOut} className="mt-5 text-xs text-muted underline hover:text-fuchsia">
          sign out ({session?.user?.email})
        </button>
      </div>
    )

  return (
    <>
      {intro}
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          if (!name.trim()) return setError('Say who you are.')
          setBusy(true)
          setError(null)
          try {
            try {
              localStorage.setItem(NAME_KEY, name.trim())
            } catch {
              /* only a convenience */
            }
            await requestAccess({ name, note })
            onAsked()
          } catch (err) {
            setError(err.message)
            setBusy(false)
          }
        }}
        className="mx-auto mt-8 flex max-w-sm flex-col gap-3"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          className="w-full rounded-full border border-line bg-card px-5 py-3 text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
        />
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="A line to say how we know each other (optional)"
          aria-label="A note"
          className="w-full rounded-2xl border border-line bg-card px-5 py-3 text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
        />
        <button disabled={busy} className="rounded-full bg-fuchsia px-6 py-3 font-grotesk font-bold text-white disabled:opacity-60">
          {busy ? 'Asking…' : 'Ask to read'}
        </button>
        {error && <p className="text-center text-sm text-fuchsia">{error}</p>}
        <p className="text-center text-xs text-muted">
          Signed in as {session?.user?.email} ·{' '}
          <button type="button" onClick={signOut} className="underline hover:text-fuchsia">
            sign out
          </button>
        </p>
      </form>
    </>
  )
}

// ── comments ─────────────────────────────────────────────────────────────────

function Comments({ piece, session, isOwner }) {
  const [comments, setComments] = useState(null)
  const [name, setName] = useState(readName())
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setComments(null)
    listComments(piece.id).then(setComments, (e) => setError(e.message))
  }, [piece.id])

  async function post(e) {
    e.preventDefault()
    if (!name.trim() || !body.trim()) return setError('Add your name and a comment.')
    setBusy(true)
    setError(null)
    try {
      try {
        localStorage.setItem(NAME_KEY, name.trim())
      } catch {
        /* only a convenience */
      }
      const c = await addComment(piece.id, { name, body })
      setComments((cs) => [...(cs || []), c])
      setBody('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mx-auto mt-16 max-w-[40rem] border-t border-line pt-8" aria-label="Comments">
      <h3 className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.2em] text-muted">
        Comments{comments?.length ? ` · ${comments.length}` : ''}
      </h3>
      {comments === null && !error && <p className="mt-4 font-serif italic text-muted">…</p>}
      {comments?.length === 0 && <p className="mt-4 font-serif italic text-muted">No comments yet. Be the first.</p>}
      <ul className="mt-4 flex flex-col gap-5">
        {comments?.map((c) => (
          <li key={c.id} className="group">
            <p className="text-sm">
              <span className="font-bold text-body">{c.name}</span>
              <span className="ml-2 text-xs text-muted">{when(c.created_at)}</span>
              {(isOwner || c.user_id === session?.user?.id) && (
                <button
                  onClick={async () => {
                    await deleteComment(c.id)
                    setComments((cs) => cs.filter((x) => x.id !== c.id))
                  }}
                  aria-label="Delete comment"
                  className="ml-2 align-middle text-muted opacity-0 transition-opacity hover:text-fuchsia group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              )}
            </p>
            <p className="mt-1 whitespace-pre-wrap font-serif leading-relaxed text-body">{c.body}</p>
          </li>
        ))}
      </ul>

      <form onSubmit={post} className="mt-8 flex flex-col gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={60}
          className="w-full max-w-xs rounded-full border border-line bg-card px-4 py-2 text-sm text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          placeholder="Leave a comment…"
          aria-label="Your comment"
          maxLength={4000}
          className="w-full rounded-sm border border-line bg-card px-4 py-3 font-serif text-body placeholder:italic placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
        />
        <div>
          <button disabled={busy} className="rounded-full bg-fuchsia px-5 py-2 font-grotesk text-sm font-bold text-white disabled:opacity-60">
            {busy ? 'Posting…' : 'Post comment'}
          </button>
        </div>
        {error && <p className="text-sm text-fuchsia">{error}</p>}
      </form>
    </section>
  )
}

// ── reading ──────────────────────────────────────────────────────────────────

function Reader({ piece, heading, over, prev, next, onOpen, onBack, backLabel, session, isOwner }) {
  const verse = /<br\s*\/?>/.test(piece.body || '')
  useEffect(() => window.scrollTo({ top: 0 }), [piece.id])
  return (
    <article className="animate-rise">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fuchsia">
        <ArrowLeft size={15} /> {backLabel}
      </button>
      <div className="mx-auto mt-8 max-w-[40rem] rounded-[2px] bg-card px-6 py-12 sm:px-14 sm:py-16">
        <div className="mb-10 text-center">
          {over && <div className="font-grotesk text-[0.7rem] font-bold uppercase tracking-[0.3em] text-muted">{over}</div>}
          <h1 className="mt-3 font-serif text-3xl italic leading-tight text-ink sm:text-4xl">{heading}</h1>
          <div className="mx-auto mt-6 h-px w-12 bg-line" />
        </div>
        <div className={'book-preview ' + (verse ? 'is-verse' : 'is-prose')} dangerouslySetInnerHTML={{ __html: piece.body || '' }} />
      </div>
      {(prev || next) && (
        <nav className="mx-auto mt-6 flex max-w-[40rem] justify-between gap-4 text-sm">
          {prev ? (
            <button onClick={() => onOpen(prev)} className="inline-flex min-w-0 items-center gap-1 text-muted hover:text-fuchsia">
              <ChevronLeft size={16} className="shrink-0" /> <span className="truncate font-serif italic">{prev.label}</span>
            </button>
          ) : (
            <span />
          )}
          {next && (
            <button onClick={() => onOpen(next)} className="inline-flex min-w-0 items-center gap-1 text-muted hover:text-fuchsia">
              <span className="truncate font-serif italic">{next.label}</span> <ChevronRight size={16} className="shrink-0" />
            </button>
          )}
        </nav>
      )}
      <Comments piece={piece} session={session} isOwner={isOwner} />
    </article>
  )
}

/**
 * The reading room: what's been published, for approved friends (and for the owner,
 * to see it as they do). Everyone else is asked to sign in and request access.
 */
export default function Read({ role, session, refresh, openPieceId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [bookId, setBookId] = useState(null)
  const [pieceId, setPieceId] = useState(openPieceId || null)
  const canRead = role === 'owner' || role === 'reader'

  useEffect(() => {
    if (!canRead) return
    listPublished().then(setData, (e) => setError(e.message))
  }, [canRead])

  useEffect(() => {
    if (openPieceId) setPieceId(openPieceId)
  }, [openPieceId])

  if (role === undefined) return <p className="font-serif italic text-muted">One moment…</p>
  if (!canRead) return <Gate role={role} session={session} onAsked={refresh} />
  if (error) return <p className="text-sm text-fuchsia">{error}</p>
  if (!data) return <p className="font-serif italic text-muted">Opening the reading room…</p>

  // An open piece: a chapter (with its book around it) or a poem.
  if (pieceId) {
    const book = data.books.find((b) => b.chapters.some((c) => c.id === pieceId))
    if (book) {
      const chapters = numberContents(book.chapters).map((c) => ({ ...c, label: pieceLabel(c) }))
      const i = chapters.findIndex((c) => c.id === pieceId)
      const c = chapters[i]
      return (
        <Reader
          piece={c}
          heading={c.title?.trim() || pieceLabel(c)}
          over={bookTitle(book)}
          prev={chapters[i - 1]}
          next={chapters[i + 1]}
          onOpen={(p) => setPieceId(p.id)}
          onBack={() => {
            setPieceId(null)
            setBookId(book.id)
          }}
          backLabel={bookTitle(book)}
          session={session}
          isOwner={role === 'owner'}
        />
      )
    }
    const poem = data.poems.find((p) => p.id === pieceId)
    if (poem)
      return (
        <Reader
          piece={poem}
          heading={poem.title?.trim() || 'Untitled'}
          over="A poem"
          onOpen={() => {}}
          onBack={() => setPieceId(null)}
          backLabel="All reading"
          session={session}
          isOwner={role === 'owner'}
        />
      )
  }

  // A book's published chapters.
  const book = bookId && data.books.find((b) => b.id === bookId)
  if (book) {
    const chapters = numberContents(book.chapters)
    return (
      <section className="animate-rise">
        <button onClick={() => setBookId(null)} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fuchsia">
          <ArrowLeft size={15} /> All reading
        </button>
        <div className="mt-6 grid gap-10 md:grid-cols-[13rem_1fr]">
          <div className="mx-auto w-44 md:w-full">
            <BookCover work={book} size="lg" />
          </div>
          <div>
            <h1 className="font-serif text-4xl italic leading-tight text-ink">{bookTitle(book)}</h1>
            {book.subtitle && <p className="mt-1 font-serif text-lg italic text-muted">{book.subtitle}</p>}
            {book.author && <p className="mt-2 text-sm text-muted">by {book.author}</p>}
            {book.description && <p className="mt-5 max-w-xl whitespace-pre-wrap font-serif leading-relaxed text-body">{book.description}</p>}
            <ol className="mt-8 border-t border-line">
              {chapters.map((c) => (
                <li key={c.id} className="border-b border-line/60">
                  <button onClick={() => setPieceId(c.id)} className="group flex w-full items-baseline gap-3 py-3 text-left">
                    <span className="w-8 text-xs tabular-nums text-muted">{c.kind === 'part' ? '' : c.number}</span>
                    <span className="font-serif text-lg italic text-ink group-hover:text-fuchsia">{c.title?.trim() || pieceLabel(c)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    )
  }

  // Everything published.
  return (
    <section>
      <h1 className="font-serif text-4xl italic leading-tight text-ink sm:text-5xl">Read</h1>
      {role === 'owner' && (
        <p className="mt-2 text-sm text-muted">This is what your approved readers see: only what you’ve published.</p>
      )}
      {!data.books.length && !data.poems.length && (
        <p className="mt-10 font-serif text-lg italic text-muted">Nothing published yet.</p>
      )}
      {data.books.length > 0 && (
        <>
          <h2 className="mt-10 font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.2em] text-muted">Books</h2>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 md:grid-cols-4">
            {data.books.map((b) => (
              <li key={b.id}>
                <button onClick={() => setBookId(b.id)} className="group block w-full text-left">
                  <div className="transition-transform duration-300 group-hover:-translate-y-1.5">
                    <BookCover work={b} />
                  </div>
                  <div className="mt-3 font-serif text-lg italic leading-tight text-ink group-hover:text-fuchsia">{bookTitle(b)}</div>
                  <div className="mt-0.5 text-xs text-muted">
                    {b.chapters.length} {b.chapters.length === 1 ? 'chapter' : 'chapters'} to read
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {data.poems.length > 0 && (
        <>
          <h2 className="mt-12 font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.2em] text-muted">Poems</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {data.poems.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => setPieceId(p.id)}
                  className="group w-full rounded-sm border border-line bg-card/60 p-5 text-left transition-colors hover:border-fuchsia"
                >
                  <span className="block font-serif text-xl italic text-ink group-hover:text-fuchsia">{p.title?.trim() || 'Untitled'}</span>
                  <span className="mt-1 block text-xs text-muted">{when(p.published_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

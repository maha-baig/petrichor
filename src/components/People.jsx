import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { decideReader, listReaders, removeReader } from '../access.js'
import { deleteComment, markCommentsSeen, recentComments } from '../reading.js'

const STATUS = {
  pending: 'bg-amber/15 text-amber',
  approved: 'bg-fuchsia/10 text-fuchsia',
  blocked: 'bg-line text-muted',
}

function when(iso) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

const Heading = ({ children }) => (
  <h2 className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.2em] text-muted">{children}</h2>
)

const Btn = ({ children, ...props }) => (
  <button
    {...props}
    className="rounded-full border border-line px-3 py-1 text-xs text-body transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
  >
    {children}
  </button>
)

/** Who may read, and what they've said: the owner's side of publishing. */
export default function People({ onOpenPiece, onSeen }) {
  const [readers, setReaders] = useState(null)
  const [comments, setComments] = useState(null)
  const [fresh, setFresh] = useState(new Set()) // unseen when this page opened
  const [error, setError] = useState(null)

  useEffect(() => {
    listReaders().then(setReaders, (e) => setError(e.message))
    recentComments().then(
      (cs) => {
        setComments(cs)
        const unseen = cs.filter((c) => !c.seen_at).map((c) => c.id)
        setFresh(new Set(unseen))
        markCommentsSeen(unseen).then(onSeen, () => {})
      },
      (e) => setError(e.message),
    )
  }, [])

  async function decide(r, status) {
    try {
      await decideReader(r.user_id, status)
      setReaders((rs) => rs.map((x) => (x.user_id === r.user_id ? { ...x, status } : x)))
    } catch (e) {
      setError(e.message)
    }
  }

  async function remove(r) {
    if (!confirm(`Remove ${r.name || r.email}? They'll have to ask again to read.`)) return
    try {
      await removeReader(r.user_id)
      setReaders((rs) => rs.filter((x) => x.user_id !== r.user_id))
    } catch (e) {
      setError(e.message)
    }
  }

  const order = { pending: 0, approved: 1, blocked: 2 }
  const sorted = [...(readers || [])].sort((a, b) => order[a.status] - order[b.status])

  return (
    <section>
      <h1 className="font-serif text-4xl italic leading-tight text-ink sm:text-5xl">Readers &amp; comments</h1>
      <p className="mt-2 text-sm text-muted">
        Friends sign in on the Read page and ask. Only the ones you approve can see what you’ve published.
      </p>
      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}

      <div className="mt-10">
        <Heading>Readers{readers?.length ? ` · ${readers.length}` : ''}</Heading>
        {readers === null && !error && <p className="mt-4 font-serif italic text-muted">…</p>}
        {readers?.length === 0 && <p className="mt-4 font-serif italic text-muted">No one has asked yet.</p>}
        <ul className="mt-4 divide-y divide-line/60 border-y border-line/60">
          {sorted.map((r) => (
            <li key={r.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-body">
                  <span className="font-bold">{r.name || '—'}</span>
                  <span className="ml-2 text-xs text-muted">{r.email}</span>
                  <span className={'ml-2 rounded-full px-2 py-0.5 text-xs ' + STATUS[r.status]}>{r.status}</span>
                </p>
                {r.note && <p className="mt-0.5 font-serif text-sm italic text-muted">“{r.note}”</p>}
              </div>
              <div className="flex items-center gap-2">
                {r.status !== 'approved' && <Btn onClick={() => decide(r, 'approved')}>Approve</Btn>}
                {r.status !== 'blocked' && <Btn onClick={() => decide(r, 'blocked')}>Block</Btn>}
                <button onClick={() => remove(r)} aria-label="Remove" className="p-1 text-muted hover:text-fuchsia">
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-12">
        <Heading>Comments{comments?.length ? ` · ${comments.length}` : ''}</Heading>
        {comments === null && !error && <p className="mt-4 font-serif italic text-muted">…</p>}
        {comments?.length === 0 && <p className="mt-4 font-serif italic text-muted">No comments yet.</p>}
        <ul className="mt-4 flex flex-col gap-4">
          {comments?.map((c) => (
            <li
              key={c.id}
              className={'rounded-sm border p-4 ' + (fresh.has(c.id) ? 'border-fuchsia/50 bg-fuchsia/5' : 'border-line')}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <p>
                  <span className="font-bold text-body">{c.name}</span>
                  <span className="ml-2 text-xs text-muted">on </span>
                  <button
                    onClick={() => onOpenPiece(c.piece_id)}
                    className="font-serif italic text-body underline decoration-line underline-offset-2 hover:text-fuchsia"
                  >
                    {c.pieces?.title?.trim() || 'Untitled'}
                  </button>
                  {c.pieces?.works?.kind === 'book' && c.pieces.works.title && (
                    <span className="text-xs text-muted"> · {c.pieces.works.title}</span>
                  )}
                  {fresh.has(c.id) && <span className="ml-2 text-xs text-fuchsia">new</span>}
                </p>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {when(c.created_at)}
                  <button
                    onClick={async () => {
                      await deleteComment(c.id)
                      setComments((cs) => cs.filter((x) => x.id !== c.id))
                    }}
                    aria-label="Delete comment"
                    className="hover:text-fuchsia"
                  >
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap font-serif leading-relaxed text-body">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

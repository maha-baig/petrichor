import { useEffect, useState } from 'react'
import { FolderPlus, Plus } from 'lucide-react'
import { createPoem, createPoemCollection, htmlToText, listPoems } from '../library.js'

function when(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

const STATUS_DOT = { draft: 'bg-line', revising: 'bg-amber', final: 'bg-fuchsia' }

/** The first few lines of a poem, as it would be recognised. */
const opening = (body) =>
  htmlToText(body)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .slice(0, 3)

/** Her poems: every one on a card, filterable by collection. */
export default function Poems({ onOpen }) {
  const [data, setData] = useState(null) // { collections, poems }
  const [filter, setFilter] = useState('all')
  const [busy, setBusy] = useState(false)
  const [naming, setNaming] = useState(false)
  const [error, setError] = useState(null)

  const load = () =>
    listPoems()
      .then(setData)
      .catch((e) => {
        setError(e.message)
        setData({ collections: [], poems: [] })
      })

  useEffect(() => {
    load()
  }, [])

  async function newPoem() {
    setBusy(true)
    setError(null)
    try {
      const poem = await createPoem({ workId: filter !== 'all' ? filter : undefined })
      onOpen(poem)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  async function newCollection(title) {
    setNaming(false)
    if (!title.trim()) return
    try {
      const c = await createPoemCollection(title)
      await load()
      setFilter(c.id)
    } catch (e) {
      setError(e.message)
    }
  }

  const collections = data?.collections || []
  const byId = Object.fromEntries(collections.map((c) => [c.id, c]))
  const poems = (data?.poems || []).filter((p) => filter === 'all' || p.work_id === filter)

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-4xl italic leading-tight text-ink sm:text-5xl">Your poems</h1>
        <button
          onClick={newPoem}
          disabled={busy || !data}
          className="inline-flex items-center gap-1.5 rounded-full bg-fuchsia px-5 py-2 font-grotesk text-sm font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
        >
          <Plus size={15} /> {busy ? 'Opening…' : 'New poem'}
        </button>
      </div>

      {/* Collections: a way to group, never a requirement. */}
      {data && (
        <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          {[{ id: 'all', title: 'All' }, ...collections].map((c) => (
            <button
              key={c.id}
              onClick={() => setFilter(c.id)}
              className={
                'rounded-full border px-3 py-1 transition-colors ' +
                (filter === c.id ? 'border-fuchsia bg-fuchsia/10 text-fuchsia' : 'border-line text-muted hover:text-body')
              }
            >
              {c.title || 'Untitled collection'}
            </button>
          ))}
          {naming ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                newCollection(new FormData(e.currentTarget).get('title') || '')
              }}
            >
              <input
                name="title"
                autoFocus
                placeholder="Collection name"
                onBlur={(e) => newCollection(e.target.value)}
                className="rounded-full border border-fuchsia bg-card px-3 py-1 text-sm text-body focus:outline-none"
              />
            </form>
          ) : (
            <button onClick={() => setNaming(true)} className="inline-flex items-center gap-1 px-2 text-muted hover:text-fuchsia">
              <FolderPlus size={14} /> collection
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-6 max-w-2xl text-sm text-fuchsia">{error}</p>}
      {!data && !error && <p className="mt-10 font-serif italic text-muted">Gathering your poems…</p>}

      {data && poems.length === 0 && (
        <div className="mt-8 rounded-sm border border-dashed border-line p-10 text-center">
          <p className="font-serif text-lg italic text-muted">No poems here yet.</p>
          <p className="mt-1 text-sm text-muted">Start one, or find a way in from Inspiration.</p>
        </div>
      )}

      {poems.length > 0 && (
        <ul className="stagger mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {poems.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => onOpen(p)}
                className="group flex h-full w-full flex-col rounded-sm border border-line bg-card/60 p-5 text-left transition-colors hover:border-fuchsia"
              >
                <span className="flex items-center gap-2">
                  <span className={'h-1.5 w-1.5 rounded-full ' + STATUS_DOT[p.status]} title={p.status} />
                  <span className="truncate font-serif text-xl italic text-ink group-hover:text-fuchsia">
                    {p.title?.trim() || 'Untitled poem'}
                  </span>
                </span>
                <span className="mt-3 whitespace-pre-wrap font-serif text-sm leading-relaxed text-muted">
                  {opening(p.body).join('\n') || 'An empty page.'}
                </span>
                <span className="mt-auto flex flex-wrap items-center gap-x-2 pt-4 text-xs text-muted">
                  {p.published_at && <span className="rounded-full bg-fuchsia/10 px-2 py-0.5 text-fuchsia">Published</span>}
                  {collections.length > 1 && <span>{byId[p.work_id]?.title}</span>}
                  <span>{when(p.updated_at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

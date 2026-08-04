import { useEffect, useState } from 'react'
import { listWorkspaces, deleteWorkspace, workspaceTitle } from '../store.js'
import { downloadWorkspaceZip } from '../download.js'
import { Reveal } from '../motion.jsx'

function when(iso) {
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return d.toLocaleDateString()
}

// The first few tiles of the board, as a glimpse of what's inside.
function Thumbs({ images }) {
  if (!images?.length) {
    return (
      <div className="flex h-24 items-center justify-center rounded-sm border border-dashed border-line text-xs text-muted">
        no images yet
      </div>
    )
  }
  return (
    <div className="flex h-24 gap-1.5 overflow-hidden">
      {images.slice(0, 4).map((im) => (
        <div
          key={im.id}
          className="h-24 flex-1 rounded-sm border border-line bg-cover bg-center"
          style={{ backgroundImage: `url("${im.img}")` }}
        />
      ))}
      {images.length > 4 && (
        <div className="flex h-24 w-12 shrink-0 items-center justify-center rounded-sm border border-line text-xs text-muted">
          +{images.length - 4}
        </div>
      )}
    </div>
  )
}

export default function Workspaces({ onOpen, onNew }) {
  const [items, setItems] = useState(null)
  const [confirming, setConfirming] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)

  async function refresh() {
    setItems(await listWorkspaces())
  }

  useEffect(() => {
    refresh()
  }, [])

  async function remove(id) {
    await deleteWorkspace(id)
    setConfirming(null)
    refresh()
  }

  async function zip(ws) {
    setBusy(ws.id)
    setError(null)
    try {
      await downloadWorkspaceZip(ws)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section>
      <Reveal order={0} className="mb-5 flex items-center gap-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-fuchsia" />
        <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
          Workspaces
        </span>
      </Reveal>
      <Reveal
        as="h1"
        order={1}
        className="font-serif text-4xl font-normal italic leading-[0.95] tracking-tight text-ink sm:text-5xl"
      >
        Everything you've begun
      </Reveal>
      <Reveal as="p" order={2} className="mt-4 max-w-xl text-muted">
        Each prompt you choose keeps its own room — its words, the images you gathered, the poem
        that came of it. Nothing here leaves your browser.
      </Reveal>

      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}

      {items === null && <p className="mt-10 font-serif italic text-muted">Opening the drawer…</p>}

      {items?.length === 0 && (
        <div className="mt-10 rounded-sm border border-dashed border-line p-10 text-center">
          <p className="font-serif text-lg italic text-muted">Nothing kept yet.</p>
          <button
            onClick={onNew}
            className="mt-4 rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02]"
          >
            Find a prompt
          </button>
        </div>
      )}

      {items?.length > 0 && (
        <div className="mt-10 grid gap-5 sm:grid-cols-2">
          {items.map((ws) => (
            <article
              key={ws.id}
              className="group flex flex-col rounded-sm border border-line bg-card/40 p-5 transition-colors hover:border-fuchsia/60"
            >
              <button onClick={() => onOpen(ws.id)} className="text-left">
                <h2 className="font-serif text-xl italic leading-snug text-ink">
                  {workspaceTitle(ws)}
                </h2>
                <p className="mt-1 font-grotesk text-[0.7rem] font-bold uppercase tracking-[0.18em] text-muted">
                  {ws.mood} · {when(ws.updatedAt)}
                </p>
                <div className="mt-4">
                  <Thumbs images={ws.images} />
                </div>
                {ws.poem?.trim() ? (
                  <p className="mt-4 line-clamp-3 whitespace-pre-line font-serif text-sm italic leading-relaxed text-muted">
                    {ws.poem.trim().slice(0, 180)}
                  </p>
                ) : (
                  <p className="mt-4 text-sm text-muted/70">no poem yet</p>
                )}
              </button>

              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button
                  onClick={() => onOpen(ws.id)}
                  className="rounded-full border border-line px-3 py-1 text-xs text-body transition-colors hover:border-fuchsia hover:text-fuchsia"
                >
                  open
                </button>
                <button
                  onClick={() => zip(ws)}
                  disabled={busy === ws.id}
                  className="rounded-full border border-line px-3 py-1 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
                >
                  {busy === ws.id ? 'zipping…' : 'download'}
                </button>
                <span className="ml-auto">
                  {confirming === ws.id ? (
                    <span className="flex items-center gap-2 text-xs">
                      <span className="text-muted">delete for good?</span>
                      <button
                        onClick={() => remove(ws.id)}
                        className="rounded-full bg-fuchsia px-3 py-1 font-bold text-white"
                      >
                        yes
                      </button>
                      <button onClick={() => setConfirming(null)} className="text-muted underline">
                        no
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirming(ws.id)}
                      className="rounded-full border border-transparent px-3 py-1 text-xs text-muted opacity-0 transition-opacity hover:text-fuchsia group-hover:opacity-100"
                    >
                      delete
                    </button>
                  )}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

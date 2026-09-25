import { useEffect, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import { notionOutline, notionStatus, searchNotion } from '../notionImport.js'

function when(iso) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Pick a Notion page. `onPick(page)` does the importing; `verb` names it
 * ("Import as a book", "Add as chapters").
 */
export default function NotionPicker({ onPick, onClose, verb = 'Import' }) {
  const [status, setStatus] = useState(null) // { connected, reason }
  const [query, setQuery] = useState('')
  const [pages, setPages] = useState(null)
  const [error, setError] = useState(null)
  const timer = useRef(null)
  // Step two: a page with sub-pages, and which of them to bring in.
  const [outline, setOutline] = useState(null) // { page, subpages, hasText }
  const [chosen, setChosen] = useState(new Set())
  const [withText, setWithText] = useState(false)
  const [loadingPage, setLoadingPage] = useState(null)

  // Chapters look like chapters; notes (Summary, Characters, Inspiration…) don't.
  const looksLikeChapter = (t) => /^(prologue|epilogue|interlude|part\b|chapter\b|book\b|act\b|\d+[.:)]?\s)/i.test(t.trim())

  async function choose(page) {
    setError(null)
    setLoadingPage(page.id)
    try {
      const o = await notionOutline(page.id)
      if (!o.subpages.length) return onPick(page, {})
      setOutline({ page, subpages: o.subpages, hasText: o.hasText })
      setChosen(new Set(o.subpages.filter((s) => looksLikeChapter(s.title)).map((s) => s.id)))
      setWithText(false)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoadingPage(null)
    }
  }

  useEffect(() => {
    notionStatus().then(setStatus)
  }, [])

  // Search as she types, a beat after she stops.
  useEffect(() => {
    if (!status?.connected) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setError(null)
      searchNotion(query)
        .then(setPages)
        .catch((e) => setError(e.message))
    }, 300)
    return () => clearTimeout(timer.current)
  }, [query, status])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 px-4 pt-[10vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Import from Notion"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[75vh] w-full max-w-xl flex-col rounded-sm border border-line bg-paper shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-serif text-2xl italic text-ink">Import from Notion</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:text-fuchsia">
            <X size={18} />
          </button>
        </div>

        {status === null && <p className="px-5 py-6 font-serif italic text-muted">Checking Notion…</p>}

        {status && !status.connected && (
          <div className="px-5 py-6 text-sm text-body">
            <p className="text-fuchsia">{status.reason}</p>
            <p className="mt-4 text-muted">
              Notion connects through a private integration, set up once on the server. See “Notion” in the
              README for the three steps.
            </p>
          </div>
        )}

        {status?.connected && outline && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="px-5 pt-4">
              <button onClick={() => setOutline(null)} className="text-xs text-muted hover:text-fuchsia">
                ← all pages
              </button>
              <p className="mt-2 font-serif text-xl italic text-ink">{outline.page.title}</p>
              <p className="mt-1 text-xs text-muted">
                Tick the pages that should become chapters, in this order. Notes can stay behind.
              </p>
              <div className="mt-2 flex gap-3 text-xs">
                <button onClick={() => setChosen(new Set(outline.subpages.map((s) => s.id)))} className="text-muted underline hover:text-fuchsia">
                  all
                </button>
                <button onClick={() => setChosen(new Set())} className="text-muted underline hover:text-fuchsia">
                  none
                </button>
              </div>
            </div>
            <ul className="mt-2 min-h-0 flex-1 overflow-auto px-3 pb-2">
              {outline.hasText && (
                <li>
                  <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-body/5">
                    <input type="checkbox" checked={withText} onChange={(e) => setWithText(e.target.checked)} className="accent-fuchsia" />
                    <span className="text-sm italic text-muted">The text on the page itself, as an opening</span>
                  </label>
                </li>
              )}
              {outline.subpages.map((s, i) => (
                <li key={s.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-sm px-2 py-2 hover:bg-body/5">
                    <input
                      type="checkbox"
                      checked={chosen.has(s.id)}
                      onChange={(e) =>
                        setChosen((c) => {
                          const n = new Set(c)
                          e.target.checked ? n.add(s.id) : n.delete(s.id)
                          return n
                        })
                      }
                      className="accent-fuchsia"
                    />
                    <span className="w-5 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                    <span className="font-serif italic text-body">{s.title}</span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-end gap-3 border-t border-line px-5 py-3">
              <span className="text-xs text-muted">
                {chosen.size + (withText ? 1 : 0)} {chosen.size + (withText ? 1 : 0) === 1 ? 'chapter' : 'chapters'}
              </span>
              <button
                disabled={!chosen.size && !withText}
                onClick={() =>
                  onPick(outline.page, {
                    only: outline.subpages.filter((s) => chosen.has(s.id)).map((s) => s.id),
                    includeText: withText,
                  })
                }
                className="rounded-full bg-fuchsia px-5 py-2 font-grotesk text-sm font-bold text-white disabled:opacity-50"
              >
                {verb}
              </button>
            </div>
          </div>
        )}

        {status?.connected && !outline && (
          <>
            <div className="px-5 pt-4">
              <label className="flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 focus-within:border-fuchsia">
                <Search size={15} className="text-muted" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search your Notion pages"
                  aria-label="Search your Notion pages"
                  className="w-full bg-transparent text-body placeholder:text-muted/60 focus:outline-none"
                />
              </label>
              <p className="mt-2 text-xs text-muted">
                Only pages you’ve shared with Petrichor show here. In Notion: ••• → Connections → Petrichor.
                Sub-pages become chapters.
              </p>
            </div>
            {error && <p className="px-5 pt-3 text-sm text-fuchsia">{error}</p>}
            <ul className="mt-3 min-h-0 flex-1 overflow-auto px-2 pb-3">
              {pages === null && !error && <li className="px-3 py-4 font-serif italic text-muted">Looking…</li>}
              {pages?.length === 0 && (
                <li className="px-3 py-4 text-sm text-muted">
                  {query ? 'No pages match.' : 'No pages shared with Petrichor yet.'}
                </li>
              )}
              {pages?.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => choose(p)}
                    disabled={!!loadingPage}
                    className="group flex w-full items-center gap-3 rounded-sm px-3 py-2.5 text-left transition-colors hover:bg-body/5"
                  >
                    <span className="w-6 shrink-0 text-center text-lg">{p.icon || '📄'}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-serif text-lg italic text-ink group-hover:text-fuchsia">{p.title}</span>
                      <span className="block text-xs text-muted">edited {when(p.edited)}</span>
                    </span>
                    <span className="shrink-0 rounded-full border border-line px-3 py-1 text-xs text-muted group-hover:border-fuchsia group-hover:text-fuchsia">
                      {loadingPage === p.id ? 'Opening…' : verb}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { BookPlus } from 'lucide-react'
import { bookTitle, listWorks } from '../library.js'

/**
 * "Move to book": pick a book, and the writing goes in as its last chapter.
 * `canMove` offers moving it out entirely; otherwise it's always a copy.
 * onPick(workId, { keep }) does the work and returns a message to show.
 */
export default function ToBook({ onPick, canMove = false, label = 'Move to book', className = '' }) {
  const [open, setOpen] = useState(false)
  const [books, setBooks] = useState(null)
  const [keep, setKeep] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const box = useRef(null)

  useEffect(() => {
    if (!open) return
    listWorks().then(setBooks, () => setBooks([]))
    const close = (e) => !box.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  async function pick(w) {
    setBusy(true)
    try {
      const done = await onPick(w.id, { keep: !canMove || keep, title: bookTitle(w) })
      setMsg(done || `Added to “${bookTitle(w)}”.`)
      setOpen(false)
      setTimeout(() => setMsg(null), 3500)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span ref={box} className="relative inline-flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={
          'inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia ' +
          className
        }
      >
        <BookPlus size={13} /> {label}
      </button>
      {msg && !open && <span className="ml-2 text-xs text-fuchsia">{msg}</span>}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-sm border border-line bg-paper p-1.5 text-left shadow-xl">
          <p className="px-3 py-2 text-xs text-muted">Add as the last chapter of…</p>
          {books === null && <p className="px-3 py-2 font-serif text-sm italic text-muted">…</p>}
          {books?.length === 0 && <p className="px-3 py-2 text-sm text-muted">No books yet. Make one in Books first.</p>}
          <div className="max-h-64 overflow-y-auto">
            {books?.map((w) => (
              <button
                key={w.id}
                disabled={busy}
                onClick={() => pick(w)}
                className="block w-full truncate rounded-sm px-3 py-2 text-left font-serif text-sm italic text-body hover:bg-body/5 hover:text-fuchsia disabled:opacity-50"
              >
                {bookTitle(w)}
                {w.genre && <span className="ml-2 font-sans text-xs not-italic text-muted">{w.genre}</span>}
              </button>
            ))}
          </div>
          {canMove && (
            <label className="mt-1 flex items-center gap-2 border-t border-line px-3 pb-1 pt-2 text-xs text-muted">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-fuchsia" />
              Keep a copy in Poems
            </label>
          )}
        </div>
      )}
    </span>
  )
}

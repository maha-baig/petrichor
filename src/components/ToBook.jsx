import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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
  const menu = useRef(null)
  const [pos, setPos] = useState(null) // where the menu sits on screen

  useEffect(() => {
    if (!open) return
    listWorks().then(setBooks, () => setBooks([]))
    const inside = (t) => box.current?.contains(t) || menu.current?.contains(t)
    const close = (e) => !inside(e.target) && setOpen(false)
    // It's pinned to the screen, so it closes when what's under it moves.
    const scrolled = (e) => !menu.current?.contains(e.target) && setOpen(false)
    document.addEventListener('pointerdown', close)
    window.addEventListener('scroll', scrolled, true)
    window.addEventListener('resize', scrolled)
    return () => {
      document.removeEventListener('pointerdown', close)
      window.removeEventListener('scroll', scrolled, true)
      window.removeEventListener('resize', scrolled)
    }
  }, [open])

  // Below the button, right edges aligned, but never past either side of the screen:
  // the button can sit in a toolbar that scrolls sideways on a phone.
  useLayoutEffect(() => {
    if (!open) return setPos(null)
    const r = box.current.getBoundingClientRect()
    const width = Math.min(256, window.innerWidth - 32)
    const left = Math.max(16, Math.min(r.right - width, window.innerWidth - 16 - width))
    setPos({ top: r.bottom + 8, left, width })
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
          'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia ' +
          className
        }
      >
        <BookPlus size={13} /> {label}
      </button>
      {msg && !open && <span className="ml-2 whitespace-nowrap text-xs text-fuchsia">{msg}</span>}
      {open &&
        pos &&
        createPortal(
          <div ref={menu} style={pos} className="fixed z-[60] rounded-sm border border-line bg-paper p-1.5 text-left shadow-xl">
            <p className="px-3 py-2 text-xs text-muted">Add as the last chapter of…</p>
            {books === null && <p className="px-3 py-2 font-serif text-sm italic text-muted">…</p>}
            {books?.length === 0 && <p className="px-3 py-2 text-sm text-muted">No books yet. Make one in Books first.</p>}
            <div className="max-h-64 overflow-y-auto">
              {books?.map((w) => (
                <button
                  key={w.id}
                  disabled={busy}
                  onClick={() => pick(w)}
                  className="block w-full truncate rounded-sm min-h-[40px] px-3 py-2 text-left font-serif text-sm italic text-body hover:bg-body/5 hover:text-fuchsia disabled:opacity-50 sm:min-h-0"
                >
                  {bookTitle(w)}
                  {w.genre && <span className="ml-2 font-sans text-xs not-italic text-muted">{w.genre}</span>}
                </button>
              ))}
            </div>
            {canMove && (
              <label className="mt-1 flex items-center gap-2 border-t border-line px-3 pb-2 pt-3 text-xs text-muted sm:pb-1 sm:pt-2">
                <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="accent-fuchsia" />
                Keep a copy in Poems
              </label>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}

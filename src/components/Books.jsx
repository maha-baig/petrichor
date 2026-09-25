import { useEffect, useRef, useState } from 'react'
import { DownloadCloud, Plus, Upload } from 'lucide-react'
import { useSession } from '../auth.jsx'
import BookCover from './BookCover.jsx'
import { bookTitle, createWork, listWorks } from '../library.js'
import { BACKUP_EVERY_DAYS, daysSince, downloadBackup, lastBackupAt, restoreBackup } from '../backup.js'

const fmt = (n) => Number(n || 0).toLocaleString()

/** Her shelf: every book as its cover, and an empty slot for the next one. */
export default function Books({ onOpen }) {
  const session = useSession()
  const [works, setWorks] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [lastBackup, setLastBackup] = useState(undefined) // undefined = still asking
  const [backup, setBackup] = useState(null) // progress text while backing up or restoring
  const [notice, setNotice] = useState(null)
  const [restoreFile, setRestoreFile] = useState(null) // chosen, awaiting confirmation
  const fileInput = useRef(null)

  function load() {
    return listWorks().then(setWorks)
  }

  useEffect(() => {
    if (!session) return
    let alive = true
    load().catch((e) => {
      if (!alive) return
      setError(e.message)
      setWorks([])
    })
    lastBackupAt()
      .then((at) => alive && setLastBackup(at))
      .catch(() => alive && setLastBackup(null))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  async function backUp() {
    setError(null)
    setNotice(null)
    setBackup('Starting…')
    try {
      const c = await downloadBackup(setBackup)
      setLastBackup(new Date().toISOString())
      setNotice(
        `Backed up ${c.books} ${c.books === 1 ? 'book' : 'books'}, ${c.chapters} chapters and ${c.versions} saved versions. Keep the zip somewhere other than this computer: iCloud Drive, Google Drive, or a USB stick.`,
      )
    } catch (e) {
      setError(`The backup didn't finish: ${e.message}`)
    } finally {
      setBackup(null)
    }
  }

  async function restore() {
    const file = restoreFile
    setRestoreFile(null)
    setError(null)
    setNotice(null)
    setBackup('Starting…')
    try {
      const c = await restoreBackup(file, setBackup)
      await load()
      setNotice(`Restored ${c.books} ${c.books === 1 ? 'book' : 'books'} (${c.chapters} chapters, ${c.versions} saved versions) as new copies.`)
    } catch (e) {
      setError(`The restore didn't finish: ${e.message}`)
    } finally {
      setBackup(null)
    }
  }

  // Nudge once there's writing worth keeping and no recent backup.
  const hasWriting = works?.some((w) => w.words > 0)
  const age = daysSince(lastBackup)
  const overdue = hasWriting && lastBackup !== undefined && (age === null || age >= BACKUP_EVERY_DAYS)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const work = await createWork()
      onOpen(work.id)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-4xl italic leading-tight text-ink sm:text-5xl">Your books</h1>
        {works && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={backUp}
              disabled={!!backup || !works.length}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm text-body transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-50"
            >
              <DownloadCloud size={15} /> Back up all books
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".zip,.json,application/zip,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) setRestoreFile(f)
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              disabled={!!backup}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm text-muted transition-colors hover:text-fuchsia disabled:opacity-50"
            >
              <Upload size={15} /> Restore from backup
            </button>
          </div>
        )}
      </div>

      {works && lastBackup !== undefined && (
        <p className="mt-2 text-xs text-muted">
          {lastBackup
            ? `Last backup ${age === 0 ? 'today' : age === 1 ? 'yesterday' : `${age} days ago`}.`
            : 'No backup yet.'}
        </p>
      )}

      {overdue && !backup && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-sm border border-amber/50 bg-amber/10 px-4 py-3 text-sm text-body">
          <span className="flex-1">
            {age === null
              ? 'You haven’t backed up your books yet. Keep a copy of your own, off this computer.'
              : `It’s been ${age} days since your last backup.`}
          </span>
          <button onClick={backUp} className="rounded-full bg-fuchsia px-4 py-1.5 font-grotesk text-xs font-bold text-white">
            Back up now
          </button>
        </div>
      )}

      {restoreFile && (
        <div className="mt-5 rounded-sm border border-line bg-card/60 px-4 py-3 text-sm text-body">
          <p>
            Restore from <span className="font-medium">{restoreFile.name}</span>? The books in it come back as new
            copies. Nothing already on your shelf is changed or removed.
          </p>
          <div className="mt-3 flex gap-2">
            <button onClick={restore} className="rounded-full bg-fuchsia px-4 py-1.5 font-grotesk text-xs font-bold text-white">
              Restore
            </button>
            <button onClick={() => setRestoreFile(null)} className="rounded-full px-3 py-1.5 text-xs text-muted hover:text-body">
              Cancel
            </button>
          </div>
        </div>
      )}

      {backup && (
        <p className="mt-5 font-serif italic text-muted" role="status">
          {backup}
        </p>
      )}
      {notice && <p className="mt-5 max-w-2xl text-sm text-body">{notice}</p>}
      {error && <p className="mt-6 max-w-2xl text-sm text-fuchsia">{error}</p>}
      {works === null && !error && <p className="mt-10 font-serif italic text-muted">Taking down the books…</p>}

      {works && (
        <ul className="stagger mt-10 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 md:grid-cols-4">
          {works.map((w) => (
            <li key={w.id}>
              <button onClick={() => onOpen(w.id)} className="group block w-full text-left">
                <div className="transition-transform duration-300 group-hover:-translate-y-1.5">
                  <BookCover work={w} />
                </div>
                <div className="mt-3 font-serif text-lg italic leading-tight text-ink group-hover:text-fuchsia">
                  {bookTitle(w)}
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  {w.chapters} {w.chapters === 1 ? 'chapter' : 'chapters'} · {fmt(w.words)} words
                </div>
              </button>
            </li>
          ))}

          {/* A new book sits on the shelf as an empty slot. */}
          <li>
            <button
              onClick={start}
              disabled={busy}
              className="group flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-[3px] border border-dashed border-line text-muted transition-colors hover:border-fuchsia hover:text-fuchsia disabled:opacity-60"
            >
              <Plus size={26} strokeWidth={1.5} />
              <span className="font-grotesk text-sm font-bold">{busy ? 'Opening…' : 'New book'}</span>
            </button>
          </li>
        </ul>
      )}
    </section>
  )
}

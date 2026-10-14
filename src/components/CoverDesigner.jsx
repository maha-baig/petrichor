import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ImagePlus, Search, X } from 'lucide-react'
import { searchImages } from '../api.js'
import { listWorkspaces } from '../store.js'
import { uploadCover } from '../library.js'
import { COVER_H, COVER_W, INKS, canvasJpeg, defaultDesign, loadImage, paintCover, pictureBox } from '../coverArt.js'

const COLORS = ['#2a1f2d', '#1f2a2a', '#3a2418', '#1d2438', '#33202a', '#23301f', '#6b1d3a', '#c9bfae']

function Toggle({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={
            'rounded-full border px-3.5 py-2 text-xs transition-colors sm:py-1 ' +
            (value === v ? 'border-fuchsia bg-fuchsia text-white' : 'border-line text-muted hover:text-body')
          }
        >
          {l}
        </button>
      ))}
    </div>
  )
}

// A fixed label column, so every control starts on the same line.
function Row({ label, children }) {
  return (
    <div className="flex items-center gap-4 text-sm">
      <span className="w-16 shrink-0 text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Swatches({ colors, value, onChange, label }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`${label} ${c}`}
          className={
            'h-8 w-8 rounded-full border transition-transform hover:scale-110 sm:h-6 sm:w-6 ' +
            (value.toLowerCase() === c ? 'border-fuchsia ring-2 ring-fuchsia/40' : 'border-line')
          }
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Any ${label}`}
        className="h-8 w-8 cursor-pointer rounded-full border border-line bg-transparent p-0 sm:h-6 sm:w-6"
      />
    </div>
  )
}

/**
 * Make a cover: a picture (her own, one from a mood board, or a licensed find),
 * framed by dragging, with the book's words set over it — or no picture at
 * all, just the words on a colour. Saved as the cover readers see.
 */
export default function CoverDesigner({ work, onSaved, onClose }) {
  const [d, setD] = useState(() => defaultDesign(work))
  const set = (patch) => setD((x) => ({ ...x, ...patch }))
  const [credit, setCredit] = useState(work.coverUrl ? work.cover_credit || '' : '')
  const [source, setSource] = useState('upload') // upload | boards | search
  const [boards, setBoards] = useState(null) // [{ id, img, board }]
  const [term, setTerm] = useState('')
  const [found, setFound] = useState(null) // search results
  const [busy, setBusy] = useState(null) // what's happening, as words
  const [error, setError] = useState(null)
  const canvasRef = useRef(null)
  const fileRef = useRef(null)
  const drag = useRef(null)

  // Opening on an existing cover: that picture, as it is.
  useEffect(() => {
    if (!work.coverUrl) return
    loadImage(work.coverUrl).then(
      (image) => setD((x) => (x.image ? x : { ...x, image, words: false })),
      () => {},
    )
  }, [work.coverUrl])

  useEffect(() => {
    const c = canvasRef.current
    if (c) paintCover(c.getContext('2d'), COVER_W, COVER_H, d)
  }, [d])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function takePicture(src, { from = '', words } = {}) {
    setError(null)
    setBusy('Opening the picture…')
    try {
      const image = await loadImage(src)
      setD((x) => ({ ...x, image, zoom: 1, focus: { x: 0.5, y: 0.5 }, shade: x.words ? Math.max(x.shade, 0.15) : x.shade, ...(words === undefined ? {} : { words }) }))
      setCredit(from)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(null)
    }
  }

  function takeFile(file) {
    if (!file) return
    if (!file.type.startsWith('image/')) return setError('A cover has to be an image.')
    if (file.size > 20 * 1024 * 1024) return setError('That image is over 20 MB. Try a smaller one.')
    const url = URL.createObjectURL(file)
    takePicture(url).finally(() => URL.revokeObjectURL(url)) // drawn from the decoded image from here on
  }

  // Paste a picture from anywhere while the designer is open.
  useEffect(() => {
    const onPaste = (e) => {
      const f = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'))?.getAsFile()
      if (f) {
        e.preventDefault()
        takeFile(f)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openBoards() {
    setSource('boards')
    if (boards) return
    listWorkspaces()
      .then((ws) => setBoards(ws.flatMap((w) => (w.images || []).filter((i) => i.img).map((i) => ({ id: `${w.id}-${i.id}`, img: i.img, board: w.title })))))
      .catch((e) => {
        setBoards([])
        setError(e.message)
      })
  }

  async function search(e) {
    e.preventDefault()
    if (!term.trim()) return
    setError(null)
    setFound(null)
    setBusy('Looking…')
    try {
      setFound((await searchImages({ term, count: 18 })).results)
    } catch (err) {
      setError(err.message)
      setFound([])
    } finally {
      setBusy(null)
    }
  }

  // ── framing the picture by dragging it ─────────────────────────────────────
  function toCover(e) {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * COVER_W, y: ((e.clientY - r.top) / r.height) * COVER_H }
  }
  function onPointerDown(e) {
    if (!d.image) return
    e.preventDefault()
    try {
      canvasRef.current.setPointerCapture?.(e.pointerId)
    } catch {}
    drag.current = { at: toCover(e), focus: d.focus }
  }
  function onPointerMove(e) {
    if (!drag.current) return
    const p = toCover(e)
    const b = pictureBox(d.image, COVER_W, COVER_H, d.zoom, d.focus)
    const clamp = (v) => Math.min(1, Math.max(0, v))
    set({
      focus: {
        x: clamp(drag.current.focus.x - (p.x - drag.current.at.x) / b.w),
        y: clamp(drag.current.focus.y - (p.y - drag.current.at.y) / b.h),
      },
    })
  }
  const endDrag = () => (drag.current = null)

  async function save() {
    setError(null)
    setBusy('Saving the cover…')
    try {
      paintCover(canvasRef.current.getContext('2d'), COVER_W, COVER_H, d)
      const blob = await canvasJpeg(canvasRef.current)
      onSaved(await uploadCover(work.id, blob, { credit: d.image ? credit : '' }))
    } catch (e) {
      // A picture from a site that doesn't allow it can be shown but not saved.
      setError(/tainted|insecure/i.test(e.message) ? "That picture can't be saved from here. Download it, then upload it." : e.message)
      setBusy(null)
    }
  }

  const tab = (k, label, onClick) => (
    <button
      type="button"
      onClick={onClick}
      className={'-mb-px border-b-2 px-1 pb-2 text-sm transition-colors ' + (source === k ? 'border-fuchsia text-ink' : 'border-transparent text-muted hover:text-body')}
    >
      {label}
    </button>
  )

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/50 px-3 py-[4vh] sm:px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Design the cover"
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          takeFile([...e.dataTransfer.files].find((f) => f.type.startsWith('image/')))
        }}
        className="w-full max-w-4xl rounded-sm border border-line bg-paper shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6 sm:py-4">
          <h2 className="font-serif text-2xl italic text-ink">The cover</h2>
          <button onClick={onClose} aria-label="Close" className="-mr-2 rounded-full p-2.5 text-muted hover:text-fuchsia">
            <X size={18} />
          </button>
        </div>

        <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[17rem_1fr] md:gap-8">
          {/* The cover as it will be, first on a phone so it stays in view. */}
          <div>
            <canvas
              ref={canvasRef}
              width={COVER_W}
              height={COVER_H}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className={
                'mx-auto block aspect-[2/3] w-48 touch-none rounded-[3px] shadow-[0_1px_2px_rgba(0,0,0,0.25),0_12px_28px_-12px_rgba(0,0,0,0.55)] md:w-full ' +
                (d.image ? 'cursor-grab active:cursor-grabbing' : '')
              }
            />
            {d.image && <p className="mt-2 text-center text-xs text-muted md:text-left">Drag the picture to frame it.</p>}
            {d.image && credit && <p className="mt-1 text-center text-xs text-muted md:text-left">{credit}</p>}
          </div>

          <div className="min-w-0">
            {/* ── the picture ── */}
            <h3 className="font-serif text-base italic text-body">The picture</h3>
            <div className="mt-3 flex gap-5 border-b border-line">
              {tab('upload', 'Your own', () => setSource('upload'))}
              {tab('boards', 'Mood boards', openBoards)}
              {tab('search', 'Find one', () => setSource('search'))}
            </div>

            <div className="mt-4">
              {source === 'upload' && (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="flex w-full flex-col items-center gap-1.5 rounded-sm border border-dashed border-line bg-card/50 px-4 py-6 text-sm text-muted transition-colors hover:border-fuchsia hover:text-fuchsia"
                >
                  <ImagePlus size={20} strokeWidth={1.5} />
                  Choose a picture, drop one here, or paste it
                  <span className="text-xs opacity-80">A finished cover works too: turn the words off below.</span>
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => (takeFile(e.target.files?.[0]), (e.target.value = ''))} />

              {source === 'boards' &&
                (boards === null ? (
                  <p className="font-serif italic text-muted">Gathering your boards…</p>
                ) : boards.length === 0 ? (
                  <p className="text-sm text-muted">No pictures on your mood boards yet.</p>
                ) : (
                  <ul className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                    {boards.map((b) => (
                      <li key={b.id}>
                        <button type="button" onClick={() => takePicture(b.img)} title={b.board} className="block aspect-square w-full overflow-hidden rounded-sm border border-line hover:border-fuchsia">
                          <img src={b.img} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}

              {source === 'search' && (
                <>
                  <form onSubmit={search} className="flex gap-2">
                    <input
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder="rain on a window, a field at dusk…"
                      aria-label="Look for a picture"
                      className="min-w-0 flex-1 rounded-full border border-line bg-card px-4 py-2.5 text-base text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none sm:py-2 sm:text-sm"
                    />
                    <button className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 text-sm text-body hover:border-fuchsia hover:text-fuchsia">
                      <Search size={14} /> Find
                    </button>
                  </form>
                  <p className="mt-2 text-xs text-muted">Only pictures free to use and change. The credit goes with the cover.</p>
                  {found?.length === 0 && !error && <p className="mt-3 text-sm text-muted">Nothing found. Try other words.</p>}
                  {found?.length > 0 && (
                    <ul className="mt-3 grid max-h-56 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
                      {found.map((r) => (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => takePicture(r.full, { from: ['Cover picture', r.credit && `by ${r.credit}`, r.license && `(${r.license})`].filter(Boolean).join(' ') })}
                            title={[r.credit, r.license].filter(Boolean).join(' · ')}
                            className="block aspect-square w-full overflow-hidden rounded-sm border border-line hover:border-fuchsia"
                          >
                            <img src={r.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>

            <div className="mt-5 flex flex-col gap-3">
              {d.image ? (
                <>
                  <Row label="Zoom">
                    <input type="range" min={1} max={3} step={0.01} value={d.zoom} onChange={(e) => set({ zoom: +e.target.value })} className="w-full max-w-[15rem] accent-[var(--fuchsia)]" />
                  </Row>
                  <Row label="Shade">
                    <input type="range" min={0} max={0.7} step={0.01} value={d.shade} onChange={(e) => set({ shade: +e.target.value })} className="w-full max-w-[15rem] accent-[var(--fuchsia)]" />
                  </Row>
                  <Row label="">
                    <button type="button" onClick={() => (set({ image: null, shade: 0, words: true }), setCredit(''))} className="-my-2 py-2 text-xs text-muted underline hover:text-fuchsia">
                      no picture, just a colour
                    </button>
                  </Row>
                </>
              ) : (
                <Row label="Colour">
                  <Swatches colors={COLORS} value={d.color} onChange={(color) => set({ color })} label="cover colour" />
                </Row>
              )}
            </div>

            {/* ── the words ── */}
            <h3 className="mt-7 border-t border-line pt-5 font-serif text-base italic text-body">The words</h3>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-body">
              <input type="checkbox" checked={d.words} onChange={(e) => set({ words: e.target.checked })} className="accent-fuchsia" />
              Set the title{d.subtitle ? ', subtitle' : ''}
              {d.author ? ' and author' : ''} on the cover
            </label>
            {d.words && (
              <div className="mt-3 flex flex-col gap-3">
                <Row label="Type">
                  <Toggle options={[['serif', 'Serif'], ['sans', 'Sans']]} value={d.type} onChange={(type) => set({ type })} />
                </Row>
                <Row label="Place">
                  <Toggle options={[['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']]} value={d.place} onChange={(place) => set({ place })} />
                </Row>
                <Row label="Size">
                  <input type="range" min={0.6} max={1.6} step={0.01} value={d.size} onChange={(e) => set({ size: +e.target.value })} className="w-full max-w-[15rem] accent-[var(--fuchsia)]" />
                </Row>
                <Row label="Ink">
                  <Swatches colors={INKS} value={d.ink} onChange={(ink) => set({ ink })} label="ink" />
                </Row>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                  <input type="checkbox" checked={d.imprint} onChange={(e) => set({ imprint: e.target.checked })} className="accent-fuchsia" />
                  “Petrichor” at the head, like a publisher’s mark
                </label>
                {!d.author && <p className="text-xs text-muted">Add an author on the book page to set it here too.</p>}
              </div>
            )}

            {error && <p className="mt-5 text-sm text-fuchsia">{error}</p>}
            <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-line pt-5">
              <button
                type="button"
                onClick={save}
                disabled={!!busy}
                className="rounded-full bg-fuchsia px-6 py-2.5 font-grotesk text-sm font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
              >
                {busy === 'Saving the cover…' ? busy : 'Save cover'}
              </button>
              <button type="button" onClick={onClose} className="text-sm text-muted hover:text-fuchsia">
                cancel
              </button>
              {busy && busy !== 'Saving the cover…' && <span className="text-sm italic text-muted">{busy}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

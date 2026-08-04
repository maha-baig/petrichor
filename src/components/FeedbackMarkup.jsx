import { useEffect, useState } from 'react'

const KEY = 'petrichor-feedback'

const LEAF = 'button, a, h1, h2, h3, h4, label, li, input, textarea, p, span'

// Describe the clicked element so the note has context when pasted to Claude.
// Picks the SPECIFIC element clicked; if the click landed in a container's gap,
// falls back to the nearest labelled element to the click point.
function contextFor(el, cx, cy) {
  let node = el.matches?.(LEAF) ? el : el.closest(LEAF)
  const textOf = (n) =>
    (n.getAttribute?.('placeholder') || n.innerText || n.textContent || '').replace(/\s+/g, ' ').trim()

  // container / gap click, or a wrapper whose text merges many children → narrow down
  if (!node || textOf(node).length > 60) {
    const root = el.closest('main, section, nav, header, footer, div') || document.body
    let best = null
    let bestD = Infinity
    for (const n of root.querySelectorAll(LEAF)) {
      if (n.offsetParent === null || !textOf(n) || n.children.length > 0) continue // leaves only
      const r = n.getBoundingClientRect()
      const dx = cx - (r.left + r.width / 2)
      const dy = cy - (r.top + r.height / 2)
      const d = dx * dx + dy * dy
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    if (best) node = best
  }
  node = node || el
  let text = textOf(node).slice(0, 60)
  const tag = node.tagName.toLowerCase()
  // which screen are we on?
  const activeTab = [...document.querySelectorAll('nav button')].find((b) =>
    b.className.includes('border-fuchsia'),
  )
  const screen = document.querySelector('video') ? 'Hero' : activeTab?.textContent?.trim() || 'app'
  return { label: text || tag, tag, screen }
}

export default function FeedbackMarkup() {
  const [active, setActive] = useState(false)
  const [comments, setComments] = useState([])
  const [draft, setDraft] = useState(null) // { x, y, pageX, pageY, context }
  const [note, setNote] = useState('')
  const [, force] = useState(0)

  // load / persist
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || '[]')
      if (Array.isArray(saved)) setComments(saved)
    } catch {}
  }, [])
  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(comments))
  }, [comments])

  // capture clicks while in comment mode
  useEffect(() => {
    if (!active) return
    function onClick(e) {
      if (e.target.closest('[data-feedback-ui]')) return // ignore our own UI
      e.preventDefault()
      e.stopPropagation()
      setDraft({
        x: e.clientX,
        y: e.clientY,
        pageX: e.clientX + window.scrollX,
        pageY: e.clientY + window.scrollY,
        context: contextFor(e.target, e.clientX, e.clientY),
      })
      setNote('')
    }
    document.addEventListener('click', onClick, true)
    document.body.style.cursor = 'crosshair'
    return () => {
      document.removeEventListener('click', onClick, true)
      document.body.style.cursor = ''
    }
  }, [active])

  // keep pins anchored to the document as the page scrolls
  useEffect(() => {
    const onScroll = () => force((n) => n + 1)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [])

  function saveDraft() {
    if (!note.trim()) return setDraft(null)
    setComments((c) => [...c, { id: Date.now(), ...draft, note: note.trim() }])
    setDraft(null)
    setNote('')
  }

  function copyAll() {
    if (!comments.length) return
    const text =
      `Petrichor feedback — ${comments.length} comment${comments.length > 1 ? 's' : ''}\n\n` +
      comments
        .map(
          (c, i) =>
            `${i + 1}. [${c.context.screen} · "${c.context.label}"] ${c.note}`,
        )
        .join('\n')
    navigator.clipboard?.writeText(text)
    setActive(false)
    alert('Copied all comments — paste them to Claude.')
  }

  const chip = {
    background: '#171b25',
    color: '#ede7df',
    border: '1px solid #333a48',
  }

  return (
    <>
      {/* Toolbar */}
      <div
        data-feedback-ui
        className="fixed left-1/2 top-3 z-[9999] flex -translate-x-1/2 items-center gap-2 rounded-full px-2 py-1.5 font-grotesk text-xs shadow-lg"
        style={chip}
      >
        <button
          onClick={() => setActive((a) => !a)}
          className="rounded-full px-3 py-1 font-bold"
          style={active ? { background: '#d6156a', color: '#fff' } : {}}
        >
          {active ? '● Commenting' : '💬 Comment'}
        </button>
        <span className="px-1 opacity-70">{comments.length}</span>
        <button
          onClick={copyAll}
          disabled={!comments.length}
          className="rounded-full px-3 py-1 disabled:opacity-40"
          style={{ background: '#2540ff', color: '#fff' }}
        >
          Copy
        </button>
        <button
          onClick={() => setComments([])}
          disabled={!comments.length}
          className="rounded-full px-2 py-1 opacity-70 disabled:opacity-30"
        >
          Clear
        </button>
      </div>

      {/* Pins */}
      {comments.map((c, i) => (
        <div
          key={c.id}
          data-feedback-ui
          className="fixed z-[9998] flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[11px] font-bold text-white shadow"
          style={{
            left: c.pageX - window.scrollX,
            top: c.pageY - window.scrollY,
            background: '#d6156a',
          }}
          title={c.note}
        >
          {i + 1}
        </div>
      ))}

      {/* Draft note input */}
      {draft && (
        <div
          data-feedback-ui
          className="fixed z-[9999] w-64 rounded-lg p-3 font-grotesk shadow-xl"
          style={{
            left: Math.min(draft.x, window.innerWidth - 270),
            top: Math.min(draft.y + 10, window.innerHeight - 160),
            ...chip,
          }}
        >
          <p className="mb-1 text-[11px] opacity-70">
            on “{draft.context.label}” ({draft.context.screen})
          </p>
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDraft()
              if (e.key === 'Escape') setDraft(null)
            }}
            rows={3}
            placeholder="your comment… (⌘↵ to add)"
            className="w-full resize-none rounded bg-black/30 px-2 py-1.5 text-sm text-white placeholder:text-white/40 focus:outline-none"
          />
          <div className="mt-2 flex justify-end gap-2 text-xs">
            <button onClick={() => setDraft(null)} className="opacity-70">
              Cancel
            </button>
            <button
              onClick={saveDraft}
              className="rounded px-3 py-1 font-bold"
              style={{ background: '#d6156a', color: '#fff' }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Extension } from '@tiptap/react'
import { StarterKit } from '@tiptap/starter-kit'
import { TextAlign } from '@tiptap/extension-text-align'
import { Placeholder } from '@tiptap/extension-placeholder'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  Bold,
  ChevronLeft,
  ChevronRight,
  History,
  Italic,
  List,
  ListOrdered,
  Eye,
  Maximize2,
  PenLine,
  Sparkles,
  Minimize2,
  Minus,
  PanelLeft,
  Quote,
  Redo2,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  X,
} from 'lucide-react'
import {
  addWordsWritten,
  bookTitle,
  countWords,
  dropDraft,
  getPiece,
  getWork,
  holdDraft,
  htmlToText,
  latestVersion,
  listVersions,
  numberContents,
  pieceLabel,
  readDraft,
  snapshot,
  updatePiece,
} from '../library.js'
import { assistText, suggestTitles } from '../assist.js'

const SAVE_AFTER = 900 // ms of quiet before a save
const SNAPSHOT_EVERY = 10 * 60 * 1000 // an automatic version at most every ten minutes
const STATUSES = ['draft', 'revising', 'final']

const SAVE_LABEL = {
  saved: 'Saved',
  saving: 'Saving…',
  unsaved: 'Writing…',
  offline: 'Offline · kept in this browser',
}

// Tab indents the line — poets and novelists both expect it — rather than
// leaving the page. Inside a list it nests the item instead.
const TabIndent = Extension.create({
  name: 'tabIndent',
  addKeyboardShortcuts() {
    return {
      Tab: ({ editor }) => {
        if (editor.isActive('listItem')) return editor.commands.sinkListItem('listItem')
        return editor.commands.insertContent('    ')
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('listItem')) return editor.commands.liftListItem('listItem')
        const { state } = editor
        const { $from } = state.selection
        const lineStart = $from.start()
        const text = state.doc.textBetween(lineStart, Math.min(lineStart + 4, $from.end()))
        const n = /^ {1,4}/.exec(text)?.[0].length || 0
        if (!n) return true
        return editor.commands.deleteRange({ from: lineStart, to: lineStart + n })
      },
    }
  },
})

function ago(iso) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} h ago`
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ToolButton({ on, onClick, label, children, disabled }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()} // keep the caret where it is
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={
        'grid h-8 w-8 place-items-center rounded-sm transition-colors disabled:opacity-30 ' +
        (on ? 'bg-fuchsia/15 text-fuchsia' : 'text-muted hover:bg-body/5 hover:text-body')
      }
    >
      {children}
    </button>
  )
}

const Divider = () => <span className="mx-1 h-5 w-px bg-line" aria-hidden />

function Toolbar({ editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      style: e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      quote: e.isActive('blockquote'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      align: ['center', 'right', 'justify'].find((a) => e.isActive({ textAlign: a })) || 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })
  const c = () => editor.chain().focus()

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <select
        value={s.style}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') c().setParagraph().run()
          else c().toggleHeading({ level: v === 'h2' ? 2 : 3 }).run()
        }}
        aria-label="Text style"
        className="mr-1 h-8 rounded-sm border border-line bg-card px-2 text-xs text-body focus:border-fuchsia focus:outline-none"
      >
        <option value="p">Body text</option>
        <option value="h2">Heading</option>
        <option value="h3">Subheading</option>
      </select>
      <ToolButton label="Bold (⌘B)" on={s.bold} onClick={() => c().toggleBold().run()}>
        <Bold size={15} />
      </ToolButton>
      <ToolButton label="Italic (⌘I)" on={s.italic} onClick={() => c().toggleItalic().run()}>
        <Italic size={15} />
      </ToolButton>
      <ToolButton label="Underline (⌘U)" on={s.underline} onClick={() => c().toggleUnderline().run()}>
        <UnderlineIcon size={15} />
      </ToolButton>
      <ToolButton label="Strikethrough" on={s.strike} onClick={() => c().toggleStrike().run()}>
        <Strikethrough size={15} />
      </ToolButton>
      <Divider />
      <ToolButton label="Align left" on={s.align === 'left'} onClick={() => c().setTextAlign('left').run()}>
        <AlignLeft size={15} />
      </ToolButton>
      <ToolButton label="Centre" on={s.align === 'center'} onClick={() => c().setTextAlign('center').run()}>
        <AlignCenter size={15} />
      </ToolButton>
      <ToolButton label="Align right" on={s.align === 'right'} onClick={() => c().setTextAlign('right').run()}>
        <AlignRight size={15} />
      </ToolButton>
      <ToolButton label="Justify" on={s.align === 'justify'} onClick={() => c().setTextAlign('justify').run()}>
        <AlignJustify size={15} />
      </ToolButton>
      <Divider />
      <ToolButton label="Quote" on={s.quote} onClick={() => c().toggleBlockquote().run()}>
        <Quote size={15} />
      </ToolButton>
      <ToolButton label="Bulleted list" on={s.bullet} onClick={() => c().toggleBulletList().run()}>
        <List size={15} />
      </ToolButton>
      <ToolButton label="Numbered list" on={s.ordered} onClick={() => c().toggleOrderedList().run()}>
        <ListOrdered size={15} />
      </ToolButton>
      <ToolButton label="Scene break" onClick={() => c().setHorizontalRule().run()}>
        <Minus size={15} />
      </ToolButton>
      <Divider />
      <ToolButton label="Undo (⌘Z)" disabled={!s.canUndo} onClick={() => c().undo().run()}>
        <Undo2 size={15} />
      </ToolButton>
      <ToolButton label="Redo (⇧⌘Z)" disabled={!s.canRedo} onClick={() => c().redo().run()}>
        <Redo2 size={15} />
      </ToolButton>
    </div>
  )
}

/** Every kept version of this chapter, and a way to bring one back. */
function HistoryPanel({ pieceId, onRestore, onClose }) {
  const [versions, setVersions] = useState(null)
  const [open, setOpen] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    listVersions(pieceId).then(setVersions, (e) => setError(e.message))
  }, [pieceId])
  const chosen = versions?.find((v) => v.id === open)

  return (
    <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-md flex-col border-l border-line bg-paper shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="font-serif text-2xl italic text-ink">History</h3>
        <button onClick={onClose} aria-label="Close history" className="rounded-full p-1.5 text-muted hover:text-fuchsia">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
        {error && <p className="text-sm text-fuchsia">{error}</p>}
        {versions === null && !error && <p className="font-serif italic text-muted">Looking back…</p>}
        {versions?.length === 0 && (
          <p className="text-sm text-muted">
            No versions yet. One is kept every ten minutes you write, or press “Keep this version” whenever a
            draft is worth holding on to.
          </p>
        )}
        {chosen ? (
          <div>
            <button onClick={() => setOpen(null)} className="text-xs text-muted hover:text-fuchsia">
              ← all versions
            </button>
            <p className="mt-3 text-xs text-muted">
              {ago(chosen.created_at)} · {chosen.word_count} words
            </p>
            <div className="chapter-prose mt-3 max-h-[55vh] overflow-auto rounded-sm border border-line bg-card p-4 text-[0.95rem]">
              <p className="!mb-3 font-serif text-lg italic text-ink">{chosen.title || 'Untitled'}</p>
              <div dangerouslySetInnerHTML={{ __html: chosen.body || '<p>—</p>' }} />
            </div>
            <button onClick={() => onRestore(chosen)} className="mt-4 rounded-full bg-fuchsia px-4 py-2 font-grotesk text-xs font-bold text-white">
              Restore this version
            </button>
            <p className="mt-2 text-xs text-muted">What's on the page now is kept first, so nothing is lost.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {versions?.map((v) => (
              <li key={v.id}>
                <button onClick={() => setOpen(v.id)} className="w-full rounded-sm px-3 py-2 text-left text-sm text-body transition-colors hover:bg-body/5">
                  {ago(v.created_at)}
                  <span className="block text-xs text-muted">
                    {v.word_count} words{v.reason === 'kept' ? ' · kept' : v.reason === 'restore' ? ' · before a restore' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

const ASSIST_LABEL = { fix: 'Fix typos', suggest: 'Suggest alternatives', tighten: 'Tighten', ask: 'Ask about this' }

/**
 * What the assistant made of a selected passage. Nothing touches the chapter
 * until "Use this" is clicked, and the chapter is kept in History first.
 */
function AssistPanel({ assist, onAsk, onApply, onClose }) {
  const [question, setQuestion] = useState('')
  const { mode, text, status, result, error } = assist
  const Use = ({ value }) => (
    <button onClick={() => onApply(value)} className="mt-2 rounded-full bg-fuchsia px-3 py-1 font-grotesk text-xs font-bold text-white">
      Use this
    </button>
  )
  const Block = ({ children }) => (
    <div className="whitespace-pre-wrap rounded-sm border border-line bg-card px-3 py-2 font-serif text-[0.95rem] leading-relaxed text-body">{children}</div>
  )
  return (
    <aside className="fixed inset-y-0 right-0 z-[60] flex w-full max-w-md flex-col border-l border-line bg-paper shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h3 className="inline-flex items-center gap-2 font-serif text-2xl italic text-ink">
          <Sparkles size={18} className="text-fuchsia" /> {ASSIST_LABEL[mode]}
        </h3>
        <button onClick={onClose} aria-label="Close" className="rounded-full p-1.5 text-muted hover:text-fuchsia">
          <X size={18} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">
        <p className="font-grotesk text-[0.65rem] font-bold uppercase tracking-[0.2em] text-muted">Your passage</p>
        <div className="mt-2 max-h-40 overflow-auto">
          <Block>{text}</Block>
        </div>

        {status === 'asking' && (
          <form
            className="mt-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (question.trim()) onAsk(question.trim())
            }}
          >
            <input
              autoFocus
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Does this line land? Is the tense consistent?"
              className="w-full rounded-full border border-line bg-card px-4 py-2 text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
            />
            <button type="submit" className="mt-2 rounded-full bg-fuchsia px-4 py-1.5 font-grotesk text-xs font-bold text-white">
              Ask
            </button>
          </form>
        )}

        {status === 'loading' && <p className="mt-5 font-serif italic text-muted">Reading it…</p>}
        {status === 'error' && <p className="mt-5 text-fuchsia">{error}</p>}

        {status === 'done' && (
          <div className="mt-5 flex flex-col gap-4">
            {mode === 'fix' &&
              (result.text === text ? (
                <p className="font-serif italic text-muted">Nothing to fix.</p>
              ) : (
                <div>
                  <Block>{result.text}</Block>
                  {result.changes?.length > 0 && <p className="mt-2 text-xs text-muted">{result.changes.join(' · ')}</p>}
                  <Use value={result.text} />
                </div>
              ))}
            {mode === 'tighten' && (
              <div>
                <Block>{result.text}</Block>
                {result.note && <p className="mt-2 text-xs text-muted">{result.note}</p>}
                <Use value={result.text} />
              </div>
            )}
            {mode === 'suggest' &&
              (result.options || []).map((o, i) => (
                <div key={i}>
                  <Block>{o}</Block>
                  <Use value={o} />
                </div>
              ))}
            {mode === 'ask' && <p className="font-serif text-[0.95rem] leading-relaxed text-body">{result.answer}</p>}
          </div>
        )}
      </div>
      <p className="border-t border-line px-5 py-3 text-xs text-muted">
        Suggestions only. Using one keeps the chapter as it was in History first, and ⌘Z undoes it.
      </p>
    </aside>
  )
}

/** The book's contents, to jump between chapters without leaving the page. */
function ContentsPanel({ work, contents, currentId, onOpen, onClose, onBack }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-[60] flex w-full max-w-xs flex-col border-r border-line bg-paper shadow-2xl">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <button onClick={onBack} className="min-w-0 truncate text-left font-serif text-xl italic text-ink hover:text-fuchsia">
          {bookTitle(work)}
        </button>
        <button onClick={onClose} aria-label="Close contents" className="rounded-full p-1.5 text-muted hover:text-fuchsia">
          <X size={18} />
        </button>
      </div>
      <ol className="min-h-0 flex-1 overflow-auto px-3 py-3">
        {contents.map((p) => (
          <li key={p.id}>
            <button
              onClick={() => onOpen(p)}
              className={
                'flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left transition-colors ' +
                (p.id === currentId ? 'bg-fuchsia/10 text-fuchsia' : 'text-body hover:bg-body/5') +
                (p.depth === 2 ? ' pl-8' : p.depth === 1 ? ' pl-5' : '') +
                (p.kind === 'part' ? ' mt-3' : '')
              }
            >
              {p.kind === 'part' ? (
                <span className="font-grotesk text-[0.65rem] font-bold uppercase tracking-[0.2em] text-muted">
                  Part {p.number} · <span className="font-serif text-sm normal-case tracking-normal italic">{p.title || 'Untitled'}</span>
                </span>
              ) : (
                <>
                  <span className="w-8 shrink-0 text-xs tabular-nums text-muted">{p.number}</span>
                  <span className="truncate font-serif italic">{pieceLabel(p)}</span>
                </>
              )}
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}

/**
 * Where the writing happens: one chapter (or section, or part opener) on a
 * page, with a word-processor toolbar. Saved a moment after she stops typing,
 * with a copy held in this browser until the database has it.
 */
export default function ChapterEditor({ workId, pieceId, onBack, onOpen }) {
  const [work, setWork] = useState(null)
  const [pieces, setPieces] = useState([])
  const [piece, setPiece] = useState(null)
  const [title, setTitle] = useState('')
  const [status, setStatus] = useState('saved')
  const [panel, setPanel] = useState(null) // 'history' | 'contents'
  const [view, setView] = useState('write') // write | preview
  const [assist, setAssist] = useState(null) // the selected-text assistant's request and answer
  const [titleIdeas, setTitleIdeas] = useState(null) // null | 'loading' | string[] | { error }
  const [focus, setFocus] = useState(false)
  const [note, setNote] = useState(null)
  const [error, setError] = useState(null)
  const [words, setWords] = useState(0)
  const [sessionWords, setSessionWords] = useState(0)

  const saved = useRef({ title: '', body: '', words: 0 })
  const latest = useRef({ title: '', body: '' })
  const lastSnap = useRef({ at: 0, body: null })
  const timer = useRef(null)
  const startWords = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Begin anywhere…' }),
      TabIndent,
    ],
    content: '',
    // Keep every space when a chapter is loaded: an indent in a poem is part of the poem.
    parseOptions: { preserveWhitespace: 'full' },
    editorProps: {
      attributes: { class: 'chapter-prose focus:outline-none', spellcheck: 'true', 'aria-label': 'Chapter text' },
    },
    onUpdate: ({ editor: e }) => {
      const html = e.isEmpty ? '' : e.getHTML()
      schedule(latest.current.title, html)
    },
  })

  // ── loading ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    let alive = true
    Promise.all([getWork(workId), getPiece(pieceId)])
      .then(([found, p]) => {
        if (!alive) return
        if (!found || !p) return setError('This chapter could not be found.')
        setWork(found.work)
        setPieces(found.pieces)
        setPiece(p)

        let t = p.title
        let b = p.body
        // A draft left in this browser that the database never received wins.
        const held = readDraft(p.id)
        const heldIsNewer = held && new Date(held.at) > new Date(p.updated_at) && (held.body !== p.body || held.title !== p.title)
        if (heldIsNewer) {
          t = held.title ?? t
          b = held.body ?? b
          setNote('Brought back unsaved words from this browser.')
        } else if (held) dropDraft(p.id)

        const w = countWords(htmlToText(p.body))
        saved.current = { title: p.title, body: p.body, words: w }
        latest.current = { title: t, body: b }
        startWords.current = w
        setTitle(t)
        editor.commands.setContent(b || '', { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } })
        setWords(countWords(editor.getText()))
        if (heldIsNewer) schedule(t, b, 0)
        if (!b) editor.commands.focus('end')

        latestVersion(p.id)
          .then((v) => (lastSnap.current = v ? { at: new Date(v.created_at).getTime(), body: v.body } : { at: 0, body: null }))
          .catch(() => {})
      })
      .catch((e) => alive && setError(e.message))
    return () => {
      alive = false
      // Leaving the chapter: anything still waiting goes now.
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
        save()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, pieceId, workId])

  // ── saving ─────────────────────────────────────────────────────────────────
  async function save() {
    const id = pieceId
    const { title: t, body: b } = latest.current
    const before = saved.current.words
    if (t === saved.current.title && b === saved.current.body) {
      setStatus('saved')
      return
    }
    setStatus('saving')
    const w = countWords(htmlToText(b))
    try {
      const row = await updatePiece(id, { title: t, body: b, words: w })
      saved.current = { title: t, body: b, words: w }
      if (latest.current.title === t && latest.current.body === b) dropDraft(id)
      setPiece((p) => (p ? { ...p, ...row } : p))
      setPieces((ps) => ps.map((p) => (p.id === id ? { ...p, title: t, words: w } : p)))
      setStatus('saved')
      addWordsWritten(w - before).catch(() => {})
      if (Date.now() - lastSnap.current.at > SNAPSHOT_EVERY && b !== lastSnap.current.body && w > 0) {
        lastSnap.current = { at: Date.now(), body: b }
        snapshot({ id, title: t, body: b }, 'auto').catch(() => {})
      }
    } catch {
      // The words are safe in this browser; try again shortly.
      setStatus('offline')
      timer.current = setTimeout(() => {
        timer.current = null
        save()
      }, 5000)
    }
  }

  function schedule(t, b, wait = SAVE_AFTER) {
    latest.current = { title: t, body: b }
    holdDraft(pieceId, latest.current)
    const w = countWords(htmlToText(b))
    setWords(w)
    if (startWords.current !== null) setSessionWords(Math.max(0, w - startWords.current))
    setStatus('unsaved')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      save()
    }, wait)
  }

  // Closing the tab mid-sentence: the browser copy is there, and the warning
  // gives the save a chance to land.
  useEffect(() => {
    const warn = (e) => {
      if (!timer.current) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // ⌘S keeps a version (saving is automatic); Esc leaves focus or a panel.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        keepVersion()
      }
      if (e.key === 'Escape') {
        if (panel) setPanel(null)
        else if (focus) setFocus(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    document.documentElement.classList.toggle('writing-focus', focus)
    return () => document.documentElement.classList.remove('writing-focus')
  }, [focus])

  async function keepVersion() {
    try {
      const body = latest.current.body
      await snapshot({ id: pieceId, title: latest.current.title, body }, 'kept')
      lastSnap.current = { at: Date.now(), body }
      setNote('Version kept.')
      setTimeout(() => setNote(null), 2200)
    } catch (e) {
      setNote(e.message)
    }
  }

  async function restore(v) {
    await snapshot({ id: pieceId, title: latest.current.title, body: latest.current.body }, 'restore').catch(() => {})
    setTitle(v.title)
    editor.commands.setContent(v.body || '', { emitUpdate: false, parseOptions: { preserveWhitespace: 'full' } })
    schedule(v.title, v.body, 0)
    setPanel(null)
    setNote('Restored. The version before it is in the history.')
  }

  // ── the assistant, on a selected passage ──────────────────────────────────
  const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  function startAssist(mode) {
    if (!editor) return
    const { from, to } = editor.state.selection
    const text = editor.state.doc.textBetween(from, to, '\n\n', '\n')
    if (!text.trim()) return
    const base = { mode, text, range: { from, to } }
    if (mode === 'ask') setAssist({ ...base, status: 'asking' })
    else runAssist(base)
  }

  function runAssist(base, question = '') {
    setAssist({ ...base, status: 'loading' })
    assistText(base.mode, base.text, question)
      .then((result) => setAssist((a) => (a && a.range === base.range ? { ...base, status: 'done', result } : a)))
      .catch((e) => setAssist((a) => (a && a.range === base.range ? { ...base, status: 'error', error: e.message } : a)))
  }

  async function applyAssist(newText) {
    const { range, text } = assist
    const now = editor.state.doc.textBetween(range.from, Math.min(range.to, editor.state.doc.content.size), '\n\n', '\n')
    if (now !== text) {
      setAssist((a) => ({ ...a, status: 'error', error: 'That passage has changed since you asked. Select it again and ask once more.' }))
      return
    }
    await snapshot({ id: pieceId, title: latest.current.title, body: latest.current.body }, 'kept').catch(() => {})
    // A selection can start or end on a line break; keep exactly the original's
    // edges and take only the middle from the suggestion, so no blank lines creep in.
    const lead = text.match(/^\n*/)[0]
    const trail = text.match(/\n*$/)[0]
    newText = lead + String(newText).replace(/^\n+|\n+$/g, '') + trail
    // Blank lines are paragraph (stanza) breaks; single newlines are line breaks.
    const html = /\n\s*\n/.test(newText)
      ? newText.split(/\n\s*\n/).map((p) => `<p>${p.split('\n').map(escText).join('<br>')}</p>`).join('')
      : newText.split('\n').map(escText).join('<br>')
    editor.chain().focus().insertContentAt(range, html, { parseOptions: { preserveWhitespace: 'full' } }).run()
    setAssist(null)
    setNote('Applied. The chapter before this change is in History.')
    setTimeout(() => setNote(null), 3000)
  }

  function ideasForTitle() {
    if (!editor) return
    const text = editor.getText()
    if (!text.trim()) {
      setTitleIdeas({ error: 'Write a little of this chapter first.' })
      return
    }
    setTitleIdeas('loading')
    suggestTitles({
      text,
      current: title,
      bookTitle: work?.title || '',
      neighbours: numberContents(pieces).filter((p) => p.id !== pieceId).map(pieceLabel),
      kind: current?.kind || 'chapter',
    })
      .then(setTitleIdeas)
      .catch((e) => setTitleIdeas({ error: e.message }))
  }

  if (error)
    return (
      <section>
        <button onClick={onBack} className="text-sm text-muted hover:text-fuchsia">
          ← back to the book
        </button>
        <p className="mt-6 max-w-2xl text-sm text-fuchsia">{error}</p>
      </section>
    )

  const contents = numberContents(pieces)
  const here = contents.findIndex((p) => p.id === pieceId)
  const current = contents[here]
  const prev = contents[here - 1]
  const next = contents[here + 1]
  const kindLabel = current ? (current.kind === 'part' ? `Part ${current.number}` : current.kind === 'chapter' ? `Chapter ${current.number}` : `Section ${current.number}`) : ''

  return (
    <div className={focus ? 'fixed inset-0 z-[50] overflow-auto bg-paper2' : '-mx-6 -mt-4 min-h-screen bg-paper2/60'}>
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className={'sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur transition-opacity ' + (focus ? 'opacity-0 hover:opacity-100 focus-within:opacity-100' : '')}>
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
          <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fuchsia" title="Back to the book">
            <ArrowLeft size={16} />
            <span className="max-w-[12rem] truncate font-serif italic">{work ? bookTitle(work) : '…'}</span>
          </button>
          <button onClick={() => setPanel('contents')} className="rounded-full p-1.5 text-muted hover:text-fuchsia" aria-label="Contents" title="Contents">
            <PanelLeft size={16} />
          </button>
          <span className="hidden text-xs text-muted sm:inline">{kindLabel}</span>
          <span className={'inline-flex items-center gap-1.5 text-xs ' + (status === 'offline' ? 'text-amber' : 'text-muted')}>
            <span className={'h-1.5 w-1.5 rounded-full ' + (status === 'saved' ? 'bg-emerald-500' : status === 'offline' ? 'bg-amber' : 'bg-muted/60')} />
            {SAVE_LABEL[status]}
          </span>
          {note && <span className="text-xs text-fuchsia">{note}</span>}
          <span className="ml-auto flex items-center gap-1">
            {piece && (
              <select
                value={piece.status}
                onChange={(e) => updatePiece(piece.id, { status: e.target.value }).then((row) => setPiece((p) => ({ ...p, ...row })))}
                aria-label="Status"
                className="h-8 rounded-full border border-line bg-card px-3 text-xs text-muted focus:border-fuchsia focus:outline-none"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <span className="flex items-center rounded-full border border-line p-0.5" role="group" aria-label="View">
              <button
                onClick={() => setView('write')}
                aria-pressed={view === 'write'}
                className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ' + (view === 'write' ? 'bg-fuchsia text-white' : 'text-muted hover:text-body')}
              >
                <PenLine size={13} /> Write
              </button>
              <button
                onClick={() => setView('preview')}
                aria-pressed={view === 'preview'}
                className={'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ' + (view === 'preview' ? 'bg-fuchsia text-white' : 'text-muted hover:text-body')}
              >
                <Eye size={13} /> Preview
              </button>
            </span>
            <button onClick={keepVersion} className="hidden rounded-full border border-line px-3 py-1.5 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia sm:inline">
              Keep this version
            </button>
            <button onClick={() => setPanel('history')} className="rounded-full p-2 text-muted hover:text-fuchsia" aria-label="History" title="History">
              <History size={16} />
            </button>
            <button
              onClick={() => setFocus((f) => !f)}
              className="rounded-full p-2 text-muted hover:text-fuchsia"
              aria-label={focus ? 'Leave focus mode' : 'Focus mode'}
              title={focus ? 'Leave focus mode (Esc)' : 'Focus mode'}
            >
              {focus ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </span>
        </div>
        {editor && view === 'write' && (
          <div className="mx-auto max-w-6xl border-t border-line/60 px-4 py-1.5">
            <Toolbar editor={editor} />
          </div>
        )}
      </div>

      {/* ── The page ──────────────────────────────────────────────────────── */}
      <div className="px-3 py-8 sm:px-6 sm:py-12">
        <article className="mx-auto min-h-[70vh] w-full max-w-[46rem] rounded-[2px] bg-card px-6 py-12 shadow-[0_1px_3px_rgba(0,0,0,0.12),0_18px_40px_-24px_rgba(0,0,0,0.5)] sm:px-16 sm:py-20">
          <div className="mb-10 text-center">
            <div className="font-grotesk text-[0.7rem] font-bold uppercase tracking-[0.3em] text-muted">{kindLabel}</div>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                schedule(e.target.value, latest.current.body)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  editor?.commands.focus('start')
                }
              }}
              placeholder={current?.kind === 'part' ? 'Name this part' : 'Untitled'}
              aria-label="Title"
              readOnly={view === 'preview'}
              className="page-surface mt-3 w-full bg-transparent text-center font-serif text-3xl italic leading-tight text-ink placeholder:text-muted/40 focus:outline-none sm:text-4xl"
            />
            {view === 'write' && (
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
                {Array.isArray(titleIdeas) ? (
                  <>
                    {titleIdeas.map((t) => (
                      <button
                        key={t}
                        onClick={() => {
                          setTitle(t)
                          schedule(t, latest.current.body)
                          setTitleIdeas(null)
                        }}
                        className="rounded-full border border-line px-3 py-1 font-serif text-sm italic text-body transition-colors hover:border-fuchsia hover:text-fuchsia"
                      >
                        {t}
                      </button>
                    ))}
                    <button onClick={() => setTitleIdeas(null)} className="px-2 text-xs text-muted hover:text-body">
                      keep mine
                    </button>
                  </>
                ) : (
                  <button
                    onClick={ideasForTitle}
                    disabled={titleIdeas === 'loading'}
                    className="inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-fuchsia disabled:opacity-60"
                  >
                    <Sparkles size={12} /> {titleIdeas === 'loading' ? 'Thinking of titles…' : 'Suggest titles'}
                  </button>
                )}
                {titleIdeas?.error && <span className="w-full text-xs text-fuchsia">{titleIdeas.error}</span>}
              </div>
            )}
            <div className="mx-auto mt-6 h-px w-12 bg-line" />
          </div>

          {/* Preview: the chapter as it will read in the book. The editor stays
              mounted underneath, so switching back loses nothing. */}
          {view === 'preview' && (
            <div
              className={'book-preview ' + (/<br\s*\/?>/.test(latest.current.body || '') ? 'is-verse' : 'is-prose')}
              dangerouslySetInnerHTML={{ __html: latest.current.body || '<p class="empty">Nothing written yet.</p>' }}
            />
          )}
          <div className={view === 'preview' ? 'hidden' : ''}>
            <EditorContent editor={editor} />
          </div>
          {editor && view === 'write' && (
            <BubbleMenu editor={editor} shouldShow={({ state }) => !state.selection.empty && !assist}>
              <div className="flex items-center gap-0.5 rounded-full border border-line bg-paper p-1 shadow-xl">
                <Sparkles size={13} className="mx-1.5 text-fuchsia" aria-hidden />
                {['fix', 'suggest', 'tighten', 'ask'].map((m) => (
                  <button
                    key={m}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => startAssist(m)}
                    className="rounded-full px-2.5 py-1 font-grotesk text-xs text-body transition-colors hover:bg-fuchsia/10 hover:text-fuchsia"
                  >
                    {{ fix: 'Fix', suggest: 'Suggest', tighten: 'Tighten', ask: 'Ask' }[m]}
                  </button>
                ))}
              </div>
            </BubbleMenu>
          )}
        </article>

        {/* ── Between chapters ──────────────────────────────────────────── */}
        {!focus && (
          <nav className="mx-auto mt-8 flex max-w-[46rem] items-center justify-between gap-4 text-sm">
            {prev ? (
              <button onClick={() => onOpen(prev)} className="inline-flex min-w-0 items-center gap-1 text-muted hover:text-fuchsia">
                <ChevronLeft size={16} className="shrink-0" />
                <span className="truncate font-serif italic">{pieceLabel(prev)}</span>
              </button>
            ) : (
              <span />
            )}
            {next ? (
              <button onClick={() => onOpen(next)} className="inline-flex min-w-0 items-center gap-1 text-muted hover:text-fuchsia">
                <span className="truncate font-serif italic">{pieceLabel(next)}</span>
                <ChevronRight size={16} className="shrink-0" />
              </button>
            ) : (
              <button onClick={onBack} className="text-muted hover:text-fuchsia">
                Back to contents
              </button>
            )}
          </nav>
        )}
      </div>

      {/* ── Word count ────────────────────────────────────────────────────── */}
      <div className="sticky bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-xs text-muted">
          <span>{words.toLocaleString()} words</span>
          <span>~{Math.max(1, Math.round(words / 250))} min read</span>
          <span className="hidden sm:inline">Tab indents · Shift+Enter for a line break without a gap</span>
          <span className="ml-auto">+{sessionWords.toLocaleString()} this session</span>
        </div>
      </div>

      {assist && (
        <AssistPanel
          assist={assist}
          onAsk={(q) => runAssist(assist, q)}
          onApply={applyAssist}
          onClose={() => setAssist(null)}
        />
      )}
      {panel === 'history' && piece && <HistoryPanel pieceId={piece.id} onRestore={restore} onClose={() => setPanel(null)} />}
      {panel === 'contents' && work && (
        <ContentsPanel
          work={work}
          contents={contents}
          currentId={pieceId}
          onOpen={(p) => {
            setPanel(null)
            onOpen(p)
          }}
          onClose={() => setPanel(null)}
          onBack={onBack}
        />
      )}
      {panel && <div className="fixed inset-0 z-[55] bg-black/30" onClick={() => setPanel(null)} aria-hidden />}
    </div>
  )
}

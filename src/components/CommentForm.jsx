import { useEffect, useRef, useState } from 'react'

const NAME_KEY = 'petrichor-comment-name'

/** The name this browser last commented under. */
export const readName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || ''
  } catch {
    return ''
  }
}

export const keepName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, String(name).trim())
  } catch {
    /* only a convenience */
  }
}

/**
 * Writing a comment or a reply. A reply is compact: the name it goes under is
 * a line of text (with a way to change it) rather than a field to fill in again.
 */
export default function CommentForm({
  onPost,
  reply = false,
  initialBody = '',
  placeholder = 'Leave a comment…',
  onCancel,
}) {
  const [name, setName] = useState(readName())
  const [naming, setNaming] = useState(!reply || !readName())
  const [body, setBody] = useState(initialBody)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const text = useRef(null)

  // A reply opens ready to type, after any @name it starts with.
  useEffect(() => {
    if (!reply || !text.current) return
    const el = text.current
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [reply])

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) {
      setNaming(true)
      return setError('Add your name.')
    }
    if (!body.trim() || body.trim() === initialBody.trim()) return setError(reply ? 'Write your reply.' : 'Write a comment.')
    setBusy(true)
    setError(null)
    try {
      keepName(name)
      await onPost(name, body)
      setBody('')
      if (reply) setNaming(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className={'flex flex-col gap-2 ' + (reply ? '' : 'mt-8')}>
      {naming ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          maxLength={60}
          className="w-full max-w-xs rounded-full border border-line bg-card px-4 py-3 text-sm text-body placeholder:text-muted/60 focus:border-fuchsia focus:outline-none sm:py-2"
        />
      ) : (
        <p className="text-xs text-muted">
          Replying as <span className="font-bold text-body">{name}</span> ·{' '}
          <button type="button" onClick={() => setNaming(true)} className="-my-3 inline-block py-3 underline hover:text-fuchsia">
            change
          </button>
        </p>
      )}
      {/* A name given in a reply since this opened is picked up here too. */}
      <textarea
        ref={text}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onCancel?.()}
        onFocus={() => !name && setName(readName())}
        rows={reply ? 2 : 3}
        placeholder={placeholder}
        aria-label={reply ? 'Your reply' : 'Your comment'}
        maxLength={4000}
        className="w-full rounded-sm border border-line bg-card px-4 py-3 font-serif text-body placeholder:italic placeholder:text-muted/60 focus:border-fuchsia focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          disabled={busy}
          className={
            'rounded-full bg-fuchsia font-grotesk text-sm font-bold text-white disabled:opacity-60 ' +
            (reply ? 'px-4 py-2.5 sm:py-1.5' : 'px-5 py-3 sm:py-2')
          }
        >
          {busy ? 'Posting…' : reply ? 'Reply' : 'Post comment'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="-my-3 py-3 text-sm text-muted hover:text-fuchsia">
            cancel
          </button>
        )}
      </div>
      {error && <p className="text-sm text-fuchsia">{error}</p>}
    </form>
  )
}

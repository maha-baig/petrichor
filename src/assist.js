// ─────────────────────────────────────────────────────────────────────────────
//  The book assistants, client side. The model proposes; nothing here changes
//  a book until the author applies it (see Book.jsx and ChapterEditor.jsx).
// ─────────────────────────────────────────────────────────────────────────────

import { getManuscript, htmlToText, numberContents, pieceLabel } from './library.js'

async function post(path, body) {
  const res = await fetch(`/api/assist/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `The assistant couldn’t answer (${res.status}).`)
  return json
}

// ── contents ─────────────────────────────────────────────────────────────────

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The contents as the assistant sees them: titles, numbers, word counts, the
 * first words of each, and a shared `dup` tag on entries whose text is identical.
 */
export async function describeContents(workId) {
  const { pieces } = await getManuscript(workId)
  const contents = numberContents(pieces)
  const groups = new Map()
  const texts = contents.map((p) => norm(htmlToText(p.body)))
  texts.forEach((t, i) => {
    if (!t) return
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(i)
  })
  let tag = 0
  const dupOf = new Map()
  for (const idx of groups.values()) if (idx.length > 1) { tag++; idx.forEach((i) => dupOf.set(i, `D${tag}`)) }
  return contents.map((p, i) => ({
    id: p.id,
    kind: p.kind,
    number: p.number,
    title: p.title || '',
    label: pieceLabel(p),
    words: p.words || 0,
    opening: texts[i].split(' ').slice(0, 14).join(' '),
    dup: dupOf.get(i) || '',
  }))
}

export const askContents = (instruction, contents) =>
  post('contents', {
    instruction,
    contents: contents.map(({ label, ...c }) => c),
  })

/**
 * Play the proposed actions against the contents without touching the book:
 * the resulting order, renames and deletions, plus anything that didn't make sense.
 */
export function planContents(contents, actions = []) {
  const byId = new Map(contents.map((c) => [c.id, c]))
  let order = contents.map((c) => c.id)
  const renames = new Map()
  const deletes = new Set()
  const moves = []
  const problems = []
  for (const a of actions) {
    if (!a || !byId.has(a.id)) {
      problems.push(`skipped an instruction about something that isn’t in the contents`)
      continue
    }
    if (a.op === 'rename' && String(a.title || '').trim()) renames.set(a.id, String(a.title).trim().slice(0, 200))
    else if (a.op === 'delete') {
      deletes.add(a.id)
      order = order.filter((id) => id !== a.id)
    } else if (a.op === 'move') {
      if (a.after && (!byId.has(a.after) || a.after === a.id)) {
        problems.push(`couldn’t place “${byId.get(a.id).label}”`)
        continue
      }
      order = order.filter((id) => id !== a.id)
      const at = a.after ? order.indexOf(a.after) + 1 : 0
      order.splice(at, 0, a.id)
      moves.push({ id: a.id, after: a.after || null })
    }
  }
  const changedOrder = order.join() !== contents.map((c) => c.id).filter((id) => !deletes.has(id)).join()
  return { order, renames, deletes, moves, changedOrder, problems }
}

// ── text ─────────────────────────────────────────────────────────────────────

/** Verse, if lines break inside paragraphs; otherwise prose. */
export const guessKind = (text) => (/[^\n]\n[^\n]/.test(text) ? 'poetry' : 'prose')

export const assistText = (mode, text, question = '') =>
  post('text', { mode, text, question, kind: guessKind(text) })

export const suggestTitles = ({ text, current, bookTitle, neighbours, kind }) =>
  post('titles', { text, current, bookTitle, neighbours, kind }).then((r) => (r.titles || []).filter(Boolean).slice(0, 5))

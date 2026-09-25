// ─────────────────────────────────────────────────────────────────────────────
//  Importing from Notion (client side). The server (notion.js) reads Notion;
//  this turns what it returns into a book, or into chapters of one.
//
//  A page with sub-pages becomes a book whose chapters are those sub-pages, in
//  order (text on the page itself, if any, opens the book). A page without
//  sub-pages is split at its headings, the same way an uploaded document is.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from './lib/supabase.js'
import { createPiece, createWork, htmlToText, countWords } from './library.js'
import { htmlToChapters } from './importDoc.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function call(path, body) {
  const { data } = await supabase.auth.getSession()
  const jwt = data?.session?.access_token
  if (!jwt) throw new Error('Sign in to import from Notion.')
  const res = await fetch(`/api/notion/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${jwt}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || `Notion import failed (${res.status}).`)
  return json
}

/** { connected, reason } — whether this server can reach Notion for this account. */
export const notionStatus = () => call('status').catch((e) => ({ connected: false, reason: e.message }))

export const searchNotion = (query = '') => call('search', { query }).then((r) => r.pages)

/** A page's own text and its sub-pages, to choose from before importing. */
export async function notionOutline(pageId) {
  const page = await call('page', { id: pageId })
  return { ...page, hasText: Boolean(htmlToText(page.html).trim()) }
}

/**
 * A Notion page as chapters: { title, chapters: [{ title, body }], words }.
 * `only` limits which sub-pages become chapters (ids, in the order given);
 * `includeText` keeps the page's own text as an opening chapter.
 */
export async function notionChapters(pageId, onProgress = () => {}, { only = null, includeText = true } = {}) {
  onProgress('Reading the page from Notion…')
  const page = await call('page', { id: pageId })
  let chapters
  const subs = only ? page.subpages.filter((s) => only.includes(s.id)) : page.subpages
  if (page.subpages.length) {
    chapters = []
    if (includeText && htmlToText(page.html).trim()) chapters.push({ title: 'Opening', body: htmlToChapters(page.html, 'Opening').chapters.map((c) => c.body).join('') })
    for (const [i, sub] of subs.entries()) {
      onProgress(`Reading “${sub.title}” (${i + 1} of ${subs.length})…`)
      const child = await call('page', { id: sub.id })
      // A sub-page's own sub-pages have no place in a flat chapter; their text is kept.
      const body = htmlToChapters(child.html, child.title).chapters
        .map((c) => (c.title && c.title !== child.title ? `<h2>${esc(c.title)}</h2>` : '') + c.body)
        .join('')
      chapters.push({ title: child.title, body })
    }
  } else {
    chapters = htmlToChapters(page.html, page.title).chapters
  }
  const words = chapters.reduce((n, c) => n + countWords(htmlToText(c.body)), 0)
  return { title: page.title, chapters, words }
}

/** A new book from a Notion page. Returns { work, chapters, words }. */
export async function importNotionAsBook(pageId, onProgress = () => {}, choice = {}) {
  const parsed = await notionChapters(pageId, onProgress, choice)
  if (!parsed.chapters.length) throw new Error('Choose at least one page to import.')
  const work = await createWork({ title: parsed.title, blank: false })
  for (const [i, c] of parsed.chapters.entries()) {
    onProgress(`Adding chapter ${i + 1} of ${parsed.chapters.length}…`)
    await createPiece(work.id, { kind: 'chapter', position: i, title: c.title, body: c.body })
  }
  return { work, chapters: parsed.chapters.length, words: parsed.words }
}

/** A Notion page's chapters, added after `afterPosition` in an existing book. */
export async function importNotionIntoBook(workId, afterPosition, pageId, onProgress = () => {}, choice = {}) {
  const parsed = await notionChapters(pageId, onProgress, choice)
  if (!parsed.chapters.length) throw new Error('Choose at least one page to import.')
  const pieces = []
  for (const [i, c] of parsed.chapters.entries()) {
    onProgress(`Adding chapter ${i + 1} of ${parsed.chapters.length}…`)
    pieces.push(await createPiece(workId, { kind: 'chapter', position: afterPosition + 1 + i, title: c.title, body: c.body }))
  }
  return { pieces, chapters: pieces.length, words: parsed.words }
}

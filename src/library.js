// ─────────────────────────────────────────────────────────────────────────────
//  The Books store: books, their table of contents (parts, chapters,
//  sections), the history of each chapter, and the words written each day.
//
//  Supabase only. A book is the thing she can't lose, so it lives in her
//  account from the first keystroke — behind the same magic-link sign-in and
//  the same "your own rows" policies (supabase/migrations/*_library.sql).
//  Covers live in the private `moodboards` bucket under <user_id>/books/.
//
//  Offline or mid-save, the latest text of a chapter is also held in this
//  browser (see holdDraft) until the database has it.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, BUCKET } from './lib/supabase.js'

async function userId() {
  const { data } = await supabase.auth.getUser()
  const id = data?.user?.id
  if (!id) throw new Error('Sign in to keep your work.')
  return id
}

function check({ data, error }) {
  if (error) {
    // The tables not existing yet is the one failure worth explaining.
    if (/relation .* does not exist|Could not find the table|column .* does not exist/i.test(error.message))
      throw new Error(
        'Your database is missing the Books tables. Run supabase/migrations/20260926120000_library.sql in the Supabase SQL editor.',
      )
    throw new Error(error.message)
  }
  return data
}

// ── counting ─────────────────────────────────────────────────────────────────

/** Plain text out of the editor's HTML, keeping paragraph and line breaks. */
export function htmlToText(html) {
  if (!html) return ''
  if (typeof DOMParser === 'undefined') return String(html).replace(/<[^>]+>/g, ' ')
  const doc = new DOMParser().parseFromString(
    String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|blockquote|li)>/gi, '</$1>\n\n'),
    'text/html',
  )
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

export const countWords = (s) => (String(s || '').match(/[^\s—–-][^\s]*/g) || []).length

/** Today in the writer's own time zone, as YYYY-MM-DD. */
export function today(d = new Date()) {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

// ── the table of contents ────────────────────────────────────────────────────

export const KINDS = {
  part: { noun: 'part', label: 'Part' },
  chapter: { noun: 'chapter', label: 'Chapter' },
  section: { noun: 'section', label: 'Section' },
}

export function bookTitle(w) {
  return w?.title?.trim() || 'Untitled book'
}

/**
 * Number the contents the way a book does: parts in roman numerals, chapters
 * straight through the book, sections within their chapter.
 */
export function numberContents(pieces) {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV']
  let part = 0
  let chapter = 0
  let section = 0
  let inPart = false
  return [...pieces]
    .sort((a, b) => a.position - b.position)
    .map((p) => {
      if (p.kind === 'part') {
        part++
        inPart = true
        return { ...p, number: roman[part - 1] || String(part), depth: 0 }
      }
      if (p.kind === 'chapter') {
        chapter++
        section = 0
        return { ...p, number: String(chapter), depth: inPart ? 1 : 0 }
      }
      section++
      return { ...p, number: `${chapter || 0}.${section}`, depth: inPart ? 2 : 1 }
    })
}

export function pieceLabel(p) {
  if (p.title?.trim()) return p.title.trim()
  if (p.kind === 'part') return `Part ${p.number || ''}`.trim()
  if (p.kind === 'chapter') return `Chapter ${p.number || ''}`.trim()
  return 'Untitled section'
}

// ── covers ───────────────────────────────────────────────────────────────────

const SIGNED_TTL = 60 * 60

async function signCovers(works) {
  const paths = works.map((w) => w.cover_path).filter(Boolean)
  if (!paths.length) return works
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, SIGNED_TTL)
  const map = Object.fromEntries((data || []).filter((r) => r.signedUrl).map((r) => [r.path, r.signedUrl]))
  return works.map((w) => ({ ...w, coverUrl: w.cover_path ? map[w.cover_path] || null : null }))
}

/** Put a cover image in the bucket and on the book. Returns the updated book. */
export async function uploadCover(workId, file) {
  const uid = await userId()
  const ext = (file.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
  const path = `${uid}/books/${workId}/cover-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: true })
  if (error) throw new Error(`Couldn't save the cover: ${error.message}`)
  const { data: old } = await supabase.from('works').select('cover_path').eq('id', workId).maybeSingle()
  const work = await updateWork(workId, { cover_path: path })
  if (old?.cover_path && old.cover_path !== path) supabase.storage.from(BUCKET).remove([old.cover_path])
  return work
}

export async function removeCover(workId, path) {
  if (path) await supabase.storage.from(BUCKET).remove([path])
  return updateWork(workId, { cover_path: null })
}

// ── books ────────────────────────────────────────────────────────────────────

/** Every book, most recently touched first, with its chapter count and words. */
export async function listWorks({ kind = 'book' } = {}) {
  const uid = await userId()
  const works = check(
    await supabase.from('works').select('*').eq('user_id', uid).eq('kind', kind).order('updated_at', { ascending: false }),
  )
  if (!works.length) return []
  const pieces = check(
    await supabase
      .from('pieces')
      .select('work_id, kind, words, updated_at')
      .in(
        'work_id',
        works.map((w) => w.id),
      ),
  )
  const withStats = works
    .map((w) => {
      const mine = pieces.filter((p) => p.work_id === w.id)
      return {
        ...w,
        chapters: mine.filter((p) => p.kind === 'chapter').length,
        words: mine.reduce((n, p) => n + (p.words || 0), 0),
        touchedAt: mine.reduce((a, p) => (p.updated_at > a ? p.updated_at : a), w.updated_at),
      }
    })
    .sort((a, b) => (a.touchedAt < b.touchedAt ? 1 : -1))
  return signCovers(withStats)
}

const COVER_COLORS = ['#2a1f2d', '#1f2a2a', '#3a2418', '#1d2438', '#33202a', '#23301f']

/** A new book. `blank: false` skips the empty first chapter (an import brings its own). */
export async function createWork({ title = '', blank = true, kind = 'book' } = {}) {
  const uid = await userId()
  const cover_color = COVER_COLORS[Math.floor(Math.random() * COVER_COLORS.length)]
  const work = check(await supabase.from('works').insert({ user_id: uid, cover_color, title, kind }).select().single())
  if (blank) await createPiece(work.id, { kind: 'chapter', position: 0 })
  return work
}

export async function getWork(id) {
  const work = check(await supabase.from('works').select('*').eq('id', id).maybeSingle())
  if (!work) return null
  const pieces = check(
    await supabase
      .from('pieces')
      .select('id, work_id, kind, title, words, status, position, updated_at, published_at')
      .eq('work_id', id)
      .order('position', { ascending: true }),
  )
  const [signed] = await signCovers([work])
  return { work: signed, pieces }
}

export async function updateWork(id, patch) {
  const row = check(await supabase.from('works').update(patch).eq('id', id).select().single())
  const [signed] = await signCovers([row])
  return signed
}

export async function deleteWork(id) {
  const uid = await userId()
  const { data: files } = await supabase.storage.from(BUCKET).list(`${uid}/books/${id}`)
  if (files?.length) await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/books/${id}/${f.name}`))
  check(await supabase.from('works').delete().eq('id', id))
}

// ── pieces: parts, chapters, sections ────────────────────────────────────────

export async function getPiece(id) {
  return check(await supabase.from('pieces').select('*').eq('id', id).maybeSingle())
}

export async function createPiece(workId, { kind = 'chapter', position = 0, title = '', body = '' } = {}) {
  const uid = await userId()
  const words = body ? countWords(htmlToText(body)) : 0
  return check(
    await supabase
      .from('pieces')
      .insert({ work_id: workId, user_id: uid, kind, position, title, body, words })
      .select('id, work_id, kind, title, words, status, position, updated_at, published_at')
      .single(),
  )
}

/** Insert a piece at `index` in the reading order, shifting the rest down. */
export async function insertPiece(workId, pieces, index, kind) {
  const ordered = [...pieces].sort((a, b) => a.position - b.position)
  const created = await createPiece(workId, { kind, position: index })
  const next = [...ordered.slice(0, index), created, ...ordered.slice(index)]
  await reorderPieces(next.map((p) => p.id))
  return next.map((p, position) => ({ ...p, position }))
}

export async function updatePiece(id, patch) {
  return check(await supabase.from('pieces').update(patch).eq('id', id).select().single())
}

export async function deletePiece(id) {
  check(await supabase.from('pieces').delete().eq('id', id))
  dropDraft(id)
}

/** Write a new reading order: ids in the order they should read. */
export async function reorderPieces(ids) {
  await Promise.all(
    ids.map((id, position) => supabase.from('pieces').update({ position }).eq('id', id).then(check)),
  )
}

/** Every piece with its full text, in order — for export and reading. */
export async function getManuscript(workId) {
  const work = check(await supabase.from('works').select('*').eq('id', workId).maybeSingle())
  const pieces = check(
    await supabase.from('pieces').select('*').eq('work_id', workId).order('position', { ascending: true }),
  )
  return { work, pieces }
}

// ── versions ─────────────────────────────────────────────────────────────────

export async function listVersions(pieceId) {
  return check(
    await supabase
      .from('piece_versions')
      .select('*')
      .eq('piece_id', pieceId)
      .order('created_at', { ascending: false })
      .limit(100),
  )
}

export async function snapshot(piece, reason = 'auto') {
  const uid = await userId()
  return check(
    await supabase
      .from('piece_versions')
      .insert({
        piece_id: piece.id,
        user_id: uid,
        title: piece.title || '',
        body: piece.body || '',
        word_count: countWords(htmlToText(piece.body)),
        reason,
      })
      .select()
      .single(),
  )
}

export async function latestVersion(pieceId) {
  const rows = check(
    await supabase
      .from('piece_versions')
      .select('created_at, body')
      .eq('piece_id', pieceId)
      .order('created_at', { ascending: false })
      .limit(1),
  )
  return rows[0] || null
}

// ── writing days ─────────────────────────────────────────────────────────────

export async function addWordsWritten(n) {
  if (!(n > 0)) return
  check(await supabase.rpc('add_words_written', { p_day: today(), p_words: n }))
}

/** The last `days` days of tallies, and the current streak ending today (or yesterday). */
export async function writingStats(days = 30) {
  const uid = await userId()
  const since = new Date()
  since.setDate(since.getDate() - 400)
  const rows = check(
    await supabase
      .from('writing_days')
      .select('day, words')
      .eq('user_id', uid)
      .gte('day', today(since))
      .order('day', { ascending: false }),
  )
  const byDay = Object.fromEntries(rows.map((r) => [r.day, r.words]))

  const recent = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = today(d)
    recent.push({ day: key, words: byDay[key] || 0 })
  }

  // A streak survives until the end of today: not having written *yet* doesn't break it.
  let streak = 0
  const cursor = new Date()
  if (!byDay[today(cursor)]) cursor.setDate(cursor.getDate() - 1)
  while (byDay[today(cursor)] > 0) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return { today: byDay[today()] || 0, streak, recent }
}

// The daily target follows her between browsers, on her account rather than a table.
export async function getDailyGoal() {
  const { data } = await supabase.auth.getUser()
  return Number(data?.user?.user_metadata?.daily_words_goal) || 0
}

export async function setDailyGoal(n) {
  const words = Math.max(0, Math.round(Number(n) || 0))
  const { error } = await supabase.auth.updateUser({ data: { daily_words_goal: words } })
  if (error) throw new Error(error.message)
  return words
}

// ── the safety net: unsaved text, held in this browser ───────────────────────

const draftKey = (id) => `petrichor-draft:${id}`

export function holdDraft(id, fields) {
  try {
    localStorage.setItem(draftKey(id), JSON.stringify({ ...fields, at: new Date().toISOString() }))
  } catch {
    /* storage full or blocked: the database save is still on its way */
  }
}

export function readDraft(id) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(id)) || 'null')
  } catch {
    return null
  }
}

export function dropDraft(id) {
  try {
    localStorage.removeItem(draftKey(id))
  } catch {
    /* nothing to drop */
  }
}

// ── publishing ───────────────────────────────────────────────────────────────

/** Show a chapter or poem to approved readers, or take it back to drafts. */
export async function setPublished(id, on) {
  return updatePiece(id, { published_at: on ? new Date().toISOString() : null })
}

// ── poems ────────────────────────────────────────────────────────────────────
// A poem is a piece in a 'poems' work (a collection). Every poet gets one
// collection called "Poems" to begin with; more can be made.

export async function poemCollections() {
  const uid = await userId()
  return check(
    await supabase.from('works').select('*').eq('user_id', uid).eq('kind', 'poems').order('created_at', { ascending: true }),
  )
}

export async function ensurePoemCollection() {
  const existing = await poemCollections()
  if (existing.length) return existing[0]
  return createWork({ title: 'Poems', blank: false, kind: 'poems' })
}

export async function createPoemCollection(title) {
  return createWork({ title: String(title || '').trim() || 'Untitled collection', blank: false, kind: 'poems' })
}

/** Every poem, newest touched first, with enough of its text to recognise it. */
export async function listPoems() {
  const collections = await poemCollections()
  if (!collections.length) return { collections, poems: [] }
  const poems = check(
    await supabase
      .from('pieces')
      .select('id, work_id, title, body, words, status, position, updated_at, published_at')
      .in(
        'work_id',
        collections.map((c) => c.id),
      )
      .order('updated_at', { ascending: false }),
  )
  return { collections, poems }
}

/** A new poem at the end of a collection (the first one, if none is named). */
export async function createPoem({ workId, title = '', body = '' } = {}) {
  const collection = workId ? { id: workId } : await ensurePoemCollection()
  const last = check(
    await supabase.from('pieces').select('position').eq('work_id', collection.id).order('position', { ascending: false }).limit(1),
  )
  return createPiece(collection.id, { kind: 'chapter', position: (last[0]?.position ?? -1) + 1, title, body })
}

export async function movePoem(id, workId) {
  return updatePiece(id, { work_id: workId })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Reading what's been published, and talking about it.
//
//  Row-level security does the gatekeeping: an approved reader only ever gets
//  published chapters and poems back, and only their books; the owner gets
//  everything of hers. These queries don't need to know which is asking.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, BUCKET } from './lib/supabase.js'

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// `*` rather than a list, so a column added later (the cover credit) is simply there when it is.
const WORK_FIELDS = '*'

/**
 * Everything published: { books: [work + chapters], poems: [...], collections: [work + poems] }.
 * Chapters keep their book order; poems come newest first, and again under
 * the collection they belong to.
 */
export async function listPublished() {
  const rows = check(
    await supabase
      .from('pieces')
      .select(`id, work_id, kind, title, words, position, published_at, body, works(${WORK_FIELDS})`)
      .not('published_at', 'is', null)
      .order('position', { ascending: true }),
  )
  const books = new Map()
  const collections = new Map()
  const poems = []
  for (const r of rows) {
    const work = r.works
    if (!work) continue
    if (work.kind === 'poems') {
      poems.push({ ...r, collection: work.title })
      if (!collections.has(work.id)) collections.set(work.id, { ...work, poems: [] })
      continue
    }
    if (!books.has(work.id)) books.set(work.id, { ...work, chapters: [] })
    books.get(work.id).chapters.push(r)
  }
  poems.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))
  for (const p of poems) collections.get(p.work_id).poems.push(p)

  // Covers are private files; sign them for this reader.
  const works = [...books.values(), ...collections.values()]
  const paths = works.map((w) => w.cover_path).filter(Boolean)
  if (paths.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
    const url = Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
    works.forEach((w) => (w.coverUrl = w.cover_path ? url[w.cover_path] || null : null))
  }
  return { books: [...books.values()], poems, collections: [...collections.values()] }
}

// ── comments ─────────────────────────────────────────────────────────────────

export async function listComments(pieceId) {
  return check(
    await supabase.from('comments').select('*').eq('piece_id', pieceId).order('created_at', { ascending: true }),
  )
}

/**
 * A comment, or with `parentId` a reply. Replies always hang off the comment
 * that started the thread (the database re-points a reply to a reply too).
 */
export async function addComment(pieceId, { name, body, parentId = null }) {
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to comment.')
  const row = { piece_id: pieceId, user_id: data.user.id, name: String(name).trim().slice(0, 60), body: String(body).trim().slice(0, 4000) }
  if (parentId) row.parent_id = parentId
  const { data: saved, error } = await supabase.from('comments').insert(row).select().single()
  if (error && /parent_id/.test(error.message))
    throw new Error('Replies need a database update first: run supabase/migrations/20261014120000_replies_and_cover_credit.sql in the Supabase SQL editor.')
  return check({ data: saved, error })
}

/** Comments as threads: each one that started a conversation, with its replies in order. */
export function threadsOf(comments) {
  const byTime = [...comments].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const threads = new Map()
  for (const c of byTime) {
    const thread = c.parent_id && threads.get(c.parent_id)
    if (thread) thread.replies.push(c)
    else threads.set(c.id, { ...c, replies: [] }) // a thread's start, or a reply whose comment is gone
  }
  return [...threads.values()]
}

export async function deleteComment(id) {
  check(await supabase.from('comments').delete().eq('id', id))
}

/**
 * The owner's inbox: newest comments across everything, with what they're on.
 * A reply carries `answering`, the name of whoever started its thread.
 */
export async function recentComments(limit = 100) {
  const rows = check(
    await supabase
      .from('comments')
      .select('*, pieces(id, title, kind, work_id, works(title, kind))')
      .order('created_at', { ascending: false })
      .limit(limit),
  )
  const missing = [...new Set(rows.map((c) => c.parent_id).filter((id) => id && !rows.some((c) => c.id === id)))]
  const parents = missing.length ? check(await supabase.from('comments').select('id, name').in('id', missing)) : []
  const nameOf = Object.fromEntries([...rows, ...parents].map((c) => [c.id, c.name]))
  return rows.map((c) => (c.parent_id ? { ...c, answering: nameOf[c.parent_id] || null } : c))
}

export async function markCommentsSeen(ids) {
  if (!ids.length) return
  check(await supabase.from('comments').update({ seen_at: new Date().toISOString() }).in('id', ids))
}

export async function unseenCount() {
  const { count } = await supabase.from('comments').select('id', { count: 'exact', head: true }).is('seen_at', null)
  return count || 0
}

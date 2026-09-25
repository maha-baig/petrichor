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

const WORK_FIELDS = 'id, title, subtitle, author, description, kind, cover_path, cover_color, dedication, epigraph'

/**
 * Everything published: { books: [work + chapters], poems: [...] }.
 * Chapters keep their book order; poems come newest first.
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
  const poems = []
  for (const r of rows) {
    const work = r.works
    if (!work) continue
    if (work.kind === 'poems') {
      poems.push({ ...r, collection: work.title })
      continue
    }
    if (!books.has(work.id)) books.set(work.id, { ...work, chapters: [] })
    books.get(work.id).chapters.push(r)
  }
  poems.sort((a, b) => (a.published_at < b.published_at ? 1 : -1))

  // Covers are private files; sign them for this reader.
  const list = [...books.values()]
  const paths = list.map((b) => b.cover_path).filter(Boolean)
  if (paths.length) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600)
    const url = Object.fromEntries((data || []).filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]))
    list.forEach((b) => (b.coverUrl = b.cover_path ? url[b.cover_path] || null : null))
  }
  return { books: list, poems }
}

// ── comments ─────────────────────────────────────────────────────────────────

export async function listComments(pieceId) {
  return check(
    await supabase.from('comments').select('*').eq('piece_id', pieceId).order('created_at', { ascending: true }),
  )
}

export async function addComment(pieceId, { name, body }) {
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to comment.')
  return check(
    await supabase
      .from('comments')
      .insert({ piece_id: pieceId, user_id: data.user.id, name: String(name).trim().slice(0, 60), body: String(body).trim().slice(0, 4000) })
      .select()
      .single(),
  )
}

export async function deleteComment(id) {
  check(await supabase.from('comments').delete().eq('id', id))
}

/** The owner's inbox: newest comments across everything, with what they're on. */
export async function recentComments(limit = 100) {
  return check(
    await supabase
      .from('comments')
      .select('*, pieces(id, title, kind, work_id, works(title, kind))')
      .order('created_at', { ascending: false })
      .limit(limit),
  )
}

export async function markCommentsSeen(ids) {
  if (!ids.length) return
  check(await supabase.from('comments').update({ seen_at: new Date().toISOString() }).in('id', ids))
}

export async function unseenCount() {
  const { count } = await supabase.from('comments').select('id', { count: 'exact', head: true }).is('seen_at', null)
  return count || 0
}

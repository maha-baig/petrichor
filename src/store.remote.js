// ─────────────────────────────────────────────────────────────────────────────
//  The remote backend: Supabase.
//
//  Rows in `workspaces`, images in the private `moodboards` bucket, and
//  row-level security doing the real work — the anon key literally cannot ask
//  for another poet's rows (see supabase/schema.sql).
//
//  Two shapes meet here. In the database, an image is { id, path, aspect } and
//  the file lives in storage. In the app, an image is { id, img, aspect } where
//  `img` is something an <img> can render. Everything below exists to translate
//  between those two, so the components never learn where the bytes live.
// ─────────────────────────────────────────────────────────────────────────────

import { supabase, BUCKET } from './lib/supabase.js'

const SIGNED_TTL = 60 * 60 // an hour is plenty for one sitting

async function userId() {
  const { data } = await supabase.auth.getUser()
  const id = data?.user?.id
  if (!id) throw new Error('Sign in to keep your work.')
  return id
}

// ── data URL ⇄ storage ───────────────────────────────────────────────────────

function dataUrlToBlob(dataUrl) {
  const s = String(dataUrl)
  const comma = s.indexOf(',')
  const head = s.slice(0, comma)
  const body = s.slice(comma + 1)
  const mime = /^data:([^;,]+)/.exec(head)?.[1] || 'image/jpeg'
  if (!/;base64/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime })
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

const extFor = (mime) =>
  mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : mime.includes('svg') ? 'svg' : 'jpg'

async function upload(path, dataUrl) {
  const blob = dataUrlToBlob(dataUrl)
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: true })
  if (error) throw new Error(`Couldn't save an image: ${error.message}`)
  return path
}

// One round trip for the whole board rather than one per tile.
async function signAll(paths) {
  const wanted = paths.filter(Boolean)
  if (!wanted.length) return {}
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(wanted, SIGNED_TTL)
  if (error) throw new Error(error.message)
  const map = {}
  for (const row of data || []) if (row.signedUrl) map[row.path] = row.signedUrl
  return map
}

// ── row ⇄ workspace ──────────────────────────────────────────────────────────

// Database row → what the app holds. Images arrive as signed URLs.
async function fromRow(row) {
  if (!row) return null
  const paths = [...(row.images || []).map((i) => i.path), row.generated?.path].filter(Boolean)
  const signed = await signAll(paths)
  return {
    id: row.id,
    title: row.title || '',
    prompt: row.prompt || { text: '', seed_image: '' },
    mood: row.mood || 'melancholy',
    words: row.words || null,
    images: (row.images || []).map((i) => ({ ...i, img: signed[i.path] || '' })),
    boardPalette: row.board_palette || [],
    reading: row.reading || null,
    generated: row.generated
      ? { ...row.generated, image: signed[row.generated.path] || '' }
      : null,
    poem: row.poem || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * What the app holds → a database row, uploading any image that is still a
 * data URL. Already-uploaded tiles keep their path and cost nothing.
 */
async function toRow(ws, uid) {
  const images = []
  for (const tile of ws.images || []) {
    if (tile.path) {
      images.push({ id: tile.id, path: tile.path, aspect: tile.aspect })
      continue
    }
    if (!tile.img?.startsWith('data:')) continue // nothing we can store
    const blob = dataUrlToBlob(tile.img)
    const path = `${uid}/${ws.id}/${tile.id}.${extFor(blob.type)}`
    await upload(path, tile.img)
    images.push({ id: tile.id, path, aspect: tile.aspect })
  }

  let generated = null
  if (ws.generated?.path) {
    generated = { path: ws.generated.path, prompt: ws.generated.prompt || '' }
  } else if (ws.generated?.image?.startsWith('data:')) {
    const blob = dataUrlToBlob(ws.generated.image)
    const path = `${uid}/${ws.id}/generated.${extFor(blob.type)}`
    await upload(path, ws.generated.image)
    generated = { path, prompt: ws.generated.prompt || '' }
  }

  return {
    id: ws.id,
    user_id: uid,
    title: ws.title || '',
    prompt: ws.prompt || { text: '', seed_image: '' },
    mood: ws.mood || 'melancholy',
    words: ws.words || null,
    images,
    board_palette: ws.boardPalette || [],
    reading: ws.reading || null,
    generated,
    poem: ws.poem || '',
  }
}

// ── the six ──────────────────────────────────────────────────────────────────

export async function listWorkspaces() {
  const uid = await userId()
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('user_id', uid)
    .order('updated_at', { ascending: false })
  if (error) throw new Error(error.message)
  return Promise.all((data || []).map(fromRow))
}

export async function getWorkspace(id) {
  if (!id) return null
  const { data, error } = await supabase.from('workspaces').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return fromRow(data)
}

export async function saveWorkspace(ws) {
  const uid = await userId()
  const row = await toRow(ws, uid)
  const { data, error } = await supabase.from('workspaces').upsert(row).select().single()
  if (error) throw new Error(error.message)
  return fromRow(data)
}

export async function patchWorkspace(id, patch) {
  const current = await getWorkspace(id)
  if (!current) return null
  return saveWorkspace({ ...current, ...patch })
}

export async function deleteWorkspace(id) {
  const uid = await userId()
  // take the images with it, or the bucket fills with orphans
  const { data: files } = await supabase.storage.from(BUCKET).list(`${uid}/${id}`)
  if (files?.length) {
    await supabase.storage.from(BUCKET).remove(files.map((f) => `${uid}/${id}/${f.name}`))
  }
  const { error } = await supabase.from('workspaces').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function pruneEmpty(exceptId) {
  const all = await listWorkspaces()
  const dead = all.filter(
    (w) =>
      w.id !== exceptId &&
      !w.images?.length &&
      !w.poem?.trim() &&
      !w.generated &&
      !w.title?.trim() &&
      !w.words,
  )
  await Promise.all(dead.map((w) => deleteWorkspace(w.id)))
  return dead.length
}

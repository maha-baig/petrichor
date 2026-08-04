// ─────────────────────────────────────────────────────────────────────────────
//  Where the work is kept.
//
//  Today this is IndexedDB in the poet's own browser — no account, no network,
//  works offline, holds base64 images without complaint. Every call is async and
//  every workspace is a whole document, which is exactly the shape a Supabase
//  table + storage bucket will take later. To move to Supabase, reimplement the
//  six functions at the bottom; nothing that calls them has to change.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'petrichor'
const DB_VERSION = 1
const STORE = 'workspaces'

let dbPromise = null

function open() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' })
        os.createIndex('updatedAt', 'updatedAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode, run) {
  const db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)
    let out
    try {
      out = run(store)
    } catch (e) {
      reject(e)
      return
    }
    t.oncomplete = () => resolve(out?.result !== undefined ? out.result : out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

const now = () => new Date().toISOString()

// A workspace is one chosen prompt and everything that grew out of it.
export function blankWorkspace({ prompt, mood = 'melancholy' }) {
  return {
    id: `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    title: '', // empty = fall back to the prompt line
    prompt: { text: prompt?.text || '', seed_image: prompt?.seed_image || '' },
    mood,
    words: null, // { evocative, searchTerms, palette } once the word engine answers
    images: [], // [{ id, img, aspect }] — the pasted mood board
    boardPalette: [], // hexes extracted from those images
    reading: null, // what the vision model saw in the board
    generated: null, // { image, prompt } from ComfyUI
    poem: '',
    createdAt: now(),
    updatedAt: now(),
  }
}

// A workspace nobody has put anything into — safe to sweep away.
export function isEmpty(ws) {
  return (
    !ws.images?.length &&
    !ws.poem?.trim() &&
    !ws.generated?.image &&
    !ws.title?.trim() &&
    !ws.words
  )
}

export function workspaceTitle(ws) {
  if (ws?.title?.trim()) return ws.title.trim()
  const line = ws?.prompt?.text?.trim() || 'Untitled workspace'
  return line.length > 72 ? line.slice(0, 71) + '…' : line
}

// ── the six functions Supabase will one day implement ────────────────────────

export async function listWorkspaces() {
  const all = await tx('readonly', (s) => s.getAll())
  return (all || []).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
}

export async function getWorkspace(id) {
  if (!id) return null
  return (await tx('readonly', (s) => s.get(id))) || null
}

export async function saveWorkspace(ws) {
  const next = { ...ws, updatedAt: now() }
  await tx('readwrite', (s) => s.put(next))
  return next
}

// Merge a partial change into a stored workspace — the writing pane and the
// mood board both save this way, many small times.
export async function patchWorkspace(id, patch) {
  const current = await getWorkspace(id)
  if (!current) return null
  return saveWorkspace({ ...current, ...patch })
}

export async function deleteWorkspace(id) {
  await tx('readwrite', (s) => s.delete(id))
}

// Browsing prompts shouldn't litter the list with husks.
export async function pruneEmpty(exceptId) {
  const all = await listWorkspaces()
  const dead = all.filter((w) => w.id !== exceptId && isEmpty(w))
  await Promise.all(dead.map((w) => deleteWorkspace(w.id)))
  return dead.length
}

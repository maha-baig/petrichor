// ─────────────────────────────────────────────────────────────────────────────
//  Where the work is kept — the front door.
//
//  Two backends live behind these six functions:
//    · store.local.js  — IndexedDB, this browser, no account
//    · store.remote.js — Supabase, her account, any browser
//
//  Which one answers depends on whether VITE_SUPABASE_URL / _ANON_KEY are set
//  and whether she's signed in. Nothing that calls these knows the difference.
// ─────────────────────────────────────────────────────────────────────────────

import * as local from './store.local.js'
import * as remote from './store.remote.js'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'

// The session is read once and kept fresh by an auth listener, so every call
// doesn't pay a round trip to find out who's asking.
let signedIn = false
if (isSupabaseConfigured) {
  supabase.auth.getSession().then(({ data }) => {
    signedIn = Boolean(data?.session)
  })
  supabase.auth.onAuthStateChange((_event, session) => {
    signedIn = Boolean(session)
  })
}

export const usingRemote = () => isSupabaseConfigured && signedIn
const backend = () => (usingRemote() ? remote : local)

const now = () => new Date().toISOString()

// A workspace is one chosen prompt and everything that grew out of it.
export function blankWorkspace({ prompt, mood = 'melancholy' }) {
  return {
    // a uuid either way — Postgres insists, and IndexedDB doesn't mind
    id:
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
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
    !ws.images?.length && !ws.poem?.trim() && !ws.generated && !ws.title?.trim() && !ws.words
  )
}

export function workspaceTitle(ws) {
  if (ws?.title?.trim()) return ws.title.trim()
  const line = ws?.prompt?.text?.trim() || 'Untitled workspace'
  return line.length > 72 ? line.slice(0, 71) + '…' : line
}

// ── the six ──────────────────────────────────────────────────────────────────

export const listWorkspaces = (...a) => backend().listWorkspaces(...a)
export const getWorkspace = (...a) => backend().getWorkspace(...a)
export const saveWorkspace = (...a) => backend().saveWorkspace(...a)
export const patchWorkspace = (...a) => backend().patchWorkspace(...a)
export const deleteWorkspace = (...a) => backend().deleteWorkspace(...a)
export const pruneEmpty = (...a) => backend().pruneEmpty(...a)

// ── moving in ────────────────────────────────────────────────────────────────

/** How much work is sitting in this browser, waiting to be brought across. */
export async function localCount() {
  if (!isSupabaseConfigured) return 0
  const all = await local.listWorkspaces()
  return all.filter((w) => !isEmpty(w)).length
}

/**
 * Copy everything from this browser into her account, once. Each workspace is
 * re-created with a fresh id so a half-finished import can be run again without
 * making duplicates of what already made it across.
 */
export async function importLocalWorkspaces({ clearAfter = false } = {}) {
  if (!usingRemote()) throw new Error('Sign in first.')
  const mine = (await local.listWorkspaces()).filter((w) => !isEmpty(w))
  let moved = 0
  for (const ws of mine) {
    const fresh = { ...ws, id: blankWorkspace({ prompt: ws.prompt }).id }
    await remote.saveWorkspace(fresh)
    moved++
    if (clearAfter) await local.deleteWorkspace(ws.id)
  }
  return moved
}

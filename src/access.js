// ─────────────────────────────────────────────────────────────────────────────
//  Who is looking, and what they may do.
//
//    owner     — writes everything (decided by the database: public.is_owner())
//    reader    — a friend she approved; reads what she has published, comments
//    pending   — asked to read, waiting for her
//    blocked   — asked, and was turned away
//    none      — signed in, hasn't asked yet
//    signedOut — nobody signed in
//
//  The screen follows this, but it isn't the lock: the database refuses
//  anything a role isn't allowed, whatever the app does.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react'
import { supabase, isSupabaseConfigured } from './lib/supabase.js'
import { useSession } from './auth.jsx'

async function roleFor(session) {
  if (!session) return 'signedOut'
  const { data: owner, error } = await supabase.rpc('is_owner')
  if (error) throw new Error(error.message)
  if (owner) return 'owner'
  const { data: row } = await supabase.from('readers').select('status').eq('user_id', session.user.id).maybeSingle()
  if (!row) return 'none'
  return row.status === 'approved' ? 'reader' : row.status
}

/** { session, role } — role is undefined while it's being worked out. */
export function useAccess() {
  const session = useSession()
  const [role, setRole] = useState(undefined)
  const [bump, setBump] = useState(0)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // No accounts at all: a purely local, single-user Petrichor.
      setRole('owner')
      return
    }
    if (session === undefined) return
    let alive = true
    setRole(undefined)
    roleFor(session)
      .then((r) => alive && setRole(r))
      .catch(() => alive && setRole(session ? 'none' : 'signedOut'))
    return () => {
      alive = false
    }
  }, [session, bump])

  return { session, role, refresh: () => setBump((n) => n + 1) }
}

// ── friends asking to read ───────────────────────────────────────────────────

export async function requestAccess({ name, note }) {
  const { data } = await supabase.auth.getUser()
  const user = data?.user
  if (!user) throw new Error('Sign in first.')
  const { error } = await supabase.from('readers').insert({
    user_id: user.id,
    email: user.email || '',
    name: String(name || '').trim().slice(0, 60),
    note: String(note || '').trim().slice(0, 300),
    status: 'pending',
  })
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message)
}

// ── the owner deciding ───────────────────────────────────────────────────────

export async function listReaders() {
  const { data, error } = await supabase.from('readers').select('*').order('requested_at', { ascending: false })
  if (error) throw new Error(error.message)
  return data
}

export async function decideReader(userId, status) {
  const { error } = await supabase
    .from('readers')
    .update({ status, decided_at: new Date().toISOString() })
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

export async function removeReader(userId) {
  const { error } = await supabase.from('readers').delete().eq('user_id', userId)
  if (error) throw new Error(error.message)
}

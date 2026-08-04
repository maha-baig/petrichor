import { createClient } from '@supabase/supabase-js'

// Both are safe in the browser: the anon key can only do what row-level
// security allows, and every policy in supabase/schema.sql is "your own rows".
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // the magic link comes back with a token in the URL
      },
    })
  : null

export const BUCKET = 'moodboards'

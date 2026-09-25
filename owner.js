// ─────────────────────────────────────────────────────────────────────────────
//  Who may use the engines. The AI tools spend a daily allowance and the
//  Notion routes read private pages, so they answer the owner only.
//
//  "The owner" is decided by the database (public.is_owner(), tied to her
//  account id — see supabase/migrations/*_sections_access_publishing.sql), not
//  by an email in an env var: the request's Supabase session is checked by
//  asking Supabase itself. Answers are cached for a minute per session.
// ─────────────────────────────────────────────────────────────────────────────

const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseAnon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

const cache = new Map() // jwt → { owner, until }
const TTL = 60 * 1000

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** Throws unless the request carries the owner's session. */
export async function requireOwner(req) {
  // Without Supabase there are no accounts at all: a purely local, single-user setup.
  if (!supabaseUrl() || !supabaseAnon()) return
  const jwt = (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new HttpError(401, 'Sign in to use this.')

  const hit = cache.get(jwt)
  let owner = hit && hit.until > Date.now() ? hit.owner : null
  if (owner === null) {
    const res = await fetch(`${supabaseUrl()}/rest/v1/rpc/is_owner`, {
      method: 'POST',
      headers: { apikey: supabaseAnon(), Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
    if (res.status === 401) throw new HttpError(401, 'Your session has expired. Sign in again.')
    if (!res.ok) throw new HttpError(503, 'Couldn’t check who you are. Try again in a moment.')
    owner = (await res.json()) === true
    cache.set(jwt, { owner, until: Date.now() + TTL })
    if (cache.size > 500) cache.delete(cache.keys().next().value)
  }
  if (!owner) throw new HttpError(403, 'Only the owner of this Petrichor can use this.')
}

/** Express middleware form. */
export const ownerOnly = async (req, res, next) => {
  try {
    await requireOwner(req)
    next()
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}

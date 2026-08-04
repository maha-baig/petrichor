import crypto from 'node:crypto'

/**
 * Gathering images for the mood board.
 *
 * These sources hunt from the search terms the word engine already wrote, and
 * hand back candidates the poet still has to choose between — the choosing is
 * the part that makes a board hers, so it stays.
 *
 * Every source here licenses what it returns: each candidate arrives with its
 * creator and licence attached. Cosmos is deliberately not one of them. It
 * curates other people's copyrighted work without granting any licence, and
 * its images carry no author you could credit even if you wanted to — so the
 * app points you at Cosmos to go looking yourself, and never fetches from it.
 *
 * Sources are pluggable the same way the text providers are (see MUSE_PROVIDER
 * in app.js). All of them run server-side, so they work on the deployed site,
 * not just on her machine.
 */

// ── Signed proxy ────────────────────────────────────────────────────
// Every candidate has to come back through us: the browser can't fetch
// cdn.cosmos.so or staticflickr directly (no CORS headers), and an image
// loaded cross-origin taints the collage canvas in download.js.
//
// An allowlist of hosts won't do — Openverse results live on whatever
// domain the original photographer used. So the proxy only fetches URLs it
// can prove IT handed out, by HMAC. Without this, /api/images/proxy is an
// open relay pointed at anything, including your own private network.
const SECRET =
  process.env.IMAGE_PROXY_SECRET ||
  (process.env.NODE_ENV === 'production' ? null : 'petrichor-dev-only-secret')

function sign(url) {
  if (!SECRET) throw new Error('IMAGE_PROXY_SECRET is not set.')
  return crypto.createHmac('sha256', SECRET).update(url).digest('base64url').slice(0, 24)
}

export function verify(url, sig) {
  if (!SECRET || !url || !sig) return false
  const expected = Buffer.from(sign(url))
  const given = Buffer.from(String(sig))
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}

const proxied = (url) => `/api/images/proxy?url=${encodeURIComponent(url)}&sig=${sign(url)}`

// ── Sources ─────────────────────────────────────────────────────────

// Most Openverse licences read well as "CC " + the code; these two don't.
const LICENSE_LABELS = { cc0: 'CC0', pdm: 'Public domain' }
const licenseLabel = (code) =>
  code ? LICENSE_LABELS[code] || `CC ${String(code).toUpperCase()}` : null

async function openverse(term, count) {
  const u = new URL('https://api.openverse.org/v1/images/')
  u.searchParams.set('q', term)
  u.searchParams.set('page_size', String(count))
  u.searchParams.set('mature', 'false')
  // Only work that may be used commercially AND altered. Unfiltered, most of
  // what comes back is NC or ND — and ND is flatly at odds with an app whose
  // point is making something new out of what you gathered. This leaves BY,
  // BY-SA and CC0: attribution is the cost, and BY-SA asks that anything
  // derived carry the same licence on.
  u.searchParams.set('license_type', 'commercial,modification')

  const r = await fetch(u, { headers: { 'User-Agent': 'petrichor/0.1' } })
  if (!r.ok) throw new Error(`Openverse is not answering (${r.status}).`)
  const data = await r.json()

  return (data.results || []).map((x) => ({
    id: `ov-${x.id}`,
    thumb: proxied(x.thumbnail || x.url),
    full: proxied(x.url),
    aspect: x.width && x.height ? x.width / x.height : null,
    credit: x.creator || null,
    license: licenseLabel(x.license),
    link: x.foreign_landing_url || null,
  }))
}

async function pexels(term, count) {
  const key = process.env.PEXELS_API_KEY
  if (!key) throw new Error('PEXELS_API_KEY is not set.')
  const u = new URL('https://api.pexels.com/v1/search')
  u.searchParams.set('query', term)
  u.searchParams.set('per_page', String(count))

  const r = await fetch(u, { headers: { Authorization: key } })
  if (!r.ok) throw new Error(`Pexels is not answering (${r.status}).`)
  const data = await r.json()

  return (data.photos || []).map((p) => ({
    id: `px-${p.id}`,
    thumb: proxied(p.src.medium),
    full: proxied(p.src.large),
    aspect: p.width && p.height ? p.width / p.height : null,
    credit: p.photographer || null,
    license: 'Pexels',
    link: p.url || null,
  }))
}

async function unsplash(term, count) {
  const key = process.env.UNSPLASH_ACCESS_KEY
  if (!key) throw new Error('UNSPLASH_ACCESS_KEY is not set.')
  const u = new URL('https://api.unsplash.com/search/photos')
  u.searchParams.set('query', term)
  u.searchParams.set('per_page', String(count))

  const r = await fetch(u, { headers: { Authorization: `Client-ID ${key}` } })
  if (!r.ok) throw new Error(`Unsplash is not answering (${r.status}).`)
  const data = await r.json()

  return (data.results || []).map((p) => ({
    id: `us-${p.id}`,
    thumb: proxied(p.urls.small),
    full: proxied(p.urls.regular),
    aspect: p.width && p.height ? p.width / p.height : null,
    credit: p.user?.name || null,
    license: 'Unsplash',
    link: p.links?.html || null,
  }))
}

const SOURCES = { openverse, pexels, unsplash }

// Which sources this deployment can actually serve. Openverse needs no key,
// so there is always at least one — that's what makes the feature work on
// Vercel without her setting anything up.
export function availableSources() {
  const wanted = (process.env.IMAGE_SOURCES || 'openverse,pexels,unsplash')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => SOURCES[s])
  const usable = wanted.filter((s) => {
    if (s === 'pexels') return !!process.env.PEXELS_API_KEY
    if (s === 'unsplash') return !!process.env.UNSPLASH_ACCESS_KEY
    return true
  })
  return SECRET ? usable : []
}

export async function searchImages({ term, source, count = 12 }) {
  const available = availableSources()
  if (!available.length) throw new Error('No image source is configured.')

  const chosen = available.includes(source) ? source : available[0]
  const results = await SOURCES[chosen](String(term).slice(0, 120), Math.min(count, 24))
  return { source: chosen, results }
}

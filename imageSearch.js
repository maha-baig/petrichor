import crypto from 'node:crypto'

/**
 * Gathering images for the mood board.
 *
 * The poet used to hunt in Cosmos and paste the results in by hand. These
 * sources do the hunting from the search terms the word engine already wrote,
 * and hand back candidates she still has to choose between — the choosing is
 * the part that makes a board hers, so it stays.
 *
 * Sources are pluggable the same way the text providers are (see MUSE_PROVIDER
 * in app.js). All of them run server-side, so they work on the deployed site,
 * not just on her machine.
 */

// Cosmos serves its markup to browsers; without a browser UA it answers 403.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

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

async function openverse(term, count) {
  const u = new URL('https://api.openverse.org/v1/images/')
  u.searchParams.set('q', term)
  u.searchParams.set('page_size', String(count))
  u.searchParams.set('mature', 'false')

  const r = await fetch(u, { headers: { 'User-Agent': 'petrichor/0.1' } })
  if (!r.ok) throw new Error(`Openverse is not answering (${r.status}).`)
  const data = await r.json()

  return (data.results || []).map((x) => ({
    id: `ov-${x.id}`,
    thumb: proxied(x.thumbnail || x.url),
    full: proxied(x.url),
    aspect: x.width && x.height ? x.width / x.height : null,
    credit: x.creator || null,
    license: x.license ? `CC ${String(x.license).toUpperCase()}` : null,
    link: x.foreign_landing_url || null,
  }))
}

// Cosmos has no API. Its explore page is server-rendered though, so the
// image ids are sitting in the HTML — /search?q= 307s to /explore?q=.
// This is unsanctioned and will break the day they change their markup;
// it fails soft (empty list, clear message) rather than taking the page down.
async function cosmos(term, count) {
  const url = `https://www.cosmos.so/explore?q=${encodeURIComponent(term)}`
  const r = await fetch(url, {
    headers: { 'User-Agent': BROWSER_UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
  })
  if (!r.ok) throw new Error(`Cosmos answered ${r.status}. It may be blocking the server.`)

  const html = await r.text()
  const ids = [
    ...new Set(
      [...html.matchAll(/cdn\.cosmos\.so\/([0-9a-f-]{32,40})/gi)].map((m) => m[1].toLowerCase()),
    ),
  ].slice(0, count)

  if (!ids.length) throw new Error('Cosmos returned a page with no images in it.')

  return ids.map((id) => ({
    id: `cs-${id}`,
    thumb: proxied(`https://cdn.cosmos.so/${id}?format=webp&w=400`),
    full: proxied(`https://cdn.cosmos.so/${id}?format=webp&w=1000`),
    aspect: null, // unknown until the browser loads it; MoodBoard measures it anyway
    credit: null,
    license: null,
    link: `https://www.cosmos.so/explore?q=${encodeURIComponent(term)}`,
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

const SOURCES = { openverse, cosmos, pexels, unsplash }

// Which sources this deployment can actually serve. Openverse needs no key,
// so there is always at least one — that's what makes the feature work on
// Vercel without her setting anything up.
export function availableSources() {
  const wanted = (process.env.IMAGE_SOURCES || 'openverse,cosmos')
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

// ─────────────────────────────────────────────────────────────────────────────
//  Notion → Petrichor.
//
//  A private Notion integration (NOTION_TOKEN) reads the pages she has shared
//  with it. Notion's API can't be called from a browser, so the app asks these
//  routes, and they only answer the account named in NOTION_OWNER_EMAIL:
//  every request carries her Supabase session, which is checked with Supabase
//  before Notion is touched. Anyone else who signs in gets a polite no.
//
//  Pages come back as HTML in the same small vocabulary the chapter editor
//  speaks, with every line break kept — Notion poems stay poems.
// ─────────────────────────────────────────────────────────────────────────────

const NOTION = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'
const MAX_DEPTH = 3 // nested blocks (toggles, list items) followed this deep
const MAX_BLOCKS = 5000 // one page; a safety net against runaway fetching

const token = () => process.env.NOTION_TOKEN
const owner = () => (process.env.NOTION_OWNER_EMAIL || '').trim().toLowerCase()
const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const supabaseAnon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

// ── who's asking ─────────────────────────────────────────────────────────────

async function requireOwner(req) {
  if (!token()) throw new HttpError(503, 'Notion isn’t connected yet: NOTION_TOKEN is not set on the server.')
  if (!owner()) throw new HttpError(503, 'Notion import needs NOTION_OWNER_EMAIL set on the server.')
  const jwt = (req.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) throw new HttpError(401, 'Sign in to import from Notion.')
  const res = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: supabaseAnon(), Authorization: `Bearer ${jwt}` },
  })
  if (!res.ok) throw new HttpError(401, 'Your session has expired. Sign in again.')
  const user = await res.json()
  if ((user?.email || '').toLowerCase() !== owner())
    throw new HttpError(403, 'Notion import is only switched on for the owner of this Notion workspace.')
  return user
}

// ── talking to Notion ────────────────────────────────────────────────────────

async function notion(path, { method = 'GET', body } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`${NOTION}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        'Notion-Version': NOTION_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 429) {
      // Notion allows ~3 requests a second; wait as long as it asks.
      const wait = Number(res.headers.get('retry-after') || 1) * 1000
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new HttpError(502, 'Notion rejected the token. Check NOTION_TOKEN.')
    if (res.status === 404)
      throw new HttpError(404, 'Notion can’t see that page. In Notion, open it → ••• → Connections → add Petrichor.')
    if (!res.ok) throw new HttpError(502, `Notion: ${data.message || res.status}`)
    return data
  }
  throw new HttpError(429, 'Notion is busy. Try again in a moment.')
}

const plain = (rich = []) => rich.map((t) => t.plain_text).join('')

function pageTitle(page) {
  const prop = Object.values(page.properties || {}).find((p) => p.type === 'title')
  return plain(prop?.title).trim() || 'Untitled'
}

const pageIcon = (page) => (page.icon?.type === 'emoji' ? page.icon.emoji : '')

// ── blocks → HTML ────────────────────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Notion rich text, with its marks, and every newline kept as a line break. */
function rich(texts = []) {
  return texts
    .map((t) => {
      let s = esc(t.plain_text).replace(/\n/g, '<br>')
      const a = t.annotations || {}
      if (a.code) s = `<em>${s}</em>`
      if (a.bold) s = `<strong>${s}</strong>`
      if (a.italic) s = `<em>${s}</em>`
      if (a.underline) s = `<u>${s}</u>`
      if (a.strikethrough) s = `<s>${s}</s>`
      return s
    })
    .join('')
}

async function children(blockId, depth, budget) {
  const out = []
  let cursor
  do {
    const q = `?page_size=100${cursor ? `&start_cursor=${cursor}` : ''}`
    const data = await notion(`/blocks/${blockId}/children${q}`)
    for (const b of data.results) {
      if (budget.left-- <= 0) return out
      if (b.has_children && depth < MAX_DEPTH && b.type !== 'child_page' && b.type !== 'child_database')
        b._children = await children(b.id, depth + 1, budget)
      out.push(b)
    }
    cursor = data.has_more ? data.next_cursor : null
  } while (cursor)
  return out
}

/** Render blocks to HTML; sub-pages are collected rather than inlined. */
function render(blocks, subpages) {
  let html = ''
  let list = null // 'ul' | 'ol' while consecutive list items run
  const close = () => {
    if (list) html += `</${list}>`
    list = null
  }
  for (const b of blocks) {
    const v = b[b.type] || {}
    const inner = b._children ? render(b._children, subpages) : ''
    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item') {
      const want = b.type === 'bulleted_list_item' ? 'ul' : 'ol'
      if (list !== want) {
        close()
        html += `<${want}>`
        list = want
      }
      html += `<li><p>${rich(v.rich_text)}</p>${inner}</li>`
      continue
    }
    close()
    switch (b.type) {
      case 'paragraph':
        html += v.rich_text?.length ? `<p>${rich(v.rich_text)}</p>` : ''
        html += inner
        break
      case 'heading_1':
        html += `<h1>${rich(v.rich_text)}</h1>${inner}`
        break
      case 'heading_2':
        html += `<h2>${rich(v.rich_text)}</h2>${inner}`
        break
      case 'heading_3':
        html += `<h3>${rich(v.rich_text)}</h3>${inner}`
        break
      case 'quote':
      case 'callout':
        html += `<blockquote><p>${rich(v.rich_text)}</p>${inner}</blockquote>`
        break
      case 'to_do':
        html += `<p>${v.checked ? '☑' : '☐'} ${rich(v.rich_text)}</p>${inner}`
        break
      case 'toggle':
        html += `<p>${rich(v.rich_text)}</p>${inner}`
        break
      case 'code':
        html += `<p>${rich(v.rich_text)}</p>`
        break
      case 'divider':
        html += '<hr>'
        break
      case 'child_page':
        subpages.push({ id: b.id, title: v.title || 'Untitled' })
        break
      case 'column_list':
      case 'column':
      case 'synced_block':
        html += inner
        break
      default:
        // images, embeds, databases, equations: nothing a page of prose can hold
        break
    }
  }
  close()
  return html
}

async function readPage(id) {
  const page = await notion(`/pages/${id}`)
  const blocks = await children(id, 0, { left: MAX_BLOCKS })
  const subpages = []
  const html = render(blocks, subpages)
  return { id, title: pageTitle(page), icon: pageIcon(page), html, subpages }
}

// ── routes ───────────────────────────────────────────────────────────────────

export function notionRoutes(app) {
  const route = (fn) => async (req, res) => {
    try {
      await requireOwner(req)
      res.json(await fn(req))
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || String(e) })
    }
  }

  // Is Notion set up on this server, and is it for this person?
  app.get('/api/notion/status', async (req, res) => {
    try {
      await requireOwner(req)
      res.json({ connected: true })
    } catch (e) {
      res.json({ connected: false, reason: e.message })
    }
  })

  // Pages shared with the integration, newest edited first.
  app.post(
    '/api/notion/search',
    route(async (req) => {
      const data = await notion('/search', {
        method: 'POST',
        body: {
          query: String(req.body?.query || '').slice(0, 200),
          filter: { property: 'object', value: 'page' },
          sort: { direction: 'descending', timestamp: 'last_edited_time' },
          page_size: 50,
        },
      })
      return {
        pages: data.results.map((p) => ({
          id: p.id,
          title: pageTitle(p),
          icon: pageIcon(p),
          edited: p.last_edited_time,
          parent: p.parent?.type,
        })),
      }
    }),
  )

  // One page, as HTML, with its sub-pages listed (they become chapters).
  app.post(
    '/api/notion/page',
    route(async (req) => {
      const id = String(req.body?.id || '').replace(/[^a-f0-9-]/gi, '')
      if (!id) throw new HttpError(400, 'Which page?')
      return readPage(id)
    }),
  )
}

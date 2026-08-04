// ─────────────────────────────────────────────────────────────────────────────
//  Taking the work out of the app: a zip of everything, the board flattened
//  into one image, and the palette as a labelled swatch strip.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip'
import { workspaceTitle } from './store.js'

function save(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // give the browser a moment to start the download before revoking
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

// "the ache of a summer that's ending" → "the-ache-of-a-summer-thats-ending"
function slug(s, max = 48) {
  return (
    String(s || 'workspace')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'workspace'
  )
}

// The board's own images are base64 JPEGs, but a data URL doesn't have to be —
// text formats like SVG arrive percent-encoded, and atob chokes on those.
function dataUrlToBlob(dataUrl) {
  const s = String(dataUrl)
  const comma = s.indexOf(',')
  const head = s.slice(0, comma)
  const body = s.slice(comma + 1)
  const mime = /^data:([^;,]+)/.exec(head)?.[1] || 'image/jpeg'

  if (/;base64/i.test(head)) {
    const bin = atob(body)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(body)], { type: mime })
}

function ext(dataUrl) {
  const mime = /^data:([^;,]+)/.exec(String(dataUrl))?.[1] || ''
  if (mime.includes('png')) return 'png'
  if (mime.includes('svg')) return 'svg'
  if (mime.includes('webp')) return 'webp'
  return 'jpg'
}

// Images stored in Supabase arrive as signed https URLs rather than data URLs;
// fetch those instead of trying to decode them.
async function srcToBlob(src) {
  if (String(src).startsWith('data:')) return dataUrlToBlob(src)
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Couldn't fetch an image (${res.status})`)
  return res.blob()
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // without this a remote image taints the canvas and toBlob() throws
    if (!String(src).startsWith('data:')) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("An image on the board wouldn't load."))
    img.src = src
  })
}

// ── the board, flattened ─────────────────────────────────────────────────────

/**
 * Lay the mood board out as one PNG — the same masonry the app shows, drawn at
 * print-ish width so it survives being posted or printed.
 */
export async function boardCollage(images, { width = 1600, columns, gap = 16, bg = '#0b0b0d' } = {}) {
  if (!images?.length) throw new Error('No images on the board yet.')

  const cols = columns || (images.length <= 2 ? images.length : images.length <= 6 ? 3 : 4)
  const colW = (width - gap * (cols + 1)) / cols

  const loaded = await Promise.all(images.map((i) => loadImage(i.img)))
  const heights = new Array(cols).fill(gap)
  const placed = loaded.map((img) => {
    const col = heights.indexOf(Math.min(...heights))
    const h = colW / (img.naturalWidth / img.naturalHeight || 1)
    const box = { img, x: gap + col * (colW + gap), y: heights[col], w: colW, h }
    heights[col] += h + gap
    return box
  })

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = Math.ceil(Math.max(...heights))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // roundRect returns undefined, so it can't be ?? -chained — pick one path.
  const rounded = (x, y, w, h, r) => {
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
    else ctx.rect(x, y, w, h)
  }

  placed.forEach(({ img, x, y, w, h }) => {
    ctx.save()
    rounded(x, y, w, h, 10)
    ctx.clip()
    ctx.drawImage(img, x, y, w, h)
    ctx.restore()
  })

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// ── the palette, as a swatch strip ───────────────────────────────────────────

/**
 * colours: ['#c9a86a'] or [{ name, hex }] — the AI palette and the extracted
 * one both end up here.
 */
export async function paletteSwatch(colours, { title = '', swatch = 220, bg = '#0b0b0d' } = {}) {
  const list = (colours || []).map((c) => (typeof c === 'string' ? { hex: c } : c)).filter((c) => c?.hex)
  if (!list.length) throw new Error('No palette to save yet.')

  const pad = 28
  const labelH = 74
  const titleH = title ? 64 : 0
  const canvas = document.createElement('canvas')
  canvas.width = pad * 2 + list.length * swatch + (list.length - 1) * 12
  canvas.height = pad * 2 + titleH + swatch + labelH
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = bg
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  if (title) {
    ctx.fillStyle = '#efebe4'
    ctx.font = 'italic 30px Iowan Old Style, Georgia, serif'
    ctx.fillText(title, pad, pad + 34)
  }

  list.forEach((c, i) => {
    const x = pad + i * (swatch + 12)
    const y = pad + titleH
    ctx.fillStyle = c.hex
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, swatch, swatch, 8)
    else ctx.rect(x, y, swatch, swatch)
    ctx.fill()

    ctx.fillStyle = '#efebe4'
    ctx.font = '600 22px Helvetica Neue, Arial, sans-serif'
    ctx.fillText(c.name || c.hex, x, y + swatch + 34)
    if (c.name) {
      ctx.fillStyle = '#8b8781'
      ctx.font = '20px Helvetica Neue, Arial, sans-serif'
      ctx.fillText(c.hex, x, y + swatch + 62)
    }
  })

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}

// ── the whole workspace, zipped ──────────────────────────────────────────────

function paletteLines(ws) {
  const lines = []
  if (ws.words?.palette?.length) {
    lines.push('A palette to begin')
    ws.words.palette.forEach((c) => lines.push(`  ${c.hex}   ${c.name || ''}`.trimEnd()))
  }
  if (ws.boardPalette?.length) {
    if (lines.length) lines.push('')
    lines.push('Pulled from the mood board')
    ws.boardPalette.forEach((hex) => lines.push(`  ${hex}`))
  }
  return lines.join('\n') + '\n'
}

function wordLines(ws) {
  const out = []
  if (ws.words?.evocative?.length) {
    out.push('Words to write with', ...ws.words.evocative.map((w) => `  ${w}`), '')
  }
  if (ws.words?.searchTerms?.length) {
    out.push('Search terms', ...ws.words.searchTerms.map((w) => `  ${w}`), '')
  }
  return out.join('\n')
}

/** Everything in the workspace, as one .zip. */
export async function downloadWorkspaceZip(ws) {
  const zip = new JSZip()
  const name = slug(workspaceTitle(ws))
  const root = zip.folder(name)

  const readme = [
    workspaceTitle(ws),
    '='.repeat(workspaceTitle(ws).length),
    '',
    `Prompt:  ${ws.prompt?.text || '—'}`,
    `Register: ${ws.mood || '—'}`,
    `Started: ${new Date(ws.createdAt).toLocaleString()}`,
    `Last touched: ${new Date(ws.updatedAt).toLocaleString()}`,
    '',
    ws.reading?.see ? `The board reads as:\n  “${ws.reading.see}”\n` : '',
    'From Petrichor · verse.mahabaig.com',
    '',
  ].join('\n')
  root.file('readme.txt', readme)

  if (ws.poem?.trim()) root.file('poem.txt', ws.poem.trimEnd() + '\n')
  const words = wordLines(ws)
  if (words.trim()) root.file('words.txt', words)
  const pal = paletteLines(ws)
  if (pal.trim()) root.file('palette.txt', pal)

  if (ws.images?.length) {
    const imgs = root.folder('images')
    // sequential on purpose: a big board shouldn't open 30 fetches at once
    for (const [i, im] of ws.images.entries()) {
      const blob = await srcToBlob(im.img)
      const suffix = im.path?.split('.').pop() || ext(im.img)
      imgs.file(`${String(i + 1).padStart(2, '0')}.${suffix}`, blob)
    }
    // the board as one picture, so the zip is useful without reassembling it
    try {
      const collage = await boardCollage(ws.images)
      if (collage) root.file('mood-board.png', collage)
    } catch {
      /* a board that won't draw shouldn't sink the whole download */
    }
  }

  if (ws.generated?.image) {
    const suffix = ws.generated.path?.split('.').pop() || ext(ws.generated.image)
    root.file(`generated.${suffix}`, await srcToBlob(ws.generated.image))
    if (ws.generated.prompt) root.file('generated-prompt.txt', ws.generated.prompt + '\n')
  }

  const allColours = [
    ...(ws.words?.palette || []),
    ...(ws.boardPalette || []).map((hex) => ({ hex })),
  ]
  if (allColours.length) {
    try {
      const swatch = await paletteSwatch(allColours, { title: workspaceTitle(ws) })
      if (swatch) root.file('palette.png', swatch)
    } catch {
      /* same — a missing swatch is not worth failing the zip over */
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' })
  save(blob, `${name}.zip`)
}

export async function downloadBoardImage(ws) {
  const blob = await boardCollage(ws.images)
  save(blob, `${slug(workspaceTitle(ws))}-mood-board.png`)
}

export async function downloadPalette(ws) {
  const colours = [
    ...(ws.words?.palette || []),
    ...(ws.boardPalette || []).map((hex) => ({ hex })),
  ]
  const blob = await paletteSwatch(colours, { title: workspaceTitle(ws) })
  save(blob, `${slug(workspaceTitle(ws))}-palette.png`)
}

export async function downloadPoem(ws) {
  save(new Blob([ws.poem.trimEnd() + '\n'], { type: 'text/plain' }), `${slug(workspaceTitle(ws))}.txt`)
}

// Cards for the workspaces gallery.
//
// CircularGallery draws textured planes, so every workspace is painted onto one
// card of a fixed size: the picture it gathered (or its prompt set in type when
// it hasn't gathered one yet), a boundary so the card reads as an object on the
// black page, and the words the poet asked for, set as tags in the pigment.

import { isLight } from './theme.js'

const W = 700
const H = 900

const MARGIN = 30 // clear of the plane's rounded corners
const RADIUS = 22

// Read a brand token at call time — the cards should follow the current theme.
function token(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function decodeImage(src, anonymous) {
  return new Promise((resolve) => {
    const img = new Image()
    if (anonymous) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/**
 * Signed in, a gathered picture is a signed storage URL rather than a data URL,
 * and a card is composed by drawing it into a canvas and reading the canvas
 * back out. That read is only allowed if the pixels are ours.
 *
 * So fetch the bytes and draw from a blob: a blob URL is same-origin, and can't
 * be tainted by a copy the browser cached earlier without cross-origin
 * permission — which is how a picture shown elsewhere in the app as a plain
 * <img> could quietly poison the card here.
 */
async function loadImage(src) {
  if (!src) return null
  if (!src.startsWith('data:') && typeof fetch === 'function') {
    try {
      const res = await fetch(src, { mode: 'cors', credentials: 'omit' })
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob())
        const img = await decodeImage(url, false)
        URL.revokeObjectURL(url) // the decoded picture outlives the URL
        if (img) return img
      }
    } catch {
      // No cross-origin read allowed; try the picture on its own terms.
    }
  }
  return decodeImage(src, true)
}

/**
 * The whole picture, at its own proportions, as large as the space allows and
 * centred in it. Nothing is cropped — a mood board is worth seeing entire.
 */
function fit(img, x, y, w, h) {
  const ratio = (img.naturalWidth || 1) / (img.naturalHeight || 1)
  let dw = w
  let dh = dw / ratio
  if (dh > h) {
    dh = h
    dw = dh * ratio
  }
  return { x: x + (w - dw) / 2, y: y + (h - dh) / 2, w: dw, h: dh }
}

/** The boundary, so the card reads as an object rather than a hole in the page. */
function drawBoundary(ctx) {
  ctx.save()
  roundedRect(ctx, MARGIN / 2, MARGIN / 2, W - MARGIN, H - MARGIN, RADIUS)
  ctx.strokeStyle = token('--body', '#ede7df')
  ctx.globalAlpha = 0.32
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

/**
 * The words to write with, as tags. Returns the height used, so a card with
 * nothing to say can give the space back to its picture.
 */
function drawTags(ctx, words, top, floor) {
  if (!words?.length) return 0

  const fuchsia = token('--fuchsia', '#ff3e86')
  const font = '500 28px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif'
  const padX = 18
  const pillH = 48
  const gap = 12
  const left = MARGIN + 14
  const right = W - MARGIN - 14

  let x = left
  let y = top
  ctx.font = font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'

  for (const raw of words) {
    const word = String(raw ?? '').trim()
    if (!word) continue
    const pillW = Math.min(ctx.measureText(word).width + padX * 2, right - left)
    if (x + pillW > right) {
      x = left
      y += pillH + gap
    }
    if (y + pillH > floor) break

    ctx.save()
    roundedRect(ctx, x, y, pillW, pillH, pillH / 2)
    ctx.fillStyle = fuchsia
    ctx.globalAlpha = 0.14
    ctx.fill()
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1.5
    ctx.strokeStyle = fuchsia
    ctx.stroke()
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(x + padX * 0.6, y, pillW - padX * 1.2, pillH)
    ctx.clip()
    ctx.fillStyle = fuchsia
    ctx.fillText(word, x + padX, y + pillH / 2 + 1)
    ctx.restore()

    x += pillW + gap
  }
  return y + pillH - top
}

/** How much room a run of tags wants, so the picture can take the rest. */
function tagRoom(words) {
  if (!words?.length) return 0
  // Two rows covers the handful we show; a third if the phrases run long.
  const longish = words.filter((w) => String(w).length > 12).length
  return (longish > 2 ? 3 : 2) * 60 + 34
}

/** The handful of words worth carrying on a card this size. */
function pickWords(words) {
  return (words || [])
    .map((w) => String(w ?? '').trim())
    .filter(Boolean)
    .slice(0, 7)
}

function ground(ctx, palette) {
  const light = isLight()
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  if (palette?.length >= 2) {
    g.addColorStop(0, palette[0])
    g.addColorStop(1, palette[1])
  } else if (light) {
    g.addColorStop(0, token('--card', '#f6f3ed'))
    g.addColorStop(1, token('--paper-2', '#e6e0d6'))
  } else {
    g.addColorStop(0, '#1b2028')
    g.addColorStop(1, '#000000')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // A wash the way the page is going, so type and tags stay readable whatever
  // the palette turned out to be — and so a card by day isn't a hole in it.
  ctx.fillStyle = light ? 'rgba(247,244,238,0.62)' : 'rgba(8,9,13,0.45)'
  ctx.fillRect(0, 0, W, H)
}

/**
 * A prompt, set in italic serif on the workspace's own colours if it has any.
 * Returns a data URL.
 */
export function typeCard(text, palette = [], words = []) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  ground(ctx, palette)

  const tags = pickWords(words)
  const room = tagRoom(tags)

  // The prompt itself, wrapped.
  const pad = MARGIN + 26
  const fontPx = 42
  ctx.font = `italic ${fontPx}px "Iowan Old Style", Georgia, serif`
  ctx.fillStyle = token('--body', '#f2ede5')
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  const words_ = String(text || 'untitled').split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words_) {
    const test = cur ? cur + ' ' + w : w
    if (ctx.measureText(test).width > W - pad * 2 && cur) {
      lines.push(cur)
      cur = w
    } else cur = test
  }
  if (cur) lines.push(cur)

  const max = room ? 5 : 7
  const shown = lines.slice(0, max)
  if (lines.length > max) shown[max - 1] = shown[max - 1].replace(/\s+\S*$/, '…')
  shown.forEach((ln, i) => ctx.fillText(ln, pad, 180 + i * fontPx * 1.35))

  drawTags(ctx, tags, H - MARGIN - 24 - room + 34, H - MARGIN - 24)
  drawBoundary(ctx)

  return c.toDataURL('image/jpeg', 0.86)
}

/**
 * A gathered picture in the top of the card, the words to write with beneath.
 * Returns a data URL.
 */
async function photoCard(src, palette, words, title) {
  const img = await loadImage(src)
  // If we can't fetch it anonymously the gallery can't either — it loads its
  // textures the same way — so a raw URL here would be an invisible card.
  // Better the prompt in type than a hole in the ribbon.
  if (!img) return typeCard(title, palette, words)

  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  ground(ctx, palette)

  const tags = pickWords(words)
  const room = tagRoom(tags)
  const inset = MARGIN + 16
  const top = inset
  const space = H - top - inset - room

  // The picture takes whatever shape it is; the mount is drawn around it
  // rather than the picture being cut to fit a mount.
  const box = fit(img, inset, top, W - inset * 2, space)
  ctx.drawImage(img, box.x, box.y, box.w, box.h)

  ctx.save()
  ctx.strokeStyle = token('--body', '#ede7df')
  ctx.globalAlpha = 0.22
  ctx.lineWidth = 2
  ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2)
  ctx.restore()

  drawTags(ctx, tags, top + space + 30, H - MARGIN - 16)
  drawBoundary(ctx)

  try {
    return c.toDataURL('image/jpeg', 0.86)
  } catch (e) {
    // A picture we're allowed to show but not to read back. Show it plain —
    // the gallery will crop it to the card, which is worse than the mount but
    // better than losing it. Said out loud, because it's hard to see why.
    console.warn('petrichor: could not compose a card for', src, e)
    return src
  }
}

/**
 * One card per workspace: its first gathered image if it has one, otherwise its
 * prompt set in type — either way with the words it was given to write with.
 */
export async function workspaceCards(items, titleOf) {
  return Promise.all(
    items.map(async (ws) => {
      const words = ws.words?.evocative || []
      const palette = ws.boardPalette || []
      const first = ws.images?.[0]?.img
      const title = titleOf(ws)
      let image
      try {
        image = first
          ? await photoCard(first, palette, words, title)
          : typeCard(title, palette, words)
      } catch {
        // Nothing about painting a card is worth an empty drawer.
        image = first || ''
      }
      return { image, text: title, id: ws.id }
    }),
  )
}

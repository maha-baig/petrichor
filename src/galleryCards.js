// Cards for the workspaces gallery.
//
// CircularGallery draws textured planes, so every workspace is painted onto one
// card of a fixed size: the picture it gathered (or its prompt set in type when
// it hasn't gathered one yet), a boundary so the card reads as an object on the
// black page, and the words the poet asked for, set as tags in the pigment.

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

// Signed in, a gathered picture is a signed storage URL rather than a data URL.
// Asking for it anonymously is what lets us read the composed card back out of
// the canvas afterwards; without it the canvas is tainted and unreadable.
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Fill the window with the picture, cropping the overhang rather than squashing it. */
function drawCover(ctx, img, x, y, w, h) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
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
  const paper = token('--paper', '#000000')
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  if (palette?.length >= 2) {
    g.addColorStop(0, palette[0])
    g.addColorStop(1, palette[1])
  } else {
    g.addColorStop(0, '#1b2028')
    g.addColorStop(1, paper === '#000000' ? '#000000' : '#12151c')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // A wash, so type and tags stay readable whatever the palette turned out to be.
  ctx.fillStyle = 'rgba(8,9,13,0.45)'
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
  ctx.fillStyle = '#f2ede5'
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
  const top = MARGIN + 16
  const windowH = H - top - MARGIN - 16 - room

  ctx.save()
  roundedRect(ctx, MARGIN + 16, top, W - (MARGIN + 16) * 2, windowH, 10)
  ctx.clip()
  drawCover(ctx, img, MARGIN + 16, top, W - (MARGIN + 16) * 2, windowH)
  ctx.restore()

  drawTags(ctx, tags, top + windowH + 30, H - MARGIN - 16)
  drawBoundary(ctx)

  try {
    return c.toDataURL('image/jpeg', 0.86)
  } catch {
    // A picture we're allowed to show but not to read back. Show it plain.
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

// ─────────────────────────────────────────────────────────────────────────────
//  Painting a cover on a canvas: a picture (or a plain colour), a shade over
//  it, and the book's words set in real type. The designer draws with this,
//  and exports use it to give every book a cover, even one never designed.
// ─────────────────────────────────────────────────────────────────────────────

import { bookTitle } from './library.js'

// 2:3, a 6 × 9 in book at 200 dpi: sharp on a phone and on an e-reader.
export const COVER_W = 1200
export const COVER_H = 1800

const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif'

export const INKS = ['#f3ede4', '#17130f', '#d6156a', '#c9a86a']

/** How a cover starts out: the typeset proof, in the book's own colour. */
export function defaultDesign(work) {
  return {
    color: work?.cover_color || '#2a1f2d',
    image: null, // an HTMLImageElement
    zoom: 1,
    focus: { x: 0.5, y: 0.5 }, // the point of the picture at the centre of the cover
    shade: 0,
    words: true,
    imprint: true,
    type: 'serif',
    place: 'middle', // top | middle | bottom
    size: 1,
    ink: '#f3ede4',
    title: bookTitle(work),
    subtitle: work?.subtitle || '',
    author: work?.author || '',
  }
}

/** An image ready to draw. Pictures from elsewhere must allow it (CORS), or the canvas can't be saved. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (!/^(data|blob):/.test(src)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("That picture couldn't be opened here. A JPEG or PNG always works.")) // HEIC outside Safari, mostly
    img.src = src
  })
}

/** Where the picture lands for a zoom and focus: covering the page, never leaving a gap. */
export function pictureBox(img, W, H, zoom, focus) {
  const s = Math.max(W / img.naturalWidth, H / img.naturalHeight) * zoom
  const w = img.naturalWidth * s
  const h = img.naturalHeight * s
  const x = Math.min(0, Math.max(W - w, W / 2 - focus.x * w))
  const y = Math.min(0, Math.max(H - h, H / 2 - focus.y * h))
  return { x, y, w, h }
}

// Lines of `text` no wider than `max`, broken between words.
function wrap(ctx, text, max) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > max) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

// Letter-spaced capitals, centred on x: drawn a letter at a time so it works
// in every browser, not only those with ctx.letterSpacing.
function spaced(ctx, text, x, y, tracking) {
  const chars = [...String(text).toUpperCase()]
  const widths = chars.map((c) => ctx.measureText(c).width)
  const total = widths.reduce((a, b) => a + b, 0) + tracking * (chars.length - 1)
  let at = x - total / 2
  ctx.textAlign = 'left'
  chars.forEach((c, i) => {
    ctx.fillText(c, at, y)
    at += widths[i] + tracking
  })
  ctx.textAlign = 'center'
}

/** Paint the whole cover onto a canvas context of W × H. */
export function paintCover(ctx, W, H, d) {
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = d.color
  ctx.fillRect(0, 0, W, H)
  if (d.image) {
    const b = pictureBox(d.image, W, H, d.zoom, d.focus)
    ctx.drawImage(d.image, b.x, b.y, b.w, b.h)
  }
  if (d.shade > 0) {
    ctx.fillStyle = `rgba(8,6,5,${d.shade})`
    ctx.fillRect(0, 0, W, H)
  }

  if (d.words) {
    const pad = W * 0.1
    const serif = d.type === 'serif'
    ctx.fillStyle = d.ink
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    // Over a picture, a soft shadow keeps the words readable on any patch of it.
    if (d.image) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)'
      ctx.shadowBlur = W * 0.012
    }

    // The title block: the title, and the subtitle under it.
    const titlePx = W * (serif ? 0.1 : 0.085) * d.size
    ctx.font = serif ? `italic ${titlePx}px ${SERIF}` : `bold ${titlePx}px ${SANS}`
    const titleLines = wrap(ctx, serif ? d.title : d.title.toUpperCase(), W - pad * 2)
    const titleLead = titlePx * (serif ? 1.05 : 1.0)
    const subPx = W * 0.04 * Math.min(1.2, d.size)
    const subGap = d.subtitle ? titlePx * 0.45 + subPx : 0
    const blockH = titleLines.length * titleLead + subGap

    const topY = { top: H * 0.2, middle: H / 2 - blockH / 2, bottom: H * 0.8 - blockH }[d.place] ?? H / 2 - blockH / 2
    titleLines.forEach((l, i) => ctx.fillText(l, W / 2, topY + titlePx * 0.85 + i * titleLead))
    if (d.subtitle) {
      ctx.globalAlpha = 0.8
      ctx.font = `italic ${subPx}px ${SERIF}`
      wrap(ctx, d.subtitle, W - pad * 2)
        .slice(0, 2)
        .forEach((l, i) => ctx.fillText(l, W / 2, topY + titleLines.length * titleLead + subGap - subPx * 0.15 + i * subPx * 1.2))
      ctx.globalAlpha = 1
    }

    // The author at the foot, or at the head when the title sits low.
    if (d.author) {
      const px = W * 0.034
      ctx.font = `${px}px ${SANS}`
      ctx.globalAlpha = 0.85
      spaced(ctx, d.author, W / 2, d.place === 'bottom' ? H * 0.12 : H * 0.9, px * 0.22)
      ctx.globalAlpha = 1
    }
    if (d.imprint && d.place !== 'bottom') {
      const px = W * 0.024
      ctx.font = `bold ${px}px ${SANS}`
      ctx.globalAlpha = 0.6
      spaced(ctx, 'Petrichor', W / 2, d.place === 'top' ? H * 0.1 : H * 0.12, px * 0.3)
      ctx.globalAlpha = 1
    }
  }
  ctx.restore()
}

/** The canvas as a JPEG file. */
export function canvasJpeg(canvas, quality = 0.9) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The cover couldn't be drawn."))), 'image/jpeg', quality),
  )
}

/**
 * A book's cover as a 2:3 JPEG, for exports: her picture if there is one
 * (cropped the way the shelf shows it), otherwise the typeset proof.
 */
export async function coverJpeg(work) {
  const canvas = document.createElement('canvas')
  canvas.width = COVER_W
  canvas.height = COVER_H
  const d = defaultDesign(work)
  if (work.coverUrl) {
    try {
      d.image = await loadImage(work.coverUrl)
      d.words = false // the words are already on it, or she chose none
    } catch {
      /* an unreachable picture: the typeset cover still makes a book */
    }
  }
  paintCover(canvas.getContext('2d'), COVER_W, COVER_H, d)
  return canvasJpeg(canvas)
}

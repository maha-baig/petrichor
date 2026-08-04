// Cards for the workspaces gallery.
//
// CircularGallery draws textured planes, so every workspace needs a picture.
// A workspace that gathered images uses its own; one that hasn't yet gets its
// prompt set in type on an ink card, so the ribbon is never full of blanks.

const W = 700
const H = 900

// Read a brand token at call time — the cards should follow the current theme.
function token(name, fallback) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

/**
 * A prompt, set in italic serif on the workspace's own colours if it has any.
 * Returns a data URL.
 */
export function typeCard(text, palette = []) {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')

  // Ground: the board's own colours when it has them, otherwise brand ink.
  const ink = token('--paper', '#0b0d12')
  const g = ctx.createLinearGradient(0, 0, W * 0.4, H)
  if (palette.length >= 2) {
    g.addColorStop(0, palette[0])
    g.addColorStop(1, palette[1])
  } else {
    g.addColorStop(0, '#1b2028')
    g.addColorStop(1, ink === '#000000' ? '#000000' : '#12151c')
  }
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // A wash so type stays readable whatever the palette turned out to be.
  ctx.fillStyle = 'rgba(8,9,13,0.45)'
  ctx.fillRect(0, 0, W, H)

  // A fuchsia hairline: the Verse pigment, quietly.
  ctx.fillStyle = token('--fuchsia', '#ff3e86')
  ctx.fillRect(56, 96, 3, 84)

  // The prompt itself, wrapped.
  const pad = 56
  const fontPx = 44
  ctx.font = `italic ${fontPx}px "Iowan Old Style", Georgia, serif`
  ctx.fillStyle = '#f2ede5'
  ctx.textBaseline = 'top'

  const words = String(text || 'untitled').split(/\s+/)
  const lines = []
  let cur = ''
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w
    if (ctx.measureText(test).width > W - pad * 2 && cur) {
      lines.push(cur)
      cur = w
    } else cur = test
  }
  if (cur) lines.push(cur)

  const shown = lines.slice(0, 7)
  if (lines.length > 7) shown[6] = shown[6].replace(/\s+\S*$/, '…')
  shown.forEach((ln, i) => ctx.fillText(ln, pad, 210 + i * fontPx * 1.35))

  return c.toDataURL('image/jpeg', 0.86)
}

/**
 * One card per workspace: its first gathered image if it has one, otherwise
 * its prompt set in type.
 */
export function workspaceCards(items, titleOf) {
  return items.map((ws) => ({
    image: ws.images?.[0]?.img || typeCard(titleOf(ws), ws.boardPalette || []),
    text: titleOf(ws),
    id: ws.id,
  }))
}

import { useEffect, useRef, useState } from 'react'
import { Reveal } from '../motion.jsx'

// Load any image file/blob to a data URL, capped for canvas performance.
function loadImageFile(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      c.getContext('2d').drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = url
  })
}

// Compose a poem over an image on a canvas — real typography, crisp export.
// Pass imageSrc to fix the image (e.g. a generated one), or omit it for the
// standalone tool where the poet loads any image themselves.
export default function PoemOverlay({ imageSrc, standalone = false }) {
  const [src, setSrc] = useState(imageSrc || null)
  const [poem, setPoem] = useState('')
  const [align, setAlign] = useState('left') // left | center
  const [font, setFont] = useState('serif') // serif | sans
  const [ink, setInk] = useState('#f4f1ea') // any hex colour
  const [scrim, setScrim] = useState(true)
  const [size, setSize] = useState(4) // % of image height
  const [leading, setLeading] = useState(1.4) // line spacing multiplier

  // Where the poem sits, as a fraction of the image (0–1) so it survives a
  // change of image or export size. This is the anchor of the text block:
  // its left edge when ranged left, its centre when centred.
  const [pos, setPos] = useState({ x: 0.07, y: 0.72 })
  const [dragging, setDragging] = useState(false)

  // Darkroom controls. 1 = untouched, so the defaults draw the original.
  const [adj, setAdj] = useState({
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hue: 0, // degrees
    sepia: 0,
    blur: 0, // px at export scale
  })
  const adjusted =
    adj.brightness !== 1 ||
    adj.contrast !== 1 ||
    adj.saturate !== 1 ||
    adj.hue !== 0 ||
    adj.sepia !== 0 ||
    adj.blur !== 0

  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const fileRef = useRef(null)
  const dragRef = useRef(null) // grab offset while dragging

  // keep in sync when a parent supplies/updates the image
  useEffect(() => {
    if (imageSrc) setSrc(imageSrc)
  }, [imageSrc])

  async function loadFiles(fileList) {
    const file = [...fileList].find((f) => f.type.startsWith('image/'))
    if (file) setSrc(await loadImageFile(file))
  }

  // in standalone mode, let the poet paste an image from anywhere
  useEffect(() => {
    if (!standalone) return
    function onPaste(e) {
      const items = [...(e.clipboardData?.items || [])]
      const f = items.find((i) => i.type.startsWith('image/'))?.getAsFile()
      if (f) {
        e.preventDefault()
        loadFiles([f])
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [standalone])

  // load the base image whenever the source changes
  useEffect(() => {
    if (!src) return
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      draw()
    }
    img.src = src
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  // redraw on any change
  useEffect(draw, [poem, pos, align, font, ink, scrim, size, leading, src, adj])

  // Lay the poem out for a given canvas: the wrapped lines and the box they
  // occupy. draw() paints it; the drag handler uses the box to know what was
  // grabbed, so both agree on where the text is.
  function layout(ctx, W, H) {
    const pad = W * 0.07
    const fontPx = Math.max(8, Math.round((size / 100) * H))
    const lineH = fontPx * leading
    const family =
      font === 'serif' ? '"Iowan Old Style", Georgia, serif' : 'Helvetica, Arial, sans-serif'
    ctx.font = `${font === 'serif' ? 'italic ' : ''}${fontPx}px ${family}`

    // Wrap to whatever room is left to the right of the anchor, so dragging
    // toward an edge reflows rather than running off the canvas.
    const maxW =
      align === 'center'
        ? Math.min(pos.x, 1 - pos.x) * 2 * W - pad * 0.5
        : W - pos.x * W - pad * 0.5

    const lines = []
    for (const raw of poem.split('\n')) {
      if (raw.trim() === '') {
        lines.push('')
        continue
      }
      const indent = (raw.match(/^(\s+)/)?.[1] || '').replace(/\t/g, '    ')
      let cur = indent
      for (const word of raw.trim().split(/\s+/)) {
        const test = cur.trim() ? cur + ' ' + word : cur + word
        if (ctx.measureText(test).width > Math.max(maxW, fontPx * 4) && cur.trim()) {
          lines.push(cur)
          cur = indent + word
        } else cur = test
      }
      lines.push(cur)
    }

    const widest = lines.reduce((m, l) => Math.max(m, ctx.measureText(l).width), 0)
    const blockH = lines.length * lineH
    const x = pos.x * W
    const top = pos.y * H
    const left = align === 'center' ? x - widest / 2 : x
    return { lines, fontPx, lineH, blockH, widest, x, top, left, pad }
  }

  function draw() {
    const img = imgRef.current
    const canvas = canvasRef.current
    if (!img || !canvas) return
    const W = img.naturalWidth
    const H = img.naturalHeight
    canvas.width = W
    canvas.height = H
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    // The adjustments belong to the photograph, not the poem — filter the
    // image on the way in, then clear it so the words stay exactly as chosen.
    if (adjusted) {
      ctx.filter =
        `brightness(${adj.brightness}) contrast(${adj.contrast}) ` +
        `saturate(${adj.saturate}) hue-rotate(${adj.hue}deg) ` +
        `sepia(${adj.sepia}) blur(${(adj.blur * H) / 100}px)`
    }
    ctx.drawImage(img, 0, 0, W, H)
    ctx.filter = 'none'

    ctx.textBaseline = 'alphabetic'
    const { lines, fontPx, lineH, blockH, widest, left, top, x } = layout(ctx, W, H)
    const y = top + fontPx // first baseline

    // is the chosen ink light or dark? (drives the legibility shade direction)
    const inkLight = (() => {
      const m = /^#?([0-9a-f]{6})$/i.exec(ink)
      if (!m) return true
      const n = parseInt(m[1], 16)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      return 0.299 * r + 0.587 * g + 0.114 * b > 140
    })()

    // legibility scrim (shade behind the text, coloured opposite the ink)
    // Legibility shade. Now that the poem can sit anywhere, the shade follows
    // it: a soft pool centred on the text rather than a fixed edge gradient.
    if (scrim && poem.trim()) {
      const shade = inkLight ? '10,8,6' : '245,240,232'
      const a = inkLight ? 0.55 : 0.45
      const cx = align === 'center' ? x : left + widest / 2
      const cy = top + blockH / 2
      const r = Math.max(widest, blockH) * 0.95 + fontPx * 2
      const g = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r)
      g.addColorStop(0, `rgba(${shade},${a})`)
      g.addColorStop(0.6, `rgba(${shade},${a * 0.55})`)
      g.addColorStop(1, `rgba(${shade},0)`)
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    // draw the poem — a soft shadow keeps small text crisp over any image
    ctx.save()
    ctx.shadowColor = inkLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)'
    ctx.shadowBlur = fontPx * 0.12
    ctx.fillStyle = ink
    ctx.textAlign = align
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineH))
    ctx.restore()

    // While dragging, outline what's being moved so the grab reads as physical.
    if (dragging) {
      ctx.save()
      ctx.strokeStyle = inkLight ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'
      ctx.setLineDash([fontPx * 0.35, fontPx * 0.3])
      ctx.lineWidth = Math.max(1, fontPx * 0.04)
      ctx.strokeRect(left - fontPx * 0.4, top - fontPx * 0.25, widest + fontPx * 0.8, blockH + fontPx * 0.5)
      ctx.restore()
    }
  }

  // ── Dragging the poem ────────────────────────────────────────────────
  // The canvas is displayed smaller than the image it holds, so every pointer
  // position has to be converted into image coordinates before it means
  // anything. Pointer capture keeps the drag alive past the canvas edge.
  function toImage(e) {
    const canvas = canvasRef.current
    const r = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    }
  }

  function onPointerDown(e) {
    if (!poem.trim() || !imgRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const { left, top, blockH, widest, fontPx } = layout(ctx, canvas.width, canvas.height)
    const p = toImage(e)

    // A generous grab area — the words are thin, the gesture shouldn't be.
    const slack = fontPx * 0.6
    const inside =
      p.x >= left - slack &&
      p.x <= left + widest + slack &&
      p.y >= top - slack &&
      p.y <= top + blockH + slack
    if (!inside) return

    e.preventDefault()
    // Capture keeps the drag alive past the canvas edge, but it throws on a
    // pointer id the browser doesn't recognise — never let that lose the drag.
    try {
      canvas.setPointerCapture?.(e.pointerId)
    } catch {}
    dragRef.current = { dx: p.x - pos.x * canvas.width, dy: p.y - pos.y * canvas.height }
    setDragging(true)
  }

  function onPointerMove(e) {
    if (!dragging || !dragRef.current) return
    const canvas = canvasRef.current
    const p = toImage(e)
    // Keep the anchor on the canvas; the text may overhang, which is often
    // exactly what's wanted for a line that bleeds off an edge.
    const clamp = (v) => Math.min(0.98, Math.max(0.02, v))
    setPos({
      x: clamp((p.x - dragRef.current.dx) / canvas.width),
      y: clamp((p.y - dragRef.current.dy) / canvas.height),
    })
  }

  function endDrag(e) {
    if (!dragging) return
    try {
      canvasRef.current?.releasePointerCapture?.(e.pointerId)
    } catch {}
    dragRef.current = null
    setDragging(false)
  }

  // Nudge with the arrow keys once the canvas has focus — finer than a drag.
  function onKeyDown(e) {
    const step = e.shiftKey ? 0.05 : 0.005
    const moves = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }
    const m = moves[e.key]
    if (!m) return
    e.preventDefault()
    const clamp = (v) => Math.min(0.98, Math.max(0.02, v))
    setPos((p) => ({ x: clamp(p.x + m[0]), y: clamp(p.y + m[1]) }))
  }

  function download() {
    const canvas = canvasRef.current
    if (!canvas) return
    const a = document.createElement('a')
    a.download = 'petrichor-poem.png'
    a.href = canvas.toDataURL('image/png')
    a.click()
  }

  const Toggle = ({ options, value, onChange }) => (
    <div className="flex gap-1">
      {options.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={
            'rounded-full border px-3 py-1 text-xs transition-colors ' +
            (value === o.v
              ? 'border-fuchsia bg-fuchsia text-white'
              : 'border-line text-muted hover:text-body')
          }
        >
          {o.l}
        </button>
      ))}
    </div>
  )

  const wrapCls = standalone ? '' : 'mt-8 border-t border-line pt-6'

  return (
    <div className={wrapCls}>
      {standalone ? (
        <header className="mb-6">
          <Reveal order={0} className="mb-5 flex items-center gap-2.5">
            <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.22em] text-muted">
              Poem on image
            </span>
          </Reveal>
          <Reveal
            as="h1"
            order={1}
            className="font-serif text-4xl font-normal italic leading-[0.95] tracking-tight text-ink sm:text-5xl"
          >
            Lay a poem on an image
          </Reveal>
          <Reveal as="p" order={2} className="mt-3 max-w-xl text-muted">
            Bring any image: a photo, a saved Cosmos reference, anything. Set your words over it
            in your own type. Export a finished piece.
          </Reveal>
        </header>
      ) : (
        <>
          <h4 className="font-grotesk text-base font-extrabold tracking-tight text-body">
            Put your poem on it
          </h4>
          <p className="mt-1 text-sm text-muted">
            Paste your poem; your line breaks are kept. Then place it and export a finished image.
          </p>
        </>
      )}

      {/* Standalone: load any image first */}
      {standalone && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            loadFiles(e.dataTransfer.files)
          }}
          onClick={() => fileRef.current?.click()}
          className="mb-4 cursor-pointer rounded-sm border border-dashed border-line bg-card/50 p-6 text-center text-sm text-muted transition-colors hover:border-fuchsia"
        >
          {src ? 'Image loaded. Paste, drop, or click to swap it' : 'Paste (⌘V), drop, or click to load an image'}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => loadFiles(e.target.files)}
          />
        </div>
      )}

      {!src && !standalone && null}

      <div className={(src ? '' : 'pointer-events-none opacity-40 ') + 'mt-4 grid gap-6 lg:grid-cols-2'}>
        <div>
          <textarea
            value={poem}
            onChange={(e) => setPoem(e.target.value)}
            placeholder={'your poem,\nline by line…'}
            rows={7}
            className="w-full resize-y rounded-sm border border-line bg-card px-4 py-3 font-serif text-base italic leading-relaxed text-body placeholder:not-italic placeholder:text-muted/70 focus:border-fuchsia focus:outline-none"
          />
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-muted">Place</span>
              <span className="text-xs text-muted/80">drag it on the image</span>
              <button
                onClick={() => setPos({ x: 0.07, y: 0.72 })}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia"
              >
                reset
              </button>
            </div>
            <div>
              <span className="mr-2 text-muted">Align</span>
              <Toggle
                options={[{ l: 'Left', v: 'left' }, { l: 'Center', v: 'center' }]}
                value={align}
                onChange={setAlign}
              />
            </div>
            <div>
              <span className="mr-2 text-muted">Font</span>
              <Toggle
                options={[{ l: 'Serif', v: 'serif' }, { l: 'Sans', v: 'sans' }]}
                value={font}
                onChange={setFont}
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted">Ink</span>
              {['#f4f1ea', '#17130f', '#d6156a', '#c9a86a', '#69768b'].map((hex) => (
                <button
                  key={hex}
                  onClick={() => setInk(hex)}
                  aria-label={`ink ${hex}`}
                  className={
                    'h-6 w-6 rounded-full border transition-transform hover:scale-110 ' +
                    (ink.toLowerCase() === hex ? 'border-fuchsia ring-1 ring-fuchsia' : 'border-line')
                  }
                  style={{ background: hex }}
                />
              ))}
              <input
                type="color"
                value={ink}
                onChange={(e) => setInk(e.target.value)}
                aria-label="custom ink colour"
                className="h-6 w-6 cursor-pointer rounded-full border border-line bg-transparent p-0"
              />
            </div>
            <label className="flex items-center gap-2 text-muted">
              <input type="checkbox" checked={scrim} onChange={(e) => setScrim(e.target.checked)} />
              Legibility shade
            </label>
            <label className="flex items-center gap-2 text-muted">
              Size
              <input
                type="range"
                min="1.5"
                max="9"
                step="0.25"
                value={size}
                onChange={(e) => setSize(+e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-muted">
              Spacing
              <input
                type="range"
                min="1"
                max="2.4"
                step="0.05"
                value={leading}
                onChange={(e) => setLeading(+e.target.value)}
              />
            </label>
          </div>

          {/* Darkroom — the picture only; the poem keeps the colour you chose */}
          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="font-grotesk text-[0.72rem] font-bold uppercase tracking-[0.18em] text-muted">
                The image
              </span>
              {adjusted && (
                <button
                  onClick={() =>
                    setAdj({ brightness: 1, contrast: 1, saturate: 1, hue: 0, sepia: 0, blur: 0 })
                  }
                  className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted transition-colors hover:border-fuchsia hover:text-fuchsia"
                >
                  reset
                </button>
              )}
            </div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {[
                { k: 'brightness', l: 'Brightness', min: 0.3, max: 1.8, step: 0.01 },
                { k: 'contrast', l: 'Contrast', min: 0.3, max: 2, step: 0.01 },
                { k: 'saturate', l: 'Saturation', min: 0, max: 2.5, step: 0.01 },
                { k: 'hue', l: 'Hue', min: -180, max: 180, step: 1 },
                { k: 'sepia', l: 'Warmth', min: 0, max: 1, step: 0.01 },
                { k: 'blur', l: 'Blur', min: 0, max: 2, step: 0.02 },
              ].map(({ k, l, min, max, step }) => (
                <label key={k} className="flex items-center gap-2 text-sm text-muted">
                  <span className="w-20 shrink-0">{l}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={adj[k]}
                    onChange={(e) => setAdj((a) => ({ ...a, [k]: +e.target.value }))}
                    className="flex-1"
                  />
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <canvas
            ref={canvasRef}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={onKeyDown}
            title="Drag the poem to place it — arrow keys nudge"
            className={
              'w-full touch-none rounded-sm border border-line focus:outline-none focus-visible:border-fuchsia ' +
              (poem.trim() ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : '')
            }
          />
          {poem.trim() && (
            <p className="mt-2 text-xs text-muted">
              Drag the poem where you want it. Arrow keys nudge; hold shift for bigger steps.
            </p>
          )}
          <button
            onClick={download}
            disabled={!poem.trim()}
            className="mt-3 rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-50"
          >
            Download image + poem
          </button>
        </div>
      </div>
    </div>
  )
}

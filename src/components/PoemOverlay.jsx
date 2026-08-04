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
  const [place, setPlace] = useState('bottom') // top | middle | bottom
  const [align, setAlign] = useState('left') // left | center
  const [font, setFont] = useState('serif') // serif | sans
  const [ink, setInk] = useState('#f4f1ea') // any hex colour
  const [scrim, setScrim] = useState(true)
  const [size, setSize] = useState(4) // % of image height
  const [leading, setLeading] = useState(1.4) // line spacing multiplier
  const canvasRef = useRef(null)
  const imgRef = useRef(null)
  const fileRef = useRef(null)

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
  useEffect(draw, [poem, place, align, font, ink, scrim, size, leading, src])

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
    ctx.drawImage(img, 0, 0, W, H)

    const pad = W * 0.07
    const fontPx = Math.max(8, Math.round((size / 100) * H))
    const lineH = fontPx * leading
    const family = font === 'serif' ? '"Iowan Old Style", Georgia, serif' : 'Helvetica, Arial, sans-serif'
    const style = font === 'serif' ? 'italic ' : ''
    ctx.font = `${style}${fontPx}px ${family}`
    ctx.textBaseline = 'alphabetic'

    // is the chosen ink light or dark? (drives the legibility shade direction)
    const inkLight = (() => {
      const m = /^#?([0-9a-f]{6})$/i.exec(ink)
      if (!m) return true
      const n = parseInt(m[1], 16)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
      return 0.299 * r + 0.587 * g + 0.114 * b > 140
    })()

    // wrap each authored line, PRESERVING the poet's leading indentation
    const maxW = W - pad * 2
    const lines = []
    for (const raw of poem.split('\n')) {
      if (raw.trim() === '') { lines.push(''); continue }
      const indentMatch = raw.match(/^(\s+)/)
      const indent = indentMatch ? indentMatch[1].replace(/\t/g, '    ') : ''
      let cur = indent
      const words = raw.trim().split(/\s+/)
      for (const word of words) {
        const test = cur.trim() ? cur + ' ' + word : cur + word
        if (ctx.measureText(test).width > maxW && cur.trim()) {
          lines.push(cur)
          cur = indent + word // keep the indent on wrapped continuations
        } else cur = test
      }
      lines.push(cur)
    }

    const blockH = lines.length * lineH
    let y
    if (place === 'top') y = pad + fontPx
    else if (place === 'middle') y = (H - blockH) / 2 + fontPx
    else y = H - pad - blockH + fontPx

    // legibility scrim (shade behind the text, coloured opposite the ink)
    if (scrim && poem.trim()) {
      const shade = inkLight ? '10,8,6' : '245,240,232'
      const g = ctx.createLinearGradient(0, 0, 0, H)
      const a = inkLight ? 0.6 : 0.5
      if (place === 'bottom') {
        g.addColorStop(0, `rgba(${shade},0)`)
        g.addColorStop(0.55, `rgba(${shade},0)`)
        g.addColorStop(1, `rgba(${shade},${a})`)
      } else if (place === 'top') {
        g.addColorStop(0, `rgba(${shade},${a})`)
        g.addColorStop(0.45, `rgba(${shade},0)`)
      } else {
        g.addColorStop(0, `rgba(${shade},${a * 0.7})`)
        g.addColorStop(1, `rgba(${shade},${a * 0.7})`)
      }
      ctx.fillStyle = g
      ctx.fillRect(0, 0, W, H)
    }

    // draw the poem — a soft shadow keeps small text crisp over any image
    ctx.save()
    ctx.shadowColor = inkLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)'
    ctx.shadowBlur = fontPx * 0.12
    ctx.fillStyle = ink
    ctx.textAlign = align
    const x = align === 'center' ? W / 2 : pad
    lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lineH))
    ctx.restore()
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
            Bring any image — a photo, a saved Cosmos reference, anything — and set your words over it
            in your own type. Export a finished piece.
          </Reveal>
        </header>
      ) : (
        <>
          <h4 className="font-grotesk text-base font-extrabold tracking-tight text-body">
            Put your poem on it
          </h4>
          <p className="mt-1 text-sm text-muted">
            Paste your poem — your line breaks are kept. Then place it and export a finished image.
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
          {src ? 'Image loaded — paste, drop, or click to swap it' : 'Paste (⌘V), drop, or click to load an image'}
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
            <div>
              <span className="mr-2 text-muted">Place</span>
              <Toggle
                options={[{ l: 'Top', v: 'top' }, { l: 'Middle', v: 'middle' }, { l: 'Bottom', v: 'bottom' }]}
                value={place}
                onChange={setPlace}
              />
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
        </div>

        <div>
          <canvas ref={canvasRef} className="w-full rounded-sm border border-line" />
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

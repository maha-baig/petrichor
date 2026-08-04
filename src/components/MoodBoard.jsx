import { useEffect, useMemo, useRef, useState } from 'react'
import { readMoodboard, illustrate, searchImages } from '../api.js'
import PoemOverlay from './PoemOverlay.jsx'
import Masonry from './Masonry.jsx'
import { useCapabilities } from '../useCapabilities.js'

const SOURCE_LABELS = {
  openverse: 'Openverse',
  cosmos: 'Cosmos',
  pexels: 'Pexels',
  unsplash: 'Unsplash',
}

// Downscale any image file/blob to a modest JPEG data URL (keeps payloads small).
// Resolves { src, aspect } — the masonry board needs the ratio to lay tiles out.
function fileToDataUrl(file, max = 768) {
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
      resolve({ src: c.toDataURL('image/jpeg', 0.85), aspect: w / h })
    }
    img.onerror = reject
    img.src = url
  })
}

// Pull a handful of dominant colours out of the pasted images (coarse bucketing).
function extractPalette(dataUrls, onDone) {
  const counts = {}
  let pending = dataUrls.length
  if (!pending) return onDone([])
  dataUrls.forEach((url) => {
    const img = new Image()
    img.onload = () => {
      const c = document.createElement('canvas')
      c.width = 40
      c.height = 40
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0, 40, 40)
      const { data } = ctx.getImageData(0, 0, 40, 40)
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] >> 5,
          g = data[i + 1] >> 5,
          b = data[i + 2] >> 5
        const key = `${r},${g},${b}`
        counts[key] = (counts[key] || 0) + 1
      }
      if (--pending === 0) {
        const top = Object.entries(counts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([k]) => {
            const [r, g, b] = k.split(',').map(Number)
            const hex = (n) => ((n << 5) + 16).toString(16).padStart(2, '0')
            return `#${hex(r)}${hex(g)}${hex(b)}`
          })
        onDone(top)
      }
    }
    img.src = url
  })
}

/**
 * The mood board.
 *
 * Uncontrolled by default (it keeps its own tiles). Pass `tiles` + `onTilesChange`
 * and a workspace owns them instead, so they can be saved and come back later;
 * `initial` seeds the reading/generated image the same way.
 */
export default function MoodBoard({
  feeling,
  paletteNames = [],
  searchTerms = [],
  tiles: tilesProp,
  onTilesChange,
  onPaletteChange,
  onReadingChange,
  onGeneratedChange,
  initial = null,
}) {
  const controlled = Array.isArray(tilesProp)
  const [ownTiles, setOwnTiles] = useState([]) // [{ id, img, aspect }]
  const tiles = controlled ? tilesProp : ownTiles
  const setTiles = (update) => {
    const next = typeof update === 'function' ? update(tiles) : update
    if (controlled) onTilesChange?.(next)
    else setOwnTiles(next)
  }

  const [palette, setPalette] = useState([])
  const [reading, setReading] = useState(initial?.reading || null) // { see, prompt }
  const [genPrompt, setGenPrompt] = useState(initial?.generated?.prompt || '')
  const [image, setImage] = useState(initial?.generated?.image || null) // generated data URL
  const [phase, setPhase] = useState(null) // 'reading' | 'generating'
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const nextId = useRef(0)

  // Gathering: candidates fetched from a search term, waiting to be chosen.
  const [gatherTerm, setGatherTerm] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [gathering, setGathering] = useState(false)
  const [gatherError, setGatherError] = useState(null)
  const [source, setSource] = useState(null)
  const [taken, setTaken] = useState(() => new Set())

  // Reading the board and generating an image need llava (via Ollama) and
  // ComfyUI. Those exist on the poet's own machine but not on the hosted
  // build, so we ask the server what it can do rather than sniffing the URL —
  // that stays right when Petrichor runs on a LAN address or a custom host.
  const caps = useCapabilities()
  const aiAvailable = caps ? caps.moodboardVision && caps.imageGeneration : true

  // Gathering, unlike the two above, is served by our own server — so it is
  // available on the deployed site as well as locally.
  const sources = caps?.imageSources || []
  const canGather = !!caps?.imageSearch && searchTerms.length > 0
  const activeSource = source || sources[0] || null

  // The plain data URLs — what the vision model and the palette extractor want.
  const images = useMemo(() => tiles.map((t) => t.img), [tiles])

  // Which tiles these are, by content rather than array identity. A parent that
  // passes `tiles={ws.images || []}` hands us a fresh array on every render, and
  // keying the palette effect on identity would re-run it every render — each
  // run reporting a palette, which saves, which re-renders, forever.
  const tilesKey = useMemo(() => tiles.map((t) => t.id).join(','), [tiles])

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith('image/'))
    const added = await Promise.all(files.map((f) => fileToDataUrl(f)))
    setTiles((prev) => [
      ...prev,
      // ids must not collide with tiles restored from a saved workspace
      ...added.map(({ src, aspect }) => ({
        id: `t${Date.now().toString(36)}${nextId.current++}`,
        img: src,
        aspect,
      })),
    ])
  }

  // A candidate becomes a tile by the same road a dropped file takes: fetch the
  // bytes, then hand the blob to addFiles so it gets downscaled, measured and
  // turned into a data URL. Everything downstream — the palette, the vision
  // model, the saved workspace, the collage — then can't tell the difference.
  async function addRemote(candidate) {
    setGatherError(null)
    try {
      const res = await fetch(candidate.full)
      if (!res.ok) throw new Error('That image would not load.')
      const blob = await res.blob()
      await addFiles([blob])
      setTaken((prev) => new Set(prev).add(candidate.id))
    } catch (e) {
      setGatherError(e.message)
    }
  }

  async function gather(term) {
    setGatherTerm(term)
    setGathering(true)
    setGatherError(null)
    setCandidates([])
    try {
      const r = await searchImages({ term, source: activeSource, count: 12 })
      setCandidates(r.results || [])
      setSource(r.source)
      if (!r.results?.length) setGatherError('Nothing came back for that one.')
    } catch (e) {
      setGatherError(e.message)
    } finally {
      setGathering(false)
    }
  }

  // paste images from anywhere on the page (e.g. copied from Cosmos)
  useEffect(() => {
    function onPaste(e) {
      const items = [...(e.clipboardData?.items || [])]
      const files = items.filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile())
      if (files.length) {
        e.preventDefault()
        addFiles(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Re-read the palette when the tiles actually change. Only tell the parent
  // when the colours are genuinely different — otherwise a no-op save fires on
  // every mount, and each save re-renders us into another one.
  const lastPalette = useRef(null)
  useEffect(() => {
    extractPalette(images, (p) => {
      setPalette(p)
      const key = p.join(',')
      if (key === lastPalette.current) return
      lastPalette.current = key
      onPaletteChange?.(p)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesKey])

  async function readBoard() {
    setPhase('reading')
    setError(null)
    setReading(null)
    setImage(null)
    try {
      // send the colours extracted from the pasted images so they're enforced
      const r = await readMoodboard({ images, feeling, colors: palette })
      setReading(r)
      setGenPrompt(r.prompt || '')
      onReadingChange?.(r)
    } catch (e) {
      setError(e.message)
    } finally {
      setPhase(null)
    }
  }

  async function generate() {
    setPhase('generating')
    setError(null)
    setImage(null)
    try {
      const { image } = await illustrate({ prompt: genPrompt })
      setImage(image)
      onGeneratedChange?.({ image, prompt: genPrompt })
    } catch (e) {
      setError(e.message)
    } finally {
      setPhase(null)
    }
  }

  return (
    <div className="mt-12 border-t border-line pt-8">
      <h3 className="font-grotesk text-lg font-extrabold tracking-tight text-body">
        {aiAvailable ? 'Mood board → image' : 'Mood board'}
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Gather images in Cosmos, then <b className="text-body">paste them here</b> (⌘V) or drop them
        in — or {canGather ? 'tap a search term below and pick from what comes back' : 'add them by hand'}.{' '}
        {aiAvailable
          ? 'The model reads the whole board and generates a new image in its spirit.'
          : 'The board and its palette work here; reading the board and generating an image need the local models, so they run when Petrichor is on your own machine.'}
      </p>

      {/* Drop / paste zone */}
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          addFiles(e.dataTransfer.files)
        }}
        onClick={() => fileRef.current?.click()}
        className="mt-4 cursor-pointer rounded-sm border border-dashed border-line bg-card/50 p-6 text-center text-sm text-muted transition-colors hover:border-fuchsia"
      >
        Paste (⌘V), drop, or click to add images
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {/* Gather — the search terms, fetched for you. You still pick. */}
      {canGather && (
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
            <span className="font-grotesk text-sm font-bold uppercase tracking-[0.08em] text-muted">
              Or gather from a term
            </span>
            {sources.length > 1 && (
              <select
                value={activeSource || ''}
                onChange={(e) => setSource(e.target.value)}
                className="rounded-sm border border-line bg-card px-2 py-1 text-xs text-muted focus:border-fuchsia focus:outline-none"
              >
                {sources.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s] || s}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {searchTerms.map((term) => (
              <button
                key={term}
                onClick={() => gather(term)}
                disabled={gathering}
                className={`rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50 ${
                  gatherTerm === term
                    ? 'border-fuchsia text-fuchsia'
                    : 'border-line text-muted hover:border-fuchsia hover:text-fuchsia'
                }`}
              >
                {term}
              </button>
            ))}
          </div>

          {gathering && <p className="mt-3 text-sm text-muted">Looking for “{gatherTerm}”…</p>}

          {candidates.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-sm text-muted">
                Click the ones you want. {candidates.length} found
                {activeSource ? ` on ${SOURCE_LABELS[activeSource] || activeSource}` : ''}.
              </p>
              <div className="flex flex-wrap gap-2">
                {candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => addRemote(c)}
                    title={[c.credit, c.license].filter(Boolean).join(' · ') || 'Add to the board'}
                    className={`group relative h-24 w-24 overflow-hidden rounded-sm border transition-all ${
                      taken.has(c.id)
                        ? 'border-fuchsia opacity-40'
                        : 'border-line hover:border-fuchsia hover:scale-[1.03]'
                    }`}
                  >
                    <img
                      src={c.thumb}
                      alt={c.credit || ''}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    {taken.has(c.id) && (
                      <span className="absolute inset-0 grid place-items-center bg-ink/50 text-xs text-paper">
                        added
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {candidates.some((c) => c.credit) && (
                <p className="mt-2 text-xs text-muted">
                  Hover for the photographer and licence — credit them if the poem goes out.
                </p>
              )}
            </div>
          )}

          {gatherError && <p className="mt-3 text-sm text-fuchsia">{gatherError}</p>}
        </div>
      )}

      {images.length > 0 && (
        <>
          {/* The board — tiles fly up into place and re-flow when one is removed */}
          <div className="mt-5">
            <Masonry
              items={tiles}
              animateFrom="bottom"
              stagger={0.06}
              duration={0.5}
              hoverScale={0.97}
              renderOverlay={(item) => (
                <button
                  onClick={() => setTiles((p) => p.filter((t) => t.id !== item.id))}
                  className="absolute right-1.5 top-1.5 rounded-full bg-ink/70 px-2 py-0.5 text-xs text-paper opacity-0 transition-opacity group-hover:opacity-100"
                >
                  ✕
                </button>
              )}
            />
          </div>

          {/* Extracted palette */}
          {palette.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-3">
              {palette.map((hex, i) => (
                <span key={i} className="flex items-center gap-2 text-xs text-muted">
                  <span
                    className="h-5 w-5 rounded-sm border border-black/10"
                    style={{ background: hex }}
                  />
                  {hex}
                </span>
              ))}
            </div>
          )}

          {aiAvailable ? (
            <button
              onClick={readBoard}
              disabled={phase === 'reading'}
              className="mt-5 rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
            >
              {phase === 'reading' ? 'Reading the board…' : 'Read the board'}
            </button>
          ) : (
            <p className="mt-5 rounded-sm border border-line bg-card/50 px-4 py-3 text-sm text-muted">
              <b className="text-body">Reading the board runs locally.</b> It uses a vision model and
              a local image generator, which this hosted version can't reach. Run Petrichor on your
              own machine for that step.
            </p>
          )}
        </>
      )}

      {error && <p className="mt-4 text-sm text-fuchsia">{error}</p>}

      {reading && (
        <div className="mt-8 animate-rise">
          <p className="font-serif text-lg italic leading-relaxed text-body">“{reading.see}”</p>

          {reading.colors?.length > 0 && (
            <p className="mt-3 text-sm text-muted">
              Palette locked into the prompt:{' '}
              <span className="text-body">{reading.colors.join(' · ')}</span>
            </p>
          )}

          <label className="mt-6 block font-grotesk text-sm font-bold uppercase tracking-[0.08em] text-muted">
            Image prompt (edit freely)
          </label>
          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            rows={3}
            className="mt-2 w-full resize-y rounded-sm border border-line bg-card px-4 py-3 text-body focus:border-fuchsia focus:outline-none"
          />
          <button
            onClick={generate}
            disabled={phase === 'generating' || !genPrompt.trim()}
            className="mt-3 rounded-full bg-fuchsia px-6 py-2.5 font-grotesk font-bold text-white transition-transform hover:scale-[1.02] disabled:opacity-60"
          >
            {phase === 'generating' ? 'Generating… (~30s)' : 'Generate image'}
          </button>
        </div>
      )}

      {image && (
        <div className="mt-8 animate-rise">
          <img src={image} alt="generated" className="max-w-md rounded-sm border border-line" />
          <div className="mt-2">
            <a
              href={image}
              download="petrichor.png"
              className="text-sm text-muted underline hover:text-fuchsia"
            >
              Save image
            </a>
          </div>

          <PoemOverlay imageSrc={image} />
        </div>
      )}
    </div>
  )
}

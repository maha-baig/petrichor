import 'dotenv/config'
import express from 'express'
import {
  buildPromptEngineMessages,
  buildWordEngineMessages,
  buildMoreWordsMessages,
  buildWordMapMessages,
  buildReviewMessages,
  buildMoodboardInstruction,
  buildPromptOptimizerMessages,
} from './prompts.js'

const PORT = process.env.PORT || 8787

// Provider: 'groq' (free tier, hosted, default) · 'ollama' (free, local) ·
// 'gemini' (free tier) · 'anthropic' (paid).
const PROVIDER = process.env.MUSE_PROVIDER || 'groq'
// Fallback: if the primary provider fails, silently retry here. '' or 'none' disables.
const FALLBACK = (process.env.MUSE_FALLBACK ?? 'ollama').toLowerCase()

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b'
const ANTHROPIC_MODEL = process.env.MUSE_MODEL || 'claude-sonnet-5'

// Vision (mood-board reading) + image generation (ComfyUI) — both local & free.
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || 'llava:7b'
const COMFY_URL = process.env.COMFY_URL || 'http://127.0.0.1:8188'
const COMFY_CKPT = process.env.COMFY_CKPT || 'dreamshaper_8.safetensors'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = express()
app.use(express.json({ limit: '30mb' })) // pasted mood-board images travel as base64

// Pull the first JSON object out of a reply, tolerating stray prose or code fences.
function extractJSON(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('No JSON found in model response')
  return JSON.parse(candidate.slice(start, end + 1))
}

// ── Groq (free tier, hosted, default) ────────────────────────────────
// OpenAI-compatible. Serves the same Llama family we run locally, so the
// voice tuned in prompts.js carries over — just faster and larger.
async function callGroq({ system, user }, temperature) {
  const key = process.env.GROQ_API_KEY
  if (!key)
    throw new Error('GROQ_API_KEY is not set. Get a free key at https://console.groq.com/keys')
  let res
  try {
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch {
    throw new Error('Could not reach Groq. Check your connection.')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 401) throw new Error('Groq rejected the key — check GROQ_API_KEY.')
    if (res.status === 429)
      throw new Error('Groq rate limit reached — wait a moment and try again.')
    throw new Error(`Groq error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content || ''
}

// ── Gemini (free tier) ───────────────────────────────────────────────
async function callGemini({ system, user }, temperature) {
  const key = process.env.GEMINI_API_KEY
  if (!key)
    throw new Error(
      'GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it to .env',
    )
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`
  let res
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature, responseMimeType: 'application/json' },
      }),
    })
  } catch {
    throw new Error('Could not reach Gemini. Check your connection.')
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 429)
      throw new Error('Gemini free-tier rate limit hit — wait a moment and try again.')
    throw new Error(`Gemini error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
}

// ── Ollama (local, free) ─────────────────────────────────────────────
async function callOllama({ system, user }, temperature) {
  let res
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        format: 'json', // ask Ollama to constrain output to valid JSON
        options: { temperature },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch {
    throw new Error(
      `Can't reach Ollama at ${OLLAMA_URL}. Is it running? Try: ollama serve  (and: ollama pull ${OLLAMA_MODEL})`,
    )
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 404)
      throw new Error(`Model "${OLLAMA_MODEL}" not found. Run: ollama pull ${OLLAMA_MODEL}`)
    throw new Error(`Ollama error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  return data?.message?.content || ''
}

// ── Anthropic (paid, optional) ───────────────────────────────────────
let anthropic = null
async function callAnthropic({ system, user }, temperature) {
  if (!anthropic) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
    if (!process.env.ANTHROPIC_API_KEY)
      throw new Error('ANTHROPIC_API_KEY is not set — needed for MUSE_PROVIDER=anthropic.')
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  const msg = await anthropic.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    temperature,
    system,
    messages: [{ role: 'user', content: user }],
  })
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

const CALLERS = { groq: callGroq, gemini: callGemini, ollama: callOllama, anthropic: callAnthropic }

async function callProvider(name, messages, temperature) {
  const fn = CALLERS[name]
  if (!fn) throw new Error(`Unknown provider "${name}"`)
  return extractJSON(await fn(messages, temperature))
}

async function generate(messages, temperature) {
  try {
    return await callProvider(PROVIDER, messages, temperature)
  } catch (primaryErr) {
    const useFallback = FALLBACK && FALLBACK !== 'none' && FALLBACK !== PROVIDER
    if (!useFallback) throw primaryErr
    console.warn(`⚠  ${PROVIDER} failed (${primaryErr.message}) — falling back to ${FALLBACK}`)
    try {
      return await callProvider(FALLBACK, messages, temperature)
    } catch (fallbackErr) {
      throw new Error(
        `${PROVIDER} failed (${primaryErr.message}); ${FALLBACK} fallback also failed (${fallbackErr.message})`,
      )
    }
  }
}

function activeModel() {
  if (PROVIDER === 'anthropic') return ANTHROPIC_MODEL
  if (PROVIDER === 'ollama') return OLLAMA_MODEL
  if (PROVIDER === 'gemini') return GEMINI_MODEL
  return GROQ_MODEL
}

async function runEngine(res, messages, temperature) {
  try {
    return res.json(await generate(messages, temperature))
  } catch (err) {
    console.error(err.message)
    return res.status(500).json({ error: err.message || 'The muse stumbled. Try again.' })
  }
}

// 1) Prompt engine — a few ways into the poem.
app.post('/api/prompts', (req, res) => {
  const { mood = 'melancholy', echoes = [], count = 4 } = req.body || {}
  runEngine(res, buildPromptEngineMessages({ mood, echoes, count }), 1.0)
})

// 2) Word engine — evocative words + Cosmos search terms + a starting palette.
app.post('/api/words', (req, res) => {
  const { prompt, mood = 'melancholy' } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'A prompt is required.' })
  runEngine(res, buildWordEngineMessages({ prompt, mood }), 0.9)
})

// Models repeat themselves however firmly you ask them not to — so the "give me
// more" routes drop anything the poet already has, comparing loosely.
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')

function freshOnly(items, exclude, key = (x) => x) {
  const seen = new Set((exclude || []).map(norm))
  const out = []
  for (const item of items || []) {
    const k = norm(key(item))
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

// 2b) More of one currency — a second helping of Cosmos terms or writing words.
app.post('/api/words/more', async (req, res) => {
  const { prompt, mood = 'melancholy', want = 'searchTerms', count = 8, exclude = [] } = req.body || {}
  if (!prompt) return res.status(400).json({ error: 'A prompt is required.' })
  const key = want === 'evocative' ? 'evocative' : 'searchTerms'
  try {
    const data = await generate(
      buildMoreWordsMessages({ prompt, mood, want: key, count, exclude }),
      1.0,
    )
    return res.json({ [key]: freshOnly(data[key], exclude).slice(0, count) })
  } catch (err) {
    console.error(err.message)
    return res.status(500).json({ error: err.message || 'The muse stumbled. Try again.' })
  }
})

const fallbackActive = FALLBACK && FALLBACK !== 'none' && FALLBACK !== PROVIDER

// Words that belong to the app, not the poem — never let them leak into output.
const APP_WORDS = new Set(['petrichor', 'verse', 'muse loop', 'museloop'])

// 3) Word map — a colourful constellation of words around a feeling.
app.post('/api/wordmap', async (req, res) => {
  const { feeling, mood = 'melancholy', count = 18, exclude = [] } = req.body || {}
  if (!feeling) return res.status(400).json({ error: 'A feeling is required.' })
  try {
    const data = await generate(buildWordMapMessages({ feeling, mood, count, exclude }), 1.0)
    const words = freshOnly(
      (data.words || []).filter(
        (w) => w?.text && !APP_WORDS.has(String(w.text).trim().toLowerCase()),
      ),
      exclude,
      (w) => w.text,
    )
    return res.json({ ...data, words })
  } catch (err) {
    console.error(err.message)
    return res.status(500).json({ error: err.message })
  }
})

// 4) Poem reviewer — a generous reading + craft suggestions.
app.post('/api/review', (req, res) => {
  const { poem } = req.body || {}
  if (!poem || !poem.trim()) return res.status(400).json({ error: 'Paste a poem first.' })
  runEngine(res, buildReviewMessages({ poem }), 0.7)
})

// ── Mood board: vision model reads the pasted images ─────────────────
async function callOllamaVision(instruction, base64Images) {
  let res
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_VISION_MODEL,
        stream: false,
        format: 'json',
        options: { temperature: 0.6 },
        messages: [{ role: 'user', content: instruction, images: base64Images }],
      }),
    })
  } catch {
    throw new Error(`Can't reach Ollama at ${OLLAMA_URL}. Is it running?`)
  }
  if (!res.ok) {
    if (res.status === 404)
      throw new Error(`Vision model "${OLLAMA_VISION_MODEL}" not found. Run: ollama pull ${OLLAMA_VISION_MODEL}`)
    throw new Error(`Ollama vision error ${res.status}`)
  }
  const data = await res.json()
  return data?.message?.content || ''
}

// strip "data:image/...;base64," → raw base64
const toBase64 = (dataUrl) => String(dataUrl).replace(/^data:[^,]*,/, '')

// Nearest named colour, so palettes reach SD as words it understands (not hex).
const NAMED_COLORS = [
  ['black', 0, 0, 0], ['charcoal', 54, 54, 54], ['grey', 128, 128, 128],
  ['silver', 190, 190, 190], ['white', 245, 245, 245], ['cream', 235, 225, 200],
  ['beige', 210, 195, 170], ['tan', 190, 160, 120], ['brown', 110, 70, 45],
  ['rust', 150, 70, 40], ['ochre', 180, 120, 40], ['amber', 200, 140, 50],
  ['gold', 200, 168, 100], ['mustard', 200, 175, 60], ['olive', 110, 110, 50],
  ['sage green', 140, 150, 120], ['forest green', 40, 90, 55], ['green', 70, 140, 70],
  ['teal', 40, 120, 120], ['slate blue-grey', 105, 118, 139], ['navy', 30, 40, 80],
  ['blue', 45, 90, 200], ['sky blue', 140, 185, 225], ['lavender', 200, 190, 220],
  ['purple', 110, 70, 140], ['mauve', 150, 110, 140], ['dusty rose', 190, 140, 140],
  ['pink', 230, 150, 170], ['red', 190, 50, 50], ['orange', 220, 120, 50],
]
function hexToName(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  let best = null, bestD = Infinity
  for (const [name, cr, cg, cb] of NAMED_COLORS) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestD) { bestD = d; best = name }
  }
  return best
}
function paletteToNames(colors = []) {
  const seen = new Set()
  for (const c of colors) {
    const name = hexToName(c)
    if (name) seen.add(name)
    if (seen.size >= 4) break
  }
  return [...seen]
}

// 5) Mood board — two stages: vision model DESCRIBES the images, then the
//    stronger text model writes an optimised SD prompt with the real palette.
app.post('/api/moodboard', async (req, res) => {
  const { images = [], feeling = '', colors = [] } = req.body || {}
  if (!images.length) return res.status(400).json({ error: 'Paste at least one image first.' })
  try {
    const colorNames = paletteToNames(colors)

    // stage 1 — vision describes what it actually sees
    const instruction = buildMoodboardInstruction({ feeling, colorNames })
    const seen = extractJSON(await callOllamaVision(instruction, images.slice(0, 6).map(toBase64)))

    // stage 2 — strong text model turns that into an optimised, palette-locked prompt
    const opt = await generate(
      buildPromptOptimizerMessages({ look: seen.look || seen.see || '', feeling, colorNames }),
      0.7,
    )

    return res.json({ see: seen.see || '', prompt: opt.prompt || '', colors: colorNames })
  } catch (err) {
    console.error(err.message)
    return res.status(500).json({ error: err.message })
  }
})

// ── Illustrate: generate an image with ComfyUI (SD 1.5) ──────────────
function sd15Workflow({ prompt, negative, width = 512, height = 640, seed }) {
  return {
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: COMFY_CKPT } },
    5: { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['4', 1] } },
    3: {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 25,
        cfg: 7,
        sampler_name: 'dpmpp_2m',
        scheduler: 'karras',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'petrichor', images: ['8', 0] } },
  }
}

const DEFAULT_NEG = 'blurry, low quality, text, watermark, signature, deformed, ugly, oversaturated'

app.post('/api/illustrate', async (req, res) => {
  const { prompt, negative = DEFAULT_NEG, width, height } = req.body || {}
  if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'An image prompt is required.' })
  const seed = Math.floor(Math.random() * 1e15)
  try {
    // queue
    let q
    try {
      q = await fetch(`${COMFY_URL}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: sd15Workflow({ prompt, negative, width, height, seed }) }),
      })
    } catch {
      throw new Error(`Can't reach ComfyUI at ${COMFY_URL}. Start it, then try again.`)
    }
    if (!q.ok) throw new Error(`ComfyUI rejected the job (${q.status}). Check the model is installed.`)
    const { prompt_id } = await q.json()

    // poll history until the image is ready (SD 1.5 ≈ 30s)
    let image = null
    for (let i = 0; i < 60; i++) {
      await sleep(2000)
      const h = await fetch(`${COMFY_URL}/history/${prompt_id}`).then((r) => r.json())
      const entry = h?.[prompt_id]
      if (!entry) continue
      const imgs = entry.outputs?.['9']?.images
      if (imgs && imgs.length) {
        image = imgs[0]
        break
      }
      if (entry.status?.status_str === 'error') throw new Error('ComfyUI hit an error generating.')
    }
    if (!image) throw new Error('Generation timed out. Is ComfyUI still loading the model?')

    // fetch the PNG and inline it as a data URL
    const view = `${COMFY_URL}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder || '')}&type=${image.type || 'output'}`
    const buf = Buffer.from(await fetch(view).then((r) => r.arrayBuffer()))
    return res.json({ image: `data:image/png;base64,${buf.toString('base64')}`, prompt })
  } catch (err) {
    console.error(err.message)
    return res.status(500).json({ error: err.message })
  }
})

// Local-only services (Ollama vision, ComfyUI) don't exist on a serverless
// host. The client reads this to hide what can't work here.
const LOCAL_SERVICES = process.env.PETRICHOR_LOCAL_SERVICES !== 'false'

app.get('/api/health', (_req, res) =>
  res.json({
    ok: true,
    provider: PROVIDER,
    model: activeModel(),
    fallback: fallbackActive ? FALLBACK : null,
    capabilities: {
      text: true,            // prompts, words, word map, reviewer
      moodboardVision: LOCAL_SERVICES,  // needs Ollama + llava
      imageGeneration: LOCAL_SERVICES,  // needs ComfyUI
    },
  }),
)

export default app

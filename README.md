# Petrichor

*The smell of rain on dry earth.* A poet's companion that hands you a prompt, then the raw
material to write with. It never writes the poem for you.

Part of the **Verse** world in the Maha Baig brand system — hot fuchsia, italic Iowan serif
against heavy Helvetica, ink on paper, theme-aware (paper by day, ink by night).

**Phase 1 (this build): the two AI engines.**
1. **Spark** — pick a register (melancholy by default) and Claude offers a few poetry prompts.
2. **Words** — choose a prompt and get two word sets: *evocative words* to write with, and
   *concrete search terms* to paste into [Cosmos](https://www.cosmos.so) for a mood board,
   plus a starting colour palette.

## Run it

Petrichor runs **free by default** on Google's Gemini free tier.

1. Get a free key at https://aistudio.google.com/apikey
2. Add it:
   ```bash
   cp .env.example .env
   # then edit .env and set GEMINI_API_KEY=...
   ```
3. Start both the web app and the engine server:
   ```bash
   npm run dev
   ```
4. Open the printed Vite URL (usually http://localhost:5173).

The key lives only in `server.js` (never the browser). The frontend proxies `/api/*` to the
local engine server on port 8787.

### Switching the brain
One env var picks the provider (see `.env.example`):
- `MUSE_PROVIDER=gemini` — **free tier, default** (`GEMINI_API_KEY`)
- `MUSE_PROVIDER=ollama` — fully free & local, needs Ollama running (`OLLAMA_MODEL=llama3.1:8b`)
- `MUSE_PROVIDER=anthropic` — best quality, paid (`ANTHROPIC_API_KEY`)

The prompts, UI, and Cosmos flow are identical across all three — only `server.js` changes.

## Tune the soul

Everything that shapes the words lives in [`prompts.js`](./prompts.js) — the prompt-engine
and word-engine instructions. Edit them freely; no UI changes needed.

## Brand tokens

The visual system lives in [`src/index.css`](./src/index.css): the ink / paper / line /
muted / body neutrals plus the three pigments (fuchsia · cobalt · amber), wired as
theme-aware CSS variables and mapped into Tailwind. Fonts: Iowan italic (display) +
Helvetica 800 (structure).

## Next phases (designed, not yet built)
- Save sessions as "Muses" (localStorage) + an "echoes" prompt mode from your own past poems
- Side-by-side writing pane with the prompt pinned
- Mood board from uploaded/pasted images with live palette extraction
- AI illustration of the finished poem

## Deploy
Portfolio-ready: the frontend is a static Vite build (`npm run build` → `dist/`). Host the
`/api` routes as serverless functions (e.g. Vercel) or run `server.js` alongside. Keep the
API key server-side. Intended home: `verse.mahabaig.com`.

---
*Note: the project folder is still named `muse-loop/`. Rename it to `petrichor/` any time —
nothing in the code depends on the folder name.*

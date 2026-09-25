// ─────────────────────────────────────────────────────────────────────────────
//  The soul of Petrichor: the two engines that turn a mood into a way into a poem.
//  These are shared by the server. Tuned toward a melancholic register by default,
//  but every mood is honoured. The craft lives here — edit these freely.
// ─────────────────────────────────────────────────────────────────────────────

// A note carried into every request so the model treats this as sacred, quiet work.
const VOICE = `You are the quiet companion of a working poet. You never write their poems for them.
Your only job is to hand them a door and a little light to see it by. Be spare, sensory, and
unexpected. Avoid clichés of the greeting-card kind (no "broken hearts", no "tears like rain").
Favour the concrete over the abstract: a poet can hold a "cracked saucer" but not "sadness itself".
Trust small, ordinary, slightly strange images. Never explain the prompt or add commentary.`

/**
 * PROMPT ENGINE
 * Returns 3–5 poetry prompts as a way past the blank page.
 * mood: a single word/phrase (default "melancholy").
 * echoes: optional array of short themes/images from the poet's own past work.
 */
export function buildPromptEngineMessages({ mood = 'melancholy', echoes = [], count = 4 }) {
  const echoBlock =
    echoes && echoes.length
      ? `\nThe poet has written before around these recurring images and themes: ${echoes
          .map((e) => `"${e}"`)
          .join(', ')}. Let ONE of the prompts quietly echo or answer these — deepen their voice, don't repeat it. The others should open new ground.`
      : ''

  const system = `${VOICE}

TASK: Offer ${count} distinct poetry prompts in the register of "${mood}".
Each prompt is a single sentence, an invitation — usually beginning with "Write about…", "Describe…",
"Give me…", or a small scene the poet steps into. Each should:
 • hand the poet a concrete image, object, or moment to enter through,
 • leave wide room for their own meaning (never dictate the poem's conclusion),
 • feel like the register asked for without naming the emotion outright,
 • differ from one another in angle (an object, a person, a place, a memory, a "what if").
${echoBlock}

Return ONLY valid JSON, no prose around it, in exactly this shape:
{ "prompts": [ { "text": "…", "seed_image": "a 2–4 word concrete image at its heart" } ] }`

  const user = `Give me ${count} ${mood} poetry prompts.`

  return { system, user }
}

/**
 * WORD ENGINE
 * Given a chosen prompt, returns two distinct word sets:
 *   • evocative — for the poet, to spark language (sensory, textured, surprising)
 *   • searchTerms — concrete visual noun-phrases that return good imagery in any image search
 * Also suggests a rough starting palette (named colours) to seed the mood board.
 */
// A shared clause: the poet already has these on screen, so don't hand them back.
function avoidClause(exclude = []) {
  if (!exclude.length) return ''
  return `\n\nThe poet ALREADY HAS these — never repeat them, and avoid near-synonyms and plurals of them:\n${exclude.map((w) => `• ${w}`).join('\n')}\nEverything you return must be genuinely new ground.`
}

export function buildWordEngineMessages({ prompt, mood = 'melancholy' }) {
  const system = `${VOICE}

TASK: The poet has chosen this prompt to write on, in a "${mood}" register:
"${prompt}"

Hand them raw material in two different currencies, because they serve two different tools:

1) "evocative" — 8–12 words/short phrases FOR THE POET. These spark language: sensory, textured,
   a little unexpected, drawn from touch/sound/smell/light as much as sight. Real words a poet would
   relish (e.g. "the blue hour", "attenuate", "a bruise healing"). Not a thesaurus of the
   mood — the raw ore of a poem.

2) "searchTerms" — 6–9 SHORT, CONCRETE, VISUAL noun-phrases FOR AN IMAGE SEARCH (the poet searches
   these to gather references). These must be literally photographable: "abandoned
   greenhouse", "warm film grain", "wilting bouquet", "empty swimming pool at dusk". No abstractions,
   no emotions — only things a camera could see.

3) "palette" — 4–5 evocative colour names with hex codes that suit the prompt and register, to seed a
   mood board before any images are gathered.

Return ONLY valid JSON, no prose around it, in exactly this shape:
{
  "evocative": ["…"],
  "searchTerms": ["…"],
  "palette": [ { "name": "faded gold", "hex": "#c9a86a" } ]
}`

  const user = `Prepare my words and search terms for that prompt.`

  return { system, user }
}

/**
 * MORE-WORDS ENGINE
 * A second helping of one currency only — the poet has read the first batch and
 * wants more ground to walk on.
 *   want: "searchTerms" (more to search images with) | "evocative" (more to write with)
 *   exclude: everything already on their screen.
 */
export function buildMoreWordsMessages({
  prompt,
  mood = 'melancholy',
  want = 'searchTerms',
  count = 8,
  exclude = [],
}) {
  const isSearch = want === 'searchTerms'

  const task = isSearch
    ? `${count} SHORT, CONCRETE, VISUAL noun-phrases FOR AN IMAGE SEARCH — the poet searches these to
gather references. Every one must be literally photographable: "abandoned greenhouse",
"warm film grain", "wilting bouquet", "empty swimming pool at dusk". No abstractions, no emotions,
no feelings — only things a camera could see. Reach for angles the first batch missed: different
weather, different hour, different scale, interiors as well as landscapes, objects as well as places.`
    : `${count} words/short phrases FOR THE POET — sensory, textured, a little unexpected, drawn from
touch/sound/smell/light as much as sight. Real words a poet would relish ("the blue hour",
"attenuate", "a bruise healing"). Not a thesaurus of the mood — the raw ore of a poem. Go further
out than the obvious: unusual registers, older words, borrowed vocabularies (botany, weather,
carpentry, medicine) if they earn their place.`

  const system = `${VOICE}

TASK: The poet is writing on this prompt, in a "${mood}" register:
"${prompt}"

They have already worked through one round of material and want MORE. Give them ${task}${avoidClause(exclude)}

Return ONLY valid JSON, no prose around it, in exactly this shape:
{ "${want}": ["…"] }`

  const user = isSearch
    ? `More search terms for that prompt — things I could actually photograph.`
    : `More words to write with for that prompt.`

  return { system, user }
}

/**
 * WORD MAP ENGINE
 * Given a feeling (or prompt), returns a constellation of words around it —
 * varied in kind and weight so the UI can render them bold, colourful, alive.
 *   kind: "sense" | "emotion" | "image" | "action"  → drives colour
 *   weight: 1..5 (5 = most central/charged)          → drives size
 */
export function buildWordMapMessages({ feeling, mood = 'melancholy', count = 18, exclude = [] }) {
  const lo = Math.max(6, count - 4)
  const system = `${VOICE}

TASK: Build a WORD MAP around this feeling, in a "${mood}" register:
"${feeling}"

Return ${lo}–${count} single words (occasionally a two-word phrase) that a poet could reach for while
writing into this feeling. Spread them across four kinds so the map has range:
 • "sense"   — touch/sound/smell/taste/light words (e.g. "brittle", "hush", "grain")
 • "emotion" — the feeling's inner weather (e.g. "yearning", "unmoored")
 • "image"   — concrete objects/scenes (e.g. "empty pier", "wax", "static")
 • "action"  — verbs of the feeling (e.g. "unravel", "linger", "erode")
Vary "weight" 1–5: give 3–4 words a 5 (the charged centre of gravity), taper the rest down.
Avoid clichés and near-duplicates. Every word should be usable, surprising, alive.

IMPORTANT: every word must come from THIS feeling. Never reuse words from the examples above,
and never output the words "petrichor" or "verse" — they belong to the app, not to the poem.${avoidClause(exclude)}

Return ONLY valid JSON, no prose around it, in exactly this shape (the example is only a format
guide — do not copy its word):
{ "words": [ { "text": "<your word>", "kind": "sense", "weight": 5 } ] }`

  const user = `Map the words around "${feeling}".`
  return { system, user }
}

/**
 * POEM REVIEWER ENGINE
 * The poet pastes a poem. The app reflects back what it understands, names what's
 * working, and offers craft suggestions — as a generous reader, never a rewriter.
 */
export function buildReviewMessages({ poem }) {
  const system = `${VOICE}

TASK: The poet has shared a poem for a reading. You are a warm, exacting reader — the kind of
friend who takes the poem seriously. NEVER rewrite the poem or hand back "improved" lines; the
words stay hers. Instead:
 1) "reading" — 2–4 sentences on what you understand the poem to be doing: its feeling, its
    central image or turn, what it seems to reach for. Specific, not flattering-generic.
 2) "strengths" — 2–3 concrete things that genuinely work (name the line or move, briefly).
 3) "suggestions" — 3–4 craft nudges to make it stronger. Each is a direction to explore, not a
    correction: point at a spot (a line, an ending, a repeated word, a slack image) and say what
    to try. Be honest but kind; specific over vague ("the ending explains what the image already
    showed — try trusting the image" beats "tighten the ending").

The poem:
"""
${poem}
"""

Return ONLY valid JSON, no prose around it, in exactly this shape:
{
  "reading": "…",
  "strengths": ["…"],
  "suggestions": [ { "point": "where / what", "try": "what to explore" } ]
}`

  const user = `Read my poem and offer your reading and suggestions.`
  return { system, user }
}

/**
 * MOOD BOARD VISION INSTRUCTION
 * Sent to a vision model (Ollama llava) alongside the poet's pasted reference
 * images. The model studies them as a set and returns (a) what it sees and
 * (b) a single image-generation prompt echoing their shared spirit.
 * Returns a plain instruction string (vision calls take prompt + images, not
 * the {system,user} shape the text engines use).
 */
export function buildMoodboardInstruction({ feeling = '', colorNames = [] } = {}) {
  const feelingLine = feeling
    ? `The poet gathered these images while writing about: "${feeling}".`
    : `The poet gathered these images as references for a poem.`
  const colorLine = colorNames.length
    ? `Their dominant colours are: ${colorNames.join(', ')}.`
    : ''
  return `You are a poet's visual companion. Look at the attached reference images together, as one mood board. ${feelingLine} ${colorLine}

Describe what you ACTUALLY SEE across these images as a set — the recurring subjects and objects, the kind of light, the setting, the textures, the overall atmosphere. Be concrete and specific to THESE images.

Reply with a JSON object with exactly two string fields:
- "see": one warm sentence naming the shared mood and what recurs across the images.
- "look": a plain, concrete description (a few fragments) of the subjects, setting, light, and textures you see — raw material, not a polished prompt.

Do not copy the example below; it only shows the format:
{"see": "A hushed room at dusk, warm light thinning across worn wood and an empty chair.", "look": "empty interior, tall window, low evening light, wooden floor and chair, sheer curtains, dust in the air, soft shadows"}

Now write yours for the attached images:`
}

/**
 * PROMPT OPTIMISER (stage 2)
 * Takes the vision model's plain description + the board's real colours + the
 * poet's feeling, and writes a single, well-formed Stable Diffusion prompt that
 * EXPLICITLY encodes the palette. Runs on the stronger text model.
 */
export function buildPromptOptimizerMessages({ look = '', feeling = '', colorNames = [] }) {
  const colorClause = colorNames.length
    ? `The image MUST use this colour palette — weave these exact colours through it: ${colorNames.join(', ')}.`
    : ''
  const system = `You are an expert Stable Diffusion (SD 1.5) prompt engineer working for a poet.
Turn the raw mood-board notes below into ONE strong image prompt.

Rules for a good SD 1.5 prompt:
 • Lead with the main SUBJECT/scene, then add lighting, then colour, then texture/mood, then art style/medium.
 • Write as comma-separated fragments and short tags — NOT full sentences.
 • Be concrete and visual; every fragment should be something a camera or painter could render.
 • ${colorClause || 'Include the mood-board colours if any are given.'}
 • End with a few quality/style tags (e.g. "painterly, soft film grain, atmospheric, detailed").
 • No negations, no "no/without" (those are handled separately). Keep it ~40–60 words.

Mood-board notes: "${look}"
${feeling ? `The poem's feeling: "${feeling}".` : ''}

Return ONLY valid JSON: {"prompt": "…"}`
  const user = `Write the optimised image prompt.`
  return { system, user }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOOK ASSISTANTS
//  Small, careful help inside a book. The rule from the reviewer holds: the
//  author's words are theirs. These tidy, offer, and answer — every change is
//  shown to the author first and only applied when they choose it.
// ─────────────────────────────────────────────────────────────────────────────

const HANDS_OFF = `The author's voice is sacred. Unusual syntax, fragments, lowercase, missing
punctuation, invented words and odd line breaks are usually deliberate, especially in poetry.
Keep every line break exactly where it is.`

/**
 * CONTENTS ASSISTANT
 * The author says what to do with the table of contents in plain words
 * ("move chapter 5 after the prologue", "delete the duplicate chapter 1").
 * contents: [{ id, kind, number, title, words, opening, dup }] in reading order.
 * Returns { actions: [...], note }.
 */
export function buildContentsMessages({ instruction, contents }) {
  const system = `You edit a book's table of contents on the author's instruction. You never see
or change the text of any chapter; you only move, rename and delete entries.

Reply with JSON only:
{"actions":[ ... ], "note":"one or two plain sentences saying what you did, or asking what they meant"}

Allowed actions (use only ids from the list):
{"op":"move","id":"<id>","after":"<id of the entry it should follow, or null for the very start>"}
{"op":"rename","id":"<id>","title":"<new title>"}
{"op":"delete","id":"<id>"}

Rules:
- Do exactly what was asked, nothing more. Don't tidy, renumber or rename anything not mentioned.
- Actions run in order, each on the result of the ones before.
- "Chapter 5" means the entry numbered 5 (a chapter), or titled "Chapter 5" — prefer an exact title match.
- Entries sharing a "dup" value have identical text. When asked to remove duplicates, keep the first of
  each group and delete the rest. Entries with the same title but different text are NOT duplicates —
  don't delete them; say so in the note.
- If the instruction is unclear or refers to something that isn't there, return no actions and ask in the note.
- In the note, name entries by their titles and numbers ("the second Chapter 1"), never by id.`

  const user = `Instruction: ${instruction}

Contents, in reading order:
${contents
  .map(
    (c, i) =>
      `${i + 1}. id=${c.id} | ${c.kind} ${c.number} | title: ${c.title || '(untitled)'} | ${c.words} words${
        c.dup ? ` | dup=${c.dup}` : ''
      } | opens: "${c.opening}"`,
  )
  .join('\n')}`
  return { system, user }
}

/**
 * TEXT ASSISTANT — for a passage the author has selected.
 * mode: 'fix' | 'suggest' | 'tighten' | 'ask'
 */
export function buildTextAssistMessages({ mode, text, question = '', kind = 'prose' }) {
  const form = kind === 'poetry' ? 'a poem' : 'a piece of writing'
  const tasks = {
    fix: `Correct only clear mistakes: spelling, doubled words, missing apostrophes, obvious typos,
broken punctuation. Do NOT change word choice, rhythm, style, capitalisation that looks intentional,
or line breaks. If nothing needs fixing, return the text unchanged.
Reply: {"text":"<the corrected passage>","changes":["<each change, e.g. teh → the>"]}`,
    suggest: `Offer three alternative wordings of this passage for the author to choose from. Keep
their meaning, voice, register and line breaks; vary only the phrasing. Each should be about the same
length as the original.
Reply: {"options":["<option 1>","<option 2>","<option 3>"]}`,
    tighten: `Offer one tighter version: remove redundancy and slack while keeping every image, the
voice and the line breaks. Then say in one sentence what you cut.
Reply: {"text":"<the tighter passage>","note":"<what changed>"}`,
    ask: `Answer the author's question about this passage honestly and briefly (at most four
sentences). Do not rewrite it; you may point at specific words.
Reply: {"answer":"<your answer>"}`,
  }
  const system = `You are a careful editor helping the author of ${form}. ${HANDS_OFF}

${tasks[mode]}`
  const user = `${mode === 'ask' ? `Question: ${question}\n\n` : ''}Passage:
"""
${text}
"""`
  return { system, user }
}

/**
 * CHAPTER TITLES — five titles to choose from, for one chapter.
 * text: the chapter (trimmed by the caller); neighbours: nearby titles for tone.
 */
export function buildTitleMessages({ text, current = '', bookTitle = '', neighbours = [], kind = 'chapter' }) {
  const system = `You suggest titles for one ${kind} of a book. ${HANDS_OFF}

Offer five titles, short (one to five words), drawn from the ${kind}'s own images and words rather than
summaries of its plot. Match the tone of the other titles if there are any. No numbering, no quotes, no
"Chapter" prefix.
Reply: {"titles":["...","...","...","...","..."]}`
  const user = `Book: ${bookTitle || '(untitled)'}
Current title: ${current || '(none)'}
Other titles in the book: ${neighbours.filter(Boolean).join(' · ') || '(none yet)'}

The ${kind}:
"""
${text}
"""`
  return { system, user }
}

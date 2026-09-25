// ─────────────────────────────────────────────────────────────────────────────
//  Importing documents: Word (.docx), Markdown, plain text and HTML become a
//  book, or new chapters in one.
//
//  Every format is turned into HTML, cleaned down to what the chapter editor
//  understands (paragraphs, line breaks, headings, bold/italic/underline/
//  strike, quotes, lists, scene breaks), then split into chapters at the
//  document's headings. Spaces are kept, so indented verse arrives indented.
// ─────────────────────────────────────────────────────────────────────────────

import { createPiece, createWork, htmlToText, countWords } from './library.js'

export const ACCEPT = '.docx,.md,.markdown,.txt,.text,.html,.htm'
const MAX_BYTES = 25 * 1024 * 1024

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── each format → HTML ───────────────────────────────────────────────────────

async function docxToHtml(file) {
  const mod = await import('mammoth/mammoth.browser.js')
  const mammoth = mod.default || mod
  const { value } = await mammoth.convertToHtml(
    { arrayBuffer: await file.arrayBuffer() },
    {
      // Word's own heading styles become chapter breaks; titles become h1.
      styleMap: ['p[style-name="Title"] => h1:fresh', 'p[style-name="Subtitle"] => h2:fresh'],
      ignoreEmptyParagraphs: false,
    },
  )
  return value
}

async function markdownToHtml(text) {
  const { marked } = await import('marked')
  // `breaks`: a single newline is a line break, the way poems are written.
  return marked.parse(text, { breaks: true, gfm: true })
}

/**
 * Plain text: a blank line starts a new paragraph (a new stanza), a single
 * newline is a line break, and every space is kept. Lines like "Chapter 3" or
 * "CHAPTER THREE" on their own become chapter headings.
 */
function textToHtml(text) {
  const blocks = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  return blocks
    .map((b) => b.replace(/\s+$/, ''))
    .filter((b) => b.trim())
    .map((b) => {
      const one = b.trim()
      if (!one.includes('\n') && /^(chapter|part|prologue|epilogue)\b[\s\w.:—–-]{0,60}$/i.test(one)) return `<h2>${esc(one)}</h2>`
      if (/^(\*\s*){3}$|^[-—_]{3,}$/.test(one)) return '<hr>'
      return `<p>${b.split('\n').map(esc).join('<br>')}</p>`
    })
    .join('')
}

// ── cleaning ─────────────────────────────────────────────────────────────────

const KEEP = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'STRONG', 'EM', 'U', 'S', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'HR'])
const RENAME = { B: 'STRONG', I: 'EM', STRIKE: 'S', DEL: 'S', H4: 'H3', H5: 'H3', H6: 'H3' }
const DROP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'IMG'])

/** Keep only what the editor understands; unwrap everything else, attributes and all. */
function clean(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) {
        child.remove() // comments
        continue
      }
      if (child.nodeType !== 1) continue
      if (DROP.has(child.tagName)) {
        child.remove()
        continue
      }
      walk(child)
      let el = child
      const to = RENAME[el.tagName]
      if (to) {
        const n = doc.createElement(to)
        while (el.firstChild) n.appendChild(el.firstChild)
        el.replaceWith(n)
        el = n
      }
      if (!KEEP.has(el.tagName)) {
        // A block-level wrapper (div, section…) still separates paragraphs.
        const block = /^(DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|ASIDE|TABLE|TR|FIGURE|PRE)$/.test(el.tagName)
        if (block && el.textContent.trim() && !el.querySelector('p,h1,h2,h3,ul,ol,blockquote')) {
          const p = doc.createElement('p')
          while (el.firstChild) p.appendChild(el.firstChild)
          el.replaceWith(p)
        } else el.replaceWith(...el.childNodes)
        continue
      }
      for (const a of [...el.attributes]) el.removeAttribute(a.name)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML.replace(/<p>\s*<\/p>/g, '')
}

// ── splitting into chapters ──────────────────────────────────────────────────

/**
 * Split at the document's chapter headings: h1 if there are several of them,
 * otherwise h2 (and a lone h1 becomes the book's title). A document with no
 * headings is one chapter.
 */
function split(html, fallbackTitle) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const nodes = [...doc.body.childNodes]
  const count = (tag) => nodes.filter((n) => n.tagName === tag).length
  const level = count('H1') >= 2 ? 'H1' : count('H2') >= 1 ? 'H2' : null

  let bookTitle = ''
  if (level === 'H2' && count('H1') === 1) {
    const h1 = nodes.find((n) => n.tagName === 'H1')
    bookTitle = h1.textContent.trim()
    h1.remove()
  }

  const chapters = []
  let current = { title: '', parts: [] }
  const push = () => {
    const body = current.parts.join('').trim()
    if (current.title || htmlToText(body)) chapters.push({ title: current.title, body })
  }
  for (const n of [...doc.body.childNodes]) {
    if (level && n.tagName === level) {
      push()
      current = { title: n.textContent.trim().slice(0, 200), parts: [] }
    } else {
      current.parts.push(n.nodeType === 1 ? n.outerHTML : esc(n.textContent || ''))
    }
  }
  push()

  // One short line before the first chapter heading is the book's title, the
  // way a manuscript opens (Word's "Title" style often arrives as a plain line).
  if (level && !bookTitle && chapters.length > 1 && !chapters[0].title) {
    const lone = new DOMParser().parseFromString(`<body>${chapters[0].body}</body>`, 'text/html').body
    const text = lone.textContent.trim()
    if (lone.children.length === 1 && text && countWords(text) <= 12) {
      bookTitle = text
      chapters.shift()
    }
  }
  // Any other text before the first heading is a foreword, not a nameless chapter.
  if (chapters.length > 1 && !chapters[0].title) chapters[0].title = 'Opening'
  if (!chapters.length) chapters.push({ title: fallbackTitle, body: '' })
  return { title: bookTitle, chapters }
}

// ── the whole pipeline ───────────────────────────────────────────────────────

const baseName = (name) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()

/** HTML from anywhere (a file, a Notion page) → { title, chapters }, cleaned and split. */
export function htmlToChapters(html, fallbackTitle) {
  return split(clean(html), fallbackTitle)
}

/** Read a file into { title, chapters: [{ title, body }], words }. */
export async function parseDocument(file) {
  if (file.size > MAX_BYTES) throw new Error('That file is over 25 MB. Try splitting it into smaller documents.')
  const ext = (file.name.split('.').pop() || '').toLowerCase()
  let html
  if (ext === 'docx') html = await docxToHtml(file)
  else if (ext === 'md' || ext === 'markdown') html = await markdownToHtml(await file.text())
  else if (ext === 'txt' || ext === 'text') html = textToHtml(await file.text())
  else if (ext === 'html' || ext === 'htm') html = await file.text()
  else if (ext === 'doc') throw new Error('Old .doc files can’t be read. Open it in Word or Pages and save it as .docx first.')
  else if (ext === 'pdf') throw new Error('PDFs can’t be imported reliably. Save the document as .docx or .txt first.')
  else throw new Error(`“.${ext}” files can’t be imported. Use .docx, .md, .txt or .html.`)

  const { title, chapters } = split(clean(html), baseName(file.name))
  const words = chapters.reduce((n, c) => n + countWords(htmlToText(c.body)), 0)
  if (!words && chapters.every((c) => !c.title)) throw new Error('That document looks empty.')
  return { title: title || baseName(file.name), chapters, words }
}

/** A new book made from a document. Returns { work, chapters, words }. */
export async function importAsNewBook(file, onProgress = () => {}) {
  onProgress('Reading the document…')
  const parsed = await parseDocument(file)
  const work = await createWork({ title: parsed.title, blank: false })
  for (const [i, c] of parsed.chapters.entries()) {
    onProgress(`Adding chapter ${i + 1} of ${parsed.chapters.length}…`)
    await createPiece(work.id, { kind: 'chapter', position: i, title: c.title, body: c.body })
  }
  return { work, chapters: parsed.chapters.length, words: parsed.words }
}

/** Add a document's chapters to the end of an existing book. */
export async function importIntoBook(workId, afterPosition, file, onProgress = () => {}) {
  onProgress('Reading the document…')
  const parsed = await parseDocument(file)
  const created = []
  for (const [i, c] of parsed.chapters.entries()) {
    onProgress(`Adding chapter ${i + 1} of ${parsed.chapters.length}…`)
    created.push(
      await createPiece(workId, { kind: 'chapter', position: afterPosition + 1 + i, title: c.title, body: c.body }),
    )
  }
  return { pieces: created, chapters: created.length, words: parsed.words }
}

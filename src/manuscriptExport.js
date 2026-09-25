// ─────────────────────────────────────────────────────────────────────────────
//  Taking a book out of Petrichor: an EPUB for e-readers, a print-ready PDF
//  through the browser's own print dialog, and plain text / Markdown.
//
//  Chapters are stored as the editor's HTML. Parts open on a page of their
//  own, chapters start a new page, sections run on inside their chapter.
//  Spaces are kept exactly (white-space: pre-wrap), so indented verse survives.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip'
import { bookTitle, htmlToText, numberContents } from './library.js'

function save(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

function slug(s, max = 48) {
  return (
    String(s || 'book')
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max) || 'book'
  )
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const heading = (p) => {
  const t = p.title?.trim()
  if (p.kind === 'part') return { over: `Part ${p.number}`, title: t || '' }
  if (p.kind === 'chapter') return { over: `Chapter ${p.number}`, title: t || '' }
  return { over: '', title: t || '' }
}

/** The editor's HTML as well-formed XHTML, which EPUB insists on. */
function toXhtml(html) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html')
  const s = new XMLSerializer()
  return [...doc.body.firstChild.childNodes]
    .map((n) => s.serializeToString(n))
    .join('')
    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
}

const SHARED_CSS = `
  body { font-family: "Iowan Old Style", Palatino, Georgia, serif; line-height: 1.55; }
  .text { white-space: pre-wrap; }
  .text p { margin: 0 0 0.9em; }
  .text h2 { font-style: italic; font-weight: normal; font-size: 1.25em; margin: 1.4em 0 .5em; }
  .text h3 { font-size: .75em; letter-spacing: .14em; text-transform: uppercase; margin: 1.6em 0 .6em; }
  .text blockquote { margin: 1em 0; padding-left: 1em; border-left: 1px solid #999; font-style: italic; }
  .text hr { border: 0; text-align: center; margin: 1.6em 0; }
  .text hr::after { content: "*   *   *"; white-space: pre; }
  .title-page { text-align: center; padding-top: 30%; }
  .title-page h1 { font-size: 2.2em; font-weight: normal; font-style: italic; margin: 0; }
  .title-page .subtitle { font-style: italic; margin-top: .6em; }
  .title-page .author { margin-top: 3em; letter-spacing: .12em; text-transform: uppercase; font-size: .8em; }
  .dedication, .epigraph { text-align: center; font-style: italic; padding-top: 25%; white-space: pre-wrap; }
  .over { text-align: center; font-size: .72em; letter-spacing: .25em; text-transform: uppercase; margin: 0 0 .6em; }
  .chapter-title { text-align: center; font-weight: normal; font-style: italic; font-size: 1.6em; margin: 0 0 1.6em; }
  .part { text-align: center; padding-top: 35%; }
  .part .chapter-title { font-size: 2em; }
  .section-title { font-weight: normal; font-style: italic; font-size: 1.2em; margin: 2em 0 .8em; }
`

// ── plain text & markdown ────────────────────────────────────────────────────

/** The whole book as plain text or Markdown. */
export function bookText({ work, pieces }, format = 'txt') {
  const md = format === 'md'
  const out = [md ? `# ${bookTitle(work)}` : bookTitle(work).toUpperCase()]
  if (work.subtitle) out.push(md ? `*${work.subtitle}*` : work.subtitle)
  if (work.author) out.push(`by ${work.author}`)
  out.push('')
  if (work.dedication) out.push(md ? `*${work.dedication}*` : work.dedication, '')
  if (work.epigraph) out.push(md ? `> ${work.epigraph.replace(/\n/g, '\n> ')}` : work.epigraph, '')

  for (const p of numberContents(pieces)) {
    const h = heading(p)
    const line = [h.over, h.title].filter(Boolean).join(': ') || 'Untitled'
    if (md) out.push('', `${p.kind === 'section' ? '###' : '##'} ${line}`, '')
    else out.push('', p.kind === 'part' ? `\n${line.toUpperCase()}` : line, p.kind === 'section' ? '' : '—'.repeat(Math.min(line.length, 40)), '')
    const body = htmlToText(p.body)
    if (body) out.push(md ? body.replace(/\n(?!\n)/g, '  \n') : body)
  }
  return out.join('\n').replace(/\n{4,}/g, '\n\n\n') + '\n'
}

export function downloadText(data, format = 'txt') {
  const md = format === 'md'
  save(new Blob([bookText(data, format)], { type: md ? 'text/markdown' : 'text/plain' }), `${slug(bookTitle(data.work))}.${format}`)
}

// ── print / PDF ──────────────────────────────────────────────────────────────

export const TRIMS = {
  '5x8': { label: '5 × 8 in', size: '5in 8in' },
  '5.5x8.5': { label: '5.5 × 8.5 in', size: '5.5in 8.5in' },
  '6x9': { label: '6 × 9 in', size: '6in 9in' },
  a5: { label: 'A5', size: 'A5' },
  letter: { label: 'Letter', size: 'letter' },
}

function pieceHtml(p) {
  const h = heading(p)
  if (p.kind === 'part')
    return `<section class="part">${h.over ? `<div class="over">${esc(h.over)}</div>` : ''}<h1 class="chapter-title">${esc(h.title)}</h1><div class="text">${p.body || ''}</div></section>`
  if (p.kind === 'section')
    return `<section class="section">${h.title ? `<h3 class="section-title">${esc(h.title)}</h3>` : ''}<div class="text">${p.body || ''}</div></section>`
  return `<section class="chapter"><div class="over">${esc(h.over)}</div><h2 class="chapter-title">${esc(h.title)}</h2><div class="text">${p.body || ''}</div></section>`
}

/**
 * Lay the book out and hand it to the browser's print dialog, where
 * "Save as PDF" makes the file. A hidden frame, so no pop-up is blocked.
 */
export function printManuscript({ work, pieces }, trim = '6x9') {
  const body = numberContents(pieces).map(pieceHtml).join('\n')
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(bookTitle(work))}</title>
<style>
  @page { size: ${TRIMS[trim]?.size || TRIMS['6x9'].size}; margin: 0.8in 0.7in 0.9in; }
  ${SHARED_CSS}
  body { margin: 0; color: #111; font-size: 11pt; }
  .title-page, .dedication, .epigraph, .part { break-after: page; }
  .chapter, .part { break-before: page; }
  .chapter { padding-top: 1.1in; }
</style></head><body>
  <section class="title-page"><h1>${esc(bookTitle(work))}</h1>
    ${work.subtitle ? `<div class="subtitle">${esc(work.subtitle)}</div>` : ''}
    ${work.author ? `<div class="author">${esc(work.author)}</div>` : ''}</section>
  ${work.dedication ? `<section class="dedication">${esc(work.dedication)}</section>` : ''}
  ${work.epigraph ? `<section class="epigraph">${esc(work.epigraph)}</section>` : ''}
  ${body}
</body></html>`

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(frame)
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow.focus()
    frame.contentWindow.print()
    setTimeout(() => frame.remove(), 60000)
  }
}

// ── EPUB 3 ───────────────────────────────────────────────────────────────────

const xhtml = (title, inner) => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${inner}</body></html>`

/** The book as an EPUB file (a Blob). */
export async function epubBlob({ work, pieces }) {
  const title = bookTitle(work)
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')

  const zip = new JSZip()
  // The mimetype must come first and stay uncompressed, or readers refuse the file.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  )

  const docs = [] // { id, file, label, depth, inToc }
  const add = (id, label, inner, { inToc = true, depth = 0 } = {}) => {
    const file = `${id}.xhtml`
    zip.file(`OEBPS/${file}`, xhtml(label, inner))
    docs.push({ id, file, label, depth, inToc })
  }

  add(
    'title',
    title,
    `<section class="title-page"><h1>${esc(title)}</h1>${work.subtitle ? `<div class="subtitle">${esc(work.subtitle)}</div>` : ''}${
      work.author ? `<div class="author">${esc(work.author)}</div>` : ''
    }</section>`,
    { inToc: false },
  )
  if (work.dedication) add('dedication', 'Dedication', `<div class="dedication">${esc(work.dedication)}</div>`, { inToc: false })
  if (work.epigraph) add('epigraph', 'Epigraph', `<div class="epigraph">${esc(work.epigraph)}</div>`, { inToc: false })

  // Sections run on inside their chapter's file; parts and chapters get their own.
  let current = null
  const flush = () => {
    if (current) add(current.id, current.label, current.html.join(''), { depth: current.depth })
    current = null
  }
  numberContents(pieces).forEach((p, i) => {
    const h = heading(p)
    const label = [h.over, h.title].filter(Boolean).join(': ') || 'Untitled'
    const text = `<div class="text">${toXhtml(p.body)}</div>`
    if (p.kind === 'section' && current) {
      current.html.push(`<section>${h.title ? `<h3 class="section-title">${esc(h.title)}</h3>` : ''}${text}</section>`)
      return
    }
    flush()
    const id = `c${String(i + 1).padStart(3, '0')}`
    if (p.kind === 'part') {
      add(id, label, `<section class="part"><div class="over">${esc(h.over)}</div><h1 class="chapter-title">${esc(h.title)}</h1>${text}</section>`)
      return
    }
    current = {
      id,
      label,
      depth: p.depth ? 1 : 0,
      html: [
        p.kind === 'chapter'
          ? `<section><div class="over">${esc(h.over)}</div><h2 class="chapter-title">${esc(h.title)}</h2>${text}</section>`
          : `<section>${h.title ? `<h3 class="section-title">${esc(h.title)}</h3>` : ''}${text}</section>`,
      ],
    }
  })
  flush()

  zip.file('OEBPS/style.css', SHARED_CSS + '\n.title-page { padding-top: 20%; }\n.part { padding-top: 25%; }\n')
  zip.file(
    'OEBPS/nav.xhtml',
    xhtml(
      'Contents',
      `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${docs
        .filter((d) => d.inToc)
        .map((d) => `<li><a href="${d.file}">${esc(d.label)}</a></li>`)
        .join('')}</ol></nav>`,
    ),
  )
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${work.id}</dc:identifier>
    <dc:title>${esc(title)}</dc:title>
    <dc:creator>${esc(work.author || 'Unknown')}</dc:creator>
    <dc:language>en</dc:language>
    ${work.description ? `<dc:description>${esc(work.description)}</dc:description>` : ''}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${docs.map((d) => `<item id="${d.id}" href="${d.file}" media-type="application/xhtml+xml"/>`).join('\n    ')}
  </manifest>
  <spine>
    ${docs.map((d) => `<itemref idref="${d.id}"/>`).join('\n    ')}
  </spine>
</package>`,
  )

  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
}

export async function downloadEpub(data) {
  save(await epubBlob(data), `${slug(bookTitle(data.work))}.epub`)
}

export { save as saveFile, slug }

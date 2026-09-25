// ─────────────────────────────────────────────────────────────────────────────
//  Backups: every book, out of the database and onto her own disk.
//
//  One .zip holds, for each book, a readable copy (Markdown and EPUB) and its
//  cover, plus backup.json: every book, every chapter with its full text, and
//  every kept version — enough to put it all back with restoreBackup().
//
//  Restoring only ever ADDS: each book comes back as a new copy, so a restore
//  can never overwrite or delete anything that's already in the account.
// ─────────────────────────────────────────────────────────────────────────────

import JSZip from 'jszip'
import { supabase, BUCKET } from './lib/supabase.js'
import { bookTitle } from './library.js'
import { bookText, epubBlob, saveFile, slug } from './manuscriptExport.js'

const FORMAT = 'petrichor-books-backup'
const FORMAT_VERSION = 1
export const BACKUP_EVERY_DAYS = 7

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

async function currentUser() {
  const { data } = await supabase.auth.getUser()
  if (!data?.user) throw new Error('Sign in to back up your books.')
  return data.user
}

const stamp = (d = new Date()) => {
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16).replace('T', '-').replace(':', '')
}

// Versions can run to thousands of rows; page through them.
async function allRows(query, size = 1000) {
  const out = []
  for (let from = 0; ; from += size) {
    const rows = check(await query().range(from, from + size - 1))
    out.push(...rows)
    if (rows.length < size) return out
  }
}

// ── when she last backed up (on her account, so every browser knows) ────────

export async function lastBackupAt() {
  const user = await currentUser()
  return user.user_metadata?.last_backup_at || null
}

async function markBackedUp() {
  await supabase.auth.updateUser({ data: { last_backup_at: new Date().toISOString() } })
}

/** Days since the last backup, or null if there has never been one. */
export function daysSince(iso) {
  if (!iso) return null
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

// ── backing up ───────────────────────────────────────────────────────────────

/**
 * Build and download the backup. `onProgress(text)` narrates the slow parts.
 * Returns what went in: { books, chapters, versions }.
 */
export async function downloadBackup(onProgress = () => {}) {
  const user = await currentUser()
  onProgress('Gathering your books…')

  const works = check(await supabase.from('works').select('*').eq('user_id', user.id).order('created_at'))
  const pieces = await allRows(() =>
    supabase.from('pieces').select('*').eq('user_id', user.id).order('work_id').order('position'),
  )
  onProgress('Gathering every saved version…')
  const versions = await allRows(() =>
    supabase.from('piece_versions').select('*').eq('user_id', user.id).order('created_at'),
  )
  const writingDays = check(await supabase.from('writing_days').select('day, words').eq('user_id', user.id))

  const zip = new JSZip()
  const root = zip.folder(`petrichor-backup-${stamp()}`)
  const used = new Set()

  const books = []
  for (const [i, work] of works.entries()) {
    onProgress(`Packing “${bookTitle(work)}” (${i + 1} of ${works.length})…`)
    const mine = pieces.filter((p) => p.work_id === work.id)

    // A readable copy of each book, in a folder of its own.
    let name = slug(bookTitle(work))
    while (used.has(name)) name += '-' + work.id.slice(0, 4)
    used.add(name)
    const folder = root.folder(`books/${name}`)
    folder.file(`${name}.md`, bookText({ work, pieces: mine }, 'md'))
    try {
      folder.file(`${name}.epub`, await epubBlob({ work, pieces: mine }))
    } catch {
      /* a book that won't bind still has its Markdown and its data */
    }

    let coverFile = null
    if (work.cover_path) {
      try {
        const { data } = await supabase.storage.from(BUCKET).download(work.cover_path)
        if (data) {
          const ext = work.cover_path.split('.').pop() || 'jpg'
          coverFile = `books/${name}/cover.${ext}`
          root.file(coverFile, data)
        }
      } catch {
        /* the cover is the one thing that can be remade; don't fail the backup for it */
      }
    }

    books.push({
      ...work,
      cover_file: coverFile,
      pieces: mine.map((p) => ({ ...p, versions: versions.filter((v) => v.piece_id === p.id) })),
    })
  }

  const data = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    account: user.email,
    counts: { books: books.length, chapters: pieces.length, versions: versions.length },
    books,
    writingDays,
  }
  root.file('backup.json', JSON.stringify(data, null, 2))
  root.file(
    'README.txt',
    [
      'Petrichor backup',
      `Made ${new Date().toLocaleString()} for ${user.email}.`,
      '',
      `${books.length} book(s), ${pieces.length} part(s)/chapter(s)/section(s), ${versions.length} saved version(s).`,
      '',
      'books/   a readable copy of each book (.md opens anywhere; .epub opens in Apple Books)',
      'backup.json   everything, for restoring into Petrichor: Books → Restore from backup',
      '',
      'Keep this file somewhere that is not this computer: iCloud Drive, Google Drive, a USB stick.',
    ].join('\n'),
  )

  onProgress('Zipping…')
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  saveFile(blob, `petrichor-backup-${stamp()}.zip`)
  await markBackedUp()
  return data.counts
}

// ── restoring ────────────────────────────────────────────────────────────────

/** Read a backup .zip (or its backup.json) into { data, zip }. */
async function readBackup(file) {
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    return { data: JSON.parse(await file.text()), zip: null, prefix: '' }
  }
  const zip = await JSZip.loadAsync(file)
  const entry = Object.keys(zip.files).find((n) => n.endsWith('backup.json'))
  if (!entry) throw new Error('That zip has no backup.json in it. Is it a Petrichor backup?')
  const prefix = entry.slice(0, -'backup.json'.length)
  return { data: JSON.parse(await zip.file(entry).async('string')), zip, prefix }
}

/**
 * Put the books in a backup back into her account, as new copies. Nothing
 * already there is touched. Returns { books, chapters, versions }.
 */
export async function restoreBackup(file, onProgress = () => {}) {
  const user = await currentUser()
  onProgress('Reading the backup…')
  const { data, zip, prefix } = await readBackup(file)
  if (data?.format !== FORMAT) throw new Error('That file is not a Petrichor books backup.')

  const counts = { books: 0, chapters: 0, versions: 0 }
  for (const [i, book] of (data.books || []).entries()) {
    onProgress(`Restoring “${bookTitle(book)}” (${i + 1} of ${data.books.length})…`)
    const work = check(
      await supabase
        .from('works')
        .insert({
          user_id: user.id,
          title: book.title || '',
          subtitle: book.subtitle || '',
          author: book.author || '',
          description: book.description || '',
          dedication: book.dedication || '',
          epigraph: book.epigraph || '',
          cover_color: book.cover_color || '#2a1f2d',
          goal_words: book.goal_words || 0,
        })
        .select()
        .single(),
    )
    counts.books++

    if (zip && book.cover_file) {
      const f = zip.file(prefix + book.cover_file)
      if (f) {
        const blob = await f.async('blob')
        const ext = book.cover_file.split('.').pop() || 'jpg'
        const path = `${user.id}/books/${work.id}/cover-${Date.now()}.${ext}`
        const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}` })
        if (!error) await supabase.from('works').update({ cover_path: path }).eq('id', work.id)
      }
    }

    // One at a time, in reading order, so each chapter's history follows it.
    for (const p of [...(book.pieces || [])].sort((a, b) => a.position - b.position)) {
      const piece = check(
        await supabase
          .from('pieces')
          .insert({
            work_id: work.id,
            user_id: user.id,
            kind: p.kind || 'chapter',
            title: p.title || '',
            body: p.body || '',
            words: p.words || 0,
            status: p.status || 'draft',
            position: p.position || 0,
          })
          .select('id')
          .single(),
      )
      counts.chapters++
      const vs = (p.versions || []).map((v) => ({
        piece_id: piece.id,
        user_id: user.id,
        title: v.title || '',
        body: v.body || '',
        word_count: v.word_count || 0,
        reason: v.reason || 'auto',
        created_at: v.created_at,
      }))
      for (let k = 0; k < vs.length; k += 200) {
        check(await supabase.from('piece_versions').insert(vs.slice(k, k + 200)))
        counts.versions += vs.slice(k, k + 200).length
      }
    }
  }

  // Past writing days fill in only where today's account has no record.
  if (data.writingDays?.length) {
    await supabase
      .from('writing_days')
      .upsert(
        data.writingDays.map((d) => ({ user_id: user.id, day: d.day, words: d.words })),
        { onConflict: 'user_id,day', ignoreDuplicates: true },
      )
  }
  return counts
}

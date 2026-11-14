// ─────────────────────────────────────────────────────────────────────────────
//  The Android app (Capacitor). The same React app runs inside a native shell,
//  served from https://localhost on the phone. Most of it doesn't notice; the
//  few places that do (calling the server, sign-in links, saving and printing
//  files) ask this module. On the website every export here is a no-op or
//  hands back what it was given, and the plugins are never loaded.
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor, registerPlugin } from '@capacitor/core'

export const isNative = Capacitor.isNativePlatform()

// The live site. On the phone there's no server next to the page, so /api calls
// go here. VITE_API_BASE points a dev build somewhere else.
const API_BASE = (import.meta.env.VITE_API_BASE || 'https://petrichor-ebon.vercel.app').replace(/\/+$/, '')

/** '/api/words' on the website; the live site's /api/words in the app. */
export const apiUrl = (path) => (isNative && typeof path === 'string' && path.startsWith('/') ? API_BASE + path : path)

// Sign-in links (Google, confirm-your-email, reset-your-password) come back to
// this address, which Android hands to the app (see AndroidManifest.xml). It
// must also be listed under Supabase → Authentication → URL Configuration →
// Redirect URLs, or Supabase sends people to the website instead.
const AUTH_CALLBACK = 'com.mahabaig.petrichor://auth-callback'

/** Where Supabase should send someone after a sign-in link. */
export const authRedirect = () => (isNative ? AUTH_CALLBACK : window.location.origin)

/** Open a page in the phone's browser (a Custom Tab over the app). */
export async function openInBrowser(url) {
  const { Browser } = await import('@capacitor/browser')
  await Browser.open({ url })
}

/**
 * When a sign-in link opens the app, put what it carries (tokens, or an error)
 * in the address and reload, exactly as the website receives it. Supabase reads
 * the session from there, and auth.jsx shows the reset form or the link error,
 * so none of that needs a second path for the phone.
 */
export async function listenForSignInLinks() {
  if (!isNative) return
  const { App } = await import('@capacitor/app')

  const take = (url) => {
    if (!url || !url.startsWith(AUTH_CALLBACK)) return
    // The launch URL is still there after the reload; don't loop on it.
    try {
      if (sessionStorage.getItem('petrichor-link') === url) return
      sessionStorage.setItem('petrichor-link', url)
    } catch {
      /* no storage: worst case the link is read twice */
    }
    import('@capacitor/browser').then(({ Browser }) => Browser.close().catch(() => {}))
    const hash = url.indexOf('#')
    const query = url.indexOf('?')
    const carried = hash >= 0 ? url.slice(hash + 1) : query >= 0 ? url.slice(query + 1) : ''
    if (!carried) return
    window.history.replaceState(null, '', `${window.location.pathname}#${carried}`)
    window.location.reload()
  }

  App.addListener('appUrlOpen', ({ url }) => take(url)) // app already open (Google)
  App.getLaunchUrl().then((r) => take(r?.url)).catch(() => {}) // app opened by an email link
}

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })

/**
 * The phone's version of a download: write the file to the app's cache and
 * open the share sheet, where she can save it to Files or Drive, or send it.
 * Resolves false if she backs out of the sheet.
 */
export async function shareFile(blob, filename) {
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ])
  const { uri } = await Filesystem.writeFile({
    path: filename,
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  })
  try {
    await Share.share({ title: filename, files: [uri] })
    return true
  } catch (e) {
    if (/cancel/i.test(e?.message || '')) return false
    throw e
  }
}

// Android's WebView ignores window.print(), so the app carries a small plugin
// (android/…/PrintPlugin.java) that lays the page out in a WebView of its own
// and opens the system print dialog, which has "Save as PDF".
const Print = registerPlugin('Print')

/** Open the system print dialog on a whole HTML document. */
export const printHtml = (html, name) => Print.print({ html, name })

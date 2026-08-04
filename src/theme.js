// Which way the light is going.
//
// The toggle writes `data-theme` straight onto <html> — no React state — so
// anything that *paints* rather than styles (the canvas cards, the WebGL
// labels, the tab melt) has to come and ask, and be told when it changes.

import { useEffect, useState } from 'react'

export function currentTheme() {
  if (typeof document === 'undefined') return 'dark'
  const set = document.documentElement.getAttribute('data-theme')
  if (set === 'light' || set === 'dark') return set
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark'
}

export const isLight = () => currentTheme() === 'light'

/** The current theme, and a re-render whenever it turns over. */
export function useTheme() {
  const [theme, setTheme] = useState(currentTheme)
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setTheme(currentTheme()))
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] })
    // The system can change its mind too, when nothing has been chosen here.
    const media = matchMedia('(prefers-color-scheme: light)')
    const onMedia = () => setTheme(currentTheme())
    media.addEventListener?.('change', onMedia)
    setTheme(currentTheme())
    return () => {
      observer.disconnect()
      media.removeEventListener?.('change', onMedia)
    }
  }, [])
  return theme
}

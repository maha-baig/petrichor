import { useEffect, useState } from 'react'

// What can this environment actually do? The mood board's vision reading and
// image generation need Ollama and ComfyUI running on the machine, so they
// exist locally but not on the deployed site. Asking the server rather than
// guessing keeps the UI honest in both places.
//
// Fetched once and shared, so every caller gets the same answer.
let cache = null
let inflight = null

function load() {
  if (cache) return Promise.resolve(cache)
  if (!inflight) {
    inflight = fetch('/api/health')
      .then((r) => r.json())
      .then((d) => {
        cache = d.capabilities || { text: true, moodboardVision: true, imageGeneration: true }
        return cache
      })
      .catch(() => {
        // If health is unreachable we're almost certainly local with the
        // server down — assume the full feature set and let the real call
        // report the real problem.
        cache = { text: true, moodboardVision: true, imageGeneration: true }
        return cache
      })
  }
  return inflight
}

export function useCapabilities() {
  const [caps, setCaps] = useState(cache)
  useEffect(() => {
    let alive = true
    load().then((c) => alive && setCaps(c))
    return () => {
      alive = false
    }
  }, [])
  return caps
}

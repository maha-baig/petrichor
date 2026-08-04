async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Something went quiet. Try again.')
  return data
}

export const getPrompts = ({ mood, echoes, count }) =>
  post('/api/prompts', { mood, echoes, count })

export const getWords = ({ prompt, mood }) => post('/api/words', { prompt, mood })

// A second helping of one currency. want: 'searchTerms' | 'evocative'
export const getMoreWords = ({ prompt, mood, want, count, exclude }) =>
  post('/api/words/more', { prompt, mood, want, count, exclude })

export const getWordMap = ({ feeling, mood, count, exclude }) =>
  post('/api/wordmap', { feeling, mood, count, exclude })

export const getReview = ({ poem }) => post('/api/review', { poem })

export const readMoodboard = ({ images, feeling, colors }) =>
  post('/api/moodboard', { images, feeling, colors })

export const illustrate = ({ prompt, negative }) => post('/api/illustrate', { prompt, negative })

// Candidates for the mood board, from one of the search terms. source:
// 'openverse' | 'pexels' | 'unsplash' — omit for the server's default.
export const searchImages = ({ term, source, count }) =>
  post('/api/images', { term, source, count })

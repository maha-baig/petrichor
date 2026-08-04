// Local dev entry point. The app itself lives in app.js so the same routes
// can be served by Express here and by a serverless function in api/.
import 'dotenv/config'
import app from './app.js'

const PORT = process.env.PORT || 8787

app.listen(PORT, () => {
  console.log(`\u25D7 Petrichor engines listening on http://localhost:${PORT}`)
  console.log(`  provider: ${process.env.MUSE_PROVIDER || 'groq'}`)
})

// Vercel serverless entry point — serves every /api/* route from the same
// Express app used locally, so there is one implementation to maintain.
import app from '../app.js'

export default app

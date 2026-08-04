import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Frontend dev server proxies /api calls to the small Express server (server.js)
// so the Anthropic API key never touches the browser.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // ensure a single React instance (framer-motion otherwise pulls a duplicate)
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Default to dark; honour a saved choice if one exists.
document.documentElement.setAttribute(
  'data-theme',
  localStorage.getItem('petrichor-theme') || 'dark',
)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Prism Feedback: pin comments to any element (or draw over the page), then
// "Copy for Claude" to paste them back as UI fixes. Dev only: the dynamic
// import is dropped from production builds. Add ?feedback=off to hide it.
if (import.meta.env.DEV) {
  import('./dev/prism-feedback.js?raw').then(({ default: source }) => {
    // Start the dock bottom-left: bottom-right is the theme toggle's corner.
    try {
      if (!localStorage.getItem('prism-feedback:prefs'))
        localStorage.setItem('prism-feedback:prefs', JSON.stringify({ corner: 'left' }))
    } catch {
      /* storage blocked: the dock just starts on the right */
    }
    const script = document.createElement('script')
    Object.assign(script.dataset, {
      prismFeedback: '1.1.0',
      feature: 'petrichor',
      page: 'index.html',
      source: 'petrichor/src (React app: find the component from the selector and "Where")',
    })
    script.textContent = source
    document.body.appendChild(script)
  })
}

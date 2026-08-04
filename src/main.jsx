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

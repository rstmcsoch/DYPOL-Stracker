import React from 'react'
import ReactDOM from 'react-dom/client'
// Identity and selectable Reading families are self-hosted as subset WOFF2 files under
// /assets/fonts/ and declared in styles/fonts.css with unicode-range + font-display:
// swap. The boot script in index.html preloads the active family's regular face.
import './styles/fonts.css'
import App from './App'
import './styles.css'
import { registerOfflineApplicationShell } from './lib/offline-shell'

registerOfflineApplicationShell()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)

// Enable entrance animations only after the first paint, so nothing animates on page load.
window.setTimeout(() => window.requestAnimationFrame(() => document.documentElement.classList.add('motion-ready')), 400)

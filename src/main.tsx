import React from 'react'
import ReactDOM from 'react-dom/client'
// All selectable interface families are bundled locally; CSS font-display: swap and
// the global system fallback keep every region on the same family while a face loads.
import '@fontsource/poppins/latin-400.css'
import '@fontsource/poppins/latin-500.css'
import '@fontsource/poppins/latin-600.css'
import '@fontsource/poppins/latin-700.css'
import '@fontsource/sora/latin-400.css'
import '@fontsource/sora/latin-500.css'
import '@fontsource/sora/latin-600.css'
import '@fontsource/sora/latin-700.css'
import '@fontsource/open-sans/latin-400.css'
import '@fontsource/open-sans/latin-500.css'
import '@fontsource/open-sans/latin-600.css'
import '@fontsource/open-sans/latin-700.css'
import App from './App'
import './styles.css'
import { registerOfflineApplicationShell } from './lib/offline-shell'

registerOfflineApplicationShell()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)

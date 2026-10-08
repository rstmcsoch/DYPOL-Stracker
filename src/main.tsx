import React from 'react'
import ReactDOM from 'react-dom/client'
// Interface typography. The Stracker default ships locally and never depends on a
// remote font service. Poppins, Sora, and Open Sans are bundled as single default cuts
// (regular/medium/semibold/bold, latin subset) so a browser only fetches the faces the
// selected interface font actually uses.
import '@fontsource/caveat/latin-500.css'
import '@fontsource/caveat/latin-600.css'
import '@fontsource/kalam/latin-400.css'
import '@fontsource/kalam/latin-700.css'
import '@fontsource/gaegu/latin-700.css'
import '@fontsource/patrick-hand/latin-400.css'
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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)

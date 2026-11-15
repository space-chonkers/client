import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Bundled so the UI renders with the same rounded face on every OS
import '@fontsource/nunito/700.css'
import '@fontsource/nunito/800.css'
import '@fontsource/nunito/900.css'
// Display faces for the sticker-collage "JAM" logo
import '@fontsource/archivo-black/400.css'
import '@fontsource/fredoka/700.css'
import './style.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

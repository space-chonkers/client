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

/** Development-only query value that opens the Layer −1 terrain showcase instead of the game. */
const TERRAIN_SHOWCASE_VIEW = 'terrain-showcase'

const root = ReactDOM.createRoot(document.getElementById('root')!)

const render = (content: React.ReactNode) =>
  root.render(<React.StrictMode>{content}</React.StrictMode>)

// `import.meta.env.DEV` is statically false in production builds, so this
// branch and the showcase chunk it imports are left out of the bundle.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('view') === TERRAIN_SHOWCASE_VIEW) {
  import('./showcase/TerrainShowcase')
    .then(({ default: TerrainShowcase }) =>
      render(
        <main className="game-client">
          <TerrainShowcase />
        </main>,
      ),
    )
    .catch((error: unknown) => {
      console.error('Failed to load the terrain showcase', error)
      render(<App />)
    })
} else {
  render(<App />)
}

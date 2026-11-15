import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
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

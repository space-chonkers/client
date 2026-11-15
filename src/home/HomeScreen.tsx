import type { BackgroundMusicControls } from '../audio/useBackgroundMusic'
import MarsHomeScene from './MarsHomeScene'
import MusicVolumeControl from './MusicVolumeControl'
import { GAME_MODE_OPTIONS, type GameMode } from './gameMode'

/** Referenced by `.home-title__logo` in style.css as url(#jam-logo-sticker-outline). */
const STICKER_OUTLINE_FILTER_ID = 'jam-logo-sticker-outline'

/**
 * Grows the logo's silhouette into a cream border, like a die-cut sticker.
 * The radius is relative to the logo's bounding box so the border scales with it.
 */
function StickerOutlineFilter() {
  return (
    <svg className="home-title__filter" width="0" height="0" aria-hidden="true" focusable="false">
      <filter
        id={STICKER_OUTLINE_FILTER_ID}
        primitiveUnits="objectBoundingBox"
        x="-0.1"
        y="-0.15"
        width="1.2"
        height="1.3"
      >
        <feMorphology in="SourceAlpha" operator="dilate" radius="0.019 0.04" result="grown" />
        <feFlood floodColor="#fff6ef" />
        <feComposite in2="grown" operator="in" result="outline" />
        <feMerge>
          <feMergeNode in="outline" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </svg>
  )
}

interface HomeScreenProps {
  /** App-wide music controls; owned by `App` so playback survives screen changes. */
  music: BackgroundMusicControls
  /** Called with the game mode the player picked. */
  onStartMission: (mode: GameMode) => void
}

/**
 * Homepage: the Mars scene in the background with the logo, the game mode
 * menu and the music control laid over it.
 */
export default function HomeScreen({ music, onStartMission }: HomeScreenProps) {
  return (
    <div className="home-screen">
      <MarsHomeScene />

      <div className="home-overlay">
        <header className="home-title">
          <StickerOutlineFilter />
          <h1 className="home-title__logo" aria-label="JAM">
            <span className="home-title__letter home-title__letter--j" aria-hidden="true">J</span>
            <span className="home-title__letter home-title__letter--a" aria-hidden="true">A</span>
            <span className="home-title__letter home-title__letter--m" aria-hidden="true">M</span>
          </h1>
          <p className="home-title__subtitle">Junior Astronaut Mission</p>
        </header>

        <nav className="mode-menu" aria-label="Game mode">
          <div className="mode-menu__buttons">
            {GAME_MODE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={`chunky-button mode-button mode-button--${option.mode}`}
                onClick={() => onStartMission(option.mode)}
                aria-label={`${option.label}, up to ${option.maxPlayers} ${option.maxPlayers === 1 ? 'player' : 'players'}`}
              >
                <span className="mode-button__label">{option.label}</span>
              </button>
            ))}
          </div>
        </nav>

        <MusicVolumeControl {...music} />
      </div>
    </div>
  )
}

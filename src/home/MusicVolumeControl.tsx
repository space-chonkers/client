import { useState, type KeyboardEvent } from 'react'
import { MUSIC_VOLUME_STEP, type BackgroundMusicControls } from '../audio/useBackgroundMusic'

const VOLUME_LEVEL_COUNT = 10
const MUSIC_PANEL_ID = 'music-control-panel'

function MusicNoteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M9 17V5l11-2v12" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinejoin="round" />
      <circle cx="6.5" cy="17.5" r="3" fill="currentColor" />
      <circle cx="17.5" cy="15.5" r="3" fill="currentColor" />
    </svg>
  )
}

function SpeakerIcon({ isMuted }: { isMuted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {isMuted ? (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      ) : (
        <path
          d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  )
}

/** Music button that expands into a panel to raise, lower or mute the volume. */
export default function MusicVolumeControl({ volume, isMuted, setVolume, toggleMute }: BackgroundMusicControls) {
  const [isExpanded, setIsExpanded] = useState(false)
  const effectiveVolume = isMuted ? 0 : volume
  const activeLevels = Math.round(effectiveVolume * VOLUME_LEVEL_COUNT)
  const volumePercent = Math.round(effectiveVolume * 100)

  const collapseOnEscape = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') setIsExpanded(false)
  }

  return (
    <section className="music-control" aria-label="Music" onKeyDown={collapseOnEscape}>
      <button
        type="button"
        className={`chunky-button chunky-button--icon music-control__toggle${isMuted ? ' is-muted' : ''}`}
        onClick={() => setIsExpanded((expanded) => !expanded)}
        aria-expanded={isExpanded}
        aria-controls={MUSIC_PANEL_ID}
        aria-label={isExpanded ? 'Close music controls' : 'Open music controls'}
      >
        <MusicNoteIcon />
      </button>

      {isExpanded && (
        <div id={MUSIC_PANEL_ID} className="music-control__panel">
          <button
            type="button"
            className="chunky-button chunky-button--icon"
            onClick={toggleMute}
            aria-pressed={isMuted}
            aria-label={isMuted ? 'Unmute music' : 'Mute music'}
          >
            <SpeakerIcon isMuted={isMuted} />
          </button>

          <button
            type="button"
            className="chunky-button chunky-button--icon"
            onClick={() => setVolume(effectiveVolume - MUSIC_VOLUME_STEP)}
            disabled={effectiveVolume <= 0}
            aria-label="Volume down"
          >
            −
          </button>

          <div className="music-control__meter" role="group" aria-label="Volume level">
            {Array.from({ length: VOLUME_LEVEL_COUNT }, (_, index) => {
              const level = index + 1
              return (
                <button
                  key={level}
                  type="button"
                  className={`music-control__bar${level <= activeLevels ? ' is-active' : ''}`}
                  style={{ height: `${30 + level * 7}%` }}
                  onClick={() => setVolume(level / VOLUME_LEVEL_COUNT)}
                  aria-label={`Volume ${level * 10}%`}
                />
              )
            })}
          </div>

          <button
            type="button"
            className="chunky-button chunky-button--icon"
            onClick={() => setVolume(effectiveVolume + MUSIC_VOLUME_STEP)}
            disabled={effectiveVolume >= 1}
            aria-label="Volume up"
          >
            +
          </button>

          <output className="music-control__value" aria-live="polite">
            {isMuted ? 'Muted' : `${volumePercent}%`}
          </output>
        </div>
      )}
    </section>
  )
}

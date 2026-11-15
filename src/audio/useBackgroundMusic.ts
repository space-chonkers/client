import { useCallback, useEffect, useRef, useState } from 'react'
import { BackgroundMusic } from './BackgroundMusic'

export const DEFAULT_MUSIC_VOLUME = 0.5
export const MUSIC_VOLUME_STEP = 0.1

const UNLOCK_EVENTS = ['pointerdown', 'keydown'] as const

function clampVolume(volume: number): number {
  // Round to one decimal to avoid floating-point drift when adding 0.1 steps
  return Math.round(Math.max(0, Math.min(1, volume)) * 10) / 10
}

export interface BackgroundMusicControls {
  /** Normalized volume (0–1) in steps of `MUSIC_VOLUME_STEP`; kept while muted. */
  volume: number
  isMuted: boolean
  /** Clamps and rounds the value; setting 0 also mutes. */
  setVolume: (volume: number) => void
  /** Unmuting at volume 0 restores `DEFAULT_MUSIC_VOLUME`. */
  toggleMute: () => void
}

/**
 * Manages the app-wide background music. Playback starts on the first user
 * gesture (browser autoplay requirement).
 */
export function useBackgroundMusic(): BackgroundMusicControls {
  const musicRef = useRef<BackgroundMusic | null>(null)
  const [volume, setVolumeState] = useState(DEFAULT_MUSIC_VOLUME)
  const [isMuted, setIsMuted] = useState(false)

  useEffect(() => {
    const music = new BackgroundMusic()
    musicRef.current = music

    const unlockAudio = () => {
      music.start()
      UNLOCK_EVENTS.forEach((eventName) => window.removeEventListener(eventName, unlockAudio))
    }
    UNLOCK_EVENTS.forEach((eventName) => window.addEventListener(eventName, unlockAudio))

    return () => {
      UNLOCK_EVENTS.forEach((eventName) => window.removeEventListener(eventName, unlockAudio))
      music.dispose()
      musicRef.current = null
    }
  }, [])

  useEffect(() => {
    musicRef.current?.setVolume(isMuted ? 0 : volume)
  }, [volume, isMuted])

  const setVolume = useCallback((nextVolume: number) => {
    const clampedVolume = clampVolume(nextVolume)
    setVolumeState(clampedVolume)
    setIsMuted(clampedVolume === 0)
  }, [])

  const toggleMute = useCallback(() => {
    // Unmuting at volume 0 restores the default volume so something is audible
    if (isMuted && volume === 0) {
      setVolumeState(DEFAULT_MUSIC_VOLUME)
    }
    setIsMuted(!isMuted)
  }, [isMuted, volume])

  return { volume, isMuted, setVolume, toggleMute }
}

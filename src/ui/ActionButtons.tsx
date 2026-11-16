import React, { useEffect } from 'react'
import { GameIcon, ICON_COLORS, type ConstructionEventIconType } from './icons/GameIcons'
import './actionButtons.css'

/** Matches the default icon size of the ResourceBar HUD panel. */
const ACTION_ICON_SIZE = 28

import './chunkyButton.css'

export interface ActionButtonsProps {
  /** Called when the player builds (Build button, `E` or `Space`). */
  onBuild?: () => void
  /** Called when the player collects from the Stash into the SharedPool (Collect button or `C`). */
  onCollect?: () => void
  /** Whether Build can be used. Unavailable buttons are dimmed, never hidden. */
  buildEnabled?: boolean
  /** Whether Collect can be used. Unavailable buttons are dimmed, never hidden. */
  collectEnabled?: boolean
}

type ActionType = Extract<ConstructionEventIconType, 'build' | 'collect'>

interface ActionButtonConfig {
  type: ActionType
  label: string
  keyHints: readonly string[]
}

const ACTION_BUTTONS: readonly ActionButtonConfig[] = [
  { type: 'build', label: 'Build', keyHints: ['E', 'Space'] },
  { type: 'collect', label: 'Collect', keyHints: ['Q', 'C'] },
]

const BUILD_KEY_CODES: readonly string[] = ['KeyE', 'Space']
const COLLECT_KEY_CODES: readonly string[] = ['KeyQ', 'KeyC']

/** Text inputs must keep their keystrokes; focused buttons already handle `Space` as a click. */
function shouldIgnoreKeyEvent(event: KeyboardEvent): boolean {
  const target = event.target
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return true
  return event.code === 'Space' && target.tagName === 'BUTTON'
}

/**
 * Bottom-left HUD with the in-game `Build` and `Collect` actions, stacked vertically.
 * Both can be triggered by clicking or with a keyboard shortcut; movement keys
 * (WASD / arrows) are never handled here. Purely presentational: it holds no
 * resource logic and only reports intents through `onBuild` / `onCollect`.
 */
export const ActionButtons: React.FC<ActionButtonsProps> = ({
  onBuild,
  onCollect,
  buildEnabled = true,
  collectEnabled = true,
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Synthetic events come from the Build button, which already ran onBuild.
      if (!event.isTrusted || event.repeat || shouldIgnoreKeyEvent(event)) return

      if (buildEnabled && BUILD_KEY_CODES.includes(event.code)) onBuild?.()
      else if (collectEnabled && COLLECT_KEY_CODES.includes(event.code)) onCollect?.()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBuild, onCollect, buildEnabled, collectEnabled])

  const handleBuildClick = () => {
    onBuild?.()
    // Lets the scene place a corridor when it listens for the build key.
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }))
  }

  const handlers: Record<ActionType, () => void> = {
    build: handleBuildClick,
    collect: () => onCollect?.(),
  }
  const enabledByType: Record<ActionType, boolean> = {
    build: buildEnabled,
    collect: collectEnabled,
  }

  return (
    <div className="action-buttons-overlay">
      <nav className="action-buttons" aria-label="Game actions">
        {ACTION_BUTTONS.map(({ type, label, keyHints }) => {
          const enabled = enabledByType[type]

          return (
            <button
              key={type}
              type="button"
              className={`action-buttons__button action-buttons__button--${type}`}
              style={{ '--action-accent': ICON_COLORS[type] } as React.CSSProperties}
              disabled={!enabled}
              aria-disabled={!enabled}
              aria-keyshortcuts={keyHints.join(' ')}
              aria-label={enabled ? label : `${label} (unavailable)`}
              title={enabled ? `${label} [${keyHints.join(' / ')}]` : `${label} is unavailable right now`}
              onClick={(event) => {
                handlers[type]()
                // Keep keyboard focus off the button so Space never double-triggers.
                event.currentTarget.blur()
              }}
            >
              <GameIcon type={type} size={ACTION_ICON_SIZE} />
              <span className="action-buttons__label">{label}</span>
              <span className="action-buttons__keys">
                {keyHints.map((hint) => (
                  <kbd key={hint} className="action-buttons__key">
                    {hint}
                  </kbd>
                ))}
              </span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}

export default ActionButtons

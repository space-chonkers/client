import React, { useEffect } from 'react'
import { GameIcon, ICON_COLORS, type GameIconType } from './icons/GameIcons'
import './actionButtons.css'

/** Matches the default icon size of the ResourceBar HUD panel. */
const ACTION_ICON_SIZE = 28

import './chunkyButton.css'

export interface ActionButtonsProps {
  /** Called when the player builds (Build button, `E` or `Space`). */
  onBuild?: () => void
  /** Called when the player collects from the Stash into the SharedPool (Collect button or `C`). */
  onCollect?: () => void
  /** Called when the player fixes an active phenomenon at the stash (`F`). */
  onFix?: () => void
  /** Whether Build can be used. Unavailable buttons are dimmed, never hidden. */
  buildEnabled?: boolean
  /** Whether Collect can be used. Unavailable buttons are dimmed, never hidden. */
  collectEnabled?: boolean
  /** Whether Fix can be used. Unavailable buttons are dimmed, never hidden. */
  fixEnabled?: boolean
}

type ActionType = 'build' | 'collect' | 'fix'

interface ActionButtonConfig {
  type: ActionType
  icon: GameIconType
  label: string
  keyHints: readonly string[]
}

const ACTION_BUTTONS: readonly ActionButtonConfig[] = [
  { type: 'build', icon: 'build', label: 'Build', keyHints: ['E', 'Space'] },
  { type: 'collect', icon: 'collect', label: 'Collect', keyHints: ['Q', 'C'] },
  { type: 'fix', icon: 'energy', label: 'Fix', keyHints: ['F'] },
]

const BUILD_KEY_CODES: readonly string[] = ['KeyE', 'Space']
const COLLECT_KEY_CODES: readonly string[] = ['KeyQ', 'KeyC']
const FIX_KEY_CODES: readonly string[] = ['KeyF']

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
  onFix,
  buildEnabled = true,
  collectEnabled = true,
  fixEnabled = false,
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted || event.repeat || shouldIgnoreKeyEvent(event)) return

      if (buildEnabled && BUILD_KEY_CODES.includes(event.code)) onBuild?.()
      else if (collectEnabled && COLLECT_KEY_CODES.includes(event.code)) onCollect?.()
      else if (fixEnabled && FIX_KEY_CODES.includes(event.code)) onFix?.()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onBuild, onCollect, onFix, buildEnabled, collectEnabled, fixEnabled])

  const handlers: Record<ActionType, () => void> = {
    build: () => onBuild?.(),
    collect: () => onCollect?.(),
    fix: () => onFix?.(),
  }
  const enabledByType: Record<ActionType, boolean> = {
    build: buildEnabled,
    collect: collectEnabled,
    fix: fixEnabled,
  }

  return (
    <div className="action-buttons-overlay">
      <nav className="action-buttons" aria-label="Game actions">
        {ACTION_BUTTONS.map(({ type, icon, label, keyHints }) => {
          const enabled = enabledByType[type]

          return (
            <button
              key={type}
              type="button"
              className={`action-buttons__button action-buttons__button--${type}`}
              style={{ '--action-accent': ICON_COLORS[icon] } as React.CSSProperties}
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
              <GameIcon type={icon} size={ACTION_ICON_SIZE} />
              <span className="action-buttons__label">{label}</span>
              <span className="action-buttons__keys">
                {keyHints.map((hint, index) => (
                  <React.Fragment key={hint}>
                    {index > 0 && <span aria-hidden="true"> / </span>}
                    <kbd className="action-buttons__key">{hint}</kbd>
                  </React.Fragment>
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

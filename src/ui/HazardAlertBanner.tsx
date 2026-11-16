import type { CSSProperties } from 'react'
import type { HazardDefinition } from '../game/hazards/hazardEvents'
import { GameIcon, ICON_COLORS } from './icons/GameIcons'
import './hazardAlertBanner.css'

/** Larger than the 28 px HUD icons so the warning stands out. */
const BANNER_ICON_SIZE = 40

export interface HazardAlertBannerProps {
  hazard: HazardDefinition
  /** Called by the X button. */
  onClose: () => void
}

function CloseIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Warning that a hazard is coming. Accents take the color of the hazard's
 * resource icon. Purely presentational: the parent decides what closing does.
 */
export default function HazardAlertBanner({ hazard, onClose }: HazardAlertBannerProps) {
  const accentStyle = { '--hazard-accent': ICON_COLORS[hazard.icon] } as CSSProperties
  const titleId = `hazard-alert-title-${hazard.type}`

  return (
    <div className="hazard-alert-overlay">
      <section className="hazard-alert" style={accentStyle} aria-labelledby={titleId}>
        <div className="hazard-alert__top-strip" aria-hidden="true" />

        <div className="hazard-alert__body">
          <span className="hazard-alert__icon" aria-hidden="true">
            <GameIcon type={hazard.icon} size={BANNER_ICON_SIZE} />
          </span>

          <div className="hazard-alert__text" role="alert">
            <h2 id={titleId} className="hazard-alert__title">{hazard.title}</h2>
            <p className="hazard-alert__description">{hazard.description}</p>
          </div>

          <button
            type="button"
            className="hazard-alert__close"
            onClick={onClose}
            aria-label={`Close ${hazard.title} warning`}
          >
            <CloseIcon />
          </button>
        </div>
      </section>
    </div>
  )
}

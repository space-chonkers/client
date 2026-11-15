import type { CSSProperties } from 'react'
import type { HazardDefinition } from '../game/hazards/hazardEvents'
import { GameIcon, ICON_COLORS } from './icons/GameIcons'
import './hazardOngoingLabel.css'

const LABEL_ICON_SIZE = 18

export interface HazardOngoingLabelProps {
  hazard: HazardDefinition
}

/**
 * Small top-right label shown while a hazard is happening (after its warning
 * banner was closed, until it is resolved). Purely presentational.
 */
export default function HazardOngoingLabel({ hazard }: HazardOngoingLabelProps) {
  const accentStyle = { '--hazard-accent': ICON_COLORS[hazard.icon] } as CSSProperties

  return (
    <p className="hazard-ongoing" style={accentStyle} role="status">
      <span className="hazard-ongoing__icon" aria-hidden="true">
        <GameIcon type={hazard.icon} size={LABEL_ICON_SIZE} />
      </span>
      <span className="hazard-ongoing__text">
        <strong>{hazard.title}</strong> in progress
      </span>
    </p>
  )
}

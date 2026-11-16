import React from 'react'
import {
  GameIcon,
  ICON_COLORS,
  type PoolResourceIconType,
} from './icons/GameIcons'
import './resourceBar.css'

export interface ResourceBarValues {
  oxygen: number
  water: number
  energy: number
  food: number
  radiation: number
}

/** Maximum shared pool capacity per resource defined in the game specification. */
export const MAX_RESOURCE_CAPACITY = 100

/** Default simulated resource balances for the top-left HUD panel. */
export const DEFAULT_SIMULATED_RESOURCES: Readonly<ResourceBarValues> = {
  oxygen: 85,
  water: 70,
  energy: 90,
  food: 60,
  radiation: 12,
}

const RESOURCE_ORDER: readonly PoolResourceIconType[] = [
  'oxygen',
  'water',
  'energy',
  'food',
  'radiation',
]

export interface ResourceBarProps {
  /** Optional partial resource values; missing entries fall back to simulated defaults. */
  values?: Partial<ResourceBarValues>
  /** Icon size in pixels. */
  iconSize?: number
  className?: string
}

/**
 * Top-left HUD resource panel displaying the 5 shared pool/status indicators
 * (oxygen, water, energy, food, and radiation). Each row renders the resource
 * icon, a color-coded percentage progress bar, and the numeric value.
 */
export const ResourceBar: React.FC<ResourceBarProps> = ({
  values,
  iconSize = 28,
  className,
}) => {
  const mergedValues: ResourceBarValues = {
    ...DEFAULT_SIMULATED_RESOURCES,
    ...values,
  }

  const barClassName = className
    ? `resource-bar ${className}`
    : 'resource-bar'

  return (
    <div className="resource-bar-overlay">
      <aside
        className={barClassName}
        role="status"
        aria-label="Shared mission resources"
      >
        {RESOURCE_ORDER.map((type) => {
          const value = mergedValues[type]
          const percentage = Math.min(
            100,
            Math.max(0, (value / MAX_RESOURCE_CAPACITY) * 100),
          )

          return (
            <div
              key={type}
              className="resource-bar__row"
              title={`${type}: ${value} / ${MAX_RESOURCE_CAPACITY}`}
            >
              <GameIcon type={type} size={iconSize} />
              <div
                className="resource-bar__track"
                role="progressbar"
                aria-label={type}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={MAX_RESOURCE_CAPACITY}
              >
                <div
                  className="resource-bar__fill"
                  style={{
                    width: `${percentage}%`,
                    backgroundColor: ICON_COLORS[type],
                  }}
                />
              </div>
              <span className="resource-bar__value">{value}</span>
            </div>
          )
        })}
      </aside>
    </div>
  )
}

export default ResourceBar

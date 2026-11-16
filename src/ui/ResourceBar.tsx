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
}

/** Maximum shared pool capacity per resource defined in the game specification. */
export const MAX_RESOURCE_CAPACITY = 100

/** Default simulated resource balances for the top-left HUD panel. */
export const DEFAULT_SIMULATED_RESOURCES: Readonly<ResourceBarValues> = {
  oxygen: 85,
  water: 70,
  energy: 90,
  food: 60,
}

const RESOURCE_ORDER: readonly PoolResourceIconType[] = [
  'oxygen',
  'water',
  'energy',
  'food',
]

export interface ResourceBarProps {
  /** Optional partial resource values; missing entries fall back to simulated defaults. */
  values?: Partial<ResourceBarValues>
  /** Optional per-resource max capacity (defaults to MAX_RESOURCE_CAPACITY). */
  maxValues?: Partial<ResourceBarValues>
  /** Icon size in pixels. */
  iconSize?: number
  className?: string
}

/**
 * Top-left HUD resource panel displaying the four shared resource pools
 * (oxygen, water, energy, and food). Each row renders the resource
 * icon, a color-coded percentage progress bar, and the numeric value.
 */
export const ResourceBar: React.FC<ResourceBarProps> = ({
  values,
  maxValues,
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
          const max = maxValues?.[type] ?? MAX_RESOURCE_CAPACITY
          const percentage = Math.min(
            100,
            Math.max(0, max > 0 ? (value / max) * 100 : 0),
          )

          return (
            <div
              key={type}
              className="resource-bar__row"
              title={`${type}: ${value} / ${max}`}
            >
              <GameIcon type={type} size={iconSize} />
              <div
                className="resource-bar__track"
                role="progressbar"
                aria-label={type}
                aria-valuenow={value}
                aria-valuemin={0}
                aria-valuemax={max}
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

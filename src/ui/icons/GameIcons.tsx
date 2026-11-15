import React from 'react'

export type PoolResourceIconType =
  | 'oxygen'
  | 'water'
  | 'energy'
  | 'food'
  | 'radiation'

export type ConstructionEventIconType = 'build' | 'expand' | 'collect'

export type GameIconType = PoolResourceIconType | ConstructionEventIconType

/**
 * Transparent PNG asset URLs for UI rendering or Three.js texture loading.
 */
export const ICON_PNG_URLS: Record<GameIconType, string> = {
  oxygen: new URL('./oxygen.png', import.meta.url).href,
  water: new URL('./water.png', import.meta.url).href,
  energy: new URL('./energy.png', import.meta.url).href,
  food: new URL('./food.png', import.meta.url).href,
  radiation: new URL('./radiation.png', import.meta.url).href,
  build: new URL('./build.png', import.meta.url).href,
  expand: new URL('./expand.png', import.meta.url).href,
  collect: new URL('./collect.png', import.meta.url).href,
}

export const ICON_COLORS: Record<GameIconType, string> = {
  oxygen: '#38bdf8',
  water: '#00a896',
  energy: '#ff9f1c',
  food: '#52b788',
  radiation: '#ff4d6d',
  build: '#e2e8f0',
  expand: '#2ec4b6',
  collect: '#7dd3fc',
}

export interface GameIconProps {
  type: GameIconType
  size?: number
  amount?: number | string
  className?: string
}

export const GameIcon: React.FC<GameIconProps> = ({
  type,
  size = 48,
  amount,
  className,
}) => {
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}
    >
      <img
        src={ICON_PNG_URLS[type]}
        alt={type}
        width={size}
        height={size}
        style={{ display: 'block', userSelect: 'none' }}
      />
      {amount !== undefined && (
        <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc' }}>
          {amount}
        </span>
      )}
    </span>
  )
}

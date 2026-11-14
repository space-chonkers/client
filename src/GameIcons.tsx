import React from 'react'

export type PoolResourceIconType =
  | 'oxygen'
  | 'water'
  | 'energy'
  | 'food'
  | 'radiation'

export type ConstructionEventIconType = 'build' | 'expand' | 'collect'

export type GameIconType = PoolResourceIconType | ConstructionEventIconType

export interface GameIconProps {
  type: GameIconType
  /** Tamaño aumentado por defecto (48px) para máxima legibilidad en vista cenital */
  size?: number
  className?: string
}

export const ICON_COLORS: Record<GameIconType, string> = {
  oxygen: '#38bdf8',    // Cian claro
  water: '#00a896',     // Turquesa
  energy: '#ff9f1c',    // Ámbar cálido
  food: '#52b788',      // Esmeralda menta
  radiation: '#ff4d6d', // Coral/Carmesí
  build: '#e2e8f0',     // Blanco hueso
  expand: '#2ec4b6',    // Turquesa brillante
  collect: '#7dd3fc',   // Cian luminoso
}

/**
 * Íconos vectoriales de gran escala y trazos gruesos para lectura inmediata en Top-View.
 */
export const GameIcon: React.FC<GameIconProps> = ({
  type,
  size = 48,
  className,
}) => {
  const color = ICON_COLORS[type]

  switch (type) {
    case 'oxygen':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Oxígeno">
          <circle cx="9.5" cy="13.5" r="6.5" stroke={color} strokeWidth="2.6" fill={color} fillOpacity="0.28" />
          <circle cx="17" cy="7" r="4" fill={color} />
          <circle cx="8" cy="12" r="1.8" fill="#ffffff" />
        </svg>
      )

    case 'water':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Agua">
          <path
            d="M12 2.5C12 2.5 4.5 11 4.5 15.8C4.5 19.8 7.8 22.2 12 22.2C16.2 22.2 19.5 19.8 19.5 15.8C19.5 11 12 2.5 12 2.5Z"
            stroke={color}
            strokeWidth="2.6"
            fill={color}
            fillOpacity="0.3"
          />
          <path d="M8.5 16.5C9.8 18.2 12.5 18.8 15.2 17" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )

    case 'energy':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Energía">
          <polygon
            points="13.8,1.8 5,13.2 11.5,13.2 9.8,22.2 19,10.8 12.5,10.8"
            fill={color}
            stroke="#ffffff"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )

    case 'food':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Comida">
          <path
            d="M19.5 4.5C11 4.5 4.5 9.2 4.5 17.8C4.5 19.4 5.6 20.5 7.2 20.5C15.8 20.5 19.5 14 19.5 4.5Z"
            stroke={color}
            strokeWidth="2.6"
            fill={color}
            fillOpacity="0.32"
          />
          <path d="M5.2 19.2L16 8.5" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )

    case 'radiation':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Radiación">
          <polygon
            points="12,2.5 22,20.5 2,20.5"
            stroke={color}
            strokeWidth="2.6"
            fill={color}
            fillOpacity="0.28"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="15.2" r="2.5" fill="#ffffff" />
          <path d="M12 8V11.2" stroke={color} strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      )

    case 'build':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Construir">
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" stroke={color} strokeWidth="2.5" fill={color} fillOpacity="0.15" />
          <path d="M12 7.5V16.5M7.5 12H16.5" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      )

    case 'expand':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Expandir Pasillo">
          <path
            d="M3.5 12H20.5M15.5 7L20.5 12L15.5 17M8.5 7L3.5 12L8.5 17"
            stroke={color}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )

    case 'collect':
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-label="Recolectar Stash">
          <path
            d="M12 3.5V15M12 15L7.5 10.5M12 15L16.5 10.5"
            stroke={color}
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M4.5 19H19.5" stroke="#ffffff" strokeWidth="2.8" strokeLinecap="round" />
        </svg>
      )
  }
}

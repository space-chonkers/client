import type { PoolResourceIconType } from '../../ui/icons/GameIcons'

/** Code the server sends on a tick when no hazard is coming. */
export const NO_HAZARD_CODE = 0

/** Non-zero hazard codes sent by the server on each tick. */
export type HazardCode = 1 | 2 | 3 | 4

export type HazardType = 'solarStorm' | 'waterLeak' | 'oxygenLoss' | 'rottenFood'

export interface HazardDefinition {
  type: HazardType
  /** Headline shown on the alert banner. */
  title: string
  /** Short instruction shown under the title. */
  description: string
  /** Resource icon that represents the hazard. */
  icon: PoolResourceIconType
}

export const HAZARDS_BY_CODE: Readonly<Record<HazardCode, HazardDefinition>> = {
  1: {
    type: 'solarStorm',
    title: 'Solar Storm',
    description: 'Radiation is on its way. Get ready!',
    icon: 'radiation',
  },
  2: {
    type: 'waterLeak',
    title: 'Water Leak',
    description: 'A water tank is about to crack. Get ready!',
    icon: 'water',
  },
  3: {
    type: 'oxygenLoss',
    title: 'Oxygen Loss',
    description: 'The oxygen supply is about to drop. Get ready!',
    icon: 'oxygen',
  },
  4: {
    type: 'rottenFood',
    title: 'Rotten Food',
    description: 'Some food supplies are about to spoil. Get ready!',
    icon: 'food',
  },
}

export const HAZARD_CODES: readonly HazardCode[] = [1, 2, 3, 4]

function isHazardCode(code: number): code is HazardCode {
  return HAZARD_CODES.includes(code as HazardCode)
}

/** Returns the hazard for a server code, or `null` for 0 and unknown codes. */
export function getHazardByCode(code: number): HazardDefinition | null {
  return isHazardCode(code) ? HAZARDS_BY_CODE[code] : null
}

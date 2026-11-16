import type { HazardIconType } from '../../ui/icons/GameIcons'

/** Code the server sends on a tick when no hazard is coming. */
export const NO_HAZARD_CODE = 0

export type HazardType = 'solarStorm' | 'waterLeak' | 'oxygenLoss' | 'rottenFood'

export interface HazardDefinition {
  type: HazardType
  /** Headline shown on the alert banner. */
  title: string
  /** Short instruction shown under the title. */
  description: string
  /** Resource icon that represents the hazard. */
  icon: HazardIconType
}

/** Hazards keyed by the non-zero code the server sends on each tick. */
const HAZARDS_BY_CODE: Readonly<Record<number, HazardDefinition>> = {
  1: {
    type: 'solarStorm',
    title: 'Solar Storm',
    description: 'Solar activity is lowering navigation. Fix it at the stash.',
    icon: 'radiation',
  },
  2: {
    type: 'waterLeak',
    title: 'Water Leak',
    description: 'A water leak is draining the pool faster. Fix it at the stash.',
    icon: 'water',
  },
  3: {
    type: 'oxygenLoss',
    title: 'Oxygen Loss',
    description: 'Oxygen loss is draining the pool faster. Fix it at the stash.',
    icon: 'oxygen',
  },
  4: {
    type: 'rottenFood',
    title: 'Rotten Food',
    description: 'Some food supplies spoiled. Check the shared pool.',
    icon: 'food',
  },
}

/** Returns the hazard for a server code, or `null` for 0 and unknown codes. */
export function getHazardByCode(code: number): HazardDefinition | null {
  return HAZARDS_BY_CODE[code] ?? null
}

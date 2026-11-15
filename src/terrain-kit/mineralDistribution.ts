import type { CraterKind, Geology, MineralFeature, Region } from './reliefMap'

/**
 * Where, and how often, one mineral family may be placed on a Layer −1 map.
 * Kept apart from the mineral visuals (`minerals.ts`) so a deposit's look
 * never depends on where it is found, and vice versa.
 */
export interface MineralRule {
  feature: MineralFeature
  /** Whether a cell with this geology, region and nearby crater kind (if any) can host the deposit. */
  where: (geology: Geology, region: Region, craterKind: CraterKind | undefined) => boolean
  /** Probability that an eligible cell receives a deposit. */
  chance: number
  /** Minimum distance, in cells, between two deposits of the same family. */
  spacing: number
  /** Steepest cell slope that can hold a deposit. */
  maxSlope: number
}

/**
 * Generic, location-agnostic distribution used when a map supplies no rules
 * of its own (see `ReliefMapOptions.mineralRules`). It loosely follows the
 * settings in which rovers found each mineral: hematite concretions in
 * sedimentary plains and basin margins; gypsum veins cutting flat-lying
 * lakebed mudstone (as in Gale crater) and infilled crater floors; olivine in
 * basaltic plains and fresh crater floors; sulfur, rare, on flat basin or
 * crater floors. Placements are seeded game dressing inspired by those
 * findings, not predictions of real deposits.
 *
 * Deposits need fairly even ground, and the same family keeps its distance
 * so finds stay scattered: fewer, larger deposits read better than many
 * small ones. Rules run in order, which keeps generation deterministic.
 */
export const DEFAULT_MINERAL_RULES: readonly MineralRule[] = [
  {
    feature: 'hematite',
    where: (geology, region) => (geology === 'sediment' && region !== 'highlands') || (geology === 'plain' && region === 'plains'),
    chance: 0.03,
    spacing: 7,
    maxSlope: 0.2,
  },
  {
    feature: 'gypsum',
    where: (geology, region, craterKind) =>
      (region === 'basin' && (geology === 'basin' || geology === 'sediment')) || (geology === 'crater' && craterKind === 'eroded'),
    chance: 0.035,
    spacing: 7,
    maxSlope: 0.14,
  },
  {
    // Dune fields are basaltic too, but their ridges are no ground for a deposit.
    feature: 'olivine',
    where: (geology, region, craterKind) => (region === 'volcanic' && geology === 'plain') || (geology === 'crater' && craterKind === 'fresh'),
    chance: 0.035,
    spacing: 7,
    maxSlope: 0.2,
  },
  {
    feature: 'sulfur',
    where: (geology, region) => (region === 'basin' && geology === 'basin') || geology === 'crater',
    chance: 0.02,
    spacing: 12,
    maxSlope: 0.12,
  },
]

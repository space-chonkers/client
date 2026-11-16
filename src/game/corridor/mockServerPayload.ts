import type { CardinalSide } from '../../assets/SpaceCorridor'
import type { ConstructionPayload } from './CorridorGrid'

export interface ServerGridDimensions {
  width: number
  height: number
}

export interface ServerInvestigationCell {
  cellX: number
  cellY: number
}

export interface ServerSpawnSlot {
  slot: number
  x: number
  y: number
  facing: CardinalSide
}

export interface ServerResourceState {
  pool: {
    current: number
    max: number
  }
  stash: {
    current: number
    max: number
    gps: number
  }
  cps: number
}

export interface ServerMatchPayload {
  grid: ServerGridDimensions
  baseCellCount: number
  teamSize: number
  constructions: ReadonlyArray<ConstructionPayload>
  investigation: ReadonlyArray<ServerInvestigationCell>
  spawns: ReadonlyArray<ServerSpawnSlot>
  resources: {
    water: ServerResourceState
    oxygen: ServerResourceState
    energy: ServerResourceState
    food: ServerResourceState
  }
}

/**
 * Temporary mock payload matching the authoritative server match state.
 * Serves as the baseline contract until the live backend service is connected.
 */
export const INITIAL_SERVER_PAYLOAD: Readonly<ServerMatchPayload> = {
  grid: {
    width: 50,
    height: 50,
  },
  baseCellCount: 9,
  teamSize: 4,
  constructions: [
    { id: 'base-28-24', kind: 'base_tile', cellX: 28, cellY: 24 },
    { id: 'base-29-24', kind: 'base_tile', cellX: 29, cellY: 24 },
    { id: 'base-30-24', kind: 'base_tile', cellX: 30, cellY: 24 },
    { id: 'base-28-25', kind: 'base_tile', cellX: 28, cellY: 25 },
    { id: 'stash', kind: 'stash', cellX: 29, cellY: 25 },
    { id: 'base-30-25', kind: 'base_tile', cellX: 30, cellY: 25 },
    { id: 'base-28-26', kind: 'base_tile', cellX: 28, cellY: 26 },
    { id: 'base-29-26', kind: 'base_tile', cellX: 29, cellY: 26 },
    { id: 'base-30-26', kind: 'base_tile', cellX: 30, cellY: 26 },
  ],
  investigation: [
    { cellX: 31, cellY: 45 },
    { cellX: 49, cellY: 24 },
    { cellX: 30, cellY: 6 },
    { cellX: 7, cellY: 46 },
    { cellX: 3, cellY: 33 },
    { cellX: 41, cellY: 2 },
    { cellX: 4, cellY: 40 },
    { cellX: 0, cellY: 8 },
    { cellX: 5, cellY: 21 },
    { cellX: 25, cellY: 4 },
  ],
  spawns: [
    { slot: 0, x: 29.5, y: 24.5, facing: 'north' },
    { slot: 1, x: 30.5, y: 25.5, facing: 'east' },
    { slot: 2, x: 29.5, y: 26.5, facing: 'south' },
    { slot: 3, x: 28.5, y: 25.5, facing: 'west' },
  ],
  resources: {
    water: {
      pool: { current: 100, max: 200 },
      stash: { current: 0, max: 39, gps: 0.36 },
      cps: 1.92,
    },
    oxygen: {
      pool: { current: 100, max: 200 },
      stash: { current: 0, max: 39, gps: 0.36 },
      cps: 1.92,
    },
    energy: {
      pool: { current: 100, max: 200 },
      stash: { current: 0, max: 39, gps: 0.27 },
      cps: 1.54,
    },
    food: {
      pool: { current: 80, max: 160 },
      stash: { current: 0, max: 39, gps: 0.6 },
      cps: 1.2,
    },
  },
}

/** Center cell (stash) of the initial 3x3 server base payload. */
export const INITIAL_BASE_ORIGIN = { cellX: 29, cellY: 25 } as const

/** Initial 3x3 base constructions extracted from the mock server payload. */
export const INITIAL_SERVER_CONSTRUCTIONS: ReadonlyArray<ConstructionPayload> =
  INITIAL_SERVER_PAYLOAD.constructions

import * as THREE from 'three'
import {
  createInvestigationSiteResources,
  type InvestigationSiteInstance,
  type InvestigationSiteResources,
} from '../../assets/InvestigationSite'
import type { ServerGridDimensions, ServerInvestigationCell } from '../corridor/mockServerPayload'
import { resolveInvestigationProgress, type MissionMapConstruction } from '../minimap/missionMap'

type SiteState = 'pending' | 'collecting' | 'collected'

interface TrackedSite {
  readonly key: string
  readonly phase: number
  readonly instance: InvestigationSiteInstance
  state: SiteState
  collectProgress: number
}

const CRYSTAL_BASE_Y = 0.42
const BOB_AMPLITUDE = 0.08
const BOB_SPEED = 2.4
const IDLE_SPIN_SPEED = 1.4
const COLLECT_DURATION_SECONDS = 0.4
const COLLECT_RISE_HEIGHT = 0.9
const COLLECT_SPIN_SPEED = 14

function toCellKey(cellX: number, cellY: number): string {
  return `${cellX},${cellY}`
}

/**
 * Manages the 3D golden investigation sites on the `50x50` map.
 * Syncs with construction occupancy via `resolveInvestigationProgress` and plays
 * a short rise-spin-shrink collection animation when a corridor covers a site.
 */
export class InvestigationSites {
  readonly object = new THREE.Group()

  private readonly resources: InvestigationSiteResources
  private readonly tracked: TrackedSite[] = []

  constructor(
    private readonly cells: ReadonlyArray<ServerInvestigationCell>,
    private readonly grid: ServerGridDimensions,
    originCell: { readonly cellX: number; readonly cellY: number },
  ) {
    this.object.name = 'InvestigationSites'
    this.resources = createInvestigationSiteResources()

    cells.forEach((cell, index) => {
      const instance = this.resources.createInstance()
      instance.group.position.set(
        Math.round(cell.cellX - originCell.cellX),
        0,
        Math.round(cell.cellY - originCell.cellY),
      )
      this.object.add(instance.group)
      this.tracked.push({
        key: toCellKey(cell.cellX, cell.cellY),
        phase: index * 0.8,
        instance,
        state: 'pending',
        collectProgress: 0,
      })
    })
  }

  /** Updates site states against current base constructions; completed sites play their collect animation. */
  syncConstructions(constructions: ReadonlyArray<MissionMapConstruction>): void {
    const progress = resolveInvestigationProgress(this.cells, constructions, this.grid)
    const completedKeys = new Set(
      progress.sites.filter((site) => site.completed).map((site) => toCellKey(site.cellX, site.cellY)),
    )

    for (const item of this.tracked) {
      if (item.state === 'pending' && completedKeys.has(item.key)) {
        item.state = 'collecting'
        item.collectProgress = 0
      }
    }
  }

  /** Animates idle bobbing/rotation for pending sites and collection animations for newly covered sites. */
  update(delta: number, elapsed: number): void {
    for (const item of this.tracked) {
      const { group, crystal, halo } = item.instance

      if (item.state === 'pending') {
        const bob = Math.sin(elapsed * BOB_SPEED + item.phase) * BOB_AMPLITUDE
        crystal.position.y = CRYSTAL_BASE_Y + bob
        crystal.rotation.y = elapsed * IDLE_SPIN_SPEED + item.phase
        halo.position.y = CRYSTAL_BASE_Y + bob
        halo.rotation.z = elapsed * IDLE_SPIN_SPEED * 0.7 + item.phase
        continue
      }

      if (item.state === 'collecting') {
        item.collectProgress = Math.min(1, item.collectProgress + delta / COLLECT_DURATION_SECONDS)
        const t = item.collectProgress
        const scale = Math.max(0, 1 - t * t)

        group.scale.setScalar(scale)
        crystal.position.y = CRYSTAL_BASE_Y + t * COLLECT_RISE_HEIGHT
        crystal.rotation.y += delta * COLLECT_SPIN_SPEED
        halo.position.y = crystal.position.y
        halo.rotation.z -= delta * COLLECT_SPIN_SPEED * 0.6

        if (t >= 1) {
          item.state = 'collected'
          group.visible = false
        }
      }
    }
  }

  dispose(): void {
    for (const item of this.tracked) {
      this.object.remove(item.instance.group)
    }
    this.tracked.length = 0
    this.resources.dispose()
  }
}

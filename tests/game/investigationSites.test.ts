import { describe, expect, test } from 'bun:test'
import { InvestigationSites } from '../../src/game/map/InvestigationSites'

describe('InvestigationSites', () => {
  test('replaces mock sites with authoritative sites and animates covered cells', () => {
    const sites = new InvestigationSites(
      [{ cellX: 12, cellY: 20 }],
      { width: 50, height: 50 },
      { cellX: 10, cellY: 20 },
    )

    try {
      const mockSite = sites.object.children[0]
      expect(mockSite.position.x).toBe(2)
      expect(mockSite.position.z).toBe(0)

      sites.syncSites(
        [{ cellX: 12, cellY: 20 }],
        { width: 50, height: 50 },
        { cellX: 10, cellY: 20 },
      )
      expect(sites.object.children[0]).toBe(mockSite)

      sites.syncSites(
        [{ cellX: 40, cellY: 35 }],
        { width: 50, height: 50 },
        { cellX: 39, cellY: 30 },
      )
      expect(sites.object.children).toHaveLength(1)
      const authoritativeSite = sites.object.children[0]
      expect(authoritativeSite.position.x).toBe(1)
      expect(authoritativeSite.position.z).toBe(5)

      sites.syncConstructions([{ kind: 'base_tile', cellX: 40, cellY: 35 }])
      sites.update(0.4, 0.4)
      expect(authoritativeSite.visible).toBe(false)
    } finally {
      sites.dispose()
    }
  })
})

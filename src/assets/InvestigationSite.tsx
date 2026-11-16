import * as THREE from 'three'

/** Gold/cream palette matching the golden diamonds on `MissionMinimap`. */
export const INVESTIGATION_SITE_PALETTE = {
  gold: '#facc15',
  amber: '#d97706',
  cream: '#fff6ef',
  pad: '#1e293b',
} as const

export interface InvestigationSiteInstance {
  readonly group: THREE.Group
  readonly crystal: THREE.Mesh
  readonly halo: THREE.Mesh
}

export interface InvestigationSiteResources {
  createInstance: () => InvestigationSiteInstance
  dispose: () => void
}

/**
 * Creates shared geometries and materials for all 3D golden investigation
 * beacons on the map so every site shares GPU resources.
 */
export function createInvestigationSiteResources(): InvestigationSiteResources {
  const padGeo = new THREE.CylinderGeometry(0.32, 0.36, 0.04, 8)
  const ringGeo = new THREE.RingGeometry(0.24, 0.31, 24)
  ringGeo.rotateX(-Math.PI / 2)

  const crystalGeo = new THREE.OctahedronGeometry(0.2, 0)
  crystalGeo.scale(0.85, 1.35, 0.85)

  const haloGeo = new THREE.TorusGeometry(0.26, 0.022, 6, 20)
  haloGeo.rotateX(Math.PI / 2)

  const padMat = new THREE.MeshStandardMaterial({
    color: INVESTIGATION_SITE_PALETTE.pad,
    roughness: 0.75,
    metalness: 0.25,
  })
  const ringMat = new THREE.MeshStandardMaterial({
    color: INVESTIGATION_SITE_PALETTE.gold,
    emissive: INVESTIGATION_SITE_PALETTE.amber,
    emissiveIntensity: 0.45,
    roughness: 0.35,
    side: THREE.DoubleSide,
  })
  const crystalMat = new THREE.MeshStandardMaterial({
    color: INVESTIGATION_SITE_PALETTE.gold,
    emissive: INVESTIGATION_SITE_PALETTE.amber,
    emissiveIntensity: 0.55,
    roughness: 0.2,
    metalness: 0.35,
  })
  const haloMat = new THREE.MeshStandardMaterial({
    color: INVESTIGATION_SITE_PALETTE.cream,
    emissive: INVESTIGATION_SITE_PALETTE.gold,
    emissiveIntensity: 0.5,
    roughness: 0.25,
  })

  const createInstance = (): InvestigationSiteInstance => {
    const group = new THREE.Group()
    group.name = 'InvestigationSite'

    const pad = new THREE.Mesh(padGeo, padMat)
    pad.position.y = 0.02
    pad.receiveShadow = true

    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.y = 0.045

    const crystal = new THREE.Mesh(crystalGeo, crystalMat)
    crystal.position.y = 0.42
    crystal.castShadow = true

    const halo = new THREE.Mesh(haloGeo, haloMat)
    halo.position.y = 0.42

    group.add(pad, ring, crystal, halo)
    return { group, crystal, halo }
  }

  const dispose = () => {
    padGeo.dispose()
    ringGeo.dispose()
    crystalGeo.dispose()
    haloGeo.dispose()
    padMat.dispose()
    ringMat.dispose()
    crystalMat.dispose()
    haloMat.dispose()
  }

  return { createInstance, dispose }
}

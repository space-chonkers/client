import * as THREE from 'three'

/**
 * Shared art-direction palette (sRGB hex): warm rust terrain, rock and
 * cream/ochre strata that every asset family has to harmonise with.
 * Mineral colours are not part of the landscape palette; they live with the
 * mineral definitions in `minerals.ts`.
 */
export const PALETTE = {
  // Terrain surfaces
  sand: '#e98f58',
  sandLight: '#f4a96c',
  soil: '#c25d3c',
  rocky: '#9c4c3b',
  rockyLight: '#b45f45',
  sediment: ['#f1c38d', '#e3a26c', '#cd7d55', '#eab47c'],
  cracked: '#c96f47',
  crack: '#c08260',
  cliff: '#923f33',
  dust: '#f6b884',
  /** Dark basaltic dune sand (Mars' dune fields are dark), kept warm. */
  duneSand: '#8f4836',
  duneSandLight: '#a85a41',
  /** Volcanic plains: darker, slightly cooler rust-brown with basalt flecks. */
  basaltPlain: ['#a5654f', '#7c4a3e'],
  /** Light-toned, sulfate-bearing lakebed sediment in basins. */
  lakebed: ['#efc595', '#e5b483'],
  /** Bright, fine ejecta and rays around fresh impacts. */
  ejecta: '#f9c391',

  // Rocks and geological formations
  rock: ['#a95841', '#984c3b', '#b8653f', '#8e4437'],
  /** Loose boulders on volcanic plains: basalt, warmed by dust. */
  basaltRock: ['#5c4038', '#4e3a33', '#664a3e'],
  /** Pale sedimentary stone littering basins. */
  paleRock: ['#c98d61', '#b97a55', '#d6a272'],
  strata: ['#f0c08a', '#d9874f', '#bb583d', '#e8a76b', '#9d4636'],
  skirt: ['#c4683f', '#a24a37', '#da8a57', '#86392f', '#b4593e', '#6d2e28', '#9a4535'],
} as const

const shared = new Map<string, THREE.Material>()

function sharedMaterial<T extends THREE.Material>(key: string, create: () => T): T {
  let material = shared.get(key) as T | undefined
  if (!material) {
    material = create()
    shared.set(key, material)
  }
  return material
}

/**
 * Shared materials. Almost everything is drawn with `matte`: colour lives in
 * per-face vertex colours, so assets merge freely and the scene needs very few
 * draw calls and shader programs.
 */
export const materials = {
  matte: () =>
    sharedMaterial('matte', () =>
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
    ),
  /** Thin overlays (cracks) resting on terrain; offset to avoid z-fighting. */
  decal: () =>
    sharedMaterial('decal', () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 1,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    ),
  /**
   * Mineral grains and veins: a touch of sheen (hematite's metallic lustre,
   * olivine's glassy faces) so they separate from matte host rock. No emission.
   */
  mineral: () =>
    sharedMaterial('mineral', () =>
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.2 }),
    ),
}

export function isSharedMaterial(material: THREE.Material): boolean {
  for (const candidate of shared.values()) if (candidate === material) return true
  return false
}

/** Frees every shared material; they are recreated lazily on next use. */
export function disposeSharedMaterials(): void {
  shared.forEach((material) => material.dispose())
  shared.clear()
}

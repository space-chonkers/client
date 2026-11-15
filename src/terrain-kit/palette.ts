import * as THREE from 'three'

/**
 * Art-direction palette (sRGB hex). Warm rust terrain and cream/ochre strata;
 * minerals use their real visible colours (steel-grey hematite, white gypsum,
 * olive olivine, pale sulfur), slightly pushed so they read against rust.
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
  /** Ground halos that announce mineral deposits from a distance. */
  halo: { hematite: '#6e4a4f', gypsum: '#f1dcc0', olivine: '#6a4a3c', sulfur: '#e6cf86' },

  // Rocks and geological formations
  rock: ['#a95841', '#984c3b', '#b8653f', '#8e4437'],
  /** Charcoal-brown basalt, host rock of olivine. */
  basalt: ['#3e3833', '#4a423b', '#332f2c'],
  /** Loose boulders on volcanic plains: basalt, warmed by dust. */
  basaltRock: ['#5c4038', '#4e3a33', '#664a3e'],
  /** Pale sedimentary stone littering basins. */
  paleRock: ['#c98d61', '#b97a55', '#d6a272'],
  strata: ['#f0c08a', '#d9874f', '#bb583d', '#e8a76b', '#9d4636'],
  skirt: ['#c4683f', '#a24a37', '#da8a57', '#86392f', '#b4593e', '#6d2e28', '#9a4535'],

  // Minerals (Phase 2): science-inspired, exaggerated in size, never glowing.
  /** Hematite concretions ("blueberries", Meridiani Planum): dark steel-grey. */
  hematite: ['#4c5059', '#5f6470', '#3a3d45'],
  /** Light-toned, sulfate-rich sandstone that hosts the concretions (Burns formation). */
  hematiteHost: ['#d9a374', '#c98d61', '#e4b88a', '#a9654a'],
  /** Calcium-sulfate (gypsum) veins, e.g. "Homestake": off-white to cream. */
  gypsum: ['#f4eedf', '#e7dcc4', '#fbf7ee'],
  /** Darker fractured bedrock the veins cut through. */
  gypsumHost: ['#9d4c3a', '#b05a40', '#8a4234'],
  /** Olivine grains in basalt: muted olive, not emerald. */
  olivine: ['#7a8a40', '#8f9c4f', '#65722f'],
  /** Dark basaltic sand around olivine-bearing rock. */
  basaltSand: '#5c4438',
  /** Elemental sulfur (Gediz Vallis, 2024): muted yellow. */
  sulfur: ['#d8c35c', '#c6ab42', '#eadb8f'],
  /** Pale, crushed host rock around sulfur. */
  sulfurHost: ['#dcbc94', '#cba37a', '#e6cba6'],
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

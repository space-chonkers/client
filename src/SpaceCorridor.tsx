import { useEffect, useRef } from 'react'
import * as THREE from 'three'

/** Dimensiones lógicas del mapa (50x50) según game_specs.md */
export const MAP_GRID_WIDTH = 50
export const MAP_GRID_HEIGHT = 50

/**
 * Capas espaciales estrictas del mundo 3D:
 * -1: Terreno / Relieve
 *  0: Pasillos y estructuras de la base espacial
 *  1: Avatares de jugadores / entidades activas
 */
export const SPATIAL_LAYERS = {
  TERRAIN: -1,
  STRUCTURES: 0,
  ENTITIES: 1,
} as const

export type SpatialLayer = (typeof SPATIAL_LAYERS)[keyof typeof SPATIAL_LAYERS]

/** Variantes de pasillo según cantidad de paredes laterales (0, 1, 2 o 3 paredes) */
export type CorridorWallVariant = 0 | 1 | 2 | 3

export type CardinalSide = 'north' | 'south' | 'east' | 'west'

export const LAYER_VERTICAL_STEP = 0.5

export function layerToWorldY(layer: SpatialLayer): number {
  return layer * LAYER_VERTICAL_STEP
}

export function gridToWorldPosition(
  gridX: number,
  gridZ: number,
  layer: SpatialLayer,
): THREE.Vector3 {
  const clampedX = Math.max(0, Math.min(MAP_GRID_WIDTH - 1, gridX))
  const clampedZ = Math.max(0, Math.min(MAP_GRID_HEIGHT - 1, gridZ))
  const centerOffset = MAP_GRID_WIDTH / 2 - 0.5
  return new THREE.Vector3(
    clampedX - centerOffset,
    layerToWorldY(layer),
    clampedZ - centerOffset,
  )
}

/** Paleta Low-Poly accesible para Tritanopía */
export const CORRIDOR_PALETTE = {
  background: '#101622',
  hull: '#e2e8f0',
  floor: '#334155',
  floorGrid: '#00a896',
  ribTrim: '#475569',
  coralMarker: '#ff595e',
} as const

export interface SpaceCorridorProps {
  /** Lista de variantes de paredes (0, 1, 2, 3) a mostrar en fila */
  variants?: CorridorWallVariant[]
}

/**
 * Capa 0: Construye únicamente el asset del pasillo SIN TECHO (open top-view),
 * conservando su piso metálico (base), 0, 1, 2 o 3 paredes laterales,
 * y trazando las líneas guía del piso solo hacia las salidas abiertas.
 */
export function createCorridorSegment(
  wallCount: CorridorWallVariant = 2,
  isCorner = false,
): THREE.Group {
  const segment = new THREE.Group()
  segment.position.y = layerToWorldY(SPATIAL_LAYERS.STRUCTURES)

  const hullMat = new THREE.MeshStandardMaterial({
    color: CORRIDOR_PALETTE.hull,
    flatShading: true,
    roughness: 0.6,
    metalness: 0.15,
  })
  const floorMat = new THREE.MeshStandardMaterial({
    color: CORRIDOR_PALETTE.floor,
    flatShading: true,
    roughness: 0.8,
  })
  const stripMat = new THREE.MeshStandardMaterial({
    color: CORRIDOR_PALETTE.floorGrid,
    flatShading: true,
  })
  const trimMat = new THREE.MeshStandardMaterial({
    color: CORRIDOR_PALETTE.ribTrim,
    flatShading: true,
  })
  const coralMat = new THREE.MeshStandardMaterial({
    color: CORRIDOR_PALETTE.coralMarker,
    flatShading: true,
  })

  // 1. Piso metálico del pasillo (base propia de la estructura en Capa 0)
  const floorDeck = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.08, 0.88), floorMat)
  floorDeck.position.set(0, 0.04, 0)
  segment.add(floorDeck)

  // 2. Pilares de esquina bajos
  for (const sx of [-0.39, 0.39]) {
    for (const sz of [-0.39, 0.39]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.38, 0.1), trimMat)
      post.position.set(sx, 0.23, sz)
      segment.add(post)
    }
  }

  // 3. Determinar en qué lados hay pared según la variante (0, 1, 2 o 3 paredes)
  const walls = new Set<CardinalSide>()
  if (wallCount === 1) {
    walls.add('north')
  } else if (wallCount === 2) {
    if (isCorner) {
      walls.add('north')
      walls.add('west')
    } else {
      walls.add('west')
      walls.add('east')
    }
  } else if (wallCount === 3) {
    walls.add('north')
    walls.add('west')
    walls.add('east')
  }

  const addWall = (side: CardinalSide) => {
    const isZWall = side === 'north' || side === 'south'
    const wallGeo = isZWall
      ? new THREE.BoxGeometry(0.88, 0.34, 0.08)
      : new THREE.BoxGeometry(0.08, 0.34, 0.88)
    const capGeo = isZWall
      ? new THREE.BoxGeometry(0.88, 0.04, 0.09)
      : new THREE.BoxGeometry(0.09, 0.04, 0.88)

    const wall = new THREE.Mesh(wallGeo, hullMat)
    const cap = new THREE.Mesh(capGeo, coralMat)

    const offset = 0.4
    if (side === 'north') {
      wall.position.set(0, 0.25, -offset)
      cap.position.set(0, 0.43, -offset)
    } else if (side === 'south') {
      wall.position.set(0, 0.25, offset)
      cap.position.set(0, 0.43, offset)
    } else if (side === 'west') {
      wall.position.set(-offset, 0.25, 0)
      cap.position.set(-offset, 0.43, 0)
    } else {
      wall.position.set(offset, 0.25, 0)
      cap.position.set(offset, 0.43, 0)
    }

    segment.add(wall, cap)
  }

  walls.forEach(addWall)

  // 4. Líneas guía del piso: nodo central + brazos SOLO hacia las salidas abiertas
  const centerNode = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.02, 0.18), stripMat)
  centerNode.position.set(0, 0.085, 0)
  segment.add(centerNode)

  const allSides: CardinalSide[] = ['north', 'south', 'east', 'west']
  allSides.forEach((side) => {
    if (walls.has(side)) return

    const isZAxis = side === 'north' || side === 'south'
    const armGeo = isZAxis
      ? new THREE.BoxGeometry(0.18, 0.02, 0.31)
      : new THREE.BoxGeometry(0.31, 0.02, 0.18)
    const arm = new THREE.Mesh(armGeo, stripMat)

    const armOffset = 0.245
    if (side === 'north') arm.position.set(0, 0.085, -armOffset)
    else if (side === 'south') arm.position.set(0, 0.085, armOffset)
    else if (side === 'west') arm.position.set(-armOffset, 0.085, 0)
    else arm.position.set(armOffset, 0.085, 0)

    segment.add(arm)
  })

  return segment
}

/** Constructores individuales para las 4 variantes de pasillo en un solo archivo */
export const createCrossCorridor = () => createCorridorSegment(0)
export const createTJunctionCorridor = () => createCorridorSegment(1)
export const createStraightCorridorSegment = () => createCorridorSegment(2, false)
export const createBorderCorridor = () => createCorridorSegment(3)

export default function SpaceCorridor({
  variants = [0, 1, 2, 3],
}: SpaceCorridorProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(CORRIDOR_PALETTE.background)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 5.4, 3.6)
    camera.lookAt(0, 0, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const layerStructures = new THREE.Group()
    const spacing = 1.25
    const offset = ((variants.length - 1) * spacing) / 2

    variants.forEach((wallVariant, i) => {
      const xPos = i * spacing - offset
      const corridor = createCorridorSegment(wallVariant)
      corridor.position.set(xPos, layerToWorldY(SPATIAL_LAYERS.STRUCTURES), 0)
      layerStructures.add(corridor)
    })

    scene.add(layerStructures)

    scene.add(new THREE.AmbientLight(0xffffff, 1.5))
    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.5)
    keyLight.position.set(3, 8, 5)
    scene.add(keyLight)

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      if (width === 0 || height === 0) return
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    resize()

    let frameId = 0
    const animate = () => {
      layerStructures.rotation.y += 0.0035
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      layerStructures.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose())
          } else {
            obj.material.dispose()
          }
        }
      })
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [variants])

  return (
    <div
      ref={containerRef}
      className="cube-scene"
      aria-label="Roofless 4-variant space base corridors"
    />
  )
}

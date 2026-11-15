import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { CORRIDOR_PALETTE, SPATIAL_LAYERS, createCrossCorridor, layerToWorldY } from './SpaceCorridor'

/** Charcoal sci-fi palette for the stash cargo box. */
export const STASH_PALETTE = {
  /** Glossy near-black body and lid. */
  body: '#24272b',
  /** Matte charcoal corner guards, top pad and handles. */
  guard: '#3a3e44',
  /** Dark band where the lid meets the body. */
  seam: '#141618',
  /** Status light; matches the corridor's coral marker. */
  light: CORRIDOR_PALETTE.coralMarker,
} as const

/** Stash dimensions in world units (one corridor tile is 1 x 1). */
export const STASH_DIMENSIONS = {
  width: 0.45,
  depth: 0.45,
  height: 0.45,
} as const

/** How much the body's vertical edges are cut off. */
const BODY_CHAMFER = 0.035
/** Height of the lid seam, as a fraction of the box height. */
const LID_SEAM_HEIGHT_RATIO = 0.62
const LID_SEAM_THICKNESS = 0.025
/** How far the seam band sticks out past the body. */
const LID_SEAM_OVERHANG = 0.006

/** Corner guard footprint along each face, as a fraction of the box width. */
const GUARD_LENGTH_RATIO = 0.3
/** Corner guard height, as a fraction of the box height. */
const GUARD_HEIGHT_RATIO = 0.22
/** How far the corner guards stick out past the body. */
const GUARD_OVERHANG = 0.014
const GUARD_CHAMFER = 0.05
/** How far the top guards rise above the lid. */
const GUARD_TOP_RISE = 0.01

const TOP_PAD_SIZE_RATIO = 0.4
const TOP_PAD_CHAMFER = 0.05
const TOP_PAD_HEIGHT = 0.02

/** Handle height, as a fraction of the box height. */
const HANDLE_HEIGHT_RATIO = 0.8
const HANDLE_LENGTH_RATIO = 0.45
const HANDLE_BAR_THICKNESS = 0.022
const HANDLE_STANDOFF = 0.03

const LIGHT_SIZE = 0.075
const LIGHT_THICKNESS = 0.012
const LIGHT_GLOW_INTENSITY = 1.4

/**
 * Top of the corridor floor deck built by `createCorridorSegment`
 * (0.08 tall deck resting at Y = 0). Used to rest the stash on the floor.
 */
const CORRIDOR_DECK_TOP = 0.08

type FootprintPoint = readonly [x: number, z: number]

/** Extrudes a ground-plane outline (X/Z points) straight up by `height`. */
function extrudeFootprint(points: readonly FootprintPoint[], height: number): THREE.ExtrudeGeometry {
  // Shapes are drawn in X/Y; Y = -Z so that rotating the extrusion upright
  // maps the outline back onto the ground plane.
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** Rectangle outline centered on the origin with its four corners cut off. */
function chamferedRectangle(width: number, depth: number, chamfer: number): FootprintPoint[] {
  const x = width / 2
  const z = depth / 2
  return [
    [-x + chamfer, -z],
    [x - chamfer, -z],
    [x, -z + chamfer],
    [x, z - chamfer],
    [x - chamfer, z],
    [-x + chamfer, z],
    [-x, z - chamfer],
    [-x, -z + chamfer],
  ]
}

/**
 * Outline of the corner guard for the (+X, +Z) corner: a square wrapping the
 * corner, slightly larger than the body, with its outer corner cut off.
 */
function cornerGuardOutline(halfWidth: number, halfDepth: number, length: number): FootprintPoint[] {
  const outerX = halfWidth + GUARD_OVERHANG
  const outerZ = halfDepth + GUARD_OVERHANG
  const innerX = halfWidth - length
  const innerZ = halfDepth - length
  return [
    [innerX, innerZ],
    [outerX, innerZ],
    [outerX, outerZ - GUARD_CHAMFER],
    [outerX - GUARD_CHAMFER, outerZ],
    [innerX, outerZ],
  ]
}

/**
 * Builds a low-poly sci-fi cargo box (stash): chamfered cube body with a lid
 * seam, 8 wrap-around corner guards, an octagonal top pad, side handles, and a
 * glowing status light on the front (+Z, south) face.
 *
 * The returned group's origin is at the center of the box's bottom face, so
 * the caller only needs to set its position to the surface it rests on.
 */
export function createStash(): THREE.Group {
  const stash = new THREE.Group()
  stash.name = 'Stash'

  const { width, depth, height } = STASH_DIMENSIONS
  const halfWidth = width / 2
  const halfDepth = depth / 2
  const seamY = height * LID_SEAM_HEIGHT_RATIO

  const bodyMat = new THREE.MeshStandardMaterial({
    color: STASH_PALETTE.body,
    flatShading: true,
    roughness: 0.3,
    metalness: 0.35,
  })
  const guardMat = new THREE.MeshStandardMaterial({
    color: STASH_PALETTE.guard,
    flatShading: true,
    roughness: 0.75,
    metalness: 0.15,
  })
  const seamMat = new THREE.MeshStandardMaterial({
    color: STASH_PALETTE.seam,
    flatShading: true,
    roughness: 0.9,
  })
  const lightMat = new THREE.MeshStandardMaterial({
    color: STASH_PALETTE.light,
    emissive: STASH_PALETTE.light,
    emissiveIntensity: LIGHT_GLOW_INTENSITY,
    flatShading: true,
  })

  // 1. Chamfered cube body
  const body = new THREE.Mesh(
    extrudeFootprint(chamferedRectangle(width, depth, BODY_CHAMFER), height),
    bodyMat,
  )
  stash.add(body)

  // 2. Lid seam band wrapping the body
  const seam = new THREE.Mesh(
    extrudeFootprint(
      chamferedRectangle(width + LID_SEAM_OVERHANG * 2, depth + LID_SEAM_OVERHANG * 2, BODY_CHAMFER),
      LID_SEAM_THICKNESS,
    ),
    seamMat,
  )
  seam.position.y = seamY - LID_SEAM_THICKNESS / 2
  stash.add(seam)

  // 3. Corner guards: one outline for the (+X, +Z) corner, rotated in 90° steps
  //    to reach the other three corners, at the bottom and top of the box.
  const guardHeight = height * GUARD_HEIGHT_RATIO
  const guardGeo = extrudeFootprint(
    cornerGuardOutline(halfWidth, halfDepth, width * GUARD_LENGTH_RATIO),
    guardHeight,
  )
  const guardLevels = [0, height - guardHeight + GUARD_TOP_RISE]
  for (const y of guardLevels) {
    for (let quarterTurn = 0; quarterTurn < 4; quarterTurn++) {
      const guard = new THREE.Mesh(guardGeo, guardMat)
      guard.position.y = y
      guard.rotation.y = quarterTurn * (Math.PI / 2)
      stash.add(guard)
    }
  }

  // 4. Octagonal pad on top of the lid
  const padSize = width * TOP_PAD_SIZE_RATIO
  const topPad = new THREE.Mesh(
    extrudeFootprint(chamferedRectangle(padSize, padSize, TOP_PAD_CHAMFER), TOP_PAD_HEIGHT),
    guardMat,
  )
  topPad.position.y = height
  stash.add(topPad)

  // 5. Bar handles on the west and east sides, held by two standoffs each
  const handleY = height * HANDLE_HEIGHT_RATIO
  const handleLength = depth * HANDLE_LENGTH_RATIO
  const barGeo = new THREE.BoxGeometry(HANDLE_BAR_THICKNESS, HANDLE_BAR_THICKNESS, handleLength)
  const standoffGeo = new THREE.BoxGeometry(HANDLE_STANDOFF, HANDLE_BAR_THICKNESS * 0.8, HANDLE_BAR_THICKNESS)
  for (const side of [-1, 1]) {
    const bar = new THREE.Mesh(barGeo, guardMat)
    bar.position.set(side * (halfWidth + HANDLE_STANDOFF), handleY, 0)
    stash.add(bar)

    for (const end of [-1, 1]) {
      const standoff = new THREE.Mesh(standoffGeo, guardMat)
      standoff.position.set(
        side * (halfWidth + HANDLE_STANDOFF / 2),
        handleY,
        end * (handleLength / 2 - HANDLE_BAR_THICKNESS / 2),
      )
      stash.add(standoff)
    }
  }

  // 6. Glowing status light on the front face, sitting on the lid seam
  const light = new THREE.Mesh(new THREE.BoxGeometry(LIGHT_SIZE, LIGHT_SIZE, LIGHT_THICKNESS), lightMat)
  light.position.set(0, seamY, halfDepth + LID_SEAM_OVERHANG + LIGHT_THICKNESS / 2)
  stash.add(light)

  return stash
}

/**
 * Preview: a stash centered on a cross corridor tile (no walls, turquoise
 * floor cross), slowly rotating.
 */
export default function Stash() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(CORRIDOR_PALETTE.background)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100)
    camera.position.set(0, 1.6, 1.4)
    camera.lookAt(0, 0.15, 0)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const tile = createCrossCorridor()
    tile.position.y = layerToWorldY(SPATIAL_LAYERS.STRUCTURES)

    const stash = createStash()
    stash.position.y = CORRIDOR_DECK_TOP
    tile.add(stash)

    scene.add(tile)

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
      tile.rotation.y += 0.0035
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      tile.traverse((obj) => {
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
  }, [])

  return (
    <div
      ref={containerRef}
      className="cube-scene"
      aria-label="Stash cargo box on a cross corridor tile"
    />
  )
}

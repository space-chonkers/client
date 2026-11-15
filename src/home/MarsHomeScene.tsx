import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { InputController } from '../game/input/InputController'
import { AstronautModel } from '../game/player/AstronautModel'
import { DEFAULT_PLAYER_TUNING, Player, type PlayerTuning } from '../game/player/Player'
import {
  MARS_PALETTE,
  ROVER_PATH_RADIUS,
  createMarsBase,
  createMarsTerrain,
  createRover,
  disposeMarsMaterials,
  isMarsTileWalkable,
  type GridPosition,
} from './scene/marsProps'
import './MarsHomeScene.css'

/** Half of the orthographic camera's visible height, in world units. */
const CAMERA_VIEW_HALF_HEIGHT = 6.5
const CAMERA_POSITION = new THREE.Vector3(8, 11, 10)
const CAMERA_TARGET = new THREE.Vector3(0, 0, 0.6)
/**
 * Moves the scene down by this fraction of the viewport height so the base sits
 * centered between the title and the mode buttons (~59% from the top on both
 * desktop and phone layouts) instead of behind the logo.
 */
const SCENE_DOWN_SHIFT = 0.13

const ROVER_ANGULAR_SPEED = 0.22
const COMPANION_HOP_SPEED = 5
const COMPANION_HOP_HEIGHT = 0.18
const COMPANION_TURN_SPEED = 0.6
const SHADOW_MAP_SIZE = 1024
const SHADOW_HALF_EXTENT = 14
/** Caps the delta after a tab switch so the character doesn't "teleport". */
const MAX_FRAME_DELTA_SECONDS = 0.1

/**
 * The shared astronaut model is 1.8 units tall; the homepage tiles are 1 unit,
 * so it is scaled down to about 0.8 units to fit the map.
 */
const HOME_ASTRONAUT_SCALE = 0.45
/** Half the side of the square the player occupies on the ground, in world units. */
const PLAYER_FOOTPRINT_HALF_SIZE = 0.25
const HOME_PLAYER_TUNING: Readonly<PlayerTuning> = {
  ...DEFAULT_PLAYER_TUNING,
  walkSpeed: 2.6,
  // Shorter legs need more steps per unit walked to keep the same gait
  strideRate: DEFAULT_PLAYER_TUNING.strideRate / HOME_ASTRONAUT_SCALE,
}

const PLAYER_START_TILE: GridPosition = { x: 2, z: 2 }
const COMPANION_TILE: GridPosition = { x: -2, z: 2 }

function disposeSceneGeometries(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material]
    objectMaterials.forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  disposeMarsMaterials()
}

/** The jumping companion blocks its tile; the rover is decorative and never blocks. */
function isTileFreeForPlayer(tile: GridPosition): boolean {
  const isCompanionTile = tile.x === COMPANION_TILE.x && tile.z === COMPANION_TILE.z
  return isMarsTileWalkable(tile) && !isCompanionTile
}

/** Every corner of the player's footprint must be on a free tile (tile centers are integers). */
function canPlayerStandAt(x: number, z: number): boolean {
  const offsets = [-PLAYER_FOOTPRINT_HALF_SIZE, PLAYER_FOOTPRINT_HALF_SIZE]
  return offsets.every((offsetX) =>
    offsets.every((offsetZ) => isTileFreeForPlayer({ x: Math.round(x + offsetX), z: Math.round(z + offsetZ) })),
  )
}

/**
 * The shared `Player` only knows rectangular bounds, so the homepage undoes any
 * move onto a blocked spot after each update. One axis is undone at a time, so
 * the player slides along obstacles instead of sticking to them.
 */
function keepPlayerOnFreeGround(position: THREE.Vector3, previousPosition: THREE.Vector3): void {
  if (canPlayerStandAt(position.x, position.z)) return

  if (canPlayerStandAt(position.x, previousPosition.z)) {
    position.z = previousPosition.z
  } else if (canPlayerStandAt(previousPosition.x, position.z)) {
    position.x = previousPosition.x
  } else {
    position.x = previousPosition.x
    position.z = previousPosition.z
  }
}

/**
 * Homepage scene: orthographic 3D top view of a small base on Mars. The white
 * astronaut is the shared game `Player`, controlled with WASD or the arrow keys.
 */
export default function MarsHomeScene() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(MARS_PALETTE.sky)

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
    camera.position.copy(CAMERA_POSITION)
    camera.lookAt(CAMERA_TARGET)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    container.appendChild(renderer.domElement)

    scene.add(new THREE.HemisphereLight('#ffeadd', '#b55a3c', 1.6))
    const sunLight = new THREE.DirectionalLight('#fff1e0', 2.2)
    sunLight.position.set(6, 12, 4)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE)
    sunLight.shadow.camera.left = -SHADOW_HALF_EXTENT
    sunLight.shadow.camera.right = SHADOW_HALF_EXTENT
    sunLight.shadow.camera.top = SHADOW_HALF_EXTENT
    sunLight.shadow.camera.bottom = -SHADOW_HALF_EXTENT
    scene.add(sunLight)

    scene.add(createMarsTerrain(), createMarsBase())

    const rover = createRover()
    scene.add(rover)

    const input = new InputController()
    const player = new Player({ tuning: HOME_PLAYER_TUNING })
    const previousPlayerPosition = new THREE.Vector3()
    player.object.scale.setScalar(HOME_ASTRONAUT_SCALE)
    player.position.set(PLAYER_START_TILE.x, 0, PLAYER_START_TILE.z)

    const companion = new AstronautModel({ suitColor: MARS_PALETTE.teal })
    companion.root.scale.setScalar(HOME_ASTRONAUT_SCALE)
    companion.root.position.set(COMPANION_TILE.x, 0, COMPANION_TILE.z)
    scene.add(player.object, companion.root)

    const updateAmbientActors = (elapsedSeconds: number) => {
      const roverAngle = elapsedSeconds * ROVER_ANGULAR_SPEED
      rover.position.set(Math.cos(roverAngle) * ROVER_PATH_RADIUS, 0, Math.sin(roverAngle) * ROVER_PATH_RADIUS)
      // The rover's front (local +X) points along the circle's tangent
      rover.rotation.y = -Math.atan2(Math.cos(roverAngle), -Math.sin(roverAngle))

      companion.root.position.y = Math.abs(Math.sin(elapsedSeconds * COMPANION_HOP_SPEED)) * COMPANION_HOP_HEIGHT
      companion.root.rotation.y = Math.sin(elapsedSeconds * COMPANION_TURN_SPEED) * Math.PI
    }

    const resize = () => {
      const { width, height } = container.getBoundingClientRect()
      if (width === 0 || height === 0) return
      const aspect = width / height
      camera.left = -CAMERA_VIEW_HALF_HEIGHT * aspect
      camera.right = CAMERA_VIEW_HALF_HEIGHT * aspect
      // Shifting the frustum up makes the scene appear lower on screen
      const frustumShift = SCENE_DOWN_SHIFT * 2 * CAMERA_VIEW_HALF_HEIGHT
      camera.top = CAMERA_VIEW_HALF_HEIGHT + frustumShift
      camera.bottom = -CAMERA_VIEW_HALF_HEIGHT + frustumShift
      camera.updateProjectionMatrix()
      renderer.setSize(width, height)
      renderer.render(scene, camera)
    }

    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
    updateAmbientActors(0)
    resize()

    const clock = new THREE.Clock()
    let frameId = 0
    const animate = () => {
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_DELTA_SECONDS)
      // With reduced motion only what the player controls is animated
      if (!prefersReducedMotion) updateAmbientActors(clock.elapsedTime)
      previousPlayerPosition.copy(player.position)
      player.update(deltaSeconds, clock.elapsedTime, input.getMoveDirection())
      keepPlayerOnFreeGround(player.position, previousPlayerPosition)
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.cancelAnimationFrame(frameId)
      input.dispose()
      resizeObserver.disconnect()
      // The astronauts own their geometries and materials, so they are released separately
      scene.remove(player.object, companion.root)
      player.dispose()
      companion.dispose()
      disposeSceneGeometries(scene)
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="mars-scene"
      role="application"
      aria-label="Mars map: move the astronaut with WASD or the arrow keys"
    />
  )
}

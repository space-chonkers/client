import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { MAP_SIZE, generateReliefMap } from '../../src/terrain-kit/reliefMap'
import { createReliefTerrain } from '../../src/terrain-kit/reliefTerrain'

/** Hash of the generated cell data; only an intentional generator change should alter it. */
const cellHash = (map: ReturnType<typeof generateReliefMap>) =>
  createHash('sha256')
    .update(JSON.stringify({ seed: map.seed, cols: map.cols, rows: map.rows, cells: map.cells, craters: map.craters }))
    .digest('hex')
    .slice(0, 16)

describe('procedural source', () => {
  const map = generateReliefMap(42)

  test('is a 50×50, non-walkable Layer −1 map with relief in [-1, 1]', () => {
    expect(MAP_SIZE).toBe(50)
    expect(map.cols).toBe(50)
    expect(map.rows).toBe(50)
    expect(map.classification).toBe('procedural')
    expect(map.elevation).toBeUndefined()
    for (const cell of map.cells) {
      expect(cell.layer).toBe(-1)
      expect(cell.walkable).toBe(false)
      expect(cell.relief).toBeGreaterThanOrEqual(-1)
      expect(cell.relief).toBeLessThanOrEqual(1)
      expect(cell.elevationMeters).toBeUndefined()
    }
  })

  test('generates the recorded cells', () => {
    // A fixed hash also proves determinism. Update it only when the generator changes on purpose.
    expect(cellHash(map)).toBe('8dffd04d40904dc6')
  })

  test('renders the recorded meshes, dressing and placements', () => {
    const scene = createHash('sha256')
    for (const seed of [42, 7, 1234]) {
      const terrain = createReliefTerrain({ map: generateReliefMap(seed, 24, 24) })
      terrain.root.updateMatrixWorld(true)
      terrain.root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.geometry) return
        scene.update(`${object.name}|${mesh.type}|${JSON.stringify(object.matrixWorld.elements)}`)
        for (const name of Object.keys(mesh.geometry.attributes)) scene.update(name + Array.from(mesh.geometry.getAttribute(name).array).join(','))
        const instanced = object as THREE.InstancedMesh
        if (instanced.isInstancedMesh) scene.update(`inst${instanced.count}${Array.from(instanced.instanceMatrix.array).join(',')}`)
      })
      scene.update(JSON.stringify(terrain.placements))
    }
    // Update only when the renderer or dressing changes on purpose.
    expect(scene.digest('hex').slice(0, 16)).toBe('dcbd34498261148a')
  })
})

describe('renderer boundary', () => {
  // The renderer must consume a ReliefMap, never call a terrain source itself.
  const rendererFiles = [
    'src/terrain-kit/reliefTerrain.ts',
    'src/terrain-kit/reliefField.ts',
    'src/terrain-kit/terrain.ts',
    'src/terrain-kit/geometry.ts',
    'src/terrain-kit/placement.ts',
    'src/showcase/terrainLayerView.ts',
  ]

  test.each(rendererFiles)('%s does not depend on a terrain source', (file) => {
    const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
    expect(source).not.toMatch(/\b(generateReliefMap|generateLandforms|placeCraters|createReliefMapFromMarsTerrain)\b/)
  })
})

import * as THREE from 'three'

/**
 * Low-poly astronaut built from flat-shaded primitives.
 *
 * The model faces +Z. Limbs hang from named pivot groups (hips, shoulders,
 * neck) so they can be animated procedurally now, or replaced by a rigged
 * model later without changing the Player API.
 *
 * Approximate size: 1.8 units tall, feet at y = 0.
 */
export class AstronautModel {
  readonly root = new THREE.Group()
  /** Everything above the feet; bobs while walking. */
  readonly body = new THREE.Group()
  readonly head = new THREE.Group()
  readonly leftArm = new THREE.Group()
  readonly rightArm = new THREE.Group()
  readonly leftLeg = new THREE.Group()
  readonly rightLeg = new THREE.Group()

  private readonly geometries: THREE.BufferGeometry[] = []
  private readonly materials: THREE.Material[] = []

  private readonly mat = {
    suit: this.material({ color: '#f1f3f5', roughness: 0.75 }),
    shade: this.material({ color: '#b9c0ca', roughness: 0.6, metalness: 0.2 }),
    accent: this.material({ color: '#ff6b2c', roughness: 0.5 }),
    dark: this.material({ color: '#3b4048', roughness: 0.8 }),
    visor: this.material({
      color: '#1d3b73',
      roughness: 0.15,
      metalness: 0.85,
      emissive: '#0a1c3d',
      emissiveIntensity: 0.6,
    }),
    lightGreen: this.material({ color: '#4dffb5', emissive: '#4dffb5', emissiveIntensity: 1.2 }),
    lightOrange: this.material({ color: '#ffb347', emissive: '#ffb347', emissiveIntensity: 1.2 }),
    lightCyan: this.material({ color: '#5ad8ff', emissive: '#5ad8ff', emissiveIntensity: 1.2 }),
  }

  constructor() {
    this.root.name = 'Astronaut'
    this.body.name = 'body'
    this.root.add(this.body)

    this.buildLegs()
    this.buildTorso()
    this.buildBackpack()
    this.buildArms()
    this.buildHead()

    this.root.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })
  }

  /**
   * Apply a procedural pose.
   * @param walkPhase  advancing stride angle (radians)
   * @param moving     0 = standing, 1 = full walk speed
   * @param elapsed    seconds since start, for idle motion
   * @param reach      0..1 strength of the "reach forward to pick up" gesture
   */
  pose(walkPhase: number, moving: number, elapsed: number, reach: number): void {
    const stride = Math.sin(walkPhase) * 0.65 * moving
    this.leftLeg.rotation.x = stride
    this.rightLeg.rotation.x = -stride

    const armSwing = stride * 0.8
    const reachAngle = -1.25 * reach
    this.leftArm.rotation.x = THREE.MathUtils.lerp(-armSwing, reachAngle, reach)
    this.rightArm.rotation.x = THREE.MathUtils.lerp(armSwing, reachAngle, reach)

    const stepBounce = Math.abs(Math.sin(walkPhase)) * 0.07 * moving
    const breathe = Math.sin(elapsed * 2.2) * 0.012 * (1 - moving)
    this.body.position.y = stepBounce + breathe - 0.1 * reach
    this.body.rotation.x = 0.06 * moving + 0.25 * reach

    this.head.rotation.x = 0.2 * reach
    this.head.rotation.z = Math.sin(walkPhase) * 0.04 * moving
  }

  dispose(): void {
    for (const geometry of this.geometries) geometry.dispose()
    for (const material of this.materials) material.dispose()
  }

  // ---------------------------------------------------------------------------
  // Parts
  // ---------------------------------------------------------------------------

  private buildLegs(): void {
    const legGeo = this.geo(new THREE.CylinderGeometry(0.11, 0.1, 0.5, 6))
    const kneeGeo = this.geo(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 6))
    const bootGeo = this.geo(new THREE.BoxGeometry(0.2, 0.14, 0.3))

    for (const [leg, side] of [
      [this.leftLeg, -1],
      [this.rightLeg, 1],
    ] as const) {
      leg.name = side < 0 ? 'leftLeg' : 'rightLeg'
      leg.position.set(0.15 * side, 0.62, 0)
      this.mesh(legGeo, this.mat.suit, leg, 0, -0.25, 0)
      this.mesh(kneeGeo, this.mat.accent, leg, 0, -0.27, 0)
      this.mesh(bootGeo, this.mat.dark, leg, 0, -0.55, 0.04)
      this.body.add(leg)
    }
  }

  private buildTorso(): void {
    this.mesh(this.geo(new THREE.CylinderGeometry(0.27, 0.25, 0.16, 7)), this.mat.shade, this.body, 0, 0.66, 0)
    this.mesh(this.geo(new THREE.CylinderGeometry(0.3, 0.27, 0.5, 7)), this.mat.suit, this.body, 0, 0.98, 0)
    this.mesh(this.geo(new THREE.CylinderGeometry(0.285, 0.285, 0.06, 7)), this.mat.accent, this.body, 0, 0.76, 0)
    this.mesh(this.geo(new THREE.CylinderGeometry(0.17, 0.21, 0.08, 8)), this.mat.shade, this.body, 0, 1.26, 0)

    // Chest control panel with three status lights.
    this.mesh(this.geo(new THREE.BoxGeometry(0.26, 0.18, 0.06)), this.mat.shade, this.body, 0, 1.02, 0.27)
    const lightGeo = this.geo(new THREE.BoxGeometry(0.045, 0.045, 0.03))
    this.mesh(lightGeo, this.mat.lightGreen, this.body, -0.07, 1.04, 0.305)
    this.mesh(lightGeo, this.mat.lightOrange, this.body, 0, 1.04, 0.305)
    this.mesh(lightGeo, this.mat.lightCyan, this.body, 0.07, 1.04, 0.305)
  }

  private buildBackpack(): void {
    const pack = new THREE.Group()
    pack.name = 'backpack'
    pack.position.set(0, 1.02, -0.36)
    this.mesh(this.geo(new THREE.BoxGeometry(0.48, 0.56, 0.22)), this.mat.suit, pack, 0, 0, 0)
    this.mesh(this.geo(new THREE.BoxGeometry(0.5, 0.06, 0.24)), this.mat.accent, pack, 0, 0.12, 0)
    const tankGeo = this.geo(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 6))
    this.mesh(tankGeo, this.mat.shade, pack, -0.17, 0, -0.14)
    this.mesh(tankGeo, this.mat.shade, pack, 0.17, 0, -0.14)
    this.mesh(this.geo(new THREE.BoxGeometry(0.06, 0.06, 0.04)), this.mat.lightOrange, pack, 0.14, 0.22, -0.12)
    this.body.add(pack)
  }

  private buildArms(): void {
    const padGeo = this.geo(new THREE.IcosahedronGeometry(0.13, 0))
    const armGeo = this.geo(new THREE.CylinderGeometry(0.085, 0.08, 0.4, 6))
    const stripeGeo = this.geo(new THREE.CylinderGeometry(0.092, 0.092, 0.05, 6))
    const gloveGeo = this.geo(new THREE.IcosahedronGeometry(0.095, 0))

    for (const [arm, side] of [
      [this.leftArm, -1],
      [this.rightArm, 1],
    ] as const) {
      arm.name = side < 0 ? 'leftArm' : 'rightArm'
      arm.position.set(0.38 * side, 1.15, 0)
      // Inner group tilts the arm slightly away from the body; the pivot's
      // X rotation (swing/reach) is applied on the outer group.
      const tilt = new THREE.Group()
      tilt.rotation.z = 0.12 * side
      this.mesh(padGeo, this.mat.suit, tilt, 0, 0, 0)
      this.mesh(armGeo, this.mat.suit, tilt, 0, -0.22, 0)
      this.mesh(stripeGeo, this.mat.accent, tilt, 0, -0.12, 0)
      this.mesh(gloveGeo, this.mat.shade, tilt, 0, -0.46, 0)
      arm.add(tilt)
      this.body.add(arm)
    }
  }

  private buildHead(): void {
    this.head.name = 'head'
    this.head.position.set(0, 1.28, 0)

    this.mesh(this.geo(new THREE.IcosahedronGeometry(0.3, 1)), this.mat.suit, this.head, 0, 0.24, 0)

    // Visor: a slice of a sphere facing +Z, poking out of the helmet front.
    const visorGeo = this.geo(
      new THREE.SphereGeometry(0.25, 8, 5, Math.PI / 2 - 0.85, 1.7, 0.85, 1.05),
    )
    this.mesh(visorGeo, this.mat.visor, this.head, 0, 0.24, 0.075)

    // Ear discs.
    const earGeo = this.geo(new THREE.CylinderGeometry(0.075, 0.075, 0.05, 8))
    for (const side of [-1, 1]) {
      const ear = this.mesh(earGeo, this.mat.shade, this.head, 0.29 * side, 0.24, 0)
      ear.rotation.z = Math.PI / 2
    }

    // Antenna on one side gives the silhouette some asymmetry.
    this.mesh(this.geo(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 4)), this.mat.dark, this.head, 0.17, 0.5, -0.05)
    this.mesh(this.geo(new THREE.IcosahedronGeometry(0.035, 0)), this.mat.lightOrange, this.head, 0.17, 0.62, -0.05)

    this.body.add(this.head)
  }

  // ---------------------------------------------------------------------------
  // Helpers (track resources for dispose)
  // ---------------------------------------------------------------------------

  private material(params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ flatShading: true, ...params })
    this.materials.push(material)
    return material
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry)
    return geometry
  }

  private mesh(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set(x, y, z)
    parent.add(mesh)
    return mesh
  }
}

import {
  AmbientLight, BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, Group,
  Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, Plane,
  PlaneGeometry, Scene, Vector3, Vector4, WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { DecodedMesh } from './binary-stl.ts'
import type { CaseController, CaseState, ComparisonPair } from './case-controller.ts'
import { differenceRegions } from './plan-difference-panel.ts'
import type { ResectionPlane } from './plane.ts'

const removedColour = 0xe38558
const remainingColour = 0x50a89f
const localZ = new Vector3(0, 0, 1)

function geometryFor(mesh: DecodedMesh): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

function setRemovalEquation(equation: Vector4, plane: ResectionPlane) {
  const { pointMm: [px, py, pz], unitNormal: [x, y, z], resectSide } = plane
  const sign = resectSide === 'positive' ? 1 : -1
  equation.set(sign * x, sign * y, sign * z, -sign * (x * px + y * py + z * pz))
}

function enableComparisonShader(material: MeshStandardMaterial, planeA: Vector4, planeB: Vector4) {
  const uniforms = {
    comparisonPlaneA: { value: planeA },
    comparisonPlaneB: { value: planeB },
    comparisonOnlyA: { value: new Color(differenceRegions.removedOnlyByAMl.colour) },
    comparisonOnlyB: { value: new Color(differenceRegions.removedOnlyByBMl.colour) },
    comparisonRemoved: { value: new Color(differenceRegions.removedByBothMl.colour) },
    comparisonRetained: { value: new Color(differenceRegions.retainedByBothMl.colour) },
  }
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = `varying vec3 comparisonWorldPosition;\n` + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\ncomparisonWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    )
    shader.fragmentShader = /* glsl */`
      varying vec3 comparisonWorldPosition;
      uniform vec4 comparisonPlaneA, comparisonPlaneB;
      uniform vec3 comparisonOnlyA, comparisonOnlyB, comparisonRemoved, comparisonRetained;
    ` + shader.fragmentShader.replace('#include <color_fragment>', /* glsl */`
      #include <color_fragment>
      vec4 comparisonPosition = vec4(comparisonWorldPosition, 1.0);
      bool removedByA = dot(comparisonPlaneA, comparisonPosition) > 0.0;
      bool removedByB = dot(comparisonPlaneB, comparisonPosition) > 0.0;
      diffuseColor.rgb = removedByA
        ? (removedByB ? comparisonRemoved : comparisonOnlyA)
        : (removedByB ? comparisonOnlyB : comparisonRetained);
    `)
  }
}

export function createResectionScene(aspect = 1) {
  const scene = new Scene()
  const camera = new PerspectiveCamera(42, aspect, 0.1, 1000)
  const target = new Vector3()
  const anatomy = new Group()
  scene.add(anatomy, new AmbientLight(0xffffff, 1.4))
  const light = new DirectionalLight(0xffffff, 2.0)
  light.position.set(1, 2, 3)
  scene.add(light)

  const positivePlane = new Plane()
  const negativePlane = new Plane()
  const positiveMaterial = new MeshStandardMaterial({
    color: removedColour, clippingPlanes: [positivePlane], side: DoubleSide, transparent: true,
    opacity: 0.55, depthWrite: false, forceSinglePass: true,
  })
  const negativeMaterial = positiveMaterial.clone()
  negativeMaterial.clippingPlanes = [negativePlane]
  const comparisonMaterial = positiveMaterial.clone()
  comparisonMaterial.clippingPlanes = null
  const planeA = new Vector4()
  const planeB = new Vector4()
  enableComparisonShader(comparisonMaterial, planeA, planeB)
  const tumourMaterial = new MeshStandardMaterial({ color: 0xe54678, roughness: 0.7 })
  const overlayMaterial = new MeshBasicMaterial({
    color: 0x70c4f3, opacity: 0.19, transparent: true, side: DoubleSide, depthWrite: false,
  })
  const overlay = new Mesh(new PlaneGeometry(1, 1), overlayMaterial)
  overlay.name = 'resection-plane'
  overlay.visible = false
  scene.add(overlay)

  let selectionToken: number | undefined
  let liverGeometry: BufferGeometry | undefined
  let tumourGeometry: BufferGeometry | undefined
  let positiveMesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined
  let negativeMesh: Mesh<BufferGeometry, MeshStandardMaterial> | undefined
  let comparisonPair: ComparisonPair | undefined
  let showComparison = false
  let showOverlay = true
  let revision: number | undefined

  function clearCase() {
    anatomy.clear()
    liverGeometry?.dispose()
    tumourGeometry?.dispose()
    liverGeometry = tumourGeometry = undefined
    positiveMesh = negativeMesh = undefined
    comparisonPair = undefined
    selectionToken = revision = undefined
    overlay.visible = false
  }

  function updateMode() {
    const comparing = showComparison && comparisonPair !== undefined
    if (positiveMesh && negativeMesh) {
      positiveMesh.material = comparing ? comparisonMaterial : positiveMaterial
      negativeMesh.visible = !comparing
    }
    overlay.visible = showOverlay && !comparing && selectionToken !== undefined
  }

  function update(state: CaseState): boolean {
    if (state.status !== 'ready') {
      if (selectionToken !== undefined) clearCase()
      return false
    }

    const newCase = selectionToken !== state.selectionToken
    if (newCase) {
      clearCase()
      liverGeometry = geometryFor(state.liver)
      tumourGeometry = geometryFor(state.tumour)
      positiveMesh = new Mesh(liverGeometry, positiveMaterial)
      negativeMesh = new Mesh(liverGeometry, negativeMaterial)
      const tumour = new Mesh(tumourGeometry, tumourMaterial)
      positiveMesh.name = 'liver-positive'
      negativeMesh.name = 'liver-negative'
      tumour.name = 'tumour'
      anatomy.add(positiveMesh, negativeMesh, tumour)

      const min = new Vector3(...state.liver.bounds.min)
      const max = new Vector3(...state.liver.bounds.max)
      target.copy(min).lerp(max, 0.5)
      const radius = Math.max(1, min.distanceTo(max) / 2)
      const halfVertical = camera.fov * Math.PI / 360
      const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect)
      const distance = radius * 1.15 / Math.sin(Math.min(halfHorizontal, halfVertical))
      camera.position.set(0.65, 0.45, 1).setLength(distance).add(target)
      camera.near = Math.max(0.01, radius / 100)
      camera.far = distance + 20 * radius
      camera.lookAt(target)
      camera.updateProjectionMatrix()
      overlay.scale.set(2.4 * radius, 2.4 * radius, 1)
      selectionToken = state.selectionToken
    }

    if (revision !== state.revision) {
      const { pointMm, unitNormal, resectSide } = state.plane
      const normal = new Vector3(...unitNormal)
      const point = new Vector3(...pointMm)
      positivePlane.setFromNormalAndCoplanarPoint(normal, point)
      negativePlane.copy(positivePlane).negate()
      positiveMaterial.color.setHex(resectSide === 'positive' ? removedColour : remainingColour)
      negativeMaterial.color.setHex(resectSide === 'negative' ? removedColour : remainingColour)
      overlay.position.copy(point)
      overlay.quaternion.setFromUnitVectors(localZ, normal)
      revision = state.revision
    }
    const pair = state.comparison.status === 'idle' ? undefined : state.comparison.pair
    if (pair && pair !== comparisonPair) {
      setRemovalEquation(planeA, pair[0].plane)
      setRemovalEquation(planeB, pair[1].plane)
    }
    comparisonPair = pair
    updateMode()
    return newCase
  }

  return {
    scene, camera, target, update,
    setPlaneVisible(visible: boolean) {
      showOverlay = visible
      updateMode()
    },
    setComparisonVisible(visible: boolean) {
      if (showComparison === visible) return false
      showComparison = visible
      updateMode()
      return true
    },
    setLiverOpacity(opacity: number) {
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        throw new RangeError('Liver opacity must be between 0 and 1.')
      }
      for (const material of [positiveMaterial, negativeMaterial, comparisonMaterial]) {
        material.opacity = opacity
        const transparent = opacity < 1
        if (material.transparent !== transparent) {
          material.transparent = transparent
          material.depthWrite = !transparent
          material.needsUpdate = true
        }
      }
    },
    dispose() {
      clearCase()
      overlay.geometry.dispose()
      overlayMaterial.dispose()
      positiveMaterial.dispose()
      negativeMaterial.dispose()
      comparisonMaterial.dispose()
      tumourMaterial.dispose()
    },
  }
}

export function mountResectionViewer(container: HTMLElement, controller: Pick<CaseController, 'subscribe'>) {
  const width = Math.max(1, container.clientWidth)
  const height = Math.max(1, container.clientHeight)
  const renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.localClippingEnabled = true
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(width, height)
  container.append(renderer.domElement)

  const view = createResectionScene(width / height)
  const controls = new OrbitControls(view.camera, renderer.domElement)
  let frame: number | undefined
  function requestRender() {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      renderer.render(view.scene, view.camera)
    })
  }
  controls.addEventListener('change', requestRender)
  const unsubscribe = controller.subscribe(state => {
    if (view.update(state)) {
      controls.target.copy(view.target)
      controls.update()
      controls.saveState()
    }
    requestRender()
  })
  const observer = new ResizeObserver(() => {
    const width = Math.max(1, container.clientWidth)
    const height = Math.max(1, container.clientHeight)
    view.camera.aspect = width / height
    view.camera.updateProjectionMatrix()
    renderer.setSize(width, height)
    requestRender()
  })
  observer.observe(container)

  return {
    setPlaneVisible(visible: boolean) { view.setPlaneVisible(visible); requestRender() },
    setComparisonVisible(visible: boolean) { if (view.setComparisonVisible(visible)) requestRender() },
    setLiverOpacity(opacity: number) { view.setLiverOpacity(opacity); requestRender() },
    dispose() {
      unsubscribe()
      observer.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
      controls.removeEventListener('change', requestRender)
      controls.dispose()
      view.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    },
  }
}

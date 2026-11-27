import type { DecodedMesh } from './binary-stl.ts'
import type { CaseController } from './case-controller.ts'
import type { Vec3 } from './case-contract.ts'
import type { ResectionPlane } from './plane.ts'

const angleLimit = 45
const radiansPerDegree = Math.PI / 180
const readoutFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2, useGrouping: false })

export const PLANE_PRESETS = {
  'negative-offset': { label: 'Negative offset', offsetFraction: -0.6, angleDeg: -10 },
  'centre-tilt': { label: 'Centre tilt', offsetFraction: 0, angleDeg: 8 },
  'positive-offset': { label: 'Positive offset', offsetFraction: 0.6, angleDeg: 14 },
} as const

export type PlanePreset = keyof typeof PLANE_PRESETS

type PlaneGeometry = { centre: Vec3; offsetLimitMm: number }

export function planeGeometry({ min, max }: DecodedMesh['bounds']): PlaneGeometry {
  return {
    centre: [min[0] / 2 + max[0] / 2, min[1] / 2 + max[1] / 2, min[2] / 2 + max[2] / 2],
    offsetLimitMm: Math.ceil(max[0] / 2 - min[0] / 2),
  }
}

export function pointAtOffset(geometry: PlaneGeometry, offsetMm: number): Vec3 {
  if (!Number.isInteger(offsetMm) || Math.abs(offsetMm) > geometry.offsetLimitMm) {
    throw new RangeError('Plane offset must be a whole millimetre within the case range.')
  }
  const [x, y, z] = geometry.centre
  return [x + offsetMm, y, z]
}

export function normalAtAngle(angleDeg: number): Vec3 {
  if (!Number.isInteger(angleDeg) || Math.abs(angleDeg) > angleLimit) {
    throw new RangeError('Plane angle must be a whole degree from -45 to +45.')
  }
  const angle = angleDeg * radiansPerDegree
  return [Math.cos(angle), Math.sin(angle), 0]
}

export function defaultPlane(bounds: DecodedMesh['bounds']): ResectionPlane {
  return { pointMm: planeGeometry(bounds).centre, unitNormal: [1, 0, 0], resectSide: 'positive' }
}

export function presetPlane(
  bounds: DecodedMesh['bounds'], preset: PlanePreset, resectSide: ResectionPlane['resectSide'],
): ResectionPlane {
  const geometry = planeGeometry(bounds)
  const { offsetFraction, angleDeg } = PLANE_PRESETS[preset]
  const offsetMm = Math.round(offsetFraction * geometry.offsetLimitMm)
  return { pointMm: pointAtOffset(geometry, offsetMm), unitNormal: normalAtAngle(angleDeg), resectSide }
}

function signedReadout(value: number): string {
  const magnitude = readoutFormat.format(Math.abs(value))
  const sign = magnitude === '0' ? '' : value < 0 ? '−' : '+'
  return sign + magnitude
}

export function planeReadouts(bounds: DecodedMesh['bounds'], plane: ResectionPlane) {
  const { centre, offsetLimitMm } = planeGeometry(bounds)
  const offsetMm = plane.pointMm[0] - centre[0]
  const angleDeg = Math.atan2(plane.unitNormal[1], plane.unitNormal[0]) / radiansPerDegree
  return {
    offsetMm,
    angleDeg,
    offsetLimitMm,
    angleLimitDeg: angleLimit,
    offsetText: `${signedReadout(offsetMm)} mm`,
    angleText: `${signedReadout(angleDeg)}°`,
  }
}

export type PlaneControlElements = {
  offset: HTMLInputElement
  angle: HTMLInputElement
  offsetReadout: HTMLElement
  angleReadout: HTMLElement
  flip: HTMLButtonElement
  reset: HTMLButtonElement
  presets: Record<PlanePreset, HTMLButtonElement>
}

export function bindPlaneControls(controller: CaseController, elements: PlaneControlElements): () => void {
  const { offset, angle, offsetReadout, angleReadout, flip, reset, presets } = elements
  offset.type = angle.type = 'range'
  flip.type = reset.type = 'button'
  offset.step = angle.step = '1'
  offset.setAttribute('aria-label', 'Plane Offset')
  angle.setAttribute('aria-label', 'Plane Angle')
  const listeners = new AbortController()
  const options = { signal: listeners.signal }
  offset.addEventListener('input', () => controller.setPlaneOffset(offset.valueAsNumber), options)
  angle.addEventListener('input', () => controller.setPlaneAngle(angle.valueAsNumber), options)
  flip.addEventListener('click', () => controller.flipResectSide(), options)
  reset.addEventListener('click', () => controller.resetPlane(), options)
  for (const preset of Object.keys(PLANE_PRESETS) as PlanePreset[]) {
    presets[preset].type = 'button'
    presets[preset].textContent = PLANE_PRESETS[preset].label
    presets[preset].addEventListener('click', () => controller.applyPlanePreset(preset), options)
  }

  const unsubscribe = controller.subscribe(state => {
    const ready = state.status === 'ready'
    offset.disabled = angle.disabled = flip.disabled = reset.disabled = !ready
    for (const button of Object.values(presets)) button.disabled = !ready
    if (!ready) {
      offsetReadout.textContent = angleReadout.textContent = ''
      offset.removeAttribute('aria-valuetext')
      angle.removeAttribute('aria-valuetext')
      return
    }

    const view = planeReadouts(state.liver.bounds, state.plane)
    offset.min = String(-view.offsetLimitMm)
    offset.max = String(view.offsetLimitMm)
    angle.min = String(-view.angleLimitDeg)
    angle.max = String(view.angleLimitDeg)
    offset.value = String(view.offsetMm)
    angle.value = String(view.angleDeg)
    offsetReadout.textContent = view.offsetText
    angleReadout.textContent = view.angleText
    offset.setAttribute('aria-valuetext', view.offsetText)
    angle.setAttribute('aria-valuetext', view.angleText)
  })
  return () => {
    unsubscribe()
    listeners.abort()
  }
}

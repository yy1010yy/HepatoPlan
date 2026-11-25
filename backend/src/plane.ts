import type { Vec3 } from './case-contract.ts'

export type ResectionPlane = {
  readonly pointMm: Vec3
  readonly unitNormal: Vec3
  readonly resectSide: 'positive' | 'negative'
}

export function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3
    && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2])
}

export function normalisePlane(input: unknown): ResectionPlane {
  if (typeof input !== 'object' || input === null) {
    throw new TypeError('Plane must provide a point, normal, and removal side.')
  }
  const { pointMm, unitNormal, resectSide } = input as Partial<ResectionPlane>
  if (!isFiniteVec3(pointMm)) throw new TypeError('Plane point must have three finite coordinates.')
  if (!isFiniteVec3(unitNormal)) throw new TypeError('Plane normal must have three finite coordinates.')
  if (resectSide !== 'positive' && resectSide !== 'negative') {
    throw new TypeError('Plane removal side must be positive or negative.')
  }

  const [x, y, z] = unitNormal
  if (Math.abs(Math.hypot(x, y, z) - 1) <= Number.EPSILON) {
    return { pointMm: [...pointMm], unitNormal: [...unitNormal], resectSide }
  }
  const scale = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  if (scale === 0) throw new RangeError('Plane normal must be nonzero.')
  // Scaling first keeps normalization stable at either end of the finite number range.
  const scaled = [x / scale, y / scale, z / scale] as const
  const length = Math.hypot(...scaled)
  return {
    pointMm: [...pointMm],
    unitNormal: [scaled[0] / length, scaled[1] / length, scaled[2] / length],
    resectSide,
  }
}

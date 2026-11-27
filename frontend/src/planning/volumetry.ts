import type { CaseMetadata, Vec3 } from './case-contract.ts'
import { isFiniteVec3, normalisePlane } from './plane.ts'
import type { ResectionPlane } from './plane.ts'

export type VolumetryResult = {
  readonly totalParenchymaMl: number
  readonly resectedMl: number
  readonly remainingMl: number
  readonly flrPercent: number
  readonly resectedPercent: number
  readonly tumourIntersectsPlane: boolean
  readonly tumourPlaneDistanceMm: number
}

export type PlanDifferenceResult = {
  readonly removedOnlyByAMl: number
  readonly removedOnlyByBMl: number
  readonly removedByBothMl: number
  readonly retainedByBothMl: number
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export class PreparedCase {
  readonly #voxelVolumeMm3: number
  readonly #labels: Uint8Array
  readonly #dimensions: Vec3
  readonly #columns: readonly [Vec3, Vec3, Vec3]
  readonly #translation: Vec3
  readonly #labelCounts: Readonly<CaseMetadata['labelCounts']>

  constructor(metadata: CaseMetadata, labels: Uint8Array) {
    const { dimensions, voxelSpacingMm, voxelToWorldMm, labelCounts } = metadata
    if (!isFiniteVec3(dimensions) || !dimensions.every(n => Number.isSafeInteger(n) && n > 0)) {
      throw new RangeError('Case dimensions must be three positive integers.')
    }
    const [nx, ny, nz] = dimensions
    const voxelCount = nx * ny * nz
    if (!(labels instanceof Uint8Array) || !Number.isSafeInteger(voxelCount) || labels.length !== voxelCount) {
      throw new RangeError('Label buffer length must match the case dimensions.')
    }
    if (!isFiniteVec3(voxelSpacingMm) || !voxelSpacingMm.every(n => n > 0)) {
      throw new RangeError('Case voxel spacing must be positive and finite.')
    }
    if (!Array.isArray(voxelToWorldMm) || voxelToWorldMm.length !== 4) {
      throw new TypeError('Case affine must be a finite 4 by 4 matrix.')
    }
    const [x, y, z, w] = voxelToWorldMm
    for (const row of [x, y, z, w]) {
      if (!Array.isArray(row) || row.length !== 4
          || ![row[0], row[1], row[2], row[3]].every(Number.isFinite)) {
        throw new TypeError('Case affine must be a finite 4 by 4 matrix.')
      }
    }
    if (w[0] !== 0 || w[1] !== 0 || w[2] !== 0 || w[3] !== 1) {
      throw new TypeError('Case affine must end with [0, 0, 0, 1].')
    }
    const determinant = x[0] * (y[1] * z[2] - y[2] * z[1])
      - x[1] * (y[0] * z[2] - y[2] * z[0])
      + x[2] * (y[0] * z[1] - y[1] * z[0])
    const voxelVolumeMm3 = Math.abs(determinant)
    if (!Number.isFinite(voxelVolumeMm3) || voxelVolumeMm3 === 0) {
      throw new RangeError('Case affine must have a finite, nonzero spatial determinant.')
    }

    const mask = new Uint8Array(labels)
    let parenchyma = 0
    let tumour = 0
    for (const label of mask) {
      if (label === 1) parenchyma++
      else if (label === 2) tumour++
      else if (label !== 0) throw new RangeError(`Invalid mask label ${label}.`)
    }
    if (parenchyma === 0 || tumour === 0) {
      throw new RangeError('Case mask must contain both parenchyma and tumour voxels.')
    }
    if (labelCounts?.parenchyma !== parenchyma || labelCounts?.tumour !== tumour) {
      throw new RangeError('Case metadata label counts do not match the mask.')
    }
    if (!Number.isFinite(parenchyma * (voxelVolumeMm3 / 1000)) || voxelVolumeMm3 / 1000 === 0) {
      throw new RangeError('Case volume is outside the supported numeric range.')
    }

    this.#labels = mask
    this.#dimensions = [nx, ny, nz]
    this.#columns = [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]
    this.#translation = [x[3], y[3], z[3]]
    this.#labelCounts = Object.freeze({ parenchyma, tumour })
    this.#voxelVolumeMm3 = voxelVolumeMm3
  }

  get voxelVolumeMm3(): number {
    return this.#voxelVolumeMm3
  }

  get labelCounts(): Readonly<CaseMetadata['labelCounts']> {
    return this.#labelCounts
  }

  #projectPlane(planeInput: ResectionPlane) {
    const { pointMm, unitNormal, resectSide } = normalisePlane(planeInput)
    const [a0, a1, a2] = this.#columns
    const [tx, ty, tz] = this.#translation
    const [nx, ny, nz] = this.#dimensions
    const stepI = dot(unitNormal, a0)
    const stepJ = dot(unitNormal, a1)
    const stepK = dot(unitNormal, a2)
    const offset = dot(unitNormal, [tx - pointMm[0], ty - pointMm[1], tz - pointMm[2]])
    const halfWidth = 0.5 * Math.abs(stepI) + 0.5 * Math.abs(stepJ) + 0.5 * Math.abs(stepK)
    const distanceBound = Math.abs(offset) + Math.abs(stepI) * (nx - 1)
      + Math.abs(stepJ) * (ny - 1) + Math.abs(stepK) * (nz - 1)
    if (!Number.isFinite(distanceBound) || !Number.isFinite(halfWidth)) {
      throw new RangeError('Plane distances are outside the supported numeric range.')
    }

    return { offset, stepI, stepJ, stepK, halfWidth, sideSign: resectSide === 'positive' ? 1 : -1 }
  }

  evaluate(planeInput: ResectionPlane): VolumetryResult {
    const { offset, stepI, stepJ, stepK, halfWidth, sideSign } = this.#projectPlane(planeInput)
    const [nx, ny, nz] = this.#dimensions
    let resected = 0
    let closestTumourCentreMm = Infinity
    let index = 0
    for (let i = 0; i < nx; i++) {
      const sliceOffset = offset + stepI * i
      for (let j = 0; j < ny; j++) {
        const rowOffset = sliceOffset + stepJ * j
        for (let k = 0; k < nz; k++, index++) {
          const label = this.#labels[index]
          if (label === 0) continue
          const distance = rowOffset + stepK * k
          if (label === 1) {
            if (sideSign * distance > 0) resected++
          } else {
            closestTumourCentreMm = Math.min(closestTumourCentreMm, Math.abs(distance))
          }
        }
      }
    }

    const { parenchyma } = this.#labelCounts
    const remaining = parenchyma - resected
    const voxelMl = this.#voxelVolumeMm3 / 1000
    return {
      totalParenchymaMl: parenchyma * voxelMl,
      resectedMl: resected * voxelMl,
      remainingMl: remaining * voxelMl,
      flrPercent: remaining / parenchyma * 100,
      resectedPercent: resected / parenchyma * 100,
      tumourIntersectsPlane: closestTumourCentreMm <= halfWidth,
      tumourPlaneDistanceMm: Math.max(0, closestTumourCentreMm - halfWidth),
    }
  }

  compare(planeA: ResectionPlane, planeB: ResectionPlane): PlanDifferenceResult {
    const a = this.#projectPlane(planeA)
    const b = this.#projectPlane(planeB)
    const [nx, ny, nz] = this.#dimensions
    // Index bits record removal by A and B, respectively.
    const counts = [0, 0, 0, 0]
    let index = 0
    for (let i = 0; i < nx; i++) {
      const sliceA = a.offset + a.stepI * i
      const sliceB = b.offset + b.stepI * i
      for (let j = 0; j < ny; j++) {
        const rowA = sliceA + a.stepJ * j
        const rowB = sliceB + b.stepJ * j
        for (let k = 0; k < nz; k++, index++) {
          if (this.#labels[index] !== 1) continue
          const removedA = a.sideSign * (rowA + a.stepK * k) > 0
          const removedB = b.sideSign * (rowB + b.stepK * k) > 0
          counts[Number(removedA) + 2 * Number(removedB)]++
        }
      }
    }

    const voxelMl = this.#voxelVolumeMm3 / 1000
    return {
      removedOnlyByAMl: counts[1] * voxelMl,
      removedOnlyByBMl: counts[2] * voxelMl,
      removedByBothMl: counts[3] * voxelMl,
      retainedByBothMl: counts[0] * voxelMl,
    }
  }
}

export function comparePlans(preparedCase: PreparedCase, planeA: ResectionPlane, planeB: ResectionPlane): PlanDifferenceResult {
  return preparedCase.compare(planeA, planeB)
}

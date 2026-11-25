import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { CaseMetadata, Vec3 } from '../src/case-contract.ts'
import { normalisePlane } from '../src/plane.ts'
import type { ResectionPlane } from '../src/plane.ts'
import { PreparedCase } from '../src/volumetry.ts'

const identity: CaseMetadata['voxelToWorldMm'] = [
  [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1],
]

function fixture(dimensions: Vec3, labelAt: (i: number, j: number, k: number) => number,
    affine = identity) {
  const [nx, ny, nz] = dimensions
  const labels = new Uint8Array(nx * ny * nz)
  let parenchyma = 0
  let tumour = 0
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {
        const label = labelAt(i, j, k)
        labels[(i * ny + j) * nz + k] = label
        if (label === 1) parenchyma++
        if (label === 2) tumour++
      }
    }
  }
  const metadata: CaseMetadata = {
    schemaVersion: 1, releaseId: 'test', caseId: 'case-001', dimensions,
    voxelSpacingMm: [
      Math.hypot(affine[0][0], affine[1][0], affine[2][0]),
      Math.hypot(affine[0][1], affine[1][1], affine[2][1]),
      Math.hypot(affine[0][2], affine[1][2], affine[2][2]),
    ],
    voxelToWorldMm: affine, labelCounts: { parenchyma, tumour },
  }
  return { metadata, labels }
}

function cube() {
  return fixture([5, 4, 4], (i, j, k) => i < 4 ? 1 : (j === 0 && k === 0 ? 2 : 0))
}

function xPlane(x: number, resectSide: ResectionPlane['resectSide'] = 'positive'): ResectionPlane {
  return { pointMm: [x, 0, 0], unitNormal: [1, 0, 0], resectSide }
}

function close(actual: number, expected: number, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${expected}, got ${actual}`)
}

test('plane validation normalizes safely and rejects invalid input', () => {
  for (const scale of [1, Number.MIN_VALUE, Number.MAX_VALUE]) {
    const plane = normalisePlane({ ...xPlane(0), unitNormal: [scale, scale, 0] })
    close(plane.unitNormal[0], Math.SQRT1_2)
    close(plane.unitNormal[1], Math.SQRT1_2)
    close(Math.hypot(...plane.unitNormal), 1)
  }
  assert.throws(() => normalisePlane(null), /Plane must provide/)
  assert.throws(() => normalisePlane({ ...xPlane(0), unitNormal: [0, 0, 0] }), /nonzero/)
  assert.throws(() => normalisePlane({ ...xPlane(0), unitNormal: [1, Infinity, 0] }), /normal.*finite/)
  assert.throws(() => normalisePlane({ ...xPlane(0), pointMm: [0, NaN, 0] }), /point.*finite/)
  assert.throws(() => normalisePlane({ ...xPlane(0), resectSide: 'left' }), /removal side/)
})

test('case preparation rejects corrupt shapes, labels, counts, and geometry', () => {
  const { metadata, labels } = cube()
  assert.throws(() => new PreparedCase({ ...metadata, dimensions: [5, 0, 4] }, labels), /dimensions/)
  assert.throws(() => new PreparedCase(metadata, labels.subarray(1)), /buffer length/)
  assert.throws(() => new PreparedCase({ ...metadata, voxelSpacingMm: [1, -1, 1] }, labels), /spacing/)
  assert.throws(() => new PreparedCase({ ...metadata, labelCounts: { parenchyma: 64, tumour: 2 } }, labels), /counts/)
  assert.throws(() => new PreparedCase({ ...metadata, voxelToWorldMm: [
    [1, 0, 0, NaN], identity[1], identity[2], identity[3],
  ] }, labels), /finite 4 by 4/)
  assert.throws(() => new PreparedCase({ ...metadata, voxelToWorldMm: [
    identity[0], identity[0], identity[2], identity[3],
  ] }, labels), /determinant/)
  assert.throws(() => new PreparedCase({ ...metadata, voxelToWorldMm: [
    identity[0], identity[1], identity[2], [1, 0, 0, 1],
  ] }, labels), /must end/)
  labels[0] = 3
  assert.throws(() => new PreparedCase(metadata, labels), /Invalid mask label 3/)
  labels.fill(1)
  assert.throws(() => new PreparedCase(metadata, labels), /both parenchyma and tumour/)
})

test('cube volumes conserve parenchyma across half, quarter, extreme and tied cuts', () => {
  const { metadata, labels } = cube()
  const prepared = new PreparedCase(metadata, labels)
  assert.equal(prepared.voxelVolumeMm3, 1)
  assert.deepEqual(prepared.labelCounts, { parenchyma: 64, tumour: 1 })
  for (const [plane, removed] of [
    [xPlane(1.5), 32], [xPlane(2.5), 16], [xPlane(-1), 64], [xPlane(5), 0],
    [xPlane(2.5, 'negative'), 48], [xPlane(1), 32], [xPlane(1, 'negative'), 16],
  ] as const) {
    const result = prepared.evaluate(plane)
    close(result.totalParenchymaMl, 0.064)
    close(result.resectedMl, removed / 1000)
    close(result.remainingMl, (64 - removed) / 1000)
    close(result.resectedMl + result.remainingMl, result.totalParenchymaMl)
    close(result.resectedPercent, removed / 64 * 100)
    close(result.flrPercent + result.resectedPercent, 100)
  }
  const before = prepared.evaluate(xPlane(1.5))
  labels.fill(0)
  assert.deepEqual(prepared.evaluate(xPlane(1.5)), before)
})

test('voxelized sphere agrees with independently counted sections and analytic bounds', () => {
  const radius = 6
  const centre = 7
  const { metadata, labels } = fixture([16, 16, 16], (i, j, k) => {
    if (i === 15 && j === 0 && k === 0) return 2
    return Number((i - centre) ** 2 + (j - centre) ** 2 + (k - centre) ** 2 <= radius ** 2)
  })
  let discrete = 0
  let middle = 0
  for (let dx = -radius; dx <= radius; dx++) {
    const yLimit = Math.floor(Math.sqrt(radius ** 2 - dx ** 2))
    for (let dy = -yLimit; dy <= yLimit; dy++) {
      const section = 2 * Math.floor(Math.sqrt(radius ** 2 - dx ** 2 - dy ** 2)) + 1
      discrete += section
      if (dx === 0) middle += section
    }
  }
  const result = new PreparedCase(metadata, labels).evaluate(xPlane(centre))
  close(result.totalParenchymaMl, discrete / 1000)
  close(result.resectedMl, (discrete - middle) / 2000)
  // A unit voxel's half-diagonal bounds the boundary error on either side of the sphere.
  const analyticMl = (r: number) => 4 * Math.PI * r ** 3 / 3000
  assert.ok(result.totalParenchymaMl >= analyticMl(radius - Math.sqrt(3) / 2))
  assert.ok(result.totalParenchymaMl <= analyticMl(radius + Math.sqrt(3) / 2))
})

test('tumour distance accounts for face contact and a gap between lesions', () => {
  const { metadata, labels } = fixture([7, 1, 1], i => i === 1 || i === 5 ? 2 : 1)
  const prepared = new PreparedCase(metadata, labels)
  const touch = prepared.evaluate(xPlane(1.5))
  assert.equal(touch.tumourIntersectsPlane, true)
  assert.equal(touch.tumourPlaneDistanceMm, 0)
  const gap = prepared.evaluate(xPlane(3))
  const flipped = prepared.evaluate(xPlane(3, 'negative'))
  assert.equal(gap.tumourIntersectsPlane, false)
  close(gap.tumourPlaneDistanceMm, 1.5)
  assert.equal(flipped.tumourIntersectsPlane, gap.tumourIntersectsPlane)
  assert.equal(flipped.tumourPlaneDistanceMm, gap.tumourPlaneDistanceMm)
  assert.equal(prepared.evaluate(xPlane(5.25)).tumourIntersectsPlane, true)
})

test('oblique evaluation agrees with direct world coordinates on a reflected sheared grid', () => {
  const affine: CaseMetadata['voxelToWorldMm'] = [
    [-2, 1, 0, 10], [0, 3, 1, 20], [0, 0, 4, -5], [0, 0, 0, 1],
  ]
  const isTumour = (i: number, j: number, k: number) => i === 0 && j === 0 && k === 0
  const { metadata, labels } = fixture([3, 4, 2], (i, j, k) => isTumour(i, j, k) ? 2 : 1, affine)
  const prepared = new PreparedCase(metadata, labels)
  const plane: ResectionPlane = { pointMm: [11.1, 26.3, -1], unitNormal: [2, 3, -1], resectSide: 'positive' }
  const worldDistance = (i: number, j: number, k: number) => {
    const [x, y, z] = [10 - 2 * i + j, 20 + 3 * j + k, -5 + 4 * k]
    return (2 * (x - 11.1) + 3 * (y - 26.3) - (z + 1)) / Math.sqrt(14)
  }
  let expectedRemoved = 0
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 4; j++) {
      for (let k = 0; k < 2; k++) {
        if (!isTumour(i, j, k) && worldDistance(i, j, k) > 0) expectedRemoved++
      }
    }
  }
  const edges = [-0.5, 0.5]
  const extremes = edges.flatMap(i => edges.flatMap(j => edges.map(k => worldDistance(i, j, k))))
  const result = prepared.evaluate(plane)
  assert.equal(prepared.voxelVolumeMm3, 24)
  close(result.totalParenchymaMl, 23 * 24 / 1000)
  close(result.resectedMl, expectedRemoved * 24 / 1000)
  assert.equal(result.tumourIntersectsPlane, false)
  close(result.tumourPlaneDistanceMm, -Math.max(...extremes))
})

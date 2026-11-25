export type Vec3 = readonly [number, number, number]
type AffineRow = readonly [number, number, number, number]

export type CaseIndex = {
  schemaVersion: 1
  releaseId: string
  cases: readonly { caseId: string }[]
}

export type CaseMetadata = {
  schemaVersion: 1
  releaseId: string
  caseId: string
  dimensions: Vec3
  voxelSpacingMm: Vec3
  voxelToWorldMm: readonly [AffineRow, AffineRow, AffineRow, AffineRow]
  labelCounts: { parenchyma: number; tumour: number }
}

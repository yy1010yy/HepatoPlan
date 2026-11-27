import { randomUUID } from 'node:crypto'
import { loadCaseBundle, loadCaseIndex } from '../frontend/src/planning/case-loader.ts'
import { isAnalysisResponse } from '../frontend/src/planning/analysis-contract.ts'
import type { ComparisonAnalysisRequest, SingleAnalysisRequest } from '../frontend/src/planning/analysis-contract.ts'
import { normalAtAngle, planeGeometry, pointAtOffset } from '../frontend/src/planning/plane-controls.ts'
import { PreparedCase } from '../frontend/src/planning/volumetry.ts'
import type { ResectionPlane } from '../frontend/src/planning/plane.ts'

export async function measuredRequests(site: URL) {
  const catalog = await loadCaseIndex(new URL('cases/index.json', site))
  const { releaseId, cases } = catalog.index
  const caseId = cases.find(entry => entry.caseId === 'case-003')?.caseId ?? cases[0]?.caseId
  if (!caseId) throw new Error('The local app has no prepared cases.')
  const { metadata, labels, liver } = await loadCaseBundle(catalog, caseId)
  const prepared = new PreparedCase(metadata, new Uint8Array(labels))
  const geometry = planeGeometry(liver.bounds)
  const angleDeg = 8
  const resectSide = 'positive'
  const planeAt = (offsetMm: number): ResectionPlane => ({
    pointMm: pointAtOffset(geometry, offsetMm), unitNormal: normalAtAngle(angleDeg), resectSide,
  })
  const cutAt = (offsetMm: number): SingleAnalysisRequest['current'] => ({
    caseId, releaseId, offsetMm, angleDeg, resectSide, measurements: prepared.evaluate(planeAt(offsetMm)),
  })
  const steps = prepared.searchOffsets(planeAt(0), geometry.centre, geometry.offsetLimitMm, 0)
  let completed = steps.next()
  while (!completed.done) completed = steps.next()
  const result = completed.value
  const search = result.outcome === 'improvement'
    ? { ...result, alternative: cutAt(result.alternative.offsetMm) } : result
  const identity = { version: 2, caseId, releaseId } as const
  const single: SingleAnalysisRequest = {
    ...identity, requestId: randomUUID(), revision: 1, current: cutAt(0), search,
  }
  const offsetB = result.outcome === 'improvement' ? result.alternative.offsetMm : geometry.offsetLimitMm
  const comparison: ComparisonAnalysisRequest = {
    ...identity, requestId: randomUUID(), planAId: 'plan-1', planBId: 'plan-2',
    planA: single.current, planB: cutAt(offsetB), spatialStatus: 'ready',
    differenceVolumes: prepared.compare(planeAt(0), planeAt(offsetB)),
  }
  return { single, comparison }
}

if (import.meta.main) {
  const site = new URL(process.argv[2] ?? 'http://127.0.0.1:5173/')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(site.hostname)) {
    throw new Error('Use the local Vite development or preview URL.')
  }
  const { single, comparison } = await measuredRequests(site)
  for (const [path, body] of [
    ['/api/plans/explain', single], ['/api/plan-comparisons/explain', comparison],
  ] as const) {
    const response = await fetch(new URL(path, site), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}.`)
    const data: unknown = await response.json()
    if (!isAnalysisResponse(data, body)) throw new Error(`${path} returned an invalid analysis.`)
    console.log(`${path} returned a validated recommendation (${data.recommendation.action}).`)
  }
}

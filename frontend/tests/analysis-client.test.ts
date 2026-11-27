import assert from 'node:assert/strict'
import { test } from 'node:test'
import examples from '../../fixtures/plan-analysis-v2.json' with { type: 'json' }
import { AnalysisAttempt, comparisonAnalysisRequest, fetchAnalysis, singleAnalysisRequest } from '../src/planning/analysis-client.ts'
import type { CaseState } from '../src/planning/case-controller.ts'
import type { CaseMetadata } from '../src/planning/case-contract.ts'
import { normalAtAngle } from '../src/planning/plane-controls.ts'
import type { ResectionPlane } from '../src/planning/plane.ts'
import { isComparisonAnalysisRequest, isSingleAnalysisRequest } from '../src/planning/analysis-contract.ts'

const { single, comparison } = examples
const { caseId, releaseId } = single.request
const metadata: CaseMetadata = {
  caseId, releaseId, schemaVersion: 1, dimensions: [2, 1, 1], voxelSpacingMm: [1, 1, 1],
  voxelToWorldMm: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
  labelCounts: { tumour: 100, parenchyma: 100 },
}
const mesh = {
  positions: new Float32Array(0), bounds: { min: [-15, -1, -1], max: [15, 1, 1] } as const,
}
function plane({ offsetMm, angleDeg }: { offsetMm: number; angleDeg: number }): ResectionPlane {
  return { pointMm: [offsetMm, 0, 0], unitNormal: normalAtAngle(angleDeg), resectSide: 'positive' }
}
const measured = { ...single.request.current.measurements, leaked: 'never' }
const state: Extract<CaseState, { status: 'ready' }> = {
  status: 'ready', caseId, metadata, selectionToken: 1, revision: single.request.revision, liver: mesh, tumour: mesh,
  plane: plane(single.request.current), comparison: { status: 'idle' },
  measurements: { status: 'ready', result: measured },
}

function singleRequest() {
  return singleAnalysisRequest(state, {
    ...single.request.search, outcome: 'improvement', alternative: {
      offsetMm: single.request.search.alternative.offsetMm, plane: plane(single.request.search.alternative),
      result: single.request.search.alternative.measurements,
    },
  }, { reason: 'Compare remnant volume', procedureType: 'private text' })
}

function comparisonRequest() {
  const snapshot = (cut: typeof comparison.request.planA, id: string) => ({
    id,
    name: 'private name', notes: 'private notes', procedureType: 'custom procedure',
    caseId, releaseId, plane: plane(cut), result: cut.measurements,
  })
  return comparisonAnalysisRequest(state, [
    snapshot(comparison.request.planA, comparison.request.planAId),
    snapshot(comparison.request.planB, comparison.request.planBId),
  ], comparison.request.differenceVolumes)
}

test('analysis sends the exact allowlisted cut or ordered saved pair to the root API', async () => {
  const current = singleRequest()
  const pair = comparisonRequest()
  assert.deepEqual(current, {
    ...single.request, requestId: current.requestId,
    current: { ...single.request.current, context: { reason: 'Compare remnant volume' } },
  })
  assert.deepEqual(pair, { ...comparison.request, requestId: pair.requestId })
  assert.notEqual(current.requestId, singleRequest().requestId)
  assert(isSingleAnalysisRequest(current))
  assert(isComparisonAnalysisRequest(pair))
  assert.equal(pair.planA.measurements.tumourCentres, undefined)

  for (const [request, expectedPath, fixture] of [
    [current, '/api/plans/explain', single.response], [pair, '/api/plan-comparisons/explain', comparison.response],
  ] as const) {
    const signal = new AbortController().signal
    const expected = { ...fixture, requestId: request.requestId }
    const actual = await fetchAnalysis(request, signal, async (path, init) => {
      assert.equal(path, expectedPath)
      assert.equal(init?.signal, signal)
      assert.deepEqual(JSON.parse(String(init?.body)), request)
      return Response.json(expected)
    })
    assert.deepEqual(actual, expected)
  }
})

test('the analysis client rejects malformed, foreign and late replies even after another request starts', async () => {
  const attempt = new AnalysisAttempt()
  const previous = singleRequest()
  let respond!: (response: Response) => void
  const pending = fetchAnalysis(previous, attempt.start(), () => new Promise(resolve => { respond = resolve }))
  const next = comparisonRequest()
  const currentSignal = attempt.start()
  respond(Response.json({ ...single.response, requestId: previous.requestId }))
  await assert.rejects(pending, { name: 'AbortError' })
  await assert.rejects(fetchAnalysis(next, currentSignal, async () => Response.json({ explanation: 'stale' })), /does not match/)
  await assert.rejects(fetchAnalysis(next, currentSignal, async () => Response.json({
    ...comparison.response, requestId: next.requestId, planAId: next.planBId, planBId: next.planAId,
  })), /does not match/)

  let fail!: (response: Response) => void
  const staleFailure = fetchAnalysis(next, currentSignal, () => new Promise(resolve => { fail = resolve }))
  attempt.cancel()
  fail(Response.json({ error: 'provider_unavailable' }, { status: 502 }))
  await assert.rejects(staleFailure, { name: 'AbortError' })
})

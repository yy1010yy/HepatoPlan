import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { createAnalysisApp } from '../app.mts'
import { createGeminiProvider } from '../gemini.mts'
import type { ProviderInput } from '../gemini.mts'
import planHandler from '../plans/explain.ts'
import comparisonHandler from '../plan-comparisons/explain.ts'
import { isAnalysisResponse } from '../../frontend/src/planning/analysis-contract.ts'
import { isComparisonAnalysisRequest, isSingleAnalysisRequest } from '../../frontend/src/planning/analysis-contract.ts'
import fixture from '../../fixtures/plan-analysis-v2.json' with { type: 'json' }

const { single, comparison } = fixture
const singlePath = '/api/plans/explain'
const comparePath = '/api/plan-comparisons/explain'

async function listen(t: TestContext, app: ReturnType<typeof createAnalysisApp>) {
  const server = app.listen(0, '127.0.0.1')
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  await once(server, 'listening')
  const address = server.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

function serve(t: TestContext, options: Partial<Parameters<typeof createAnalysisApp>[0]> = {}) {
  return listen(t, createAnalysisApp({
    findTumourCount: (release, caseId) => release === 'demo-1' && caseId === 'case-002' ? 100 : undefined,
    log: () => {}, ...options,
  }))
}

function post(origin: string, path: string, input: unknown) {
  return fetch(new URL(path, origin), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  })
}

function geminiReply(selection: unknown) {
  return Response.json({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(selection) }] } }],
    usageMetadata: { promptTokenCount: 99, candidatesTokenCount: 12, thoughtsTokenCount: 3 },
  })
}

test('the Vercel entry points serve the published analysis URLs and validate requests', async t => {
  for (const [path, handler] of [[singlePath, planHandler], [comparePath, comparisonHandler]] as const) {
    const origin = await listen(t, handler)
    const wrongMethod = await fetch(new URL(path, origin))
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('Allow'), 'POST')
    const badRequest = await post(origin, path, {})
    assert.equal(badRequest.status, 400)
    assert.deepEqual(await badRequest.json(), { error: 'invalid_analysis_request' })
  }
})

test('both endpoints call Gemini with only approved evidence and return verified recommendations', async t => {
  const sent: string[] = []
  const lines: unknown[] = []
  const provider = createGeminiProvider('mock-key', undefined, async (url, init) => {
    assert.match(String(url), /gemini-3\.1-flash-lite:generateContent$/)
    assert.equal(new Headers(init?.headers).get('x-goog-api-key'), 'mock-key')
    const request = JSON.parse(String(init?.body))
    const input: ProviderInput = JSON.parse(request.contents[0].parts[0].text)
    sent.push(String(init?.body))
    assert.equal(request.generationConfig.responseMimeType, 'application/json')
    assert.deepEqual(request.generationConfig.responseJsonSchema.properties.findingId.enum, input.findings.map(f => f.id))
    const action = input.actions.find(a => a.id === (input.mode === 'single' ? 'preview_alternative' : 'open_plan_b'))
    assert(action)
    return geminiReply({
      findingId: input.findings[0].id, actionId: action.id,
      observationIds: input.requiredObservationIds, rationaleFactIds: action.rationaleFactIds,
    })
  })
  const origin = await serve(t, { provider, log: entry => lines.push(entry) })
  assert(isSingleAnalysisRequest(single.request))
  assert(isComparisonAnalysisRequest(comparison.request))
  for (const [path, request, action] of [
    [singlePath, single.request, 'preview_alternative'],
    [comparePath, comparison.request, 'open_plan_b'],
  ] as const) {
    const response = await post(origin, path, request)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')
    const data: unknown = await response.json()
    assert(isAnalysisResponse(data, request))
    assert.equal(data.recommendation.action, action)
  }
  assert.equal(sent.length, 2)
  for (const field of ['case-002', 'demo-1', 'requestId', 'plan-1', 'plan-2', 'mock-key', 'pointMm', 'unitNormal']) {
    assert(!sent.some(body => body.includes(field)))
  }
  assert.deepEqual(lines.map(line => Object.keys(line as object).sort()),
    Array.from({ length: 2 }, () => ['elapsedMs', 'inputTokens', 'mode', 'outputTokens', 'status']))
  assert.equal((lines[0] as { outputTokens: number }).outputTokens, 15)
})

test('rejected inputs never reach the provider and parser errors return JSON', async t => {
  let providerCalls = 0
  const origin = await serve(t, { provider: async () => { providerCalls++; throw new Error('unexpected') } })
  for (const fields of [{ name: 'old plan' }, { notes: 'arbitrary context' }, { file: 'CT.nii' },
    { current: { ...single.request.current, context: { reason: 'custom-text' } } }]) {
    const response = await post(origin, singlePath, { ...single.request, ...fields })
    assert.equal(response.status, 400)
    assert.deepEqual(await response.json(), { error: 'invalid_analysis_request', requestId: single.request.requestId })
  }
  const malformed = await fetch(origin + singlePath, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  })
  assert.equal(malformed.status, 400)
  assert.deepEqual(await malformed.json(), { error: 'invalid_json' })
  assert.equal((await post(origin, singlePath, { padding: 'x'.repeat(17000) })).status, 413)
  assert.equal((await fetch(origin + singlePath)).status, 405)
  assert.equal(providerCalls, 0)
})

test('provider failures map to quota, missing key, invalid output and timeout statuses', async t => {
  for (const [label, expected, code, send] of [
    ['missing key', 503, 'provider_not_configured'],
    ['quota', 429, 'provider_quota_exceeded', async () => new Response(null, { status: 429, headers: { 'Retry-After': '45' } })],
    ['upstream failure', 502, 'provider_unavailable', async () => new Response(null, { status: 503 })],
    ['blocked prompt', 502, 'provider_unavailable', async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } })],
    ['truncated output', 502, 'provider_unavailable', async () => Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] })],
    ['bad JSON', 502, 'provider_unavailable', async () => new Response('broken')],
    ['unsupported action', 502, 'invalid_provider_output', async () => geminiReply({
      findingId: 'b_retains_more', observationIds: ['exclusive_regions'],
      actionId: 'unsupported', rationaleFactIds: ['inspect_plan_b'],
    })],
    ['timeout', 504, 'provider_timeout', async (_url, init) => {
      const signal = init?.signal
      assert(signal)
      if (!signal.aborted) await once(signal, 'abort')
      throw signal.reason
    }],
  ] satisfies [string, number, string, (typeof fetch)?][]) {
    await t.test(label, async sub => {
      const origin = await serve(sub, { provider: send && createGeminiProvider('mock-key', undefined, send),
        deadlineMs: expected === 504 ? 20 : 10_000 })
      const response = await post(origin, comparePath, comparison.request)
      assert.equal(response.status, expected)
      assert.deepEqual(await response.json(), { error: code, requestId: comparison.request.requestId })
      if (expected === 429) assert.equal(response.headers.get('Retry-After'), '45')
    })
  }
})

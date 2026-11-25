import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CaseLoadError, loadCaseBundle, loadCaseIndex } from '../src/case-loader.ts'

const indexUrl = new URL('https://example.test/demo/cases/index.json')
const casePath = '/demo/cases/releases/demo-1/case-001/'
const index = { schemaVersion: 1, releaseId: 'demo-1', cases: [{ caseId: 'case-001' }] }
const metadata = {
  schemaVersion: 1, releaseId: 'demo-1', caseId: 'case-001',
  dimensions: [2, 1, 1], voxelSpacingMm: [2, 3, 4],
  voxelToWorldMm: [[-2, 0, 0, 7], [0, 3, 0, -5], [0, 0, 4, 10], [0, 0, 0, 1]],
  labelCounts: { parenchyma: 1, tumour: 1 },
}
const triangle = [7, -5, 10, 5, -2, 10, 7, -5, 14]

function stl() {
  const view = new DataView(new ArrayBuffer(134))
  view.setUint32(80, 1, true)
  triangle.forEach((value, component) => view.setFloat32(96 + component * 4, value, true))
  return view
}

test('index fetch revalidates and malformed or unavailable indexes can be retried', async t => {
  const responses = [
    new Response(null, { status: 503 }),
    new Response('{'),
    Response.json({ ...index, schemaVersion: 2 }),
    Response.json({ ...index, releaseId: '../other' }),
    Response.json({ ...index, cases: [...index.cases, ...index.cases] }),
    Response.json(index),
  ]
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.href, indexUrl.href)
    assert.equal(init.cache, 'no-cache')
    return responses.shift()!
  })
  await assert.rejects(loadCaseIndex(indexUrl), error =>
    error instanceof CaseLoadError && error.stage === 'index' && /HTTP 503/.test(error.message))
  for (let failure = 0; failure < 4; failure++) {
    await assert.rejects(loadCaseIndex(indexUrl), /Cannot load case index/)
  }
  assert.deepEqual((await loadCaseIndex(indexUrl)).index, index)
})

test('bundle resolves below the index subpath and fetches binary assets together', async t => {
  const pending = new Map<string, (response: Response) => void>()
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    if (url.pathname === indexUrl.pathname) return Response.json(index)
    if (url.pathname === casePath + 'metadata.json') return Response.json(metadata)
    return new Promise<Response>(resolve => { pending.set(url.pathname, resolve) })
  })
  const catalog = await loadCaseIndex(indexUrl)
  const load = loadCaseBundle(catalog, 'case-001')
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.deepEqual([...pending.keys()].sort(), ['labels.bin', 'liver.stl', 'tumour.stl'].map(name => casePath + name))
  pending.get(casePath + 'labels.bin')!(new Response(new Uint8Array([1, 2])))
  for (const name of ['liver.stl', 'tumour.stl']) {
    pending.get(casePath + name)!(new Response(stl().buffer))
  }
  const bundle = await load
  assert.deepEqual(bundle.metadata, metadata)
  assert.deepEqual([...new Uint8Array(bundle.labels)], [1, 2])
  assert.deepEqual([...bundle.liver.positions], triangle)
  assert.deepEqual(bundle.liver.bounds, { min: [5, -5, 10], max: [7, -2, 14] })
  assert.deepEqual(bundle.tumour, bundle.liver)
})

test('bundle rejects unknown cases and bad metadata before loading binaries', async t => {
  const requested: string[] = []
  const responses = [
    Response.json({ ...metadata, caseId: 'case-002' }),
    Response.json({ ...metadata, releaseId: 'demo-2' }),
    Response.json({ ...metadata, dimensions: [2, 0, 1] }),
    new Response(JSON.stringify(metadata).replace('[-2,0,0,7]', '[-2,0,0,1e999]')),
  ]
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    requested.push(url.pathname)
    return url.pathname === indexUrl.pathname ? Response.json(index) : responses.shift()!
  })
  const catalog = await loadCaseIndex(indexUrl)
  await assert.rejects(loadCaseBundle(catalog, 'case-unknown'), /absent from the release index/)
  for (let failure = 0; failure < 4; failure++) {
    await assert.rejects(loadCaseBundle(catalog, 'case-001'), /Cannot load case "case-001"/)
  }
  assert.deepEqual(requested, [indexUrl.pathname, ...Array(4).fill(casePath + 'metadata.json')])
})

test('bad binary assets yield bundle errors and leave the catalog available for retry', async t => {
  let mode = 'missing'
  t.mock.method(globalThis, 'fetch', async (url: URL) => {
    const name = url.pathname.split('/').at(-1)
    if (name === 'index.json') return Response.json(index)
    if (name === 'metadata.json') return Response.json(metadata)
    if (name === 'labels.bin') return new Response(mode === 'length' ? new Uint8Array([1]) : new Uint8Array([1, 2]))
    if (name === 'liver.stl') {
      if (mode === 'missing') return new Response(null, { status: 404 })
      if (mode === 'truncated') return new Response(stl().buffer.slice(0, 133))
      const view = stl()
      if (mode === 'empty') view.setUint32(80, 0, true)
      if (mode === 'nonfinite') view.setFloat32(96, Infinity, true)
      return new Response(view.buffer)
    }
    return new Response(stl().buffer)
  })
  const catalog = await loadCaseIndex(indexUrl)
  for (const [failure, expected] of [
    ['missing', /liver.stl.*HTTP 404/], ['length', /labels.bin.*expected 2/],
    ['truncated', /STL length/], ['empty', /no triangles/], ['nonfinite', /non-finite vertex/],
  ] as const) {
    mode = failure
    await assert.rejects(loadCaseBundle(catalog, 'case-001'), error =>
      error instanceof CaseLoadError && error.stage === 'bundle' && expected.test(error.message))
  }
  mode = 'valid'
  assert.deepEqual((await loadCaseBundle(catalog, 'case-001')).metadata, metadata)
})

test('loaders preserve cancellation so it is distinct from a retryable error', async t => {
  const controller = new AbortController()
  const reason = new DOMException('Selection changed', 'AbortError')
  t.mock.method(globalThis, 'fetch', async (url: URL, options: RequestInit) => {
    if (url.pathname === indexUrl.pathname && !options.signal) return Response.json(index)
    assert.equal(options.signal, controller.signal)
    controller.abort(reason)
    throw reason
  })
  const catalog = await loadCaseIndex(indexUrl)
  await assert.rejects(loadCaseIndex(indexUrl, controller.signal), error => error === reason)
  await assert.rejects(loadCaseBundle(catalog, 'case-001', controller.signal), error => error === reason)
})

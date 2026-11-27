import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build, createServer, preview } from 'vite'
import { createAnalysisApp } from '../../api/app.mts'
import { ProviderFailure } from '../../api/gemini.mts'
import { measuredRequests } from '../../api/smoke.mts'
import { isAnalysisResponse } from '../src/planning/analysis-contract.ts'
import { validateCaseMetadata } from '../src/planning/case-loader.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const metadata: unknown = JSON.parse(await readFile(new URL(
  '../../public/cases/releases/research-2/case-003/metadata.json', import.meta.url), 'utf8'))
assert(validateCaseMetadata(metadata))
const { releaseId: preparedRelease, caseId: preparedCase, labelCounts } = metadata
let available = true
const api = createAnalysisApp({
  findTumourCount: (release, caseId) => release === preparedRelease && caseId === preparedCase
    ? labelCounts.tumour : undefined,
  log: () => {},
  provider: async input => {
    if (!available) throw new ProviderFailure(502)
    const action = input.actions[0]
    return { selection: {
      findingId: input.findings[0].id, observationIds: input.requiredObservationIds,
      actionId: action.id, rationaleFactIds: action.rationaleFactIds,
    } }
  },
}).listen(0, '127.0.0.1')

function port(server: Pick<Server, 'address'>): number {
  const address = server.address()
  assert(address && typeof address !== 'string')
  return address.port
}

async function verify(server: Pick<Server, 'address'>, base: '/' | '/demo/') {
  const site = new URL(base, `http://127.0.0.1:${port(server)}`)
  const requests = await measuredRequests(site)
  const pair = [['/api/plans/explain', requests.single], ['/api/plan-comparisons/explain', requests.comparison]] as const
  available = true
  for (const [path, body] of pair) {
    const reply = await fetch(new URL(path, site), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    assert.equal(reply.status, 200)
    assert(isAnalysisResponse(await reply.json(), body))
  }
  available = false
  const [path, body] = pair[0]
  const failure = await fetch(new URL(path, site), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  assert.equal(failure.status, 502)
  assert.deepEqual(await failure.json(), { error: 'provider_unavailable', requestId: body.requestId })
  const catalogue = await fetch(new URL('cases/index.json', site))
  assert.equal(catalogue.status, 200)
  assert.equal((await catalogue.json()).releaseId, preparedRelease)
  console.log(`Verified both origin-root analysis routes and static catalogue availability with app at ${base}`)
}

try {
  await once(api, 'listening')
  process.env.HEPATOPLAN_API_PORT = String(port(api))
  const dev = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: true } })
  try {
    await dev.listen()
    assert(dev.httpServer)
    await verify(dev.httpServer, '/')
  } finally {
    await dev.close()
  }
  process.env.NODE_ENV = 'production'
  await build({ root, base: '/demo/' })
  const built = await preview({ root, base: '/demo/', preview: { host: '127.0.0.1', port: 0, strictPort: true } })
  try {
    await verify(built.httpServer, '/demo/')
  } finally {
    await new Promise<void>(resolve => built.httpServer.close(() => resolve()))
  }
} finally {
  await new Promise<void>(resolve => api.close(() => resolve()))
}

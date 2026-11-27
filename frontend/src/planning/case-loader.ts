import { Ajv } from 'ajv'
import indexSchema from '../../../contracts/case-index.schema.json' with { type: 'json' }
import metadataSchema from '../../../contracts/case-metadata.schema.json' with { type: 'json' }
import { decodeBinaryStl } from './binary-stl.ts'
import type { DecodedMesh } from './binary-stl.ts'
import type { CaseIndex, CaseMetadata } from './case-contract.ts'

export type LoadedCaseIndex = {
  readonly indexUrl: string
  readonly index: CaseIndex
}

export type CaseBundle = {
  readonly metadata: CaseMetadata
  readonly labels: ArrayBuffer
  readonly liver: DecodedMesh
  readonly tumour: DecodedMesh
}

export class CaseLoadError extends Error {
  readonly stage: 'index' | 'bundle'

  constructor(stage: 'index' | 'bundle', message: string, cause: unknown) {
    super(message, { cause })
    this.name = 'CaseLoadError'
    this.stage = stage
  }
}

const ajv = new Ajv()
export const validateCaseIndex = ajv.compile<CaseIndex>(indexSchema)
export const validateCaseMetadata = ajv.compile<CaseMetadata>(metadataSchema)

async function fetchAsset(url: URL, options: RequestInit): Promise<Response> {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${url.pathname} returned HTTP ${response.status}.`)
  return response
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function loadCaseIndex(indexUrl: URL, signal?: AbortSignal): Promise<LoadedCaseIndex> {
  try {
    const response = await fetchAsset(indexUrl, { cache: 'no-cache', signal })
    const index: unknown = await response.json()
    signal?.throwIfAborted()
    if (!validateCaseIndex(index)) throw new Error(ajv.errorsText(validateCaseIndex.errors))
    return { index, indexUrl: response.url || indexUrl.href }
  } catch (error) {
    signal?.throwIfAborted()
    throw new CaseLoadError('index', `Cannot load case index: ${describe(error)}`, error)
  }
}

async function fetchMesh(caseUrl: URL, filename: string, signal?: AbortSignal): Promise<DecodedMesh> {
  const response = await fetchAsset(new URL(filename, caseUrl), { signal })
  const buffer = await response.arrayBuffer()
  try {
    return decodeBinaryStl(buffer)
  } catch (error) {
    throw new Error(`${filename}: ${describe(error)}`, { cause: error })
  }
}

export async function loadCaseBundle(
  catalog: LoadedCaseIndex, caseId: string, signal?: AbortSignal,
): Promise<CaseBundle> {
  try {
    if (!catalog.index.cases.some(entry => entry.caseId === caseId)) {
      throw new Error('Case is absent from the release index.')
    }
    const { releaseId } = catalog.index
    const caseUrl = new URL(`releases/${releaseId}/${caseId}/`, catalog.indexUrl)
    const response = await fetchAsset(new URL('metadata.json', caseUrl), { signal })
    const metadata: unknown = await response.json()
    signal?.throwIfAborted()
    if (!validateCaseMetadata(metadata)) {
      throw new Error(`Invalid metadata: ${ajv.errorsText(validateCaseMetadata.errors)}`)
    }
    if (metadata.caseId !== caseId || metadata.releaseId !== releaseId) {
      throw new Error('Metadata case or release ID differs from the index.')
    }
    const [nx, ny, nz] = metadata.dimensions
    const expectedBytes = nx * ny * nz
    if (!Number.isSafeInteger(expectedBytes)) throw new Error('Invalid label grid size.')

    const [liver, tumour, labels] = await Promise.all([
      fetchMesh(caseUrl, 'liver.stl', signal),
      fetchMesh(caseUrl, 'tumour.stl', signal),
      fetchAsset(new URL('labels.bin', caseUrl), { signal }).then(asset => asset.arrayBuffer()),
    ])
    signal?.throwIfAborted()
    if (labels.byteLength !== expectedBytes) {
      throw new Error(`labels.bin has ${labels.byteLength} bytes, expected ${expectedBytes}.`)
    }
    return { metadata, labels, liver, tumour }
  } catch (error) {
    signal?.throwIfAborted()
    throw new CaseLoadError('bundle', `Cannot load case "${caseId}": ${describe(error)}`, error)
  }
}

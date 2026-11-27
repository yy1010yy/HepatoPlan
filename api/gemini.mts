import type { prepareAnalysis } from '../backend/plan-analysis.mts'

export type ProviderInput = NonNullable<ReturnType<typeof prepareAnalysis>>['providerInput']
export type TokenUsage = { inputTokens: number; outputTokens: number }
export type AnalysisProvider = (input: ProviderInput, signal: AbortSignal) => Promise<{
  selection: unknown; usage?: TokenUsage
}>

export const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'

export class ProviderFailure extends Error {
  readonly status: 429 | 502
  readonly retryAfter?: string

  constructor(status: 429 | 502, retryAfter?: string) {
    super(status === 429 ? 'Provider quota exceeded.' : 'Provider response unavailable.')
    this.status = status
    this.retryAfter = retryAfter
  }
}

function responseSchema(input: ProviderInput) {
  const id = (entries: { id: string }[]) => ({ type: 'string', enum: entries.map(entry => entry.id) })
  return {
    type: 'object',
    additionalProperties: false,
    required: ['findingId', 'observationIds', 'actionId', 'rationaleFactIds'],
    properties: {
      findingId: id(input.findings),
      observationIds: { type: 'array', maxItems: Math.min(5, input.observations.length),
        items: input.observations.length ? id(input.observations) : { type: 'string' } },
      actionId: id(input.actions),
      rationaleFactIds: { type: 'array', minItems: 1, maxItems: 5, items: id(input.rationales) },
    },
  }
}

function tokens(input: unknown): number {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 ? input : 0
}

type GeminiReply = {
  promptFeedback?: { blockReason?: string }
  candidates?: {
    finishReason?: string
    content?: { parts?: { text?: unknown; thought?: boolean }[] }
  }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

const instruction = [
  'Choose a finding, supporting observations and one next inspection in HepatoPlan.',
  'Use only the supplied IDs. Include every required observation ID.',
  'Choose rationale IDs listed for the selected action. Keep each list unique.',
  'The objective concerns measured geometry for research and education.',
].join(' ')

export function createGeminiProvider(
  apiKey: string, model = DEFAULT_GEMINI_MODEL, fetchResponse: typeof fetch = fetch,
): AnalysisProvider {
  const endpoint = new URL(`/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    'https://generativelanguage.googleapis.com')
  return async (input, signal) => {
    const response = await fetchResponse(endpoint, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: responseSchema(input),
          maxOutputTokens: 512,
        },
      }),
    })
    if (!response.ok) {
      await response.body?.cancel()
      if (response.status === 429) {
        const retry = response.headers.get('Retry-After')
        throw new ProviderFailure(429, retry && (/^\d+$/.test(retry) || Number.isFinite(Date.parse(retry))) ? retry : undefined)
      }
      throw new ProviderFailure(502)
    }
    const reply = await response.json() as GeminiReply
    const candidate = reply.candidates?.[0]
    if (reply.promptFeedback?.blockReason || candidate?.finishReason !== 'STOP') throw new ProviderFailure(502)
    const parts = candidate.content?.parts
    if (!Array.isArray(parts)) throw new ProviderFailure(502)
    const output = parts.filter(part => part.thought !== true).map(part => part.text).join('')
    const selection: unknown = JSON.parse(output)
    const usage = reply.usageMetadata
    return {
      selection,
      ...(usage && { usage: {
        inputTokens: tokens(usage.promptTokenCount),
        outputTokens: tokens(usage.candidatesTokenCount) + tokens(usage.thoughtsTokenCount),
      } }),
    }
  }
}

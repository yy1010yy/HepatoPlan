import express from 'express'
import type { ErrorRequestHandler, Request, Response } from 'express'
import { prepareAnalysis } from '../backend/plan-analysis.mts'
import type { FindTumourCount } from '../backend/plan-analysis.mts'
import { ProviderFailure } from './gemini.mts'
import type { AnalysisProvider, TokenUsage } from './gemini.mts'

type Mode = Parameters<typeof prepareAnalysis>[0]
type LogEntry = { mode: Mode; status: number; elapsedMs: number } & Partial<TokenUsage>
type Options = {
  findTumourCount: FindTumourCount
  provider?: AnalysisProvider
  deadlineMs?: number
  log?: (entry: LogEntry) => void
}

function sendError(res: Response, status: number, code: string, body?: unknown): void {
  const id = (body as { requestId?: unknown } | undefined)?.requestId
  const requestId = typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : undefined
  res.status(status).json({ error: code, requestId })
}

export function createAnalysisApp({ findTumourCount, provider, deadlineMs = 20_000,
  log = entry => console.info(JSON.stringify(entry)) }: Options) {
  const app = express()
  app.disable('x-powered-by')
  const parse = express.json({ limit: '16kb', inflate: false })

  function route(path: string, mode: Mode): void {
    app.post(path, (req, res, next) => {
      const start = performance.now()
      res.set('Cache-Control', 'no-store')
      res.once('finish', () => log({
        mode, status: res.statusCode, elapsedMs: Math.round(performance.now() - start), ...res.locals.usage,
      }))
      if (!req.is('application/json')) return sendError(res, 415, 'json_required')
      next()
    }, parse, async (req: Request, res: Response) => {
      const prepared = prepareAnalysis(mode, req.body, findTumourCount)
      if (!prepared) return sendError(res, 400, 'invalid_analysis_request', req.body)
      if (!provider) return sendError(res, 503, 'provider_not_configured', req.body)

      const client = new AbortController()
      const timeout = AbortSignal.timeout(deadlineMs)
      const signal = AbortSignal.any([client.signal, timeout])
      const close = () => { if (!res.writableEnded) client.abort() }
      res.once('close', close)
      try {
        const { selection, usage } = await provider(prepared.providerInput, signal)
        signal.throwIfAborted()
        res.locals.usage = usage
        const result = prepared.resolve(selection)
        if (!result) return sendError(res, 502, 'invalid_provider_output', req.body)
        res.json(result)
      } catch (error) {
        if (client.signal.aborted) return
        if (timeout.aborted) return sendError(res, 504, 'provider_timeout', req.body)
        if (error instanceof ProviderFailure && error.status === 429) {
          if (error.retryAfter) res.set('Retry-After', error.retryAfter)
          return sendError(res, 429, 'provider_quota_exceeded', req.body)
        }
        sendError(res, 502, 'provider_unavailable', req.body)
      } finally {
        res.off('close', close)
      }
    })
    app.all(path, (_req, res) => {
      res.set('Allow', 'POST')
      sendError(res, 405, 'method_not_allowed')
    })
  }

  route('/api/plans/explain', 'single')
  route('/api/plan-comparisons/explain', 'comparison')
  app.use((_req, res) => sendError(res, 404, 'route_not_found'))
  const handleError: ErrorRequestHandler = (error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error.status === 413) return sendError(res, 413, 'request_too_large')
    if (error.status === 415) return sendError(res, 415, 'unsupported_encoding')
    if (error.status === 400) return sendError(res, 400, 'invalid_json')
    sendError(res, 500, 'internal_error', req.body)
  }
  app.use(handleError)
  return app
}

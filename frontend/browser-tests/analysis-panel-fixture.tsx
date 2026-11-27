import { createRoot } from 'react-dom/client'
import fixture from '../../fixtures/plan-analysis-v2.json' with { type: 'json' }
import { AnalysisPanel, TestedCutMeasurements } from '../src/components/analysis-panel.tsx'
import { isAnalysisResponse, isComparisonAnalysisRequest, isSingleAnalysisRequest } from '../src/planning/analysis-contract.ts'
import '../src/app.css'

const { single, comparison } = fixture
const root = document.getElementById('root')
if (!root || !isSingleAnalysisRequest(single.request) || !isComparisonAnalysisRequest(comparison.request)
    || !isAnalysisResponse(single.response, single.request) || !isAnalysisResponse(comparison.response, comparison.request)) {
  throw new Error('Invalid analysis fixture.')
}

createRoot(root).render(
  <div className="wrap">
    <section className="panel" aria-label="Single plan fixture">
      <AnalysisPanel result={single.response}
        actions={{ preview_alternative: { run: () => document.getElementById('preview-confirmation')?.focus() } }} />
      <TestedCutMeasurements request={single.request} />
      <p id="preview-confirmation" tabIndex={-1}>Tested cut selected</p>
    </section>
    <section className="panel" aria-label="Comparison fixture">
      <AnalysisPanel result={comparison.response}
        actions={{ open_plan_b: { run: () => document.getElementById('comparison-contact')?.focus() } }} />
      <p id="comparison-contact" tabIndex={-1}>Plan B tumour intersection</p>
    </section>
  </div>
)

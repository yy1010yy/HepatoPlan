import type { PlanDetails } from './planning/plan-session.ts'

export const planContextOptions = {
  procedureType: {
    label: 'Procedure type',
    placeholder: 'Select a procedure',
    groups: [
      { label: 'Major resections', options: [
        'Right hepatectomy', 'Left hepatectomy', 'Right trisectionectomy (extended right hepatectomy)',
        'Left trisectionectomy (extended left hepatectomy)', 'Central hepatectomy', 'Staged hepatectomy',
      ] },
      { label: 'Limited resections', options: [
        'Left lateral sectionectomy', 'Left medial sectionectomy', 'Right anterior sectionectomy',
        'Right posterior sectionectomy', 'Segmentectomy', 'Bisegmentectomy', 'Subsegmentectomy',
        'Caudate lobectomy', 'Wedge resection (non-anatomic resection)',
      ] },
      { label: 'Other liver procedures', options: [
        'Living-donor hepatectomy', 'Liver transplantation', 'Radiofrequency ablation', 'Microwave ablation',
        'Cryoablation', 'Portal vein embolization', 'Transarterial chemoembolization (TACE)',
        'Transarterial radioembolization (TARE)', 'Liver biopsy',
      ] },
    ],
  },
  reason: {
    label: 'Reason',
    placeholder: 'Select a reason',
    groups: [{ label: null, options: [
      'Hepatocellular carcinoma (HCC)', 'Intrahepatic cholangiocarcinoma', 'Liver metastases', 'Benign liver lesion',
      'Indeterminate liver lesion', 'Living-donor assessment', 'Compare remnant volume', 'Research or education',
    ] }],
  },
}

export const customContextOption = '__other__'
type ContextKey = keyof typeof planContextOptions
type ContextValue = { selected: string; custom: string }
export type PlanContext = Record<ContextKey, ContextValue>

function contextValue(key: ContextKey, value = ''): ContextValue {
  return value && !planContextOptions[key].groups.some(group => group.options.includes(value))
    ? { selected: customContextOption, custom: value }
    : { selected: value, custom: '' }
}

export function planContextFor(details?: PlanDetails): PlanContext {
  return {
    procedureType: contextValue('procedureType', details?.procedureType),
    reason: contextValue('reason', details?.reason),
  }
}

export function planContextValues(context: PlanContext): Pick<PlanDetails, ContextKey> {
  const value = ({ selected, custom }: ContextValue) => (
    selected === customContextOption ? custom.trim() : selected
  ) || undefined
  return { procedureType: value(context.procedureType), reason: value(context.reason) }
}

'use client'

import React, { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface QuizSourceInfo {
  hasSource: boolean
  ragSpaceId: number | string | null
  systemMessage: string
  model: string
}

export function resolveQuizSource(nodes: any[], edges: any[], miniAppNodeId: string): QuizSourceInfo {
  const miniEdge = edges.find((e) => e.target === miniAppNodeId && e.sourceHandle === 'miniapps')
  const aiNode = miniEdge ? nodes.find((n) => n.id === miniEdge.source) : null
  let ragSpaceId: number | string | null = null
  let systemMessage = ''
  let model = ''
  let hasSource = false
  if (aiNode) {
    systemMessage = typeof aiNode.data?.systemMessage === 'string' ? aiNode.data.systemMessage : ''
    model = typeof aiNode.data?.model === 'string' ? aiNode.data.model : ''
    const toolEdges = edges.filter((e) => e.source === aiNode.id && e.sourceHandle === 'tools')
    for (const te of toolEdges) {
      const tn = nodes.find((n) => n.id === te.target)
      if (tn && tn.type === 'tool' && tn.data?.toolType === 'source') {
        hasSource = true
        ragSpaceId = tn.data?.ragSpaceId ?? null
        break
      }
    }
  }
  return { hasSource, ragSpaceId, systemMessage, model }
}

export function resolveCallLanguage(nodes: any[]): string {
  const start = nodes.find((n) => n?.data?.nodeType === 'start' && n?.data?.triggerType === 'pstn')
  return typeof start?.data?.language === 'string' ? start.data.language : ''
}

export function QuizStructureView({ analysis, t }: { analysis: any; t: any }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  if (!analysis || analysis.docCount === 0) {
    return <p className="text-sm text-amber-400/90 py-2">{t.quiz_study_no_source || 'No knowledge source found. Connect a Source node with documents.'}</p>
  }
  return (
    <div className="text-sm text-gray-300">
      <p className="mb-2">
        {analysis.structured
          ? (t.quiz_study_structured || 'Structured — {docs} document(s), {sections} section(s).')
              .replace('{docs}', String(analysis.docCount))
              .replace('{sections}', String(analysis.sectionCount))
          : (t.quiz_study_plain || 'Plain text — {docs} document(s), no clear sections.')
              .replace('{docs}', String(analysis.docCount))}
      </p>
      <div className="space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
        {analysis.docs.map((d: any, i: number) => {
          const isOpen = expanded === i
          return (
            <div key={i} className="rounded bg-[#1e1e2e] border border-[#3A3A3A]">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : i)}
                className="w-full flex items-center gap-2 p-2 text-left hover:bg-[#26263a] transition-colors rounded"
                title={t.quiz_study_doc_full || 'Click to view full text'}
              >
                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-gray-500 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-500 shrink-0" />}
                <span className="text-xs font-medium text-gray-200 truncate flex-1">{d.title}</span>
                <span className="text-[10px] text-gray-600 shrink-0">{d.charLength.toLocaleString()}</span>
              </button>
              {isOpen ? (
                <div className="px-3 pb-3">
                  <pre className="whitespace-pre-wrap font-sans text-xs text-gray-300 leading-relaxed">{d.fullText || d.plainPreview}</pre>
                  {d.truncated && (
                    <p className="mt-2 text-[10px] text-gray-500 italic">
                      {(t.quiz_study_doc_truncated || 'Showing the first {n} characters (of {total}).')
                        .replace('{n}', (50000).toLocaleString())
                        .replace('{total}', d.charLength.toLocaleString())}
                    </p>
                  )}
                </div>
              ) : (
                <div className="px-3 pb-2 pl-7">
                  {d.structured ? (
                    <ul className="text-xs text-gray-400 list-disc list-inside space-y-0.5">
                      {d.sections.slice(0, 8).map((s: any, j: number) => (
                        <li key={j} className="truncate">{s.heading}</li>
                      ))}
                      {d.sections.length > 8 && <li className="text-gray-600">… +{d.sections.length - 8}</li>}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500 line-clamp-2">{d.plainPreview}</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

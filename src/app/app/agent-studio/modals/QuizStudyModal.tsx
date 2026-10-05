'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { X, GripHorizontal, GraduationCap, Loader2, FileText, Sparkles, Layers, Check } from 'lucide-react'
import { useWorkflowContext } from '../contexts/WorkflowContext'
import { useDraggable } from '../hooks/useDraggable'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { QuizStructureView, resolveQuizSource } from './QuizSourceStructure'

type StudyLength = 'none' | 'short' | 'standard' | 'deep'
type Section = { heading: string; body: string; imageCaption: string | null }
type SampleEntry = { sections?: Section[]; error?: string }
const SAMPLE_LENGTHS: StudyLength[] = ['short', 'standard', 'deep']

const STUDY_LENGTH_KEYS: Array<{ key: StudyLength; tLabel: string; tDesc: string }> = [
  { key: 'none', tLabel: 'quiz_study_len_none', tDesc: 'quiz_study_len_none_desc' },
  { key: 'short', tLabel: 'quiz_study_len_short', tDesc: 'quiz_study_len_short_desc' },
  { key: 'standard', tLabel: 'quiz_study_len_standard', tDesc: 'quiz_study_len_standard_desc' },
  { key: 'deep', tLabel: 'quiz_study_len_deep', tDesc: 'quiz_study_len_deep_desc' },
]

function normalizeStudyLength(raw: any, includeStudyLegacy: any): StudyLength {
  if (raw === 'none' || raw === 'short' || raw === 'standard' || raw === 'deep') return raw
  return includeStudyLegacy === false ? 'none' : 'standard'
}

export function QuizStudyModal() {
  const { ui, workflow, nodeHandlers, agent } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)

  const targetNodeId = ui.quizStudyModalNodeId || workflow.selectedNode || ''
  const targetNode = useMemo(
    () => workflow.nodes.find((n) => n.id === targetNodeId),
    [workflow.nodes, targetNodeId],
  )

  const [studyLength, setStudyLength] = useState<StudyLength>('standard')
  const [analysis, setAnalysis] = useState<any>(null)
  const [analysisState, setAnalysisState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [samples, setSamples] = useState<Partial<Record<StudyLength, SampleEntry>> | null>(null)
  const [sampleState, setSampleState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: ui.showQuizStudyModal })

  useEffect(() => {
    if (!ui.showQuizStudyModal || !targetNode) return
    let cancelled = false
    setStudyLength(normalizeStudyLength(targetNode.data?.studyLength, targetNode.data?.includeStudy))
    setSamples(null)
    setSampleState('idle')

    const src = resolveQuizSource(workflow.nodes, workflow.edges, targetNode.id)
    setAnalysis(null)
    setAnalysisState('loading')
    fetch('/api/miniapp/quiz/study-source', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: agent.agentId, ragSpaceId: src.ragSpaceId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j) => { if (!cancelled) { setAnalysis(j.analysis); setAnalysisState('idle') } })
      .catch(() => { if (!cancelled) setAnalysisState('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.showQuizStudyModal, targetNodeId])

  useEffect(() => {
    if (ui.showQuizStudyModal && !targetNode) ui.setShowQuizStudyModal(false)
  }, [ui.showQuizStudyModal, targetNode, ui])

  if (!ui.showQuizStudyModal || !targetNode) return null

  const runSamples = async () => {
    if (sampleState === 'loading' || sampleState === 'done') return
    const src = resolveQuizSource(workflow.nodes, workflow.edges, targetNode.id)
    setSampleState('loading')
    setSamples(null)
    const base = {
      agentId: agent.agentId,
      ragSpaceId: src.ragSpaceId,
      title: targetNode.data?.title,
      language: targetNode.data?.language,
      questionTypes: targetNode.data?.questionTypes,
      difficulty: targetNode.data?.difficulty,
      topicHint: targetNode.data?.topicHint,
      systemMessage: src.systemMessage,
      model: src.model,
    }
    const results = await Promise.all(
      SAMPLE_LENGTHS.map(async (len): Promise<[StudyLength, SampleEntry]> => {
        try {
          const r = await fetch('/api/miniapp/quiz/study-preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...base, studyLength: len }),
          })
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(j.error || 'preview failed')
          return [len, { sections: j.sections || [] }]
        } catch (e: any) {
          return [len, { error: String(e?.message || e) }]
        }
      }),
    )
    const map: Partial<Record<StudyLength, SampleEntry>> = {}
    for (const [len, entry] of results) map[len] = entry
    setSamples(map)
    setSampleState(results.every(([, e]) => e.error) ? 'error' : 'done')
  }

  const handleSave = () => {
    nodeHandlers.updateNodeData(targetNode.id, { studyLength, includeStudy: studyLength !== 'none' })
    ui.setShowQuizStudyModal(false)
  }

  const current = studyLength !== 'none' ? samples?.[studyLength] : undefined

  return (
    <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
      <div
        className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] w-full max-w-3xl max-h-[85vh] flex flex-col"
        style={dragStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="p-6 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <div>
              <h2 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-teal-400" />
                {t.quiz_study_modal_title || 'Study material'}
              </h2>
              <p className="text-sm text-gray-400 mt-1">{t.quiz_study_modal_desc || 'Analyze the source and control how much to study before the quiz.'}</p>
            </div>
          </div>
          <button
            onClick={() => ui.setShowQuizStudyModal(false)}
            className="text-gray-400 hover:text-gray-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-6 min-h-0">
          <section>
            <h3 className="text-base font-semibold text-gray-100 flex items-center gap-2 mb-2">
              <Layers className="w-4 h-4 text-gray-400" />
              {t.quiz_study_structure || 'Source structure'}
            </h3>
            {analysisState === 'loading' && (
              <div className="flex items-center gap-2 text-sm text-gray-400 py-3">
                <Loader2 className="w-4 h-4 animate-spin" /> {t.quiz_study_analyzing || 'Analyzing source…'}
              </div>
            )}
            {analysisState === 'error' && (
              <p className="text-sm text-red-400 py-2">{t.quiz_study_analyze_error || 'Could not analyze the source.'}</p>
            )}
            {analysisState === 'idle' && analysis && (
              <QuizStructureView analysis={analysis} t={t} />
            )}
          </section>

          <section>
            <h3 className="text-base font-semibold text-gray-100 mb-3">{t.quiz_study_amount || 'Study amount'}</h3>
            <div className="space-y-2">
              {STUDY_LENGTH_KEYS.map(({ key, tLabel, tDesc }) => (
                <label
                  key={key}
                  className={`flex items-start gap-3 p-3 rounded-md border cursor-pointer transition-colors ${
                    studyLength === key
                      ? 'border-teal-500/70 bg-[#26302f]'
                      : 'border-[#3A3A3A] bg-[#1e1e2e] hover:border-gray-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="studyLength"
                    className="mt-1 accent-teal-500"
                    checked={studyLength === key}
                    onChange={() => setStudyLength(key)}
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-200">{(t as any)[tLabel] || key}</div>
                    <div className="text-xs text-gray-500">{(t as any)[tDesc] || ''}</div>
                  </div>
                </label>
              ))}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold text-gray-100 flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                {t.quiz_study_preview || 'Preview'}
              </h3>
              <button
                onClick={runSamples}
                disabled={sampleState === 'loading' || sampleState === 'done'}
                className="flex items-center gap-2 py-1.5 px-3 rounded-md text-sm bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
              >
                {sampleState === 'loading'
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : sampleState === 'done'
                    ? <Check className="w-4 h-4" />
                    : <Sparkles className="w-4 h-4" />}
                {sampleState === 'done' ? (t.quiz_study_preview_done || 'Samples ready') : (t.quiz_study_preview_btn || 'Generate sample')}
              </button>
            </div>

            {sampleState === 'idle' && (
              <p className="text-xs text-gray-500">{t.quiz_study_preview_hint || 'Generate once — all three lengths are created so you can compare by switching above.'}</p>
            )}
            {sampleState === 'loading' && (
              <p className="text-sm text-gray-400 py-2">{t.quiz_study_preview_loading || 'Generating samples (may take ~10-30s)…'}</p>
            )}
            {(sampleState === 'done' || sampleState === 'error') && (
              <>
                <p className="text-xs text-gray-500 mb-3">{t.quiz_study_preview_compare || 'Switch Short / Standard / Detailed above to compare.'}</p>
                {studyLength === 'none' && (
                  <p className="text-sm text-gray-500 py-2">{t.quiz_study_len_none_desc || 'No study material.'}</p>
                )}
                {studyLength !== 'none' && current?.error && (
                  <p className="text-sm text-red-400 py-2">{t.quiz_study_preview_error || 'Preview failed'}: {current.error}</p>
                )}
                {studyLength !== 'none' && current?.sections && current.sections.length > 0 && (
                  <div className="space-y-4">
                    {current.sections.map((s, i) => (
                      <div key={i} className="p-3 rounded-md bg-[#1e1e2e] border border-[#3A3A3A]">
                        <div className="text-sm font-semibold text-gray-100 mb-1">{s.heading}</div>
                        <div className="text-sm text-gray-300 whitespace-pre-wrap">{s.body}</div>
                        {s.imageCaption && <div className="text-xs text-gray-500 mt-1 italic">{s.imageCaption}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {studyLength !== 'none' && current?.sections && current.sections.length === 0 && (
                  <p className="text-sm text-gray-500 py-2">{t.quiz_study_preview_empty || 'No study sections were produced.'}</p>
                )}
              </>
            )}
          </section>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#3A3A3A] flex items-center justify-end gap-3">
          <button
            onClick={() => ui.setShowQuizStudyModal(false)}
            className="py-2 px-4 rounded-md text-sm text-gray-300 hover:text-gray-100 border border-[#3A3A3A] hover:border-gray-600 transition-colors"
          >
            {t.quiz_study_cancel || t.pstn_cancel || 'Cancel'}
          </button>
          <button
            onClick={handleSave}
            className="py-2 px-4 rounded-md text-sm bg-teal-600 hover:bg-teal-500 text-white transition-colors"
          >
            {t.quiz_study_save || t.pstn_save || 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

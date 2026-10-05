
'use client'

import React from 'react'
import type { PstnPipeline } from '../utils/pstnPipeline'

interface Props {
  pipeline: PstnPipeline
  onChange: (target: PstnPipeline) => void
  hasAiNode: boolean
  t: any
}

const DESC_KEY: Record<PstnPipeline, [string, string]> = {
  realtime: ['pstn_pipeline_realtime_desc', 'OpenAI Realtime — native multilingual voice, lower latency.'],
  talk: ['pstn_pipeline_chat_desc', 'Azure STT + LLM + Azure TTS — HD voices, locale-specific. One language. 5 credits/min.'],
  mix: [
    'pstn_pipeline_mix_desc',
    'Callers pick a language by pressing a number. Each language runs on Talk or Realtime — your choice per entry.',
  ],
}

export function PstnPipelineToggle({ pipeline, onChange, hasAiNode, t }: Props) {
  const btn = (target: PstnPipeline, label: string) => (
    <button
      type="button"
      onClick={() => onChange(target)}
      className={`flex-1 py-1.5 text-xs rounded transition-colors ${
        pipeline === target ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  )
  const [descKey, descFallback] = DESC_KEY[pipeline]

  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1.5">
        {t.pstn_pipeline_label || 'Pipeline'}
      </label>
      <div className="flex gap-1 p-0.5 bg-[#1a1a28] rounded-md">
        {btn('realtime', t.pstn_pipeline_realtime || 'Realtime')}
        {btn('talk', t.pstn_pipeline_chat || 'Talk (STT+TTS)')}
        {btn('mix', t.pstn_pipeline_mix || 'Mix')}
      </div>
      <p className="text-[11px] text-gray-500 mt-1">
        {t[descKey] || descFallback}
        {hasAiNode ? null : (
          <span className="block mt-0.5 text-amber-400/80">
            {t.pstn_pipeline_no_ai || 'Connect an AI node downstream of this PSTN node first.'}
          </span>
        )}
      </p>
    </div>
  )
}

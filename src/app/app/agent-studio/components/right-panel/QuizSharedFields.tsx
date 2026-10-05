'use client'

import { VOICE_LANG_FAMILIES, type VoiceLangFamily } from '@/lib/call/voice-locales'
import React, { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

const QUIZ_LANGUAGE_LABELS: Record<VoiceLangFamily, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  ko: '한국어',
}
export const QUIZ_LANGUAGES = VOICE_LANG_FAMILIES.map((v) => ({ value: v, label: QUIZ_LANGUAGE_LABELS[v] }))

export const NumberInput: React.FC<{
  value: number
  min: number
  max: number
  onCommit: (v: number) => void
}> = ({ value, min, max, onCommit }) => {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  return (
    <Input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value)
        const v = parseInt(e.target.value, 10)
        if (!Number.isNaN(v) && v >= min && v <= max) onCommit(v)
      }}
      onBlur={() => {
        const v = parseInt(draft, 10)
        const next = Number.isNaN(v) ? value : Math.min(max, Math.max(min, v))
        onCommit(next)
        setDraft(String(next))
      }}
      autoComplete="off"
      className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
    />
  )
}

interface FieldProps {
  data: Record<string, any>
  updateNodeData: (patch: Record<string, any>) => void
}

export const QuizTitleField: React.FC<FieldProps & { defaultTitle: string; hint?: string }> = ({ data, updateNodeData, defaultTitle, hint }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const hintText = hint === undefined ? t.quiz_title_hint : hint
  return (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-1 block">{t.quiz_title}</label>
      <Input
        value={data.title ?? defaultTitle}
        onChange={(e) => updateNodeData({ title: e.target.value })}
        autoComplete="off"
        className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
      />
      {hintText ? <p className="text-xs text-gray-500 mt-1">{hintText}</p> : null}
    </div>
  )
}

export const QuizQuestionCountField: React.FC<FieldProps & { max: number; defaultValue: number }> = ({ data, updateNodeData, max, defaultValue }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  return (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-1 block">{t.quiz_question_count}</label>
      <NumberInput
        value={data.questionCount ?? defaultValue}
        min={1}
        max={max}
        onCommit={(v) => updateNodeData({ questionCount: v })}
      />
    </div>
  )
}

export const QuizLanguageField: React.FC<FieldProps & { allowCallLanguage?: boolean }> = ({ data, updateNodeData, allowCallLanguage }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  return (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-1 block">{t.quiz_language}</label>
      <select
        value={data.language ?? (allowCallLanguage ? '' : 'en')}
        onChange={(e) => updateNodeData({ language: e.target.value || undefined })}
        className="w-full bg-[#1F1F1F] border border-[#3A3A3A] rounded px-2 py-1.5 text-sm text-gray-200"
      >
        {allowCallLanguage && <option value="">{t.voice_quiz_lang_call}</option>}
        {QUIZ_LANGUAGES.map(l => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
    </div>
  )
}

export const QuizTopicHintField: React.FC<FieldProps> = ({ data, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  return (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-1 block">{t.quiz_topic_hint}</label>
      <Input
        value={data.topicHint ?? ''}
        onChange={(e) => updateNodeData({ topicHint: e.target.value })}
        placeholder={t.quiz_topic_hint_placeholder}
        autoComplete="off"
        className="bg-[#3A3A3A] border-[#3A3A3A] text-gray-200"
      />
    </div>
  )
}

export const QUIZ_QUESTION_TYPES = ['multiple_choice', 'true_false', 'short_answer'] as const
export const QUIZ_DIFFICULTIES = ['mixed', 'easy', 'medium', 'hard'] as const

export const QuizQuestionTypesField: React.FC<FieldProps & {
  unsupported?: readonly string[]
  defaultTypes?: string[]
}> = ({ data, updateNodeData, unsupported = [], defaultTypes }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const selectable = QUIZ_QUESTION_TYPES.filter((qt) => !unsupported.includes(qt))
  const fallback = (defaultTypes ?? ['multiple_choice']).filter((qt) => selectable.includes(qt as any))
  const stored: string[] = Array.isArray(data.questionTypes) ? data.questionTypes : fallback
  const usable = stored.filter((qt) => selectable.includes(qt as any))
  const active = usable.length > 0 ? usable : fallback

  const toggle = (type: string) => {
    const next = active.includes(type) ? active.filter((qt) => qt !== type) : [...active, type]
    if (next.length === 0) return
    updateNodeData({ questionTypes: next })
  }

  const label: Record<string, string> = {
    multiple_choice: t.quiz_type_multiple_choice,
    true_false: t.quiz_type_true_false,
    short_answer: t.quiz_type_short_answer,
  }

  return (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-2 block">{t.quiz_question_types}</label>
      <div className="space-y-2">
        {selectable.map((type) => (
          <label key={type} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded bg-[#3A3A3A] border-[#3A3A3A]"
              checked={active.includes(type)}
              onChange={() => toggle(type)}
            />
            <span className="text-sm text-gray-200">{label[type]}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

export const QuizDifficultyField: React.FC<FieldProps> = ({ data, updateNodeData }) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const label: Record<string, string> = {
    mixed: t.quiz_difficulty_mixed,
    easy: t.quiz_difficulty_easy,
    medium: t.quiz_difficulty_medium,
    hard: t.quiz_difficulty_hard,
  }
  return (
    <div>
      <label className="text-sm font-medium text-gray-200 mb-1 block">{t.quiz_difficulty}</label>
      <select
        value={data.difficulty ?? 'mixed'}
        onChange={(e) => updateNodeData({ difficulty: e.target.value })}
        className="w-full bg-[#1F1F1F] border border-[#3A3A3A] rounded px-2 py-1.5 text-sm text-gray-200"
      >
        {QUIZ_DIFFICULTIES.map((d) => (
          <option key={d} value={d}>{label[d]}</option>
        ))}
      </select>
    </div>
  )
}

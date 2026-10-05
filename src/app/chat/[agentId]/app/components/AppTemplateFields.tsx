'use client'

import React from 'react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { AppTemplateField } from '../lib/api'

export const fieldInputCls = 'w-full rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white focus:outline-none focus:border-[#E07B53]'

export type FieldValues = Record<string, string>

export function fieldsToValues(fields: readonly AppTemplateField[], v: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = (v[f.name] ?? '').trim()
    if (raw === '') continue
    out[f.name] = f.type === 'boolean' ? raw === 'yes' : raw
  }
  return out
}

export function fieldsComplete(fields: readonly AppTemplateField[], v: FieldValues): boolean {
  return fields.every((f) => !f.required || (v[f.name] ?? '').trim() !== '')
}

export function AppTemplateFields({ lang, prefix, fields, values, onChange, idPrefix, disabled }: {
  lang: WorkLang
  prefix: string
  fields: readonly AppTemplateField[]
  values: FieldValues
  onChange: (name: string, value: string) => void
  idPrefix: string
  disabled?: boolean
}) {
  return (
    <>
      {fields.map((f) => {
        const label = workT(lang, `${prefix}${f.name}`, f.name)
        const helpKey = `${prefix}${f.name}_help`
        const help = workT(lang, helpKey, '')
        const v = values[f.name] ?? ''
        return (
          <div key={f.name}>
            {f.type === 'boolean' ? (
              <fieldset disabled={disabled}>
                <legend className="block text-xs text-gray-400 mb-1">{label}{f.required && <span className="text-[#E07B53]"> *</span>}</legend>
                <div className="flex gap-4 text-sm text-white">
                  {(['yes', 'no'] as const).map((o) => (
                    <label key={o} className="inline-flex items-center gap-2">
                      <input type="radio" name={`${idPrefix}-${f.name}`} checked={v === o} onChange={() => onChange(f.name, o)} className="accent-[#E07B53]" />
                      {workT(lang, o)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <label className="block">
                <span className="block text-xs text-gray-400 mb-1">{label}{f.required && <span className="text-[#E07B53]"> *</span>}</span>
                {f.type === 'textarea' ? (
                  <textarea value={v} disabled={disabled} onChange={(e) => onChange(f.name, e.target.value)} maxLength={f.maxLength} rows={2} className={fieldInputCls} autoComplete="off" />
                ) : (
                  <input value={v} disabled={disabled} onChange={(e) => onChange(f.name, e.target.value)} maxLength={f.maxLength} inputMode={f.type === 'money' ? 'decimal' : undefined} className={`${fieldInputCls} ${f.type === 'money' ? 'text-right tabular-nums' : ''}`} autoComplete="off" />
                )}
              </label>
            )}
            {help && <p className="mt-1 text-xs text-gray-500">{help}</p>}
          </div>
        )
      })}
    </>
  )
}

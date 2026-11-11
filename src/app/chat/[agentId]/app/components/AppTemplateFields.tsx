'use client'

import React from 'react'
import { workT, type WorkLang } from '@/lib/translations/work'
import type { AppTemplateField, SetupMember } from '../lib/api'
import { useWorkPkg } from './work-pkg'

export const fieldInputCls = 'w-full rounded-md bg-[#2A2A2A] border border-[#3A3A3A] px-3 py-2 text-sm text-white placeholder:text-gray-500 placeholder:italic focus:outline-none focus:border-[#E07B53]'

export type FieldValues = Record<string, string>

export function fieldHidden(f: AppTemplateField, v: FieldValues, fields: readonly AppTemplateField[], seen: ReadonlySet<string> = new Set()): boolean {
  if (!f.showWhen) return false
  const dep = f.showWhen.filled
  if ((v[dep] ?? '').trim() === '' || seen.has(dep)) return true
  const parent = fields.find((x) => x.name === dep)
  return !!parent && fieldHidden(parent, v, fields, new Set([...seen, f.name]))
}
const memberKeys = (raw: string) => [...new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))]

export function fieldsToValues(fields: readonly AppTemplateField[], v: FieldValues): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const raw = fieldHidden(f, v, fields) ? '' : (v[f.name] ?? '').trim()
    if (f.type === 'members') { out[f.name] = memberKeys(raw); continue }
    if (raw === '') continue
    out[f.name] = f.type === 'boolean' ? raw === 'yes' : raw
  }
  return out
}

export function valuesToFields(fields: readonly AppTemplateField[], v: Record<string, unknown>): FieldValues {
  const out: FieldValues = {}
  for (const f of fields) {
    const x = v[f.name]
    if (x === undefined || x === null) continue
    out[f.name] = f.type === 'boolean' ? (x === true ? 'yes' : x === false ? 'no' : '') : f.type === 'members' ? (Array.isArray(x) ? x.join(',') : '') : String(x)
  }
  return out
}

export function fieldsComplete(fields: readonly AppTemplateField[], v: FieldValues): boolean {
  return fields.every((f) => !f.required || fieldHidden(f, v, fields) || (v[f.name] ?? '').trim() !== '')
}

export function AppTemplateFields({ lang, prefix, fields, values, onChange, idPrefix, disabled: allDisabled, members, isOwner }: {
  lang: WorkLang
  prefix: string
  fields: readonly AppTemplateField[]
  values: FieldValues
  onChange: (name: string, value: string) => void
  idPrefix: string
  disabled?: boolean
  members?: readonly SetupMember[]
  isOwner?: boolean
}) {
  const pkg = useWorkPkg()
  return (
    <>
      {fields.filter((f) => !fieldHidden(f, values, fields) && (f.type !== 'members' || members)).map((f) => {
        const label = workT(lang, `${prefix}${f.name}`, f.name, pkg)
        const helpKey = `${prefix}${f.name}_help`
        const help = workT(lang, helpKey, '', pkg)
        const v = values[f.name] ?? ''
        const disabled = allDisabled || (!!f.ownerOnly && isOwner === false)
        return (
          <div key={f.name}>
            {f.type === 'members' && members ? (
              <fieldset disabled={disabled}>
                <legend className="block text-xs text-gray-400 mb-1">{label}{f.required && <span className="text-[#E07B53]"> *</span>}</legend>
                <div className="space-y-1 text-sm text-white">
                  {(() => {
                    const picked = memberKeys(v)
                    const set = (key: string, on: boolean) => onChange(f.name, (on ? [...picked, key] : picked.filter((k) => k !== key)).join(','))
                    const gone = picked.filter((k) => !members.some((m) => m.key === k))
                    return (
                      <>
                        {members.map((m) => (
                          <label key={m.key} className="flex items-center gap-2">
                            <input type="checkbox" checked={picked.includes(m.key)} onChange={(e) => set(m.key, e.target.checked)} className="accent-[#E07B53]" />
                            <span>{m.name || m.email}</span>
                            {m.key === 'owner' ? <span className="text-xs text-gray-500">{workT(lang, 'member_owner', 'Owner', pkg)}</span> : m.name && <span className="text-xs text-gray-500">{m.email}</span>}
                          </label>
                        ))}
                        {gone.map((k) => (
                          <label key={k} className="flex items-center gap-2 text-gray-500">
                            <input type="checkbox" checked onChange={() => set(k, false)} className="accent-[#E07B53]" />
                            <span className="line-through">{k}</span>
                            <span className="text-xs text-amber-300">{workT(lang, 'member_gone', 'can no longer open this work app', pkg)}</span>
                          </label>
                        ))}
                        {members.length <= 1 && <p className="text-xs text-gray-500">{workT(lang, 'members_only_owner', '', pkg)}</p>}
                      </>
                    )
                  })()}
                </div>
              </fieldset>
            ) : f.type === 'boolean' ? (
              <fieldset disabled={disabled}>
                <legend className="block text-xs text-gray-400 mb-1">{label}{f.required && <span className="text-[#E07B53]"> *</span>}</legend>
                <div className="flex gap-4 text-sm text-white">
                  {(['yes', 'no'] as const).map((o) => (
                    <label key={o} className="inline-flex items-center gap-2">
                      <input type="radio" name={`${idPrefix}-${f.name}`} checked={v === o} onChange={() => onChange(f.name, o)} className="accent-[#E07B53]" />
                      {workT(lang, o, undefined, pkg)}
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
                  <input value={v} disabled={disabled} onChange={(e) => onChange(f.name, e.target.value)} maxLength={f.maxLength} placeholder={f.example ? workT(lang, 'field_example', 'e.g. {x}', pkg).replace('{x}', f.example) : undefined} inputMode={f.type === 'money' ? 'decimal' : undefined} className={`${fieldInputCls} ${f.type === 'money' ? 'text-right tabular-nums' : ''}`} autoComplete="off" />
                )}
              </label>
            )}
            {help && <p className="mt-1 text-xs text-gray-500 whitespace-pre-line">{help}</p>}
          </div>
        )
      })}
    </>
  )
}

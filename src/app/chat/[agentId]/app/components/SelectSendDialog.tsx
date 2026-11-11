'use client'

import React from 'react'
import { Loader2, Send, X } from 'lucide-react'

export interface SelectSendItem {
  title: string
  details: Array<{ label: string; value: string }>
  flags: string[]
  amount: string
  currency: string
}

const money = (v: string) => { const m = /^(-?)(\d+)(\.\d+)?$/.exec(v.trim()); return m ? `${m[1]}${m[2].replace(/\B(?=(\d{3})+(?!\d))/g, "'")}${m[3] ?? ''}` : v }

export function SelectSendDialog({ title, explain, countLabel, totalLabel, items, totals, note, okLabel, cancelLabel, busy, onOk, onCancel, docUrl }: {
  title: string
  explain: string
  countLabel: string
  totalLabel: string
  items: SelectSendItem[]
  totals: string[]
  note?: string
  okLabel: string
  cancelLabel: string
  busy?: boolean
  onOk: () => void
  onCancel: () => void
  docUrl?: string | null
}) {
  const showDoc = docUrl !== undefined && docUrl !== ''
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 px-3 py-6" onClick={onCancel}>
      <div className="w-full max-w-2xl lg:max-w-[63rem] max-h-full flex flex-col rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#2A2A2A]">
          <Send className="w-4 h-4 text-[#E07B53]" />
          <span className="flex-1 text-sm font-medium text-gray-100">{title}</span>
          <button onClick={onCancel} disabled={busy} className="p-1 text-gray-400 hover:text-white" aria-label={cancelLabel}><X className="w-4 h-4" /></button>
        </div>
        {showDoc && (
          <div className="flex-1 min-h-0 flex flex-col">
            <p className="px-4 py-2 text-xs text-gray-400 whitespace-pre-line border-b border-[#2A2A2A]">{explain}</p>
            <div className="h-[70vh] bg-[#2A2A2A]">
              {docUrl ? <iframe src={docUrl} title={title} className="w-full h-full border-0 bg-white" />
                : <div className="h-full flex items-center justify-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
            </div>
          </div>
        )}
        {!showDoc && <div className="flex-1 min-h-0 overflow-auto scrollbar-soft p-3 sm:p-5 bg-[#141414]">
          <div className="rounded-lg bg-white text-gray-900 shadow-lg overflow-hidden">
            <div className="h-1.5 bg-[#1F2937]" />
            <div className="p-4 sm:p-6">
              <p className="text-[13px] leading-relaxed text-gray-500 whitespace-pre-line">{explain}</p>
              <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
                <div className="rounded-lg bg-gray-100 px-3 py-2.5">
                  <div className="text-[11px] text-gray-500">{countLabel}</div>
                  <div className="text-xl font-bold">{items.length}</div>
                </div>
                <div className="col-span-2 rounded-lg bg-gray-100 px-3 py-2.5">
                  <div className="text-[11px] text-gray-500">{totalLabel}</div>
                  {totals.length ? totals.map((x) => { const [c, ...v] = x.split(' '); return <div key={x} className={`${totals.length > 1 ? 'text-base' : 'text-xl'} font-bold tabular-nums`}>{c} {money(v.join(' '))}</div> }) : <div className="text-xl font-bold">—</div>}
                </div>
              </div>
              <ol className="mt-4 border-t border-gray-200">
                {items.map((it, n) => (
                  <li key={n} className={`flex gap-3 py-2.5 px-1 border-b border-gray-200 ${n % 2 ? 'bg-gray-50' : ''}`}>
                    <span className="w-5 shrink-0 text-xs text-gray-400 pt-0.5 text-right">{n + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold break-words">{it.title || '—'}</span>
                        {it.flags.map((f) => <span key={f} className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold">{f}</span>)}
                      </div>
                      {it.details.length > 0 && (
                        <div className="mt-0.5 text-xs text-gray-500 space-y-0.5">
                          {it.details.map((d) => <div key={d.label} className="break-words"><span className="text-gray-400">{d.label}</span> {d.value}</div>)}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-bold tabular-nums pt-0.5">{it.currency} {money(it.amount)}</span>
                  </li>
                ))}
              </ol>
              {note && <p className="mt-3 text-xs text-amber-700">{note}</p>}
            </div>
          </div>
        </div>}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-[#2A2A2A]">
          <button onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{cancelLabel}</button>
          <button onClick={onOk} disabled={busy || items.length === 0 || docUrl === null} className="px-4 py-2 text-sm rounded-md text-white bg-[#E07B53] hover:opacity-90 disabled:opacity-50">{okLabel}</button>
        </div>
      </div>
    </div>
  )
}

'use client'

import React from 'react'

export function ConfirmDialog({ message, okLabel, cancelLabel, busy, tone = 'danger', onOk, onCancel }: {
  message: string
  okLabel: string
  cancelLabel: string
  busy?: boolean
  tone?: 'danger' | 'primary'
  onOk: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-[#1E1E1E] border border-[#2A2A2A] p-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm text-gray-200 mb-4">{message}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="px-3 py-2 text-sm rounded-md text-gray-300 hover:bg-[#2A2A2A]">{cancelLabel}</button>
          <button onClick={onOk} disabled={busy} className={`px-3 py-2 text-sm rounded-md text-white disabled:opacity-50 ${tone === 'danger' ? 'bg-red-500/90 hover:bg-red-500' : 'bg-[#E07B53] hover:opacity-90'}`}>{okLabel}</button>
        </div>
      </div>
    </div>
  )
}

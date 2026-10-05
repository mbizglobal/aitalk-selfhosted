import React, { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { LIVE_SAVE_MUTE_DAYS } from '../utils/liveSaveConsent'

interface LiveSaveConfirmModalProps {
  isOpen: boolean
  onConfirm: (mute: boolean) => void
  onCancel: () => void
  t: Record<string, string>
}

export const LiveSaveConfirmModal: React.FC<LiveSaveConfirmModalProps> = ({ isOpen, onConfirm, onCancel, t }) => {
  const [mute, setMute] = useState(false)

  useEffect(() => {
    if (!isOpen) setMute(false)
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const muteLabel = (t.live_save_confirm_mute || "Don't show this for {days} days and save directly")
    .replace('{days}', String(LIVE_SAVE_MUTE_DAYS))

  return (
    <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
      <div className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] max-w-md w-full">
        <div className="p-5 flex items-start gap-3">
          <div className="p-2 rounded bg-amber-500/10 shrink-0">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-200">
              {t.live_save_confirm_title || 'This workflow is live'}
            </h2>
            <p className="text-sm text-gray-400 mt-2 leading-relaxed">
              {t.live_save_confirm_message ||
                'It is Active, so saving applies your changes to customers immediately. Save now?'}
            </p>
          </div>
        </div>

        <label className="mx-5 mb-4 flex items-start gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={mute}
            onChange={(e) => setMute(e.target.checked)}
            className="mt-0.5 w-4 h-4 shrink-0 accent-blue-500 cursor-pointer"
          />
          <span className="text-xs text-gray-400">{muteLabel}</span>
        </label>

        <div className="px-5 py-4 border-t border-[#3A3A3A] flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm rounded-md text-gray-300 hover:bg-[#3A3A3A] transition-colors"
          >
            {t.live_save_confirm_cancel || 'Cancel'}
          </button>
          <button
            onClick={() => onConfirm(mute)}
            className="px-4 py-2 text-sm rounded-md bg-blue-600 hover:bg-blue-700 text-white transition-colors"
          >
            {t.live_save_confirm_save || 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

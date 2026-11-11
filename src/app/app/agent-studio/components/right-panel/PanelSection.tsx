'use client'

import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDraggable } from '../../hooks/useDraggable'

interface Props {
  title: string
  icon?: React.ReactNode
  summary: React.ReactNode
  help?: string
  editLabel: string
  doneLabel: string
  children: React.ReactNode | ((close: () => void) => React.ReactNode)
}

export function PanelSection({ title, icon, summary, help, editLabel, doneLabel, children }: Props) {
  const [open, setOpen] = useState(false)
  const { handleDragStart, dragStyle } = useDraggable({ isOpen: open })
  const dialogRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (open) dialogRef.current?.focus() }, [open])
  const close = () => { setOpen(false); openerRef.current?.focus() }

  return (
    <>
      <div>
        <label className="text-sm font-medium text-gray-200 mb-2 block">{title}</label>
        <button
          ref={openerRef}
          type="button"
          onClick={() => setOpen(true)}
          className="w-full flex items-center justify-between gap-2 rounded-md border border-[#3A3A3A] px-3 py-3 text-left text-gray-200 hover:bg-[#3A3A3A] transition-colors"
        >
          <div className="flex flex-col items-start gap-1 flex-1 min-w-0">{summary}</div>
          <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{editLabel}</span>
        </button>
      </div>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 bg-black/40 z-[70] flex items-center justify-center p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); close(); return }
              if (e.key !== 'Tab' || !dialogRef.current) return
              const items = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
              if (!items.length) return
              const first = items[0], last = items[items.length - 1]
              if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { e.preventDefault(); last.focus() }
              else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
            }}
            className="bg-[#2A2A2A] rounded-lg shadow-2xl border border-[#3A3A3A] w-full max-w-2xl max-h-[85vh] flex flex-col outline-none"
            style={dragStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-[#3A3A3A] flex items-center justify-between cursor-move select-none" onMouseDown={handleDragStart}>
              <div className="flex items-center gap-3 min-w-0">
                <GripHorizontal className="w-5 h-5 text-gray-500 shrink-0" />
                {icon}
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-gray-200">{title}</h2>
                  {help && <p className="text-sm text-gray-400 mt-1">{help}</p>}
                </div>
              </div>
              <button type="button" onClick={close} onMouseDown={(e) => e.stopPropagation()} className="p-1 text-gray-400 hover:text-gray-200 shrink-0" aria-label="Close"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 overflow-y-auto space-y-4">{typeof children === 'function' ? children(close) : children}</div>
            <div className="p-4 border-t border-[#3A3A3A] flex justify-end">
              <Button size="sm" onClick={close}>{doneLabel}</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}

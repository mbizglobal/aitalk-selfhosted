'use client'

import React from 'react'
import { Switch } from '@/components/ui/switch'
import type { SelectedToolsState } from '../../types'
import { FileSearch, FileJson, Globe, Zap, ImageIcon, Lock, Sparkles } from 'lucide-react'

export const ToolFieldRole = ({ role, label }: { role: 'pin' | 'ai'; label: string }) =>
  role === 'pin' ? (
    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5">
      <Lock className="w-2.5 h-2.5" />
      {label}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] text-blue-400/90 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5">
      <Sparkles className="w-2.5 h-2.5" />
      {label}
    </span>
  )

export const ToolModeBanner = ({ text }: { text: string }) => (
  <div className="flex items-start gap-2 p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-lg">
    <Sparkles className="w-3.5 h-3.5 text-blue-400 mt-0.5 shrink-0" />
    <p className="text-[11px] text-gray-300 leading-relaxed">{text}</p>
  </div>
)

export const SliderField = ({
  label,
  helper,
  value,
  min,
  max,
  step,
  onChange
}: {
  label: string
  helper?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between text-xs text-gray-400">
      <span>{label}</span>
      <span className="text-gray-200">{value}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full accent-blue-500"
    />
    {helper && <p className="text-[11px] text-gray-500">{helper}</p>}
  </div>
)

export const ToggleRow = ({
  label,
  description,
  checked,
  onCheckedChange,
  extra
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  extra?: React.ReactNode
}) => (
  <div className="flex items-center justify-between gap-4">
    <div>
      <p className="text-sm font-medium text-gray-100">{label}</p>
      {description && <p className="text-xs text-gray-500">{description}</p>}
    </div>
    <div className="flex items-center gap-2">
      {extra}
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  </div>
)

export const ToolBadges = ({ tools }: { tools?: SelectedToolsState | null }) => {
  if (!tools) {
    return <p className="text-xs text-gray-500">선택된 도구가 없습니다.</p>
  }

  const items: Array<{ label: string; active: boolean; icon: React.ReactNode }> = [
    {
      label: 'Source',
      active: tools.source,
      icon: <FileSearch className="w-3.5 h-3.5 text-yellow-400" />
    },
    {
      label: 'MCP',
      active: tools.mcp,
      icon: <FileJson className="w-3.5 h-3.5 text-white" />
    },
    {
      label: 'Web search',
      active: tools.webSearch,
      icon: <Globe className="w-3.5 h-3.5 text-green-400" />
    },
    {
      label: 'Function',
      active: tools.functionCalling,
      icon: <Zap className="w-3.5 h-3.5 text-blue-400" />
    },
    {
      label: 'Image input',
      active: tools.imageInput,
      icon: <ImageIcon className="w-3.5 h-3.5 text-pink-400" />
    },
    {
      label: 'PDF input',
      active: tools.pdfInput,
      icon: <FileJson className="w-3.5 h-3.5 text-orange-400" />
    }
  ]

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs ${
            item.active ? 'bg-blue-500/10 text-blue-300 border border-blue-500/30' : 'bg-[#151515]'
          }`}
        >
          {item.icon}
          {item.label}
        </span>
      ))}
    </div>
  )
}

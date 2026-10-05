'use client'

import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { safeColorValue } from '../utils'

interface ColorFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  defaultColor?: string
}

export function ColorField({
  label,
  value,
  onChange,
  defaultColor = '#000000',
}: ColorFieldProps) {
  const colorInputRef = useRef<HTMLInputElement>(null)
  const safeValue = safeColorValue(value, defaultColor)

  return (
    <div className="space-y-2">
      <Label className="text-sm">{label}</Label>
      <div className="flex gap-2">
        <div className="relative">
          <div
            className="h-10 w-10 shrink-0 cursor-pointer rounded-md border"
            style={{ backgroundColor: safeValue }}
            onClick={() => colorInputRef.current?.click()}
          />
          <input
            ref={colorInputRef}
            type="color"
            value={safeValue}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </div>
        <Input
          type="text"
          value={value}
          onChange={(e) => {
            const newValue = e.target.value
            onChange(newValue)
          }}
          placeholder={defaultColor}
          className="font-mono"
        />
      </div>
    </div>
  )
}

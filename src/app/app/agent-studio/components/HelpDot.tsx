
'use client'

import React from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

interface Props {
  text: string
  size?: 'sm' | 'md'
  glyph?: '!' | '?'
}

export function HelpDot({ text, size = 'sm', glyph = '!' }: Props) {
  const box = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'

  const help = (text || '').trim()
  if (!help) return null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={help}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          className={`inline-flex items-center justify-center ${box} rounded-full bg-gray-700/60 text-gray-300 text-[10px] cursor-help leading-none`}
        >
          {glyph}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        sideOffset={6}
        style={{ backgroundColor: '#2A2A2A', color: '#E5E7EB', border: '1px solid #3A3A3A', zIndex: 200 }}
        className="max-w-[280px] leading-snug shadow-xl"
      >
        {help}
      </TooltipContent>
    </Tooltip>
  )
}

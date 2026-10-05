'use client'

import React from 'react'
import type { WorkflowDebugChildEntry } from '@/lib/workflow'
import { ChildItem } from './ChildItem'

interface StepChildrenProps {
  children: WorkflowDebugChildEntry[]
  translations: {
    llm_call: string
    tool_call: string
    mcp_call: string
    file_search: string
    web_search: string
  }
}

export function StepChildren({ children, translations }: StepChildrenProps) {
  if (!children || children.length === 0) return null

  return (
    <div className="ml-6 mt-1 space-y-1">
      {children.map((child, idx) => (
        <ChildItem key={idx} child={child} translations={translations} />
      ))}
    </div>
  )
}

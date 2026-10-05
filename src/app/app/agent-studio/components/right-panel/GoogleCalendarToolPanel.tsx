'use client'

import React from 'react'
import type { Node } from 'reactflow'
import { CalendarToolPanel } from './CalendarToolPanel'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const GoogleCalendarToolPanel: React.FC<Props> = ({ node, updateNodeData }) => (
  <CalendarToolPanel node={node} updateNodeData={updateNodeData} provider="google_workspace" />
)

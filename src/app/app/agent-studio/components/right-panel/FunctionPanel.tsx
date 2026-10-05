'use client'

import React, { useEffect, useState } from 'react'
import type { Node } from 'reactflow'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Info } from 'lucide-react'
import { FUNCTION_EXAMPLES } from '../../constants'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

export const FunctionPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const [definition, setDefinition] = useState(node.data.functionDefinition || '')
  const [selectedExample, setSelectedExample] = useState<string>('')

  useEffect(() => {
    setDefinition(node.data.functionDefinition || '')
  }, [node.id, node.data.functionDefinition])

  const handleSave = () => {
    updateNodeData({ functionDefinition: definition })
  }

  return (
    <div className="space-y-4">
      {/* Description */}
      <p className="text-sm text-gray-400">
        The model will intelligently decide to call functions based on input it receives from the user.
      </p>

      {/* Definition Header with Examples */}
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-gray-200">Definition</label>
        <select
          value={selectedExample}
          onChange={(e) => {
            setSelectedExample(e.target.value)
            if (e.target.value === "") {
              setDefinition("")
            } else {
              const example = FUNCTION_EXAMPLES.find((ex) => ex.name === e.target.value)
              if (example) {
                setDefinition(JSON.stringify(example.definition, null, 2))
              }
            }
          }}
          className="px-3 py-1.5 border border-blue-500 rounded-md bg-[#2A2A2A] text-blue-400 text-sm hover:bg-[#3A3A3A] focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Examples</option>
          {FUNCTION_EXAMPLES.map((example) => (
            <option key={example.name} value={example.name}>
              {example.label}
            </option>
          ))}
        </select>
      </div>

      {/* JSON Definition Textarea */}
      <div>
        <Textarea
          value={definition}
          onChange={(e) => setDefinition(e.target.value)}
          placeholder={`{
  "name": "function_name",
  "description": "Function description",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
        "param1": {
          "type": "string",
          "description": "Parameter description"
        }
    },
    "additionalProperties": false,
    "required": ["param1"]
  }
}`}
          className="bg-[#1A1A1A] border-[#3A3A3A] text-gray-200 font-mono text-sm min-h-[400px] resize-none placeholder:text-gray-500 placeholder:opacity-70"
          style={{
            fontFamily: 'monospace',
            lineHeight: '1.5'
          }}
        />
      </div>

      {/* Hint */}
      <div className="flex items-start gap-2 p-3 bg-[#1A1A1A] border border-[#3A3A3A] rounded-md">
        <Info className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-gray-400">
          Add <code className="px-1 py-0.5 bg-[#2A2A2A] rounded text-gray-300">"strict": true</code> to ensure the model's response always follows this schema.
        </p>
      </div>
    </div>
  )
}

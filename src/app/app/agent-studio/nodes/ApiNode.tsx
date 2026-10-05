import React from 'react'
import { Handle, Position } from 'reactflow'
import { Webhook } from 'lucide-react'

export const ApiNode: React.FC<any> = ({ data, selected }) => {
  return (
    <div className="relative">
      <div className={`px-3 py-2 bg-[#2A2A2A] border-2 ${selected ? 'border-green-500 shadow-green-500/50' : 'border-[#5A5A5A]'} rounded-xl shadow-lg hover:shadow-xl transition-all`}>
        {/* Input Handle */}
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '6px',
            height: '10px',
            borderRadius: '2px',
            top: '50%',
            left: '-3px',
            transform: 'translateY(-50%)'
          }}
        />

        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded bg-purple-500 flex-shrink-0">
            <Webhook className="w-5 h-5 text-white" />
          </div>
          <div className="text-sm font-medium text-gray-200 whitespace-nowrap">
            {data.label || 'Webhook'}
          </div>
        </div>

        {/* Output Handle */}
        <Handle
          type="source"
          position={Position.Right}
          className="!bg-gray-400 before:content-[''] before:absolute before:inset-[-8px] before:bg-transparent"
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            right: '-3px',
            top: '50%',
            transform: 'translateY(-50%)'
          }}
        />
      </div>
    </div>
  )
}
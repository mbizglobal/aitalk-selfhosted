import React from 'react'
import { Handle, Position } from 'reactflow'
import { Code2, Settings, Play } from 'lucide-react'

export const FunctionCallingNode: React.FC<any> = ({ data, selected }) => {
  return (
    <div className={`
      relative min-w-[200px] rounded-lg border-2 bg-white shadow-md transition-all
      ${selected ? 'border-blue-500 shadow-lg' : 'border-gray-300'}
      hover:shadow-lg
    `}>
      {/* Input Handle */}
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />

      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-indigo-50 rounded-t-md">
        <div className="flex items-center gap-2">
          <Code2 className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-medium text-gray-800">
            {data.label || 'Function Call'}
          </span>
        </div>
        <Settings className="w-3 h-3 text-gray-500" />
      </div>

      {/* Content */}
      <div className="p-3 space-y-2">
        {/* Function Name */}
        {data.functionName && (
          <div className="flex items-center gap-2">
            <Play className="w-3 h-3 text-gray-500" />
            <span className="text-xs font-mono text-gray-700">
              {data.functionName}()
            </span>
          </div>
        )}

        {/* Parameters */}
        {data.parameters && Object.keys(data.parameters).length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-gray-500">Parameters:</div>
            <div className="pl-2 space-y-0.5">
              {Object.entries(data.parameters).slice(0, 3).map(([key, value]: [string, any]) => (
                <div key={key} className="text-xs text-gray-600">
                  <span className="font-medium">{key}:</span> {String(value)}
                </div>
              ))}
              {Object.keys(data.parameters).length > 3 && (
                <div className="text-xs text-gray-400">
                  +{Object.keys(data.parameters).length - 3} more...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Status */}
        {data.status && (
          <div className="flex items-center gap-1 text-xs">
            <div className={`
              w-2 h-2 rounded-full
              ${data.status === 'ready' ? 'bg-gray-400' :
                data.status === 'running' ? 'bg-indigo-500 animate-pulse' :
                data.status === 'success' ? 'bg-green-500' :
                'bg-red-500'}
            `} />
            <span className="text-gray-500 capitalize">{data.status}</span>
          </div>
        )}

        {/* Return Type */}
        {data.returnType && (
          <div className="text-xs text-gray-500">
            Returns: <span className="font-mono">{data.returnType}</span>
          </div>
        )}
      </div>

      {/* Output Handle */}
      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !bg-gray-400 !border-2 !border-white"
      />

      {/* Success Output */}
      {data.hasSuccessOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="success"
          style={{ left: '25%' }}
          className="!w-3 !h-3 !bg-green-500 !border-2 !border-white"
        />
      )}

      {/* Error Output */}
      {data.hasErrorOutput && (
        <Handle
          type="source"
          position={Position.Bottom}
          id="error"
          style={{ left: '75%' }}
          className="!w-3 !h-3 !bg-red-500 !border-2 !border-white"
        />
      )}
    </div>
  )
}
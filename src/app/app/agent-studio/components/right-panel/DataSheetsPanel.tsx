'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Node } from 'reactflow'
import { Database, Plus, RefreshCw, Info, Settings, Wand2, ChevronRight, ChevronDown, FolderOpen, FileText, CheckCircle2, AlertCircle, Eye, EyeOff, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useWorkflowContext } from '../../contexts/WorkflowContext'
import { DataSheetModal } from '../../modals/DataSheetModal'
import { downloadDataSheet, type DownloadFormat } from '../../utils/downloadDataSheet'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'

interface Props {
  node: Node
  updateNodeData: (patch: Record<string, any>) => void
}

interface DataSheetInfo {
  id: string
  name: string
  description: string | null
  rowCount: number
  sizeBytes: number
  schema: {
    columns: Array<{
      name: string
      type: string
      required: boolean
    }>
  }
}

interface VariableNode {
  name: string
  path: string
  type: string
  children?: VariableNode[]
  expanded?: boolean
}

interface FieldMapping {
  columnName: string
  columnType: string
  required: boolean
  variablePath: string
  status: 'mapped' | 'unmapped' | 'type-mismatch'
}

export const DataSheetsPanel: React.FC<Props> = ({ node, updateNodeData }) => {
  const { agent } = useWorkflowContext()
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const [sheets, setSheets] = useState<DataSheetInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [showDataSheetModal, setShowDataSheetModal] = useState(false)
  const [initialSheetId, setInitialSheetId] = useState<string | undefined>(undefined)

  const [showFieldMapping, setShowFieldMapping] = useState(false)
  const [variableTree, setVariableTree] = useState<VariableNode[]>([])
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([])
  const [upsertKey, setUpsertKey] = useState<string>('')
  const [loadingVariables, setLoadingVariables] = useState(false)
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const [autoMapLoading, setAutoMapLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)
  const [showDataEditorModal, setShowDataEditorModal] = useState(false)
  const [tempDataValue, setTempDataValue] = useState('')

  const selectedSheetId = node.data.sheetId || ''
  const operation = node.data.operation || 'read'
  const [filterRaw, setFilterRaw] = React.useState(() => {
    if (node.data.filterRaw !== undefined) {
      return node.data.filterRaw
    }
    if (node.data.filter !== undefined && node.data.filter !== null) {
      return typeof node.data.filter === 'string'
        ? node.data.filter
        : JSON.stringify(node.data.filter, null, 2)
    }
    return ''
  })
  const dataJson = typeof node.data.data === 'string'
    ? node.data.data
    : (node.data.data ? JSON.stringify(node.data.data, null, 2) : '')
  const limit = node.data.limit || 100

  React.useEffect(() => {
    let newFilterRaw = ''
    if (node.data.filterRaw !== undefined) {
      newFilterRaw = node.data.filterRaw
    } else if (node.data.filter !== undefined && node.data.filter !== null) {
      newFilterRaw = typeof node.data.filter === 'string'
        ? node.data.filter
        : JSON.stringify(node.data.filter, null, 2)
    }
    setFilterRaw(newFilterRaw)
  }, [node.data.filter, node.data.filterRaw])

  const loadSheets = async () => {
    if (!agent.agentId) return

    setLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets?agentId=${agent.agentId}`)
      if (response.ok) {
        const data = await response.json()
        setSheets(data.sheets || [])
      }
    } catch (error) {
      console.error('Failed to load sheets:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSheets()
  }, [agent.agentId])

  useEffect(() => {
    const handleClickOutside = () => {
      if (showDownloadMenu) {
        setShowDownloadMenu(false)
      }
    }

    if (showDownloadMenu) {
      document.addEventListener('click', handleClickOutside)
    }

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showDownloadMenu])

  const selectedSheet = sheets.find(s => s.id === selectedSheetId)

  const handleSheetSelect = (sheetId: string) => {
    const sheet = sheets.find(s => s.id === sheetId)
    updateNodeData({
      sheetId: sheetId,
      sheetName: sheet?.name || null
    })
    if (sheet) {
      initializeFieldMappings(sheet)
    }
  }

  const initializeFieldMappings = (sheet: DataSheetInfo) => {
    const mappings: FieldMapping[] = sheet.schema.columns
      .filter(col => col.name !== 'No')
      .map(col => ({
        columnName: col.name,
        columnType: col.type,
        required: col.required,
        variablePath: '',
        status: 'unmapped'
      }))
    setFieldMappings(mappings)
    if (mappings.length > 0) {
      setUpsertKey(mappings[0].columnName)
    }
  }

  const loadVariables = async () => {
    if (!agent.agentId) return

    setLoadingVariables(true)
    try {
      const response = await fetch(`/api/agent-studio/temp-storage?agentId=${agent.agentId}`)
      if (response.ok) {
        const result = await response.json()
        if (result.data?.jsonData) {
          const tree = buildVariableTree(result.data.jsonData, 'jsonData')
          setVariableTree(tree)
        }
      }
    } catch (error) {
      console.error('Failed to load variables:', error)
    } finally {
      setLoadingVariables(false)
    }
  }

  const buildVariableTree = (obj: any, path: string): VariableNode[] => {
    if (obj === null || obj === undefined) return []

    if (Array.isArray(obj)) {
      return [{
        name: path.split('.').pop() || path,
        path: path,
        type: 'array',
        children: obj.length > 0 ? buildVariableTree(obj[0], `${path}[0]`) : []
      }]
    }

    if (typeof obj === 'object') {
      return Object.entries(obj).map(([key, value]) => {
        const fullPath = `${path}.${key}`
        const type = getValueType(value)

        if (type === 'object' || type === 'array') {
          return {
            name: key,
            path: fullPath,
            type: type,
            children: buildVariableTree(value, fullPath)
          }
        }

        return {
          name: key,
          path: fullPath,
          type: type
        }
      })
    }

    return []
  }

  const getValueType = (value: any): string => {
    if (value === null || value === undefined) return 'null'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'object') return 'object'
    if (typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'string') {
      if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value) || /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return 'date'
      }
      return 'string'
    }
    return 'unknown'
  }

  const checkTypeCompatibility = (columnType: string, variableType: string): boolean => {
    if (columnType === variableType) return true
    if (columnType === 'string' && variableType === 'date') return true
    if (columnType === 'text' && ['string', 'date'].includes(variableType)) return true
    if (columnType === 'json' && ['object', 'array'].includes(variableType)) return true
    if (columnType === 'number' && variableType === 'number') return true
    return false
  }

  const autoMapFields = async () => {
    if (!selectedSheet) return

    if (variableTree.length === 0) {
      alert(t.no_data_to_map)
      return
    }

    setAutoMapLoading(true)

    const newMappings = fieldMappings.map(mapping => {
      const columnName = mapping.columnName.toLowerCase()

      const findMatch = (nodes: VariableNode[], parentPath = ''): string => {
        for (const node of nodes) {
          const nodeName = node.name.toLowerCase()

          if (nodeName === columnName) {
            return node.path
          }

          if (nodeName.includes(columnName) || columnName.includes(nodeName)) {
            if (checkTypeCompatibility(mapping.columnType, node.type)) {
              return node.path
            }
          }

          if (node.children) {
            const childMatch = findMatch(node.children, node.path)
            if (childMatch) return childMatch
          }
        }
        return ''
      }

      const matchedPath = findMatch(variableTree)

      if (matchedPath) {
        const matchedNode = findNodeByPath(variableTree, matchedPath)
        const isCompatible = matchedNode ? checkTypeCompatibility(mapping.columnType, matchedNode.type) : false

        return {
          ...mapping,
          variablePath: matchedPath,
          status: isCompatible ? 'mapped' : 'type-mismatch'
        } as FieldMapping
      }

      return mapping
    })

    setFieldMappings(newMappings)
    setAutoMapLoading(false)

    generateJsonFromMappings(newMappings)
  }

  const findNodeByPath = (nodes: VariableNode[], path: string): VariableNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node
      if (node.children) {
        const found = findNodeByPath(node.children, path)
        if (found) return found
      }
    }
    return null
  }

  const generateJsonFromMappings = (mappings: FieldMapping[]) => {
    const dataObj: Record<string, string> = {}

    mappings.forEach(mapping => {
      if (mapping.variablePath) {
        const varRef = `{{${mapping.variablePath}}}`

        if (['number', 'boolean'].includes(mapping.columnType)) {
          dataObj[mapping.columnName] = varRef
        } else if (mapping.columnType === 'json') {
          dataObj[mapping.columnName] = varRef
        } else {
          dataObj[mapping.columnName] = varRef
        }
      }
    })

    updateNodeData({
      data: dataObj,
      ...(operation === 'upsert' ? { filter: {} } : {}),
      fieldMappings: mappings
    })
  }

  const updateFieldMapping = (columnName: string, variablePath: string) => {
    const matchedNode = findNodeByPath(variableTree, variablePath)

    const newMappings = fieldMappings.map(mapping => {
      if (mapping.columnName === columnName) {
        const isCompatible = matchedNode ? checkTypeCompatibility(mapping.columnType, matchedNode.type) : false
        return {
          ...mapping,
          variablePath: variablePath,
          status: variablePath ? (isCompatible ? 'mapped' : 'type-mismatch') : 'unmapped'
        } as FieldMapping
      }
      return mapping
    })

    setFieldMappings(newMappings)
    generateJsonFromMappings(newMappings)
  }

  useEffect(() => {
    if (selectedSheet && ['insert', 'update', 'upsert', 'batch-insert'].includes(operation)) {
      loadVariables()
      initializeFieldMappings(selectedSheet)
    }
  }, [selectedSheetId, operation, sheets])

  useEffect(() => {
    if (showFieldMapping && selectedSheet) {
      if (fieldMappings.length === 0) {
        initializeFieldMappings(selectedSheet)
      }
      const autoMap = async () => {
        await loadVariables()
        setTimeout(() => {
          autoMapFields()
        }, 100)
      }
      autoMap()
    }
  }, [showFieldMapping, selectedSheet])

  const handleFilterChange = (value: string) => {
    setFilterRaw(value)

    if (!value.trim()) {
      updateNodeData({
        filterRaw: '',
        filter: null
      })
      return
    }

    try {
      const parsed = JSON.parse(value)
      updateNodeData({
        filterRaw: value,
        filter: parsed
      })
    } catch (error) {
      updateNodeData({
        filterRaw: value,
        filter: value
      })
    }
  }

  const handleDataChange = (value: string) => {
    if (operation === 'batch-insert') {
      const trimmedValue = value.trim()
      if (trimmedValue.startsWith('{{') && trimmedValue.endsWith('}}')) {
        updateNodeData({ data: trimmedValue })
      } else {
        try {
          const parsed = trimmedValue ? JSON.parse(trimmedValue) : null
          updateNodeData({ data: parsed })
        } catch {
          updateNodeData({ data: trimmedValue || null })
        }
      }
    } else {
      const trimmedValue = value.trim()

      if (!trimmedValue) {
        updateNodeData({ data: null })
        return
      }

      try {
        const parsed = JSON.parse(trimmedValue)
        updateNodeData({ data: parsed })
      } catch {
        updateNodeData({ data: trimmedValue })
      }
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleDownload = async (format: DownloadFormat) => {
    if (!selectedSheet) {
      alert('Please select a sheet first')
      return
    }

    if (selectedSheet.rowCount === 0) {
      alert('No data to download')
      return
    }

    setDownloading(true)
    setShowDownloadMenu(false)

    try {
      await downloadDataSheet(selectedSheet, format)
    } catch (error) {
      console.error('Download failed:', error)
    } finally {
      setDownloading(false)
    }
  }

  const renderVariableTree = (nodes: VariableNode[], depth = 0) => {
    return nodes.map(node => {
      const hasChildren = node.children && node.children.length > 0
      const isExpanded = expandedPaths.has(node.path)

      return (
        <div key={node.path} style={{ marginLeft: `${depth * 12}px` }}>
          <div
            className={`flex items-center gap-1 py-0.5 px-1 rounded cursor-pointer hover:bg-[#3A3A3A] text-xs ${
              hasChildren ? 'text-gray-300' : 'text-gray-400'
            }`}
            onClick={() => {
              if (hasChildren) {
                setExpandedPaths(prev => {
                  const newSet = new Set(prev)
                  if (isExpanded) {
                    newSet.delete(node.path)
                  } else {
                    newSet.add(node.path)
                  }
                  return newSet
                })
              } else if (activeDropdown) {
                updateFieldMapping(activeDropdown, node.path)
                setActiveDropdown(null)
              }
            }}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
            ) : (
              <FileText className="w-3 h-3 text-gray-500" />
            )}
            <span className="font-mono">{node.name}</span>
            <span className="text-[10px] text-gray-500 ml-auto">{node.type}</span>
          </div>
          {hasChildren && isExpanded && renderVariableTree(node.children!, depth + 1)}
        </div>
      )
    })
  }

  return (
    <div className="space-y-4">
      {/* Sheet Selection */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-sm font-medium text-gray-200">{t.data_sheet}</label>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={loadSheets}
              disabled={loading}
              className="h-6 w-6 p-0 text-gray-400 hover:text-white"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setInitialSheetId(undefined)
                setShowDataSheetModal(true)
              }}
              className="h-6 w-6 p-0 text-gray-400 hover:text-white"
              title={t.create_new_sheet}
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <select
          value={selectedSheetId}
          onChange={(e) => handleSheetSelect(e.target.value)}
          className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="">{t.select_sheet}</option>
          {sheets.map(sheet => (
            <option key={sheet.id} value={sheet.id}>
              {sheet.name} ({sheet.rowCount} rows)
            </option>
          ))}
        </select>

        {selectedSheet && (
          <div className="mt-2 p-2 bg-[#1A1A1A] rounded border border-[#3A3A3A]">
            <div className="text-xs text-gray-400 space-y-1">
              <div className="flex justify-between">
                <span>{t.rows}:</span>
                <span className="text-gray-200">{selectedSheet.rowCount}</span>
              </div>
              <div className="flex justify-between">
                <span>{t.size}:</span>
                <span className="text-gray-200">{formatSize(selectedSheet.sizeBytes)}</span>
              </div>
              <div className="mt-2">
                <span className="text-gray-400 block mb-1">{t.columns}:</span>
                <div className="space-y-0.5">
                  {selectedSheet.schema.columns.map(col => (
                    <div key={col.name} className="flex justify-between text-[10px]">
                      <span className="text-gray-300">{col.name}</span>
                      <span className="text-gray-500">
                        {col.type}{col.required ? '*' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Action Buttons */}
              <div className="flex gap-2 mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setInitialSheetId(selectedSheet.id)
                    setShowDataSheetModal(true)
                  }}
                  className="flex-1 h-7 text-xs bg-transparent border-[#3A3A3A] text-gray-300 hover:bg-[#2A2A2A] hover:text-white"
                >
                  <Settings className="w-3 h-3 mr-1" />
                  {t.manage_data}
                </Button>

                {/* Download Button with Dropdown */}
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowDownloadMenu(!showDownloadMenu)
                    }}
                    disabled={downloading || selectedSheet.rowCount === 0}
                    className="h-7 px-2 bg-transparent border-[#3A3A3A] text-gray-300 hover:bg-[#2A2A2A] hover:text-white disabled:opacity-50"
                    title="Download data"
                  >
                    <Download className={`w-3 h-3 ${downloading ? 'animate-bounce' : ''}`} />
                  </Button>

                  {/* Download Format Menu */}
                  {showDownloadMenu && (
                    <div className="absolute right-0 top-full mt-1 w-32 bg-[#2A2A2A] border border-[#3A3A3A] rounded shadow-xl z-50">
                      <button
                        onClick={() => handleDownload('csv')}
                        className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
                      >
                        CSV
                      </button>
                      <button
                        onClick={() => handleDownload('json')}
                        className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
                      >
                        JSON
                      </button>
                      <button
                        onClick={() => handleDownload('excel')}
                        className="w-full px-3 py-1.5 text-xs text-left text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
                      >
                        Excel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Operation */}
      <div>
        <label className="block text-sm font-medium text-gray-200 mb-1.5">{t.operation}</label>
        <select
          value={operation}
          onChange={(e) => updateNodeData({ operation: e.target.value })}
          className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
        >
          <option value="read">{t.read_query_data}</option>
          <option value="insert">{t.insert_add_row}</option>
          <option value="batch-insert">{t.batch_insert}</option>
          <option value="update">{t.update_modify_rows}</option>
          <option value="delete">{t.delete_remove_rows}</option>
          <option value="upsert">{t.upsert}</option>
          <option value="increment">{t.increment}</option>
        </select>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <label className="text-sm font-medium text-gray-200">{t.save_as}</label>
          <div className="group relative">
            <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
            <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-64 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
              {t.save_as_tooltip}<br/><br/>
              {t.save_as_example}<br/><br/>
              {t.save_as_access} {`{{context.currentReceipt}}`}<br/><br/>
              {t.save_as_default}
            </div>
          </div>
        </div>
        <input
          type="text"
          value={node.data.saveAs || ''}
          onChange={(e) => updateNodeData({ saveAs: e.target.value })}
          placeholder={t.variable_name_placeholder}
          className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500 placeholder-gray-600"
        />
      </div>

      {/* Operation-specific fields */}
      {operation === 'read' && (
        <div>
          <label className="block text-sm font-medium text-gray-200 mb-1.5">
            {t.limit}
            <span className="text-xs text-gray-500 ml-2">({t.max_rows_to_return})</span>
          </label>
          <input
            type="number"
            min="1"
            max="1000"
            value={limit}
            onChange={(e) => updateNodeData({ limit: parseInt(e.target.value) || 100 })}
            className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm focus:outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Filter (for read, update, delete only - not for upsert with auto-increment) */}
      {['read', 'update', 'delete', 'increment'].includes(operation) && (
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm font-medium text-gray-200">{t.filter}</label>
            <div className="group relative">
              <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
              <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                {t.filter_tooltip}<br/>
                {`{"merchant": "Starbucks"}`}
              </div>
            </div>
          </div>
          <textarea
            value={filterRaw}
            onChange={(e) => handleFilterChange(e.target.value)}
            placeholder='{"field": "value"}'
            rows={3}
            className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm font-mono focus:outline-none focus:border-blue-500"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        </div>
      )}

      {/* Data (for insert, update, upsert, batch-insert) */}
      {['insert', 'update', 'upsert', 'batch-insert', 'increment'].includes(operation) && (
        <div>
          {/* Field Mapping Toggle */}
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-gray-200">
              {operation === 'batch-insert' ? t.data_array : t.data_label.replace(':', '')}
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowFieldMapping(!showFieldMapping)}
              className="h-6 text-xs text-indigo-400 hover:text-indigo-300 p-1"
            >
              <Wand2 className="w-3 h-3 mr-1" />
              {showFieldMapping ? t.manual_json : t.field_mapping}
            </Button>
          </div>

          {showFieldMapping && selectedSheet ? (
            <div className="space-y-3">
              {/* Upsert Info - Only show if No column exists */}
              {operation === 'upsert' && selectedSheet.schema.columns.some((col: any) => col.name === 'No') && (
                <div className="text-xs text-gray-500 bg-[#1A1A1A] p-2 rounded border border-[#3A3A3A]">
                  <span className="text-indigo-400 font-medium">{t.auto_increment}:</span> {t.auto_increment_desc}
                </div>
              )}

              {/* Field Mapping Table */}
              <div className="border border-[#3A3A3A] rounded overflow-hidden">
                <div className="bg-[#1A1A1A] px-2 py-1 text-[10px] text-gray-500 flex">
                  <span className="flex-1">{t.column}</span>
                  <span className="w-20 text-center">{t.type}</span>
                  <span className="flex-1">{t.variable}</span>
                  <span className="w-6"></span>
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {fieldMappings.map(mapping => (
                    <div key={mapping.columnName} className="flex items-center px-2 py-1.5 border-t border-[#3A3A3A] bg-[#1A1A1A]/50 hover:bg-[#2A2A2A]">
                      <span className="flex-1 text-xs text-gray-300 font-medium">
                        {mapping.columnName}
                        {mapping.required && <span className="text-red-400 ml-0.5">*</span>}
                      </span>
                      <span className="w-20 text-center text-[10px] text-gray-500">
                        {mapping.columnType}
                      </span>
                      <div className="flex-1 relative">
                        <button
                          onClick={() => setActiveDropdown(activeDropdown === mapping.columnName ? null : mapping.columnName)}
                          className="w-full px-2 py-1 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-[10px] text-left truncate hover:border-blue-500 focus:outline-none focus:border-blue-500"
                        >
                          {mapping.variablePath ? (
                            <span className="text-indigo-400 font-mono">{mapping.variablePath.replace('jsonData.', '')}</span>
                          ) : (
                            <span className="text-gray-500">{t.select_variable}</span>
                          )}
                        </button>

                        {/* Variable Dropdown */}
                        {activeDropdown === mapping.columnName && (
                          <div className="absolute left-0 top-full mt-1 w-64 bg-[#2A2A2A] border border-[#3A3A3A] rounded shadow-xl z-50 max-h-48 overflow-y-auto">
                            <div className="p-2">
                              {variableTree.length > 0 ? (
                                renderVariableTree(variableTree)
                              ) : (
                                <div className="text-xs text-gray-500 text-center py-2">
                                  {t.no_variables}<br/>
                                  {t.run_workflow_to_generate}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="w-6 flex justify-center">
                        {mapping.status === 'mapped' && <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />}
                        {mapping.status === 'type-mismatch' && <AlertCircle className="w-3.5 h-3.5 text-yellow-400" />}
                        {mapping.status === 'unmapped' && mapping.required && <AlertCircle className="w-3.5 h-3.5 text-red-400" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mapping Status */}
              <div className="text-xs text-gray-500">
                {fieldMappings.filter(m => m.status === 'mapped').length}/{fieldMappings.length} {t.fields_mapped}
                {fieldMappings.some(m => m.status === 'unmapped' && m.required) && (
                  <span className="text-red-400 ml-2">⚠ {t.required_fields_missing}</span>
                )}
              </div>

              {/* Preview Toggle */}
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreview(!showPreview)}
                  className="w-full h-6 text-xs text-gray-400 hover:text-white justify-center"
                >
                  {showPreview ? <EyeOff className="w-3 h-3 mr-1" /> : <Eye className="w-3 h-3 mr-1" />}
                  {showPreview ? t.hide : t.show} {t.generated_json}
                </Button>

                {showPreview && (
                  <div className="mt-2 space-y-2">
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1">{t.data_label}</label>
                      <pre className="p-2 bg-[#0A0A0A] rounded text-[10px] font-mono text-gray-300 overflow-x-auto max-h-32">
                        {JSON.stringify(node.data.data || {}, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1.5">
                <div className="group relative">
                  <Info className="w-3.5 h-3.5 text-gray-500 cursor-help" />
                  <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block w-56 p-2 bg-gray-800 text-xs text-gray-300 rounded shadow-lg z-10">
                    {operation === 'batch-insert'
                      ? t.batch_insert_tooltip
                      : t.json_object_tooltip
                    }
                  </div>
                </div>
              </div>
              <div
                onClick={() => {
                  setTempDataValue(dataJson)
                  setShowDataEditorModal(true)
                }}
                className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm font-mono cursor-pointer hover:border-blue-500 transition-colors min-h-[60px] max-h-[120px] overflow-y-auto"
              >
                {dataJson ? (
                  <pre className="whitespace-pre-wrap break-all text-xs">{dataJson}</pre>
                ) : (
                  <span className="text-gray-500 text-xs">
                    {operation === 'batch-insert' ? t.click_to_edit_batch : t.click_to_edit_json}
                  </span>
                )}
              </div>
              {operation === 'batch-insert' && (
                <div className="mt-2 text-xs text-gray-500 bg-[#1A1A1A] p-2 rounded border border-[#3A3A3A]">
                  <span className="text-indigo-400 font-medium">{t.batch_insert_label}:</span> {t.batch_insert_info}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Info */}
      <div className="pt-3 border-t border-[#3A3A3A]">
        <div className="flex items-start gap-2 text-xs text-gray-500">
          <Database className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <p className="mb-1">
              {t.results_stored_in} <code className="text-indigo-400">context.dataSheetsResult</code>
            </p>
            <p>
              {t.connect_to_ai_node}
            </p>
          </div>
        </div>
      </div>

      {agent.agentId && (
        <DataSheetModal
          agentId={agent.agentId}
          isOpen={showDataSheetModal}
          onClose={() => {
            setShowDataSheetModal(false)
            setInitialSheetId(undefined)
          }}
          initialSheetId={initialSheetId}
          onSheetCreated={(sheet) => {
            loadSheets()
            handleSheetSelect(sheet.id)
          }}
        />
      )}

      {/* Data Editor Modal - Using Portal */}
      {showDataEditorModal && typeof document !== 'undefined' && createPortal(
        <div
          className="dark fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4"
          onClick={() => setShowDataEditorModal(false)}
        >
          <div
            className="bg-[#2A2A2A] rounded-lg w-full max-w-4xl h-[85vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-[#3A3A3A]">
              <h3 className="text-lg font-semibold text-white">
                {operation === 'batch-insert' ? t.edit_data_array : t.edit_data}
              </h3>
              <button
                onClick={() => setShowDataEditorModal(false)}
                className="text-gray-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="flex-1 p-4 overflow-hidden">
              <textarea
                value={tempDataValue}
                onChange={(e) => setTempDataValue(e.target.value)}
                placeholder={operation === 'batch-insert' ? '{{jsonData.transactions}}' : '{"field": "value"}'}
                className="w-full h-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded-lg text-gray-200 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
                spellCheck={false}
                autoFocus
              />
            </div>

            {operation === 'batch-insert' && (
              <div className="px-4 pb-2">
                <div className="text-xs text-gray-500 bg-[#1A1A1A] p-2 rounded border border-[#3A3A3A]">
                  <span className="text-indigo-400 font-medium">{t.batch_insert_label}:</span> {t.batch_insert_info}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 p-4 border-t border-[#3A3A3A]">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowDataEditorModal(false)
                  setTempDataValue('')
                }}
                className="text-gray-400"
              >
                {t.cancel}
              </Button>
              <Button
                onClick={() => {
                  handleDataChange(tempDataValue)
                  setShowDataEditorModal(false)
                }}
                className="bg-indigo-500 hover:bg-indigo-600 text-white"
              >
                {t.save}
              </Button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

const CreateSheetModal: React.FC<{
  agentId: string
  onClose: () => void
  onCreated: () => void
}> = ({ agentId, onClose, onCreated }) => {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [columns, setColumns] = useState<Array<{ name: string; type: string; required: boolean }>>([
    { name: '', type: 'string', required: false }
  ])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const addColumn = () => {
    setColumns([...columns, { name: '', type: 'string', required: false }])
  }

  const removeColumn = (index: number) => {
    setColumns(columns.filter((_, i) => i !== index))
  }

  const updateColumn = (index: number, field: string, value: any) => {
    const newColumns = [...columns]
    newColumns[index] = { ...newColumns[index], [field]: value }
    setColumns(newColumns)
  }

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Sheet name is required')
      return
    }

    const validColumns = columns.filter(c => c.name.trim())
    if (validColumns.length === 0) {
      setError('At least one column is required')
      return
    }

    setCreating(true)
    setError('')

    try {
      const response = await fetch('/api/agent-studio/data-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          name: name.trim(),
          description: description.trim() || null,
          schema: { columns: validColumns }
        })
      })

      if (response.ok) {
        onCreated()
      } else {
        const data = await response.json()
        setError(data.error || 'Failed to create sheet')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[#2A2A2A] rounded-lg w-full max-w-md p-4 max-h-[80vh] overflow-y-auto">
        <h3 className="text-lg font-semibold text-white mb-4">Create New Data Sheet</h3>

        {error && (
          <div className="mb-4 p-2 bg-red-900/30 border border-red-500/50 rounded text-red-400 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., receipts"
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-gray-200 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-200 mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Store receipt data"
              className="w-full px-3 py-2 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-gray-200 text-sm"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-200">Columns</label>
              <Button
                variant="ghost"
                size="sm"
                onClick={addColumn}
                className="h-6 text-xs text-blue-400 hover:text-blue-300"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>

            <div className="space-y-2">
              {columns.map((col, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <input
                    type="text"
                    value={col.name}
                    onChange={(e) => updateColumn(index, 'name', e.target.value)}
                    placeholder="Column name"
                    className="flex-1 px-2 py-1.5 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-gray-200 text-xs"
                  />
                  <select
                    value={col.type}
                    onChange={(e) => updateColumn(index, 'type', e.target.value)}
                    className="w-24 px-2 py-1.5 bg-[#1A1A1A] border border-[#3A3A3A] rounded text-gray-200 text-xs"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="boolean">Boolean</option>
                    <option value="date">Date</option>
                    <option value="datetime">DateTime</option>
                    <option value="text">Text</option>
                    <option value="json">JSON</option>
                  </select>
                  <label className="flex items-center gap-1 text-xs text-gray-400">
                    <input
                      type="checkbox"
                      checked={col.required}
                      onChange={(e) => updateColumn(index, 'required', e.target.checked)}
                      className="w-3 h-3"
                    />
                    Req
                  </label>
                  {columns.length > 1 && (
                    <button
                      onClick={() => removeColumn(index)}
                      className="text-gray-500 hover:text-red-400"
                    >
                      ×
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={creating}
            className="text-gray-400"
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating}
            className="bg-indigo-500 hover:bg-indigo-600 text-white"
          >
            {creating ? 'Creating...' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  X,
  Plus,
  Database,
  Trash2,
  Edit3,
  Save,
  RefreshCw,
  Search,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Wand2,
  Check,
  Download,
  GripHorizontal
} from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { downloadDataSheet, type DownloadFormat } from '../utils/downloadDataSheet'
import { useLanguage } from '@/hooks/useLanguage'
import { getAgentStudioTranslation } from '@/lib/translations/agent-studio'
import { useWorkflowContext } from '../contexts/WorkflowContext'

interface Column {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'text' | 'json'
  required: boolean
}

interface DataSheet {
  id: string
  name: string
  description?: string
  schema: { columns: Column[] }
  rowCount: number
  sizeBytes: number
  createdAt: string
  updatedAt: string
}

interface DataRow {
  id: string
  data: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface Props {
  agentId: string
  isOpen: boolean
  onClose: () => void
  initialSheetId?: string
  onSheetCreated?: (sheet: DataSheet) => void
}

export const DataSheetModal: React.FC<Props> = ({
  agentId,
  isOpen,
  onClose,
  initialSheetId,
  onSheetCreated
}) => {
  const { lang } = useLanguage()
  const t = getAgentStudioTranslation(lang)
  const { ui } = useWorkflowContext()
  const [activeTab, setActiveTab] = useState<'create' | 'manage'>('create')
  const [sheets, setSheets] = useState<DataSheet[]>([])
  const [selectedSheet, setSelectedSheet] = useState<DataSheet | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Create Sheet State
  const [sheetName, setSheetName] = useState('')
  const [sheetDescription, setSheetDescription] = useState('')
  const [columns, setColumns] = useState<Column[]>([
    { name: '', type: 'string', required: false }
  ])

  // Manage Sheet State
  const [rows, setRows] = useState<DataRow[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [totalRows, setTotalRows] = useState(0)
  const [editingRow, setEditingRow] = useState<string | null>(null)
  const [editingCell, setEditingCell] = useState<{ rowId: string; colName: string } | null>(null)
  const [editData, setEditData] = useState<Record<string, unknown>>({})
  const [newRowData, setNewRowData] = useState<Record<string, unknown>>({})
  const [showAddRow, setShowAddRow] = useState(false)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  // Delete Sheet Confirmation Modal State
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean
    sheetId: string | null
    sheetName: string
  }>({ isOpen: false, sheetId: null, sheetName: '' })
  const [deleteConfirmText, setDeleteConfirmText] = useState('')

  // Cell Content Modal State
  const [cellModal, setCellModal] = useState<{
    isOpen: boolean
    rowId: string | null
    colName: string
    value: string
    isNewRow: boolean
  }>({ isOpen: false, rowId: null, colName: '', value: '', isNewRow: false })

  // Schema Editor Modal State
  const [showSchemaEditor, setShowSchemaEditor] = useState(false)
  const [editingColumns, setEditingColumns] = useState<Column[]>([])

  // Auto-generate columns from Temp Storage
  const [showAutoGenPreview, setShowAutoGenPreview] = useState(false)
  const [autoGenColumns, setAutoGenColumns] = useState<Column[]>([])
  const [tempStorageData, setTempStorageData] = useState<Record<string, unknown> | null>(null)

  // Download state
  const [downloading, setDownloading] = useState(false)
  const [showDownloadMenu, setShowDownloadMenu] = useState(false)

  const { handleDragStart, dragStyle } = useDraggable({ isOpen: isOpen })

  const rowsPerPage = 20

  // Load sheets
  useEffect(() => {
    if (isOpen && agentId) {
      loadSheets()
      if (initialSheetId) {
        setActiveTab('manage')
      }
    }
  }, [isOpen, agentId, initialSheetId])

  // Load selected sheet data
  useEffect(() => {
    if (selectedSheet) {
      loadRows()
    }
  }, [selectedSheet, currentPage])

  // Set initial sheet
  useEffect(() => {
    if (initialSheetId && sheets.length > 0) {
      const sheet = sheets.find(s => s.id === initialSheetId)
      if (sheet) {
        setSelectedSheet(sheet)
        setActiveTab('manage')
      }
    }
  }, [initialSheetId, sheets])

  // Close download menu on outside click
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

  const loadSheets = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/agent-studio/data-sheets?agentId=${agentId}`)
      if (response.ok) {
        const data = await response.json()
        setSheets(data.sheets || [])
      }
    } catch {
      setError(t.failed_load_sheet_list)
    } finally {
      setLoading(false)
    }
  }

  const loadRows = async () => {
    if (!selectedSheet) return
    try {
      setLoading(true)
      const response = await fetch(
        `/api/agent-studio/data-sheets/${selectedSheet.id}/rows?page=${currentPage}&limit=${rowsPerPage}`
      )
      if (response.ok) {
        const result = await response.json()
        const formattedRows = (result.rows || []).map((row: { id: string; rowData: Record<string, unknown>; createdAt: string; updatedAt: string }) => ({
          id: row.id,
          data: row.rowData,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }))
        setRows(formattedRows)
        setTotalRows(result.pagination?.totalCount || 0)
      }
    } catch {
      setError(t.failed_load_data)
    } finally {
      setLoading(false)
    }
  }

  const createSheet = async () => {
    if (!sheetName.trim()) {
      setError(t.please_enter_sheet_name)
      return
    }

    const validColumns = columns.filter(c => c.name.trim())
    if (validColumns.length === 0) {
      setError(t.please_define_column)
      return
    }

    try {
      setLoading(true)
      setError(null)
      const response = await fetch('/api/agent-studio/data-sheets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          name: sheetName,
          description: sheetDescription,
          schema: { columns: validColumns }
        })
      })

      if (response.ok) {
        const { sheet } = await response.json()
        setSheets(prev => [...prev, sheet])
        onSheetCreated?.(sheet)
        // Reset form
        setSheetName('')
        setSheetDescription('')
        setColumns([{ name: '', type: 'string', required: false }])
        // Switch to manage tab
        setSelectedSheet(sheet)
        setActiveTab('manage')
      } else {
        const data = await response.json()
        setError(data.error || t.failed_create_sheet)
      }
    } catch {
      setError(t.error_creating_sheet)
    } finally {
      setLoading(false)
    }
  }

  const addColumn = () => {
    setColumns([...columns, { name: '', type: 'string', required: false }])
  }

  const removeColumn = (index: number) => {
    if (columns.length > 1) {
      setColumns(columns.filter((_, i) => i !== index))
    }
  }

  const updateColumn = (index: number, field: keyof Column, value: string | boolean) => {
    const newColumns = [...columns]
    newColumns[index] = { ...newColumns[index], [field]: value }
    setColumns(newColumns)
  }

  // Fetch Temp Storage data and extract column definitions
  const fetchTempStorageColumns = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/agent-studio/temp-storage?agentId=${agentId}`)

      if (!response.ok) {
        setError(t.failed_fetch_temp_storage)
        return
      }

      const { data } = await response.json()

      if (!data || !data.jsonData) {
        setError(t.no_temp_storage_data)
        return
      }

      const jsonData = data.jsonData
      let dataToAnalyze: Record<string, unknown> = {}

      if (Array.isArray(jsonData) && jsonData.length > 0) {
        dataToAnalyze = jsonData[jsonData.length - 1]
      } else if (typeof jsonData === 'object' && jsonData !== null) {
        dataToAnalyze = jsonData as Record<string, unknown>
      } else {
        setError(t.temp_storage_format_not_supported)
        return
      }

      const flattenObject = (obj: Record<string, unknown>): Array<{ key: string; value: unknown }> => {
        const result: Array<{ key: string; value: unknown }> = []

        for (const [key, value] of Object.entries(obj)) {
          if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            result.push(...flattenObject(value as Record<string, unknown>))
          } else if (Array.isArray(value)) {
            result.push({ key, value })
          } else {
            result.push({ key, value })
          }
        }

        return result
      }

      const flattenedData = flattenObject(dataToAnalyze)
      const extractedColumns: Column[] = [
        { name: 'No', type: 'number', required: false },
        ...flattenedData
          .filter(({ key }) => key !== 'isConfirmed')
          .map(({ key, value }) => {
          let type: Column['type'] = 'string'

          if (typeof value === 'number') {
            type = 'number'
          } else if (typeof value === 'boolean') {
            type = 'boolean'
          } else if (Array.isArray(value)) {
            type = 'json'
          } else if (typeof value === 'string') {
            if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
              type = 'datetime'
            } else if (/^\d{4}-\d{2}-\d{2}$/.test(value) || /^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
              type = 'date'
            } else if (value.length > 255) {
              type = 'text'
            }
          }

          return {
            name: key,
            type,
            required: false
          }
        })
      ]

      if (extractedColumns.length === 0) {
        setError(t.no_columns_found)
        return
      }

      setTempStorageData(dataToAnalyze)
      setAutoGenColumns(extractedColumns)
      setShowAutoGenPreview(true)
    } catch {
      setError(t.failed_analyze_temp_storage)
    } finally {
      setLoading(false)
    }
  }

  // Apply auto-generated columns
  const applyAutoGenColumns = () => {
    setColumns(autoGenColumns)
    setShowAutoGenPreview(false)
    setAutoGenColumns([])
    setTempStorageData(null)
  }

  const openDeleteConfirmation = (sheetId: string, sheetName: string) => {
    setDeleteConfirmModal({ isOpen: true, sheetId, sheetName })
    setDeleteConfirmText('')
  }

  const closeDeleteConfirmation = () => {
    setDeleteConfirmModal({ isOpen: false, sheetId: null, sheetName: '' })
    setDeleteConfirmText('')
  }

  const deleteSheet = async () => {
    if (deleteConfirmText !== 'DELETE') {
      return
    }

    const sheetId = deleteConfirmModal.sheetId
    if (!sheetId) return

    try {
      setLoading(true)
      const response = await fetch(`/api/agent-studio/data-sheets/${sheetId}`, {
        method: 'DELETE'
      })

      if (response.ok) {
        setSheets(prev => prev.filter(s => s.id !== sheetId))
        if (selectedSheet?.id === sheetId) {
          setSelectedSheet(null)
          setRows([])
        }
        closeDeleteConfirmation()
      }
    } catch {
      setError(t.failed_delete_sheet_error)
    } finally {
      setLoading(false)
    }
  }

  // Download handler
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

  const saveRow = async (rowId: string) => {
    if (!selectedSheet) return

    try {
      setLoading(true)
      const response = await fetch(
        `/api/agent-studio/data-sheets/${selectedSheet.id}/rows/${rowId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowData: editData })
        }
      )

      if (response.ok) {
        setEditingRow(null)
        setEditingCell(null)
        loadRows()
      } else {
        const result = await response.json()
        setError(result.error || t.failed_save_data_error)
      }
    } catch {
      setError(t.failed_save_data_error)
    } finally {
      setLoading(false)
    }
  }

  const saveCellValue = async (rowId: string, colName: string, value: unknown) => {
    if (!selectedSheet) return

    const currentRow = rows.find(r => r.id === rowId)
    if (!currentRow) return

    const updatedData = { ...currentRow.data, [colName]: value }

    try {
      setLoading(true)
      const response = await fetch(
        `/api/agent-studio/data-sheets/${selectedSheet.id}/rows/${rowId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowData: updatedData })
        }
      )

      if (response.ok) {
        setEditingCell(null)
        loadRows()
      } else {
        const result = await response.json()
        setError(result.error || t.failed_save_cell)
      }
    } catch {
      setError(t.failed_save_cell)
    } finally {
      setLoading(false)
    }
  }

  const openCellModal = (rowId: string | null, colName: string, value: string, isNewRow: boolean = false) => {
    setCellModal({
      isOpen: true,
      rowId,
      colName,
      value: String(value || ''),
      isNewRow
    })
  }

  const closeCellModal = () => {
    setCellModal({ isOpen: false, rowId: null, colName: '', value: '', isNewRow: false })
  }

  const saveCellModal = async () => {
    if (cellModal.isNewRow) {
      setNewRowData(prev => ({ ...prev, [cellModal.colName]: cellModal.value }))
    } else if (cellModal.rowId) {
      await saveCellValue(cellModal.rowId, cellModal.colName, cellModal.value)
    }
    closeCellModal()
  }

  // Schema Editor Functions
  const openSchemaEditor = () => {
    if (selectedSheet) {
      setEditingColumns([...selectedSheet.schema.columns])
      setShowSchemaEditor(true)
    }
  }

  const addEditingColumn = () => {
    setEditingColumns([...editingColumns, { name: '', type: 'string', required: false }])
  }

  const removeEditingColumn = (index: number) => {
    if (editingColumns.length > 1) {
      const columnName = editingColumns[index].name
      const hasData = selectedSheet && selectedSheet.rowCount > 0

      if (hasData && columnName) {
        const confirmed = confirm(
          t.confirm_delete_column.replace('{columnName}', columnName).replace('{rowCount}', String(selectedSheet.rowCount))
        )
        if (!confirmed) return
      }

      setEditingColumns(editingColumns.filter((_, i) => i !== index))
    }
  }

  const updateEditingColumn = (index: number, field: keyof Column, value: string | boolean) => {
    const newColumns = [...editingColumns]
    newColumns[index] = { ...newColumns[index], [field]: value }
    setEditingColumns(newColumns)
  }

  const saveSchemaChanges = async () => {
    if (!selectedSheet) return

    const validColumns = editingColumns.filter(c => c.name.trim())
    if (validColumns.length === 0) {
      setError(t.at_least_one_column)
      return
    }

    const columnNames = validColumns.map(c => c.name.trim())
    const uniqueNames = new Set(columnNames)
    if (columnNames.length !== uniqueNames.size) {
      setError(t.column_names_unique)
      return
    }

    try {
      setLoading(true)
      const response = await fetch(`/api/agent-studio/data-sheets/${selectedSheet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schema: { columns: validColumns }
        })
      })

      if (response.ok) {
        const { sheet } = await response.json()
        setSelectedSheet(sheet)
        setSheets(prev => prev.map(s => s.id === sheet.id ? sheet : s))
        setShowSchemaEditor(false)
        setError(null)
      } else {
        const result = await response.json()
        setError(result.error || t.failed_update_schema_error)
      }
    } catch {
      setError(t.failed_update_schema_error)
    } finally {
      setLoading(false)
    }
  }

  const addRow = async () => {
    if (!selectedSheet) return

    try {
      setLoading(true)
      const response = await fetch(
        `/api/agent-studio/data-sheets/${selectedSheet.id}/rows`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowData: newRowData })
        }
      )

      if (response.ok) {
        setShowAddRow(false)
        setNewRowData({})
        loadRows()
        loadSheets() // Update row count
      } else {
        const result = await response.json()
        setError(result.error || result.details?.join(', ') || t.failed_add_row)
      }
    } catch {
      setError(t.failed_add_row)
    } finally {
      setLoading(false)
    }
  }

  const deleteRow = async (rowId: string) => {
    if (!selectedSheet) return
    if (!confirm(t.confirm_delete_row)) return

    try {
      setLoading(true)
      const response = await fetch(
        `/api/agent-studio/data-sheets/${selectedSheet.id}/rows/${rowId}`,
        {
          method: 'DELETE'
        }
      )

      if (response.ok) {
        setSelectedRows(prev => {
          const newSet = new Set(prev)
          newSet.delete(rowId)
          return newSet
        })
        loadRows()
        loadSheets() // Update row count
      }
    } catch {
      setError(t.failed_delete_row)
    } finally {
      setLoading(false)
    }
  }

  const toggleRowSelection = (rowId: string) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev)
      if (newSet.has(rowId)) {
        newSet.delete(rowId)
      } else {
        newSet.add(rowId)
      }
      return newSet
    })
  }

  const toggleAllRows = () => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(rows.map(r => r.id)))
    }
  }

  const deleteSelectedRows = async () => {
    if (!selectedSheet || selectedRows.size === 0) return

    const count = selectedRows.size
    if (!confirm(t.confirm_delete_selected_rows.replace('{count}', String(count)))) {
      return
    }

    try {
      setLoading(true)
      const deletePromises = Array.from(selectedRows).map(rowId =>
        fetch(`/api/agent-studio/data-sheets/${selectedSheet.id}/rows/${rowId}`, {
          method: 'DELETE'
        })
      )

      await Promise.all(deletePromises)
      setSelectedRows(new Set())
      loadRows()
      loadSheets()
    } catch {
      setError(t.failed_delete_selected)
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  // Helper: Get placeholder and input type for column
  const getInputProps = (col: Column) => {
    switch (col.type) {
      case 'number':
        return {
          placeholder: 'e.g. 123.45',
          type: 'number',
          step: 'any'
        }
      case 'date':
        return {
          placeholder: 'YYYY-MM-DD',
          type: 'date'
        }
      case 'datetime':
        return {
          placeholder: 'YYYY-MM-DDTHH:MM',
          type: 'datetime-local'
        }
      case 'boolean':
        return {
          placeholder: 'true or false',
          type: 'text'
        }
      case 'string':
        return {
          placeholder: 'Text...',
          type: 'text'
        }
      case 'text':
        return {
          placeholder: 'Long text...',
          type: 'text'
        }
      case 'json':
        return {
          placeholder: '{"key": "value"}',
          type: 'text'
        }
      default:
        return {
          placeholder: col.type,
          type: 'text'
        }
    }
  }

  // Helper: Convert input value to proper type
  const convertInputValue = (value: string, type: Column['type']): unknown => {
    if (value === '') return value

    switch (type) {
      case 'number':
        const num = parseFloat(value)
        return isNaN(num) ? value : num
      case 'boolean':
        if (value.toLowerCase() === 'true') return true
        if (value.toLowerCase() === 'false') return false
        return value
      case 'json':
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      default:
        return value
    }
  }

  // Helper: Format value for display in input
  const formatValueForInput = (value: unknown, type: Column['type']): string => {
    if (value === null || value === undefined) return ''

    switch (type) {
      case 'json':
        if (typeof value === 'object') {
          return JSON.stringify(value)
        }
        return String(value)
      case 'boolean':
        return String(value)
      default:
        return String(value)
    }
  }

  if (!isOpen) return null

  // Delete Confirmation Dialog
  const deleteConfirmDialog = deleteConfirmModal.isOpen && (
    <div className="fixed inset-0 bg-black/70 z-[10000] flex items-center justify-center p-4">
      <div className="bg-[#1E1E1E] rounded-lg shadow-2xl border border-red-500/30 max-w-md w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-white mb-1">{t.delete_entire_sheet}</h3>
            <p className="text-sm text-gray-400">
              {t.delete_sheet_warning} <span className="text-white font-medium">"{deleteConfirmModal.sheetName}"</span> {t.and_all} <span className="text-white font-medium">{selectedSheet?.rowCount || 0} {t.rows}</span>.
            </p>
          </div>
        </div>

        <div className="mb-4">
          <Label className="text-sm text-gray-300 mb-2 block">
            {t.type_delete_to_confirm}
          </Label>
          <Input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="DELETE"
            className="bg-[#2A2A2A] border-gray-700 text-white font-mono"
            autoFocus
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={closeDeleteConfirmation}
            className="text-gray-400 hover:text-white"
          >
            {t.cancel}
          </Button>
          <Button
            onClick={deleteSheet}
            disabled={deleteConfirmText !== 'DELETE' || loading}
            className={`${
              deleteConfirmText === 'DELETE'
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            {loading ? t.deleting : t.delete_sheet}
          </Button>
        </div>
      </div>
    </div>
  )

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70">
      <div
        className="w-[1200px] max-h-[90vh] bg-[#1E1E1E] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-[#3A3A3A]"
        style={dragStyle}
      >
        <div
          className="flex items-center justify-between px-6 py-4 border-b border-[#3A3A3A] bg-[#2A2A2A] cursor-move select-none"
          onMouseDown={handleDragStart}
        >
          <div className="flex items-center gap-3">
            <GripHorizontal className="w-5 h-5 text-gray-500" />
            <Database className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-gray-100">{t.data_sheets}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-gray-400 hover:text-white hover:bg-[#3A3A3A]">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-900/30 border border-red-700 rounded-md flex items-center gap-2 text-red-400">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'create' | 'manage')} className="h-full flex flex-col">
            <div className="px-6 pt-4">
              <TabsList className="w-full bg-[#2A2A2A] border border-[#3A3A3A]">
                <TabsTrigger value="create" className="flex-1 data-[state=active]:bg-[#3A3A3A] data-[state=active]:text-white text-gray-400">
                  <Plus className="w-4 h-4 mr-2" />
                  {t.create_new_sheet}
                </TabsTrigger>
                <TabsTrigger value="manage" className="flex-1 data-[state=active]:bg-[#3A3A3A] data-[state=active]:text-white text-gray-400">
                  <Database className="w-4 h-4 mr-2" />
                  {t.manage_sheets}
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
              {/* Create Tab */}
              <TabsContent value="create" className="mt-0">
                <div className="space-y-6">
                  {/* Sheet Info */}
                  <div className="space-y-4">
                    <div>
                      <Label className="text-gray-300">{t.sheet_name} *</Label>
                      <Input
                        value={sheetName}
                        onChange={(e) => setSheetName(e.target.value)}
                        placeholder={t.sheet_name_placeholder}
                        className="mt-1 bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 placeholder:text-gray-500"
                      />
                    </div>
                    <div>
                      <Label className="text-gray-300">{t.description}</Label>
                      <Input
                        value={sheetDescription}
                        onChange={(e) => setSheetDescription(e.target.value)}
                        placeholder={t.description_placeholder}
                        className="mt-1 bg-[#2A2A2A] border-[#3A3A3A] text-gray-200 placeholder:text-gray-500"
                      />
                    </div>
                  </div>

                  {/* Column Definition */}
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <Label className="text-gray-300">{t.column_definition}</Label>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={fetchTempStorageColumns}
                          disabled={loading}
                          className="border-indigo-500 text-indigo-400 hover:bg-indigo-900/30 hover:text-indigo-300"
                        >
                          <Wand2 className="w-4 h-4 mr-1" />
                          {t.auto_from_temp_storage}
                        </Button>
                        <Button variant="outline" size="sm" onClick={addColumn} className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white">
                          <Plus className="w-4 h-4 mr-1" />
                          {t.add_column}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-3 max-h-[400px] overflow-y-auto scrollbar-thin">
                      {columns.map((col, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-[#2A2A2A] rounded-md border border-[#3A3A3A]">
                          <div className="flex-1">
                            <Input
                              value={col.name}
                              onChange={(e) => updateColumn(index, 'name', e.target.value)}
                              placeholder={t.column_name}
                              className="text-sm bg-[#1E1E1E] border-[#3A3A3A] text-gray-200 placeholder:text-gray-500"
                            />
                          </div>
                          <div className="w-32">
                            <select
                              value={col.type}
                              onChange={(e) => updateColumn(index, 'type', e.target.value)}
                              className="w-full px-2 py-2 text-sm border border-[#3A3A3A] rounded-md bg-[#1E1E1E] text-gray-200"
                            >
                              <option value="string">String</option>
                              <option value="number">Number</option>
                              <option value="boolean">Boolean</option>
                              <option value="date">Date</option>
                              <option value="datetime">DateTime</option>
                              <option value="text">Text</option>
                              <option value="json">JSON</option>
                            </select>
                          </div>
                          <label className="flex items-center gap-1 text-sm text-gray-300">
                            <input
                              type="checkbox"
                              checked={col.required}
                              onChange={(e) => updateColumn(index, 'required', e.target.checked)}
                              className="rounded border-[#3A3A3A] bg-[#1E1E1E]"
                            />
                            {t.required}
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeColumn(index)}
                            disabled={columns.length === 1}
                            className="hover:bg-[#3A3A3A]"
                          >
                            <Trash2 className="w-4 h-4 text-red-400" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Create Button */}
                  <div className="pt-4 border-t border-[#3A3A3A]">
                    <Button
                      onClick={createSheet}
                      disabled={loading}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
                    >
                      {loading ? (
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      {t.create_sheet}
                    </Button>
                  </div>
                </div>
              </TabsContent>

              {/* Manage Tab */}
              <TabsContent value="manage" className="mt-0">
                <div className="h-full">
                  {selectedSheet ? (
                    <div className="space-y-3">
                      {/* Compact Sheet Info Header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <h3 className="font-semibold text-gray-100">{selectedSheet.name}</h3>
                          <span className="text-xs text-gray-500">
                            {selectedSheet.rowCount} rows • {formatBytes(selectedSheet.sizeBytes)}
                          </span>
                          {selectedRows.size > 0 && (
                            <span className="text-xs text-indigo-400">
                              ({selectedRows.size} {t.selected})
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {selectedRows.size > 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={deleteSelectedRows}
                              className="text-red-400 hover:text-red-300 hover:bg-red-900/30 px-2 py-1 h-auto text-xs"
                              disabled={loading}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              {t.delete_action} {selectedRows.size}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={openSchemaEditor}
                            className="text-blue-400 hover:text-blue-300 hover:bg-blue-900/30 p-1 h-auto"
                            title={t.edit_schema}
                          >
                            <Edit3 className="w-3 h-3" />
                          </Button>
                          {/* Download Button */}
                          <div className="relative" onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                setShowDownloadMenu(!showDownloadMenu)
                              }}
                              disabled={downloading || selectedSheet.rowCount === 0}
                              className="text-green-400 hover:text-green-300 hover:bg-green-900/30 p-1 h-auto"
                              title={t.download_data}
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
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={loadSheets}
                            className="text-gray-400 hover:text-white hover:bg-[#3A3A3A] p-1 h-auto"
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className={`p-1 h-auto ${
                              selectedRows.size > 0
                                ? 'text-gray-700 cursor-not-allowed opacity-50'
                                : 'text-gray-500 hover:text-gray-400 hover:bg-gray-800/30'
                            }`}
                            onClick={() => {
                              if (selectedRows.size === 0) {
                                openDeleteConfirmation(selectedSheet.id, selectedSheet.name)
                              }
                            }}
                            disabled={selectedRows.size > 0}
                            title={selectedRows.size > 0 ? t.unselect_rows_first : t.delete_entire_sheet}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>

                      {/* Data Table with Inline Add Row */}
                      <div className="border border-[#3A3A3A] rounded-md overflow-hidden">
                        <div className="overflow-x-auto max-h-[500px]">
                          <table className="w-full text-sm">
                            <thead className="bg-[#2A2A2A] sticky top-0 z-10">
                              <tr>
                                <th className="px-2 py-2 w-10">
                                  <input
                                    type="checkbox"
                                    checked={rows.length > 0 && selectedRows.size === rows.length}
                                    onChange={toggleAllRows}
                                    className="rounded border-[#3A3A3A] bg-[#1E1E1E] text-indigo-600"
                                    title={t.select_all}
                                  />
                                </th>
                                {selectedSheet.schema.columns.map((col) => (
                                  <th
                                    key={col.name}
                                    className="px-3 py-2 text-left font-medium text-gray-300 min-w-[120px]"
                                  >
                                    {col.name}
                                  </th>
                                ))}
                                <th className="px-3 py-2 text-left font-medium text-gray-300 w-16">

                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {/* Add New Row - At top */}
                              <tr className="border-b-2 border-green-700 bg-green-900/10">
                                <td className="px-2 py-2"></td>
                                {selectedSheet.schema.columns.map((col) => {
                                  const cellValue = formatValueForInput(newRowData[col.name], col.type)
                                  const isLongContent = col.type === 'json' || col.type === 'text'
                                  const inputProps = getInputProps(col)

                                  return (
                                    <td key={col.name} className="px-3 py-2">
                                      {isLongContent ? (
                                        <div
                                          className="cursor-pointer hover:bg-[#3A3A3A] rounded px-1 py-0.5 min-h-[32px] flex items-center border border-dashed border-green-600"
                                          onClick={() => openCellModal(null, col.name, cellValue, true)}
                                        >
                                          <span className="text-gray-400 text-xs">
                                            {cellValue ? cellValue.substring(0, 30) + '...' : inputProps.placeholder}
                                          </span>
                                        </div>
                                      ) : col.type === 'boolean' ? (
                                        <select
                                          value={cellValue}
                                          onChange={(e) =>
                                            setNewRowData({
                                              ...newRowData,
                                              [col.name]: convertInputValue(e.target.value, col.type)
                                            })
                                          }
                                          className="w-full px-2 py-1 text-sm border border-green-600 rounded-md bg-[#1E1E1E] text-gray-200"
                                        >
                                          <option value="">Select...</option>
                                          <option value="true">true</option>
                                          <option value="false">false</option>
                                        </select>
                                      ) : (
                                        <Input
                                          type={inputProps.type}
                                          step={inputProps.step}
                                          value={cellValue}
                                          onChange={(e) =>
                                            setNewRowData({
                                              ...newRowData,
                                              [col.name]: convertInputValue(e.target.value, col.type)
                                            })
                                          }
                                          placeholder={`${inputProps.placeholder}${col.required ? ' *' : ''}`}
                                          className="text-sm py-1 bg-[#1E1E1E] border-green-600 text-gray-200 placeholder:text-gray-600"
                                        />
                                      )}
                                    </td>
                                  )
                                })}
                                <td className="px-3 py-2">
                                  <Button
                                    onClick={addRow}
                                    disabled={loading}
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700 text-white text-xs px-2 py-1 h-auto"
                                  >
                                    {t.add}
                                  </Button>
                                </td>
                              </tr>

                              {/* Existing Rows */}
                              {rows.map((row) => (
                                <tr key={row.id} className={`border-t border-[#3A3A3A] hover:bg-[#2A2A2A] ${selectedRows.has(row.id) ? 'bg-indigo-900/20' : ''}`}>
                                  <td className="px-2 py-2">
                                    <input
                                      type="checkbox"
                                      checked={selectedRows.has(row.id)}
                                      onChange={() => toggleRowSelection(row.id)}
                                      className="rounded border-[#3A3A3A] bg-[#1E1E1E] text-indigo-600"
                                    />
                                  </td>
                                  {selectedSheet.schema.columns.map((col) => {
                                    const cellValue = String(row.data[col.name] || '')
                                    const isLongContent = cellValue.length > 50 || col.type === 'json' || col.type === 'text'
                                    const isEditing = editingCell?.rowId === row.id && editingCell?.colName === col.name

                                    return (
                                      <td key={col.name} className="px-3 py-2">
                                        {isEditing ? (
                                          <Input
                                            value={editData[col.name] as string || ''}
                                            onChange={(e) =>
                                              setEditData({
                                                ...editData,
                                                [col.name]: e.target.value
                                              })
                                            }
                                            onBlur={() => {
                                              saveCellValue(row.id, col.name, editData[col.name])
                                            }}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter') {
                                                saveCellValue(row.id, col.name, editData[col.name])
                                              } else if (e.key === 'Escape') {
                                                setEditingCell(null)
                                              }
                                            }}
                                            autoFocus
                                            className="text-sm py-1 bg-[#1E1E1E] border-indigo-500 text-gray-200"
                                          />
                                        ) : (
                                          <div
                                            className="cursor-pointer hover:bg-[#3A3A3A] rounded px-1 py-0.5 min-h-[24px] flex items-center group"
                                            onClick={() => {
                                              if (isLongContent) {
                                                openCellModal(row.id, col.name, cellValue, false)
                                              } else {
                                                setEditingCell({ rowId: row.id, colName: col.name })
                                                setEditData({ ...row.data })
                                              }
                                            }}
                                          >
                                            <span className="text-gray-200 truncate max-w-[200px]">
                                              {cellValue || <span className="text-gray-600 italic">{t.empty}</span>}
                                            </span>
                                            {isLongContent && cellValue && (
                                              <span className="ml-1 text-xs text-gray-500 opacity-0 group-hover:opacity-100">
                                                ...
                                              </span>
                                            )}
                                          </div>
                                        )}
                                      </td>
                                    )
                                  })}
                                  <td className="px-3 py-2">
                                    {selectedRows.size === 0 && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => deleteRow(row.id)}
                                        className="hover:bg-red-900/30 p-1 h-auto"
                                      >
                                        <Trash2 className="w-3 h-3 text-red-400" />
                                      </Button>
                                    )}
                                  </td>
                                </tr>
                              ))}

                              {rows.length === 0 && (
                                <tr>
                                  <td
                                    colSpan={selectedSheet.schema.columns.length + 2}
                                    className="px-3 py-8 text-center text-gray-500"
                                  >
                                    {t.no_data_add_first_row}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Pagination */}
                      {totalRows > rowsPerPage && (
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-gray-400">
                            {t.showing} {(currentPage - 1) * rowsPerPage + 1}-
                            {Math.min(currentPage * rowsPerPage, totalRows)} {t.of} {totalRows}
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                              disabled={currentPage === 1}
                              className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
                            >
                              <ChevronLeft className="w-4 h-4" />
                            </Button>
                            <span className="text-sm text-gray-300">
                              {currentPage} / {Math.ceil(totalRows / rowsPerPage)}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                setCurrentPage((p) =>
                                  Math.min(Math.ceil(totalRows / rowsPerPage), p + 1)
                                )
                              }
                              disabled={currentPage >= Math.ceil(totalRows / rowsPerPage)}
                              className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-4">
                      <Database className="w-12 h-12 text-gray-600" />
                      <div className="text-center">
                        <p className="text-lg font-medium text-gray-400">{t.no_sheet_selected}</p>
                        <p className="text-sm">{t.create_or_select_sheet}</p>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>

      {/* Auto-generate Preview Modal */}
      {showAutoGenPreview && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80">
          <div className="w-[700px] max-h-[80vh] bg-[#1E1E1E] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-[#3A3A3A]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A3A3A] bg-[#2A2A2A]">
              <div className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-indigo-400" />
                <h3 className="text-lg font-semibold text-gray-100">{t.auto_gen_preview}</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowAutoGenPreview(false)
                  setAutoGenColumns([])
                  setTempStorageData(null)
                }}
                className="text-gray-400 hover:text-white hover:bg-[#3A3A3A]"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#1A1A1A] [&::-webkit-scrollbar-thumb]:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
              {/* Sample Data */}
              {tempStorageData && (
                <div>
                  <Label className="text-gray-400 text-sm">{t.sample_data_from_temp}:</Label>
                  <pre className="mt-2 p-3 bg-[#2A2A2A] rounded-md border border-[#3A3A3A] text-xs text-gray-300 overflow-auto max-h-[150px] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-[#1A1A1A] [&::-webkit-scrollbar-thumb]:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
                    {JSON.stringify(tempStorageData, null, 2)}
                  </pre>
                </div>
              )}

              {/* Extracted Columns */}
              <div>
                <Label className="text-gray-300">{t.extracted_columns} ({autoGenColumns.length}):</Label>
                <div className="mt-2 p-3 bg-[#2A2A2A] rounded-md border border-[#3A3A3A] max-h-[250px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#1A1A1A] [&::-webkit-scrollbar-thumb]:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
                  <div className="space-y-2">
                    {autoGenColumns.map((col, index) => (
                      <div key={index} className="flex items-center gap-3 p-3 bg-[#1E1E1E] rounded-md border border-[#3A3A3A]">
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-200">{col.name}</span>
                        </div>
                        <div className="px-2 py-1 bg-indigo-900/30 rounded text-xs text-indigo-400">
                          {col.type}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setAutoGenColumns(autoGenColumns.filter((_, i) => i !== index))
                          }}
                          className="h-6 w-6 p-0 text-gray-500 hover:text-red-400 hover:bg-red-900/20"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-3 bg-yellow-900/20 border border-yellow-700 rounded-md">
                <p className="text-sm text-yellow-400">
                  {t.replace_columns_warning}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#3A3A3A] bg-[#2A2A2A]">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAutoGenPreview(false)
                  setAutoGenColumns([])
                  setTempStorageData(null)
                }}
                className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
              >
                {t.cancel}
              </Button>
              <Button
                onClick={applyAutoGenColumns}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Check className="w-4 h-4 mr-1" />
                {t.apply_columns}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cell Content Modal - For long content editing */}
      {cellModal.isOpen && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80">
          <div className="w-[600px] max-h-[80vh] bg-[#1E1E1E] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-[#3A3A3A]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A3A3A] bg-[#2A2A2A]">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold text-gray-100">
                  {t.edit}: {cellModal.colName}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={closeCellModal}
                className="text-gray-400 hover:text-white hover:bg-[#3A3A3A]"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-6">
              <textarea
                value={cellModal.value}
                onChange={(e) => setCellModal(prev => ({ ...prev, value: e.target.value }))}
                className="w-full h-[300px] p-3 bg-[#2A2A2A] border border-[#3A3A3A] rounded-md text-gray-200 font-mono text-sm resize-none focus:outline-none focus:border-indigo-500"
                placeholder={`Enter ${cellModal.colName} value...`}
                autoFocus
              />
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#3A3A3A] bg-[#2A2A2A]">
              <Button
                variant="outline"
                onClick={closeCellModal}
                className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
              >
                {t.cancel}
              </Button>
              <Button
                onClick={saveCellModal}
                disabled={loading}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                <Save className="w-4 h-4 mr-1" />
                {t.save}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Schema Editor Modal */}
      {showSchemaEditor && selectedSheet && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/80">
          <div className="w-[700px] max-h-[80vh] bg-[#1E1E1E] rounded-xl shadow-2xl overflow-hidden flex flex-col border border-[#3A3A3A]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#3A3A3A] bg-[#2A2A2A]">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold text-gray-100">
                  {t.edit_schema}: {selectedSheet.name}
                </h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowSchemaEditor(false)}
                className="text-gray-400 hover:text-white hover:bg-[#3A3A3A]"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto scrollbar-thin p-6 space-y-4">
              <div className="p-3 bg-yellow-900/20 border border-yellow-700 rounded-md">
                <p className="text-sm text-yellow-400">
                  {t.schema_warning}
                </p>
              </div>

              <div className="flex items-center justify-between">
                <Label className="text-gray-300">{t.columns} ({editingColumns.length})</Label>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addEditingColumn}
                  className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {t.add_column}
                </Button>
              </div>

              <div className="space-y-3 max-h-[350px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-[#1A1A1A] [&::-webkit-scrollbar-thumb]:bg-[#3A3A3A] [&::-webkit-scrollbar-thumb]:rounded-full">
                {editingColumns.map((col, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-[#2A2A2A] rounded-md border border-[#3A3A3A]">
                    <div className="flex-1">
                      <Input
                        value={col.name}
                        onChange={(e) => updateEditingColumn(index, 'name', e.target.value)}
                        placeholder={t.column_name}
                        className="text-sm bg-[#1E1E1E] border-[#3A3A3A] text-gray-200 placeholder:text-gray-500"
                      />
                    </div>
                    <div className="w-32">
                      <select
                        value={col.type}
                        onChange={(e) => updateEditingColumn(index, 'type', e.target.value)}
                        className="w-full px-2 py-2 text-sm border border-[#3A3A3A] rounded-md bg-[#1E1E1E] text-gray-200"
                      >
                        <option value="string">String</option>
                        <option value="number">Number</option>
                        <option value="boolean">Boolean</option>
                        <option value="date">Date</option>
                        <option value="datetime">DateTime</option>
                        <option value="text">Text</option>
                        <option value="json">JSON</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-1 text-sm text-gray-300">
                      <input
                        type="checkbox"
                        checked={col.required}
                        onChange={(e) => updateEditingColumn(index, 'required', e.target.checked)}
                        className="rounded border-[#3A3A3A] bg-[#1E1E1E]"
                      />
                      {t.required}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEditingColumn(index)}
                      disabled={editingColumns.length === 1}
                      className="hover:bg-red-900/30"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-[#3A3A3A] bg-[#2A2A2A]">
              <Button
                variant="outline"
                onClick={() => setShowSchemaEditor(false)}
                className="border-[#3A3A3A] text-gray-300 hover:bg-[#3A3A3A] hover:text-white"
              >
                {t.cancel}
              </Button>
              <Button
                onClick={saveSchemaChanges}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {loading ? (
                  <RefreshCw className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Save className="w-4 h-4 mr-1" />
                )}
                {t.save_changes}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )

  if (typeof window !== 'undefined') {
    return (
      <>
        {createPortal(<div className="dark">{modalContent}</div>, document.body)}
        {deleteConfirmDialog && createPortal(<div className="dark">{deleteConfirmDialog}</div>, document.body)}
      </>
    )
  }

  return (
    <>
      {modalContent}
      {deleteConfirmDialog}
    </>
  )
}

'use client'

import { useState, useMemo, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Database,
  FileText,
  Table as TableIcon,
  Settings,
  Download,
  Upload,
  ChevronDown,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { downloadDataSheet, type DownloadFormat } from '@/app/app/agent-studio/utils/downloadDataSheet'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useLanguage } from '@/hooks/useLanguage'
import { getTranslations } from '@/lib/translations/app'

interface DataSheetRow {
  id: string
  rowData: string
  createdAt: Date
  updatedAt: Date
}

interface DataSheet {
  id: string
  agentId: string
  name: string
  description: string | null
  schema: string
  sizeBytes: bigint
  rowCount: number
  createdAt: Date
  updatedAt: Date
}

interface Agent {
  id: string
  agentId: string
  title: string
  userId: string
}

interface Column {
  name: string
  type: 'string' | 'number' | 'boolean' | 'datetime' | 'json'
  required?: boolean
  description?: string
}

interface Props {
  agent: Agent
  sheet: DataSheet
  initialRows: DataSheetRow[]
}

export default function DataSheetDetailClient({ agent, sheet, initialRows }: Props) {
  const router = useRouter()
  const { currentLanguage } = useLanguage()
  const t = getTranslations(currentLanguage)
  const [rows, setRows] = useState<DataSheetRow[]>(initialRows)
  const [schema, setSchema] = useState<{ columns: Column[] }>(() => {
    try {
      return JSON.parse(sheet.schema)
    } catch {
      return { columns: [] }
    }
  })

  const [sheetName, setSheetName] = useState(sheet.name)
  const [sheetDescription, setSheetDescription] = useState(sheet.description || '')
  const [hasChanges, setHasChanges] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const [isRowDialogOpen, setIsRowDialogOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<DataSheetRow | null>(null)
  const [rowFormData, setRowFormData] = useState<Record<string, any>>({})

  const [isSchemaDialogOpen, setIsSchemaDialogOpen] = useState(false)
  const [tempSchema, setTempSchema] = useState<{ columns: Column[] }>(schema)

  const [isLoading, setIsLoading] = useState(false)

  const [isUploading, setIsUploading] = useState(false)

  const [isMigrating, setIsMigrating] = useState(false)

  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set())

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedRowIds(new Set(rows.map(r => r.id)))
    } else {
      setSelectedRowIds(new Set())
    }
  }

  const handleSelectRow = (rowId: string, checked: boolean) => {
    const newSelected = new Set(selectedRowIds)
    if (checked) {
      newSelected.add(rowId)
    } else {
      newSelected.delete(rowId)
    }
    setSelectedRowIds(newSelected)
  }

  const handleBatchDelete = async () => {
    if (!confirm(t.ds_confirm_delete_rows.replace('{count}', String(selectedRowIds.size)))) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}/rows/batch-delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowIds: Array.from(selectedRowIds) })
      })
      if (!response.ok) throw new Error('Failed to delete rows')

      setRows(prev => prev.filter(r => !selectedRowIds.has(r.id)))
      setSelectedRowIds(new Set())
      router.refresh()
    } catch (error) {
      console.error(error)
      alert(t.ds_delete_error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleClearData = async () => {
    if (!confirm(t.ds_confirm_clear_all)) return
    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}/clear`, {
        method: 'POST'
      })
      if (!response.ok) throw new Error('Failed to clear data')

      setRows([])
      setSelectedRowIds(new Set())
      router.refresh()
    } catch (error) {
      console.error(error)
      alert(t.ds_delete_error)
    } finally {
      setIsLoading(false)
    }
  }

  const storageKey = `datasheet-${sheet.id}`

  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${storageKey}-widths`)
      if (saved) {
        try {
          return JSON.parse(saved)
        } catch { }
      }
    }

    const initialWidths: Record<string, number> = {}
    schema.columns.forEach(col => {
      initialWidths[col.name] = 200
    })
    initialWidths['_actions'] = 120
    return initialWidths
  })
  const [resizingColumn, setResizingColumn] = useState<string | null>(null)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)

  const [sortColumn, setSortColumn] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${storageKey}-sortColumn`)
      return saved || null
    }
    return null
  })
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc' | null>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(`${storageKey}-sortDirection`)
      return (saved as 'asc' | 'desc') || null
    }
    return null
  })
  const [originalRows, setOriginalRows] = useState<DataSheetRow[]>(initialRows)

  const handleResizeStart = (columnName: string, e: React.MouseEvent) => {
    e.preventDefault()
    setResizingColumn(columnName)
    setResizeStartX(e.clientX)
    setResizeStartWidth(columnWidths[columnName] || 200)
  }

  const handleResizeMove = (e: MouseEvent) => {
    if (!resizingColumn) return
    const diff = e.clientX - resizeStartX
    const newWidth = Math.max(80, resizeStartWidth + diff)
    setColumnWidths(prev => ({
      ...prev,
      [resizingColumn]: newWidth
    }))
  }

  const handleResizeEnd = () => {
    setResizingColumn(null)
  }

  useEffect(() => {
    if (resizingColumn) {
      document.addEventListener('mousemove', handleResizeMove)
      document.addEventListener('mouseup', handleResizeEnd)
    }
    return () => {
      document.removeEventListener('mousemove', handleResizeMove)
      document.removeEventListener('mouseup', handleResizeEnd)
    }
  }, [resizingColumn, resizeStartX, resizeStartWidth])

  useEffect(() => {
    setColumnWidths(prev => {
      const newWidths = { ...prev }
      schema.columns.forEach(col => {
        if (!newWidths[col.name]) {
          newWidths[col.name] = 200
        }
      })
      return newWidths
    })
  }, [schema])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(`${storageKey}-widths`, JSON.stringify(columnWidths))
    }
  }, [columnWidths, storageKey])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (sortColumn) {
        localStorage.setItem(`${storageKey}-sortColumn`, sortColumn)
      } else {
        localStorage.removeItem(`${storageKey}-sortColumn`)
      }

      if (sortDirection) {
        localStorage.setItem(`${storageKey}-sortDirection`, sortDirection)
      } else {
        localStorage.removeItem(`${storageKey}-sortDirection`)
      }
    }
  }, [sortColumn, sortDirection, storageKey])

  const handleSort = (columnName: string) => {
    if (sortColumn === columnName) {
      if (sortDirection === 'desc') {
        setSortDirection('asc')
      } else if (sortDirection === 'asc') {
        setSortDirection(null)
        setSortColumn(null)
        setRows([...originalRows])
      }
    } else {
      setSortColumn(columnName)
      setSortDirection('desc')
    }
  }

  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return rows
    }

    const sorted = [...rows].sort((a, b) => {
      let aData: Record<string, any> = {}
      let bData: Record<string, any> = {}

      try {
        aData = JSON.parse(a.rowData)
        bData = JSON.parse(b.rowData)
      } catch { }

      const aValue = aData[sortColumn]
      const bValue = bData[sortColumn]

      if (aValue == null && bValue == null) return 0
      if (aValue == null) return 1
      if (bValue == null) return -1

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return sortDirection === 'asc' ? aValue - bValue : bValue - aValue
      }

      if (typeof aValue === 'boolean' && typeof bValue === 'boolean') {
        return sortDirection === 'asc'
          ? (aValue === bValue ? 0 : aValue ? 1 : -1)
          : (aValue === bValue ? 0 : aValue ? -1 : 1)
      }

      const aStr = String(aValue).toLowerCase()
      const bStr = String(bValue).toLowerCase()

      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr, 'ko')
      } else {
        return bStr.localeCompare(aStr, 'ko')
      }
    })

    return sorted
  }, [rows, sortColumn, sortDirection])

  const handleBack = () => {
    if (hasChanges) {
      const confirmed = window.confirm(t.ds_confirm_discard_changes)
      if (!confirmed) return
    }
    router.push(`/app/agents/${agent.agentId}/workflows`)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sheetName,
          description: sheetDescription || null,
          schema: schema,
        })
      })

      if (!response.ok) {
        throw new Error('Failed to save')
      }

      setHasChanges(false)
      alert(t.ds_save_success)
    } catch (error) {
      console.error('Failed to save:', error)
      alert(t.ds_save_error)
    } finally {
      setIsSaving(false)
    }
  }

  const handleOpenRowDialog = (row?: DataSheetRow) => {
    if (row) {
      setEditingRow(row)
      try {
        setRowFormData(JSON.parse(row.rowData))
      } catch {
        setRowFormData({})
      }
    } else {
      setEditingRow(null)
      const initialData: Record<string, any> = {}
      schema.columns.forEach(col => {
        if (col.type === 'boolean') initialData[col.name] = false
        // else if (col.type === 'number') initialData[col.name] = 0
        // else if (col.type === 'datetime') initialData[col.name] = new Date().toISOString()
        // else initialData[col.name] = ''
      })
      setRowFormData(initialData)
    }
    setIsRowDialogOpen(true)
  }

  const handleSaveRow = async () => {
    setIsLoading(true)
    try {
      const formattedData = { ...rowFormData }
      schema.columns.forEach(col => {
        const value = formattedData[col.name]

        if (value === '') {
          formattedData[col.name] = null
          return
        }

        if (col.type === 'number' && value !== undefined && value !== null) {
          const num = Number(value)
          if (!isNaN(num)) {
            formattedData[col.name] = num
          }
        }
      })

      if (editingRow) {
        const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}/rows/${editingRow.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowData: formattedData })
        })

        if (!response.ok) {
          throw new Error('Failed to update row')
        }

        const data = await response.json()
        const updatedRows = rows.map(r => r.id === editingRow.id ? data.row : r)
        setRows(updatedRows)
        setOriginalRows(updatedRows)
      } else {
        const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}/rows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rowData: formattedData })
        })

        if (!response.ok) {
          throw new Error('Failed to create row')
        }

        const data = await response.json()
        const updatedRows = [data.row, ...rows]
        setRows(updatedRows)
        setOriginalRows(updatedRows)
      }

      setIsRowDialogOpen(false)
      setEditingRow(null)
      setRowFormData({})
    } catch (error: any) {
      console.error('Failed to save row:', error)
      alert(error.message || t.ds_row_save_error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteRow = async (rowId: string) => {
    if (!confirm(t.ds_confirm_delete_row)) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}/rows/${rowId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete row')
      }

      const updatedRows = rows.filter(r => r.id !== rowId)
      setRows(updatedRows)
      setOriginalRows(updatedRows)
    } catch (error: any) {
      console.error('Failed to delete row:', error)
      alert(error.message || t.ds_row_delete_error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveSchema = () => {
    setSchema(tempSchema)
    setHasChanges(true)
    setIsSchemaDialogOpen(false)
  }

  const handleAddColumn = () => {
    setTempSchema({
      columns: [
        ...tempSchema.columns,
        { name: '', type: 'string', required: false, description: '' }
      ]
    })
  }

  const handleRemoveColumn = (index: number) => {
    setTempSchema({
      columns: tempSchema.columns.filter((_, i) => i !== index)
    })
  }

  const handleUpdateColumn = (index: number, field: keyof Column, value: any) => {
    setTempSchema({
      columns: tempSchema.columns.map((col, i) =>
        i === index ? { ...col, [field]: value } : col
      )
    })
  }

  const renderCellValue = (value: any, type: Column['type']) => {
    if (value === null || value === undefined) return '-'

    switch (type) {
      case 'boolean':
        return value ? '✓' : '✗'
      case 'datetime':
        try {
          return formatDistanceToNow(new Date(value), { addSuffix: true, locale: ko })
        } catch {
          return String(value)
        }
      case 'json':
        const jsonString = JSON.stringify(value, null, 2)
        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <pre className="text-xs truncate max-w-[200px] cursor-help">{jsonString}</pre>
            </TooltipTrigger>
            <TooltipContent className="max-w-md max-h-96 overflow-auto">
              <pre className="text-xs">{jsonString}</pre>
            </TooltipContent>
          </Tooltip>
        )
      default:
        let displayValue: string
        let fullValue: string

        let arr: any[] | null = null
        if (Array.isArray(value)) {
          arr = value
        } else if (typeof value === 'string' && value.startsWith('[')) {
          try { arr = JSON.parse(value) } catch { /* ignore */ }
        }

        if (arr && Array.isArray(arr)) {
          const lines = arr.map((item: any) => {
            if (typeof item === 'object' && item !== null) {
              return Object.entries(item).map(([k, v]) => `${k}: ${v}`).join(', ')
            }
            return String(item)
          })
          displayValue = lines.join(' | ')
          fullValue = lines.join('\n')
        } else if (typeof value === 'object' && value !== null) {
          displayValue = Object.entries(value).map(([k, v]) => `${k}: ${v}`).join(', ')
          fullValue = displayValue
        } else {
          displayValue = String(value)
          fullValue = displayValue
        }

        const maxLength = 50
        if (displayValue.length <= maxLength) {
          return displayValue
        }

        return (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate max-w-[300px] cursor-help block">
                {displayValue}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-md max-h-96 overflow-auto">
              <p className="whitespace-pre-wrap">{fullValue}</p>
            </TooltipContent>
          </Tooltip>
        )
    }
  }

  const formatSize = (bytes: bigint | number) => {
    const numBytes = typeof bytes === 'bigint' ? Number(bytes) : bytes
    if (numBytes === 0) return '0 KB'
    if (numBytes < 1024) return '< 1 KB'
    if (numBytes < 1024 * 1024) return `${(numBytes / 1024).toFixed(1)} KB`
    return `${(numBytes / (1024 * 1024)).toFixed(2)} MB`
  }

  const handleDownload = async (format: DownloadFormat) => {
    try {
      const downloadRows = sortedRows.map(row => ({
        id: row.id,
        rowData: JSON.parse(row.rowData),
        createdAt: row.createdAt.toString(),
        updatedAt: row.updatedAt.toString(),
      }))

      await downloadDataSheet(
        {
          id: sheet.id,
          name: sheetName,
          description: sheetDescription,
          rowCount: rows.length,
          sizeBytes: Number(sheet.sizeBytes),
          schema: {
            columns: schema.columns.map(col => ({
              ...col,
              required: !!col.required
            }))
          },
        },
        format,
        downloadRows
      )
    } catch (error) {
      console.error('Download failed:', error)
      alert(t.ds_download_error)
    }
  }

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.json')) {
      alert(t.ds_json_only)
      return
    }

    try {
      setIsUploading(true)
      const text = await file.text()
      const jsonData = JSON.parse(text)

      const isFullBackup = jsonData._backup?.type === 'data-sheet-full-backup'

      if (isFullBackup) {
        if (!confirm(t.ds_backup_confirm.replace('{name}', jsonData.name || 'N/A').replace('{cols}', String(jsonData.schema?.columns?.length || 0)).replace('{rows}', String(jsonData.rows?.length || 0)))) {
          return
        }

        const response = await fetch(`/api/data-sheets/${sheet.id}/bulk-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: text,
        })

        if (!response.ok) {
          throw new Error('복원 실패')
        }

        const result = await response.json()

        if (jsonData.schema) {
          setSchema(jsonData.schema)
        }
        if (jsonData.name) {
          setSheetName(jsonData.name)
        }
        if (jsonData.description !== undefined) {
          setSheetDescription(jsonData.description || '')
        }
        setRows(result.rows)
        setOriginalRows(result.rows)
        alert(t.ds_backup_restored.replace('{count}', String(result.rows.length)))

      } else {
        let dataArray: any[]

        if (Array.isArray(jsonData)) {
          dataArray = jsonData
        } else if (Array.isArray(jsonData.rows)) {
          dataArray = jsonData.rows
        } else {
          throw new Error(t.ds_json_array_required)
        }

        if (!confirm(t.ds_add_rows_confirm.replace('{count}', String(dataArray.length)))) {
          return
        }

        const newRows = dataArray.map((item: any) => {
          const rowData: Record<string, any> = {}
          schema.columns.forEach(col => {
            if (item[col.name] !== undefined) {
              rowData[col.name] = item[col.name]
            }
          })
          return rowData
        })

        const response = await fetch(`/api/data-sheets/${sheet.id}/bulk-upload`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: newRows }),
        })

        if (!response.ok) {
          throw new Error('업로드 실패')
        }

        const result = await response.json()

        setRows(result.rows)
        setOriginalRows(result.rows)
        alert(t.ds_rows_added.replace('{count}', String(newRows.length)))
      }

    } catch (error) {
      console.error('Upload failed:', error)
      alert(t.ds_upload_error)
    } finally {
      setIsUploading(false)
      event.target.value = ''
    }
  }

  const handleMigrate = async () => {
    if (!confirm(t.ds_confirm_migrate)) {
      return
    }

    try {
      setIsMigrating(true)

      const response = await fetch(`/api/data-sheets/${sheet.id}/migrate`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('마이그레이션 실패')
      }

      const result = await response.json()

      alert(t.ds_rows_migrated.replace('{count}', String(result.migratedRows)))

      router.refresh()
    } catch (error) {
      console.error('Migration failed:', error)
      alert(t.ds_migrate_error)
    } finally {
      setIsMigrating(false)
    }
  }

  return (
    <div
      className="relative h-screen text-white flex flex-col"
      style={{ backgroundColor: '#0f0f0f' }}
    >
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
            className="text-gray-400 hover:text-white p-1"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>

          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-400" />
            <input
              type="text"
              value={sheetName}
              onChange={(e) => {
                setSheetName(e.target.value)
                setHasChanges(true)
              }}
              placeholder={t.ds_sheet_name_placeholder}
              className="px-0 py-1 text-base font-medium bg-transparent text-white border-none outline-none focus:outline-none"
            />
          </div>

          <Badge variant="outline" className="ml-2">
            {t.ds_rows.replace('{count}', String(rows.length))}
          </Badge>
          <Badge variant="outline">
            {t.ds_columns.replace('{count}', String(schema.columns.length))}
          </Badge>
          <Badge variant="outline" className="font-mono">
            {formatSize(sheet.sizeBytes)}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="json-upload">
            <Button
              variant="ghost"
              size="sm"
              className="px-3 text-gray-400 hover:text-white"
              disabled={isUploading}
              asChild
            >
              <span className="cursor-pointer">
                <Upload className="w-4 h-4 mr-1.5" />
                {isUploading ? t.ds_uploading : t.ds_json_upload}
              </span>
            </Button>
          </label>
          <input
            id="json-upload"
            type="file"
            accept=".json"
            onChange={handleUpload}
            className="hidden"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="px-3 text-gray-400 hover:text-white"
              >
                <Download className="w-4 h-4 mr-1.5" />
                {t.ds_download}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="bg-gray-900 border-gray-800">
              <DropdownMenuItem
                onClick={() => handleDownload('backup')}
                className="text-gray-300 hover:text-white hover:bg-gray-800 cursor-pointer"
              >
                <Database className="w-4 h-4 mr-2 text-green-400" />
                {t.ds_full_backup}
              </DropdownMenuItem>
              <div className="h-px bg-gray-800 my-1" />
              <DropdownMenuItem
                onClick={() => handleDownload('csv')}
                className="text-gray-300 hover:text-white hover:bg-gray-800 cursor-pointer"
              >
                <FileText className="w-4 h-4 mr-2" />
                {t.ds_csv_file}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDownload('json')}
                className="text-gray-300 hover:text-white hover:bg-gray-800 cursor-pointer"
              >
                <FileText className="w-4 h-4 mr-2" />
                {t.ds_json_file}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDownload('excel')}
                className="text-gray-300 hover:text-white hover:bg-gray-800 cursor-pointer"
              >
                <FileText className="w-4 h-4 mr-2" />
                {t.ds_excel_file}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="outline"
            size="sm"
            onClick={handleMigrate}
            disabled={isMigrating || isLoading}
            className="text-gray-400 border-gray-700 hover:text-white hover:bg-gray-800"
          >
            <Database className={`w-4 h-4 mr-2 ${isMigrating ? 'animate-spin' : ''}`} />
            {t.ds_apply_schema}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClearData}
            disabled={isLoading || rows.length === 0}
            className="text-red-400 border-gray-700 hover:text-red-300 hover:bg-gray-800"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            {t.ds_clear_all}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setTempSchema(schema)
              setIsSchemaDialogOpen(true)
            }}
            className="px-3 text-gray-400 hover:text-white"
          >
            <Settings className="w-4 h-4 mr-1.5" />
            {t.ds_schema_manage}
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className={`px-4 transition-all ${!hasChanges
              ? 'bg-gray-600 hover:bg-gray-600 text-white cursor-default'
              : 'bg-white hover:bg-gray-100 text-black'
              }`}
          >
            {isSaving ? t.ds_saving : !hasChanges ? t.ds_saved : t.ds_save}
          </Button>
        </div>
      </div>

      {selectedRowIds.size > 0 && (
        <div className="flex items-center gap-2 p-2 mb-2 bg-red-500/10 border border-red-500/20 rounded-md text-red-400 text-sm">
          <span className="font-medium ml-2">{t.ds_selected.replace('{count}', String(selectedRowIds.size))}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleBatchDelete}
            className="ml-auto hover:bg-red-500/20 hover:text-red-300 h-8"
          >
            {t.ds_delete_selected}
          </Button>
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="space-y-6">
          <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-800">
            <Label className="text-gray-300 mb-2 block">{t.ds_description}</Label>
            <Textarea
              value={sheetDescription}
              onChange={(e) => {
                setSheetDescription(e.target.value)
                setHasChanges(true)
              }}
              placeholder={t.ds_description_placeholder}
              className="bg-gray-800 border-gray-700 text-white"
              rows={2}
            />
          </div>

          <div className="bg-gray-900/50 rounded-lg border border-gray-800">
            <div className="flex items-center justify-between p-4 border-b border-gray-800">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <TableIcon className="w-5 h-5" />
                {t.ds_data}
              </h2>
              <Button
                size="sm"
                onClick={() => handleOpenRowDialog()}
                className="bg-white hover:bg-gray-100 text-black"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                {t.ds_add_row}
              </Button>
            </div>

            <div className="overflow-x-auto">
              <TooltipProvider>
                <Table style={{ tableLayout: 'fixed', width: '100%' }}>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="w-[40px] px-2">
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-offset-gray-900"
                            checked={rows.length > 0 && selectedRowIds.size === rows.length}
                            onChange={(e) => handleSelectAll(e.target.checked)}
                          />
                        </div>
                      </TableHead>
                      {schema.columns.map((col) => (
                        <TableHead
                          key={col.name}
                          className="text-gray-300 relative group"
                          style={{ width: columnWidths[col.name] || 200 }}
                        >
                          <div className="flex items-center justify-between pr-2">
                            <div
                              className="truncate cursor-pointer hover:text-white flex items-center gap-1"
                              onClick={() => handleSort(col.name)}
                            >
                              <span className="truncate">
                                {col.name}
                                {col.required && <span className="text-red-400 ml-1">*</span>}
                                <span className="text-xs text-gray-500 ml-2">({col.type})</span>
                              </span>
                              {sortColumn === col.name ? (
                                sortDirection === 'desc' ? (
                                  <ArrowDown className="w-3 h-3 flex-shrink-0 text-blue-400" />
                                ) : (
                                  <ArrowUp className="w-3 h-3 flex-shrink-0 text-blue-400" />
                                )
                              ) : (
                                <ArrowUpDown className="w-3 h-3 flex-shrink-0 opacity-0 group-hover:opacity-50" />
                              )}
                            </div>
                            <div
                              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize bg-gray-700/0 group-hover:bg-blue-500/30 hover:!bg-blue-500/60 transition-colors border-r-2 border-transparent hover:border-blue-500"
                              onMouseDown={(e) => handleResizeStart(col.name, e)}
                              style={{ width: '8px', marginRight: '-4px' }}
                            />
                          </div>
                        </TableHead>
                      ))}
                      <TableHead
                        className="text-gray-300 text-right relative group"
                        style={{ width: columnWidths['_actions'] || 120 }}
                      >
                        <div className="pr-2">
                          {t.ds_actions}
                          <div
                            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize bg-gray-700/0 group-hover:bg-blue-500/30 hover:!bg-blue-500/60 transition-colors border-r-2 border-transparent hover:border-blue-500"
                            onMouseDown={(e) => handleResizeStart('_actions', e)}
                            style={{ width: '8px', marginRight: '-4px' }}
                          />
                        </div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedRows.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={schema.columns.length + 2}
                          className="text-center text-gray-500 py-12"
                        >
                          <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                          {t.ds_no_data}
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedRows.map((row) => {
                        let rowData: Record<string, any> = {}
                        try {
                          rowData = JSON.parse(row.rowData)
                        } catch { }

                        return (
                          <TableRow
                            key={row.id}
                            className={`border-gray-800 hover:bg-gray-800/50 ${selectedRowIds.has(row.id) ? 'bg-blue-500/5' : ''}`}
                          >
                            <TableCell className="px-2">
                              <div className="flex items-center justify-center">
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-blue-500 focus:ring-offset-gray-900"
                                  checked={selectedRowIds.has(row.id)}
                                  onChange={(e) => handleSelectRow(row.id, e.target.checked)}
                                />
                              </div>
                            </TableCell>
                            {schema.columns.map((col) => (
                              <TableCell
                                key={col.name}
                                className="text-gray-300"
                                style={{ width: columnWidths[col.name] || 200, maxWidth: columnWidths[col.name] || 200 }}
                              >
                                {renderCellValue(rowData[col.name], col.type)}
                              </TableCell>
                            ))}
                            <TableCell
                              className="text-right"
                              style={{ width: columnWidths['_actions'] || 120, maxWidth: columnWidths['_actions'] || 120 }}
                            >
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleOpenRowDialog(row)}
                                  className="text-gray-400 hover:text-white"
                                >
                                  <Edit className="w-3 h-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteRow(row.id)}
                                  className="text-red-400 hover:text-red-300"
                                  disabled={isLoading}
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={isRowDialogOpen} onOpenChange={setIsRowDialogOpen}>
        <DialogContent className="bg-gray-900 text-white border-gray-800 max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRow ? t.ds_edit_row : t.ds_add_new_row}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {t.ds_enter_field_values}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {schema.columns.map((col) => (
              <div key={col.name} className="space-y-2">
                <Label className="text-gray-300">
                  {col.name}
                  {col.required && <span className="text-red-400 ml-1">*</span>}
                  <span className="text-xs text-gray-500 ml-2">({col.type})</span>
                </Label>
                {col.description && (
                  <p className="text-xs text-gray-500">{col.description}</p>
                )}

                {col.type === 'boolean' ? (
                  <select
                    value={String(rowFormData[col.name] || false)}
                    onChange={(e) =>
                      setRowFormData({ ...rowFormData, [col.name]: e.target.value === 'true' })
                    }
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-md text-white"
                  >
                    <option value="false">False</option>
                    <option value="true">True</option>
                  </select>
                ) : col.type === 'number' ? (
                  <Input
                    type="text"
                    value={rowFormData[col.name] ?? ''}
                    onChange={(e) =>
                      setRowFormData({ ...rowFormData, [col.name]: e.target.value })
                    }
                    className="bg-gray-800 border-gray-700 text-white"
                    placeholder=""
                  />
                ) : col.type === 'datetime' ? (
                  <Input
                    type="datetime-local"
                    value={rowFormData[col.name] ? new Date(rowFormData[col.name]).toISOString().slice(0, 16) : ''}
                    onChange={(e) =>
                      setRowFormData({ ...rowFormData, [col.name]: new Date(e.target.value).toISOString() })
                    }
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                ) : col.type === 'json' ? (
                  <Textarea
                    value={typeof rowFormData[col.name] === 'string'
                      ? rowFormData[col.name]
                      : JSON.stringify(rowFormData[col.name] || {}, null, 2)
                    }
                    onChange={(e) => {
                      try {
                        setRowFormData({ ...rowFormData, [col.name]: JSON.parse(e.target.value) })
                      } catch {
                        setRowFormData({ ...rowFormData, [col.name]: e.target.value })
                      }
                    }}
                    className="bg-gray-800 border-gray-700 text-white font-mono text-sm"
                    rows={4}
                  />
                ) : (
                  <Input
                    type="text"
                    value={rowFormData[col.name] || ''}
                    onChange={(e) =>
                      setRowFormData({ ...rowFormData, [col.name]: e.target.value })
                    }
                    className="bg-gray-800 border-gray-700 text-white"
                  />
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRowDialogOpen(false)}
              disabled={isLoading}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              {t.ds_cancel}
            </Button>
            <Button
              onClick={handleSaveRow}
              disabled={isLoading}
              className="bg-white hover:bg-gray-100 text-black"
            >
              {isLoading ? t.ds_saving : t.ds_save}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSchemaDialogOpen} onOpenChange={setIsSchemaDialogOpen}>
        <DialogContent className="bg-gray-900 text-white border-gray-800 max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t.ds_schema_title}</DialogTitle>
            <DialogDescription className="text-gray-400">
              {t.ds_schema_description}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {tempSchema.columns.map((col, index) => (
              <div key={index} className="p-4 bg-gray-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">{t.ds_column_n.replace('{n}', String(index + 1))}</h4>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRemoveColumn(index)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-gray-300">{t.ds_column_name}</Label>
                    <Input
                      value={col.name}
                      onChange={(e) => handleUpdateColumn(index, 'name', e.target.value)}
                      className="bg-gray-700 border-gray-600 text-white"
                      placeholder={t.ds_column_name_placeholder}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-gray-300">{t.ds_column_type}</Label>
                    <select
                      value={col.type}
                      onChange={(e) => handleUpdateColumn(index, 'type', e.target.value)}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white"
                    >
                      <option value="string">String</option>
                      <option value="number">Number</option>
                      <option value="boolean">Boolean</option>
                      <option value="datetime">DateTime</option>
                      <option value="json">JSON</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-gray-300">{t.ds_column_description}</Label>
                  <Input
                    value={col.description || ''}
                    onChange={(e) => handleUpdateColumn(index, 'description', e.target.value)}
                    className="bg-gray-700 border-gray-600 text-white"
                    placeholder={t.ds_column_description_placeholder}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`required-${index}`}
                    checked={col.required || false}
                    onChange={(e) => handleUpdateColumn(index, 'required', e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor={`required-${index}`} className="text-gray-300">
                    {t.ds_required_field}
                  </Label>
                </div>
              </div>
            ))}

            <Button
              variant="outline"
              onClick={handleAddColumn}
              className="w-full border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t.ds_add_column}
            </Button>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsSchemaDialogOpen(false)}
              className="border-gray-700 text-gray-300 hover:bg-gray-800"
            >
              {t.ds_cancel}
            </Button>
            <Button
              onClick={handleSaveSchema}
              className="bg-white hover:bg-gray-100 text-black"
            >
              {t.ds_apply}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

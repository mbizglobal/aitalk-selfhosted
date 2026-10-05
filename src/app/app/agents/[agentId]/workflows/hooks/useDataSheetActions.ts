'use client'

import { useRouter } from 'next/navigation'
import type { DataSheet, LimitType } from '../types'

interface UseDataSheetActionsProps {
  agentId: string
  dataSheets: DataSheet[]
  setDataSheets: (sheets: DataSheet[]) => void
  setIsLoading: (loading: boolean) => void
  setLimitType: (type: LimitType) => void
  setIsLimitDialogOpen: (open: boolean) => void
  t: Record<string, string>
}

export function useDataSheetActions({
  agentId,
  dataSheets,
  setDataSheets,
  setIsLoading,
  setLimitType,
  setIsLimitDialogOpen,
  t,
}: UseDataSheetActionsProps) {
  const router = useRouter()

  const handleCreateSheet = async (
    name: string,
    description: string,
    onSuccess: () => void
  ) => {
    if (!name.trim()) {
      alert(t.datasheet_name_required)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          name,
          description: description || null,
          schema: {
            columns: [
              { name: 'id', type: 'string', required: true, description: '고유 ID' },
              { name: 'createdAt', type: 'datetime', required: true, description: '생성일시' }
            ]
          }
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        if (errorData.error === 'data_sheets_limit_reached') {
          setLimitType('datasheet')
          setIsLimitDialogOpen(true)
          onSuccess()
          return
        }
        throw new Error(errorData.error || 'Failed to create data sheet')
      }

      const data = await response.json()
      setDataSheets([data.sheet, ...dataSheets])
      onSuccess()
      router.refresh()
    } catch (error: any) {
      console.error('Failed to create data sheet:', error)
      alert(error.message || t.datasheet_create_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeleteSheet = async (sheetId: string, name: string) => {
    if (!confirm(t.datasheet_delete_confirm.replace('{name}', name))) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheetId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete data sheet')
      }

      setDataSheets(dataSheets.filter(s => s.id !== sheetId))
      router.refresh()
    } catch (error: any) {
      console.error('Failed to delete data sheet:', error)
      alert(error.message || t.datasheet_delete_failed)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownloadSheetJson = async (sheet: DataSheet) => {
    setIsLoading(true)
    try {
      const response = await fetch(`/api/agent-studio/data-sheets/${sheet.id}/rows?limit=100000`)
      if (!response.ok) {
        throw new Error('Failed to fetch sheet data')
      }
      const { rows } = await response.json()

      const exportData = {
        _exportInfo: {
          version: '1.0',
          exportedAt: new Date().toISOString(),
          type: 'datasheet'
        },
        sheet: {
          name: sheet.name,
          description: sheet.description,
          schema: JSON.parse(sheet.schema)
        },
        rows: rows.map((row: any) => ({
          rowData: typeof row.rowData === 'string' ? JSON.parse(row.rowData) : row.rowData,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        }))
      }

      const formattedJson = JSON.stringify(exportData, null, 2)
      const blob = new Blob([formattedJson], { type: 'application/json' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `${sheet.name.replace(/[^a-zA-Z0-9가-힣]/g, '_')}_${sheet.id}.json`
      document.body.appendChild(link)
      link.click()

      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download sheet JSON:', error)
      alert(t.datasheet_json_download_failed)
    } finally {
      setIsLoading(false)
    }
  }

  return {
    handleCreateSheet,
    handleDeleteSheet,
    handleDownloadSheetJson,
  }
}


import ExcelJS from 'exceljs'

export type DownloadFormat = 'csv' | 'json' | 'excel' | 'backup'

interface DataSheetRow {
  id: string
  rowData: Record<string, any>
  createdAt: string
  updatedAt: string
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

async function fetchAllRows(sheetId: string): Promise<DataSheetRow[]> {
  const allRows: DataSheetRow[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    const response = await fetch(
      `/api/agent-studio/data-sheets/${sheetId}/rows?page=${page}&limit=100`
    )

    if (!response.ok) {
      throw new Error('Failed to fetch data')
    }

    const data = await response.json()
    allRows.push(...data.rows)

    hasMore = page < data.pagination.totalPages
    page++
  }

  return allRows
}

function downloadAsCSV(
  rows: DataSheetRow[],
  schema: DataSheetInfo['schema'],
  sheetName: string
) {
  if (rows.length === 0) {
    alert('No data to download')
    return
  }

  const headers = schema.columns.map(col => col.name)

  const csvRows: string[] = []

  csvRows.push(headers.map(h => `"${h}"`).join(','))

  rows.forEach(row => {
    const values = headers.map(header => {
      const value = row.rowData[header]

      if (value === null || value === undefined) return ''

      if (typeof value === 'object') {
        return `"${JSON.stringify(value).replace(/"/g, '""')}"`
      }

      if (typeof value === 'string') {
        return `"${value.replace(/"/g, '""')}"`
      }

      return value
    })
    csvRows.push(values.join(','))
  })

  const csvContent = csvRows.join('\n')

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${sheetName}_${new Date().toISOString().split('T')[0]}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadAsJSON(
  rows: DataSheetRow[],
  schema: DataSheetInfo['schema'],
  sheetName: string
) {
  if (rows.length === 0) {
    alert('No data to download')
    return
  }

  const data = rows.map(row => {
    const newRow: Record<string, any> = {}
    schema.columns.forEach(col => {
      newRow[col.name] = row.rowData[col.name] !== undefined ? row.rowData[col.name] : null
    })
    return newRow
  })

  const jsonContent = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${sheetName}_${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function downloadAsFullBackup(
  rows: DataSheetRow[],
  sheet: DataSheetInfo,
) {
  const data = rows.map(row => {
    const newRow: Record<string, any> = {}
    sheet.schema.columns.forEach(col => {
      newRow[col.name] = row.rowData[col.name] !== undefined ? row.rowData[col.name] : null
    })
    return newRow
  })

  const fullBackup = {
    _backup: {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      type: 'data-sheet-full-backup'
    },
    name: sheet.name,
    description: sheet.description,
    schema: sheet.schema,
    rows: data
  }

  const jsonContent = JSON.stringify(fullBackup, null, 2)
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${sheet.name}_backup_${new Date().toISOString().split('T')[0]}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

async function downloadAsExcel(
  rows: DataSheetRow[],
  schema: DataSheetInfo['schema'],
  sheetName: string
) {
  if (rows.length === 0) {
    alert('No data to download')
    return
  }

  const headers = schema.columns.map(col => col.name)

  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Data')

  worksheet.addRow(headers)

  rows.forEach(row => {
    const rowArray: any[] = []
    headers.forEach(header => {
      const value = row.rowData[header]

      if (value === null || value === undefined) {
        rowArray.push('')
        return
      }

      if (typeof value === 'object') {
        rowArray.push(JSON.stringify(value))
        return
      }

      rowArray.push(value)
    })
    worksheet.addRow(rowArray)
  })

  worksheet.columns.forEach((column, i) => {
    const header = headers[i]
    let maxLength = header ? header.length : 10

    rows.forEach(row => {
      const value = row.rowData[headers[i]]
      if (value) {
        const len = String(value).length
        if (len > maxLength) maxLength = len
      }
    })

    column.width = Math.min(maxLength + 2, 50)
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = `${sheetName}_${new Date().toISOString().split('T')[0]}.xlsx`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export async function downloadDataSheet(
  sheet: DataSheetInfo,
  format: DownloadFormat,
  sortedRows?: DataSheetRow[]
): Promise<void> {
  try {
    const rows = sortedRows || await fetchAllRows(sheet.id)

    switch (format) {
      case 'csv':
        downloadAsCSV(rows, sheet.schema, sheet.name)
        break
      case 'json':
        downloadAsJSON(rows, sheet.schema, sheet.name)
        break
      case 'excel':
        await downloadAsExcel(rows, sheet.schema, sheet.name)
        break
      case 'backup':
        downloadAsFullBackup(rows, sheet)
        break
      default:
        throw new Error(`Unsupported format: ${format}`)
    }
  } catch (error) {
    console.error('Download failed:', error)
    alert('Failed to download data. Please try again.')
  }
}

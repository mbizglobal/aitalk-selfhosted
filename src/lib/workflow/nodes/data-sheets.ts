
import { BaseNodeExecutor, NodeExecutionResult } from './base'
import { isSaveAsKeyAllowed, agentScopedWhere } from '@/lib/connection-scope'
import { WorkflowNode, WorkflowContext } from '../types'
import { PrismaClient } from '@prisma/client'
import { canReadTemplatePath, markTemplateVar, preserveTemplateVars, isUnsafeTemplateSegment } from '../template-scope'

interface DataSheetsNodeData {
  sheetId: string
  operation: 'read' | 'insert' | 'update' | 'delete' | 'upsert' | 'batch-insert' | 'increment'
  filter?: Record<string, any>
  data?: Record<string, any> | Array<Record<string, any>>
  limit?: number
  batchData?: Array<Record<string, any>>
  saveAs?: string
}

const MAX_SHEET_SIZE_BYTES = 50 * 1024 * 1024

const INCREMENT_NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
function toIncrementNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string') {
    const t = raw.trim()
    if (t === '' || !INCREMENT_NUMBER_RE.test(t)) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

export class DataSheetsNodeExecutor extends BaseNodeExecutor {
  private isDev = process.env.NODE_ENV === 'development'

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    prisma: PrismaClient
  ): Promise<NodeExecutionResult> {
    const nodeData = node.data as DataSheetsNodeData
    const { sheetId, operation } = nodeData

    if (!sheetId) {
      console.error('[DataSheets] Error: sheetId is required')
      return this.createErrorResult(context, 'sheetId is required', { operation })
    }

    let ownerScope: { agentId: string }
    try {
      ownerScope = agentScopedWhere({ agentId: context.agentId }, 'Data Sheets')
    } catch (scopeError: any) {
      console.error(`[DataSheets] ${scopeError.message}`)
      return this.createErrorResult(context, scopeError.message, { operation })
    }

    try {
      const sheet = await prisma.dataSheet.findFirst({
        where: { id: sheetId, kind: 'agent', ...ownerScope }
      })
      const projectSheet = sheet ? null : await this.findProjectSheet(prisma, sheetId, context)

      if (!sheet && !projectSheet) {
        console.error(`[DataSheets] Error: Sheet not found: ${sheetId}`)
        return this.createErrorResult(context, `Sheet not found: ${sheetId}`, { operation })
      }

      let result: any

      const substitutedData = nodeData.data ? this.substituteVariables(nodeData.data, context) : undefined
      const substitutedFilter = nodeData.filter ? this.substituteVariables(nodeData.filter, context) : undefined

      const substitutedNodeData = {
        ...nodeData,
        data: substitutedData,
        filter: substitutedFilter
      }

      if (projectSheet) {
        const [{ defaultWorkSheetDeps }, { runProjectSheetNode }] = await Promise.all([
          import('@/lib/work/sheet-gate'),
          import('@/lib/work/sheet-node'),
        ])
        result = await runProjectSheetNode(
          { ...(await defaultWorkSheetDeps()), db: prisma },
          { userId: context.userId, projectId: projectSheet.projectId, sheetId, workflowId: context.workflowId as string },
          operation,
          {
            filter: substitutedFilter,
            data: substitutedData,
            limit: nodeData.limit,
            batch: operation === 'batch-insert' ? this.resolveBatchArray(substitutedNodeData, context) : undefined,
          },
        )
      } else switch (operation) {
        case 'read':
          result = await this.executeRead(prisma, sheetId, substitutedNodeData, context)
          break
        case 'insert':
          result = await this.executeInsert(prisma, sheet, JSON.parse(sheet!.schema), substitutedNodeData, context)
          break
        case 'batch-insert':
          result = await this.executeBatchInsert(prisma, sheet, JSON.parse(sheet!.schema), substitutedNodeData, context)
          break
        case 'update':
          result = await this.executeUpdate(prisma, sheet, JSON.parse(sheet!.schema), substitutedNodeData, context)
          break
        case 'delete':
          result = await this.executeDelete(prisma, sheet, substitutedNodeData, context)
          break
        case 'upsert':
          result = await this.executeUpsert(prisma, sheet, JSON.parse(sheet!.schema), substitutedNodeData, context)
          break
        case 'increment':
          result = await this.executeIncrement(prisma, sheet, JSON.parse(sheet!.schema), substitutedNodeData, context)
          break
        default:
          return this.createErrorResult(context, `Unknown operation: ${operation}`, { operation })
      }

      const updatedContext = {
        ...context,
        dataSheetsResult: result
      }

      if (nodeData.saveAs && isSaveAsKeyAllowed(nodeData.saveAs)) {
        if (operation === 'read' && result.rows) {
          if (result.rows.length === 0) {
            updatedContext[nodeData.saveAs] = null
          } else if (result.rows.length === 1) {
            updatedContext[nodeData.saveAs] = result.rows[0]
          } else {
            updatedContext[nodeData.saveAs] = result.rows
          }
        } else {
          updatedContext[nodeData.saveAs] = result
        }
        markTemplateVar(updatedContext, nodeData.saveAs)
      }

      const count = result.rowCount || result.updatedCount || result.deletedCount || result.insertedCount || (result.row ? 1 : 0) || 0

      return this.createSuccessResult(updatedContext, {
        input: { sheetId, operation, filter: nodeData.filter, data: nodeData.data, limit: nodeData.limit },
        output: result
      })

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      const errorDetails = {
        operation,
        sheetId,
        error: errorMessage,
        message: `Failed to ${operation} data: ${errorMessage}`
      }
      console.error(`[DataSheets] Error:`, errorDetails)
      return this.createErrorResult(context, errorDetails.message, errorDetails)
    }
  }

  private async findProjectSheet(prisma: PrismaClient, sheetId: string, context: WorkflowContext): Promise<{ projectId: string } | null> {
    const workflowId = context.workflowId
    if (typeof workflowId !== 'string' || workflowId === '' || typeof context.userId !== 'string' || context.userId === '') return null
    const found = await prisma.dataSheet.findFirst({
      where: { id: sheetId, kind: 'project', userId: context.userId, project: { workflowId } },
      select: { projectId: true },
    })
    return found?.projectId ? { projectId: found.projectId } : null
  }

  private async withSheetLock<T>(
    prisma: PrismaClient,
    sheet: any,
    fn: (tx: any, ledger: { sizeBytes: number; rowCount: number }) => Promise<T>
  ): Promise<T> {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ size_bytes: bigint; row_count: number }>>`
        SELECT size_bytes, row_count FROM data_sheets WHERE id = ${sheet.id} FOR UPDATE
      `
      if (locked.length === 0) throw new Error('Sheet not found')
      return fn(tx, { sizeBytes: Number(locked[0].size_bytes), rowCount: Number(locked[0].row_count) })
    }, { timeout: 30_000 })
  }

  private matchRows(rows: any[], filter: Record<string, any>): any[] {
    return rows.filter((row: any) => {
      const rowData = JSON.parse(row.rowData)
      const fullRowData: Record<string, any> = {
        id: row.id,
        ...rowData,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
      return Object.entries(filter).every(([key, value]) =>
        fullRowData[key] === value || (value === null && fullRowData[key] === undefined)
      )
    })
  }

  private async insertCore(tx: any, ledger: { sizeBytes: number; rowCount: number }, sheet: any, schema: any, data: any) {
    const hasNoColumn = schema.columns.some((col: any) => col.name === 'No')

    const realCount = await tx.dataSheetRow.count({ where: { sheetId: sheet.id } })

    const dataWithNo = hasNoColumn ? { No: realCount + 1, ...data } : data

    this.validateRowData(schema, dataWithNo)

    const rowDataString = JSON.stringify(dataWithNo)
    const newRowSize = Buffer.byteLength(rowDataString, 'utf8')
    if (ledger.sizeBytes + newRowSize > MAX_SHEET_SIZE_BYTES) {
      throw new Error('Storage limit exceeded. Maximum sheet size is 50MB.')
    }

    const newRow = await tx.dataSheetRow.create({ data: { sheetId: sheet.id, rowData: rowDataString } })
    await tx.dataSheet.update({
      where: { id: sheet.id },
      data: { sizeBytes: BigInt(ledger.sizeBytes + newRowSize), rowCount: realCount + 1 }
    })
    return newRow
  }

  private async updateCore(tx: any, ledger: { sizeBytes: number; rowCount: number }, sheet: any, rows: any[], filter: Record<string, any>, data: any) {
    const matchingRows = this.matchRows(rows, filter)
    if (matchingRows.length === 0) return { updatedCount: 0 }

    let totalSizeDelta = 0
    const pending = matchingRows.map((row: any) => {
      const next = JSON.stringify({ ...JSON.parse(row.rowData), ...data })
      totalSizeDelta += Buffer.byteLength(next, 'utf8') - Buffer.byteLength(row.rowData, 'utf8')
      return { id: row.id, rowData: next }
    })
    if (ledger.sizeBytes + totalSizeDelta > MAX_SHEET_SIZE_BYTES) {
      throw new Error('Storage limit exceeded. Maximum sheet size is 50MB.')
    }

    await Promise.all(pending.map((u: any) =>
      tx.dataSheetRow.update({ where: { id: u.id }, data: { rowData: u.rowData } })
    ))
    await tx.dataSheet.update({
      where: { id: sheet.id },
      data: { sizeBytes: BigInt(ledger.sizeBytes + totalSizeDelta) }
    })
    return { updatedCount: matchingRows.length }
  }


  private async executeRead(
    prisma: PrismaClient,
    sheetId: string,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const { filter, limit = 100 } = nodeData

    const shouldFetchAll = filter && Object.keys(filter).length > 0

    const rows = await prisma.dataSheetRow.findMany({
      where: { sheetId },
      take: shouldFetchAll ? undefined : limit,
      orderBy: { createdAt: 'desc' }
    })

    let parsedRows = rows.map(row => ({
      id: row.id,
      ...JSON.parse(row.rowData),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }))

    if (filter && Object.keys(filter).length > 0) {

      parsedRows = parsedRows.filter(row => {
        const matches = Object.entries(filter).every(([key, value]) => {
          const rowValue = row[key]
          const isMatch = rowValue === value || (value === null && rowValue === undefined)
          if (!isMatch && this.isDev) {
          }
          return isMatch
        })
        return matches
      })


      if (limit && parsedRows.length > limit) {
        parsedRows = parsedRows.slice(0, limit)
      }
    }

    return {
      operation: 'read',
      success: true,
      message: `Successfully retrieved ${parsedRows.length} row(s) from the sheet.`,
      rowCount: parsedRows.length,
      rows: parsedRows
    }
  }

  private async executeInsert(
    prisma: PrismaClient,
    sheet: any,
    schema: any,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const { data } = nodeData
    if (!data) {
      throw new Error('data is required for insert operation')
    }
    const result = await this.withSheetLock(prisma, sheet, (tx, ledger) =>
      this.insertCore(tx, ledger, sheet, schema, data)
    )
    return {
      operation: 'insert',
      success: true,
      message: 'Data has been successfully inserted into the sheet.',
      row: { id: result.id, ...JSON.parse(result.rowData), createdAt: result.createdAt }
    }
  }

  private async executeUpdate(
    prisma: PrismaClient,
    sheet: any,
    schema: any,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const { filter, data } = nodeData

    if (!filter || !data) {
      throw new Error('filter and data are required for update operation')
    }
    if (typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).length === 0) {
      throw new Error('filter must select specific rows for update — an empty filter is refused because it would overwrite every row in the sheet')
    }

    return this.withSheetLock(prisma, sheet, async (tx, ledger) => {
      const rows = await tx.dataSheetRow.findMany({ where: { sheetId: sheet.id } })
      const res = await this.updateCore(tx, ledger, sheet, rows, filter, data)
      return {
        operation: 'update',
        success: true,
        message: `Successfully updated ${res.updatedCount} row(s).`,
        updatedCount: res.updatedCount
      }
    })
  }

  private async executeIncrement(
    prisma: PrismaClient,
    sheet: any,
    schema: any,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const { filter, data } = nodeData

    if (!filter || typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).length === 0) {
      throw new Error('filter is required for increment operation and must select specific rows — an empty filter is refused because it would match every row')
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length === 0) {
      throw new Error('data is required for increment operation — give each field the amount to add, e.g. {"points": 10}')
    }

    const columns: Array<{ name?: string; type?: string }> = Array.isArray(schema?.columns) ? schema.columns : []
    const columnType = (name: string) => columns.find(c => c?.name === name)?.type

    const deltas: Record<string, number> = Object.create(null)
    for (const [key, raw] of Object.entries(data)) {
      if (isUnsafeTemplateSegment(key)) {
        throw new Error(`cannot increment "${key}": that name is reserved`)
      }
      if (key === 'id' || key === 'createdAt' || key === 'updatedAt') {
        throw new Error(`cannot increment "${key}": it is a reserved row field`)
      }
      const n = toIncrementNumber(raw)
      if (n === null) {
        throw new Error(`increment amount for "${key}" must be a number (got ${typeof raw})`)
      }
      if (columns.length > 0) {
        const t = columnType(key)
        if (t === undefined) {
          throw new Error(`cannot increment "${key}": the sheet has no such column`)
        }
        if (t !== 'number') {
          throw new Error(`cannot increment "${key}": the column is "${t}", not a number column`)
        }
      }
      deltas[key] = n
    }

    const outcome = await this.withSheetLock(prisma, sheet, async (tx, ledger) => {
      const currentSize = ledger.sizeBytes

      const rows = await tx.dataSheetRow.findMany({ where: { sheetId: sheet.id } })

      const matchingRows = this.matchRows(rows, filter)

      if (matchingRows.length === 0) return { updatedCount: 0, rows: [] as any[] }

      let totalSizeDelta = 0
      const pending: Array<{ id: string; rowData: string; parsed: any }> = []
      for (const row of matchingRows) {
        const oldRowData = JSON.parse(row.rowData)
        const nextRowData = { ...oldRowData }
        for (const [key, delta] of Object.entries(deltas)) {
          const current = oldRowData[key]
          const base = (current === undefined || current === null || current === '') ? 0 : toIncrementNumber(current)
          if (base === null) {
            throw new Error(`cannot increment "${key}": the stored value is not a number`)
          }
          const next = base + delta
          if (!Number.isFinite(next)) {
            throw new Error(`cannot increment "${key}": the result is out of range`)
          }
          nextRowData[key] = next
        }
        const nextString = JSON.stringify(nextRowData)
        totalSizeDelta += Buffer.byteLength(nextString, 'utf8') - Buffer.byteLength(row.rowData, 'utf8')
        pending.push({ id: row.id, rowData: nextString, parsed: nextRowData })
      }

      if (currentSize + totalSizeDelta > MAX_SHEET_SIZE_BYTES) {
        throw new Error('Storage limit exceeded. Maximum sheet size is 50MB.')
      }

      await Promise.all(pending.map(u =>
        tx.dataSheetRow.update({ where: { id: u.id }, data: { rowData: u.rowData } })
      ))
      await tx.dataSheet.update({
        where: { id: sheet.id },
        data: { sizeBytes: BigInt(currentSize + totalSizeDelta) }
      })

      return {
        updatedCount: pending.length,
        rows: pending.map(u => ({ id: u.id, ...u.parsed })),
      }
    })

    return {
      operation: 'increment',
      success: true,
      message: `Successfully incremented ${outcome.updatedCount} row(s).`,
      updatedCount: outcome.updatedCount,
      rowCount: outcome.updatedCount,
      rows: outcome.rows,
    }
  }

  private async executeDelete(
    prisma: PrismaClient,
    sheet: any,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const { filter } = nodeData

    if (!filter) {
      throw new Error('filter is required for delete operation')
    }
    if (typeof filter !== 'object' || Array.isArray(filter) || Object.keys(filter).length === 0) {
      throw new Error('filter must select specific rows for delete — an empty filter is refused because it would delete every row in the sheet')
    }

    return this.withSheetLock(prisma, sheet, async (tx, ledger) => {
      const rows = await tx.dataSheetRow.findMany({ where: { sheetId: sheet.id } })
      const matchingRows = this.matchRows(rows, filter)

      if (matchingRows.length === 0) {
        return { operation: 'delete', success: true, deletedCount: 0 }
      }

      let totalDeletedSize = 0
      for (const row of matchingRows) {
        totalDeletedSize += Buffer.byteLength(row.rowData, 'utf8')
      }

      await tx.dataSheetRow.deleteMany({
        where: { id: { in: matchingRows.map((r: any) => r.id) } }
      })

      const realCount = await tx.dataSheetRow.count({ where: { sheetId: sheet.id } })

      await tx.dataSheet.update({
        where: { id: sheet.id },
        data: {
          sizeBytes: BigInt(Math.max(0, ledger.sizeBytes - totalDeletedSize)),
          rowCount: realCount
        }
      })

      return {
        operation: 'delete',
        success: true,
        message: `Successfully deleted ${matchingRows.length} row(s).`,
        deletedCount: matchingRows.length
      }
    })
  }

  private async executeUpsert(
    prisma: PrismaClient,
    sheet: any,
    schema: any,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const { filter, data } = nodeData

    if (!data) {
      throw new Error('data is required for upsert operation')
    }

    return this.withSheetLock(prisma, sheet, async (tx, ledger) => {
      const noFilter = filter === undefined || filter === null
      if (!noFilter && (typeof filter !== 'object' || Array.isArray(filter))) {
        throw new Error('filter for upsert must be an object — a string or array is refused because it would silently insert a new row every call')
      }
      const emptyFilter = noFilter || Object.keys(filter as object).length === 0

      const inserted = async (d: any) => {
        const row = await this.insertCore(tx, ledger, sheet, schema, d)
        return {
          operation: 'insert',
          action: 'inserted',
          success: true,
          message: 'Data has been successfully inserted into the sheet.',
          row: { id: row.id, ...JSON.parse(row.rowData), createdAt: row.createdAt }
        }
      }

      if (emptyFilter) return inserted(data)

      const f = filter as Record<string, any>
      const rows = await tx.dataSheetRow.findMany({ where: { sheetId: sheet.id } })
      const matching = this.matchRows(rows, f)

      if (matching.length > 0) {
        const res = await this.updateCore(tx, ledger, sheet, rows, f, data)
        return {
          operation: 'update',
          action: 'updated',
          success: true,
          message: `Successfully updated ${res.updatedCount} row(s).`,
          updatedCount: res.updatedCount
        }
      }

      return inserted({ ...data, ...f })
    })
  }

  private resolveBatchArray(nodeData: DataSheetsNodeData, context: WorkflowContext): Array<Record<string, any>> {
    let dataArray: Array<Record<string, any>>

    if (nodeData.batchData && Array.isArray(nodeData.batchData)) {
      dataArray = nodeData.batchData
    } else if (nodeData.data && Array.isArray(nodeData.data)) {
      dataArray = nodeData.data
    } else if (typeof nodeData.data === 'object' && nodeData.data !== null) {

      const sourceArray = context.jsonData?.transactions || context.transactions

      if (Array.isArray(sourceArray) && sourceArray.length > 0) {

        dataArray = sourceArray.map((item: any) => {
          const itemContext = preserveTemplateVars({ ...context, ...item }, context)
          return this.substituteVariablesInTemplate(nodeData.data, itemContext, item)
        })
      } else {
        dataArray = [nodeData.data]
      }
    } else {
      throw new Error('batchData or data (array) is required for batch-insert operation')
    }

    return dataArray
  }

  private async executeBatchInsert(
    prisma: PrismaClient,
    sheet: any,
    schema: any,
    nodeData: DataSheetsNodeData,
    context: WorkflowContext
  ): Promise<any> {
    const dataArray = this.resolveBatchArray(nodeData, context)

    if (dataArray.length === 0) {
      return {
        operation: 'batch-insert',
        success: true,
        message: 'No data to insert',
        insertedCount: 0,
        rows: []
      }
    }


    const hasNoColumn = schema.columns.some((col: any) => col.name === 'No')

    const result = await this.withSheetLock(prisma, sheet, async (tx, ledger) => {
      const realCount = await tx.dataSheetRow.count({ where: { sheetId: sheet.id } })
      const rowsToInsert = dataArray.map((data, index) => {
        const dataWithNo = hasNoColumn ? { No: realCount + 1 + index, ...data } : data
        this.validateRowData(schema, dataWithNo)
        return dataWithNo
      })

      const rowDataStrings = rowsToInsert.map(row => JSON.stringify(row))
      const totalNewSize = rowDataStrings.reduce((sum, str) => sum + Buffer.byteLength(str, 'utf8'), 0)

      if (ledger.sizeBytes + totalNewSize > MAX_SHEET_SIZE_BYTES) {
        throw new Error(`Storage limit exceeded. Total size would be ${((ledger.sizeBytes + totalNewSize) / 1024 / 1024).toFixed(2)}MB, maximum is 50MB.`)
      }

      const createdRows = await Promise.all(
        rowDataStrings.map(rowDataString =>
          tx.dataSheetRow.create({
            data: {
              sheetId: sheet.id,
              rowData: rowDataString
            }
          })
        )
      )

      await tx.dataSheet.update({
        where: { id: sheet.id },
        data: {
          sizeBytes: BigInt(ledger.sizeBytes + totalNewSize),
          rowCount: realCount + rowsToInsert.length
        }
      })

      return createdRows
    })

    return {
      operation: 'batch-insert',
      success: true,
      message: `Successfully inserted ${result.length} row(s) into the sheet.`,
      insertedCount: result.length,
      rows: result.map(row => ({
        id: row.id,
        ...JSON.parse(row.rowData),
        createdAt: row.createdAt
      }))
    }
  }

  private validateRowData(
    schema: { columns: Array<{ name: string; type: string; required: boolean }> },
    rowData: Record<string, any>
  ): void {
    const errors: string[] = []

    for (const column of schema.columns) {
      const value = rowData[column.name]

      if (column.required && (value === undefined || value === null || value === '')) {
        errors.push(`${column.name} is required`)
        continue
      }

      if (value !== undefined && value !== null && value !== '') {
        switch (column.type) {
          case 'number':
            if (typeof value !== 'number' && isNaN(Number(value))) {
              errors.push(`${column.name} must be a number`)
            }
            break
          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push(`${column.name} must be a boolean`)
            }
            break
          case 'date':
          case 'datetime':
            if (isNaN(Date.parse(value))) {
              errors.push(`${column.name} must be a valid date`)
            }
            break
        }
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`)
    }
  }

  private substituteVariables(obj: any, context: WorkflowContext): any {
    if (typeof obj === 'string') {
      const singleVarMatch = obj.match(/^\{\{([^}]+)\}\}$/)
      if (singleVarMatch) {
        let trimmed = singleVarMatch[1].trim()
        if (trimmed.startsWith('context.')) {
          trimmed = trimmed.substring(8)
        }
        if (!canReadTemplatePath(context, trimmed)) return obj
        const value = this.getNestedValue(context, trimmed)
        return value !== undefined && value !== null ? value : obj
      }

      return obj.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
        let trimmed = path.trim()
        if (trimmed.startsWith('context.')) {
          trimmed = trimmed.substring(8)
        }
        if (!canReadTemplatePath(context, trimmed)) return match
        const value = this.getNestedValue(context, trimmed)

        if (value === undefined || value === null) {
          return match
        }

        if (typeof value === 'object') {
          return JSON.stringify(value)
        }

        return value
      })
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.substituteVariables(item, context))
    }

    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, any> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.substituteVariables(value, context)
      }
      return result
    }

    return obj
  }

  private normalizeDate(dateStr: string): string | null {
    if (!dateStr || typeof dateStr !== 'string') return null

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr
    }

    const europeanMatch = dateStr.match(/^(\d{1,2})[\./](\d{1,2})[\./](\d{4})$/)
    if (europeanMatch) {
      const [, day, month, year] = europeanMatch
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    return null
  }

  private substituteVariablesInTemplate(template: any, context: WorkflowContext, item: any): any {
    if (typeof template === 'string') {
      const result = template.replace(/\{\{([^}]+)\}\}/g, (_match, expr) => {
        let trimmed = expr.trim()
        if (trimmed.startsWith('context.')) {
          trimmed = trimmed.substring(8)
        }

        //
        //
        //
        //
        //
        //
        if (trimmed.includes('?')) {
          console.error(
            `[DataSheets] 🔒 삼항 표현식 템플릿은 더 이상 평가하지 않는다 (보안상 제거됨) — null 로 저장된다: ${trimmed.slice(0, 120)}`
          )
          return 'null'
        }

        const value =
          item[trimmed] ?? (canReadTemplatePath(context, trimmed) ? this.getNestedValue(context, trimmed) : undefined)

        if (value === undefined || value === null) {
          return 'null'
        }

        return String(value)
      })

      if (result === 'null') return null
      if (result === 'true') return true
      if (result === 'false') return false
      if (!isNaN(Number(result)) && result.trim() !== '') return Number(result)

      /*
      const normalizedDate = this.normalizeDate(result)
      if (normalizedDate) return normalizedDate
      */

      return result
    }

    if (template === null) {
      return null
    }

    if (typeof template === 'number' || typeof template === 'boolean') {
      return template
    }

    if (Array.isArray(template)) {
      return template.map(t => this.substituteVariablesInTemplate(t, context, item))
    }

    if (typeof template === 'object') {
      const result: Record<string, any> = {}
      for (const [key, value] of Object.entries(template)) {
        result[key] = this.substituteVariablesInTemplate(value, context, item)
      }
      return result
    }

    return template
  }

  private getNestedValue(obj: any, path: string): any {
    const parts = path.split('.')
    let current = obj

    for (const part of parts) {
      if (current === undefined || current === null) {
        return undefined
      }
      current = current[part]
    }

    return current
  }

  private normalizeDateFormat(dateStr: string): string | null {
    if (!dateStr) return null

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr
    }

    const ddmmyyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (ddmmyyyyMatch) {
      const [, day, month, year] = ddmmyyyyMatch
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    const mmddyyyyMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (mmddyyyyMatch) {
      const [, first, second, year] = mmddyyyyMatch
      if (parseInt(first) > 12) {
        return `${year}-${second.padStart(2, '0')}-${first.padStart(2, '0')}`
      }
      return `${year}-${first.padStart(2, '0')}-${second.padStart(2, '0')}`
    }

    // YYYY/MM/DD
    const yyyymmddMatch = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/)
    if (yyyymmddMatch) {
      const [, year, month, day] = yyyymmddMatch
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    // DD-MM-YYYY
    const ddmmyyyyDashMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/)
    if (ddmmyyyyDashMatch) {
      const [, day, month, year] = ddmmyyyyDashMatch
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    const ddmmyyyyDotMatch = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
    if (ddmmyyyyDotMatch) {
      const [, day, month, year] = ddmmyyyyDotMatch
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    }

    const yyyymmddNoSepMatch = dateStr.match(/^(\d{4})(\d{2})(\d{2})$/)
    if (yyyymmddNoSepMatch) {
      const [, year, month, day] = yyyymmddNoSepMatch
      return `${year}-${month}-${day}`
    }

    // ISO 8601 with time (YYYY-MM-DDTHH:mm:ss)
    if (dateStr.includes('T')) {
      const isoMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})T/)
      if (isoMatch) {
        return isoMatch[1]
      }
    }

    try {
      const date = new Date(dateStr)
      if (!isNaN(date.getTime())) {
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        return `${year}-${month}-${day}`
      }
    } catch {
    }

    return null
  }
}

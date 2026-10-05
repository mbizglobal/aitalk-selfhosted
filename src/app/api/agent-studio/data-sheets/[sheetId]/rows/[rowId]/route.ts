import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const MAX_SHEET_SIZE_BYTES = 50 * 1024 * 1024

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string; rowId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId, rowId } = await params
    const body = await request.json()
    const { rowData } = body

    if (!rowData || typeof rowData !== 'object') {
      return NextResponse.json(
        { error: 'rowData is required and must be an object' },
        { status: 400 }
      )
    }

    const row = await prisma.dataSheetRow.findFirst({
      where: { id: rowId, kind: 'agent' },
      include: {
        sheet: {
          include: {
            agent: {
              select: { userId: true }
            }
          }
        }
      }
    })

    if (!row || row.sheetId !== sheetId || !row.sheet.agent) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    if (row.sheet.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const schema = JSON.parse(row.sheet.schema)
    const validationResult = validateRowData(schema, rowData)
    if (!validationResult.valid) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.errors },
        { status: 400 }
      )
    }

    const oldRowSize = Buffer.byteLength(row.rowData, 'utf8')
    const newRowDataString = JSON.stringify(rowData)
    const newRowSize = Buffer.byteLength(newRowDataString, 'utf8')
    const sizeDelta = newRowSize - oldRowSize

    const currentSheetSize = Number(row.sheet.sizeBytes)
    if (currentSheetSize + sizeDelta > MAX_SHEET_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Storage limit exceeded (50MB)' },
        { status: 413 }
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedRow = await tx.dataSheetRow.update({
        where: { id: rowId },
        data: {
          rowData: newRowDataString
        }
      })

      await tx.dataSheet.update({
        where: { id: sheetId },
        data: {
          sizeBytes: BigInt(currentSheetSize + sizeDelta)
        }
      })

      return updatedRow
    })

    return NextResponse.json({
      success: true,
      row: result
    })

  } catch (error) {
    console.error('Failed to update row:', error)
    return NextResponse.json(
      { error: 'Failed to update row' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string; rowId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId, rowId } = await params

    const row = await prisma.dataSheetRow.findFirst({
      where: { id: rowId, kind: 'agent' },
      include: {
        sheet: {
          include: {
            agent: {
              select: { userId: true }
            }
          }
        }
      }
    })

    if (!row || row.sheetId !== sheetId || !row.sheet.agent) {
      return NextResponse.json({ error: 'Row not found' }, { status: 404 })
    }

    if (row.sheet.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rowSize = Buffer.byteLength(row.rowData, 'utf8')
    const currentSheetSize = Number(row.sheet.sizeBytes)

    await prisma.$transaction(async (tx) => {
      await tx.dataSheetRow.delete({
        where: { id: rowId }
      })

      const realCount = await tx.dataSheetRow.count({
        where: { sheetId }
      })

      await tx.dataSheet.update({
        where: { id: sheetId },
        data: {
          sizeBytes: BigInt(Math.max(0, currentSheetSize - rowSize)),
          rowCount: realCount
        }
      })
    })

    return NextResponse.json({
      success: true,
      message: 'Row deleted successfully'
    })

  } catch (error) {
    console.error('Failed to delete row:', error)
    return NextResponse.json(
      { error: 'Failed to delete row' },
      { status: 500 }
    )
  }
}

function validateRowData(
  schema: { columns: Array<{ name: string; type: string; required: boolean }> },
  rowData: Record<string, any>
): { valid: boolean; errors: string[] } {
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
        case 'string':
        case 'text':
          if (typeof value !== 'string') {
            errors.push(`${column.name} must be a string`)
          }
          break
        case 'json':
          if (typeof value !== 'object') {
            errors.push(`${column.name} must be a JSON object`)
          }
          break
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

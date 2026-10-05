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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId } = await params
    const { searchParams } = new URL(request.url)

    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const skip = (page - 1) * limit

    const sortBy = searchParams.get('sortBy') || 'createdAt'
    const sortOrder = searchParams.get('sortOrder') || 'desc'

    const sheet = await prisma.dataSheet.findFirst({
      where: { id: sheetId, kind: 'agent' },
      include: {
        agent: {
          select: { userId: true }
        }
      }
    })

    if (!sheet || !sheet.agent) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
    }

    if (sheet.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const [rows, totalCount] = await Promise.all([
      prisma.dataSheetRow.findMany({
        where: { sheetId: sheetId },
        skip: skip,
        take: limit,
        orderBy: {
          [sortBy]: sortOrder
        },
        select: {
          id: true,
          rowData: true,
          createdAt: true,
          updatedAt: true
        }
      }),
      prisma.dataSheetRow.count({
        where: { sheetId: sheetId }
      })
    ])

    const rowsWithParsedData = rows.map(row => ({
      ...row,
      rowData: JSON.parse(row.rowData)
    }))

    return NextResponse.json({
      success: true,
      rows: rowsWithParsedData,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit)
      }
    })

  } catch (error) {
    console.error('Failed to fetch rows:', error)
    return NextResponse.json(
      { error: 'Failed to fetch rows' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId } = await params
    const body = await request.json()
    const { rowData } = body

    if (!rowData || typeof rowData !== 'object') {
      return NextResponse.json(
        { error: 'rowData is required and must be an object' },
        { status: 400 }
      )
    }

    const sheet = await prisma.dataSheet.findFirst({
      where: { id: sheetId, kind: 'agent' },
      include: {
        agent: {
          select: { userId: true }
        }
      }
    })

    if (!sheet || !sheet.agent) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
    }

    if (sheet.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const schema = JSON.parse(sheet.schema)
    const validationResult = validateRowData(schema, rowData)
    if (!validationResult.valid) {
      return NextResponse.json(
        { error: 'Validation failed', details: validationResult.errors },
        { status: 400 }
      )
    }

    const rowDataString = JSON.stringify(rowData)
    const newRowSize = Buffer.byteLength(rowDataString, 'utf8')
    const currentSize = Number(sheet.sizeBytes)

    if (currentSize + newRowSize > MAX_SHEET_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Storage limit exceeded (50MB)' },
        { status: 413 }
      )
    }

    const result = await prisma.$transaction(async (tx) => {
      const newRow = await tx.dataSheetRow.create({
        data: {
          sheetId: sheetId,
          rowData: rowDataString
        }
      })

      await tx.dataSheet.update({
        where: { id: sheetId },
        data: {
          sizeBytes: BigInt(currentSize + newRowSize),
          rowCount: sheet.rowCount + 1
        }
      })

      return newRow
    })

    return NextResponse.json({
      success: true,
      row: {
        ...result,
        rowData: JSON.parse(result.rowData)
      }
    }, { status: 201 })

  } catch (error) {
    console.error('Failed to create row:', error)
    return NextResponse.json(
      { error: 'Failed to create row' },
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

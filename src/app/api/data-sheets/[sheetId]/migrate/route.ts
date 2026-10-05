import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '../../../auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

function applySchemaDefaults(rowData: any, schema: { columns: any[] }) {
  const result = { ...rowData }

  schema.columns.forEach((col) => {
    const value = result[col.name]

    if (!(col.name in result)) {
      switch (col.type) {
        case 'boolean':
          result[col.name] = null
          break
        case 'number':
          result[col.name] = null
          break
        case 'string':
          result[col.name] = null
          break
        case 'date':
        case 'datetime':
          result[col.name] = null
          break
        case 'json':
          result[col.name] = null
          break
        default:
          result[col.name] = null
      }
    } else {
      if (value !== undefined && value !== null && value !== '') {
        switch (col.type) {
          case 'number':
            if (typeof value === 'string') {
              const numValue = Number(value)
              if (!isNaN(numValue)) {
                result[col.name] = numValue
              }
            }
            break

          case 'boolean':
            if (typeof value !== 'boolean') {
              if (value === 'true' || value === '1' || value === 1) {
                result[col.name] = true
              } else if (value === 'false' || value === '0' || value === 0) {
                result[col.name] = false
              }
            }
            break

          case 'string':
            if (typeof value !== 'string') {
              result[col.name] = String(value)
            }
            break

        }
      }
    }
  })

  return result
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId } = await params
    const BATCH_SIZE = 100

    const sheet = await prisma.dataSheet.findFirst({
      where: { id: sheetId, kind: 'agent' },
      include: {
        agent: {
          include: {
            user: true,
          },
        },
      },
    })

    if (!sheet || !sheet.agent) {
      return NextResponse.json({ error: 'Data sheet not found' }, { status: 404 })
    }

    if (sheet.agent.user.email !== session.user.email) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    let schema: { columns: any[] }
    try {
      schema = JSON.parse(sheet.schema)
    } catch (error) {
      return NextResponse.json({ error: 'Invalid schema' }, { status: 400 })
    }

    const totalRows = await prisma.dataSheetRow.count({
      where: { sheetId },
    })

    if (totalRows === 0) {
      return NextResponse.json({
        success: true,
        message: 'No rows to migrate',
        totalRows: 0,
        migratedRows: 0,
      })
    }

    let offset = 0
    let migratedCount = 0
    let hasMore = true

    while (hasMore) {
      const rows = await prisma.dataSheetRow.findMany({
        where: { sheetId },
        skip: offset,
        take: BATCH_SIZE,
      })

      if (rows.length === 0) {
        hasMore = false
        break
      }

      await Promise.all(
        rows.map(async (row) => {
          try {
            const rowData = JSON.parse(row.rowData)
            const updatedData = applySchemaDefaults(rowData, schema)

            await prisma.dataSheetRow.update({
              where: { id: row.id },
              data: { rowData: JSON.stringify(updatedData) },
            })

            migratedCount++
          } catch (error) {
            console.error(`[MIGRATE] Error updating row ${row.id}:`, error)
          }
        })
      )

      offset += BATCH_SIZE

      console.log(
        `[MIGRATE] Progress: ${migratedCount}/${totalRows} (${Math.round((migratedCount / totalRows) * 100)}%)`
      )
    }

    const allRows = await prisma.dataSheetRow.findMany({
      where: { sheetId },
    })

    const totalSize = allRows.reduce(
      (sum, row) => sum + Buffer.byteLength(row.rowData, 'utf-8'),
      0
    )

    await prisma.dataSheet.update({
      where: { id: sheetId },
      data: {
        rowCount: allRows.length,
        sizeBytes: totalSize,
      },
    })

    return NextResponse.json({
      success: true,
      message: `Successfully migrated ${migratedCount} rows`,
      totalRows,
      migratedRows: migratedCount,
    })
  } catch (error) {
    console.error('[MIGRATE] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'
import { nanoid } from 'nanoid'

interface FullBackupData {
  _backup?: {
    version: string
    exportedAt: string
    type: string
  }
  name?: string
  description?: string | null
  schema?: {
    columns: Array<{
      name: string
      type: string
      required?: boolean
      description?: string
    }>
  }
  rows: Array<Record<string, any>>
}

export async function POST(
  request: NextRequest,
  { params }: { params: { sheetId: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId } = params
    const body = await request.json()

    const isFullBackup = body._backup?.type === 'data-sheet-full-backup'

    let rows: Array<Record<string, any>>
    let backupSchema: FullBackupData['schema'] | null = null
    let backupName: string | null = null
    let backupDescription: string | null = null

    if (isFullBackup) {
      const backupData = body as FullBackupData
      rows = backupData.rows || []
      backupSchema = backupData.schema
      backupName = backupData.name || null
      backupDescription = backupData.description ?? null
    } else if (Array.isArray(body.rows)) {
      rows = body.rows
    } else if (Array.isArray(body)) {
      rows = body
    } else {
      return NextResponse.json(
        { error: 'Invalid format. Expected array or backup JSON.' },
        { status: 400 }
      )
    }

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

    if (isFullBackup) {
      await prisma.dataSheetRow.deleteMany({
        where: { sheetId },
      })

      const updateData: any = {}
      if (backupSchema) {
        updateData.schema = JSON.stringify(backupSchema)
      }
      if (backupName) {
        updateData.name = backupName
      }
      if (backupDescription !== null) {
        updateData.description = backupDescription
      }

      if (Object.keys(updateData).length > 0) {
        await prisma.dataSheet.update({
          where: { id: sheetId },
          data: updateData,
        })
      }
    }

    let schema: { columns: any[] }
    if (isFullBackup && backupSchema) {
      schema = backupSchema
    } else {
      try {
        schema = JSON.parse(sheet.schema)
      } catch (error) {
        schema = { columns: [] }
      }
    }

    const newRows = await Promise.all(
      rows.map(async (rowData: Record<string, any>) => {
        const formattedData = { ...rowData }
        if (schema.columns.length > 0) {
          schema.columns.forEach((col) => {
            const value = formattedData[col.name]
            if (value !== undefined && value !== null && value !== '') {
              if (col.type === 'number') {
                const num = Number(value)
                if (!isNaN(num)) formattedData[col.name] = num
              } else if (col.type === 'boolean') {
                if (value === 'true' || value === '1' || value === 1) formattedData[col.name] = true
                else if (value === 'false' || value === '0' || value === 0) formattedData[col.name] = false
              } else if (col.type === 'string') {
                if (typeof value !== 'string') formattedData[col.name] = String(value)
              }
            }
          })
        }

        return await prisma.dataSheetRow.create({
          data: {
            id: nanoid(),
            sheetId,
            rowData: JSON.stringify(formattedData),
          },
        })
      })
    )

    const totalRows = await prisma.dataSheetRow.count({
      where: { sheetId },
    })

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
        rowCount: totalRows,
        sizeBytes: totalSize,
      },
    })

    return NextResponse.json({
      success: true,
      message: isFullBackup
        ? `Full restore completed: ${newRows.length} rows restored`
        : `${newRows.length} rows uploaded successfully`,
      isFullRestore: isFullBackup,
      rows: allRows.map(row => ({
        id: row.id,
        rowData: row.rowData,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    })
  } catch (error) {
    console.error('[BULK_UPLOAD] Error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

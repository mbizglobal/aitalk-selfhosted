import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { prisma } from '@/lib/prisma'

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sheetId: string }> }
) {
    try {
        const session = await getServerSession(authOptions as any) as any
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
        }

        const { sheetId } = await params
        const { rowIds } = await request.json()

        if (!Array.isArray(rowIds) || rowIds.length === 0) {
            return NextResponse.json(
                { error: 'rowIds must be a non-empty array' },
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

        const result = await prisma.dataSheetRow.deleteMany({
            where: {
                sheetId,
                id: { in: rowIds },
            },
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
                rowCount: allRows.length,
                sizeBytes: totalSize,
            },
        })

        return NextResponse.json({
            success: true,
            message: `Deleted ${result.count} rows`,
            deletedCount: result.count
        })
    } catch (error) {
        console.error('[BATCH_DELETE] Error:', error)
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        )
    }
}

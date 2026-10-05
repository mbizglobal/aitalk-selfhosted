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

    return NextResponse.json({
      success: true,
      sheet: {
        id: sheet.id,
        agentId: sheet.agentId,
        name: sheet.name,
        description: sheet.description,
        schema: JSON.parse(sheet.schema),
        sizeBytes: Number(sheet.sizeBytes),
        rowCount: sheet.rowCount,
        createdAt: sheet.createdAt,
        updatedAt: sheet.updatedAt
      }
    })

  } catch (error) {
    console.error('Failed to fetch data sheet:', error)
    return NextResponse.json(
      { error: 'Failed to fetch data sheet' },
      { status: 500 }
    )
  }
}

export async function PATCH(
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
    const { name, description, schema } = body

    const sheet = await prisma.dataSheet.findFirst({
      where: { id: sheetId, kind: 'agent' },
      include: {
        agent: {
          select: { userId: true, agentId: true }
        }
      }
    })

    if (!sheet || !sheet.agent) {
      return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
    }

    if (sheet.agent.userId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (name && name !== sheet.name) {
      const existingSheet = await prisma.dataSheet.findFirst({
        where: {
          agentId: sheet.agentId,
          name: name,
          NOT: { id: sheetId }
        }
      })

      if (existingSheet) {
        return NextResponse.json(
          { error: 'Sheet with this name already exists' },
          { status: 409 }
        )
      }
    }

    if (schema && (!schema.columns || !Array.isArray(schema.columns))) {
      return NextResponse.json(
        { error: 'schema must have columns array' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (schema !== undefined) updateData.schema = JSON.stringify(schema)

    const updatedSheet = await prisma.dataSheet.update({
      where: { id: sheetId },
      data: updateData
    })

    return NextResponse.json({
      success: true,
      sheet: {
        ...updatedSheet,
        schema: JSON.parse(updatedSheet.schema),
        sizeBytes: Number(updatedSheet.sizeBytes)
      }
    })

  } catch (error) {
    console.error('Failed to update data sheet:', error)
    return NextResponse.json(
      { error: 'Failed to update data sheet' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ sheetId: string }> }
) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sheetId } = await params

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

    await prisma.dataSheet.delete({
      where: { id: sheetId }
    })

    return NextResponse.json({
      success: true,
      message: 'Sheet deleted successfully'
    })

  } catch (error) {
    console.error('Failed to delete data sheet:', error)
    return NextResponse.json(
      { error: 'Failed to delete data sheet' },
      { status: 500 }
    )
  }
}

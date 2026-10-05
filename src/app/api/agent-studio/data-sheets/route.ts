import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { PrismaClient } from '@prisma/client'
import { isSelfHosted } from '@/lib/edition'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: ['error', 'warn'],
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

const FREE_USER_MAX_DATA_SHEETS = 2

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const agentId = searchParams.get('agentId')

    if (!agentId) {
      return NextResponse.json({ error: 'agentId is required' }, { status: 400 })
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId: agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const sheets = await prisma.dataSheet.findMany({
      where: {
        agentId: agentId
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        name: true,
        description: true,
        schema: true,
        sizeBytes: true,
        rowCount: true,
        createdAt: true,
        updatedAt: true
      }
    })

    const sheetsWithParsedData = sheets.map(sheet => ({
      ...sheet,
      schema: JSON.parse(sheet.schema),
      sizeBytes: Number(sheet.sizeBytes)
    }))

    return NextResponse.json({
      success: true,
      sheets: sheetsWithParsedData
    })

  } catch (error) {
    console.error('Failed to fetch data sheets:', error)
    return NextResponse.json(
      { error: 'Failed to fetch data sheets' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions as any) as any

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const { agentId, name, description, schema } = body

    if (!agentId || !name || !schema) {
      return NextResponse.json(
        { error: 'agentId, name, and schema are required' },
        { status: 400 }
      )
    }

    if (!schema.columns || !Array.isArray(schema.columns)) {
      return NextResponse.json(
        { error: 'schema must have columns array' },
        { status: 400 }
      )
    }

    const agent = await prisma.agent.findFirst({
      where: {
        agentId: agentId,
        userId: session.user.id
      }
    })

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }

    const user = isSelfHosted() ? null : await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        subscription: {
          select: { status: true, planType: true }
        }
      }
    })

    const isPaidUser = isSelfHosted() || (user?.subscription?.planType !== 'free' && user?.subscription?.status === 'active')

    if (!isPaidUser) {
      const currentSheetCount = await prisma.dataSheet.count({
        where: { agentId }
      })

      if (currentSheetCount >= FREE_USER_MAX_DATA_SHEETS) {
        return NextResponse.json({
          error: 'data_sheets_limit_reached',
          maxDataSheets: FREE_USER_MAX_DATA_SHEETS
        }, { status: 400 })
      }
    }

    const existingSheet = await prisma.dataSheet.findFirst({
      where: {
        agentId: agentId,
        name: name
      }
    })

    if (existingSheet) {
      return NextResponse.json(
        { error: 'Sheet with this name already exists' },
        { status: 409 }
      )
    }

    const sheet = await prisma.dataSheet.create({
      data: {
        agentId: agentId,
        userId: agent.userId,
        name: name,
        description: description || null,
        schema: JSON.stringify(schema)
      }
    })

    return NextResponse.json({
      success: true,
      sheet: {
        ...sheet,
        schema: JSON.parse(sheet.schema),
        sizeBytes: Number(sheet.sizeBytes)
      }
    }, { status: 201 })

  } catch (error) {
    console.error('Failed to create data sheet:', error)
    return NextResponse.json(
      { error: 'Failed to create data sheet' },
      { status: 500 }
    )
  }
}

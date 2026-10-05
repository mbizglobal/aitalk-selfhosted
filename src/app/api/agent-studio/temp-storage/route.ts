import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'

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

    const tempStorage = await prisma.workflowTempStorage.findFirst({
      where: {
        agentId: agentId
      },
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        id: true,
        jsonData: true,
        status: true,
        createdAt: true
      }
    })

    if (!tempStorage) {
      return NextResponse.json({ data: null })
    }

    let parsedData = null
    try {
      parsedData = JSON.parse(tempStorage.jsonData)
    } catch {
      parsedData = tempStorage.jsonData
    }

    return NextResponse.json({
      data: {
        id: tempStorage.id,
        jsonData: parsedData,
        status: tempStorage.status,
        createdAt: tempStorage.createdAt
      }
    })
  } catch (error) {
    console.error('Failed to fetch temp storage:', error)
    return NextResponse.json(
      { error: 'Failed to fetch temp storage' },
      { status: 500 }
    )
  }
}
